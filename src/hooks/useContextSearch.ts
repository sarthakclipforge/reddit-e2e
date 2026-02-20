
import { useState, useCallback } from 'react';
import { RedditPost } from '@/types';
import { useApiUsage } from '@/context/ApiUsageContext';
import { getStoredApiKey } from '@/components/ApiKeyManager';

interface ContextSearchState {
    isLoading: boolean;
    data: {
        posts: RedditPost[];
        queryContext?: string[];
        filterStats?: any;
        cached?: boolean;
    } | null;
    error: string | null;
}

export function useContextSearch() {
    const [state, setState] = useState<ContextSearchState>({
        isLoading: false,
        data: null,
        error: null,
    });

    const { updateUsage } = useApiUsage();

    const search = useCallback(async (query: string) => {
        setState(prev => ({ ...prev, isLoading: true, error: null }));

        try {
            const apiKey = getStoredApiKey();
            const headers: Record<string, string> = apiKey ? { 'x-groq-api-key': apiKey } : {};

            // Single call to the orchestration route
            const res = await fetch('/api/context/filter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({ query }),
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

            const data = await res.json();

            // Optional: Update usage if returned (not implemented in this simplified route yet)
            // if (data.rateLimit) updateUsage(...)

            setState({
                isLoading: false,
                data: data,
                error: null
            });

        } catch (err: any) {
            console.error('Context search error:', err);
            setState({
                isLoading: false,
                data: null,
                error: err.message || 'Unknown error occurred'
            });
        }
    }, [updateUsage]);

    const reset = useCallback(() => {
        setState({ isLoading: false, data: null, error: null });
    }, []);

    return { ...state, search, reset };
}
