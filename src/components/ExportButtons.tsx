/**
 * Export buttons component for XLSX download and Google Sheets export.
 */

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { RedditPost } from '@/types';
import { exportToXLSX } from '@/lib/xlsx-export';
import { useGoogleAuth } from '@/hooks/useGoogleAuth';
import { toast } from 'sonner';
import axios from 'axios';
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react';

interface ExportButtonsProps {
    posts: RedditPost[];
    keywords: string;
    disabled?: boolean;
}

export function ExportButtons({ posts, keywords, disabled }: ExportButtonsProps) {
    const { isAuthenticated } = useGoogleAuth();
    const [isExportingSheets, setIsExportingSheets] = useState(false);

    const handleXLSXDownload = async () => {
        try {
            await exportToXLSX(posts, keywords);
            toast.success('Excel file downloaded!', {
                description: `Exported ${posts.length} posts to XLSX`,
            });
        } catch (error) {
            console.error('XLSX export error:', error);
            toast.error('Failed to download Excel file', {
                description: 'Please try again.',
            });
        }
    };

    const handleSheetsExport = async () => {
        if (!isAuthenticated) {
            toast.error('Not connected to Google', {
                description: 'Please connect your Google account in Settings first.',
            });
            return;
        }

        setIsExportingSheets(true);
        try {
            const { data } = await axios.post('/api/google/sheets', {
                posts,
                keywords,
            });

            if (data.success && data.spreadsheetUrl) {
                toast.success('Exported to Google Sheets!', {
                    description: 'Your spreadsheet is ready.',
                    action: {
                        label: 'Open Sheet',
                        onClick: () => window.open(data.spreadsheetUrl, '_blank'),
                    },
                    duration: 8000,
                });
            }
        } catch (error) {
            console.error('Google Sheets export error:', error);
            const errorMessage =
                axios.isAxiosError(error) && error.response?.data?.error
                    ? error.response.data.error
                    : 'Failed to export to Google Sheets. Try downloading as Excel instead.';
            toast.error('Google Sheets export failed', {
                description: errorMessage,
            });
        } finally {
            setIsExportingSheets(false);
        }
    };

    return (
        <div className="flex flex-wrap gap-2">
            <Button
                onClick={handleXLSXDownload}
                disabled={disabled || posts.length === 0}
                variant="outline"
                className="gap-2 border-green-500/30 text-green-600 hover:bg-green-500/10 hover:text-green-500 dark:text-green-400 dark:hover:text-green-300"
            >
                <Download className="h-4 w-4" />
                Download Excel
            </Button>

            <Button
                onClick={handleSheetsExport}
                disabled={disabled || posts.length === 0 || isExportingSheets || !isAuthenticated}
                variant="outline"
                className="gap-2 border-blue-500/30 text-blue-600 hover:bg-blue-500/10 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
                title={!isAuthenticated ? 'Connect Google account in Settings first' : 'Export to Google Sheets'}
            >
                {isExportingSheets ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                    <FileSpreadsheet className="h-4 w-4" />
                )}
                {isExportingSheets ? 'Exporting...' : 'Google Sheets'}
            </Button>
        </div>
    );
}
