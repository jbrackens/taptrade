"use client";

/**
 * Landing — the deep-purple front door (Figma: 03 Screens → Landing / 1440).
 *
 * The deep-purple recipe: Fraunces Light display on the landing tokens
 * (globals.css `.landing-1c`), Geist Mono micro-labels, purple for
 * structural action, and gold strictly for the LIVE signal and priority.
 * Every section sells something the product actually does: the ticker is
 * the REAL discovery feed (honest-data rule — no fabricated markets, no
 * invented deltas), the three steps are the real trade loop (moments →
 * hold-to-place → settlement notifications), the desk chips mirror the
 * gateway's editorial event names, and the welcome band promises exactly
 * what the starter grant pays.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { Fraunces } from "next/font/google";
import { useTranslation } from "react-i18next";
import BrandMark from "./components/BrandMark";
import { LanguageSelector } from "./components/i18n/LanguageSelector";
import { brand } from "./lib/brand";
import { logger } from "./lib/logger";

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: "300",
  display: "swap",
});

/** Mirrors syntheticEventTitles in discover/promote.go — product desk
 *  names, rendered in English everywhere, exactly as the feed shows them. */
const DESKS = [
  "ELECTIONS & GOVERNMENT",
  "GAMES & CHAMPIONSHIPS",
  "SCREENS & STAGES",
  "ESPORTS & ARENAS",
  "TECH & AI",
  "ECONOMY & RATES",
  "THE BIG BOARD",
];

const STEP_KEYS = [
  { num: "01", titleKey: "steps.pick.title", bodyKey: "steps.pick.body" },
  { num: "02", titleKey: "steps.hold.title", bodyKey: "steps.hold.body" },
  { num: "03", titleKey: "steps.settle.title", bodyKey: "steps.settle.body" },
] as const;

const FOOTER_LINKS = [
  { href: "/predict", labelKey: "footer.marketsLink" },
  { href: "/leaderboards", labelKey: "footer.leaderboards" },
  { href: "/responsible-gaming", labelKey: "footer.responsibleUse" },
  { href: "/terms", labelKey: "footer.terms" },
] as const;

interface TickerMarket {
  id: string;
  title: string;
  yesPricePoints: number;
}

const TICKER_COUNT = 5;
const TICKER_TITLE_MAX = 26;

/** Real markets only. A failed fetch renders nothing — never a fake tape. */
function useTickerMarkets(): TickerMarket[] {
  const [markets, setMarkets] = useState<TickerMarket[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/v1/discovery", { credentials: "omit" });
        if (!res.ok) return;
        const data = (await res.json()) as Record<string, unknown>;
        const merged = ["featured", "trending", "closingSoon", "recent"]
          .flatMap((k) => (Array.isArray(data[k]) ? (data[k] as unknown[]) : []))
          .filter(
            (m): m is TickerMarket =>
              !!m &&
              typeof m === "object" &&
              typeof (m as TickerMarket).id === "string" &&
              typeof (m as TickerMarket).title === "string" &&
              typeof (m as TickerMarket).yesPricePoints === "number",
          );
        const seen = new Set<string>();
        const unique = merged.filter((m) =>
          seen.has(m.id) ? false : (seen.add(m.id), true),
        );
        if (!cancelled) setMarkets(unique.slice(0, TICKER_COUNT));
      } catch (err: unknown) {
        logger.info("Landing", "ticker fetch skipped", err);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);
  return markets;
}

type RevealProps = {
  children: ReactNode;
  className?: string;
};

/**
 * One-shot scroll reveal (opacity + 16px rise). Server-rendered VISIBLE so
 * first paint never waits for hydration; skipped under
 * prefers-reduced-motion or without IntersectionObserver.
 */
