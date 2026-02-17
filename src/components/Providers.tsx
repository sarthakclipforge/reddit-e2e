/**
 * React Query + Toast providers wrapper.
 */

'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import { ApiUsageProvider } from '@/context/ApiUsageContext';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        refetchOnWindowFocus: false,
                    },
                },
            })
    );

    return (
        <QueryClientProvider client={queryClient}>
            <ApiUsageProvider>
                {children}
            </ApiUsageProvider>
            <Toaster richColors position="bottom-right" />
        </QueryClientProvider>
    );
}
