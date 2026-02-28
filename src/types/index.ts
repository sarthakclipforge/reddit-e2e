// Core data types for the Reddit Search Scraper

export interface RedditPost {
    id: string;
    title: string;
    upvotes: number;
    comments: number;
    link: string;
    subreddit: string;
    created: string; // ISO date string
    author: string;
    relevanceScore?: number;
    selftext?: string;
    thumbnail?: string | null;
    upvote_ratio?: number;
    created_utc?: number;
    frequencyBonus?: number;
    semanticScore?: number;
    hScore?: number;
}

export interface SearchParams {
    keywords: string;
    sort: 'top' | 'hot' | 'relevance';
    time?: TimeRange;
}

export interface SearchResponse {
    posts: RedditPost[];
    cached: boolean;
    cacheAge?: number; // seconds since cached
    query: string;
    sort: string;
    totalResults: number;
}

export interface GoogleAuthTokens {
    access_token: string;
    refresh_token: string;
    expiry_date: number;
    email?: string;
}

export interface GoogleAuthStatus {
    authenticated: boolean;
    email?: string;
}

export interface ExportResult {
    success: boolean;
    spreadsheetUrl?: string;
    error?: string;
}

export type SortField = 'upvotes' | 'comments' | 'created' | 'title' | 'subreddit' | 'relevance';
export type SortDirection = 'asc' | 'desc';

export interface SortConfig {
    field: SortField;
    direction: SortDirection;
}

export type TimeRange = 'hour' | 'day' | 'week' | '15d' | 'month' | 'year' | 'all';

export interface FilterStats {
    input: number;
    semanticPass?: number;
    analyzed?: number;
    output: number;
}

export interface ContextSearchResponse {
    posts: RedditPost[];
    queryContext?: string[];
    filterStats?: FilterStats;
    cached?: boolean;
    totalResults?: number;
    query?: string;
    cacheAge?: number;
}

export interface ContentIdea {
    hook: string;
    concept: string;
    why: string;
    cta: string;
    hooks: string[];
}

export interface VideoScripts {
    variation1: string; // Direct + Tactical
    variation2: string; // Story + Emotional
}
