"use client";

/**
 * TopBar — sticky 64px glass-med strip (DESIGN.md §6 shell structure).
 *
 * Layout: brand lockup · horizontal nav links · search +
 * balance pill + avatar. No category strip — categories moved into the
 * /predict page body as a horizontal chip strip.
 *
 * Renamed from PredictHeader in Phase 3 per plan decision D6. Search,
 * balance, auth menu, and TierPill logic preserved from the prior
 * implementation.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlassIcon as Search } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { SignOutIcon as LogOut } from "@phosphor-icons/react/dist/csr/SignOut";
import { PlusIcon as Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { UserIcon } from "@phosphor-icons/react/dist/csr/User";
import { GiftIcon as Gift } from "@phosphor-icons/react/dist/csr/Gift";
import { TrophyIcon as Trophy } from "@phosphor-icons/react/dist/csr/Trophy";
import { FlameIcon as Flame } from "@phosphor-icons/react/dist/csr/Flame";
import { CURRENCY_NAME, formatPointsAmount } from "../../lib/points";
import { ListIcon as MenuLines } from "@phosphor-icons/react/dist/csr/List";
import { GearSixIcon as Settings } from "@phosphor-icons/react/dist/csr/GearSix";
import { TrendUpIcon as TrendingUp } from "@phosphor-icons/react/dist/csr/TrendUp";
import { CaretLeftIcon as CaretLeft } from "@phosphor-icons/react/dist/csr/CaretLeft";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { PredictionMarket } from "@taptrade-ui/api-client/src/prediction-types";
import { createPredictionClient } from "@taptrade-ui/api-client/src/prediction-client";
import { isPredictionTerminalRoute } from "../../lib/prediction-terminal";
import { logger } from "../../lib/logger";
import { searchMarkets } from "../../lib/marketSearch";
import { useAuth } from "../../hooks/useAuth";
import BrandMark from "../BrandMark";
import { Button } from "../ui";
import { PointsFlow } from "../ui/PointsFlow";
import { brand } from "../../lib/brand";
import { useAppDispatch, useAppSelector } from "../../lib/store/hooks";
import {
  selectCurrentBalance,
  setCurrentBalance,
} from "../../lib/store/pointBalanceSlice";
import { getBalance } from "../../lib/api/wallet-client";
import { TierPill } from "./TierPill";
import { CommandPalette } from "./CommandPalette";
import { NotificationsBell } from "./NotificationsBell";
import { LanguageSelector } from "../i18n/LanguageSelector";
import { localizedMarket } from "./market-content";
import { FEATURE_LIVE_MARKETS } from "../../lib/features";
import { hasInAppHistory, useMobileTopBarConfig } from "./MobileTopBarContext";

const api = createPredictionClient();

/**
 * The balance chip: a pink flame and the figure (compact from 100K), the
 * exact amount in its label and title. It deep-links into the Clout Store,
 * where people go when they want more. Shown on every route (the 2026-09-29
 * redesign added it to the board and market pages) and in a page's phone
 * header.
 */
function BalanceChip({
  balance,
  t,
}: {
  balance: number | undefined;
  t: TFunction<"header">;
}) {
  return (
    <Link
      href="/store"
      className={TOP_BAR_BALANCE_CLASS}
      aria-label={
        typeof balance === "number"
          ? `${formatPointsAmount(balance)} ${CURRENCY_NAME} · ${t("OPEN_POINT_STORE", "Get more Clout")}`
          : t("OPEN_POINT_STORE", "Get more Clout")
      }
      title={typeof balance === "number" ? `${formatPointsAmount(balance)} ${CURRENCY_NAME}` : undefined}
    >
      <span className={TOP_BAR_BALANCE_LABEL_CLASS} aria-hidden="true">
        <Flame size={16} weight="fill" />
      </span>
      <span>
        {/*
          Render a placeholder when the balance is undefined
          (still loading) instead of "0 pts". The literal zero
          was misleading: on every page navigation, between the
          initial render and the point-balance API resolving (~300ms-3s
          in dev), the user saw "BAL 0 pts" - easy to read as
          "your account is empty" and panic. A neutral "—"
          reads as "loading" without claiming a value.
        */}
        {typeof balance === "number" ? (
          <>
            {/* Large balances read as 1.5M; the exact figure is
                in the chip's label and on Account. */}
            <PointsFlow value={balance} compact={balance >= 100_000} />
            <span className="sr-only">&nbsp;{CURRENCY_NAME}</span>
          </>
        ) : (
          "—"
        )}
      </span>
    </Link>
  );
}

