import { ContentIdea, VideoScripts } from '@/types';
import {
    DEFAULT_IDEAS_PROMPT,
    DEFAULT_HOOKS_PROMPT,
    DEFAULT_SCRIPTS_PROMPT,
} from '@/lib/promptStore';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

export interface RateLimitInfo {
    remaining: number;
    limit: number;
    resetInSeconds: number;
}

/**
 * Helper to extract JSON from AI response, handling markdown code blocks.
 */
function extractJSON(content: string): unknown | null {
    // Try direct parse first
    try {
        return JSON.parse(content);
    } catch {
        // noop — fall through to code-block extraction
    }

    // Try extracting from markdown code blocks (```json ... ``` or ``` ... ```)
    const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (codeBlockMatch && codeBlockMatch[1]) {
        try {
            return JSON.parse(codeBlockMatch[1].trim());
        } catch {
            // noop
        }
    }

    // Try matching a JSON object { ... }
    const objMatch = content.match(/\{[\s\S]*\}/);
    if (objMatch) {
        try {
            return JSON.parse(objMatch[0]);
        } catch {
            // noop
        }
    }

    // Try matching a JSON array [ ... ]
    const arrMatch = content.match(/\[[\s\S]*\]/);
    if (arrMatch) {
        try {
            return JSON.parse(arrMatch[0]);
        } catch {
            // noop
        }
    }

    return null;
}

/**
 * Parse Groq duration strings like "2m52.8s", "190ms", "58s" into seconds.
 */
function parseDuration(dur: string): number {
    let totalSeconds = 0;
    const minMatch = dur.match(/(\d+(?:\.\d+)?)m(?!s)/);
    const secMatch = dur.match(/(\d+(?:\.\d+)?)s(?!.*m)/);
    const msMatch = dur.match(/(\d+(?:\.\d+)?)ms/);
    const secWithMin = dur.match(/(\d+(?:\.\d+)?)m(\d+(?:\.\d+)?)s/);

    if (secWithMin) {
        totalSeconds = parseFloat(secWithMin[1]) * 60 + parseFloat(secWithMin[2]);
    } else {
        if (minMatch) totalSeconds += parseFloat(minMatch[1]) * 60;
        if (secMatch) totalSeconds += parseFloat(secMatch[1]);
    }
    if (msMatch && !secMatch && !minMatch && !secWithMin) {
        totalSeconds += parseFloat(msMatch[1]) / 1000;
    }

    // Fallback: if nothing matched, try plain number
    if (totalSeconds === 0 && dur) {
        const plain = parseFloat(dur);
        if (!isNaN(plain)) totalSeconds = plain;
    }
    return totalSeconds || 60;
}

/**
 * Calls Groq API directly via fetch so we can capture rate limit headers.
 */
async function callGroq(
    messages: { role: string; content: string }[],
    temperature: number = 0.7,
    apiKeyOverride?: string,
): Promise<{ content: string; rateLimit: RateLimitInfo }> {
    const apiKey = apiKeyOverride || process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('Missing GROQ_API_KEY — add one in Settings or set GROQ_API_KEY env var');

    const res = await fetch(GROQ_API_URL, {
        method: 'POST',
        cache: 'no-store',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages,
            temperature,
        }),
    });

    // Extract rate limit headers
    const resetRaw = res.headers.get('x-ratelimit-reset-requests') || '60';
    const rateLimit: RateLimitInfo = {
        remaining: parseInt(res.headers.get('x-ratelimit-remaining-requests') || '0', 10),
        limit: parseInt(res.headers.get('x-ratelimit-limit-requests') || '30', 10),
        resetInSeconds: parseDuration(resetRaw),
    };

    if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Groq API error ${res.status}: ${errBody}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';

    return { content, rateLimit };
}

export async function generateContentIdeas(
    topic: string,
    discussions: string[],
    customPrompt?: string,
    apiKeyOverride?: string,
): Promise<{ ideas: ContentIdea[]; rateLimit: RateLimitInfo }> {
    const template = customPrompt || DEFAULT_IDEAS_PROMPT;
    const prompt = template
        .replace('{{SUBREDDIT}}', topic)
        .replace('{{DISCUSSIONS}}', discussions.join('\n\n---\n\n').substring(0, 15000));

    const { content, rateLimit } = await callGroq(
        [
            { role: 'system', content: 'You are a helpful content strategist assistant.' },
            { role: 'user', content: prompt },
        ],
        0.7,
        apiKeyOverride,
    );

    const parsed = extractJSON(content);
    const ideas = Array.isArray(parsed) ? (parsed as ContentIdea[]) : [];
    return { ideas, rateLimit };
}

