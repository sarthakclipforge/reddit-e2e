
import { NextRequest, NextResponse } from 'next/server';
import { generateSearchQueries, filterPostsByContext } from '@/lib/ai';
import { searchReddit } from '@/lib/reddit';
import { deduplicateWithBonus, heuristicScore } from '@/lib/heuristics';
import { semanticFilter } from '@/lib/embeddings';
import { cacheGet, cacheSet, makeCacheKey, TTL } from '@/lib/cache';

export async function POST(req: NextRequest) {
    try {
        const { query: userQuery } = await req.json();
        const apiKey = req.headers.get('x-groq-api-key') || undefined;

        // 1. Validation
        if (!userQuery || userQuery.length < 2) {
            return NextResponse.json({ error: 'Query required' }, { status: 400 });
        }

        // 2. Cache Check (Full Response)
        const cacheKey = makeCacheKey('filter', userQuery);
        const cached = await cacheGet(cacheKey);
        if (cached) {
            return NextResponse.json({ ...cached, cached: true });
        }

        // 3. Intent Analysis
        // Note: In a full pipeline, we might cache this separately, but here we run it part of the flow
        const { queries } = await generateSearchQueries(userQuery, apiKey);

        // 4. Distributed Search (Server-Side)
        // Execute all 3 queries in parallel
        const results = await Promise.allSettled([
            searchReddit(queries[0], 25, 'relevance'), // Broad
            searchReddit(queries[1], 25, 'relevance'), // Specific
            searchReddit(queries[2], 25, 'relevance')  // Strategic
        ]);

        const allResults = results.map(r => r.status === 'fulfilled' ? r.value : []);

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
            .map((p: any) => ({ ...p, hScore: heuristicScore(p) }))
            .sort((a: any, b: any) => b.hScore - a.hScore)
            .slice(0, 30); // Cap at 30 for AI analysis

        // 7. AI Semantic Filtering
        const { filteredPosts } = await filterPostsByContext(preRanked, userQuery, apiKey);

        // 8. Final Scoring & Sort
        // Combine AI Score (65%) and Relevance/Heuristic (35%) - Simplified for now to just use AI score threshold
        const finalResults = filteredPosts
            .filter(p => p.relevanceScore >= 6) // Threshold
            .sort((a, b) => b.relevanceScore - a.relevanceScore);

        const response = {
            posts: finalResults,
            queryContext: queries,
            filterStats: {
                input: uniquePosts.length,
                semanticPass: semanticallyFiltered.length,
                analyzed: preRanked.length,
                output: finalResults.length
            }
        };

        // 9. Cache Success
        if (finalResults.length > 0) {
            await cacheSet(cacheKey, response, TTL.SEARCH_RESULTS);
        }

        return NextResponse.json(response);

    } catch (error: any) {
        console.error('Filter API Error:', error);
        return NextResponse.json(
            { error: 'Search Pipeline Failed', details: error.message },
            { status: 500 }
        );
    }
}
