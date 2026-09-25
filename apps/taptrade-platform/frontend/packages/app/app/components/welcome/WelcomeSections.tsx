"use client";

/**
 * /welcome — the campaign landing page (ads, social, "How it works").
 *
 * Light and photo-led, built from the product's own pieces: the hero's
 * card is a real, live market (tap Yes/No for the real trade panel), the
 * topic tiles carry live open-market counts, and "Trending right now" is
 * the real board. Honest by construction: every number comes from the API
 * and a section with no data hides itself. Photos are the licensed topic
 * covers in public/images/covers/ (credits in CREDITS.md).
 *
 * The points-only boundary lines carry money words, so — like all
 * compliance copy — they are inline English constants, never locale
 * strings (the locale files stay free of cash/gambling vocabulary).
 */

import Image from "next/image";
import Link from "next/link";
import { ScalesIcon as Scales } from "@phosphor-icons/react/dist/csr/Scales";
import { ShieldCheckIcon as ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { SparkleIcon as Sparkle } from "@phosphor-icons/react/dist/csr/Sparkle";
import { useTranslation } from "react-i18next";
import type {
  Category,
  PredictionMarket,
} from "@taptrade-ui/api-client/src/prediction-types";
import BrandMark from "../BrandMark";
import MarketChart from "../prediction/MarketChart";
import { MarketGrid } from "../prediction/MarketGrid";
import { MarketThumb } from "../prediction/MarketThumb";
import { categoryName, categoryLabel as labelForCategory } from "../prediction/market-content";
import { topicCover } from "../prediction/topic-covers";

export const HERO_FINE_LEGAL = "Points only · no cash, no cash-out · 18+";
export const FOOTER_LEGAL =
  "Tap Trade uses non-redeemable gameplay points. Points cannot be cashed out, withdrawn, transferred, or redeemed for prizes. Prediction markets are speculative; outcomes are not guaranteed. 18+.";

/** Topic tiles, in display order. Tiles with no open markets are hidden. */
export const WELCOME_TOPICS = [
  "sports",
  "esports",
  "entertainment",
  "politics",
  "economics",
] as const;

const WRAP = "mx-auto w-full max-w-[1240px] px-6 max-[640px]:px-4";
const PRIMARY_CTA =
  "inline-flex h-12 items-center justify-center rounded-[var(--r-rh-md)] bg-[var(--accent)] px-6 text-[15px] font-semibold text-[var(--ticket-cta-text)] no-underline transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--accent)_86%,var(--surface-1))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2";
const SECONDARY_CTA =
  "inline-flex h-12 items-center justify-center rounded-[var(--r-rh-md)] border border-[var(--border-2)] bg-[var(--surface-1)] px-6 text-[15px] font-semibold text-[var(--t1)] no-underline transition-colors duration-150 hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2";
const SECTION_TITLE =
  "m-0 text-[36px] font-semibold leading-[1.1] tracking-[-0.03em] text-[var(--t1)] max-[640px]:text-[28px]";
const SECTION_SUB = "m-0 mt-2 text-[17px] text-[var(--t2)] max-[640px]:text-[15px]";

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/* ── Header ─────────────────────────────────────────────────────────── */

export function WelcomeHeader() {
  const { t } = useTranslation("prediction");
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border-1)] bg-[color-mix(in_srgb,var(--surface-1)_90%,transparent)] backdrop-blur-md">
      <div className={`${WRAP} flex h-16 items-center justify-between gap-4`}>
        <Link href="/" className="flex items-center gap-2.5 text-[var(--t1)] no-underline" aria-label="Tap Trade">
          <BrandMark size={26} tone="ink" />
          <span className="text-[18px] font-bold tracking-[-0.03em]">
            Tap Trade<span className="text-[var(--brand-period)]">.</span>
          </span>
        </Link>
        <nav className="flex items-center gap-2">
          <Link href="/" className="rounded-[var(--r-rh-md)] px-3 py-2 text-[14px] font-medium text-[var(--t2)] no-underline hover:text-[var(--t1)] max-[480px]:hidden">
            {t("LANDING_NAV_MARKETS", "Markets")}
          </Link>
          <Link href="/auth/login" className="rounded-[var(--r-rh-md)] px-3 py-2 text-[14px] font-medium text-[var(--t1)] no-underline hover:bg-[var(--surface-2)]">
            {t("LANDING_NAV_LOGIN", "Log in")}
          </Link>
          <Link href="/auth/register" className={`${PRIMARY_CTA} h-10 px-4 text-[14px]`}>
            {t("LANDING_NAV_SIGNUP", "Sign up")}
          </Link>
        </nav>
      </div>
    </header>
  );
}

