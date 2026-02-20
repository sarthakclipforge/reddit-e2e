
import { RedditPost } from '@/types';

const REDDIT_SEARCH_URL = 'https://www.reddit.com/search.json';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
    time: 'all' | 'year' | 'month' | 'week' | 'day' | 'hour' = 'all'
): Promise<RedditPost[]> {
    const params = new URLSearchParams({
        q: query,
        limit: limit.toString(),
        sort: sort,
        t: time,
        type: 'link', // Only posts, no subreddits/users
        include_over_18: 'off'
    });

    const url = `${REDDIT_SEARCH_URL}?${params.toString()}`;

    try {
        const res = await fetchWithTimeout(url, {
            headers: {
                'User-Agent': USER_AGENT
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

        return children.map((child: any) => {
            const p = child?.data || {};
            return {
                id: p.name || `t3_${Math.random().toString(36).substr(2, 9)}`,
                title: p.title || 'Untitled Post',
                subreddit: p.subreddit || 'u/unknown',
                author: p.author || 'deleted',
                link: p.url || `https://reddit.com${p.permalink}`,
                selftext: (p.selftext || '').substring(0, 1000),
                upvotes: p.ups || 0,
                comments: p.num_comments || 0,
                created: new Date((p.created_utc || Date.now() / 1000) * 1000).toISOString(),
                thumbnail: p.thumbnail && p.thumbnail.startsWith('http') ? p.thumbnail : null
            } as RedditPost;
        });

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
            headers: { 'User-Agent': USER_AGENT }
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
            .map((c: any) => c.data.body)
            .filter((body: string) => body && body !== '[deleted]' && body !== '[removed]')
            .slice(0, 5) // Top 5 comments
            .join('\\n---\\n');

    } catch (error) {
        console.error('Error fetching post details:', error);
        return '';
    }
}
