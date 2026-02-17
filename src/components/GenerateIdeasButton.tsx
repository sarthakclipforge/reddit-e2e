"use client";

import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { RedditPost, ContentIdea } from "@/types";
import { PROMPT_KEYS, getPrompt, DEFAULT_IDEAS_PROMPT, DEFAULT_HOOKS_PROMPT } from "@/lib/promptStore";
import { useApiUsage } from "@/context/ApiUsageContext";
import { getStoredApiKey } from "@/components/ApiKeyManager";

interface GenerateIdeasButtonProps {
    posts: RedditPost[];
    onIdeasGenerated: (ideas: ContentIdea[]) => void;
    isLoading?: boolean;
}

export default function GenerateIdeasButton({
    posts,
    onIdeasGenerated,
}: GenerateIdeasButtonProps) {
    const [loading, setLoading] = useState(false);
    const { updateUsage } = useApiUsage();

    const handleGenerate = async () => {
        if (posts.length === 0) return;

        setLoading(true);
        try {
            // Read custom prompts from localStorage (if any)
            const ideasPrompt = getPrompt(PROMPT_KEYS.IDEAS, DEFAULT_IDEAS_PROMPT);
            const hooksPrompt = getPrompt(PROMPT_KEYS.HOOKS, DEFAULT_HOOKS_PROMPT);
            const userApiKey = getStoredApiKey();

            const headers: Record<string, string> = {
                "Content-Type": "application/json",
            };
            if (userApiKey) {
                headers["x-groq-api-key"] = userApiKey;
            }

            const response = await fetch("/api/analyze", {
                method: "POST",
                headers,
                body: JSON.stringify({ posts, ideasPrompt, hooksPrompt }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Failed to generate ideas");
            }

            // Update API usage bar
            if (data.rateLimit) {
                updateUsage(data.rateLimit);
            }

            onIdeasGenerated(data.ideas);
        } catch (error) {
            console.error("Error generating ideas:", error);
            alert("Failed to generate ideas. Please check console and try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Button
            onClick={handleGenerate}
            disabled={loading || posts.length === 0}
            className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700"
        >
            {loading ? (
                <>
                    <Sparkles className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                </>
            ) : (
                <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Generate Ideas
                </>
            )}
        </Button>
    );
}
