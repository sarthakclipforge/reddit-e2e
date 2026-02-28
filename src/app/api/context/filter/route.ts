
import { NextRequest, NextResponse } from 'next/server';
import { generateSearchQueries, filterPostsByContext } from '@/lib/ai';
import { searchReddit } from '@/lib/reddit';
import { deduplicateWithBonus, heuristicScore } from '@/lib/heuristics';
import { semanticFilter } from '@/lib/embeddings';
import { cacheGet, cacheSet, makeCacheKey, TTL } from '@/lib/cache';
import { ContextSearchResponse, RedditPost } from '@/types';

function normalizeQuery(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
}

function buildSearchQueries(userQuery: string, aiQueries: string[]): string[] {
    const base = normalizeQuery(userQuery);
    const escapedPhrase = base.replace(/"/g, '\\"');
    const queries: string[] = [];

    if (base.includes(' ')) {
        // Match exact phrase first to avoid drifting into loosely related keyword matches.
        queries.push(`"${escapedPhrase}"`);
    }
    queries.push(base);

    for (const query of aiQueries) {
        const clean = normalizeQuery(query);
        if (!clean) continue;

        const alreadyIncluded = queries.some(
            (existing) => existing.toLowerCase() === clean.toLowerCase()
        );
        if (alreadyIncluded) continue;

        // Skip very broad OR-style expansions when the user query looks like a named entity phrase.
        if (base.includes(' ') && /\bOR\b/i.test(clean)) continue;

        queries.push(clean);
    }

    return queries.slice(0, 4);
}

export async function POST(req: NextRequest) {
    try {
        const body = (await req.json()) as { query?: string };
        const userQuery = typeof body.query === 'string' ? normalizeQuery(body.query) : '';
        const apiKey = req.headers.get('x-groq-api-key') || undefined;

        // 1. Validation
        if (!userQuery || userQuery.length < 2) {
            return NextResponse.json({ error: 'Query required' }, { status: 400 });
        }

        // 2. Cache Check (Full Response)
        const cacheKey = makeCacheKey('filter', userQuery);
        const cached = await cacheGet<ContextSearchResponse>(cacheKey);
        if (cached) {
            return NextResponse.json({ ...cached, cached: true });
        }

        // 3. Intent Analysis (best-effort)
        let aiQueries: string[] = [];
        try {
            const generated = await generateSearchQueries(userQuery, apiKey);
            aiQueries = generated.queries;
        } catch (error) {
            console.warn('Intent query generation failed, falling back to exact query search:', error);
        }
        const queries = buildSearchQueries(userQuery, aiQueries);

        // 4. Distributed Search (Server-Side)
        const results = await Promise.allSettled(
            queries.map((query) => searchReddit(query, 25, 'relevance'))
        );

        const allResults = results.map((result) => (result.status === 'fulfilled' ? result.value : []));

        // 5. Deduplication & Heuristics
        const uniquePosts = deduplicateWithBonus(allResults);

        if (uniquePosts.length === 0) {
            return NextResponse.json({ posts: [], filterStats: { input: 0, output: 0 } });
        }

        // 6. Semantic Filtering (Embeddings)
        // Determine intent type loosely from queries or pass it down. 
        // For now, defaulting to 'unknown' or inferring from the query structure could be complex.
        // We'll trust the adaptiveThreshold default.
        const semanticallyFiltered = await semanticFilter(uniquePosts, userQuery, 'unknown');

        // If nothing passes semantic filter, return stat
        if (semanticallyFiltered.length === 0) {
            return NextResponse.json({
                posts: [],
                queryContext: queries,
                filterStats: {
                    input: uniquePosts.length,
                    semanticPass: 0,
                    output: 0
                }
            });
        }

        // 7. Pre-Ranking (Heuristic)
        // Sort by naive heuristic score to send best candidates to AI
        const preRanked = semanticallyFiltered
            .map((post: RedditPost) => ({ ...post, hScore: heuristicScore(post) }))
            .sort((a, b) => (b.hScore || 0) - (a.hScore || 0))
            .slice(0, 30); // Cap at 30 for AI analysis

        // 7. AI Semantic Filtering
        const { filteredPosts } = await filterPostsByContext(preRanked, userQuery, apiKey);

        // 8. Final Scoring & Sort
        // Step 1: keep only relevant posts (AI relevance >= 6).
        // Step 2: within relevant posts, order by engagement (upvotes + comments).
        const relevanceTier = (score: number) => (score >= 8 ? 2 : score >= 6 ? 1 : 0);
        const engagementScore = (post: RedditPost) => post.upvotes + post.comments;

        const finalResults = filteredPosts
            .filter((post) => (post.relevanceScore ?? 0) >= 6)
            .sort((a, b) => {
                const aRelevance = a.relevanceScore ?? 0;
                const bRelevance = b.relevanceScore ?? 0;

                const tierDiff = relevanceTier(bRelevance) - relevanceTier(aRelevance);
                if (tierDiff !== 0) return tierDiff;

                const engagementDiff = engagementScore(b) - engagementScore(a);
                if (engagementDiff !== 0) return engagementDiff;

                return bRelevance - aRelevance;
            });

        const response: ContextSearchResponse = {
            posts: finalResults,
            queryContext: queries,
            filterStats: {
                input: uniquePosts.length,
                semanticPass: semanticallyFiltered.length,
                analyzed: preRanked.length,
                output: finalResults.length
            },
            totalResults: finalResults.length,
            query: userQuery,
        };

        // 9. Cache Success
        if (finalResults.length > 0) {
            await cacheSet(cacheKey, response, TTL.SEARCH_RESULTS);
        }

        return NextResponse.json(response);

    } catch (error: unknown) {
        console.error('Filter API Error:', error);
        return NextResponse.json(
            { error: 'Search Pipeline Failed', details: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}