// Top-level nav. `requiresAuth` items are hidden from logged-out visitors —
// they would either land on a sign-in wall (Portfolio) or render with an
// empty / placeholder state (Leaderboards, Rewards), neither of which makes
// sense as a discoverable destination before login.
const NAV_LINKS: {
  href: string;
  labelKey: string;
  requiresAuth?: boolean;
  enabled?: boolean;
  /** Extra classes, e.g. to drop a link before the bar runs out of room. */
  className?: string;
}[] = [
  // Home gives way first: below 1000px the links would otherwise run under
  // the balance chip. Rewards and Leaderboards live in the account menu.
  { href: "/", labelKey: "NAV_HOME", className: "max-[1000px]:hidden" },
  { href: "/predict", labelKey: "NAV_MARKETS" },
  { href: "/discover", labelKey: "NAV_TRENDING" },
  { href: "/live", labelKey: "NAV_LIVE", enabled: FEATURE_LIVE_MARKETS },
  { href: "/portfolio", labelKey: "NAV_PORTFOLIO", requiresAuth: true },
];

const TERMINAL_NAV_LINKS: typeof NAV_LINKS = [
  { href: "/predict", labelKey: "NAV_MARKETS" },
  { href: "/discover", labelKey: "NAV_TRENDING" },
  { href: "/portfolio", labelKey: "NAV_PORTFOLIO", requiresAuth: true },
];

// Kilig: one white bar on every route — ink wordmark with the pink
// period, neutral nav, ink actions. (Prediction routes keep a tighter
// layout, not a different colour.)
const TOP_BAR_CLASS =
  "sticky top-0 z-[100] border-b border-[var(--border-1)] bg-[var(--surface-1)] font-sans";

const TERMINAL_TOP_BAR_CLASS =
  "sticky top-0 z-[100] border-b border-[var(--border-1)] bg-[var(--surface-1)] font-sans";

const TOP_BAR_INNER_CLASS =
  "box-border mx-auto flex h-16 w-full max-w-[1588px] items-center gap-6 px-6 max-[900px]:h-16 max-[900px]:gap-3 max-[900px]:px-4 max-[480px]:gap-2 max-[480px]:px-3";

// Feed v2 parity (FEED2-001): the composed Organism/TopBar is a 64px strip,
// 20px side padding, 26px cluster gap — not the 74px one-off it replaced.
const TERMINAL_TOP_BAR_INNER_CLASS =
  "box-border mx-auto flex h-16 w-full items-center gap-[26px] px-5 max-[1100px]:gap-5 max-[900px]:px-4 max-[480px]:gap-2 max-[480px]:px-3";

const TOP_BAR_BRAND_CLASS =
  "inline-flex min-h-11 shrink-0 items-center gap-[10px] no-underline";

// TapTrade uses a title-case wordmark beside the approved stepped-route
// mark, set in the UI face so white-label brand names stay data-driven.
// The Kilig period after the name is the brand's one flash of pink here.
const TOP_BAR_WORDMARK_CLASS =
  "whitespace-nowrap text-[21px] font-bold leading-none tracking-[-0.03em] text-[var(--brand-ink)] max-[480px]:text-[19px] max-[359px]:hidden";

const TERMINAL_TOP_BAR_WORDMARK_CLASS =
  "whitespace-nowrap text-[19px] font-bold leading-none tracking-[-0.03em] text-[var(--brand-ink)] max-[480px]:text-[17px]";

const TOP_BAR_NAV_CLASS =
  "flex items-center gap-6 w-full min-w-0 flex-1 max-[900px]:hidden";

// Nav links are quiet sentence-case pills: muted at rest, a raised well
// under the current route. Same recipe on every route.
const TOP_BAR_LINK_CLASS =
  "relative whitespace-nowrap rounded-[var(--r-rh-md)] px-3 py-2 text-sm font-semibold no-underline transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)]";

const TOP_BAR_LINK_INACTIVE_CLASS =
  "text-[var(--t3)] hover:text-[var(--t1)]";

