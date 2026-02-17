/**
 * Landing / Home Page
 * Hero section with feature overview and CTA to search.
 */

import Link from 'next/link';
import { Search, Download, FileSpreadsheet, Shield, Zap, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const features = [
  {
    icon: Search,
    title: 'Keyword Search',
    description: 'Search Reddit with any keywords. Filter by Top or Hot posts and get up to 100 results instantly.',
    gradient: 'from-orange-500 to-red-500',
  },
  {
    icon: Download,
    title: 'Excel Export',
    description: 'Download your results as an Excel file with one click. All post data neatly organized in columns.',
    gradient: 'from-green-500 to-emerald-500',
  },
  {
    icon: FileSpreadsheet,
    title: 'Google Sheets',
    description: 'Export directly to Google Sheets with formatted headers and data. Perfect for team collaboration.',
    gradient: 'from-blue-500 to-indigo-500',
  },
  {
    icon: Shield,
    title: 'No Login Required',
    description: 'No Reddit account needed. Uses Reddit\'s public JSON endpoints — safe, fast, and ban-free.',
    gradient: 'from-purple-500 to-pink-500',
  },
];

export default function HomePage() {
  return (
    <div className="flex flex-col">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-orange-500/5 via-transparent to-transparent" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-gradient-to-br from-orange-500/10 to-red-500/10 rounded-full blur-3xl -z-10" />

        <div className="container relative z-10 mx-auto px-4 pt-20 pb-16 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400 text-sm mb-6">
            <Zap className="h-3.5 w-3.5" />
            No Reddit account required
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-4">
            Search & Export
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 via-red-500 to-pink-500">
              Reddit Posts
            </span>
          </h1>

          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8 leading-relaxed">
            Find the best Reddit posts by keywords, sort by upvotes or trending, and export
            your results to Excel or Google Sheets — all without a Reddit account.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button asChild size="lg" className="h-12 px-8 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white border-0 shadow-lg hover:shadow-orange-500/25 transition-all text-base">
              <Link href="/search">
                <Search className="mr-2 h-5 w-5" />
                Start Searching
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="h-12 px-8 text-base">
              <Link href="/settings">
                Connect Google
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="container mx-auto px-4 pb-20">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-12">
          {features.map((feature) => (
            <Card
              key={feature.title}
              className="group border-border/40 bg-card/50 hover:bg-card transition-all duration-300 hover:shadow-lg hover:border-border/60"
            >
              <CardContent className="p-5">
                <div
                  className={`inline-flex items-center justify-center h-10 w-10 rounded-lg bg-gradient-to-br ${feature.gradient} shadow-md mb-3 group-hover:scale-110 transition-transform duration-300`}
                >
                  <feature.icon className="h-5 w-5 text-white" />
                </div>
                <h3 className="font-semibold text-sm mb-1.5">{feature.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section className="border-t border-border/40 bg-muted/20">
        <div className="container mx-auto px-4 py-16">
          <h2 className="text-2xl font-bold text-center mb-10">How It Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-3xl mx-auto">
            {[
              { step: '1', title: 'Enter Keywords', desc: 'Type your search query and choose Top or Hot sorting.' },
              { step: '2', title: 'Browse Results', desc: 'View up to 100 posts with upvotes, comments, and dates.' },
              { step: '3', title: 'Export Data', desc: 'Download as Excel or export to Google Sheets instantly.' },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-gradient-to-br from-orange-500 to-red-500 text-white font-bold text-lg mb-3">
                  {item.step}
                </div>
                <h3 className="font-semibold mb-1">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40 py-6">
        <div className="container mx-auto px-4 text-center text-xs text-muted-foreground">
          <p>
            Reddit Scraper — Built with Next.js. Uses Reddit&apos;s public JSON endpoints.
            Not affiliated with Reddit, Inc.
          </p>
        </div>
      </footer>
    </div>
  );
}
