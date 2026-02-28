
/**
 * Cache utility for storing search results and AI responses.
 * Uses Upstash Redis if configured, otherwise falls back to a simple in-memory Map.
 */

type CacheEntry = {
    value: unknown;
    expiresAt: number;
};

const memoryCache = new Map<string, CacheEntry>();

export const TTL = {
    SEARCH_RESULTS: 1800, // 30 mins
    QUERY_EXPANSION: 3600, // 1 hour
    INTENT_ANALYSIS: 3600, // 1 hour
};

// Simple cleanup for memory cache to prevent unlimited growth
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of memoryCache.entries()) {
        if (entry.expiresAt < now) {
            memoryCache.delete(key);
        }
    }
}, 60000 * 5); // Run every 5 mins

async function redisGet(key: string): Promise<unknown | null> {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) return null;

    try {
        const res = await fetch(`${url}/get/${key}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = (await res.json()) as { result?: string };
        if (data.result) {
            return JSON.parse(data.result);
        }
        return null;
    } catch (error) {
        console.warn('Redis Get Failed:', error);
        return null;
    }
}

async function redisSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) return;

    try {
        await fetch(`${url}/setex/${key}/${ttlSeconds}/${JSON.stringify(value)}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
    } catch (error) {
        console.warn('Redis Set Failed:', error);
    }
}

export async function cacheGet<T>(key: string): Promise<T | null> {
    // Try Redis first
    const redisVal = await redisGet(key);
    if (redisVal !== null) return redisVal as T;

    // Fallback to Memory
    const entry = memoryCache.get(key);
    if (entry && entry.expiresAt > Date.now()) {
        return entry.value as T;
    }
    return null;
}

export async function cacheSet<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    // Write to Redis (Fire & Forget)
    redisSet(key, value, ttlSeconds).catch(() => { });

    // Write to Memory
    memoryCache.set(key, {
        value,
        expiresAt: Date.now() + (ttlSeconds * 1000)
    });
}

export function makeCacheKey(namespace: string, ...parts: string[]): string {
    return [namespace, ...parts]
        .join(':')
        .toLowerCase()
        .replace(/\s+/g, '-')
        .slice(0, 200);
}
