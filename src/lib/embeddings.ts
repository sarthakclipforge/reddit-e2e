
/**
 * Embeddings utility for semantic similarity checks.
 * Includes concurrency limiting, retries, and batch processing.
 */

const HF_API_URL = 'https://router.huggingface.co/hf-inference/models/BAAI/bge-base-en-v1.5';

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

// 2 Concurrent Requests Limit for HuggingFace Free Tier
const limiter = new ConcurrencyLimiter(2);

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

async function getEmbeddingsWithRetry(texts: string[], attempt = 1): Promise<number[][]> {
    const apiKey = process.env.HF_API_KEY;
    if (!apiKey) throw new Error('Missing HF_API_KEY — add it to .env.local');

    try {
        const response = await fetchWithTimeout(HF_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: texts,
                options: { wait_for_model: true }
            })
        });

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
        if (attempt >= 4) throw error;

        let delay = 3000 * Math.pow(2, attempt - 1); // 3s, 6s, 12s
        if (error.message.includes('429')) delay = 10000; // Fixed 10s for rate limits

        console.warn(`Embedding attempt ${attempt} failed: ${error.message}. Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        return getEmbeddingsWithRetry(texts, attempt + 1);
    }
}

export async function getEmbeddings(texts: string[]): Promise<number[][]> {
    return limiter.run(() => getEmbeddingsWithRetry(texts));
}

function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Returns adaptive threshold based on intent type.
 */
export function adaptiveThreshold(intent: string): number {
    return 0.78; // Increased significantly because bge-small groups broad keywords (like 'election') very closely
}

/**
 * Filters posts by semantic similarity to the query.
 * Embeds query and all posts in a single batch call.
 */
export async function semanticFilter(
    posts: any[],
    query: string,
    intentType: string = 'unknown',
    strictness?: number
): Promise<any[]> {
    if (posts.length === 0) return [];

    try {
        // Prepare texts: Query first, then all posts
        // For posts, combine title + snippet for better context
        const textsToEmbed = [
            query,
            ...posts.map(p => `${p.title} ${p.snippet?.slice(0, 200) || ''}`)
        ];

        const embeddings = await getEmbeddings(textsToEmbed);

        const queryEmbedding = embeddings[0];
        const postEmbeddings = embeddings.slice(1);

        // Score every post
        const scored = posts.map((post, index) => {
            const score = cosineSimilarity(queryEmbedding, postEmbeddings[index]);
            post.semanticScore = score;
            return { post, score };
        });

        // Sort by score descending
        scored.sort((a, b) => b.score - a.score);

        // Percentile-based filtering:
        // Strictness 0.50 → keep top 50% of posts
        // Strictness 0.75 → keep top 25%
        // Strictness 0.95 → keep top 5%
        // Formula: keepRatio = 1 - strictness (clamped to [0.05, 0.60])
        const effectiveStrictness = strictness ?? adaptiveThreshold(intentType);
        const keepRatio = Math.max(0.05, Math.min(0.60, 1 - effectiveStrictness));
        const keepCount = Math.max(3, Math.ceil(scored.length * keepRatio));

        // Also apply a minimum absolute threshold (0.40) to filter out truly unrelated posts
        const minAbsoluteThreshold = 0.40;

        return scored
            .slice(0, keepCount)
            .filter(s => s.score >= minAbsoluteThreshold)
            .map(s => s.post);

    } catch (error) {
        console.error('⚠️ Semantic filter FAILED OPEN — returning all posts unfiltered:', error);
        console.warn(`   This means ${posts.length} posts bypassed semantic filtering entirely.`);
        // Fail open: if the embedding API errors, return all posts so the user
        // still gets results rather than a silent empty state.
        return posts;
    }
}
