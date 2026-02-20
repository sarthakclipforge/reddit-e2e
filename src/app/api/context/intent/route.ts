
import { NextRequest, NextResponse } from 'next/server';
import { generateSearchQueries } from '@/lib/ai';
import { cacheGet, cacheSet, makeCacheKey, TTL } from '@/lib/cache';

export async function POST(req: NextRequest) {
    try {
        const { query } = await req.json();

        // 1. Validate Input
        let cleanQuery = (query || '').trim().slice(0, 200);
        cleanQuery = cleanQuery.replace(/[<>"]/g, ''); // Basic XSS prevention

        if (cleanQuery.length < 2) {
            return NextResponse.json({ error: 'Query too short' }, { status: 400 });
        }

        // 2. Check Cache
        const cacheKey = makeCacheKey('intent', cleanQuery);
        const cached = await cacheGet(cacheKey);
        if (cached) {
            return NextResponse.json(cached);
        }

        // 3. Generate
        const apiKey = req.headers.get('x-groq-api-key') || undefined;
        const result = await generateSearchQueries(cleanQuery, apiKey);

        // 4. Cache Result
        await cacheSet(cacheKey, result, TTL.INTENT_ANALYSIS);

        return NextResponse.json(result);

    } catch (error: any) {
        console.error('Intent API Error:', error);

        const msg = error.message || '';
        if (msg.includes('timed out')) {
            return NextResponse.json(
                { error: 'Intent analysis timed out. Please try again.' },
                { status: 504 }
            );
        }

        return NextResponse.json(
            { error: 'Failed to analyze intent', details: msg },
            { status: 500 }
        );
    }
}
