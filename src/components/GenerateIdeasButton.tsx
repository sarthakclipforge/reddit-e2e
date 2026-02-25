"use client";

import { Button } from "@/components/ui/button";
import { Sparkles, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { RedditPost, ContentIdea } from "@/types";
import { PROMPT_KEYS, getPrompt, DEFAULT_IDEAS_PROMPT, DEFAULT_HOOKS_PROMPT } from "@/lib/promptStore";
import { useApiUsage } from "@/context/ApiUsageContext";
import { getStoredApiKey } from "@/components/ApiKeyManager";

interface GenerateIdeasButtonProps {
    posts: RedditPost[];
    onIdeasGenerated: (ideas: ContentIdea[]) => void;
    selectedCount?: number; // how many the user explicitly selected (0 = auto top-3)
    isLoading?: boolean;
}

// Minimum remaining tokens we consider "safe" to fire Generate Ideas
const LOW_TOKEN_THRESHOLD = 3000;

export default function GenerateIdeasButton({
    posts,
    onIdeasGenerated,
    selectedCount = 0,
}: GenerateIdeasButtonProps) {
    const [loading, setLoading] = useState(false);
    const [lowTokenWarning, setLowTokenWarning] = useState(false);
    const { updateUsage, usage } = useApiUsage();

    const handleGenerate = async () => {
        if (posts.length === 0) return;

        // ── Optimization 5: Token budget warning ────────────────────────────
        // If remaining tokens are known and low, show a brief warning instead
        // of firing and getting a silent 429.
        if (usage && usage.remaining < LOW_TOKEN_THRESHOLD) {
            setLowTokenWarning(true);
            setTimeout(() => setLowTokenWarning(false), 6000);
            return;
        }

        setLoading(true);
        try {
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

    const postCount = posts.length;
    const label = selectedCount > 0
        ? `Generate Ideas (${selectedCount} selected)`
        : `Generate Ideas (top ${postCount})`;

    return (
        <div className="flex flex-col gap-1.5">
            <Button
                onClick={handleGenerate}
                disabled={loading || postCount === 0}
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
                        {label}
                    </>
                )}
            </Button>

            {/* Token budget warning (Optimization 5) */}
            {lowTokenWarning && (
                <div className="flex items-start gap-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 max-w-xs">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
                        Token budget is low. Wait ~{usage?.resetInSeconds ?? 60}s before generating ideas.
                    </span>
                </div>
            )}
        </div>
    );
}
