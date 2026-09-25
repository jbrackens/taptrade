import type { Metadata } from "next";
import type React from "react";
import "./globals.css";
import { Inter } from "next/font/google";
import AppShell from "./components/AppShell";
import { brand } from "./lib/brand";
import { SUSPENSE_REVEAL_BOOTSTRAP } from "./lib/suspense-reveal-bootstrap";

// One typeface for the whole product (DESIGN.md §4): Inter, with its
// optical-size axis so large headings get the Display cut. next/font
// downloads it at build time and serves it from this origin, so there are
// no runtime requests to Google and the CSP's font-src 'self' holds.
const inter = Inter({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-inter",
  display: "swap",
});

// Title and description go through Next's metadata API (not inline <head>
// tags) so a page that sets its own — /welcome's campaign title — replaces
// them instead of shipping a second title tag that crawlers read first.
export const metadata: Metadata = {
  title: brand.name,
  description:
    "Trade Yes or No on politics, basketball, pageants, esports, gaming, and the moments Filipinos are watching.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={inter.variable}
    >
      <head>
        {/* Streamed-Suspense reveal bootstrap: React 19.2 defers the
         * $RC("B:n","S:n") payload swap to requestAnimationFrame, which
         * never fires on hidden pages (background tab, prerender, headless
         * audit) — hydration then client-renders the boundary and the S:n
         * payload div is left orphaned, doubling the DOM until first paint.
         * This flushes React's own $RV queue while hidden. Inert on visible
         * loads. See app/lib/suspense-reveal-bootstrap.ts for the full
         * mechanism write-up. */}
        <script dangerouslySetInnerHTML={{ __html: SUSPENSE_REVEAL_BOOTSTRAP }} />
        {/* Analytics: intentionally none. The container that used to load here
         * (GTM-PJSSBJG) was inherited from the pre-fork sportsbook codebase and
         * reported every production pageview to a third party's account. It was
         * removed in the 2026-09 brand migration. Re-add a Tap Trade-owned
         * container here when one exists. */}
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
