"use client";

/**
 * MobileTabBar — fixed bottom navigation on mobile (<900px, per D12).
 *
 * Uses the same primary nav rules as TopBar: public links are visible to
 * everyone, auth-required links only appear after login. Hidden on desktop
 * because nav lives in TopBar there.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { PulseIcon as Activity } from "@phosphor-icons/react/dist/csr/Pulse";
import { SquaresFourIcon as LayoutGrid } from "@phosphor-icons/react/dist/csr/SquaresFour";
import { ChartPieSliceIcon as PieChart } from "@phosphor-icons/react/dist/csr/ChartPieSlice";
import { TrophyIcon as Trophy } from "@phosphor-icons/react/dist/csr/Trophy";
import { GiftIcon as Gift } from "@phosphor-icons/react/dist/csr/Gift";
import { UserIcon as User } from "@phosphor-icons/react/dist/csr/User";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { FEATURE_LIVE_MARKETS } from "../lib/features";
import { isPredictionTerminalRoute } from "../lib/prediction-terminal";

type TabDef = {
  href: string;
  labelKey: string;
  Icon: PhosphorIcon;
  requiresAuth?: boolean;
  enabled?: boolean;
  matchPrefixes?: string[];
};

const TABS: TabDef[] = [
  {
    href: "/predict",
    labelKey: "NAV_MARKETS",
    Icon: LayoutGrid,
    matchPrefixes: ["/predict", "/category/", "/market/"],
  },
  {
    href: "/discover",
    labelKey: "NAV_TRENDING",
    Icon: Activity,
    matchPrefixes: ["/discover"],
  },
  {
    href: "/live",
    labelKey: "NAV_LIVE",
    Icon: Activity,
    enabled: FEATURE_LIVE_MARKETS,
    matchPrefixes: ["/live"],
  },
  {
    href: "/portfolio",
    labelKey: "NAV_PORTFOLIO",
    Icon: PieChart,
    requiresAuth: true,
  },
  {
    href: "/leaderboards",
    labelKey: "NAV_LEADERBOARDS",
    Icon: Trophy,
    requiresAuth: true,
  },
  {
    href: "/rewards",
    labelKey: "NAV_REWARDS",
    Icon: Gift,
    requiresAuth: true,
  },
];

const TERMINAL_TABS: TabDef[] = [
  {
    href: "/predict",
    labelKey: "NAV_MARKETS",
    Icon: LayoutGrid,
    matchPrefixes: ["/predict", "/category/", "/market/"],
  },
  {
    href: "/discover",
    labelKey: "NAV_TRENDING",
    Icon: Activity,
    matchPrefixes: ["/discover"],
  },
  {
    href: "/portfolio",
    labelKey: "NAV_PORTFOLIO",
    Icon: PieChart,
    requiresAuth: true,
  },
  {
    href: "/account",
    labelKey: "NAV_ACCOUNT",
    Icon: User,
    requiresAuth: true,
  },
];

const MOBILE_TAB_BAR_CLASS =
  "fixed inset-x-0 bottom-0 z-[90] grid max-w-full overflow-hidden border-x-0 border-b-0 border-t border-[var(--border-1)] bg-[var(--surface-1)] px-2 pt-1.5 pb-[max(6px,env(safe-area-inset-bottom))]";

const TERMINAL_MOBILE_TAB_BAR_CLASS =
  "fixed inset-x-0 bottom-0 z-[90] grid max-w-full overflow-hidden border-x-0 border-b-0 border-t border-[var(--border-1)] bg-[var(--surface-1)] px-2 pt-1.5 pb-[max(6px,env(safe-area-inset-bottom))]";

const MOBILE_TAB_ITEM_CLASS =
  "flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-[var(--r-rh-md)] px-0.5 py-2 text-center text-[11px] tracking-[0.01em] no-underline transition-[color,background] duration-150 ease-[ease] [font-family:inherit]";

const MOBILE_TAB_ITEM_INACTIVE_CLASS =
  "font-semibold text-[var(--t3)] hover:text-[var(--t1)]";

const MOBILE_TAB_ITEM_ACTIVE_CLASS =
  "font-bold text-[var(--t1)] [&_svg]:text-[var(--t1)]";
const TERMINAL_MOBILE_TAB_ITEM_ACTIVE_CLASS =
  "font-bold text-[var(--t1)] [&_svg]:text-[var(--t1)]";
const TERMINAL_MOBILE_TAB_ITEM_INACTIVE_CLASS =
  "font-semibold text-[var(--t3)] hover:text-[var(--t1)]";

function gridClassForCount(count: number): string {
  switch (count) {
    case 1:
      return "grid-cols-1";
    case 2:
      return "grid-cols-2";
    case 3:
      return "grid-cols-3";
    case 4:
      return "grid-cols-4";
    case 5:
      return "grid-cols-5";
    case 6:
      return "grid-cols-6";
    default:
      return "grid-cols-1";
  }
}

function matches(pathname: string | null, tab: TabDef): boolean {
  if (!pathname) return false;
  const prefixes = tab.matchPrefixes ?? [tab.href];
  return prefixes.some((p) =>
    p.endsWith("/")
      ? pathname.startsWith(p)
      : pathname === p || pathname.startsWith(`${p}/`),
  );
}

export default function MobileTabBar() {
  const pathname = usePathname();
  const { t } = useTranslation("header");
  const { isAuthenticated } = useAuth();

  // Render only on mobile. Desktop uses TopBar's nav links.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 899px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  if (!isMobile) return null;
  const isTerminalRoute = isPredictionTerminalRoute(pathname);
  const availableTabs = isTerminalRoute ? TERMINAL_TABS : TABS;
  const visibleTabs = availableTabs.filter(
    (tab) => tab.enabled !== false && (!tab.requiresAuth || isAuthenticated),
  );

  return (
    <nav
      className={`${
        isTerminalRoute ? TERMINAL_MOBILE_TAB_BAR_CLASS : MOBILE_TAB_BAR_CLASS
      } ${gridClassForCount(visibleTabs.length)}`}
      aria-label="Primary (mobile)"
    >
      {visibleTabs.map((tab) => {
        const active = matches(pathname, tab);
        const Icon = tab.Icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`${MOBILE_TAB_ITEM_CLASS} ${
              isTerminalRoute
                ? active
                  ? TERMINAL_MOBILE_TAB_ITEM_ACTIVE_CLASS
                  : TERMINAL_MOBILE_TAB_ITEM_INACTIVE_CLASS
                : active
                  ? MOBILE_TAB_ITEM_ACTIVE_CLASS
                  : MOBILE_TAB_ITEM_INACTIVE_CLASS
            }`}
            aria-current={active ? "page" : undefined}
          >
            <Icon
              size={19}
              weight={active ? "fill" : "regular"}
              className="block"
              aria-hidden="true"
            />
            <span>{t(tab.labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
