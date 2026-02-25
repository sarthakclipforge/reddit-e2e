/**
 * Search form component with keyword input, sort selector, and search button.
 * Includes 500ms debounce on the search action.
 */

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Loader2, Flame, TrendingUp, Calendar, SlidersHorizontal } from 'lucide-react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";


interface SearchFormProps {
    onSearch: (keywords: string, sort: 'top' | 'hot', time?: string, isContextMode?: boolean, strictness?: number) => void;
    isLoading: boolean;
    initialKeywords?: string;
    initialSort?: 'top' | 'hot';
    initialTime?: string;
}

export function SearchForm({ onSearch, isLoading, initialKeywords = '', initialSort = 'top', initialTime = 'all' }: SearchFormProps) {
    const [keywords, setKeywords] = useState(initialKeywords);
    const [sort, setSort] = useState<'top' | 'hot'>(initialSort);
    const [time, setTime] = useState(initialTime);
    const [isContextMode, setIsContextMode] = useState(false);
    const [strictness, setStrictness] = useState(0.75);
    const debounceTimer = useRef<NodeJS.Timeout | null>(null);

    // Clean up debounce timer on unmount
    useEffect(() => {
        return () => {
            if (debounceTimer.current) clearTimeout(debounceTimer.current);
        };
    }, []);

    const handleSubmit = useCallback(
        (e: React.FormEvent) => {
            e.preventDefault();
            if (!keywords.trim()) return;
            if (debounceTimer.current) clearTimeout(debounceTimer.current);

            // Immediate submit for Context Mode (no debounce needed as it's explicit)
            if (isContextMode) {
                onSearch(keywords.trim(), sort, time, true, strictness);
                return;
            }

            debounceTimer.current = setTimeout(() => {
                onSearch(keywords.trim(), sort, time, false);
            }, 100);
        },
        [keywords, sort, time, isContextMode, onSearch]
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (!keywords.trim() || isLoading) return;
                onSearch(keywords.trim(), sort, time, isContextMode, isContextMode ? strictness : undefined);
            }
        },
        [keywords, sort, time, isContextMode, strictness, isLoading, onSearch]
    );

    return (
        <form onSubmit={handleSubmit} className="w-full space-y-4">
            {/* Context Mode Toggle */}
            <div className="flex justify-end mb-2">
                <button
                    type="button"
                    onClick={() => setIsContextMode(!isContextMode)}
                    className={`text-xs flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all ${isContextMode
                        ? 'bg-purple-500/10 text-purple-600 border-purple-200 dark:border-purple-800'
                        : 'bg-muted/50 text-muted-foreground border-transparent hover:bg-muted'
                        }`}
                >
                    <div className={`w-2 h-2 rounded-full ${isContextMode ? 'bg-purple-500 animate-pulse' : 'bg-muted-foreground/30'}`} />
                    {isContextMode ? 'Context Mode Active' : 'Enable Context Mode'}
                </button>
            </div>

            {/* Keyword Input */}
            <div className="relative">
                <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 ${isContextMode ? 'text-purple-500' : 'text-muted-foreground'}`} />
                <Input
                    type="text"
                    placeholder={isContextMode ? "Describe what you're looking for (e.g. 'best laptop for coding under $1000')..." : "Search Reddit posts... (e.g., 'machine learning', 'web development')"}
                    value={keywords}
                    onChange={(e) => setKeywords(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className={`pl-10 h-12 text-base bg-background transition-colors ${isContextMode
                        ? 'border-purple-500/30 ring-purple-500/10 focus:border-purple-500/50'
                        : 'border-border/60 focus:border-primary/50'
                        }`}
                    aria-label="Search keywords"
                    maxLength={200}
                    disabled={isLoading}
                />
            </div>

            {/* Strictness Slider — only in Context Mode */}
            {isContextMode && (
                <div className="flex items-center gap-3 px-1">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                        <SlidersHorizontal className="h-3.5 w-3.5 text-purple-500" />
                        <span className="font-medium">Strictness</span>
                    </div>
                    <input
                        type="range"
                        min="0.50"
                        max="0.95"
                        step="0.05"
                        value={strictness}
                        onChange={(e) => setStrictness(parseFloat(e.target.value))}
                        className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer accent-purple-500 bg-purple-500/20"
                        aria-label="Semantic filter strictness"
                    />
                    <span className="text-xs font-mono text-purple-500 w-[70px] text-right shrink-0">
                        {strictness <= 0.55 ? 'Lenient' : strictness <= 0.70 ? 'Normal' : strictness <= 0.85 ? 'Strict' : 'Very Strict'}
                    </span>
                </div>
            )}

            {/* Sort + Search Row */}
            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
                {/* Sort Radio Buttons */}
                <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
                    <button
                        type="button"
                        onClick={() => setSort('top')}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-all ${sort === 'top'
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                            }`}
                        aria-label="Sort by Top"
                    >
                        <TrendingUp className="h-4 w-4" />
                        Top
                    </button>
                    <button
                        type="button"
                        onClick={() => setSort('hot')}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-all ${sort === 'hot'
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                            }`}
                        aria-label="Sort by Hot"
                    >
                        <Flame className="h-4 w-4" />
                        Hot
                    </button>
                </div>

                {/* Time Range Select */}
                <Select value={time} onValueChange={setTime}>
                    <SelectTrigger className="w-full sm:w-[140px] h-10 bg-muted/50 border-0 focus:ring-1 focus:ring-primary/20">
                        <Calendar className="mr-2 h-4 w-4 text-muted-foreground" />
                        <SelectValue placeholder="Time Range" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="hour">Last Hour</SelectItem>
                        <SelectItem value="day">Last 24 Hours</SelectItem>
                        <SelectItem value="week">Last Week</SelectItem>
                        <SelectItem value="15d">Last 15 Days</SelectItem>
                        <SelectItem value="month">Last Month</SelectItem>
                        <SelectItem value="year">Last Year</SelectItem>
                        <SelectItem value="all">Lifetime</SelectItem>
                    </SelectContent>
                </Select>

                {/* Search Button */}
                <Button
                    type="submit"
                    disabled={!keywords.trim() || isLoading}
                    className={`h-10 px-6 sm:ml-auto text-white border-0 shadow-md hover:shadow-lg transition-all ${isContextMode
                        ? 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700'
                        : 'bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600'
                        }`}
                >
                    {isLoading ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            {isContextMode ? 'Analyzing...' : 'Searching...'}
                        </>
                    ) : (
                        <>
                            {isContextMode ? <div className="mr-2">✨</div> : <Search className="mr-2 h-4 w-4" />}
                            {isContextMode ? 'Deep Search' : 'Search Reddit'}
                        </>
                    )}
                </Button>
            </div>
        </form>
    );
}