const TERMINAL_TOP_BAR_LINK_CLASS = TOP_BAR_LINK_CLASS;
const TERMINAL_TOP_BAR_LINK_ACTIVE_CLASS =
  "bg-[var(--surface-2)] !text-[var(--t1)]";
const TERMINAL_TOP_BAR_LINK_INACTIVE_CLASS = TOP_BAR_LINK_INACTIVE_CLASS;

const TOP_BAR_LINK_ACTIVE_CLASS = "bg-[var(--surface-2)] !text-[var(--t1)]";

const TOP_BAR_RIGHT_CLASS = [
  // min-w-0 (not shrink-0): the cluster must compress on narrow phones —
  // at 320px an unshrinkable cluster forces horizontal page scroll.
  // ml-auto + justify-end: below 900px the nav and search are hidden, and
  // only the signed-in bell carried ml-auto, so signed-out Log in / Sign up
  // sat beside the logo with the right third of the bar empty.
  "ml-auto flex min-w-0 shrink items-center justify-end gap-2.5",
  "[&_.lang-select-wrap]:relative [&_.lang-select-wrap]:inline-flex [&_.lang-select-wrap]:min-h-10 [&_.lang-select-wrap]:max-w-[190px] [&_.lang-select-wrap]:items-center [&_.lang-select-wrap]:gap-1.5 [&_.lang-select-wrap]:rounded-md [&_.lang-select-wrap]:border [&_.lang-select-wrap]:border-[var(--border-1)] [&_.lang-select-wrap]:bg-[var(--surface-1)] [&_.lang-select-wrap]:px-2.5 [&_.lang-select-wrap]:py-0 [&_.lang-select-wrap]:text-xs [&_.lang-select-wrap]:font-semibold [&_.lang-select-wrap]:text-[var(--t1)]",
  "[&_.lang-select]:absolute [&_.lang-select]:inset-0 [&_.lang-select]:cursor-pointer [&_.lang-select]:opacity-0",
  "[&_.lang-current]:block [&_.lang-current]:overflow-hidden [&_.lang-current]:text-ellipsis [&_.lang-current]:whitespace-nowrap",
  "[&_.sr-only]:absolute [&_.sr-only]:-m-px [&_.sr-only]:h-px [&_.sr-only]:w-px [&_.sr-only]:overflow-hidden [&_.sr-only]:whitespace-nowrap [&_.sr-only]:border-0 [&_.sr-only]:p-0 [&_.sr-only]:[clip:rect(0,0,0,0)]",
  "max-[900px]:[&_.lang-select-wrap]:max-w-14 max-[900px]:[&_.lang-select-wrap]:px-3 max-[900px]:[&_.lang-current]:hidden",
  // Ultra-narrow (<360px): drop the language selector entirely; it remains
  // reachable from Account settings, and the balance chip keeps priority.
  "max-[359px]:[&_.lang-select-wrap]:hidden",
].join(" ");

const TOP_BAR_SEARCH_WRAP_CLASS = "relative max-[900px]:hidden";
const TOP_BAR_SEARCH_LABEL_CLASS = "relative inline-flex items-center";
const TOP_BAR_SEARCH_INPUT_CLASS =
  "h-10 w-[280px] rounded-[var(--r-pill)] border border-transparent bg-[var(--surface-2)] py-0 pl-9 pr-3.5 text-[13.5px] text-[var(--t1)] outline-none transition-[border-color,background-color,box-shadow] duration-150 placeholder:text-[var(--t3)] focus-visible:border-[var(--t1)] focus-visible:bg-[var(--surface-1)] [font-family:inherit]";
// The search field is a raised pill; it reads as a well, not a box.
const TERMINAL_TOP_BAR_SEARCH_INPUT_CLASS =
  "h-10 w-full rounded-[var(--r-pill)] border border-transparent bg-[var(--surface-2)] py-0 pl-10 pr-3.5 text-[13.5px] text-[var(--t1)] outline-none transition-[border-color,background-color,box-shadow] duration-150 placeholder:text-[var(--t3)] focus-visible:border-[var(--t1)] focus-visible:bg-[var(--surface-1)] [font-family:inherit]";
const TOP_BAR_SEARCH_ICON_CLASS =
  "pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--t3)]";
const TOP_BAR_SEARCH_RESULTS_CLASS =
  "absolute left-0 right-0 top-[calc(100%_+_6px)] z-[110] m-0 max-h-[360px] list-none overflow-y-auto rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-1)] p-1 shadow-[var(--shadow-pop)]";
