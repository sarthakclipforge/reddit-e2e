/**
 * Embeddings utility for semantic similarity checks.
 * Includes concurrency limiting, retries, and batch processing.
 */

const HF_API_URLS = [
    'https://router.huggingface.co/hf-inference/models/BAAI/bge-base-en-v1.5',
    'https://api-inference.huggingface.co/models/BAAI/bge-base-en-v1.5',
];
const HF_USER_AGENT = 'reddit-scraper/1.0 (+https://github.com/AritraBose10/reddit)';
const EMBEDDING_BATCH_SIZE = 10;

class ConcurrencyLimiter {
    private maxConcurrent: number;
    private currentRunning: number;
    private queue: (() => void)[];

    constructor(maxConcurrent: number) {
        this.maxConcurrent = maxConcurrent;
        this.currentRunning = 0;
        this.queue = [];
    }

    async acquire(): Promise<void> {
        if (this.currentRunning < this.maxConcurrent) {
            this.currentRunning++;
            return;
        }

        return new Promise<void>((resolve) => {
            this.queue.push(resolve);
        });
    }

    release(): void {
        this.currentRunning--;
        if (this.queue.length > 0) {
            this.currentRunning++;
            const next = this.queue.shift();
            if (next) next();
        }
    }

    async run<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }
}

// Keep low concurrency to reduce free-tier timeout/rate-limit pressure.
const limiter = new ConcurrencyLimiter(1);

async function fetchWithTimeout(url: string, options: RequestInit, timeout = 15000): Promise<Response> {
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

function isAbortLikeError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const msg = error.message.toLowerCase();
    return error.name === 'AbortError' || msg.includes('aborted') || msg.includes('abort');
}

async function getEmbeddingsWithRetry(texts: string[], attempt = 1): Promise<number[][]> {
    const apiKey = process.env.HF_API_KEY;
    if (!apiKey) throw new Error('Missing HF_API_KEY - add it to .env.local');

    try {
        // Increase timeout for larger text batches.
        const timeoutMs = Math.min(45000, 15000 + texts.length * 300);
        const endpoint = HF_API_URLS[(attempt - 1) % HF_API_URLS.length];
        const response = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'User-Agent': HF_USER_AGENT,
            },
            body: JSON.stringify({
                inputs: texts,
                options: { wait_for_model: true }
            })
        }, timeoutMs);

        if (response.status === 503) {
            // Cold start
            throw new Error('Model loading (503)');
        }

        if (response.status === 429) {
            // Rate limit
            throw new Error('Rate limit (429)');
        }

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`HF Error ${response.status}: ${err}`);
        }

        return await response.json();

    } catch (error: any) {
        // Abort/timeout errors are usually persistent for this request; don't retry-loop them.
        if (isAbortLikeError(error)) throw error;
        if (attempt >= 4) throw error; // Max 3 actual fetch attempts (1, 2, 3); attempt 4 exits early

        let delay = 3000 * Math.pow(2, attempt - 1); // 3s, 6s, 12s
        if (error.message.includes('429')) delay = 10000; // Fixed 10s for rate limits

        console.warn(`Embedding attempt ${attempt} failed: ${error.message}. Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        return getEmbeddingsWithRetry(texts, attempt + 1);
    }
}

function localKeywordFallback(posts: any[], query: string): any[] {
    const stopWords = new Set([
        'a', 'an', 'the', 'and', 'or', 'but', 'for', 'of', 'to', 'in',
        'is', 'it', 'on', 'at', 'by', 'as', 'with', 'how', 'what', 'why',
        'when', 'who', 'which', 'that', 'this', 'are', 'was', 'be', 'do',
        'i', 'my', 'me'
    ]);
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
    const maxOut = Math.min(25, posts.length);
    if (words.length === 0) return posts.slice(0, maxOut);

    const scored = posts.map((p) => {
        const hay = `${(p.title || '').toLowerCase()} ${(p.snippet || '').toLowerCase()} ${(p.subreddit || '').toLowerCase()}`;
        const matchCount = words.reduce((acc, w) => acc + (hay.includes(w) ? 1 : 0), 0);
        return { post: p, score: matchCount };
    });

    const matched = scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxOut)
        .map(s => s.post);

    if (matched.length > 0) return matched;
    return posts.slice(0, maxOut);
}

export async function getEmbeddings(texts: string[]): Promise<number[][]> {
    return limiter.run(() => getEmbeddingsWithRetry(texts));
}

function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
        console.error(`cosineSimilarity: vector dimension mismatch (${a.length} vs ${b.length}). Returning 0.`);
        return 0;
    }

    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    if (denom === 0) return 0;
    return dot / denom;
}

/**
 * Returns adaptive threshold based on intent type.
 */
export function adaptiveThreshold(intent: string): number {
    const thresholds: Record<string, number> = {
        'search': 0.75,
        'similarity': 0.80,
        'recommend': 0.72,
        'unknown': 0.78,
    };
    return thresholds[intent] ?? 0.78;
}

/**
 * Filters posts by semantic similarity to the query.
 * Embeds query first, then posts in chunks to avoid timeout/abort with large result sets.
 */
export async function semanticFilter(
    posts: any[],
    query: string,
    intentType: string = 'unknown'
): Promise<any[]> {
    if (posts.length === 0) return [];

    try {
        const queryEmbedding = (await getEmbeddings([query]))[0];
        const postTexts = posts.map(p => `${p.title} ${p.snippet?.slice(0, 200) || ''}`);

        const postEmbeddings: Array<number[] | null> = [];
        for (let i = 0; i < postTexts.length; i += EMBEDDING_BATCH_SIZE) {
            const chunk = postTexts.slice(i, i + EMBEDDING_BATCH_SIZE);
            try {
                const chunkEmbeddings = await getEmbeddings(chunk);
                postEmbeddings.push(...chunkEmbeddings);
            } catch (chunkError) {
                // Degrade gracefully: failed chunk gets neutral semantic scores.
                console.warn(`Embedding chunk failed (${chunk.length} items). Falling back to neutral semantic score.`, chunkError);
                for (let j = 0; j < chunk.length; j++) {
                    postEmbeddings.push(null);
                }
            }
        }

        // Score every post
        const scored = posts.map((post, index) => {
            const embedding = postEmbeddings[index];
            const score = embedding ? cosineSimilarity(queryEmbedding, embedding) : 0;
            const scoredPost = { ...post, semanticScore: score };
            return { post: scoredPost, score };
        });

        // Sort by score descending
        scored.sort((a, b) => b.score - a.score);

        // Percentile-based filtering based on adaptive thresholds by intent type
        const percentileCutoff = 1 - adaptiveThreshold(intentType); // ratio of posts to KEEP
        const keepRatio = Math.max(0.05, Math.min(0.60, percentileCutoff));
        const keepCount = Math.max(3, Math.ceil(scored.length * keepRatio));

        // Secondary floor: discard posts with near-zero semantic relevance regardless of rank
        const minAbsoluteThreshold = 0.40;

        return scored
            .slice(0, keepCount)
            .filter(s => s.score >= minAbsoluteThreshold)
            .map(s => s.post);

    } catch (error) {
        console.error('Semantic filter unavailable - using local keyword fallback:', error);
        return localKeywordFallback(posts, query);
    }
}
