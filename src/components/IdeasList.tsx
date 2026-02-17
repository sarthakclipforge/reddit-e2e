"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Copy, Sparkles, Check, Lightbulb, Target, Megaphone, Flame, Clapperboard, X } from "lucide-react";
import { PROMPT_KEYS, getPrompt, DEFAULT_SCRIPTS_PROMPT } from "@/lib/promptStore";
import { useApiUsage } from "@/context/ApiUsageContext";
import { getStoredApiKey } from "@/components/ApiKeyManager";
import { useState } from "react";
import { ContentIdea, VideoScripts } from "@/types";
import { Badge } from "@/components/ui/badge";

interface IdeasListProps {
    ideas: ContentIdea[];
}

/**
 * Cleans raw script text — normalises escaped newlines into real line breaks.
 */
function cleanScriptText(raw: string): string {
    if (!raw) return "";
    return raw
        .replace(/\\n/g, "\n")   // literal \n → newline
        .replace(/\\t/g, "  ")   // literal \t → spaces
        .trim();
}

export default function IdeasList({ ideas }: IdeasListProps) {
    const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
    const [copiedScript, setCopiedScript] = useState<string | null>(null);
    const [scriptLoading, setScriptLoading] = useState<number | null>(null);
    const [scripts, setScripts] = useState<Record<number, VideoScripts>>({});
    const [dialogOpen, setDialogOpen] = useState(false);
    const [activeScriptIndex, setActiveScriptIndex] = useState<number | null>(null);
    const { updateUsage } = useApiUsage();

    const copyToClipboard = async (idea: ContentIdea, index: number) => {
        const hooksText = idea.hooks && idea.hooks.length > 0
            ? `\nViral Hooks:\n${idea.hooks.map((h, i) => `${i + 1}. ${h}`).join('\n')}`
            : '';
        const text = `Hook: ${idea.hook}\nConcept: ${idea.concept}\nWhy: ${idea.why}\nCTA: ${idea.cta}${hooksText}`;
        try {
            await navigator.clipboard.writeText(text);
            setCopiedIndex(index);
            setTimeout(() => setCopiedIndex(null), 2000);
        } catch (err) {
            console.error("Failed to copy:", err);
        }
    };

    const copyScriptVariation = async (text: string, key: string) => {
        try {
            await navigator.clipboard.writeText(cleanScriptText(text));
            setCopiedScript(key);
            setTimeout(() => setCopiedScript(null), 2000);
        } catch (err) {
            console.error("Failed to copy:", err);
        }
    };

    const handleGenerateScripts = async (idea: ContentIdea, index: number) => {
        setScriptLoading(index);
        try {
            const userApiKey = getStoredApiKey();
            const headers: Record<string, string> = {
                "Content-Type": "application/json",
            };
            if (userApiKey) {
                headers["x-groq-api-key"] = userApiKey;
            }

            const response = await fetch("/api/generate-scripts", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    hook: idea.hook,
                    concept: idea.concept,
                    scriptsPrompt: getPrompt(PROMPT_KEYS.SCRIPTS, DEFAULT_SCRIPTS_PROMPT),
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Failed to generate scripts");
            }
            // Update API usage bar
            if (data.rateLimit) {
                updateUsage(data.rateLimit);
            }

            setScripts(prev => ({ ...prev, [index]: { variation1: data.variation1, variation2: data.variation2 } }));
            setActiveScriptIndex(index);
            setDialogOpen(true);
        } catch (error) {
            console.error("Error generating scripts:", error);
            alert("Failed to generate scripts. Please try again.");
        } finally {
            setScriptLoading(null);
        }
    };

    const openScriptsDialog = (index: number) => {
        setActiveScriptIndex(index);
        setDialogOpen(true);
    };

    if (!ideas || ideas.length === 0) return null;

    const activeScripts = activeScriptIndex !== null ? scripts[activeScriptIndex] : null;
    const activeIdea = activeScriptIndex !== null ? ideas[activeScriptIndex] : null;

    return (
        <div className="mt-8 space-y-6">
            <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-violet-500/10">
                    <Sparkles className="h-6 w-6 text-violet-500" />
                </div>
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Generated Content Ideas</h2>
                    <p className="text-muted-foreground">AI-curated video concepts based on your search.</p>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {ideas.map((idea, index) => (
                    <Card key={index} className="group relative border-violet-500/10 hover:border-violet-500/30 transition-all duration-300 hover:shadow-lg bg-gradient-to-br from-card to-violet-500/5 flex flex-col">
                        <CardHeader className="pb-3">
                            <div className="flex justify-between items-start gap-4">
                                <Badge variant="outline" className="bg-violet-500/10 text-violet-600 border-violet-200 mb-2">
                                    Idea #{index + 1}
                                </Badge>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={() => copyToClipboard(idea, index)}
                                >
                                    {copiedIndex === index ? (
                                        <Check className="h-4 w-4 text-green-500" />
                                    ) : (
                                        <Copy className="h-4 w-4" />
                                    )}
                                    <span className="sr-only">Copy idea</span>
                                </Button>
                            </div>
                            <CardTitle className="text-lg leading-tight font-bold text-foreground/90">
                                &ldquo;{idea.hook}&rdquo;
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4 text-sm flex-1 flex flex-col">
                            <div className="space-y-1">
                                <div className="flex items-center gap-2 text-violet-600 font-medium text-xs uppercase tracking-wide">
                                    <Lightbulb className="h-3 w-3" /> Concept
                                </div>
                                <p className="text-muted-foreground leading-relaxed">{idea.concept}</p>
                            </div>

                            <div className="space-y-1">
                                <div className="flex items-center gap-2 text-amber-600 font-medium text-xs uppercase tracking-wide">
                                    <Target className="h-3 w-3" /> Why It Works
                                </div>
                                <p className="text-muted-foreground leading-relaxed">{idea.why}</p>
                            </div>

                            <div className="pt-2 border-t border-border/50 mt-2">
                                <div className="flex items-center gap-2 text-emerald-600 font-medium text-xs uppercase tracking-wide mb-1">
                                    <Megaphone className="h-3 w-3" /> CTA
                                </div>
                                <p className="font-medium text-foreground">{idea.cta}</p>
                            </div>

                            {/* Viral Hooks */}
                            {idea.hooks && idea.hooks.length > 0 && (
                                <div className="pt-3 border-t border-orange-500/20 mt-3 space-y-2">
                                    <div className="flex items-center gap-2 text-orange-500 font-medium text-xs uppercase tracking-wide">
                                        <Flame className="h-3 w-3" /> Viral Hooks
                                    </div>
                                    <div className="space-y-1.5">
                                        {idea.hooks.map((hook, hIdx) => (
                                            <div key={hIdx} className="flex items-start gap-2 p-2 rounded-lg bg-orange-500/5 border border-orange-500/10">
                                                <span className="flex-shrink-0 flex items-center justify-center h-5 w-5 rounded-full bg-orange-500/15 text-orange-500 font-bold text-[10px]">
                                                    {hIdx + 1}
                                                </span>
                                                <p className="text-xs text-foreground/80 leading-relaxed font-medium">
                                                    {hook}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Generate / View Scripts Button */}
                            <div className="pt-3 mt-auto">
                                {scripts[index] ? (
                                    <Button
                                        onClick={() => openScriptsDialog(index)}
                                        variant="outline"
                                        size="sm"
                                        className="w-full gap-2 border-sky-500/30 text-sky-500 hover:bg-sky-500/10 hover:text-sky-400 hover:border-sky-500/50"
                                    >
                                        <Clapperboard className="h-3.5 w-3.5" />
                                        View Scripts
                                    </Button>
                                ) : (
                                    <Button
                                        onClick={() => handleGenerateScripts(idea, index)}
                                        disabled={scriptLoading === index}
                                        variant="outline"
                                        size="sm"
                                        className="w-full gap-2 border-sky-500/20 text-sky-600 hover:bg-sky-500/10 hover:text-sky-700 hover:border-sky-500/40"
                                    >
                                        {scriptLoading === index ? (
                                            <>
                                                <Clapperboard className="h-3.5 w-3.5 animate-pulse" />
                                                Generating Scripts...
                                            </>
                                        ) : (
                                            <>
                                                <Clapperboard className="h-3.5 w-3.5" />
                                                Generate Scripts
                                            </>
                                        )}
                                    </Button>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Scripts Popup Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-background border-sky-500/20">
                    <DialogHeader>
                        <div className="flex items-center gap-2 text-sky-500">
                            <Clapperboard className="h-5 w-5" />
                            <DialogTitle className="text-xl font-bold text-sky-500">
                                Video Scripts
                            </DialogTitle>
                        </div>
                        {activeIdea && (
                            <p className="text-sm text-muted-foreground mt-1 leading-snug">
                                &ldquo;{activeIdea.hook}&rdquo;
                            </p>
                        )}
                    </DialogHeader>

                    {activeScripts && (
                        <div className="space-y-6 mt-2">
                            {/* Variation 1 */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-semibold text-sky-400">
                                        Variation 1 — Direct + Tactical
                                    </span>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                                        onClick={() => copyScriptVariation(activeScripts.variation1, "v1")}
                                    >
                                        {copiedScript === "v1" ? (
                                            <><Check className="h-3 w-3 text-green-500" /> Copied</>
                                        ) : (
                                            <><Copy className="h-3 w-3" /> Copy</>
                                        )}
                                    </Button>
                                </div>
                                <div className="p-4 rounded-xl bg-sky-500/5 border border-sky-500/15">
                                    <pre className="text-sm text-foreground/85 whitespace-pre-wrap font-sans leading-relaxed">
                                        {cleanScriptText(activeScripts.variation1)}
                                    </pre>
                                </div>
                            </div>

                            <div className="border-t border-border/30" />

                            {/* Variation 2 */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-semibold text-sky-400">
                                        Variation 2 — Story + Emotional
                                    </span>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                                        onClick={() => copyScriptVariation(activeScripts.variation2, "v2")}
                                    >
                                        {copiedScript === "v2" ? (
                                            <><Check className="h-3 w-3 text-green-500" /> Copied</>
                                        ) : (
                                            <><Copy className="h-3 w-3" /> Copy</>
                                        )}
                                    </Button>
                                </div>
                                <div className="p-4 rounded-xl bg-sky-500/5 border border-sky-500/15">
                                    <pre className="text-sm text-foreground/85 whitespace-pre-wrap font-sans leading-relaxed">
                                        {cleanScriptText(activeScripts.variation2)}
                                    </pre>
                                </div>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