/* ── Hero ───────────────────────────────────────────────────────────── */

function LiveMarketCard({
  market,
  onQuickTrade,
}: {
  market: PredictionMarket;
  onQuickTrade: (side: "yes" | "no") => void;
}) {
  const { t } = useTranslation("prediction");
  const { t: contentT } = useTranslation("market-content");
  const yes = clampPercentage(market.yesPricePoints);
  const category = market.categorySlug
    ? labelForCategory(contentT, market.categorySlug)
    : market.categoryName || "";
  return (
    <article
      data-testid="welcome-live-card"
      className="w-[380px] max-w-full rounded-[16px] border border-[var(--border-1)] bg-[var(--surface-1)] p-5 shadow-[var(--shadow-pop)]"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--live-text)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--live)]" aria-hidden="true" />
          {t("LANDING_LIVE_LABEL", "Trending now")}
        </span>
        <span className="text-[12px] text-[var(--t3)]">{category}</span>
      </div>
      <div className="mt-3 flex items-start gap-3">
        <MarketThumb categorySlug={market.categorySlug} imageUrl={market.imagePath || market.imageUrl} size={40} />
        <Link
          href={`/market/${market.ticker}`}
          className="line-clamp-3 text-[16px] font-semibold leading-snug tracking-[-0.015em] text-[var(--t1)] no-underline hover:underline"
        >
          {market.title}
        </Link>
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="text-[34px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-[var(--t1)]">
          {yes}%
        </span>
        <span className="text-[13px] text-[var(--t3)]">{t("CHANCE", "chance")}</span>
      </div>
      <div className="mt-2">
        <MarketChart
          ticker={market.ticker}
          yesPricePoints={market.yesPricePoints}
          noPricePoints={market.noPricePoints}
          height={96}
          showRanges={false}
        />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {(["yes", "no"] as const).map((side) => (
          <button
            key={side}
            type="button"
            aria-haspopup="dialog"
            aria-label={`${side === "yes" ? yes : 100 - yes}% ${side === "yes" ? t("BUY_YES", "Buy Yes") : t("BUY_NO", "Buy No")}`}
            onClick={() => onQuickTrade(side)}
            className={`h-11 cursor-pointer rounded-[var(--r-rh-md)] border-0 text-[14px] font-semibold text-[var(--on-ink)] transition-[filter] duration-150 hover:brightness-110 ${
              side === "yes" ? "bg-[var(--yes)]" : "bg-[var(--no)]"
            }`}
          >
            {side === "yes" ? t("YES") : t("NO")}{" "}
            <span className="font-medium opacity-85">
              {t("PTS_COUNT", {
                count: side === "yes" ? market.yesPricePoints : market.noPricePoints,
              })}
            </span>
          </button>
        ))}
      </div>
    </article>
  );
}

