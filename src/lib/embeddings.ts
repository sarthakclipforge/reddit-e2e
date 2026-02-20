
/**
 * Embeddings utility for semantic similarity checks.
 * Includes concurrency limiting, retries, and batch processing.
 */

const HF_API_URL = 'https://router.huggingface.co/hf-inference/models/BAAI/bge-small-en-v1.5';

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

async function fetchWithTimeout(url: string, options: RequestInit, timeout = 5000): Promise<Response> {
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
    if (!apiKey) throw new Error('Missing HF_API_KEY');

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
    switch (intent.toLowerCase()) {
        case 'how-to': return 0.74;
        case 'story': return 0.68;
        case 'trend': return 0.70;
        default: return 0.72; // problem or unknown
    }
}

/**
 * Filters posts by semantic similarity to the query.
 * Embeds query and all posts in a single batch call.
 */
export async function semanticFilter(
    posts: any[],
    query: string,
    intentType: string = 'unknown'
): Promise<any[]> {
    if (posts.length === 0) return [];

    try {
        // Prepare texts: Query first, then all posts
        // For posts, combine title + snippet for better context
        const textsToEmbed = [
            query,
            ...posts.map(p => `${p.title} ${p.selftext?.slice(0, 200) || ''}`)
        ];

        const embeddings = await getEmbeddings(textsToEmbed);

        const queryEmbedding = embeddings[0];
        const postEmbeddings = embeddings.slice(1);

        const threshold = adaptiveThreshold(intentType);

        return posts.filter((post, index) => {
            const score = cosineSimilarity(queryEmbedding, postEmbeddings[index]);
            // Attach score for debugging/ranking
            post.semanticScore = score;
            return score >= threshold;
        });

    } catch (error) {
        console.error('Semantic filter failed:', error);
        // Fail open? Or fail closed? 
        // Instructions imply this is a filter, so maybe return empty or return all if it fails?
        // Let's return all but mark them as unverified to be safe, or just rethrow.
        // Given this is "Context Search", returning all might spam. Let's return empty to be safe.
        return [];
    }
}
