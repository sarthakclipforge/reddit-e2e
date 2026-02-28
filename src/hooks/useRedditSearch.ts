/**
 * React Query hook for Reddit search.
 * Manages search state, loading, errors, and caching.
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { SearchResponse } from '@/types';

type RedditSort = 'top' | 'hot' | 'relevance';

async function searchReddit(keywords: string, sort: RedditSort, time?: string): Promise<SearchResponse> {
    const { data } = await axios.get<SearchResponse>('/api/reddit', {
        params: { keywords, sort, time },
    });
    return data;
}

export function useRedditSearch(keywords: string, sort: RedditSort, time?: string) {
    return useQuery<SearchResponse>({
        queryKey: ['reddit-search', keywords, sort, time],
        queryFn: () => searchReddit(keywords, sort, time),
        enabled: keywords.length > 0,
        staleTime: 5 * 60 * 1000, // 5 minutes — matches server cache TTL
        retry: 2,
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
    });
}
