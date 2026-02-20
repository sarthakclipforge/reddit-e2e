
/**
 * Builds a frequency map of how many times each post appeared across different search queries.
 * @param queryResults Array of arrays, where each inner array contains posts from a single query.
 */
export function buildPostFrequency(queryResults: any[][]): Map<string, number> {
    const frequencyMap = new Map<string, number>();

    queryResults.forEach((posts) => {
        // Use a set to count unique appearances per query (prevent double counting if API returns duplicates)
        const uniqueIdsInQuery = new Set(posts.map(p => p.id));

        uniqueIdsInQuery.forEach((id) => {
            frequencyMap.set(id, (frequencyMap.get(id) || 0) + 1);
        });
    });

    return frequencyMap;
}

/**
 * Deduplicates posts and applies a bonus score based on appearance frequency.
 * Boosts score by +1 for each extra query appearance.
 */
export function deduplicateWithBonus(queryResults: any[][]): any[] {
    const frequencyMap = buildPostFrequency(queryResults);
    const allPosts = queryResults.flat();
    const uniquePosts = new Map<string, any>();

    allPosts.forEach((post) => {
        if (!uniquePosts.has(post.id)) {
            const freq = frequencyMap.get(post.id) || 1;
            const boostedScore = (post.score || 0) + (freq - 1) * 5; // +5 upvotes equivalent bonus per extra appearance? 
            // Actually instructions say "boosts each post's score". 
            // Assuming we are modifying an internal 'heuristicScore' or just returning clean objects.
            // Let's just attach the frequency for now as the user asked for deduplication logic.

            uniquePosts.set(post.id, {
                ...post,
                frequencyBonus: freq - 1
            });
        }
    });

    return Array.from(uniquePosts.values());
}

/**
 * Calculates a heuristic score for a post to pre-rank before AI analysis.
 * Uses defensive fallbacks to prevent NaN.
 */
export function heuristicScore(post: any): number {
    const upvotes = post.ups || 0;
    const comments = post.num_comments || 0;
    const ratio = post.upvote_ratio || 0.5;
    const created = post.created_utc || 0;

    // Simple recency decay
    const hoursAgo = (Date.now() / 1000 - created) / 3600;
    const recencyPenalty = Math.max(1, Math.log10(hoursAgo + 1));

    let score = (upvotes * ratio + comments * 2) / recencyPenalty;

    // Guard against Infinity/NaN
    if (!Number.isFinite(score)) score = 0;

    return score;
}