export async function generateViralHooks(
    discussions: string[],
    customPrompt?: string,
    apiKeyOverride?: string,
): Promise<{ hooks: string[]; rateLimit: RateLimitInfo }> {
    const template = customPrompt || DEFAULT_HOOKS_PROMPT;
    const prompt = template
        .replace('{{DISCUSSIONS}}', discussions.join('\n\n---\n\n').substring(0, 15000));

    const { content, rateLimit } = await callGroq(
        [
            { role: 'system', content: 'You are an expert viral hook writer for short-form content.' },
            { role: 'user', content: prompt },
        ],
        0.8,
        apiKeyOverride,
    );

    const parsed = extractJSON(content);
    const hooks = Array.isArray(parsed) ? parsed.map((h: unknown) => String(h)) : [];
    return { hooks, rateLimit };
}

export async function generateVideoScripts(
    hook: string,
    concept: string,
    customPrompt?: string,
    apiKeyOverride?: string,
): Promise<{ scripts: VideoScripts; rateLimit: RateLimitInfo }> {
    const template = customPrompt || DEFAULT_SCRIPTS_PROMPT;
    const prompt = template
        .replace('{{HOOK}}', hook)
        .replace('{{CONCEPT}}', concept);

    const { content, rateLimit } = await callGroq(
        [
            { role: 'system', content: 'You are an expert short-form scriptwriter for viral video content.' },
            { role: 'user', content: prompt },
        ],
        0.8,
        apiKeyOverride,
    );

    const parsed = extractJSON(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, string>;
        return {
            scripts: { variation1: obj.variation1 || '', variation2: obj.variation2 || '' },
            rateLimit,
        };
    }

    // Last resort: split raw text by variation headers
    const v1Match = content.match(/###?\s*Variation\s*1[^\n]*\n([\s\S]*?)(?=###?\s*Variation\s*2|$)/i);
    const v2Match = content.match(/###?\s*Variation\s*2[^\n]*\n([\s\S]*?)$/i);
    return {
        scripts: {
            variation1: v1Match ? v1Match[1].trim() : content,
            variation2: v2Match ? v2Match[1].trim() : '',
        },
        rateLimit,
    };
}

/**
 * Context Mode: Step 1 - Intent Analysis
 * Generates 3 boolean search queries from a user's natural language input.
 */
export async function generateSearchQueries(
    userQuery: string,
    apiKeyOverride?: string
): Promise<{ queries: string[]; rateLimit: RateLimitInfo }> {
    const prompt = `
You are a Reddit Search Expert. Your goal is to translate a user's natural language query into 3 specific boolean search queries for Reddit's search engine.

User Query: "${userQuery}"

Rules:
1. Reddit supports boolean operators: AND, OR, NOT, ( ).
2. Field targeting: title:keyword, selftext:keyword, subreddit:name.
3. Generate exactly 3 queries:
   - Query 1 (Broad): Captures the core topic with OR synonyms.
   - Query 2 (Specific): Uses field targeting (title:) to find high-signal posts.
   - Query 3 (Problem-Solving): Targets specific subreddits or "how to" intent.

Return ONLY a JSON array of strings. No markdown, no explanations.
Example: ["(laptop OR computer) AND overheat", "title:overheating subreddit:techsupport", "selftext:temperature"]
`;

    const { content, rateLimit } = await callGroq(
        [
            { role: 'system', content: 'You are a Reddit Search Expert.' },
            { role: 'user', content: prompt },
        ],
        0.5, // Lower temperature for consistent formatting
        apiKeyOverride
    );

    const parsed = extractJSON(content);
    const queries = Array.isArray(parsed) ? (parsed as string[]) : [userQuery];
    return { queries: queries.slice(0, 3), rateLimit };
}

/**
 * Context Mode: Step 3 — Semantic Filtering (Single Batched Call)
 *
 * Changes vs. previous version:
 *  - One Groq call for ALL posts (was one call per post)
 *  - Compact payload: title-only for long titles, title+150-char snippet for short/question titles
 *  - Compact JSON response: [{i, s}] array (was full key-value object)
 *  - Score distribution instruction embedded in prompt
 *  - Drop threshold lowered to 4 (was 6)
 *  - localStorage cache per postId+intentHash with 1-hour TTL; cache hits skip the AI payload
 *  - Graceful fallback: if Groq call fails, returns posts as-is sorted by engagementScore
 */

// ---------- helpers ----------

/** djb2-style short hash of a string — no external dep needed */
function shortHash(str: string): string {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
    return (h >>> 0).toString(36).slice(0, 6);
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry { score: number; ts: number }

function cacheKey(postId: string, intentHash: string): string {
    return `rs:${postId}:${intentHash}`;
}

function readCache(key: string): number | null {
    if (typeof localStorage === 'undefined') return null;
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const entry: CacheEntry = JSON.parse(raw);
        if (Date.now() - entry.ts > CACHE_TTL_MS) { localStorage.removeItem(key); return null; }
        return entry.score;
    } catch { return null; }
}

function writeCache(key: string, score: number): void {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(key, JSON.stringify({ score, ts: Date.now() } satisfies CacheEntry)); } catch { /* quota exceeded — ignore */ }
}

// ---------- main export ----------

export async function filterPostsByContext(
    posts: any[],
    userQuery: string,
    apiKeyOverride?: string
): Promise<{ filteredPosts: any[]; rateLimit: RateLimitInfo }> {

    const intentHash = shortHash(userQuery.toLowerCase().trim());

    // ---- Resolve cache hits ----
    // Each post is checked independently; hits are excluded from the AI payload.
    const cachedScores: Map<number, number> = new Map();
    const uncachedPosts: { index: number; post: any }[] = [];

    for (let i = 0; i < posts.length; i++) {
        const key = cacheKey(posts[i].id ?? String(i), intentHash);
        const cached = readCache(key);
        if (cached !== null) {
            cachedScores.set(i, cached);
        } else {
            uncachedPosts.push({ index: i, post: posts[i] });
        }
    }

    // Dummy rate limit for the all-cache-hit path
    const noopRateLimit: RateLimitInfo = { remaining: 0, limit: 0, resetInSeconds: 0 };

    // If every post was a cache hit, skip the Groq call entirely
    if (uncachedPosts.length === 0) {
        return buildResult(posts, cachedScores, new Map(), noopRateLimit);
    }

    // ---- Build compact AI payload ----
    // Rule: if title has > 8 words AND does not end with '?', send title only.
    // Otherwise, send "title — snippet[:150]".
    const payloadLines = uncachedPosts.map(({ index, post }, payloadIdx) => {
        const words = (post.title || '').split(/\s+/).filter(Boolean);
        const isQuestion = (post.title || '').trimEnd().endsWith('?');
        const titleOnly = words.length > 8 && !isQuestion;
        const text = titleOnly
            ? post.title
            : `${post.title}${post.selftext ? ` — ${String(post.selftext).slice(0, 150)}` : ''}`;
        return `${payloadIdx}. ${text}`;
    });

    const prompt =
        `You are a relevance scoring engine. Rate each Reddit post for the query below.

Query: "${userQuery}"

Posts:
${payloadLines.join('\n')}

Rules:
- Score 0-10. Distribute scores realistically: ~20% above 7, ~50% between 3-7, ~30% below 3.
- Return ONLY a compact JSON array. No text, no markdown.
- Format: [{"i":0,"s":7},{"i":1,"s":3}] where i = index, s = score.`;

    let rateLimit: RateLimitInfo = noopRateLimit;
    const aiScores: Map<number, number> = new Map(); // payloadIdx → score

    try {
        const result = await callGroq(
            [
                { role: 'system', content: 'You are a compact relevance scoring engine. Return only JSON.' },
                { role: 'user', content: prompt },
            ],
            0.2, // Very low temperature for deterministic scoring
            apiKeyOverride
        );
        rateLimit = result.rateLimit;

        const parsed = extractJSON(result.content) as Array<{ i: number; s: number }>;
        if (Array.isArray(parsed)) {
            for (const entry of parsed) {
                if (typeof entry.i === 'number' && typeof entry.s === 'number') {
                    aiScores.set(entry.i, entry.s);
                }
            }
        }

        // Persist new scores to localStorage
        for (const [payloadIdx, score] of aiScores) {
            const post = uncachedPosts[payloadIdx]?.post;
            if (post) {
                const key = cacheKey(post.id ?? String(uncachedPosts[payloadIdx].index), intentHash);
                writeCache(key, score);
            }
        }
    } catch (err) {
        // Graceful fallback: AI call failed — return posts sorted by engagementScore only
        console.error('[filterPostsByContext] Groq call failed, falling back to engagement ranking:', err);
        const fallback = [...posts].sort((a, b) => (b.engagementScore ?? 0) - (a.engagementScore ?? 0));
        return { filteredPosts: fallback, rateLimit: noopRateLimit };
    }

    return buildResult(posts, cachedScores, aiScores, rateLimit);

    // ---- local helper: merge scores and apply threshold ----
    function buildResult(
        allPosts: any[],
        cached: Map<number, number>,
        fromAI: Map<number, number>,
        rl: RateLimitInfo
    ): { filteredPosts: any[]; rateLimit: RateLimitInfo } {
        const scored = allPosts.map((p, i) => {
            // Look up in cache first, then in fresh AI scores (keyed by payloadIdx)
            const payloadIdx = uncachedPosts.findIndex(u => u.index === i);
            const relevance = cached.get(i) ?? fromAI.get(payloadIdx) ?? null;

            // If a post was neither cached nor in the AI payload (excluded by smart pre-filter upstream),
            // it should not appear in final results — mark as excluded.
            return { ...p, relevanceScore: relevance };
        });

        const filtered = scored
            .filter(p => p.relevanceScore !== null && p.relevanceScore >= 4) // new cutoff: 4 (was 6)
            .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));

        return { filteredPosts: filtered, rateLimit: rl };
    }
}
