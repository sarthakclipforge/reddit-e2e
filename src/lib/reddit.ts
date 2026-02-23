/**
 * Reddit API helper — fetches posts using Reddit's public JSON endpoints.
 *
 * Changes vs. previous version:
 *  - Adaptive pagination: after page 1, stops early if yieldRate (surviving/raw) <= 0.7
 *  - Dead-on-arrival filter: drops posts with upvotes < 5 AND comments < 3 immediately on ingest
 *  - Default sort = 'top', default t = 'week' — pre-validates engagement on Reddit's side
 *  - Removed custom '15d' post-filter; any valid Reddit `t` param is accepted as-is
 *    (sub-day granularity is not supported by Reddit's API)
 */

import { RedditPost } from '@/types';

const REDDIT_API_BASE = 'https://www.reddit.com';

// Browser-like User-Agent to avoid immediate blocking
const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
        upvote_ratio?: number;
    };
}

interface RedditApiResponse {
    data: {
        children: RedditApiChild[];
        after: string | null;
    };
}

/**
 * Fetch a URL with retry logic, exponential backoff, and timeouts.
 */
async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

        try {
            const res = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeoutId);

            if (res.ok) return res;

            if ((res.status === 429 || res.status >= 500) && attempt < maxRetries - 1) {
                const delay = Math.pow(2, attempt) * 1500;
                console.warn(`Reddit returned ${res.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
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

            if (attempt === maxRetries - 1) throw err;
            await new Promise((r) => setTimeout(r, 2000));
        }
    }
    throw new Error('Failed to fetch after retries');
}

/**
 * Dead-on-arrival guard: discard posts with negligible traction immediately on ingest,
 * before they ever enter the working set or the AI pipeline.
 */
function isAlive(child: RedditApiChild): boolean {
    return !(child.data.score < 5 && child.data.num_comments < 3);
}

/**
 * Fetch Reddit posts for a given query and sort type.
 *
 * Defaults: sort = 'top', time = 'week' — this pre-validates engagement on Reddit's side.
 * Any valid Reddit `t` param is accepted (hour, day, week, month, year, all).
 * Sub-day granularity (e.g. '15d') is not supported by the Reddit API.
 *
 * Adaptive pagination: fetches page 1 unconditionally. For subsequent pages,
 * checks yieldRate = (survivors so far / raw posts fetched so far). If yieldRate <= 0.7,
 * the query is not yielding enough quality posts and further pagination is stopped.
 * Hard cap: 4 pages.
 */
export async function fetchRedditPosts(
    keywords: string,
    sort: 'top' | 'hot' = 'top',  // Default changed from caller-required to 'top'
    time: string = 'week'          // Default changed to 'week' for engagement pre-validation
): Promise<RedditPost[]> {
    const allPosts: RedditPost[] = [];
    let after: string | null = null;
    let totalRawFetched = 0; // Count of all raw posts seen (including DOA)

    const maxPages = 4;

    for (let page = 0; page < maxPages; page++) {
        const params = new URLSearchParams({
            q: keywords,
            limit: '100',
            sort,
            t: time,
            type: 'link',
            raw_json: '1',
        });

        if (after) params.set('after', after);

        const url = `${REDDIT_API_BASE}/search.json?${params.toString()}`;

        try {
            const res = await fetchWithRetry(url, {
                method: 'GET',
                headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
                cache: 'no-store',
            });

            const json = (await res.json()) as RedditApiResponse;
            const children = json?.data?.children || [];

            if (children.length === 0) break;

            totalRawFetched += children.length;

            // Ingest with dead-on-arrival filter applied immediately
            for (const child of children) {
                if (!isAlive(child)) continue; // Drop low-signal posts before accumulating

                allPosts.push({
                    id: child.data.id,
                    title: child.data.title,
                    upvotes: child.data.score,
                    comments: child.data.num_comments,
                    link: `https://www.reddit.com${child.data.permalink}`,
                    subreddit: child.data.subreddit_name_prefixed,
                    created: new Date(child.data.created_utc * 1000).toISOString(),
                    author: child.data.author,
                    // Store upvote_ratio for engagement scoring in useContextSearch
                    upvoteRatio: child.data.upvote_ratio ?? 0.8,
                });
            }

            after = json?.data?.after;

            // Adaptive early stop: after page 1, check yieldRate
            if (page > 0 && totalRawFetched > 0) {
                const yieldRate = allPosts.length / totalRawFetched;
                if (yieldRate <= 0.7) {
                    // Low signal density — further pages won't improve quality
                    console.info(`[reddit] Stopped at page ${page + 1}: yieldRate=${yieldRate.toFixed(2)} <= 0.7`);
                    break;
                }
            }

            if (!after || allPosts.length >= 100) break;

            // Delay between paginated requests to respect rate limits
            if (page < maxPages - 1 && after) {
                await new Promise((r) => setTimeout(r, 1500));
            }
        } catch (error) {
            console.error('Error fetching Reddit page:', error);
            break; // Return what we have so far
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

        const res = await fetchWithRetry(
            url,
            {
                method: 'GET',
                headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
                cache: 'no-store',
            },
            2
        );

        const data = await res.json();

        if (!data || !Array.isArray(data) || data.length < 2) return '';

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
        console.error(`Error fetching details for ${permalink}:`, error);
        return '';
    }
}

/**
 * Browser-side search using a CORS proxy to bypass IP blocks.
 * Usage: Client-side only ("Context Mode").
 * Same adaptive defaults as fetchRedditPosts: sort='top', time='week'.
 */
export async function searchRedditBrowser(
    query: string,
    sort: 'top' | 'hot' = 'top',
    time: string = 'week'
): Promise<RedditPost[]> {
    const params = new URLSearchParams({
        q: query,
        limit: '100',
        sort,
        t: time,
        type: 'link',
        raw_json: '1',
    });

    const targetUrl = `${REDDIT_API_BASE}/search.json?${params.toString()}`;
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;

    try {
        const res = await fetch(proxyUrl, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            cache: 'no-store',
        });

        if (!res.ok) throw new Error(`Proxy error: ${res.status}`);

        const json = await res.json() as RedditApiResponse;
        const children = json?.data?.children || [];

        return children
            .filter(isAlive) // Apply the same dead-on-arrival filter client-side
            .map(child => ({
                id: child.data.id,
                title: child.data.title,
                upvotes: child.data.score,
                comments: child.data.num_comments,
                link: `https://www.reddit.com${child.data.permalink}`,
                subreddit: child.data.subreddit_name_prefixed,
                created: new Date(child.data.created_utc * 1000).toISOString(),
                author: child.data.author,
                upvoteRatio: child.data.upvote_ratio ?? 0.8,
            }));
    } catch (error) {
        console.error('Browser search failed:', error);
        return [];
    }
}
