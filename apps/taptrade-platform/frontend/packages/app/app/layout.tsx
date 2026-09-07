import type React from "react";
import "./globals.css";
import { GeistMono } from "geist/font/mono";
import AppShell from "./components/AppShell";
import { brand } from "./lib/brand";
import { SUSPENSE_REVEAL_BOOTSTRAP } from "./lib/suspense-reveal-bootstrap";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={GeistMono.variable}>
      <head>
        <title>{brand.name}</title>
        <meta
          name="description"
          content="Trade Yes or No on politics, basketball, pageants, esports, gaming, and the moments Filipinos are watching."
        />
        {/* Ink & lime type pivot, step 2 (handoff spec §1, 2026-07-26):
         * two families, both self-hosted, zero third-party font requests.
         * Switzer (Fontshare, self-hosted woff2 in public/fonts/, declared
         * via @font-face in globals.css) carries display, UI and body;
         * Geist Mono (geist npm package → --font-geist-mono on <html>)
         * carries every numeric with tabular figures. Removed: the Google
         * Fonts stylesheet (Inter, Inter Tight, IBM Plex Mono, Schibsted
         * Grotesk) and its preconnects, Geist Sans (its only consumer was
         * the .predict-terminal font override deleted in step 1), and the
         * Martian Grotesk wordmark font (148KB of variable font for eight
         * letters — the wordmark is now Switzer 600 lowercase). */}
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
