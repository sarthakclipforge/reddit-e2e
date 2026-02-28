
import { RedditPost } from '@/types';

const REDDIT_SEARCH_URL = 'https://www.reddit.com/search.json';

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:122.0) Gecko/20100101 Firefox/122.0',
];

function getRandomUserAgent(): string {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Maps a UI time range to the nearest broader Reddit-native time filter + a cutoff timestamp.
 * Reddit only supports: hour, day, week, month, year, all.
 * Custom ranges like '15d' need to fetch a broader set and then filter locally.
 */
function resolveTimeRange(time: string): { redditTime: string; cutoffMs: number | null } {
    const now = Date.now();
    switch (time) {
        case '15d':
            return { redditTime: 'month', cutoffMs: now - 15 * 24 * 60 * 60 * 1000 };
        case 'hour':
        case 'day':
        case 'week':
        case 'month':
        case 'year':
        case 'all':
            return { redditTime: time, cutoffMs: null };
        default:
            return { redditTime: 'all', cutoffMs: null };
    }
}

/**
 * Wraps fetch with a timeout to prevent hanging requests.
 */
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = 8000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        return response;
    } finally {
        clearTimeout(id);
    }
}

/**
 * Searches Reddit using the public JSON endpoint (No OAuth).
 * Simulates a browser request to avoid complex auth setup for read-only public data.
 */
export async function searchReddit(
    query: string,
    limit: number = 25,
    sort: 'relevance' | 'hot' | 'top' | 'new' = 'relevance',
    time: string = 'all'
): Promise<RedditPost[]> {
    const { redditTime, cutoffMs } = resolveTimeRange(time);

    // If we need to post-filter, fetch more to compensate for discarded results
    const fetchLimit = cutoffMs ? Math.min(100, limit * 3) : limit;

    const params = new URLSearchParams({
        q: query,
        limit: fetchLimit.toString(),
        sort: sort,
        t: redditTime,
        type: 'link', // Only posts, no subreddits/users
        include_over_18: 'off'
    });

    const url = `${REDDIT_SEARCH_URL}?${params.toString()}`;

    try {
        const res = await fetchWithTimeout(url, {
            headers: {
                'User-Agent': getRandomUserAgent()
            }
        });

        if (res.status === 429) {
            throw new Error('Reddit Rate Limit Exceeded (429)');
        }

        if (!res.ok) {
            throw new Error(`Reddit API Error: ${res.status}`);
        }

        const data = await res.json();

        // Defensive Mapping
        const children = data?.data?.children || [];

        const posts = children.map((child: any) => {
            const p = child?.data || {};
            return {
                id: p.name || `t3_${Math.random().toString(36).substr(2, 9)}`,
                title: p.title || 'Untitled Post',
                subreddit: p.subreddit || 'u/unknown',
                author: p.author || 'deleted',
                link: p.url || `https://reddit.com${p.permalink}`,
                permalink: p.permalink || '',          // Reddit thread path for comment fetching
                snippet: (p.selftext || '').substring(0, 500), // Post body text
                upvotes: p.ups || 0,
                comments: p.num_comments || 0,
                created: new Date((p.created_utc || Date.now() / 1000) * 1000).toISOString(),
                thumbnail: p.thumbnail && p.thumbnail.startsWith('http') ? p.thumbnail : null
            } as RedditPost;
        });

        // Apply custom date cutoff if needed (e.g., 15d)
        let filtered = posts;
        if (cutoffMs) {
            filtered = posts.filter(p => new Date(p.created).getTime() >= cutoffMs);
        }

        return filtered.slice(0, limit);

    } catch (error) {
        console.error('Reddit Search Failed:', error);
        // Return empty array on failure so one failed query doesn't crash the whole batch
        return [];
    }
}

/**
 * Fetches the details (comments) of a specific post.
 * @param permalink The permalink of the post (e.g., /r/subreddit/comments/id/title/)
 * @returns A string containing the top comments.
 */
export async function getPostDetails(permalink: string): Promise<string> {
    // Ensure permalink starts with /r/ if not present, and handle full URLs
    let cleanLink = permalink;
    if (cleanLink.startsWith('https://www.reddit.com')) {
        cleanLink = cleanLink.replace('https://www.reddit.com', '');
    }

    // Remove trailing slash if present to avoid double slash
    if (cleanLink.endsWith('/')) {
        cleanLink = cleanLink.slice(0, -1);
    }

    const url = `https://www.reddit.com${cleanLink}.json?limit=10&sort=top`;

    try {
        const res = await fetchWithTimeout(url, {
            headers: { 'User-Agent': getRandomUserAgent() }
        });

        if (!res.ok) {
            console.error(`Failed to fetch post details: ${res.status}`);
            return '';
        }

        const data = await res.json();

        if (!Array.isArray(data) || data.length < 2) {
            return '';
        }

        // data[0] is the post, data[1] is the comments
        const commentsListing = data[1];
        const comments = commentsListing?.data?.children || [];

        return comments
            .map((c: any) => {
                const body: string = c.data.body || '';
                // Truncate each comment to 200 chars to keep token usage low
                return body.length > 200 ? body.substring(0, 200) + '…' : body;
            })
            .filter((body: string) => body && body !== '[deleted]' && body !== '[removed]')
            .slice(0, 5) // Top 5 comments
            .join('\n---\n');

    } catch (error) {
        console.error('Error fetching post details:', error);
        return '';
    }
}
