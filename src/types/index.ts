// Core data types for the Reddit Search Scraper

export interface RedditPost {
    id: string;
    title: string;
    upvotes: number;
    comments: number;
    link: string;
    permalink: string; // Reddit thread path e.g. /r/sub/comments/id/title/
    snippet: string;   // Post body text (selftext)
    subreddit: string;
    created: string; // ISO date string
    author: string;
    relevanceScore?: number;
    reason?: string; // 1-2 line reason why this post was selected (Context Mode)
}

export interface SearchParams {
    keywords: string;
    sort: 'top' | 'hot' | 'relevance';
    time?: string;
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