const TOP_BAR_SEARCH_HIT_CLASS =
  "flex cursor-pointer flex-col gap-0.5 rounded-[var(--r-sm)] px-3 py-2";
const TOP_BAR_SEARCH_HIT_INACTIVE_CLASS = "hover:bg-[var(--accent-soft)]";
const TOP_BAR_SEARCH_HIT_ACTIVE_CLASS = "bg-[var(--accent-soft)]";
const TOP_BAR_SEARCH_HIT_TITLE_CLASS =
  "text-[13px] font-semibold text-[var(--t1)]";
const TOP_BAR_SEARCH_HIT_META_CLASS =
  "text-[11px] text-[var(--t3)] tabular-nums font-mono";
const TOP_BAR_SEARCH_EMPTY_CLASS =
  "px-3 py-3.5 text-center text-xs text-[var(--t3)]";

// The balance is a magnitude: ink mono numerals on a hairline pill. It
// deep-links to the Point Store, so hover darkens the stroke.
const TOP_BAR_BALANCE_CLASS =
  "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-[var(--r-pill)] border border-[var(--border-1)] bg-[var(--surface-1)] px-3.5 py-[7px] text-[13px] font-semibold text-[var(--t1)] tabular-nums no-underline transition-[border-color] duration-150 hover:border-[var(--t3)] font-mono";
// Ultra-narrow (<360px): the pill row keeps only what matters — the
// loyalty pill hides (TierPill max-[359px]:hidden, /rewards stays in the
// menu) and the BAL label drops so the number itself never crushes.
// The Clout mark: a flame in Kilig pink (identity), replacing the old
// "BAL … pts" labels that read as unfinished (2026-09-28).
const TOP_BAR_BALANCE_LABEL_CLASS =
  "inline-flex text-[var(--kilig)] max-[359px]:hidden";
// Compact "Add Points" entry to /store, always adjacent to the balance
// chip. The top bar is already width-tight at common desktop sizes (search
// + tier pill + balance), so the label only appears on wide desktops and
// the control collapses to the plus glyph below 1360px (aria-label keeps
// it accessible). Sizing rides on ui/Button variant="primary".
const TOP_BAR_ADD_POINTS_SIZING =
  "min-h-11 shrink-0 px-3 text-[13px] no-underline max-[900px]:px-2.5";

// The avatar is an ink disc with white initials.
// The account menu's trigger reads as a menu: a pill with the three-line
// menu mark beside the avatar (a bare initial disc gave no hint it opens
// anything, 2026-09-28). The disc stays Kilig ink.
const TOP_BAR_MENU_TRIGGER_CLASS =
  "inline-flex h-11 cursor-pointer items-center gap-2 rounded-[var(--r-pill)] border border-[var(--border-2)] bg-[var(--surface-1)] py-1 pl-3 pr-1 text-[var(--t1)] transition-[border-color,box-shadow] duration-150 hover:border-[var(--t3)] hover:shadow-[var(--shadow-card-hover)] aria-expanded:border-[var(--t3)] aria-expanded:shadow-[var(--shadow-card-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] max-[359px]:pl-1";
const TOP_BAR_AVATAR_CLASS =
  "grid size-8 place-items-center rounded-full bg-[var(--accent)] text-[13px] font-bold text-[var(--ticket-cta-text)]";

// A page's own phone header (MobileTopBarContext): back, title, actions.
const TOP_BAR_CONTEXT_CLASS =
  "flex h-16 items-center gap-1 px-2 min-[1024px]:hidden";
const TOP_BAR_BACK_CLASS =
  "grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-[var(--t1)] transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]";
const TOP_BAR_CONTEXT_TITLE_CLASS =
  "min-w-0 flex-1 truncate text-[15px] font-semibold text-[var(--t1)]";

const TOP_BAR_AUTH_CTA_SIZING =
  "min-h-11 px-4 text-[13px] no-underline max-[480px]:px-2.5";

// FEED2-001: composed auth cluster is compact (32px) on desktop pointer
// surfaces; the 44px touch minimum returns below the 900px breakpoint.
const TERMINAL_TOP_BAR_AUTH_CTA_SIZING =
  "min-h-9 px-3.5 text-[13px] no-underline max-[900px]:min-h-11 max-[480px]:px-2.5";

