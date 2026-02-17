"use client";

import { createContext, useContext, useState, useRef, useCallback, useEffect, ReactNode } from "react";

export interface ApiUsage {
    /** Requests remaining in the current window */
    remaining: number;
    /** Total request limit for the window */
    limit: number;
    /** Seconds until the rate limit resets */
    resetInSeconds: number;
    /** Percentage used (0–100), interpolated in real-time */
    percentUsed: number;
    /** Timestamp (ms) when the rate limit fully resets */
    resetsAt: number;
    /** Timestamp (ms) of last server sync */
    lastUpdated: number;
}

/** Snapshot from the server before interpolation begins */
interface UsageSnapshot {
    remaining: number;
    limit: number;
    used: number;
    resetsAt: number;       // absolute timestamp (ms)
    snapshotTime: number;   // when we received this data
}

interface ApiUsageContextType {
    usage: ApiUsage | null;
    updateUsage: (headers: { remaining: number; limit: number; resetInSeconds: number }) => void;
}

const ApiUsageContext = createContext<ApiUsageContextType>({
    usage: null,
    updateUsage: () => { },
});

export function ApiUsageProvider({ children }: { children: ReactNode }) {
    const [usage, setUsage] = useState<ApiUsage | null>(null);
    const snapshotRef = useRef<UsageSnapshot | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Clean up interval on unmount
    useEffect(() => {
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, []);

    const startRefillTimer = useCallback(() => {
        // Clear any existing timer
        if (timerRef.current) clearInterval(timerRef.current);

        timerRef.current = setInterval(() => {
            const snap = snapshotRef.current;
            if (!snap) return;

            const now = Date.now();
            const elapsed = now - snap.snapshotTime;
            const totalWindow = snap.resetsAt - snap.snapshotTime;

            if (totalWindow <= 0 || now >= snap.resetsAt) {
                // Reset window reached — credits fully restored
                setUsage({
                    remaining: snap.limit,
                    limit: snap.limit,
                    resetInSeconds: 0,
                    percentUsed: 0,
                    resetsAt: snap.resetsAt,
                    lastUpdated: snap.snapshotTime,
                });
                if (timerRef.current) clearInterval(timerRef.current);
                return;
            }

            // Interpolate: credits recover linearly from `used` → 0 over the reset window
            const progress = Math.min(elapsed / totalWindow, 1);
            const recoveredCredits = Math.round(snap.used * progress);
            const currentUsed = Math.max(snap.used - recoveredCredits, 0);
            const currentRemaining = snap.limit - currentUsed;
            const percentUsed = snap.limit > 0 ? Math.round((currentUsed / snap.limit) * 100) : 0;
            const secondsLeft = Math.max(0, Math.ceil((snap.resetsAt - now) / 1000));

            setUsage({
                remaining: currentRemaining,
                limit: snap.limit,
                resetInSeconds: secondsLeft,
                percentUsed,
                resetsAt: snap.resetsAt,
                lastUpdated: snap.snapshotTime,
            });
        }, 1000);
    }, []);

    const updateUsage = useCallback(
        (headers: { remaining: number; limit: number; resetInSeconds: number }) => {
            const { remaining, limit, resetInSeconds } = headers;
            const used = limit - remaining;
            const now = Date.now();
            const resetsAt = now + resetInSeconds * 1000;

            // Store snapshot for interpolation
            snapshotRef.current = { remaining, limit, used, resetsAt, snapshotTime: now };

            // Set immediate value
            const percentUsed = limit > 0 ? Math.round((used / limit) * 100) : 0;
            setUsage({
                remaining,
                limit,
                resetInSeconds,
                percentUsed,
                resetsAt,
                lastUpdated: now,
            });

            // Start the refill animation
            startRefillTimer();
        },
        [startRefillTimer]
    );

    return (
        <ApiUsageContext.Provider value={{ usage, updateUsage }}>
            {children}
        </ApiUsageContext.Provider>
    );
}

export function useApiUsage() {
    return useContext(ApiUsageContext);
}
