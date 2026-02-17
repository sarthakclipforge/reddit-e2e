"use client";

import { useApiUsage } from "@/context/ApiUsageContext";
import { Activity, RefreshCw } from "lucide-react";

export default function ApiUsageBar() {
    const { usage } = useApiUsage();

    if (!usage) return null;

    const { percentUsed, remaining, limit, resetInSeconds } = usage;
    const isRecovering = resetInSeconds > 0 && percentUsed > 0;

    // Color based on usage level
    const getBarColor = () => {
        if (percentUsed >= 90) return "bg-red-500";
        if (percentUsed >= 70) return "bg-amber-500";
        if (percentUsed >= 40) return "bg-sky-500";
        return "bg-emerald-500";
    };

    const getGlowColor = () => {
        if (percentUsed >= 90) return "shadow-red-500/30";
        if (percentUsed >= 70) return "shadow-amber-500/30";
        if (percentUsed >= 40) return "shadow-sky-500/30";
        return "shadow-emerald-500/30";
    };

    const getTextColor = () => {
        if (percentUsed >= 90) return "text-red-400";
        if (percentUsed >= 70) return "text-amber-400";
        if (percentUsed >= 40) return "text-sky-400";
        return "text-emerald-400";
    };

    const formatTime = (seconds: number) => {
        if (seconds >= 60) {
            const m = Math.floor(seconds / 60);
            const s = seconds % 60;
            return `${m}m ${s}s`;
        }
        return `${seconds}s`;
    };

    return (
        <div className={`w-full rounded-xl border border-border/40 bg-card/50 backdrop-blur-sm p-4 space-y-3 transition-shadow duration-500 ${isRecovering ? `shadow-lg ${getGlowColor()}` : ''}`}>
            {/* Header row */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Activity className={`h-4 w-4 ${getTextColor()}`} />
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        API Usage
                    </span>
                    {isRecovering && (
                        <span className="flex items-center gap-1 text-[10px] text-emerald-400/80 font-medium">
                            <RefreshCw className="h-3 w-3 animate-spin" />
                            recovering
                        </span>
                    )}
                </div>
                <span className={`text-lg font-bold tabular-nums ${getTextColor()}`}>
                    {percentUsed}%
                </span>
            </div>

            {/* Progress bar */}
            <div className="h-2.5 w-full rounded-full bg-muted/30 overflow-hidden">
                <div
                    className={`h-full rounded-full transition-all duration-1000 ease-linear ${getBarColor()}`}
                    style={{ width: `${Math.min(percentUsed, 100)}%` }}
                />
            </div>

            {/* Details row */}
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                    <span className="font-medium text-foreground/70">{remaining}</span>/{limit} remaining
                </span>
                {resetInSeconds > 0 && (
                    <span>
                        Full reset in <span className="font-medium text-foreground/70">{formatTime(resetInSeconds)}</span>
                    </span>
                )}
                {resetInSeconds === 0 && percentUsed === 0 && (
                    <span className="text-emerald-400/80 font-medium">✓ Fully recovered</span>
                )}
            </div>
        </div>
    );
}
