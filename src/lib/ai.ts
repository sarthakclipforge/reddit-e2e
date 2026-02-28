import { ContentIdea, RedditPost, VideoScripts } from '@/types';
import {
    DEFAULT_HOOKS_PROMPT,
    DEFAULT_IDEAS_PROMPT,
    DEFAULT_SCRIPTS_PROMPT,
} from '@/lib/promptStore';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_RATE_LIMIT: RateLimitInfo = { remaining: 0, limit: 0, resetInSeconds: 0 };

type GroqMessage = { role: 'system' | 'user' | 'assistant'; content: string };

interface GroqResponse {
    choices?: Array<{
        message?: {
            content?: string;
        };
    }>;
}

class GroqHttpError extends Error {
    status: number;
    body: string;

    constructor(status: number, body: string) {
        super(`Groq API error ${status}: ${body}`);
        this.status = status;
        this.body = body;
    }
}

export interface RateLimitInfo {
    remaining: number;
    limit: number;
    resetInSeconds: number;
}

function safeParseJSON<T>(content: string, fallback: T): T {
    try {
        let cleaned = content.replace(/```(?:json)?|```/g, '');
        const firstOpen = cleaned.search(/[{[]/);
        const lastClose = cleaned.search(/[}\]][^}\]]*$/);

        if (firstOpen !== -1 && lastClose !== -1) {
            cleaned = cleaned.substring(firstOpen, lastClose + 1);
        }

        return JSON.parse(cleaned) as T;
    } catch {
        console.warn('Failed to parse AI JSON response. Raw content:', content);
        return fallback;
    }
}

function sanitizePostContent(text: string): string {
    if (!text) return '';

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
        /<<\/SYS>>/gi,
    ];

    let sanitized = text;
    for (const pattern of patterns) {
        sanitized = sanitized.replace(pattern, '');
    }

    return sanitized.trim();
}

function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
}

function normalizeContentIdeas(value: unknown): ContentIdea[] {
    const record = asRecord(value);
    const candidate = Array.isArray(value) ? value : Array.isArray(record.ideas) ? record.ideas : [];

    return candidate
        .map((item) => {
            const obj = asRecord(item);
            const hook = typeof obj.hook === 'string' ? obj.hook.trim() : '';
            const concept = typeof obj.concept === 'string' ? obj.concept.trim() : '';
            const why = typeof obj.why === 'string' ? obj.why.trim() : '';
            const cta = typeof obj.cta === 'string' ? obj.cta.trim() : '';
            const hooks = asStringArray(obj.hooks);

            if (!hook || !concept) return null;
            return { hook, concept, why, cta, hooks };
        })
        .filter((idea): idea is ContentIdea => idea !== null);
}

function applyPromptTemplate(template: string, values: Record<string, string>): string {
    return Object.entries(values).reduce(
        (result, [key, value]) => result.replaceAll(`{{${key}}}`, value),
        template
    );
}

function parseRateLimitHeader(value: string | null, fallback: number): number {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isInvalidGroqApiKeyError(error: unknown): boolean {
    if (!(error instanceof GroqHttpError)) return false;
    if (error.status !== 401) return false;
    const body = error.body.toLowerCase();
    return body.includes('invalid_api_key') || body.includes('invalid api key');
}

async function callGroq(
    messages: GroqMessage[],
    temperature = 0.7,
    apiKeyOverride?: string
): Promise<{ content: string; rateLimit: RateLimitInfo }> {
    const envApiKey = process.env.GROQ_API_KEY;
    const primaryApiKey = apiKeyOverride || envApiKey;
    if (!primaryApiKey) throw new Error('Missing GROQ_API_KEY');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    const runWithKey = async (apiKey: string): Promise<{ content: string; rateLimit: RateLimitInfo }> => {
        const res = await fetch(GROQ_API_URL, {
            method: 'POST',
            cache: 'no-store',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages,
                temperature,
                response_format: { type: 'json_object' },
            }),
        });

        const rateLimit: RateLimitInfo = {
            remaining: parseRateLimitHeader(res.headers.get('x-ratelimit-remaining-requests'), 0),
            limit: parseRateLimitHeader(res.headers.get('x-ratelimit-limit-requests'), 30),
            resetInSeconds: parseRateLimitHeader(res.headers.get('x-ratelimit-reset-requests'), 60),
        };

        if (!res.ok) {
            const errBody = await res.text();
            throw new GroqHttpError(res.status, errBody);
        }

        const data = (await res.json()) as GroqResponse;
        const content = data.choices?.[0]?.message?.content ?? '';
        return { content, rateLimit };
    };

    try {
        try {
            return await runWithKey(primaryApiKey);
        } catch (error: unknown) {
            const canFallbackToEnvKey =
                Boolean(apiKeyOverride) &&
                Boolean(envApiKey) &&
                envApiKey !== apiKeyOverride &&
                isInvalidGroqApiKeyError(error);

            if (canFallbackToEnvKey && envApiKey) {
                console.warn('Client-provided GROQ key rejected; retrying with server GROQ key.');
                return await runWithKey(envApiKey);
            }
            throw error;
        }
    } catch (error: unknown) {
        throw new Error(getErrorMessage(error));
    } finally {
        clearTimeout(timeoutId);
    }
}

