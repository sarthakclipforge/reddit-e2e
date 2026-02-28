
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
        // First try standard parsing
        return JSON.parse(content) as T;
    } catch {
        try {
            // Strip markdown fences
            let cleaned = content.replace(/```(?:json)?\n?/gi, '').replace(/```/g, '');

            // Fallback strategy: Find the FIRST '{' or '[' AND the LAST '}' or ']'
            const firstOpenObj = cleaned.indexOf('{');
            const firstOpenArr = cleaned.indexOf('[');

            // Determine which comes first (ignoring -1)
            let firstOpen = -1;
            if (firstOpenObj !== -1 && firstOpenArr !== -1) {
                firstOpen = Math.min(firstOpenObj, firstOpenArr);
            } else {
                firstOpen = Math.max(firstOpenObj, firstOpenArr);
            }

            const lastCloseObj = cleaned.lastIndexOf('}');
            const lastCloseArr = cleaned.lastIndexOf(']');
            const lastClose = Math.max(lastCloseObj, lastCloseArr);

            if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
                const extracted = cleaned.substring(firstOpen, lastClose + 1);
                return JSON.parse(extracted) as T;
            }
            throw new Error('No valid JSON bounds found');
        } catch (error) {
            console.warn('Failed to parse AI JSON response. Raw content:', content);
            return fallback;
        }
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
    model: string = 'llama-3.3-70b-versatile',
    responseFormat?: { type: 'json_object' },
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
                model,
                messages,
                temperature,
                ...(responseFormat ? { response_format: responseFormat } : {}),
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
You are a Reddit Search Expert. Generate 3 search queries for Reddit's search engine.
User Query: "${sanitizePostContent(userQuery)}"

RULES:
- Reddit search ONLY supports: plain keywords, "quoted exact phrases", and OR.
- Do NOT use: site:, parentheses (), AND, NOT, -, intitle:, or any Google/Bing operators.
- Each query must be a simple string of keywords or quoted phrases joined by OR.
- Make each query target a different angle of the user's intent.

Output JSON format:
{
  "queries": [
    "simple keyword query",
    "\"exact phrase\" OR \"alternate phrase\"",
    "problem-focused keyword query"
  ]
}
`;

    const { content, rateLimit } = await callGroq(
        [
            { role: 'system', content: 'You are a Reddit Search Expert.' },
            { role: 'user', content: prompt },
        ],
        0.5,
        apiKeyOverride,
        'llama-3.1-8b-instant',       // Cheap model — query gen is a simple task
        { type: 'json_object' },       // Enforce JSON object — prompt returns {queries:[...]}
    );

    const parsed = safeParseJSON(content, { queries: [userQuery] });
    // @ts-ignore
    const queries = Array.isArray(parsed?.queries) ? parsed.queries : [userQuery];

    return { queries: queries.slice(0, 3), rateLimit };
}

/**
 * Generates a 1-sentence reason for why each post was selected for the given query.
 * Batch processes up to 25 posts in one prompt to save time/tokens.
 */
export async function generatePostReasons(
    userQuery: string,
    posts: any[],
    apiKeyOverride?: string
): Promise<{ reasons: Record<string, string>; rateLimit: RateLimitInfo }> {
    if (posts.length === 0) return { reasons: {}, rateLimit: { remaining: 100, limit: 100, resetInSeconds: 0 } };

    // Create a compact representation of the posts for the prompt
    // Optimization: Cut snippet to 120 chars (enough for context), don't send empty fields
    const postData = posts.map(p => ({
        i: p.id,
        t: p.title,
        ...(p.snippet ? { s: p.snippet.substring(0, 120) } : {})
    }));

    const prompt = `
User's search query: "${sanitizePostContent(userQuery)}"
Task: For each post, write 1 short sentence explaining HOW it answers the user's search query.

CRITICAL RULES:
1. Your reason MUST reference the user's query and explain the connection. Example: "Discusses top languages for beginners, directly answering the query."
2. Do NOT just copy or rephrase the post title. The reason must add value beyond the title.
3. If a post does NOT clearly and directly relate to the search query, return an empty string "".
4. Do NOT guess or hallucinate connections. If there is no obvious link, return "".
5. Never write "This post does not relate". Return "" instead.

Posts:
${JSON.stringify(postData)}

