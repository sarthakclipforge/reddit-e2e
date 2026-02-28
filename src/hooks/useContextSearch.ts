
import { useState, useCallback } from 'react';
import { RedditPost } from '@/types';
import { useApiUsage } from '@/context/ApiUsageContext';
import { getStoredApiKey } from '@/components/ApiKeyManager';

interface ContextSearchState {
    isLoading: boolean;
    status: 'idle' | 'analyzing' | 'fetching' | 'filtering' | 'completed';
    data: {
        posts: RedditPost[];
        totalResults: number;
        query: string;
        sort: string;
        cached?: boolean;
        cacheAge?: number;
        queryContext?: string[];
        filterStats?: any;
    } | null;
    error: string | null;
}

export function useContextSearch() {
    const [state, setState] = useState<ContextSearchState>({
        isLoading: false,
        status: 'idle',
        data: null,
        error: null,
    });

    const { updateUsage } = useApiUsage();

    const search = useCallback(async (query: string, strictness?: number, sort?: string, time?: string) => {
        setState(prev => ({
            ...prev,
            isLoading: true,
            status: 'analyzing',
            error: null
        }));

        try {
            const apiKey = getStoredApiKey();
            const headers: Record<string, string> = apiKey ? { 'x-groq-api-key': apiKey } : {};

            // Orchestration route handles everything
            const res = await fetch('/api/context/filter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({ query, strictness, sort, time }),
            });

            // Simulate progress states for better UI feel (since server does it all at once)
            setTimeout(() => setState(prev => ({ ...prev, status: 'fetching' })), 800);
            setTimeout(() => setState(prev => ({ ...prev, status: 'filtering' })), 2000);

            if (res.status === 429) {
                throw new Error('Too many requests — please wait a moment and try again');
            }

            if (res.status === 504) {
                throw new Error('Search timed out — please try again');
            }

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                const msg = errorData.error || 'Search failed';
                const details = errorData.details ? ` (${errorData.details})` : '';
                throw new Error(`${msg}${details}`);
            }

            const data = await res.json();

            setState({
                isLoading: false,
                status: 'completed',
                data: {
                    posts: data.posts,
                    totalResults: data.posts.length,
                    query: query,
                    sort: 'relevance',
                    cached: data.cached,
                    cacheAge: data.cacheAge,
                    queryContext: data.queryContext,
                    filterStats: data.filterStats
                },
                error: null
            });

        } catch (err: any) {
            console.error('Context search error:', err);
            setState({
                isLoading: false,
                status: 'idle',
                data: null,
                error: err.message || 'Unknown error occurred'
            });
        }
    }, []);

    const reset = useCallback(() => {
        setState({ isLoading: false, status: 'idle', data: null, error: null });
    }, []);

    return { ...state, search, reset };
}
