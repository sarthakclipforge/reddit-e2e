import { NextRequest, NextResponse } from 'next/server';
import { getPostDetails } from '@/lib/reddit';
import { generateContentIdeas, generateViralHooks } from '@/lib/ai';
import { RedditPost } from '@/types';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { posts, ideasPrompt, hooksPrompt } = body;
        const apiKeyOverride = request.headers.get('x-groq-api-key') || undefined;

        if (!posts || !Array.isArray(posts) || posts.length === 0) {
            return NextResponse.json(
                { error: 'Invalid posts data provided.' },
                { status: 400 }
            );
        }

        // Limit to top 10 posts to avoid hitting rate limits and consuming too many tokens
        const topPosts = posts.slice(0, 10);
        const topic = topPosts[0].subreddit;

        console.log(`Analyzing ${topPosts.length} posts for topic: ${topic}`);

        // Fetch comments for these posts in parallel
        const postsData = await Promise.all(
            topPosts.map(async (post: RedditPost) => {
                const permalink = post.link.replace('https://www.reddit.com', '');
                const comments = await getPostDetails(permalink);

                return `
                Title: ${post.title}
                Subreddit: ${post.subreddit}
                Upvotes: ${post.upvotes}
                Comments:
                ${comments}
                `;
            })
        );

        // Filter out empty results
        const validDiscussions = postsData.filter(text => text.trim().length > 0);

        if (validDiscussions.length === 0) {
            return NextResponse.json(
                { error: 'Could not fetch details for selected posts.' },
                { status: 500 }
            );
        }

        // Generate ideas and viral hooks in parallel
        const [ideasResult, hooksResult] = await Promise.all([
            generateContentIdeas(topic, validDiscussions, ideasPrompt || undefined, apiKeyOverride),
            generateViralHooks(validDiscussions, hooksPrompt || undefined, apiKeyOverride),
        ]);

        // Distribute hooks across ideas (2 per idea)
        const ideas = ideasResult.ideas.map((idea, i) => {
            const startIdx = i * 2;
            const ideaHooks = hooksResult.hooks.slice(startIdx, startIdx + 2);
            return { ...idea, hooks: ideaHooks };
        });

        // Return the latest rate limit info (from whichever finished last)
        return NextResponse.json({
            ideas,
            rateLimit: hooksResult.rateLimit,
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Error in analyze route:', errorMessage, error);
        return NextResponse.json(
            { error: `Failed to generate ideas: ${errorMessage}` },
            { status: 500 }
        );
    }
}
