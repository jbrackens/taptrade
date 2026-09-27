"use client";

import { notFound } from "next/navigation";
import { ContentPageRenderer } from "../components/ContentPage";
import { FEATURE_RG } from "../lib/features";

const FALLBACK_CONTENT = `
<h1>Responsible Play</h1>
<p style="font-size: 12px; color: var(--ink-3); margin-bottom: 32px;">Last updated: April 2026</p>

<h2>Our Commitment</h2>
<p>We are committed to responsible play. Use the tools below to manage your trading activity and set personal limits.</p>

<h2>Set Limits</h2>
<p>You can set play, prediction, and session limits at any time from your account settings. Point-use limits can be set on a daily, weekly, or monthly basis. Session limits control how long you can remain active on the platform.</p>

<h2>Cool Off Periods</h2>
<p>Take a break by activating a cool-off period. During this time, you will not be able to place any trades. Cool-off periods range from 1 day to 30 days and cannot be reversed early.</p>

<h2>Self-Exclusion</h2>
<p>Self-exclusion permanently closes your account and prevents you from creating new accounts. This action cannot be undone. If you choose to self-exclude, you will lose access to your account and any remaining gameplay points.</p>

<h2>Problem Play Warning Signs</h2>
<p>Trading event-contract markets shares many of the risk patterns of gambling. If you recognize any of the following behaviors, it may be time to seek help:</p>
<ul>
<li>Spending more time or gameplay points on predictions than you intended</li>
<li>Difficulty controlling or stopping trading once you start</li>
<li>Feeling restless or irritable when trying to stop</li>
<li>Trading to escape problems or relieve feelings of anxiety or depression</li>
<li>Chasing losses by making more predictions to recover points already lost</li>
<li>Lying to family members or others about how much you trade</li>
<li>Letting prediction activity interfere with everyday obligations</li>
<li>Neglecting work, school, or family responsibilities</li>
<li>Risking or losing important relationships because of your trading</li>
<li>Feeling guilty or ashamed about your trading behavior</li>
</ul>

<h2>Helplines &amp; Resources</h2>
<p><strong>1-800-GAMBLER</strong> &mdash; 24/7 confidential helpline for problem gamblers. Phone: 1-800-426-2537. Website: <a href="https://www.1800gambler.net">www.1800gambler.net</a></p>
<p><strong>National Council on Problem Gambling (NCPG)</strong> &mdash; National helpline and online chat support. Phone: 1-800-522-4700. Website: <a href="https://www.ncpgambling.org">www.ncpgambling.org</a></p>
<p><strong>Gamblers Anonymous</strong> &mdash; Peer support and 12-step recovery program for compulsive gamblers. Website: <a href="https://www.gamblersanonymous.org">www.gamblersanonymous.org</a></p>
<p><strong>GamStop (UK Self-Exclusion)</strong> &mdash; Free self-exclusion service for UK-licensed online gambling. Website: <a href="https://www.gamstop.co.uk">www.gamstop.co.uk</a></p>

<h2>Patron Protection</h2>
<p>TapTrade is committed to protecting our players. We implement the following measures:</p>
<ul>
<li>Age verification to prevent underage participation (18+ / 21+ depending on jurisdiction)</li>
<li>Point-use, prediction, and session limits that you can set and adjust at any time</li>
<li>Cool-off periods and permanent self-exclusion options</li>
<li>Transaction monitoring to detect unusual or harmful patterns</li>
<li>Mandatory responsible-play messaging in all promotional materials</li>
<li>Staff training on responsible play and problem-trading indicators</li>
</ul>

<h2>Dispute Resolution</h2>
<p>If you have a complaint or dispute regarding your account, transactions, or trade settlement outcomes, please follow these steps:</p>
<ol>
<li><strong>Contact Support:</strong> Reach out to our customer support team via live chat or email at <a href="mailto:support@taptrade.com">support@taptrade.com</a>. We aim to resolve most issues within 48 hours.</li>
<li><strong>Formal Complaint:</strong> If you are not satisfied with the initial response, submit a formal written complaint. We will acknowledge it within 24 hours and provide a final response within 8 weeks.</li>
<li><strong>Independent Mediation:</strong> If the complaint remains unresolved, you may refer the matter to an independent dispute resolution body as specified by your local gaming authority.</li>
<li><strong>Regulatory Authority:</strong> You may also contact the relevant gaming regulatory authority in your jurisdiction to file a formal complaint.</li>
</ol>
`;

export default function ResponsibleGamingPage() {
  if (!FEATURE_RG) notFound();
  return (
    <ContentPageRenderer
      slug="responsible-gaming"
      fallbackContent={FALLBACK_CONTENT}
    />
  );
}
