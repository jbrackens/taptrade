"use client";

import { ContentPageRenderer } from "../components/ContentPage";

const FALLBACK_CONTENT = `
<h1>About TapTrade</h1>
<p style="font-size: 12px; color: var(--ink-3); margin-bottom: 32px;">Last updated: April 2026</p>

<h2>Who We Are</h2>
<p>TapTrade is a points-based prediction market platform where players take positions on real-world outcomes across politics, sports, entertainment, technology, culture, and economics. Markets express crowd probability from 1 to 99 and settle only in non-redeemable gameplay points.</p>

<h2>Our Mission</h2>
<p>We believe prediction markets are the most honest signal we have for what the world thinks will happen. Our platform exists to surface that signal with fair pricing, transparent settlement, and tools that keep the experience under your control.</p>

<h2>What We Offer</h2>
<p>Binary YES/NO predictions on real-world events, transparent resolution rules, live depth, point-ledger history, portfolio tracking, rankings, rewards, and responsible-play tools. TapTrade points are for gameplay only and cannot be withdrawn, cashed out, redeemed, or transferred for money or prizes.</p>

<h2>Licensing &amp; Regulation</h2>
<p>TapTrade is designed around non-redeemable gameplay points. Access and features may vary by jurisdiction, age, and responsible-play settings.</p>

<h2>Contact</h2>
<p>For support inquiries, reach us at <a href="mailto:support@taptrade.com">support@taptrade.com</a>.</p>
`;

export default function AboutPage() {
  return (
    <ContentPageRenderer slug="about-us" fallbackContent={FALLBACK_CONTENT} />
  );
}
