"use client";

import { ContentPageRenderer } from "../components/ContentPage";

const FALLBACK_CONTENT = `
<h1>Terms of Use</h1>
<p style="opacity:0.6;font-size:12px;margin-bottom:28px;">Last updated: May 2026 · Operated by DORA Research, Inc.</p>

<h2>1. Agreement to These Terms</h2>
<p>TapTrade (the "Platform") is operated by DORA Research, Inc. ("DORA Research", "we", "us", or "our"). These Terms of Use ("Terms") form a binding agreement between you and DORA Research, Inc. governing your access to and use of the Platform. By creating an account, accessing, or using the Platform, you accept these Terms in full. If you do not agree, do not use the Platform.</p>

<h2>2. Eligibility and Jurisdiction</h2>
<p>You must be at least the minimum legal age to participate in event-contract markets in your jurisdiction and must have the legal capacity to enter into this agreement. The Platform is not offered where its use would be unlawful. You are solely responsible for determining whether your use of the Platform is permitted under the laws applicable to you, and for compliance with those laws.</p>

<h2>3. The Service</h2>
<p>The Platform allows eligible users to make binary YES/NO predictions that resolve based on the outcome of real-world events. Markets use non-redeemable gameplay points and probability-style prices. The Platform provides entertainment, rankings, and information only; it does not provide financial, investment, legal, or tax advice.</p>

<h2>4. Points, Accounts, and Security</h2>
<p>You may hold only one account. You agree to provide accurate, current information and to keep it updated. You are responsible for safeguarding your credentials and for all activity under your account. Notify us promptly of any unauthorized use.</p>
<p>TapTrade points are non-redeemable gameplay points. They are not money, stored value, cryptocurrency, a prize, or a claim on anything redeemable. TapTrade does not support adding money, removing money, cashing out, or exchanging points for money, goods, services, or prizes.</p>

<h2>6. Market Rules and Settlement</h2>
<p>Each market specifies its resolution criteria and settlement source. Quoted probabilities update with activity until a prediction is confirmed. At settlement, the winning side receives gameplay points according to the market rules and the losing side receives no settlement points for that position. We may void, correct, or re-settle a market in cases of manifest error, source failure, or ambiguity in the resolution criteria, acting reasonably and in good faith.</p>

<h2>7. Prohibited Conduct and Market Integrity</h2>
<p>You agree not to: maintain multiple accounts; engage in wash activity, spoofing, collusion, or any conduct intended to manipulate probabilities or settlement; use bots or automated means except via officially provided interfaces; circumvent geographic or eligibility restrictions; or use the Platform for unlawful purposes. We may suspend accounts, reverse point movements, and restrict access associated with prohibited conduct.</p>

<h2>8. No Advice; Assumption of Risk</h2>
<p>All predictions are your own. Markets involve gameplay risk, including the risk of losing the points used for a position. The Platform and its content are provided for general information and entertainment and do not constitute advice.</p>

<h2>9. Intellectual Property</h2>
<p>The Platform, including its software, design, text, and marks, is owned by DORA Research, Inc. or its licensors and is protected by intellectual-property laws. You receive a limited, revocable, non-exclusive license to use the Platform for its intended purpose. No other rights are granted.</p>

<h2>10. Disclaimers and Limitation of Liability</h2>
<p>The Platform is provided "as is" and "as available" without warranties of any kind, express or implied. To the maximum extent permitted by law, DORA Research, Inc. and its affiliates are not liable for any indirect, incidental, or consequential damages, or for losses arising from technical failures, interrupted service, inaccurate probability display, or settlement decisions. Points have no monetary or redemption value.</p>

<h2>11. Indemnification</h2>
<p>You agree to indemnify and hold harmless DORA Research, Inc., its affiliates, and personnel from claims and expenses arising out of your use of the Platform, your breach of these Terms, or your violation of any law or third-party right.</p>

<h2>12. Suspension and Termination</h2>
<p>We may suspend or terminate access at any time for breach of these Terms, suspected fraud or manipulation, legal or regulatory requirements, or risk to the Platform. Provisions that by their nature should survive termination will survive.</p>

<h2>13. Changes to the Platform and These Terms</h2>
<p>We may modify the Platform or these Terms. Material changes will be indicated by updating the "Last updated" date. Continued use after changes take effect constitutes acceptance of the revised Terms.</p>

<h2>14. Governing Law and Dispute Resolution</h2>
<p>These Terms are governed by the laws of the jurisdiction in which DORA Research, Inc. is organized, without regard to conflict-of-laws rules. Disputes will be resolved through binding individual arbitration to the extent permitted by applicable law, and you and DORA Research, Inc. waive any right to participate in a class proceeding.</p>

<h2>15. Contact</h2>
<p>Questions about these Terms may be directed to <a href="mailto:legal@taptrade.com">legal@taptrade.com</a>, DORA Research, Inc.</p>
`;

export default function TermsPage() {
  return (
    <ContentPageRenderer slug="terms" fallbackContent={FALLBACK_CONTENT} />
  );
}
