/**
 * Reddit API helper — fetches posts using Reddit's public JSON endpoints.
 * Uses native fetch (no axios) for Vercel edge compatibility.
 * Uses old.reddit.com to avoid cloud IP blocking.
 */

import { RedditPost } from '@/types';

// old.reddit.com is more permissive with cloud/server IPs than www.reddit.com
const REDDIT_API_BASE = 'https://old.reddit.com';

// Browser-like User-Agent — Reddit blocks generic bot UAs from cloud IPs
const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface RedditComment {
    body: string;
    author: string;
    score: number;
    replies?: RedditComment[];
}

interface RedditApiChild {
    data: {
        id: string;
        title: string;
        score: number;
        num_comments: number;
        permalink: string;
        subreddit_name_prefixed: string;
        created_utc: number;
        author: string;
    };
}

interface RedditApiResponse {
    data: {
        children: RedditApiChild[];
        after: string | null;
    };
}

/**
 * Fetch a URL with retry logic and exponential backoff.
 */
async function fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries = 3,
): Promise<Response> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);

        try {
            const res = await fetch(url, {
                ...options,
                signal: controller.signal,
            });
            clearTimeout(timeoutId);

            if (res.ok) return res;

            // Retryable status codes
            if ((res.status === 429 || res.status >= 500) && attempt < maxRetries - 1) {
                const delay = Math.pow(2, attempt) * 1500; // 1.5s, 3s, 6s
                console.warn(
                    `Reddit returned ${res.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`,
                );
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }

            throw new Error(`Reddit API error: ${res.status} ${res.statusText}`);
        } catch (err: unknown) {
            clearTimeout(timeoutId);

            if (err instanceof DOMException && err.name === 'AbortError') {
                if (attempt < maxRetries - 1) {
                    console.warn(`Reddit request timed out, retrying (attempt ${attempt + 1}/${maxRetries})`);
                    await new Promise((r) => setTimeout(r, 2000));
                    continue;
                }
                throw new Error('Reddit request timed out after multiple retries');
            }
            throw err;
        }
    }

    throw new Error('Reddit fetch failed after all retries');
}

/**
 * Fetch Reddit posts for a given query and sort type.
 * Paginates to collect up to 100 posts total.
 */
export async function fetchRedditPosts(
    keywords: string,
    sort: 'top' | 'hot',
    time?: string,
): Promise<RedditPost[]> {
    const allPosts: RedditPost[] = [];
    let after: string | null = null;

    // If '15d' (custom) is selected, we fetch 'month' and filter manually.
    let tParam = time || 'all';
    if (time === '15d') {
        tParam = 'month';
    }

    const maxPages = 4;

    for (let page = 0; page < maxPages; page++) {
        const params = new URLSearchParams({
            q: keywords,
            limit: '100',
            sort,
            t: tParam,
            type: 'link',
            raw_json: '1',
        });

        if (after) {
            params.set('after', after);
        }

        const url = `${REDDIT_API_BASE}/search.json?${params.toString()}`;

        const res = await fetchWithRetry(url, {
            method: 'GET',
            headers: {
                'User-Agent': USER_AGENT,
                Accept: 'application/json',
            },
            cache: 'no-store',
        });

        const json = (await res.json()) as RedditApiResponse;
        const children = json?.data?.children || [];

        if (children.length === 0) break;

        for (const child of children) {
            const postTime = child.data.created_utc * 1000;

            // Custom filtering for 15 days
            if (time === '15d') {
                const fifteenDaysAgo = Date.now() - 15 * 24 * 60 * 60 * 1000;
                if (postTime < fifteenDaysAgo) continue;
            }

            allPosts.push({
                id: child.data.id,
                title: child.data.title,
                upvotes: child.data.score,
                comments: child.data.num_comments,
                link: `https://www.reddit.com${child.data.permalink}`,
                subreddit: child.data.subreddit_name_prefixed,
                created: new Date(postTime).toISOString(),
                author: child.data.author,
            });
        }

        // Stop if we have enough or no more pages
        after = json?.data?.after;
        if (!after || allPosts.length >= 100) break;

        // Delay between paginated requests to avoid rate limiting
        if (page < maxPages - 1 && after) {
            await new Promise((r) => setTimeout(r, 1500));
        }
    }

    return allPosts.sort((a, b) => b.upvotes - a.upvotes).slice(0, 100);
}

/**
 * Fetch details (comments) for a specific Reddit post.
 */
export async function getPostDetails(permalink: string): Promise<string> {
    try {
        const cleanPermalink = permalink.endsWith('/') ? permalink.slice(0, -1) : permalink;
        const url = `${REDDIT_API_BASE}${cleanPermalink}.json?raw_json=1`;

        console.log(`Fetching comments from: ${url}`);

        const res = await fetchWithRetry(
            url,
            {
                method: 'GET',
                headers: {
                    'User-Agent': USER_AGENT,
                    Accept: 'application/json',
                },
                cache: 'no-store',
            },
            2, // fewer retries for comments — non-critical
        );

        const data = await res.json();

        if (!data || !Array.isArray(data) || data.length < 2) {
            return '';
        }

        const commentsData = data[1]?.data?.children;
        if (!commentsData) return '';

        const comments: string[] = [];
        for (const child of commentsData) {
            if (child.kind === 't1' && child.data) {
                const body = child.data.body;
                if (body && body !== '[deleted]' && body !== '[removed]') {
                    comments.push(body);
                }
            }
            if (comments.length >= 10) break;
        }

        return comments.join('\n\n');
    } catch (error) {
        console.error(
            `Error fetching details for ${permalink}:`,
            error instanceof Error ? error.message : String(error),
        );
        return '';
    }
}
