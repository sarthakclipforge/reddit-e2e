# ADR 001: Initial Architecture

## Date: 2026-02-19

## Status: Accepted

## Context
The project is a "Reddit Search Scraper" designed to search Reddit, export data to Google Sheets/Excel, and use AI for content ideas and summarization.

## Decision
We are using the following tech stack:
- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4 + shadcn/ui
- **AI**: Groq API (Llama 3.3 70b) via OpenAI-compatible endpoints
- **Data Export**: SheetJS (XLSX) and Google Sheets API
- **State Management**: TanStack React Query

## Consequences
- **Groq**: Provides low-latency, high-performance AI completions.
- **Next.js**: Enables SEO, fast routing, and server-side logic for API integrations.
- **Google Sheets**: Requires OAuth 2.0 configuration, ensuring secure user data access.
