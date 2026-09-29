/**
 * Build-time feature flags.
 *
 * Each flag is a simple boolean derived from a `NEXT_PUBLIC_FEATURE_*`
 * environment variable. Next.js inlines these into the client bundle at
 * build time, so the value is fixed for a given deploy. Default is off —
 * a deploy must set the matching env var to `"true"` to enable the flag.
 *
 * To set a flag, add it to `.env.local` / `.env.development` /
 * `.env.staging` / `.env.production` for that deploy:
 *
 *   NEXT_PUBLIC_FEATURE_KYC=true
 *
 * Usage to gate a route (returns 404 when off):
 *
 *   import { notFound } from "next/navigation";
 *   import { FEATURE_KYC } from "../../lib/features";
 *   if (!FEATURE_KYC) notFound();
 *
 * Usage to hide a UI element (renders nothing when off):
 *
 *   {FEATURE_KYC && <Link href="/account/settings">Verify identity</Link>}
 */

/**
 * KYC / identity verification surface. Off by default. Turn on for
 * jurisdictional deploys that legally require KYC (e.g. regulated US
 * prediction markets like Kalshi). Off for offshore-style deploys
 * (Polymarket-style) where users trade pseudonymously.
 *
 * Currently gates: the "Identity Verification (KYC)" row and "Complete
 * Verification" CTA on /profile/. Email and phone verification rows are
 * NOT gated — those are sensible regardless of jurisdiction.
 */
export const FEATURE_KYC = process.env.NEXT_PUBLIC_FEATURE_KYC === "true";

/**
 * Community chat surface. Off by default until the Rocket.Chat feasibility
 * spike proves iframe/session/cookie behavior and moderation controls.
 */
export const FEATURE_CHAT = process.env.NEXT_PUBLIC_FEATURE_CHAT === "true";

export const CHAT_PUBLIC_URL = (
  process.env.NEXT_PUBLIC_CHAT_PUBLIC_URL || ""
).replace(/\/$/, "");

/**
 * Social OAuth entry points on the LOGIN page (register renders its trio
 * unconditionally — recorded owner call). The original rationale for
 * defaulting off — visible 400s from /oauth/start — is obsolete:
 * SocialAuthButtons probes the start route first and degrades to an honest
 * inline notice when a provider isn't configured. The flag remains a
 * per-deploy switch; demo sets it true via deploy-demo.yml build-arg
 * (step 7, 2026-07-26).
 */
export const FEATURE_SOCIAL_AUTH =
  process.env.NEXT_PUBLIC_FEATURE_SOCIAL_AUTH === "true";

/**
 * Dedicated live/in-play markets surface. Off by default while private
 * provider access and event-data coverage are still being finalized.
 *
 * Currently gates: the /live/ route content and Live nav entries.
 */
export const FEATURE_LIVE_MARKETS =
  process.env.NEXT_PUBLIC_FEATURE_LIVE_MARKETS === "true";

/**
 * Demo-only synthetic chart fallback. When on, MarketChart falls back to a
 * deterministic seeded walk while price history is loading, failed, or has
 * no movement — the pre-launch behavior that keeps the seeded demo box
 * pretty. Off by default: real deploys show honest loading / error / empty
 * chart states instead of fabricated price movement.
 */
export const DEMO_SYNTHETIC_CHARTS =
  process.env.NEXT_PUBLIC_DEMO_SYNTHETIC_CHARTS === "true";

/**
 * Optional ambient video layer behind the landing-page hero scrim.
 * Value is a public asset path (e.g. "/brand/hero-ambient.mp4"); empty
 * string (default) renders no video element at all — the drawn chart
 * composition is the base hero and remains the fallback for reduced
 * motion, no-JS, and slow connections.
 *
 * Asset requirements + direction brief: docs/hero-ambient-video.md.
 * Footage must contain no readable text, signage, or screens — the
 * product layer stays code-drawn on top.
 */
export const HERO_AMBIENT_VIDEO =
  process.env.NEXT_PUBLIC_HERO_AMBIENT_VIDEO || "";

/**
 * Crypto cashier UI (/cashier): the fail-closed crypto deposit card over the
 * gateway's alpha cashier, merged from feat/hula-na-cashier (2026-09-29).
 * Off by default and never set on the demo (the gateway test
 * TestDemoDeployNeverSetsMoneyFlags pins that): Tap Trade launches on
 * non-redeemable play Clout, and the gateway's money routes stay unmounted
 * unless TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED and ALPHA_CASHIER_ENABLED are
 * on, which production and staging refuse at boot.
 *
 * Currently gates: the /cashier route (404 when off). No navigation links
 * to it.
 */
export const FEATURE_CASHIER_UI =
  process.env.NEXT_PUBLIC_FEATURE_CASHIER_UI === "true";

/**
 * Two-factor sign-in settings (authenticator app). Off by default; pairs with
 * the auth service's AUTH_MFA_ENABLED, which is also off by default
 * (owner call, 2026-09-29: not needed yet).
 *
 * Currently gates: the "Two-factor sign-in" tab on /account/security, and the
 * /auth/login?mfa=1 entry that social sign-in uses. The code step after a
 * password is driven by the auth service, so it appears whenever that service
 * asks for a code, whatever this flag says.
 */
export const FEATURE_MFA = process.env.NEXT_PUBLIC_FEATURE_MFA === "true";
