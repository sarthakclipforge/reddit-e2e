/**
 * Settings Page
 * Google account connection management.
 */

'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { GoogleAuthButton } from '@/components/GoogleAuthButton';
import PromptEditor from '@/components/PromptEditor';
import ApiUsageBar from '@/components/ApiUsageBar';
import ApiKeyManager from '@/components/ApiKeyManager';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle2, Info, Shield, Clock, Zap } from 'lucide-react';

function SettingsContent() {
    const searchParams = useSearchParams();
    const success = searchParams.get('success');
    const error = searchParams.get('error');

    return (
        <div className="container mx-auto px-4 py-8 max-w-2xl">
            {/* Page Header */}
            <div className="mb-8">
                <h1 className="text-2xl font-bold tracking-tight mb-1">Settings</h1>
                <p className="text-sm text-muted-foreground">
                    Manage your integrations, AI prompts, and account connections.
                </p>
            </div>

            {/* Success Message */}
            {success && (
                <Card className="mb-6 border-green-500/30 bg-green-500/5">
                    <CardContent className="p-4 flex items-center gap-3">
                        <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                        <p className="text-sm text-green-600 dark:text-green-400">{success}</p>
                    </CardContent>
                </Card>
            )}

            {/* Error Message */}
            {error && (
                <Card className="mb-6 border-destructive/30 bg-destructive/5">
                    <CardContent className="p-4 flex items-center gap-3">
                        <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
                        <p className="text-sm text-destructive">{error}</p>
                    </CardContent>
                </Card>
            )}

            <div className="space-y-6">
                {/* API Key Management */}
                <ApiKeyManager />

                {/* API Usage Tracker */}
                <ApiUsageBar />

                {/* AI Prompts Section */}
                <PromptEditor />

                {/* Google Account Section */}
                <GoogleAuthButton />

                {/* Permissions Info */}
                <Card className="border-border/40 bg-muted/10">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                            <Shield className="h-4 w-4 text-muted-foreground" />
                            Permissions & Privacy
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="flex items-start gap-2">
                            <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                            <p className="text-xs text-muted-foreground">
                                We only request access to create and edit spreadsheets in your Google Drive.
                                We cannot read your existing files or access other Google services.
                            </p>
                        </div>
                        <div className="flex items-start gap-2">
                            <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                            <p className="text-xs text-muted-foreground">
                                Your Google credentials are encrypted and stored as a secure httpOnly cookie.
                                They are never exposed to client-side JavaScript.
                            </p>
                        </div>
                        <div className="flex items-start gap-2">
                            <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                            <p className="text-xs text-muted-foreground">
                                You can disconnect your Google account at any time. This will immediately
                                clear all stored credentials.
                            </p>
                        </div>
                    </CardContent>
                </Card>

                {/* App Info */}
                <Card className="border-border/40 bg-muted/10">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                            <Zap className="h-4 w-4 text-orange-500" />
                            About Reddit Scraper
                        </CardTitle>
                        <CardDescription className="text-xs">
                            Application information and rate limits
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="flex items-center gap-2">
                                <Badge variant="secondary" className="text-xs">Version</Badge>
                                <span className="text-xs text-muted-foreground">1.0.0</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Badge variant="secondary" className="text-xs">API</Badge>
                                <span className="text-xs text-muted-foreground">Reddit JSON (no auth)</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">Rate limit: 1 req/2s</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">Cache TTL: 5 minutes</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

export default function SettingsPage() {
    return (
        <Suspense fallback={
            <div className="container mx-auto px-4 py-8 max-w-2xl">
                <div className="mb-8">
                    <h1 className="text-2xl font-bold tracking-tight mb-1">Settings</h1>
                    <p className="text-sm text-muted-foreground">Loading...</p>
                </div>
            </div>
        }>
            <SettingsContent />
        </Suspense>
    );
}
