"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Key, Eye, EyeOff, CheckCircle2, Trash2, ExternalLink } from "lucide-react";

const STORAGE_KEY = "groq-api-key";

export default function ApiKeyManager() {
    const [apiKey, setApiKey] = useState("");
    const [savedKey, setSavedKey] = useState<string | null>(null);
    const [showKey, setShowKey] = useState(false);
    const [justSaved, setJustSaved] = useState(false);

    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) setSavedKey(stored);
    }, []);

    const handleSave = () => {
        if (!apiKey.trim()) return;
        localStorage.setItem(STORAGE_KEY, apiKey.trim());
        setSavedKey(apiKey.trim());
        setApiKey("");
        setShowKey(false);
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 3000);
    };

    const handleRemove = () => {
        localStorage.removeItem(STORAGE_KEY);
        setSavedKey(null);
        setApiKey("");
    };

    const maskKey = (key: string) => {
        if (key.length <= 8) return "••••••••";
        return key.slice(0, 4) + "••••••••••••" + key.slice(-4);
    };

    return (
        <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
            <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                    <Key className="h-4 w-4 text-amber-500" />
                    Groq API Key
                </CardTitle>
                <CardDescription className="text-xs">
                    Add your own Groq API key for unlimited usage.{" "}
                    <a
                        href="https://console.groq.com/keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1"
                    >
                        Get a free key <ExternalLink className="h-3 w-3" />
                    </a>
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {savedKey ? (
                    /* Saved state */
                    <div className="space-y-3">
                        <div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
                            <div className="flex items-center gap-2">
                                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                <code className="text-xs text-foreground/70 font-mono">
                                    {showKey ? savedKey : maskKey(savedKey)}
                                </code>
                            </div>
                            <div className="flex items-center gap-1">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                                    onClick={() => setShowKey(!showKey)}
                                >
                                    {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400"
                                    onClick={handleRemove}
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        </div>
                        {justSaved && (
                            <p className="text-xs text-emerald-400 flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3" /> Key saved — it will be used for all AI requests.
                            </p>
                        )}
                        <p className="text-[11px] text-muted-foreground">
                            Your key is stored locally in your browser and sent securely with each API request.
                            It is never stored on the server.
                        </p>
                    </div>
                ) : (
                    /* Input state */
                    <div className="space-y-3">
                        <div className="flex gap-2">
                            <input
                                type={showKey ? "text" : "password"}
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                placeholder="gsk_xxxxxxxxxxxxxxxxxxxx"
                                className="flex-1 h-9 rounded-md border border-border/60 bg-background/50 px-3 text-xs font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50"
                                onKeyDown={(e) => e.key === "Enter" && handleSave()}
                            />
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-9 w-9 p-0 text-muted-foreground hover:text-foreground shrink-0"
                                onClick={() => setShowKey(!showKey)}
                            >
                                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </Button>
                            <Button
                                size="sm"
                                className="h-9 shrink-0"
                                disabled={!apiKey.trim()}
                                onClick={handleSave}
                            >
                                Save Key
                            </Button>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                            Your key is stored locally in your browser and never sent to our servers.
                            It&apos;s used directly from your browser to authenticate with Groq.
                        </p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

/**
 * Helper to get the stored API key from localStorage.
 * Use this in components that make API calls.
 */
export function getStoredApiKey(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(STORAGE_KEY);
}