function Reveal({ children, className = "" }: RevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(true);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const rect = node.getBoundingClientRect();
    if (rect.top < window.innerHeight - 40) {
      return;
    }
    setShown(false);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`transition-[opacity,transform] duration-[600ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
        shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      } ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * Compliance copy stays INLINE and English — same architecture as the
 * register page's no-cashout disclosure: the points-only locale boundary
 * test rightly bans money words (cash, redeemable, prizes…) from every
 * locale file, while the legal lines must SAY those words to disclaim
 * them. Counsel-reviewed English pending a localization pass, mirroring
 * brand.ts.
 */
const GRANT_BODY_LEGAL =
  "Join and trade with 500 PTS — non-redeemable gameplay points. Not money. Just conviction, kept score.";
const GRANT_MICRO_LEGAL = "No cash · No cashout · 18+";
const FOOTER_LEGAL = `${brand.name} uses non-redeemable gameplay points. Points cannot be cashed out, withdrawn, transferred, or redeemed for prizes. Prediction markets are speculative; outcomes are not guaranteed. 18+.`;

const MICRO_CLASS =
  "font-mono text-[11px] font-semibold uppercase tracking-[0.13em] text-[var(--l-lavender)]";
const LIVE_MICRO_CLASS =
  "font-mono text-[11px] font-semibold uppercase tracking-[0.13em] text-[var(--l-gold)]";
const CHIP_CLASS =
  "rounded-full border border-[var(--l-hairline)] px-4 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.1em]";
const PRIMARY_CTA_CLASS =
  "inline-flex items-center rounded-lg bg-[var(--l-purple)] font-semibold text-[var(--l-on-purple)] no-underline transition-colors duration-150 hover:bg-[var(--l-purple-hover)] active:bg-[var(--l-purple-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--l-gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--l-bg)]";
const GHOST_CTA_CLASS =
  "inline-flex items-center rounded-lg border border-[var(--l-hairline)] font-semibold text-[var(--l-t1)] no-underline transition-colors duration-150 hover:border-[var(--l-lavender)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--l-gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--l-bg)]";

export default function LandingPage() {
  const { t } = useTranslation("page-home");
  const ticker = useTickerMarkets();

  return (
    <div className="landing-1c min-h-screen bg-[var(--l-bg)] text-[var(--l-t1)]">
      {/* Top bar */}
      <header className="mx-auto flex h-[72px] max-w-[1360px] items-center justify-between px-6 md:px-10">
        <Link
          href="/"
          className="flex items-center gap-2.5 no-underline"
          aria-label={`${brand.name} home`}
        >
          <BrandMark
            size={26}
            tone="light"
          />
          <span className="text-[17px] font-semibold text-[var(--l-t1)]">
            {brand.name}
          </span>
        </Link>
        <nav className="flex items-center gap-4 md:gap-6">
          <span className="inline-flex min-w-0 max-[480px]:hidden [&_.lang-current]:max-w-[92px] [&_.lang-current]:truncate [&_.lang-select-wrap]:relative [&_.lang-select-wrap]:inline-flex [&_.lang-select-wrap]:h-9 [&_.lang-select-wrap]:cursor-pointer [&_.lang-select-wrap]:items-center [&_.lang-select-wrap]:gap-1.5 [&_.lang-select-wrap]:rounded-full [&_.lang-select-wrap]:border [&_.lang-select-wrap]:border-[var(--l-hairline)] [&_.lang-select-wrap]:px-3 [&_.lang-select-wrap]:text-[13px] [&_.lang-select-wrap]:font-medium [&_.lang-select-wrap]:text-[var(--l-t2)] [&_.lang-select]:absolute [&_.lang-select]:inset-0 [&_.lang-select]:cursor-pointer [&_.lang-select]:opacity-0 [&_.sr-only]:absolute [&_.sr-only]:-m-px [&_.sr-only]:h-px [&_.sr-only]:w-px [&_.sr-only]:overflow-hidden [&_.sr-only]:whitespace-nowrap [&_.sr-only]:border-0 [&_.sr-only]:p-0 [&_.sr-only]:[clip:rect(0,0,0,0)]">
            <LanguageSelector source="header" />
          </span>
          <Link
            href="/auth/login"
            className="text-[14px] font-medium text-[var(--l-t1)] no-underline transition-colors duration-150 hover:text-[var(--l-gold)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--l-gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--l-bg)]"
          >
            {t("nav.login")}
          </Link>
          <Link
            href="/predict"
            className={`${PRIMARY_CTA_CLASS} px-4 py-2 text-[14px]`}
          >
            {t("nav.browseMarkets")}
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-[1360px] px-6 pb-24 pt-16 md:px-10 md:pt-24">
        <p className={`m-0 flex items-center gap-2 ${LIVE_MICRO_CLASS}`}>
          <span
            aria-hidden="true"
            className="size-[7px] rounded-full bg-[var(--l-gold)]"
          />
          {t("hero.eyebrow")}
        </p>
        <h1
          className={`${fraunces.className} mb-0 mt-6 max-w-[720px] text-[44px] font-light leading-[1.08] md:text-[76px]`}
        >
          {t("hero.title")}
        </h1>
        <p className="mt-6 max-w-[620px] text-[17px] leading-[1.55] text-[var(--l-t2)]">
          {t("hero.subtitle")}
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link
            href="/predict"
            className={`${PRIMARY_CTA_CLASS} px-6 py-3 text-[15px]`}
          >
            {t("nav.browseMarkets")}
          </Link>
          <a
            href="#how-it-works"
            className={`${GHOST_CTA_CLASS} px-6 py-3 text-[15px]`}
          >
            {t("hero.howItWorks")}
          </a>
        </div>
      </section>

      {/* Live ticker — real discovery data or nothing */}
      {ticker.length > 0 && (
        <div className="overflow-x-auto border-y border-[var(--l-hairline)] bg-[var(--l-inset)]">
          <div className="mx-auto flex max-w-[1360px] items-center gap-9 px-6 py-[18px] md:px-10">
            <span className={`flex shrink-0 items-center gap-2 ${LIVE_MICRO_CLASS}`}>
              <span
                aria-hidden="true"
                className="size-[7px] rounded-full bg-[var(--l-gold)]"
              />
              {t("ticker.live")}
            </span>
            {ticker.map((m) => (
              <span
                key={m.id}
                className="flex shrink-0 items-center gap-2.5 font-mono text-[11px] [font-variant-numeric:tabular-nums]"
              >
                <span className="uppercase tracking-[0.08em] text-[var(--l-t3)]">
                  {m.title.length > TICKER_TITLE_MAX
                    ? `${m.title.slice(0, TICKER_TITLE_MAX).trimEnd()}…`
                    : m.title}
                </span>
                <span className="text-[12px] font-semibold text-[var(--l-t1)]">
                  {m.yesPricePoints}¢
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* How it works — the real trade loop */}
      <section
        id="how-it-works"
        className="mx-auto max-w-[1360px] px-6 py-20 md:px-10"
      >
        <Reveal>
          <p className={`m-0 ${MICRO_CLASS}`}>{t("steps.eyebrow")}</p>
          <div className="mt-9 grid gap-6 md:grid-cols-3">
            {STEP_KEYS.map((step) => (
              <div
                key={step.num}
                className="rounded-xl border border-[var(--l-hairline)] bg-[var(--l-raised)] p-7"
              >
                <p className="m-0 font-mono text-[12px] font-semibold tracking-[0.11em] text-[var(--l-lavender)]">
                  {step.num}
                </p>
                <h3 className="mb-0 mt-3.5 text-[20px] font-semibold text-[var(--l-t1)]">
                  {t(step.titleKey)}
                </h3>
                <p className="mb-0 mt-3.5 text-[15px] leading-[1.5] text-[var(--l-t2)]">
                  {t(step.bodyKey)}
                </p>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* Editorial desks */}
      <section className="border-t border-[var(--l-hairline)] bg-[var(--l-inset)]">
        <div className="mx-auto max-w-[1360px] px-6 pb-20 pt-16 md:px-10">
          <Reveal>
            <p className={`m-0 ${MICRO_CLASS}`}>{t("desks.eyebrow")}</p>
            <p
              className={`${fraunces.className} mb-0 mt-7 text-[26px] font-light text-[var(--l-t1)] md:text-[34px]`}
            >
              {t("desks.title")}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              {DESKS.map((desk) => (
                <span
                  key={desk}
                  className={`${CHIP_CLASS} ${
                    desk === "THE BIG BOARD"
                      ? "text-[var(--l-gold)]"
                      : "text-[var(--l-t3)]"
                  }`}
                >
                  {desk}
                </span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* Welcome grant */}
      <section className="mx-auto flex max-w-[860px] flex-col items-center px-6 py-24 text-center md:py-28">
        <Reveal className="flex flex-col items-center">
          <h2
            className={`${fraunces.className} m-0 text-[34px] font-light leading-[1.15] md:text-[52px]`}
          >
            {t("grant.title")}
          </h2>
          <p className="mb-0 mt-6 max-w-[560px] text-[17px] leading-[1.55] text-[var(--l-t2)]">
            {GRANT_BODY_LEGAL}
          </p>
          <Link
            href="/auth/register"
            className={`${PRIMARY_CTA_CLASS} mt-8 px-7 py-[15px] text-[16px]`}
          >
            {t("grant.cta")}
          </Link>
          <p className="mb-0 mt-6 font-mono text-[10px] font-medium uppercase tracking-[0.13em] text-[var(--l-t3)]">
            {GRANT_MICRO_LEGAL}
          </p>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--l-hairline)]">
        <div className="mx-auto flex max-w-[1360px] flex-col gap-10 px-6 pb-12 pt-10 md:flex-row md:items-start md:justify-between md:px-10">
          <div>
            <p className="m-0 text-[16px] font-semibold text-[var(--l-t1)]">
              {brand.name}
            </p>
            <p className="mb-0 mt-3 text-[12px] text-[var(--l-t3)]">
              {t("footer.copyright")}
            </p>
          </div>
          <nav className="flex flex-wrap gap-6">
            {FOOTER_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="font-mono text-[10px] font-medium uppercase tracking-[0.13em] text-[var(--l-t3)] no-underline hover:text-[var(--l-t1)]"
              >
                {t(link.labelKey)}
              </Link>
            ))}
          </nav>
          <p className="mb-0 mt-0 max-w-[420px] text-[12px] leading-[1.5] text-[var(--l-t3)]">
            {FOOTER_LEGAL}
          </p>
        </div>
      </footer>
    </div>
  );
}