Output JSON:
{
  "r": [
    ["post_id", "Reason explaining how this post answers the search query."]
  ]
}
`;

    const { content, rateLimit } = await callGroq(
        [
            { role: 'system', content: 'You are a helpful assistant. Output valid JSON only.' },
            { role: 'user', content: prompt }
        ],
        0.5,
        apiKeyOverride,
        'llama-3.1-8b-instant', // Fast/cheap model is fine for this
        { type: 'json_object' }
    );

    const parsed = safeParseJSON(content, { r: [] });

    // Map the compressed array format back to a Record<string, string>
    const reasonsMap: Record<string, string> = {};
    const items = (parsed as any).r || [];
    if (Array.isArray(items)) {
        for (const item of items) {
            if (Array.isArray(item) && item.length === 2) {
                reasonsMap[item[0]] = item[1];
            }
        }
    }

    return { reasons: reasonsMap, rateLimit };
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
    const batches: any[][] = [];
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

export async function generateContentIdeas(
    topic: string,
    discussions: string[],
    promptOverride?: string,
    apiKeyOverride?: string
): Promise<{ ideas: ContentIdea[]; rateLimit: RateLimitInfo }> {
    const promptTemplate = promptOverride || DEFAULT_IDEAS_PROMPT;
    const discussionsText = discussions.join('\n\n---\n\n');

    let prompt = promptTemplate
        .replace('{{SUBREDDIT}}', topic)
        .replace('{{DISCUSSIONS}}', discussionsText);

    // Fix 1: Auto-append data if user's custom prompt omitted the placeholder
    if (promptOverride && !promptOverride.includes('{{DISCUSSIONS}}')) {
        prompt += `\n\nHere is the data to analyze:\n${discussionsText}`;
    }
    if (promptOverride && !promptOverride.includes('{{SUBREDDIT}}')) {
        prompt += `\n\nSubreddit: r/${topic}`;
    }

    const { content, rateLimit } = await callGroq(
        [
            // Fix 2: System message always enforces JSON schema
            { role: 'system', content: 'You are a Viral Content Strategist. You MUST output valid JSON only. Output format: [{"hook":"...","concept":"...","why":"...","cta":"..."}]. No explanations, no extra text.' },
            { role: 'user', content: prompt },
        ],
        0.7,
        apiKeyOverride
    );

    const parsed = safeParseJSON<any[]>(content, []);
    // Ensure each idea has a hooks array (required by ContentIdea type)
    const ideas = Array.isArray(parsed) ? parsed.map(idea => ({
        hook: idea.hook || '',
        concept: idea.concept || '',
        why: idea.why || '',
        cta: idea.cta || '',
        hooks: []
    })) : [];

    return { ideas, rateLimit };
}

export async function generateViralHooks(
    discussions: string[],
    promptOverride?: string,
    apiKeyOverride?: string
): Promise<{ hooks: string[]; rateLimit: RateLimitInfo }> {
    const promptTemplate = promptOverride || DEFAULT_HOOKS_PROMPT;
    const discussionsText = discussions.join('\n\n---\n\n');

    let prompt = promptTemplate.replace('{{DISCUSSIONS}}', discussionsText);

    // Fix 1: Auto-append data if user's custom prompt omitted the placeholder
    if (promptOverride && !promptOverride.includes('{{DISCUSSIONS}}')) {
        prompt += `\n\nHere is the data to analyze:\n${discussionsText}`;
    }

    const { content, rateLimit } = await callGroq(
        [
            // Fix 2: System message always enforces JSON schema
            { role: 'system', content: 'You are a Viral Hook Expert. You MUST output valid JSON only. Output format: ["hook1", "hook2", ...]. No explanations, no extra text.' },
            { role: 'user', content: prompt },
        ],
        0.8,
        apiKeyOverride
    );

    // The model may return a plain array ["hook1",..] or {hooks:["hook1",..]}  
    const parsed = safeParseJSON<string[] | { hooks: string[] }>(content, []);
    let hooks: string[] = [];
    if (Array.isArray(parsed)) {
        hooks = parsed;
    } else if (parsed && Array.isArray((parsed as { hooks: string[] }).hooks)) {
        hooks = (parsed as { hooks: string[] }).hooks;
    }

    return { hooks, rateLimit };
}

export async function generateVideoScripts(
    hook: string,
    concept: string,
    promptOverride?: string,
    apiKeyOverride?: string
): Promise<{ scripts: VideoScripts; rateLimit: RateLimitInfo }> {
    const promptTemplate = promptOverride || DEFAULT_SCRIPTS_PROMPT;

    let prompt = promptTemplate
        .replace('{{HOOK}}', hook)
        .replace('{{CONCEPT}}', concept);

    // Fix 1: Auto-append data if user's custom prompt omitted the placeholders
    if (promptOverride && !promptOverride.includes('{{HOOK}}')) {
        prompt += `\n\nSelected Hook:\n"${hook}"`;
    }
    if (promptOverride && !promptOverride.includes('{{CONCEPT}}')) {
        prompt += `\n\nSelected Idea:\n"${concept}"`;
    }

    const { content, rateLimit } = await callGroq(
        [
            // Fix 2: System message always enforces JSON schema
            { role: 'system', content: 'You are a Video Script Writer. You MUST output valid JSON only. Output format: {"variation1":"script text here","variation2":"script text here"}. Use \\n for line breaks within scripts. No explanations, no extra text.' },
            { role: 'user', content: prompt },
        ],
        0.7,
        apiKeyOverride
    );

    const scripts = safeParseJSON<VideoScripts>(content, {
        variation1: 'Failed to generate script 1.',
        variation2: 'Failed to generate script 2.'
    });

    return { scripts, rateLimit };
}
