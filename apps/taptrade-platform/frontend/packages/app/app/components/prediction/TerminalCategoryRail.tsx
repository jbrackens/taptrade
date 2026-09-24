"use client";

import Link from "next/link";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { CurrencyBtcIcon as Bitcoin } from "@phosphor-icons/react/dist/csr/CurrencyBtc";
import { ChartLineUpIcon as EconomicsIcon } from "@phosphor-icons/react/dist/csr/ChartLineUp";
import { CpuIcon as Cpu } from "@phosphor-icons/react/dist/csr/Cpu";
import { BankIcon as Landmark } from "@phosphor-icons/react/dist/csr/Bank";
import { MusicNotesIcon as Music2 } from "@phosphor-icons/react/dist/csr/MusicNotes";
import { TrophyIcon as Trophy } from "@phosphor-icons/react/dist/csr/Trophy";
import { useTranslation } from "react-i18next";
import type { Category } from "@taptrade-ui/api-client/src/prediction-types";
import { categoryName } from "./market-content";

export const TERMINAL_CATEGORY_ICONS: Record<string, PhosphorIcon> = {
  politics: Landmark,
  sports: Trophy,
  entertainment: Music2,
  culture: Music2,
  crypto: Bitcoin,
  tech: Cpu,
  technology: Cpu,
  economics: EconomicsIcon,
};

interface TerminalCategoryRailProps {
  categories: Category[];
  mode: "predict" | "discover";
  activeCategorySlug?: string;
}

function monogramOf(label: string): string {
  return label.slice(0, 2).toUpperCase();
}

export function TerminalCategoryRail({
  categories,
  mode,
  activeCategorySlug,
}: TerminalCategoryRailProps) {
  const { t } = useTranslation("prediction");
  const { t: contentT } = useTranslation("market-content");
  const isPredict = mode === "predict";
  const visibleCategories = categories.slice(0, 7);
  const homeActive = !activeCategorySlug;
  const homeHref = isPredict ? "/predict" : "/discover";
  const homeLabel = isPredict
    ? t("WORKSPACE_ALL_MOMENTS", "All moments")
    : t("FOR_YOU");
  // Kilig light chrome: a white rail on a hairline edge. Selection is the
  // ink pill (the interaction voice), never pink.
  const railClass = isPredict
    ? "terminal-scrollbar sticky top-16 flex h-[calc(100vh-64px)] min-w-0 flex-col overflow-y-auto border-r border-[var(--border-1)] bg-[var(--surface-1)] px-5 pb-8 pt-8 max-[1199px]:px-2.5 max-[1023px]:hidden"
    : "terminal-scrollbar sticky top-16 flex h-[calc(100vh-64px)] min-w-0 flex-col overflow-y-auto border-r border-[var(--border-1)] bg-[var(--surface-1)] px-2.5 pb-5 pt-4 max-[1023px]:hidden";
  const linkBase = isPredict
    ? "group flex min-h-9 items-center gap-2 rounded-[var(--r-rh-md)] px-3 text-[14px] font-medium no-underline transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] max-[1199px]:justify-center max-[1199px]:px-2"
    : "group flex min-h-9 items-center gap-2 rounded-[var(--r-rh-md)] px-2.5 text-[13px] font-medium no-underline transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] max-[1279px]:justify-center max-[1279px]:px-2";
  const activeLink =
    "bg-[var(--accent)] font-semibold text-[var(--ticket-cta-text)]";
  const inactiveLink =
    "text-[var(--t2)] hover:bg-[var(--surface-2)] hover:text-[var(--t1)]";
  const labelClass = isPredict
    ? "max-[1199px]:sr-only"
    : "max-[1279px]:sr-only";
  const monogramClass = isPredict
    ? "hidden font-mono text-[11px] font-medium max-[1199px]:inline"
    : "hidden font-mono text-[11px] font-medium max-[1279px]:inline";

  return (
    <aside className={railClass}>
      {isPredict && (
        <header className="max-[1199px]:hidden">
          <h2 className="type-poster m-0 text-[38px] font-black text-[var(--t1)]">
            {t("WORKSPACE_MOMENTS_RAIL_LINE_ONE", "Trending")}
            <br />
            <span className="text-[var(--kilig)]">
              {t("WORKSPACE_MOMENTS_RAIL_LINE_TWO", "Moments")}
            </span>
          </h2>
          <p className="mb-0 mt-3 text-[13px] leading-[1.45] text-[var(--t2)]">
            {t(
              "WORKSPACE_MOMENTS_RAIL_COPY",
              "See what people are watching— and decide where you stand.",
            )}
          </p>
          <p className="mb-0 mt-6 font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--t3)]">
            {t("WORKSPACE_EXPLORE_TOPICS_LABEL", "Explore topics")}
          </p>
        </header>
      )}

      <nav
        className={`flex flex-col gap-0.5 ${isPredict ? "mt-3 max-[1199px]:mt-0" : ""}`}
        aria-label={
          isPredict
            ? t("WORKSPACE_EXPLORE_TOPICS_LABEL", "Explore topics")
            : t("MARKET_TOPICS")
        }
      >
        <Link
          href={homeHref}
          aria-current={homeActive ? "page" : undefined}
          className={`${linkBase} ${homeActive ? activeLink : inactiveLink}`}
        >
          <span className={labelClass}>{homeLabel}</span>
          <span className={monogramClass} aria-hidden="true">
            {monogramOf(homeLabel)}
          </span>
        </Link>

        {visibleCategories.map((category) => {
          const slug = category.slug.toLowerCase();
          const active = activeCategorySlug === slug;
          const label = categoryName(contentT, category);
          const href =
            mode === "discover"
              ? `/discover?category=${encodeURIComponent(slug)}`
              : `/predict?category=${encodeURIComponent(slug)}`;
          return (
            <Link
              key={category.id}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`${linkBase} ${active ? activeLink : inactiveLink}`}
            >
              <span className={labelClass}>{label}</span>
              <span className={monogramClass} aria-hidden="true">
                {monogramOf(label)}
              </span>
            </Link>
          );
        })}

        <Link href="/portfolio" className={`${linkBase} ${inactiveLink}`}>
          <span className={labelClass}>{t("SAVED")}</span>
          <span className={monogramClass} aria-hidden="true">
            {monogramOf(t("SAVED"))}
          </span>
        </Link>
      </nav>

      {!isPredict && (
        <div className="mt-auto border-t border-[var(--border-1)] px-2 pt-5 max-[1279px]:px-0">
          <div className="flex items-center gap-2 text-[11px] font-medium text-[var(--t2)] max-[1279px]:justify-center">
            <span
              className="h-2 w-2 rounded-full bg-[var(--live)]"
              aria-hidden="true"
            />
            <span className="max-[1279px]:sr-only">
              {t("MARKET_DATA_LIVE")}
            </span>
          </div>
          <p className="mt-2 text-[11px] leading-[1.45] text-[var(--t3)] max-[1279px]:hidden">
            {t("MARKET_RISK_SHORT")}
          </p>
        </div>
      )}
    </aside>
  );
}