export async function generateSearchQueries(
    userQuery: string,
    apiKeyOverride?: string
): Promise<{ queries: string[]; rateLimit: RateLimitInfo }> {
    const fallbackQuery = sanitizePostContent(userQuery) || userQuery;
    const prompt = `
You are a Reddit Search Expert. Translate this query into 3 boolean search queries.
User Query: "${fallbackQuery}"

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

    const parsed = safeParseJSON<{ queries?: unknown }>(content, { queries: [fallbackQuery] });
    const queries = asStringArray(parsed.queries);
    const finalQueries = queries.length > 0 ? queries : [fallbackQuery];

    return { queries: finalQueries.slice(0, 3), rateLimit };
}

export async function generateContentIdeas(
    subreddit: string,
    discussions: string[],
    ideasPrompt?: string,
    apiKeyOverride?: string
): Promise<{ ideas: ContentIdea[]; rateLimit: RateLimitInfo }> {
    const promptTemplate = ideasPrompt || DEFAULT_IDEAS_PROMPT;
    const prompt = applyPromptTemplate(promptTemplate, {
        SUBREDDIT: sanitizePostContent(subreddit),
        DISCUSSIONS: discussions.map((d) => sanitizePostContent(d)).join('\n\n---\n\n'),
    });

    const { content, rateLimit } = await callGroq(
        [
            { role: 'system', content: 'You generate short-form video content ideas from Reddit discussions.' },
            { role: 'user', content: prompt },
        ],
        0.6,
        apiKeyOverride
    );

    const parsed = safeParseJSON<unknown>(content, []);
    const ideas = normalizeContentIdeas(parsed);

    return { ideas: ideas.slice(0, 5), rateLimit };
}

export async function generateViralHooks(
    discussions: string[],
    hooksPrompt?: string,
    apiKeyOverride?: string
): Promise<{ hooks: string[]; rateLimit: RateLimitInfo }> {
    const promptTemplate = hooksPrompt || DEFAULT_HOOKS_PROMPT;
    const prompt = applyPromptTemplate(promptTemplate, {
        DISCUSSIONS: discussions.map((d) => sanitizePostContent(d)).join('\n\n---\n\n'),
    });

    const { content, rateLimit } = await callGroq(
        [
            { role: 'system', content: 'You write high-retention social video hooks.' },
            { role: 'user', content: prompt },
        ],
        0.7,
        apiKeyOverride
    );

    const parsed = safeParseJSON<{ hooks?: unknown } | unknown[]>(content, []);
    const candidate = Array.isArray(parsed) ? parsed : parsed.hooks;
    const hooks = asStringArray(candidate).slice(0, 10);

    return { hooks, rateLimit };
}

export async function generateVideoScripts(
    hook: string,
    concept: string,
    scriptsPrompt?: string,
    apiKeyOverride?: string
): Promise<{ scripts: VideoScripts; rateLimit: RateLimitInfo }> {
    const promptTemplate = scriptsPrompt || DEFAULT_SCRIPTS_PROMPT;
    const prompt = applyPromptTemplate(promptTemplate, {
        HOOK: sanitizePostContent(hook),
        CONCEPT: sanitizePostContent(concept),
    });

    const { content, rateLimit } = await callGroq(
        [
            { role: 'system', content: 'You write short-form scripts optimized for retention.' },
            { role: 'user', content: prompt },
        ],
        0.7,
        apiKeyOverride
    );

    const parsed = safeParseJSON<Record<string, unknown>>(content, {});
    const scripts: VideoScripts = {
        variation1:
            typeof parsed.variation1 === 'string' && parsed.variation1.trim().length > 0
                ? parsed.variation1
                : '',
        variation2:
            typeof parsed.variation2 === 'string' && parsed.variation2.trim().length > 0
                ? parsed.variation2
                : '',
    };

    return { scripts, rateLimit };
}

export async function filterPostsByContext(
    posts: RedditPost[],
    userQuery: string,
    apiKeyOverride?: string
): Promise<{ filteredPosts: RedditPost[]; rateLimit: RateLimitInfo }> {
    const cleanQuery = sanitizePostContent(userQuery);
    const batchSize = 10;
    const batches: RedditPost[][] = [];

    for (let i = 0; i < posts.length; i += batchSize) {
        batches.push(posts.slice(i, i + batchSize));
    }

    let latestRateLimit = DEFAULT_RATE_LIMIT;
    const scoreMap: Record<string, number> = {};

    const results = await Promise.allSettled(
        batches.map(async (batch) => {
            const simplifiedPosts = batch.map((post) => ({
                id: post.id,
                title: sanitizePostContent(post.title),
                subreddit: sanitizePostContent(post.subreddit),
                snippet: sanitizePostContent(post.selftext ?? ''),
            }));

            const prompt = `
You are a Viral Content Strategist. Rate posts from 0-10 for relevance to this query.
Query: "${cleanQuery}"

Return JSON as: { "post_id": score }
Posts:
${JSON.stringify(simplifiedPosts)}
`;

            const { content, rateLimit } = await callGroq(
                [
                    { role: 'system', content: 'You evaluate content relevance and viral potential.' },
                    { role: 'user', content: prompt },
                ],
                0.3,
                apiKeyOverride
            );

            const rawScores = safeParseJSON<Record<string, unknown>>(content, {});
            const parsedScores: Record<string, number> = {};
            for (const [id, value] of Object.entries(rawScores)) {
                const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value));
                if (Number.isFinite(numeric)) {
                    parsedScores[id] = Math.max(0, Math.min(10, numeric));
                }
            }

            return { parsedScores, rateLimit };
        })
    );

    results.forEach((result, batchIndex) => {
        if (result.status === 'fulfilled') {
            Object.assign(scoreMap, result.value.parsedScores);
            latestRateLimit = result.value.rateLimit;
            return;
        }

        console.error(`Context scoring batch ${batchIndex} failed: ${getErrorMessage(result.reason)}`);
        for (const post of batches[batchIndex]) {
            scoreMap[post.id] = 5;
        }
    });

    const filteredPosts = posts.map((post) => ({
        ...post,
        relevanceScore: scoreMap[post.id] ?? 0,
    }));

    return { filteredPosts, rateLimit: latestRateLimit };
}