const TOP_BAR_MENU_WRAP_CLASS = "relative";
const TOP_BAR_MENU_CLASS =
  "absolute right-0 top-[calc(100%_+_6px)] z-[110] min-w-[200px] rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-1)] p-1 shadow-[var(--shadow-pop)]";
const TOP_BAR_MENU_ITEM_BASE_CLASS =
  "flex w-full cursor-pointer items-center gap-2 rounded-[var(--r-sm)] border-0 bg-transparent px-3 py-2 text-left text-[13px] no-underline hover:bg-[var(--surface-2)] [font-family:inherit]";
const TOP_BAR_MENU_ITEM_CLASS = `${TOP_BAR_MENU_ITEM_BASE_CLASS} text-[var(--t1)]`;
const TOP_BAR_MENU_LOGOUT_CLASS = `${TOP_BAR_MENU_ITEM_BASE_CLASS} text-[var(--t2)]`;
const TOP_BAR_MENU_DIVIDER_CLASS = "my-1 h-px bg-[var(--surface-2)]";

export function TopBar() {
  const { t } = useTranslation("header");
  const { t: contentT } = useTranslation("market-content");
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dispatch = useAppDispatch();
  const balance = useAppSelector(selectCurrentBalance);

  // Hydrate the current point balance whenever the user resolves.
  // Without this, the BAL pill in the top nav reads zero on every page
  // until a fresh navigation to /predict or /portfolio fetches points.
  // TopBar mounts on every page, so we fetch once when auth is ready.
  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;
    let cancelled = false;
    getBalance(user.id)
      .then((bal) => {
        if (!cancelled) dispatch(setCurrentBalance(bal.availableBalance));
      })
      .catch((err: unknown) => {
        logger.warn("TopBar", "balance fetch failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user?.id, dispatch]);

  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [allMarkets, setAllMarkets] = useState<PredictionMarket[]>([]);
  const [cursor, setCursor] = useState(0);

  // Mobile-vs-desktop gate. Matches the Tailwind max-[900px] breakpoint so
  // the nav links + search are removed from the DOM on mobile (not just
  // display:none), which keeps text-based tests deterministic — the
  // same "Rewards" label shouldn't appear twice in DOM order (once in
  // the nav, once in a page kicker). Phase-3 smoke spec relies on this.
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 900px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const loadMarketsIfNeeded = useCallback(async () => {
    if (allMarkets.length > 0) return;
    try {
      const res = await api.getMarkets({ status: "open", pageSize: 100 });
      setAllMarkets(res.data);
    } catch (err: unknown) {
      logger.warn("TopBar", "market index fetch failed", err);
    }
  }, [allMarkets.length]);

  const searchResults = useMemo(
    () =>
      searchMarkets(
        allMarkets.map((m) => localizedMarket(contentT, m)),
        query,
        8,
      ),
    [query, allMarkets, contentT],
  );

  useEffect(() => {
    if (!searchOpen) return;
    const onClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSearchOpen(false);
        searchInputRef.current?.blur();
      }
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [searchOpen]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: cursor reset keyed to query changes it doesn't read — intentional signal dependency
  useEffect(() => {
    setCursor(0);
  }, [query]);

  const navigateToMarket = useCallback(
    (ticker: string) => {
      setSearchOpen(false);
      setQuery("");
      searchInputRef.current?.blur();
      router.push(`/market/${ticker}`);
    },
    [router],
  );

  const handleSearchKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (searchResults.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, searchResults.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const hit = searchResults[cursor] ?? searchResults[0];
        if (hit) navigateToMarket(hit.ticker);
      }
    },
    [searchResults, cursor, navigateToMarket],
  );

  useEffect(() => {
    if (!userMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setUserMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [userMenuOpen]);

  const handleLogout = useCallback(async () => {
    setUserMenuOpen(false);
    await logout();
  }, [logout]);

  const initial = (user?.username || user?.email || "?")
    .charAt(0)
    .toUpperCase();
  const isTerminalRoute = isPredictionTerminalRoute(pathname);
  const mobileContext = useMobileTopBarConfig();
  const goBack = useCallback(() => {
    if (hasInAppHistory()) router.back();
    else if (mobileContext) router.push(mobileContext.fallbackHref);
  }, [mobileContext, router]);
  const visibleNavLinks = isTerminalRoute ? TERMINAL_NAV_LINKS : NAV_LINKS;

  // FEED2-001 → REDESIGN-S4: ⌘K on terminal routes opens the command
  // palette — the one surface absorbing search, jump, and navigation.
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    if (!isTerminalRoute) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    // The mobile tab bar's ⌘K tab opens the same palette via a shell event.
    const onOpen = () => setPaletteOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("taptrade:open-command-palette", onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("taptrade:open-command-palette", onOpen);
    };
  }, [isTerminalRoute]);

  const isActive = (href: string): boolean => {
    if (!pathname) return false;
    if (href === "/predict") {
      // Next.js routes /predict to /predict/ with the project's trailingSlash
      // config. Strict equality missed that, so the Markets pill stayed
      // gray on its own page while every other tab lit up. Accept either
      // form plus the /category/* subroutes that belong under Markets.
      return (
        pathname === "/predict" ||
        pathname.startsWith("/predict/") ||
        pathname.startsWith("/category/") ||
        pathname.startsWith("/market/")
      );
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <header
      className={isTerminalRoute ? TERMINAL_TOP_BAR_CLASS : TOP_BAR_CLASS}
    >
      <div
        className={`${
          isTerminalRoute ? TERMINAL_TOP_BAR_INNER_CLASS : TOP_BAR_INNER_CLASS
        } ${mobileContext ? "max-[1023px]:hidden" : ""}`}
      >
        {/* Inside the app the logo returns to the board; "/" is the
            landing page for new visitors. */}
        <Link
          href="/predict"
          className={TOP_BAR_BRAND_CLASS}
          aria-label={`${brand.name} — home`}
        >
          <BrandMark size={isTerminalRoute ? 22 : 24} tone="ink" />
          <span
            className={
              isTerminalRoute
                ? TERMINAL_TOP_BAR_WORDMARK_CLASS
                : TOP_BAR_WORDMARK_CLASS
            }
          >
            {brand.name}
            <span className="text-[var(--brand-period)]" aria-hidden="true">
              .
            </span>
          </span>
        </Link>

        {isDesktop && (
          <nav
            className={`${TOP_BAR_NAV_CLASS} ${
              isTerminalRoute ? "!w-auto !flex-none gap-5" : ""
            }`}
            aria-label="Primary"
          >
            {visibleNavLinks
              .filter(
                (l) =>
                  l.enabled !== false && (!l.requiresAuth || isAuthenticated),
              )
              .map((l) => {
                const active = isActive(l.href);
                const linkClass = isTerminalRoute
                  ? `${TERMINAL_TOP_BAR_LINK_CLASS} ${
                      active
                        ? TERMINAL_TOP_BAR_LINK_ACTIVE_CLASS
                        : TERMINAL_TOP_BAR_LINK_INACTIVE_CLASS
                    }`
                  : `${TOP_BAR_LINK_CLASS} ${
                      active
                        ? TOP_BAR_LINK_ACTIVE_CLASS
                        : TOP_BAR_LINK_INACTIVE_CLASS
                    }`;
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    aria-current={active ? "page" : undefined}
                    className={l.className ? `${linkClass} ${l.className}` : linkClass}
                  >
                    {t(l.labelKey)}
                  </Link>
                );
              })}
          </nav>
        )}

        <div
          className={`${TOP_BAR_RIGHT_CLASS} ${
            isTerminalRoute ? "flex-1" : ""
          }`}
        >
          {/* ARIA 1.2 combobox: the role lives on the input (the focusable
              element), not the wrapper — the 1.1 wrapper-role pattern trips
              a11y tooling and reads worse in screen readers. */}
          <div
            className={`${TOP_BAR_SEARCH_WRAP_CLASS} ${
              isTerminalRoute ? "min-w-0 flex-1" : ""
            }`}
            ref={searchRef}
          >
            {isTerminalRoute ? (
              // REDESIGN-S4: on terminal routes the field is the palette
              // trigger — typing happens in the palette itself.
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className={`${TERMINAL_TOP_BAR_SEARCH_INPUT_CLASS} flex cursor-pointer items-center text-left text-[var(--t3)]`}
              >
                <Search
                  size={14}
                  className="mr-2.5 flex-none text-[var(--t3)]"
                  aria-hidden="true"
                />
                {`${t("SEARCH_MARKETS")}  ·  ⌘K`}
              </button>
            ) : (
              <>
            <label
              className={`${TOP_BAR_SEARCH_LABEL_CLASS} ${
                isTerminalRoute ? "w-full" : ""
              }`}
            >
              <Search size={14} className={TOP_BAR_SEARCH_ICON_CLASS} />
              <input
                ref={searchInputRef}
                type="search"
                className={
                  isTerminalRoute
                    ? TERMINAL_TOP_BAR_SEARCH_INPUT_CLASS
                    : TOP_BAR_SEARCH_INPUT_CLASS
                }
                placeholder={
                  isTerminalRoute
                    ? `${t("SEARCH_MARKETS")}  ·  ⌘K`
                    : t("SEARCH_MARKETS_PLACEHOLDER")
                }
                aria-label={t("SEARCH_MARKETS")}
                role="combobox"
                aria-haspopup="listbox"
                aria-expanded={searchOpen && searchResults.length > 0}
                aria-activedescendant={
                  searchOpen && searchResults[cursor]
                    ? `tb-search-option-${searchResults[cursor].id}`
                    : undefined
                }
                aria-autocomplete="list"
                aria-controls="tb-search-listbox"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => {
                  setSearchOpen(true);
                  void loadMarketsIfNeeded();
                }}
                onKeyDown={handleSearchKey}
              />
            </label>
            {searchOpen && query.trim() !== "" && (
              <ul
                id="tb-search-listbox"
                // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: APG combobox pattern — ul IS the canonical listbox element
                role="listbox"
                className={TOP_BAR_SEARCH_RESULTS_CLASS}
              >
                {searchResults.length === 0 ? (
                  <li className={TOP_BAR_SEARCH_EMPTY_CLASS} aria-live="polite">
                    {t("SEARCH_NO_MARKETS", { query: query.trim() })}
                  </li>
                ) : (
                  searchResults.map((m, i) => {
                    const active = i === cursor;
                    return (
                      <li
                        key={m.id}
                        id={`tb-search-option-${m.id}`}
                        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: APG combobox pattern — li options under aria-activedescendant management
                        role="option"
                        // Managed-focus listbox: focus stays on the input,
                        // options are reachable via aria-activedescendant.
                        tabIndex={-1}
                        aria-selected={active}
                        className={`${TOP_BAR_SEARCH_HIT_CLASS} ${
                          active
                            ? TOP_BAR_SEARCH_HIT_ACTIVE_CLASS
                            : TOP_BAR_SEARCH_HIT_INACTIVE_CLASS
                        }`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          navigateToMarket(m.ticker);
                        }}
                        onMouseEnter={() => setCursor(i)}
                      >
                        <span className={TOP_BAR_SEARCH_HIT_TITLE_CLASS}>
                          {m.title}
                        </span>
                        <span className={TOP_BAR_SEARCH_HIT_META_CLASS}>
                          {t("SEARCH_RESULT_META", {
                            ticker: m.ticker,
                            price: m.yesPricePoints,
                          })}
                        </span>
                      </li>
                    );
                  })
                )}
              </ul>
            )}
              </>
            )}
          </div>

          {!isTerminalRoute && isAuthenticated && <TierPill />}
          {!isTerminalRoute && (
            // Step 8 (390 header fix): signed in, the globe yields to the
            // loyalty + balance chips below 420px — language stays
            // reachable from Account → Settings. Signed out keeps it; that
            // cluster has the room.
            <span
              className={
                isAuthenticated
                  ? "inline-flex min-w-0 max-[419px]:hidden"
                  : "inline-flex min-w-0"
              }
            >
              <LanguageSelector source={isDesktop ? "header" : "mobile_menu"} />
            </span>
          )}
          {isAuthenticated && <BalanceChip balance={balance} t={t} />}
          {!isTerminalRoute && isAuthenticated && (
            <Button
              variant="primary"
              size="none"
              className={`${TOP_BAR_ADD_POINTS_SIZING} max-[419px]:hidden`}
              render={
                <Link
                  href="/store"
                  data-testid="add-points-topbar"
                  aria-label={t("ADD_POINTS", "Get Clout")}
                />
              }
            >
              <Plus size={14} aria-hidden="true" />
              <span className="max-[1359px]:hidden">
                {t("ADD_POINTS", "Get Clout")}
              </span>
            </Button>
          )}

          {isAuthenticated && user?.id && (
            // Settlement inbox: live toast + badge + dropdown. Replaces the
            // old terminal-only static link to the preferences page — the
            // bell now IS the inbox, on every route.
            <NotificationsBell
              userId={user.id}
              className={isTerminalRoute ? "ml-auto" : ""}
            />
          )}

          {isLoading ? null : isAuthenticated ? (
            <div className={TOP_BAR_MENU_WRAP_CLASS} ref={menuRef}>
              <button
                type="button"
                className={TOP_BAR_MENU_TRIGGER_CLASS}
                onClick={() => setUserMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                aria-label={t("USER_MENU")}
              >
                <MenuLines size={18} weight="bold" aria-hidden="true" className="max-[359px]:hidden" />
                <span className={TOP_BAR_AVATAR_CLASS} aria-hidden="true">
                  {initial}
                </span>
              </button>
              {userMenuOpen && (
                <div className={TOP_BAR_MENU_CLASS} role="menu">
                  <Link
                    href="/account"
                    className={TOP_BAR_MENU_ITEM_CLASS}
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <UserIcon size={14} /> {t("NAV_ACCOUNT")}
                  </Link>
                  <Link
                    href="/rewards"
                    className={TOP_BAR_MENU_ITEM_CLASS}
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <Gift size={14} /> {t("NAV_REWARDS")}
                  </Link>
                  <Link
                    href="/leaderboards"
                    className={TOP_BAR_MENU_ITEM_CLASS}
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <Trophy size={14} /> {t("NAV_LEADERBOARDS")}
                  </Link>
                  <Link
                    href="/portfolio"
                    className={TOP_BAR_MENU_ITEM_CLASS}
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <TrendingUp size={14} /> {t("NAV_PORTFOLIO")}
                  </Link>
                  <Link
                    href="/account/settings"
                    className={TOP_BAR_MENU_ITEM_CLASS}
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <Settings size={14} /> {t("NAV_SETTINGS")}
                  </Link>
                  <Link
                    href="/store"
                    className={TOP_BAR_MENU_ITEM_CLASS}
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <Plus size={14} /> {t("ADD_POINTS", "Get Clout")}
                  </Link>
                  <div className={TOP_BAR_MENU_DIVIDER_CLASS} />
                  <button
                    type="button"
                    className={TOP_BAR_MENU_LOGOUT_CLASS}
                    onClick={handleLogout}
                  >
                    <LogOut size={14} /> {t("LOG_OUT")}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Button
                variant="ghost"
                size="none"
                className={
                  isTerminalRoute
                    ? TERMINAL_TOP_BAR_AUTH_CTA_SIZING
                    : TOP_BAR_AUTH_CTA_SIZING
                }
                render={<Link href="/auth/login" />}
              >
                {t("LOG_IN")}
              </Button>
              <Button
                variant="primary"
                size="none"
                className={
                  isTerminalRoute
                    ? TERMINAL_TOP_BAR_AUTH_CTA_SIZING
                    : TOP_BAR_AUTH_CTA_SIZING
                }
                render={<Link href="/auth/register" />}
              >
                {t("SIGN_UP")}
              </Button>
            </>
          )}
        </div>
      </div>
      {mobileContext && (
        <div className={TOP_BAR_CONTEXT_CLASS}>
          <button
            type="button"
            onClick={goBack}
            className={TOP_BAR_BACK_CLASS}
            aria-label={t("BACK", "Back")}
          >
            <CaretLeft size={22} weight="bold" aria-hidden="true" />
          </button>
          <span className={TOP_BAR_CONTEXT_TITLE_CLASS}>
            {mobileContext.title}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            {mobileContext.actions}
            {isLoading ? null : isAuthenticated ? (
              <span className="ml-1 inline-flex">
                <BalanceChip balance={balance} t={t} />
              </span>
            ) : (
              <Button
                variant="primary"
                size="none"
                className={`${TOP_BAR_AUTH_CTA_SIZING} ml-1`}
                render={<Link href="/auth/register" />}
              >
                {t("SIGN_UP")}
              </Button>
            )}
          </div>
        </div>
      )}
      {isTerminalRoute && (
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </header>
  );
}
