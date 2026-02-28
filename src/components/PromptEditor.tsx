"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, RotateCcw, FileText, ChevronDown, ChevronUp } from "lucide-react";
import {
    PROMPT_KEYS,
    DEFAULT_IDEAS_PROMPT,
    DEFAULT_HOOKS_PROMPT,
    DEFAULT_SCRIPTS_PROMPT,
    getPrompt,
    setPrompt,
    resetPrompt,
} from "@/lib/promptStore";

interface PromptSection {
    key: string;
    label: string;
    description: string;
    defaultValue: string;
    placeholders: string[];
}

const PROMPT_SECTIONS: PromptSection[] = [
    {
        key: PROMPT_KEYS.IDEAS,
        label: "Content Ideas Prompt",
        description: "Generates 5 short-form video ideas from Reddit discussions.",
        defaultValue: DEFAULT_IDEAS_PROMPT,
        placeholders: ["{{SUBREDDIT}}", "{{DISCUSSIONS}}"],
    },
    {
        key: PROMPT_KEYS.HOOKS,
        label: "Viral Hooks Prompt",
        description: "Generates 10 scroll-stopping hooks from Reddit data.",
        defaultValue: DEFAULT_HOOKS_PROMPT,
        placeholders: ["{{DISCUSSIONS}}"],
    },
    {
        key: PROMPT_KEYS.SCRIPTS,
        label: "Video Scripts Prompt",
        description: "Generates 2 script variations (Direct + Story) for a given hook & idea.",
        defaultValue: DEFAULT_SCRIPTS_PROMPT,
        placeholders: ["{{HOOK}}", "{{CONCEPT}}"],
    },
];

export default function PromptEditor() {
    const [prompts, setPrompts] = useState<Record<string, string>>({});
    const [saved, setSaved] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<string | null>(null);

    // Load from localStorage on mount
    useEffect(() => {
        const loaded: Record<string, string> = {};
        for (const section of PROMPT_SECTIONS) {
            loaded[section.key] = getPrompt(section.key, section.defaultValue);
        }
        setPrompts(loaded);
    }, []);

    const handleSave = (key: string) => {
        setPrompt(key, prompts[key]);
        setSaved(key);
        setTimeout(() => setSaved(null), 2000);
    };

    const handleReset = (key: string) => {
        resetPrompt(key);
        const section = PROMPT_SECTIONS.find(s => s.key === key);
        if (section) {
            setPrompts(prev => ({ ...prev, [key]: section.defaultValue }));
        }
        setSaved(key);
        setTimeout(() => setSaved(null), 2000);
    };

    const toggleExpand = (key: string) => {
        setExpanded(prev => (prev === key ? null : key));
    };

    const isModified = (key: string) => {
        const section = PROMPT_SECTIONS.find(s => s.key === key);
        return section ? prompts[key] !== section.defaultValue : false;
    };

    return (
        <Card className="border-violet-500/20 bg-gradient-to-br from-card to-violet-500/5">
            <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                    <FileText className="h-4 w-4 text-violet-500" />
                    AI Prompts
                </CardTitle>
                <CardDescription className="text-xs">
                    Customize the prompts used by the AI to generate content ideas, viral hooks, and scripts.
                    Use the template variables shown below each editor — they will be replaced with actual data at runtime.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {PROMPT_SECTIONS.map((section) => (
                    <div key={section.key} className="rounded-lg border border-border/50 overflow-hidden">
                        {/* Accordion Header */}
                        <button
                            onClick={() => toggleExpand(section.key)}
                            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                        >
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{section.label}</span>
                                {isModified(section.key) && (
                                    <Badge variant="outline" className="text-[10px] bg-violet-500/10 text-violet-500 border-violet-500/20">
                                        Customized
                                    </Badge>
                                )}
                            </div>
                            {expanded === section.key ? (
                                <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            ) : (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            )}
                        </button>

                        {/* Expanded Content */}
                        {expanded === section.key && (
                            <div className="px-4 pb-4 space-y-3 border-t border-border/30">
                                <p className="text-xs text-muted-foreground pt-3">
                                    {section.description}
                                </p>

                                <Textarea
                                    value={prompts[section.key] || ""}
                                    onChange={(e) =>
                                        setPrompts(prev => ({ ...prev, [section.key]: e.target.value }))
                                    }
                                    className="min-h-[200px] max-h-[400px] font-mono text-xs leading-relaxed resize-y bg-background/50"
                                    placeholder="Enter your custom prompt..."
                                />

                                {/* Template variables */}
                                <div className="flex flex-wrap gap-1.5">
                                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide mr-1">Variables:</span>
                                    {section.placeholders.map((ph) => (
                                        <Badge key={ph} variant="secondary" className="text-[10px] font-mono">
                                            {ph}
                                        </Badge>
                                    ))}
                                </div>

                                {/* Fix 4: Placeholder validation warning */}
                                {isModified(section.key) && (() => {
                                    const currentPrompt = prompts[section.key] || '';
                                    const missing = section.placeholders.filter(ph => !currentPrompt.includes(ph));
                                    if (missing.length === 0) return null;
                                    return (
                                        <div className="flex items-start gap-2 text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2">
                                            <span className="shrink-0 mt-0.5">⚠️</span>
                                            <div>
                                                <span>Missing: {missing.map(m => <code key={m} className="bg-amber-100 dark:bg-amber-900/50 px-1 rounded font-mono text-[10px] mx-0.5">{m}</code>)}</span>
                                                <span className="text-amber-500 block mt-0.5">Data will be auto-appended, but placing variables gives you control over where they appear.</span>
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* Actions */}
                                <div className="flex items-center gap-2 pt-1">
                                    <Button
                                        size="sm"
                                        onClick={() => handleSave(section.key)}
                                        className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs"
                                    >
                                        {saved === section.key ? (
                                            <><Check className="h-3 w-3" /> Saved</>
                                        ) : (
                                            "Save Prompt"
                                        )}
                                    </Button>
                                    {isModified(section.key) && (
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => handleReset(section.key)}
                                            className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                                        >
                                            <RotateCcw className="h-3 w-3" /> Reset to Default
                                        </Button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}
