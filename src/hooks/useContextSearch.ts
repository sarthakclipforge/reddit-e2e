
import { useState, useCallback } from 'react';
import { RedditPost, SearchResponse } from '@/types';
import { searchRedditBrowser } from '@/lib/reddit';
import { useApiUsage } from '@/context/ApiUsageContext';
import { getStoredApiKey } from '@/components/ApiKeyManager';

interface ContextSearchState {
    isLoading: boolean;
    status: 'idle' | 'analyzing' | 'fetching' | 'filtering';
    data: SearchResponse | null;
    error: string | null;
}

// ─────────────────────────────────────────────────
// Engagement Scoring (no API cost, runs client-side)
// ─────────────────────────────────────────────────

/**
 * Compute engagement score for each post using rank-based scoring with time decay.
 *
 * Steps:
 *  1. Compute raw engagement = upvotes×1.0 + comments×1.5 + upvoteRatio×100
 *  2. Apply time decay: rawEngagement × exp(-0.1 × ageInDays)
 *  3. Sort by decayed engagement, then assign rank-based score:
 *       engagementScore = 10 × (1 - (rank / totalPosts))
 *     (rank 0 = best → score 10; rank N-1 = worst → score approaches 0)
 */
function computeEngagementScores(posts: RedditPost[]): RedditPost[] {
    if (posts.length === 0) return posts;

    const now = Date.now();

    // Step 1 & 2: raw engagement with time decay
    const withDecay = posts.map(p => {
        const ageInDays = (now - new Date(p.created).getTime()) / (1000 * 60 * 60 * 24);
        const raw = p.upvotes * 1.0 + p.comments * 1.5 + (p.upvoteRatio ?? 0.8) * 100;
        const decayed = raw * Math.exp(-0.1 * ageInDays);
        return { post: p, decayed };
    });

    // Step 3: sort by decayed value, then assign rank-based score
    withDecay.sort((a, b) => b.decayed - a.decayed);
    const total = withDecay.length;

    return withDecay.map(({ post }, rank) => ({
        ...post,
        engagementScore: 10 * (1 - rank / total),
    }));
}

// ─────────────────────────────────────────────────
// Smart Pre-filter: variance-based K selection
// ─────────────────────────────────────────────────

/**
 * Determine how many posts to send to the AI based on variance of engagement scores.
 *
 * High variance → scores clearly differentiate posts → passRate = 0.55 (AI can be selective)
 * Low variance  → scores are clustered → passRate = 0.75 (send more, AI needs more context)
 *
 * K = ceil(targetCount / passRate). Posts outside K are excluded from final results entirely.
 */
function selectTopK(posts: RedditPost[], targetCount = 25): RedditPost[] {
    if (posts.length <= targetCount) return posts;

    const scores = posts.map(p => (p as any).engagementScore as number ?? 0);

    // Population variance
    const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
    const variance = scores.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / scores.length;

    // Threshold: variance > 4 is considered "high" (scores span a meaningful 0-10 range)
    const passRate = variance > 4 ? 0.55 : 0.75;
    const K = Math.ceil(targetCount / passRate);

    // Return only the top-K by engagement (already sorted descending from computeEngagementScores)
    return posts.slice(0, K);
}

// ─────────────────────────────────────────────────
// Score merging
// ─────────────────────────────────────────────────

/**
 * Merge engagement and relevance scores into a single final score.
 *
 * finalScore = (engagementScore × 0.4) + (relevanceScore × 0.6)
 *
 * If the Groq call failed (relevanceScore missing), the upstream fallback in ai.ts
 * already returns posts sorted by engagementScore — this function is not called in that path.
 */
function mergeScores(posts: RedditPost[], targetCount = 25): RedditPost[] {
    return posts
        .map(p => ({
            ...p,
            // Both scores are 0-10; weight: 40% engagement, 60% relevance
            finalScore:
                ((p as any).engagementScore ?? 0) * 0.4 +
                ((p as any).relevanceScore ?? 0) * 0.6,
        }))
        .sort((a: any, b: any) => b.finalScore - a.finalScore)
        .slice(0, targetCount);
}

// ─────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────

export function useContextSearch() {
    const [state, setState] = useState<ContextSearchState>({
        isLoading: false,
        status: 'idle',
        data: null,
        error: null,
    });

    const { updateUsage } = useApiUsage();
    const [lastParams, setLastParams] = useState<{ query: string; sort: 'top' | 'hot'; time: string } | null>(null);

    const search = useCallback(async (query: string, sort: 'top' | 'hot', time: string) => {
        setState(prev => ({ ...prev, isLoading: true, status: 'analyzing', error: null }));
        setLastParams({ query, sort, time });

        try {
            const apiKey = getStoredApiKey();
            const headers: Record<string, string> = apiKey ? { 'x-groq-api-key': apiKey } : {};

            // ── Step 1: Intent Analysis (server-side AI) ──────────────────
            const intentRes = await fetch('/api/context/intent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({ query }),
            });

            if (!intentRes.ok) throw new Error('Failed to analyze search intent');
            const { queries, rateLimit: rl1 } = await intentRes.json();

            if (rl1) updateUsage({ remaining: rl1.remaining, limit: rl1.limit, resetInSeconds: rl1.resetInSeconds });

            // ── Step 2: Distributed Fetching (client-side via CORS proxy) ──
            setState(prev => ({ ...prev, status: 'fetching' }));

            const nestedPosts = await Promise.all(
                (queries as string[]).map(q => searchRedditBrowser(q, sort, time))
            );

            // Flatten and deduplicate by ID
            const allPosts = nestedPosts.flat();
            const uniquePosts: RedditPost[] = Array.from(
                new Map(allPosts.map(p => [p.id, p])).values()
            );

            // ── Engagement Scoring (no API cost) ──────────────────────────
            // Scores every post incrementally using rank-based formula + time decay
            const scoredPosts = computeEngagementScores(uniquePosts);

            // ── Smart Pre-filter: send only top K to AI ───────────────────
            // K is chosen based on engagement score variance (high variance → smaller K)
            const topK = selectTopK(scoredPosts);

            // ── Step 3: Semantic Filtering (single batched Groq call) ─────
            setState(prev => ({ ...prev, status: 'filtering' }));

            const filterRes = await fetch('/api/context/filter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                // Send only top-K; posts outside K never enter the AI payload
                body: JSON.stringify({ posts: topK, query }),
            });

            if (!filterRes.ok) throw new Error('Failed to filter results');
            const { filteredPosts, rateLimit: rl2 } = await filterRes.json();

            if (rl2 && rl2.limit > 0) updateUsage({ remaining: rl2.remaining, limit: rl2.limit, resetInSeconds: rl2.resetInSeconds });

            // ── Score Merging: 40% engagement + 60% relevance ─────────────
            // Then slice to targetCount (25)
            const finalPosts = mergeScores(filteredPosts as RedditPost[]);

            setState({
                isLoading: false,
                status: 'idle',
                data: {
                    posts: finalPosts,
                    totalResults: finalPosts.length,
                    cached: false,
                    query,
                    sort,
                    cacheAge: 0,
                },
                error: null,
            });
        } catch (err) {
            console.error('Context search error:', err);
            setState({
                isLoading: false,
                status: 'idle',
                data: null,
                error: err instanceof Error ? err.message : 'Context search failed',
            });
        }
    }, [updateUsage]);

    const refetch = useCallback(() => {
        if (lastParams) search(lastParams.query, lastParams.sort, lastParams.time);
    }, [lastParams, search]);

    return { ...state, search, refetch };
}
