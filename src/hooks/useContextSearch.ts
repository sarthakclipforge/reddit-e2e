
import { useState, useCallback } from 'react';
import { ContextSearchResponse } from '@/types';
import { getStoredApiKey } from '@/components/ApiKeyManager';

type ContextSearchStatus = 'idle' | 'analyzing' | 'fetching' | 'filtering' | 'done' | 'error';

interface ContextSearchState {
    isLoading: boolean;
    status: ContextSearchStatus;
    data: ContextSearchResponse | null;
    error: string | null;
}

export function useContextSearch() {
    const [state, setState] = useState<ContextSearchState>({
        isLoading: false,
        status: 'idle',
        data: null,
        error: null,
    });

    const search = useCallback(async (query: string, sort?: 'top' | 'hot' | 'relevance', time?: string) => {
        setState((prev) => ({ ...prev, isLoading: true, status: 'analyzing', error: null }));

        try {
            const apiKey = getStoredApiKey();
            const headers: Record<string, string> = apiKey ? { 'x-groq-api-key': apiKey } : {};
            setState((prev) => ({ ...prev, status: 'fetching' }));

            const res = await fetch('/api/context/filter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({ query, sort, time }),
            });

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

            const data = (await res.json()) as ContextSearchResponse;
            setState((prev) => ({ ...prev, status: 'filtering' }));

            setState({
                isLoading: false,
                status: 'done',
                data,
                error: null
            });

        } catch (error: unknown) {
            console.error('Context search error:', error);
            setState({
                isLoading: false,
                status: 'error',
                data: null,
                error: error instanceof Error ? error.message : 'Unknown error occurred'
            });
        }
    }, []);

    const reset = useCallback(() => {
        setState({ isLoading: false, status: 'idle', data: null, error: null });
    }, []);

    return { ...state, search, reset };
}
