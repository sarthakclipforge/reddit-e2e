
import { NextRequest, NextResponse } from 'next/server';
import { rateLimiter } from '@/lib/rate-limiter';
import { cacheGet, cacheSet, makeCacheKey, TTL } from '@/lib/cache';
import { searchReddit } from '@/lib/reddit';
import { SearchResponse, TimeRange } from '@/types';

type RedditSort = 'top' | 'hot' | 'relevance';

export async function GET(request: NextRequest) {
    try {
        // Parse query params
        const { searchParams } = new URL(request.url);
        const keywords = searchParams.get('keywords')?.trim();
        const sort = searchParams.get('sort') as RedditSort | null;
        const time = searchParams.get('time') || 'all';

        // Validate inputs
        if (!keywords || keywords.length === 0) {
            return NextResponse.json(
                { error: 'Keywords parameter is required' },
                { status: 400 }
            );
        }

        if (keywords.length > 200) {
            return NextResponse.json(
                { error: 'Keywords must be less than 200 characters' },
                { status: 400 }
            );
        }

        const validTimeRanges: TimeRange[] = ['hour', 'day', 'week', '15d', 'month', 'year', 'all'];
        const isTimeRange = (value: string): value is TimeRange =>
            validTimeRanges.includes(value as TimeRange);

        if (!isTimeRange(time)) {
            return NextResponse.json(
                { error: 'Invalid time parameter' },
                { status: 400 }
            );
        }
        const timeRange: TimeRange = time;

        const sortType: RedditSort = sort === 'hot' || sort === 'relevance' ? sort : 'top';

        // Check cache first
        const cacheKey = makeCacheKey('reddit-search', keywords, sortType, time);
        const cached = await cacheGet<SearchResponse>(cacheKey);

        if (cached) {
            return NextResponse.json(cached);
        }

        // Check rate limit
        const ip = request.headers.get('x-forwarded-for') ||
            request.headers.get('x-real-ip') ||
            'anonymous';
        const rateCheck = rateLimiter.check(ip);

        if (!rateCheck.allowed) {
            return NextResponse.json(
                {
                    error: 'Rate limit exceeded. Please wait before searching again.',
                    retryAfter: rateCheck.retryAfter,
                },
                {
                    status: 429,
                    headers: {
                        'Retry-After': String(Math.ceil((rateCheck.retryAfter || 2000) / 1000)),
                    },
                }
            );
        }

        // Fetch from Reddit
        const posts = await searchReddit(keywords, 25, sortType, timeRange);

        const response: SearchResponse = {
            posts,
            cached: false,
            cacheAge: 0,
            query: keywords,
            sort: sortType,
            totalResults: posts.length,
        };

        // Cache the response
        await cacheSet(cacheKey, response, TTL.SEARCH_RESULTS);

        return NextResponse.json(response);
    } catch (error) {
        console.error('Reddit API error:', error);

        // Handle specific error types
        if (error instanceof Error) {
            if (error.message.includes('429') || error.message.includes('Too Many')) {
                return NextResponse.json(
                    { error: 'Reddit is rate limiting us. Please try again in a few seconds.' },
                    { status: 429 }
                );
            }
            if (error.message.includes('timeout') || error.message.includes('ECONNABORTED')) {
                return NextResponse.json(
                    { error: 'Reddit is taking too long to respond. Please try again.' },
                    { status: 504 }
                );
            }
        }

        return NextResponse.json(
            { error: 'Failed to fetch Reddit data. Please try again later.', detail: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}
