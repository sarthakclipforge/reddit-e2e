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

        // Limit to top 5 posts to stay well within the 12k TPM rate limit
        const topPosts = posts.slice(0, 5);
        const topic = topPosts[0].subreddit;

        console.log(`Analyzing ${topPosts.length} posts for topic: ${topic}`);

        // Character cap per post discussion block (~800 chars keeps tokens low)
        const MAX_CHARS_PER_POST = 800;

        // Fetch comments for these posts in parallel
        const postsData = await Promise.all(
            topPosts.map(async (post: RedditPost) => {
                // Use the stored Reddit permalink directly — link may be an external URL
                const comments = await getPostDetails(post.permalink);

                // If no comments fetched, fall back to the post's own snippet (body text)
                const commentText = comments || post.snippet || '';

                const block = `Title: ${post.title}\nSubreddit: ${post.subreddit}\nUpvotes: ${post.upvotes}\nComments:\n${commentText}`;
                // Truncate to cap token usage per post
                return block.length > MAX_CHARS_PER_POST
                    ? block.substring(0, MAX_CHARS_PER_POST) + '…'
                    : block;
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

        // Run sequentially (not parallel) to avoid burning through the per-minute token limit
        const ideasResult = await generateContentIdeas(topic, validDiscussions, ideasPrompt || undefined, apiKeyOverride);
        const hooksResult = await generateViralHooks(validDiscussions, hooksPrompt || undefined, apiKeyOverride);

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
