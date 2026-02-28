import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { Providers } from "@/components/Providers";

export const metadata: Metadata = {
  title: "Reddit Scraper — Search & Export Reddit Posts",
  description:
    "Search Reddit by keywords, view posts sorted by upvotes, and export to Excel or Google Sheets. No Reddit account required.",
  keywords: ["reddit", "search", "scraper", "export", "xlsx", "google sheets"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased">
        <Providers>
          <div className="relative min-h-screen flex flex-col">
            <Navbar />
            <main className="flex-1">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
