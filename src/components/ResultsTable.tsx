/**
 * Sortable results table for displaying Reddit posts.
 * Supports client-side sorting on all columns.
 * Each row has a checkbox so the user can pick posts for Generate Ideas.
 */

'use client';

import { useState, useMemo, useEffect } from 'react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { RedditPost, SortField, SortConfig } from '@/types';
import { ArrowUpDown, ArrowUp, ArrowDown, ExternalLink, MessageSquare, ThumbsUp, Sparkles } from 'lucide-react';

interface ResultsTableProps {
    posts: RedditPost[];
    isLoading: boolean;
    totalResults: number;
    cached?: boolean;
    cacheAge?: number;
    query?: string;
    onSelectionChange?: (selectedPosts: RedditPost[]) => void;
}

function formatDate(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
    return `${Math.floor(diffDays / 365)}y ago`;
}

function formatNumber(num: number): string {
    if (num === undefined || num === null || !Number.isFinite(num)) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

function SortIcon({ field, sortConfig }: { field: SortField; sortConfig: SortConfig }) {
    if (sortConfig.field !== field) {
        return <ArrowUpDown className="ml-1 h-3.5 w-3.5 text-muted-foreground/50" />;
    }
    return sortConfig.direction === 'asc' ? (
        <ArrowUp className="ml-1 h-3.5 w-3.5 text-primary" />
    ) : (
        <ArrowDown className="ml-1 h-3.5 w-3.5 text-primary" />
    );
}

const MAX_SELECTION = 5;

export function ResultsTable({
    posts,
    isLoading,
    totalResults,
    cached,
    cacheAge,
    query,
    onSelectionChange,
}: ResultsTableProps) {
    const [sortConfig, setSortConfig] = useState<SortConfig>({
        field: 'upvotes',
        direction: 'desc',
    });
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const hasRelevance = useMemo(() => posts.some(p => p.relevanceScore !== undefined), [posts]);

    // Stable fingerprint of the current post list — avoids re-firing effects
    // every render just because the parent passed a new array reference.
    const postsFingerprint = useMemo(
        () => posts.map(p => p.id).join(','),
        [posts]
    );

    // Auto-switch to relevance sorting when context mode results arrive
    useEffect(() => {
        if (hasRelevance) {
            setSortConfig({ field: 'relevance', direction: 'desc' });
        } else {
            setSortConfig({ field: 'upvotes', direction: 'desc' });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [postsFingerprint]);

    // Clear selection whenever the result set truly changes (new search).
    // Do NOT call onSelectionChange here — that would trigger a parent
    // re-render → new array ref → this effect fires again → infinite loop.
    // The parent resets selectedPosts explicitly in handleSearch instead.
    useEffect(() => {
        setSelectedIds(new Set());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [postsFingerprint]);

    const handleSort = (field: SortField) => {
        setSortConfig((prev) => ({
            field,
            direction: prev.field === field && prev.direction === 'desc' ? 'asc' : 'desc',
        }));
    };

    const sortedPosts = useMemo(() => {
        const sorted = [...posts];
        sorted.sort((a, b) => {
            const dir = sortConfig.direction === 'asc' ? 1 : -1;
            switch (sortConfig.field) {
                case 'relevance':
                    return ((a.relevanceScore || 0) - (b.relevanceScore || 0)) * dir;
                case 'upvotes':
                    return (a.upvotes - b.upvotes) * dir;
                case 'comments':
                    return (a.comments - b.comments) * dir;
                case 'created':
                    return (new Date(a.created).getTime() - new Date(b.created).getTime()) * dir;
                case 'title':
                    return a.title.localeCompare(b.title) * dir;
                case 'subreddit':
                    return a.subreddit.localeCompare(b.subreddit) * dir;
                default:
                    return 0;
            }
        });
        return sorted;
    }, [posts, sortConfig]);

    // Toggle one row
    const togglePost = (post: RedditPost) => {
        const next = new Set(selectedIds);
        if (next.has(post.id)) {
            next.delete(post.id);
        } else {
            if (next.size >= MAX_SELECTION) return; // hard cap
            next.add(post.id);
        }

        // Update local state
        setSelectedIds(next);

        // Notify parent OUTSIDE of the set state updater function 
        // to prevent React warnings about updating other components during render
        const selected = posts.filter(p => next.has(p.id));
        onSelectionChange?.(selected);
    };

    // Select / deselect all (capped at MAX_SELECTION)
    const toggleAll = () => {
        if (selectedIds.size > 0) {
            setSelectedIds(new Set());
            onSelectionChange?.([]);
        } else {
            const toSelect = sortedPosts.slice(0, MAX_SELECTION);
            const next = new Set(toSelect.map(p => p.id));
            setSelectedIds(next);
            onSelectionChange?.(toSelect);
        }
    };

    const allVisibleSelected =
        sortedPosts.length > 0 &&
        sortedPosts.slice(0, MAX_SELECTION).every(p => selectedIds.has(p.id));

    // Matches relevance score to a color
    const getScoreColor = (score: number) => {
        if (score >= 9) return 'text-green-600 bg-green-500/10 border-green-200';
        if (score >= 7) return 'text-blue-600 bg-blue-500/10 border-blue-200';
        if (score >= 5) return 'text-orange-600 bg-orange-500/10 border-orange-200';
        return 'text-gray-500 bg-gray-100 border-gray-200';
    };

    // Loading skeleton
    if (isLoading) {
        return (
            <div className="space-y-3 mt-6">
                <Skeleton className="h-5 w-48" />
                <div className="rounded-xl border border-border/60 overflow-hidden">
                    <div className="bg-muted/30 p-3">
                        <div className="flex gap-4">
                            {[1, 2, 3, 4, 5].map((i) => (
                                <Skeleton key={i} className="h-4 w-20" />
                            ))}
                        </div>
                    </div>
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="flex items-center gap-4 p-3 border-t border-border/30">
                            <Skeleton className="h-4 flex-1" />
                            <Skeleton className="h-4 w-16" />
                            <Skeleton className="h-4 w-12" />
                            <Skeleton className="h-4 w-12" />
                            <Skeleton className="h-4 w-14" />
                            <Skeleton className="h-4 w-8" />
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (posts.length === 0) {
        return null;
    }

    return (
        <div className="space-y-3 mt-6">
            {/* Results header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex items-center gap-2">
                    <h2 className="text-sm font-medium text-foreground">
                        Showing <span className="font-bold text-primary">{totalResults}</span> results
                        {query && (
                            <>
                                {' '}for{' '}
                                <span className="font-semibold text-foreground">&ldquo;{query}&rdquo;</span>
                            </>
                        )}
                    </h2>
                </div>
                <div className="flex items-center gap-3">
                    {selectedIds.size > 0 && (
                        <span className="text-xs text-muted-foreground">
                            {selectedIds.size}/{MAX_SELECTION} selected for Ideas
                        </span>
                    )}
                    {cached && cacheAge !== undefined && (
                        <Badge variant="secondary" className="text-xs w-fit">
                            📋 Cached result • {cacheAge < 60 ? `${cacheAge}s` : `${Math.floor(cacheAge / 60)}m`} ago
                        </Badge>
                    )}
                </div>
            </div>

            {/* Table */}
            <div className="rounded-xl border border-border/60 overflow-hidden bg-card shadow-sm">
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-muted/40 hover:bg-muted/40">
                                {/* Select-all checkbox */}
                                <TableHead className="w-10 text-center">
                                    <Checkbox
                                        checked={allVisibleSelected}
                                        onCheckedChange={toggleAll}
                                        aria-label="Select top posts"
                                        className="mx-auto"
                                    />
                                </TableHead>
                                {hasRelevance && (
                                    <TableHead
                                        className="cursor-pointer select-none hover:text-foreground transition-colors w-[100px]"
                                        onClick={() => handleSort('relevance')}
                                    >
                                        <div className="flex items-center">
                                            <Sparkles className="h-3.5 w-3.5 mr-1 text-purple-500" />
                                            Score
                                            <SortIcon field="relevance" sortConfig={sortConfig} />
                                        </div>
                                    </TableHead>
                                )}
                                <TableHead
                                    className="cursor-pointer select-none hover:text-foreground transition-colors min-w-[250px]"
                                    onClick={() => handleSort('title')}
                                >
                                    <div className="flex items-center">
                                        Title
                                        <SortIcon field="title" sortConfig={sortConfig} />
                                    </div>
                                </TableHead>
                                <TableHead
                                    className="cursor-pointer select-none hover:text-foreground transition-colors"
                                    onClick={() => handleSort('subreddit')}
                                >
                                    <div className="flex items-center">
                                        Subreddit
                                        <SortIcon field="subreddit" sortConfig={sortConfig} />
                                    </div>
                                </TableHead>
                                <TableHead
                                    className="cursor-pointer select-none hover:text-foreground transition-colors text-right"
                                    onClick={() => handleSort('upvotes')}
                                >
                                    <div className="flex items-center justify-end">
                                        Upvotes
                                        <SortIcon field="upvotes" sortConfig={sortConfig} />
                                    </div>
                                </TableHead>
                                <TableHead
                                    className="cursor-pointer select-none hover:text-foreground transition-colors text-right"
                                    onClick={() => handleSort('comments')}
                                >
                                    <div className="flex items-center justify-end">
                                        Comments
                                        <SortIcon field="comments" sortConfig={sortConfig} />
                                    </div>
                                </TableHead>
                                <TableHead
                                    className="cursor-pointer select-none hover:text-foreground transition-colors"
                                    onClick={() => handleSort('created')}
                                >
                                    <div className="flex items-center">
                                        Posted
                                        <SortIcon field="created" sortConfig={sortConfig} />
                                    </div>
                                </TableHead>
                                <TableHead className="w-10">Link</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sortedPosts.map((post, index) => {
                                const isSelected = selectedIds.has(post.id);
                                const isDisabled = !isSelected && selectedIds.size >= MAX_SELECTION;
                                return (
                                    <TableRow
                                        key={post.id}
                                        className={`group transition-colors ${isSelected
                                            ? 'bg-violet-50/60 dark:bg-violet-950/20'
                                            : index % 2 === 0 ? '' : 'bg-muted/10'
                                            }`}
                                    >
                                        <TableCell className="text-center">
                                            <Checkbox
                                                checked={isSelected}
                                                disabled={isDisabled}
                                                onCheckedChange={() => togglePost(post)}
                                                aria-label={`Select post: ${post.title}`}
                                                className="mx-auto"
                                            />
                                        </TableCell>
                                        {hasRelevance && (
                                            <TableCell>
                                                <div className={`inline-flex items-center justify-center w-8 h-8 rounded-full border text-xs font-bold ${getScoreColor(post.relevanceScore || 0)}`}>
                                                    {post.relevanceScore}
                                                </div>
                                            </TableCell>
                                        )}
                                        <TableCell className="max-w-[400px]">
                                            <a
                                                href={post.link}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-sm font-medium text-foreground hover:text-primary transition-colors line-clamp-2"
                                                title={post.title}
                                            >
                                                {post.title}
                                            </a>
                                            {post.reason && post.reason.trim() !== '' && !post.reason.toLowerCase().includes('does not') && !post.reason.toLowerCase().includes('not direct') && !post.reason.toLowerCase().includes('not relat') && (
                                                <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed bg-muted/30 p-1.5 rounded-md border border-border/40">
                                                    <span className="font-semibold text-purple-600/80 dark:text-purple-400/80 mr-1">Why:</span>
                                                    {post.reason}
                                                </p>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className="text-xs font-normal whitespace-nowrap">
                                                {post.subreddit}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex items-center justify-end gap-1 text-sm">
                                                <ThumbsUp className="h-3.5 w-3.5 text-orange-500" />
                                                <span className="font-medium">{formatNumber(post.upvotes)}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex items-center justify-end gap-1 text-sm">
                                                <MessageSquare className="h-3.5 w-3.5 text-blue-500" />
                                                <span>{formatNumber(post.comments)}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-sm text-muted-foreground whitespace-nowrap">
                                                {formatDate(post.created)}
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            <a
                                                href={post.link}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted transition-colors"
                                                aria-label={`Open post: ${post.title}`}
                                            >
                                                <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                                            </a>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            </div>
        </div>
    );
}
