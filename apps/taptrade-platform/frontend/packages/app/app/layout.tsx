import type React from "react";
import "./globals.css";
import { Big_Shoulders, Instrument_Sans, Martian_Mono } from "next/font/google";
import AppShell from "./components/AppShell";
import { brand } from "./lib/brand";
import { SUSPENSE_REVEAL_BOOTSTRAP } from "./lib/suspense-reveal-bootstrap";

// Kilig type system (DESIGN.md §4). next/font downloads these at build
// time and serves them from this origin, so there are no runtime requests
// to Google and the CSP's font-src 'self' holds.
const uiSans = Instrument_Sans({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-instrument-sans",
  display: "swap",
});
const poster = Big_Shoulders({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-big-shoulders",
  display: "swap",
});
const numerals = Martian_Mono({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-martian-mono",
  display: "swap",
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${uiSans.variable} ${poster.variable} ${numerals.variable}`}
    >
      <head>
        <title>{brand.name}</title>
        <meta
          name="description"
          content="Trade Yes or No on politics, basketball, pageants, esports, gaming, and the moments Filipinos are watching."
        />
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
