
import { VideoScripts, ContentIdea } from '@/types';
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
 * Safely parses JSON from AI response by stripping markdown fences and surrounding text.
 * Falls back to a default value on failure.
 */
function safeParseJSON<T>(content: string, fallback: T): T {
    try {
        // Strip markdown fences
        let cleaned = content.replace(/```(?:json)?|```/g, '');

        // Find first '{' or '['
        const firstOpen = cleaned.search(/[{[]/);
        // Find last '}' or ']'
        const lastClose = cleaned.search(/[}\]][^}\]]*$/);

        if (firstOpen !== -1 && lastClose !== -1) {
            cleaned = cleaned.substring(firstOpen, lastClose + 1);
        }

        return JSON.parse(cleaned) as T;
    } catch (error) {
        console.warn('Failed to parse AI JSON response. Raw content:', content);
        return fallback;
    }
}

/**
 * Sanitizes post content to prevent prompt injection attacks.
 * Removes common injection patterns and special tokens.
 */
function sanitizePostContent(text: string): string {
    if (!text) return '';

    // Patterns to remove
    const patterns = [
        /ignore previous instructions/gi,
        /you are now/gi,
        /system prompt/gi,
        /new instructions/gi,
        /disregard the/gi,
        /act as/gi,
        /\[INST\]/gi,
        /\[\/INST\]/gi,
        /<<SYS>>/gi,
        /<<\/SYS>>/gi
    ];

    let sanitized = text;
    for (const pattern of patterns) {
        sanitized = sanitized.replace(pattern, '');
    }

    return sanitized.trim();
}

async function callGroq(
    messages: { role: string; content: string }[],
    temperature: number = 0.7,
    apiKeyOverride?: string,
): Promise<{ content: string; rateLimit: RateLimitInfo }> {
    const apiKey = apiKeyOverride || process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('Missing GROQ_API_KEY');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s timeout

    try {
        const res = await fetch(GROQ_API_URL, {
            method: 'POST',
            cache: 'no-store',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages,
                temperature,
                response_format: { type: 'json_object' } // Enforce JSON mode
            }),
        });

        // Extract rate limit headers
        const rateLimit: RateLimitInfo = {
            remaining: parseInt(res.headers.get('x-ratelimit-remaining-requests') || '0', 10),
            limit: parseInt(res.headers.get('x-ratelimit-limit-requests') || '30', 10),
            resetInSeconds: parseInt(res.headers.get('x-ratelimit-reset-requests') || '60', 10),
        };

        if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`Groq API error ${res.status}: ${errBody}`);
        }

        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || '';

        return { content, rateLimit };
    } finally {
        clearTimeout(timeoutId);
    }
}

export async function generateSearchQueries(
    userQuery: string,
    apiKeyOverride?: string
): Promise<{ queries: string[]; rateLimit: RateLimitInfo }> {
    const prompt = `
You are a Reddit Search Expert. Translate this query into 3 boolean search queries.
User Query: "${sanitizePostContent(userQuery)}"

Output JSON format:
{
  "queries": [
    "Broad query with OR",
    "Specific field target query",
    "Problem solving query"
  ]
}
`;

    const { content, rateLimit } = await callGroq(
        [
            { role: 'system', content: 'You are a Reddit Search Expert.' },
            { role: 'user', content: prompt },
        ],
        0.5,
        apiKeyOverride
    );

    const parsed = safeParseJSON(content, { queries: [userQuery] });
    // @ts-ignore
    const queries = Array.isArray(parsed?.queries) ? parsed.queries : [userQuery];

    return { queries: queries.slice(0, 3), rateLimit };
}

export async function filterPostsByContext(
    posts: any[],
    userQuery: string,
    apiKeyOverride?: string
): Promise<{ filteredPosts: any[]; rateLimit: RateLimitInfo }> {
    // 1. Sanitize Inputs
    const cleanQuery = sanitizePostContent(userQuery);

    // 2. Prepare Batches (10 posts per batch)
    const BATCH_SIZE = 10;
    const batches = [];
    for (let i = 0; i < posts.length; i += BATCH_SIZE) {
        batches.push(posts.slice(i, i + BATCH_SIZE));
    }

    // 3. Process Batches in Parallel (All Settled)
    const results = await Promise.allSettled(
        batches.map(async (batch) => {
            const simplifiedPosts = batch.map((p: any) => ({
                id: p.id,
                title: sanitizePostContent(p.title),
                subreddit: p.subreddit,
                snippet: sanitizePostContent(p.snippet || '')
            }));

            const prompt = `
You are a Viral Content Strategist. Rate posts 0-10 on Viral Potential & Relevance.
Query: "${cleanQuery}"

JSON Output: { "post_id": score }
Posts:
${JSON.stringify(simplifiedPosts)}
`;

            const { content } = await callGroq(
                [
                    { role: 'system', content: 'You are a Viral Content Strategist.' },
                    { role: 'user', content: prompt },
                ],
                0.3,
                apiKeyOverride
            );

            return safeParseJSON(content, {});
        })
    );

    // 4. Aggregate Scores
    let allScores: Record<string, number> = {};
    let lastRateLimit: RateLimitInfo = { remaining: 0, limit: 0, resetInSeconds: 0 };

    results.forEach((result, batchIndex) => {
        if (result.status === 'fulfilled') {
            Object.assign(allScores, result.value);
        } else {
            console.error(`Batch ${batchIndex} failed:`, result.reason);
            // Fallback score 5 for failed batch
            const batchPosts = batches[batchIndex];
            batchPosts.forEach((p: any) => {
                allScores[p.id] = 5;
            });
        }
    });

    // 5. Apply Scores
    const scoredPosts = posts.map((p) => ({
        ...p,
        relevanceScore: allScores[p.id] || 0
    }));

    return { filteredPosts: scoredPosts, rateLimit: lastRateLimit };
}