export function WelcomeHero({
  market,
  openTotal,
  onQuickTrade,
}: {
  market: PredictionMarket | null;
  openTotal: number | null;
  onQuickTrade: (market: PredictionMarket, side: "yes" | "no") => void;
}) {
  const { t } = useTranslation("prediction");
  return (
    <section className="overflow-hidden bg-[var(--surface-1)]" aria-labelledby="welcome-title">
      <div className={`${WRAP} grid grid-cols-[1.02fr_1fr] items-center gap-14 py-20 max-[1024px]:grid-cols-1 max-[1024px]:gap-10 max-[640px]:py-10`}>
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-[var(--live-soft)] px-3 py-1.5 text-[13px] font-semibold text-[var(--live-text)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--live)]" aria-hidden="true" />
            {t("LANDING_EYEBROW", "Free to play · Made for the Philippines")}
          </span>
          <h1
            id="welcome-title"
            className="m-0 mt-5 text-[76px] font-semibold leading-[1.0] tracking-[-0.05em] text-[var(--t1)] [text-wrap:balance] max-[1200px]:text-[64px] max-[640px]:text-[44px]"
          >
            {t("LANDING_TITLE", "Call it before it happens.")}
          </h1>
          <p className="m-0 mt-5 max-w-[540px] text-[19px] leading-[1.5] text-[var(--t2)] max-[640px]:text-[16px]">
            {t(
              "LANDING_SUB",
              "Pick Yes or No on the moments everyone's talking about: basketball, esports, pageants, showbiz and more. Right calls earn points and bragging rights.",
            )}
          </p>
          <div className="mt-8 flex flex-wrap gap-3 max-[480px]:flex-col">
            <Link href="/auth/register" className={PRIMARY_CTA}>
              {t("LANDING_CTA_PRIMARY", "Start free")}
            </Link>
            <Link href="/" className={SECONDARY_CTA}>
              {t("LANDING_CTA_SECONDARY", "Browse markets")}
            </Link>
          </div>
          <p className="m-0 mt-4 text-[13px] text-[var(--t3)]">
            {HERO_FINE_LEGAL}
            {openTotal !== null && openTotal > 0 && (
              <>
                {" · "}
                <span className="tabular-nums">
                  {t("LANDING_OPEN_TOTAL", {
                    count: openTotal,
                    defaultValue: `${openTotal} open markets`,
                  })}
                </span>
              </>
            )}
          </p>
        </div>

        {/* Photo collage with the live market floating over it. */}
        <div className="relative h-[560px] max-[1024px]:h-[520px] max-[640px]:h-auto">
          <div className="absolute inset-y-0 right-0 grid w-[88%] grid-cols-[1.15fr_1fr] grid-rows-2 gap-3 max-[640px]:static max-[640px]:w-full max-[640px]:grid-cols-2 max-[640px]:grid-rows-[180px]">
            <div className="relative row-span-2 overflow-hidden rounded-[20px] bg-[var(--surface-2)] max-[640px]:row-span-1">
              <Image src="/images/covers/basketball.jpg" alt="" aria-hidden="true" fill priority sizes="(max-width: 640px) 50vw, 30vw" className="object-cover" />
            </div>
            <div className="relative overflow-hidden rounded-[20px] bg-[var(--surface-2)]">
              <Image src="/images/covers/pageants.jpg" alt="" aria-hidden="true" fill priority sizes="(max-width: 640px) 50vw, 25vw" className="object-cover" />
            </div>
            <div className="relative overflow-hidden rounded-[20px] bg-[var(--surface-2)] max-[640px]:hidden">
              <Image src="/images/covers/showbiz.jpg" alt="" aria-hidden="true" fill sizes="25vw" className="object-cover" />
            </div>
          </div>
          {market && (
            <div className="absolute bottom-8 left-0 max-[640px]:static max-[640px]:-mt-10 max-[640px]:flex max-[640px]:justify-center">
              <LiveMarketCard market={market} onQuickTrade={(side) => onQuickTrade(market, side)} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ── Topics ─────────────────────────────────────────────────────────── */

export function TopicTiles({
  categories,
  counts,
}: {
  categories: Category[];
  counts: Record<string, number>;
}) {
  const { t } = useTranslation("prediction");
  const { t: contentT } = useTranslation("market-content");
  const tiles = WELCOME_TOPICS.map((slug) => ({
    slug,
    category: categories.find((c) => c.slug.toLowerCase() === slug),
    count: counts[slug] ?? 0,
  })).filter((tile) => tile.category && tile.count > 0);
  if (tiles.length === 0) return null;

  return (
    <section className="bg-[var(--paper)] py-20 max-[640px]:py-12" aria-labelledby="welcome-topics">
      <div className={WRAP}>
        <h2 id="welcome-topics" className={SECTION_TITLE}>
          {t("LANDING_TOPICS_TITLE", "Pick your moment")}
        </h2>
        <p className={SECTION_SUB}>
          {t("LANDING_TOPICS_SUB", "Live markets on the things you already follow.")}
        </p>
        <div
          className="mt-8 grid gap-3 max-[640px]:-mx-4 max-[640px]:flex max-[640px]:snap-x max-[640px]:snap-mandatory max-[640px]:scroll-px-4 max-[640px]:overflow-x-auto max-[640px]:px-4 max-[640px]:[scrollbar-width:none] max-[640px]:[&::-webkit-scrollbar]:hidden"
          style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}
        >
          {tiles.map(({ slug, category, count }) => {
            const cover = topicCover(slug);
            return (
              <Link
                key={slug}
                href={`/predict?category=${encodeURIComponent(slug)}`}
                data-testid="welcome-topic-tile"
                className="group relative isolate flex aspect-[4/5] flex-col justify-end overflow-hidden rounded-[16px] bg-[var(--ink-deep)] p-4 text-white no-underline max-[640px]:w-[62%] max-[640px]:shrink-0 max-[640px]:snap-start"
              >
                {cover && (
                  <Image
                    src={cover}
                    alt=""
                    aria-hidden="true"
                    fill
                    sizes="(max-width: 640px) 62vw, 20vw"
                    className="-z-20 object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                  />
                )}
                <span aria-hidden="true" className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(0,0,0,0)_40%,rgba(0,0,0,0.78)_100%)]" />
                <span className="text-[20px] font-semibold tracking-[-0.02em]">
                  {category ? categoryName(contentT, category) : slug}
                </span>
                <span className="mt-0.5 text-[13px] tabular-nums text-[rgba(255,255,255,0.85)]">
                  {t("LANDING_TOPIC_COUNT", { count, defaultValue: `${count} open markets` })}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ── How it works ───────────────────────────────────────────────────── */

function StepVisualPick() {
  const { t } = useTranslation("prediction");
  return (
    <div className="flex items-start gap-3 rounded-[12px] border border-[var(--border-1)] bg-[var(--surface-1)] p-3.5 shadow-[var(--shadow-card)]">
      <MarketThumb categorySlug="sports" size={40} />
      <div className="min-w-0">
        <p className="m-0 text-[12px] text-[var(--t3)]">{t("LANDING_STEP1_EXAMPLE_TOPIC", "Basketball")}</p>
        <p className="m-0 mt-0.5 text-[14px] font-semibold leading-snug text-[var(--t1)]">
          {t("LANDING_STEP1_EXAMPLE", "Will the home team win Game 7?")}
        </p>
      </div>
    </div>
  );
}

function StepVisualTap() {
  const { t } = useTranslation("prediction");
  return (
    <div className="grid grid-cols-2 gap-2">
      <span className="flex h-12 items-center justify-center gap-1.5 rounded-[var(--r-rh-md)] bg-[var(--yes)] text-[15px] font-semibold text-[var(--on-ink)]">
        {t("YES")} <span className="font-medium opacity-85">{t("PTS_COUNT", { count: 58 })}</span>
      </span>
      <span className="flex h-12 items-center justify-center gap-1.5 rounded-[var(--r-rh-md)] bg-[var(--no-soft)] text-[15px] font-semibold text-[var(--no-text)]">
        {t("NO")} <span className="font-medium opacity-85">{t("PTS_COUNT", { count: 42 })}</span>
      </span>
    </div>
  );
}

function StepVisualSettle() {
  const { t } = useTranslation("prediction");
  return (
    <div className="flex items-center gap-3 rounded-[12px] border border-[var(--border-1)] bg-[var(--surface-1)] p-3.5 shadow-[var(--shadow-card)]">
      <BrandMark size={34} tone="ink" />
      <div>
        <p className="m-0 text-[14px] font-semibold text-[var(--t1)]">
          {t("LANDING_STEP3_EXAMPLE", "You called it")}
        </p>
        <p className="m-0 text-[13px] tabular-nums text-[var(--yes-text)]">
          {t("LANDING_STEP3_EXAMPLE_SUB", "Each correct share settles at 100 pts")}
        </p>
      </div>
    </div>
  );
}

export function HowItWorks() {
  const { t } = useTranslation("prediction");
  const steps = [
    { n: 1, title: t("LANDING_STEP1_TITLE", "Pick a moment"), body: t("LANDING_STEP1_BODY", "Every market is a Yes-or-No question about something real: a Finals series, a pageant night, a box-office weekend."), visual: <StepVisualPick /> },
    { n: 2, title: t("LANDING_STEP2_TITLE", "Tap Yes or No"), body: t("LANDING_STEP2_BODY", "Prices run from 1 to 99 points and move with the crowd. 58 points on Yes means the crowd gives it a 58% chance."), visual: <StepVisualTap /> },
    { n: 3, title: t("LANDING_STEP3_TITLE", "Be right, earn points"), body: t("LANDING_STEP3_BODY", "When the moment happens, every correct share settles at 100 points. Climb the leaderboards and keep your streak going."), visual: <StepVisualSettle /> },
  ];
  return (
    <section id="how-it-works" className="scroll-mt-20 bg-[var(--surface-1)] py-20 max-[640px]:py-12" aria-labelledby="welcome-how">
      <div className={WRAP}>
        <h2 id="welcome-how" className={SECTION_TITLE}>
          {t("LANDING_HOW_TITLE", "How it works")}
        </h2>
        <p className={SECTION_SUB}>{t("LANDING_HOW_SUB", "Three taps from a hunch to a call.")}</p>
        <ol className="m-0 mt-10 grid list-none grid-cols-3 gap-5 p-0 max-[900px]:grid-cols-1">
          {steps.map((step) => (
            <li key={step.n} className="flex flex-col rounded-[16px] bg-[var(--paper)] p-6">
              <div className="flex min-h-[112px] items-center">
                <div className="w-full">{step.visual}</div>
              </div>
              <span className="mt-6 grid h-7 w-7 place-items-center rounded-full bg-[var(--accent)] text-[13px] font-semibold text-[var(--ticket-cta-text)]">
                {step.n}
              </span>
              <h3 className="m-0 mt-3 text-[20px] font-semibold tracking-[-0.02em] text-[var(--t1)]">{step.title}</h3>
              <p className="m-0 mt-2 text-[15px] leading-[1.55] text-[var(--t2)]">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ── Trending ───────────────────────────────────────────────────────── */

export function TrendingRow({ markets }: { markets: PredictionMarket[] }) {
  const { t } = useTranslation("prediction");
  if (markets.length === 0) return null;
  return (
    <section className="bg-[var(--paper)] py-20 max-[640px]:py-12" aria-labelledby="welcome-trending">
      <div className={WRAP}>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="welcome-trending" className={SECTION_TITLE}>
              {t("LANDING_TRENDING_TITLE", "Trending right now")}
            </h2>
            <p className={SECTION_SUB}>
              {t("LANDING_TRENDING_SUB", "Real markets, live prices. Tap Yes or No to see how a call works.")}
            </p>
          </div>
          <Link href="/" className="shrink-0 pb-1 text-[15px] font-semibold text-[var(--t1)] no-underline hover:underline max-[640px]:hidden">
            {t("LANDING_TRENDING_CTA", "See all markets")} →
          </Link>
        </div>
        <div className="mt-8">
          <MarketGrid markets={markets} columns={3} />
        </div>
      </div>
    </section>
  );
}

/* ── Trust ──────────────────────────────────────────────────────────── */

export function TrustBand() {
  const { t } = useTranslation("prediction");
  const items = [
    { icon: Sparkle, title: t("LANDING_TRUST1_TITLE", "Free to play"), body: t("LANDING_TRUST1_BODY", "Sign up and start with free points. No card needed.") },
    { icon: Scales, title: t("LANDING_TRUST2_TITLE", "Clear rules"), body: t("LANDING_TRUST2_BODY", "Every market shows how and where it resolves before you make a call.") },
    { icon: ShieldCheck, title: t("LANDING_TRUST3_TITLE", "Points are play"), body: t("LANDING_TRUST3_BODY", "18+ only. Points are for play and bragging rights, and they stay that way.") },
  ];
  return (
    <section className="border-y border-[var(--border-1)] bg-[var(--surface-1)] py-14" aria-label={t("LANDING_TRUST_LABEL", "Why Tap Trade")}>
      <div className={`${WRAP} grid grid-cols-3 gap-8 max-[900px]:grid-cols-1 max-[900px]:gap-6`}>
        {items.map(({ icon: Icon, title, body }) => (
          <div key={title} className="flex items-start gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-[var(--live-soft)] text-[var(--live-text)]">
              <Icon size={22} weight="duotone" aria-hidden="true" />
            </span>
            <div>
              <h3 className="m-0 text-[17px] font-semibold text-[var(--t1)]">{title}</h3>
              <p className="m-0 mt-1 text-[15px] leading-[1.5] text-[var(--t2)]">{body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── Final CTA + footer ─────────────────────────────────────────────── */

export function FinalCta() {
  const { t } = useTranslation("prediction");
  return (
    <section className="bg-[var(--ink-deep)] py-24 text-[var(--poster-ink)] max-[640px]:py-16" aria-labelledby="welcome-final">
      <div className={`${WRAP} flex flex-col items-center text-center`}>
        <BrandMark size={56} tone="light" />
        <h2 id="welcome-final" className="m-0 mt-6 text-[52px] font-semibold leading-[1.05] tracking-[-0.045em] max-[640px]:text-[36px]">
          {t("LANDING_FINAL_TITLE", "Your first call is on us.")}
        </h2>
        <p className="m-0 mt-4 max-w-[520px] text-[18px] text-[var(--poster-ink-2)]">
          {t("LANDING_FINAL_BODY", "Sign up in seconds and start with free points.")}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/auth/register"
            className="inline-flex h-12 items-center rounded-[var(--r-rh-md)] bg-[var(--poster-ink)] px-7 text-[15px] font-semibold text-[var(--ink)] no-underline transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--poster-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ink-deep)]"
          >
            {t("LANDING_CTA_PRIMARY", "Start free")}
          </Link>
          <Link
            href="/"
            className="inline-flex h-12 items-center rounded-[var(--r-rh-md)] border border-[rgba(255,255,255,0.22)] px-7 text-[15px] font-semibold text-[var(--poster-ink)] no-underline transition-colors duration-150 hover:bg-[rgba(255,255,255,0.08)]"
          >
            {t("LANDING_CTA_SECONDARY", "Browse markets")}
          </Link>
        </div>
      </div>
    </section>
  );
}

export function WelcomeFooter() {
  const { t } = useTranslation("prediction");
  const links = [
    { href: "/", label: t("LANDING_FOOTER_MARKETS", "Markets") },
    { href: "/leaderboards", label: t("LANDING_FOOTER_LEADERBOARDS", "Leaderboards") },
    { href: "/about", label: t("LANDING_FOOTER_ABOUT", "About") },
    { href: "/terms", label: t("LANDING_FOOTER_TERMS", "Terms") },
    { href: "/privacy", label: t("LANDING_FOOTER_PRIVACY", "Privacy") },
    { href: "/responsible-gaming", label: t("LANDING_FOOTER_RESPONSIBLE", "Responsible play") },
  ];
  return (
    <footer className="bg-[var(--surface-1)] py-10">
      <div className={`${WRAP} flex flex-col gap-6`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-[16px] font-bold tracking-[-0.03em] text-[var(--t1)]">
            <BrandMark size={22} tone="ink" />
            <span>
              Tap Trade<span className="text-[var(--brand-period)]">.</span>
            </span>
          </span>
          <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label={t("LANDING_FOOTER_LABEL", "Footer")}>
            {links.map((link) => (
              <Link key={link.href} href={link.href} className="text-[14px] text-[var(--t2)] no-underline hover:text-[var(--t1)]">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <p className="m-0 max-w-[760px] text-[12px] leading-[1.6] text-[var(--t3)]">{FOOTER_LEGAL}</p>
      </div>
    </footer>
  );
}
