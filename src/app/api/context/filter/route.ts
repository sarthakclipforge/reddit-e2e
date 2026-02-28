import { NextRequest, NextResponse } from 'next/server';
import { generateSearchQueries, generatePostReasons } from '@/lib/ai';
import { searchReddit } from '@/lib/reddit';
import { deduplicateWithBonus, heuristicScore } from '@/lib/heuristics';
import { semanticFilter } from '@/lib/embeddings';
import { cacheGet, cacheSet, makeCacheKey, TTL } from '@/lib/cache';

export async function POST(req: NextRequest) {
    try {
        const { query: userQuery, strictness, sort, time } = await req.json();
        const apiKey = req.headers.get('x-groq-api-key') || undefined;

        // 1. Validation
        if (!userQuery || userQuery.length < 2) {
            return NextResponse.json({ error: 'Query required' }, { status: 400 });
        }

        // 2. Cache Check (Full Response)
        const cacheKey = makeCacheKey('filter', `${userQuery}__s${strictness ?? 'default'}__${sort ?? 'relevance'}__${time ?? 'all'}`);
        const cached = await cacheGet(cacheKey);
        if (cached) {
            return NextResponse.json({ ...cached, cached: true });
        }

        // 3. Intent Analysis — uses llama-3.1-8b-instant (cheap, fast)
        const { queries } = await generateSearchQueries(userQuery, apiKey);

        // 4. Distributed Search (Server-Side) — only call for valid query strings
        // Always include the user's original query alongside AI-generated ones for keyword accuracy
        const validQueries = queries.filter((q): q is string => typeof q === 'string' && q.trim().length > 0);
        const allQueries = [userQuery, ...validQueries.filter(q => q.toLowerCase() !== userQuery.toLowerCase())].slice(0, 4);

        // Context Mode: force relevance sort and default to 'year' for fresher results
        const contextSort = 'relevance';
        const contextTime = time || 'year';

        const results = await Promise.allSettled(
            allQueries.map(q => searchReddit(q, 50, contextSort, contextTime))
        );

        const allResults = results.map(r => r.status === 'fulfilled' ? r.value : []);

        // 5. Deduplication & Heuristics
        const uniquePosts = deduplicateWithBonus(allResults);

        if (uniquePosts.length === 0) {
            return NextResponse.json({ posts: [], filterStats: { input: 0, output: 0 } });
        }

        // 6. Semantic Filtering (local embeddings — 0 tokens)
        const semanticallyFiltered = await semanticFilter(uniquePosts, userQuery, 'unknown', strictness);

        // 7. Final Ranking — heuristic score with keyword overlap bonus
        // If semantic filter produced nothing (very niche query), fall back to heuristic-sorted raw posts.
        const postsToRank = semanticallyFiltered.length > 0 ? semanticallyFiltered : uniquePosts;

        // Extract query keywords for keyword overlap bonus (strip common stop words)
        const stopWords = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'for', 'of', 'to', 'in', 'is', 'it', 'on', 'at', 'by', 'as', 'with', 'how', 'what', 'why', 'when', 'who', 'which', 'that', 'this', 'are', 'was', 'be', 'do', 'i', 'my', 'me']);
        const queryWords = userQuery.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2 && !stopWords.has(w));

        let finalResults = postsToRank
            .map((p: any) => ({ ...p, hScore: heuristicScore(p, queryWords) }))
            .sort((a: any, b: any) => b.hScore - a.hScore)
            .slice(0, 25)
            .map((p: any) => ({
                ...p,
                relevanceScore: Math.min(10, Math.max(1, Math.round((p.semanticScore || 0) * 10)))
            }));

        // 8. Generate Reasons for the final top posts
        // Only generate reasons if the posts actually have direct context (passed semantic filter).
        // If it fell back to raw posts, skip generating reasons (saves tokens, hides "Why:" UI).
        try {
            if (semanticallyFiltered.length > 0) {
                const { reasons } = await generatePostReasons(userQuery, finalResults, apiKey);
                finalResults = finalResults.map(p => ({
                    ...p,
                    reason: reasons[p.id] || ''
                })).filter(p => p.reason.trim() !== ''); // STRICT FILTER: Drop posts the AI rejected

                // If the strict filter dropped everything, we return empty so the user doesn't get junk.
            }
        } catch (e) {
            console.warn('Failed to generate post reasons:', e);
            // Non-fatal, just continue without reasons
        }

        const response = {
            posts: finalResults,
            queryContext: queries,
            filterStats: {
                input: uniquePosts.length,
                semanticPass: semanticallyFiltered.length,
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
