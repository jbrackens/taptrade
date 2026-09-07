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
import { GearSixIcon as Settings } from "@phosphor-icons/react/dist/csr/GearSix";
import { TrendUpIcon as TrendingUp } from "@phosphor-icons/react/dist/csr/TrendUp";
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
import { CommandPalette } from "../floor/CommandPalette";
import { NotificationsBell } from "./NotificationsBell";
import { LanguageSelector } from "../i18n/LanguageSelector";
import { localizedMarket } from "./market-content";
import { FEATURE_LIVE_MARKETS } from "../../lib/features";

const api = createPredictionClient();

// Top-level nav. `requiresAuth` items are hidden from logged-out visitors —
// they would either land on a sign-in wall (Portfolio) or render with an
// empty / placeholder state (Leaderboards, Rewards), neither of which makes
// sense as a discoverable destination before login.
const NAV_LINKS: {
  href: string;
  labelKey: string;
  requiresAuth?: boolean;
  enabled?: boolean;
}[] = [
  { href: "/", labelKey: "NAV_HOME" },
  { href: "/predict", labelKey: "NAV_MARKETS" },
  { href: "/discover", labelKey: "NAV_TRENDING" },
  { href: "/live", labelKey: "NAV_LIVE", enabled: FEATURE_LIVE_MARKETS },
  { href: "/portfolio", labelKey: "NAV_PORTFOLIO", requiresAuth: true },
  { href: "/leaderboards", labelKey: "NAV_LEADERBOARDS", requiresAuth: true },
  { href: "/rewards", labelKey: "NAV_REWARDS", requiresAuth: true },
];

const TERMINAL_NAV_LINKS: typeof NAV_LINKS = [
  { href: "/predict", labelKey: "NAV_MARKETS" },
  { href: "/discover", labelKey: "NAV_TRENDING" },
  { href: "/portfolio", labelKey: "NAV_PORTFOLIO", requiresAuth: true },
];

const TOP_BAR_CLASS =
  "sticky top-0 z-[100] border-b border-[var(--border-1)] bg-[var(--bg-deep)] font-sans";

// Prediction routes use the deepest Tap Trade brand surface for primary
// navigation; regular application routes keep the neutral canvas.
const TERMINAL_TOP_BAR_CLASS =
  "sticky top-0 z-[100] border-b border-[color-mix(in_srgb,var(--brand-lavender)_28%,transparent)] bg-[var(--brand-deep)] [font-family:var(--font-terminal)]";

const TOP_BAR_INNER_CLASS =
  "box-border mx-auto flex h-16 w-full max-w-[1588px] items-center gap-6 px-6 max-[900px]:h-16 max-[900px]:gap-3 max-[900px]:px-4 max-[480px]:gap-2 max-[480px]:px-3";

// Feed v2 parity (FEED2-001): the composed Organism/TopBar is a 64px strip,
// 20px side padding, 26px cluster gap — not the 74px one-off it replaced.
const TERMINAL_TOP_BAR_INNER_CLASS =
  "box-border mx-auto flex h-16 w-full items-center gap-[26px] px-5 max-[1100px]:gap-5 max-[900px]:px-4 max-[480px]:gap-2 max-[480px]:px-3";

const TOP_BAR_BRAND_CLASS =
  "inline-flex min-h-11 shrink-0 items-center gap-[10px] no-underline";

// Tap Trade uses a title-case wordmark beside the approved stepped-route mark.
// The product keeps Switzer as its self-hosted UI family so white-label brand
// names remain data-driven rather than baking a static wordmark into the app.
const TOP_BAR_WORDMARK_CLASS =
  "whitespace-nowrap text-[26px] font-semibold leading-none tracking-[-0.025em] [color:var(--brand-ink)] max-[900px]:text-[23px] max-[480px]:text-[21px] max-[359px]:hidden";

const TERMINAL_TOP_BAR_WORDMARK_CLASS =
  "whitespace-nowrap text-[19px] font-semibold leading-none tracking-[-0.025em] text-[var(--on-brand)] max-[480px]:text-[17px]";

const TOP_BAR_NAV_CLASS =
  "flex items-center gap-6 w-full min-w-0 flex-1 max-[900px]:hidden";

const TOP_BAR_LINK_CLASS =
  "relative pb-3 pt-2 text-sm font-medium border-b-2 transition-all duration-200 no-underline whitespace-nowrap";

const TOP_BAR_LINK_INACTIVE_CLASS =
  "text-neutral-500 border-transparent hover:text-neutral-800 hover:border-neutral-300";

// Prediction navigation sits on deep purple; selection is the brand-purple
// control and inactive links retain high-contrast lavender text.
const TERMINAL_TOP_BAR_LINK_CLASS =
  "relative whitespace-nowrap rounded-[var(--r-rh-sm)] px-2.5 py-2 text-[11px] font-semibold uppercase tracking-[0.09em] no-underline transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-lavender)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-deep)]";
const TERMINAL_TOP_BAR_LINK_ACTIVE_CLASS =
  "bg-[var(--accent)] text-[var(--on-brand)] !text-[var(--on-brand)]";
const TERMINAL_TOP_BAR_LINK_INACTIVE_CLASS =
  "text-[var(--brand-lavender)] !text-[var(--brand-lavender)] hover:bg-[color-mix(in_srgb,var(--brand-lavender)_12%,transparent)] hover:text-[var(--on-brand)] hover:!text-[var(--on-brand)]";

const TOP_BAR_LINK_ACTIVE_CLASS =
  "text-[var(--accent-text)] !text-[var(--accent-text)] font-semibold border-[var(--accent-lo)]";

const TOP_BAR_RIGHT_CLASS = [
  // min-w-0 (not shrink-0): the cluster must compress on narrow phones —
  // at 320px an unshrinkable cluster forces horizontal page scroll.
  "flex min-w-0 shrink items-center gap-2.5",
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
  "h-10 w-[280px] rounded-[var(--r-pill)] border border-[var(--border-1)] bg-[var(--surface-1)] py-0 pl-9 pr-3.5 text-[13px] text-[var(--t1)] outline-none transition-[border-color,box-shadow] duration-[120ms] ease-[ease] placeholder:text-[var(--t3)] focus-visible:border-[var(--accent-lo)] focus-visible:shadow-[0_0_0_2px_var(--accent-soft)] [font-family:inherit]";
// FEED2-001: composed Field/Search — 38px, radius 8, raised surface, mono
// 13px, fluid width between the nav and auth clusters.
const TERMINAL_TOP_BAR_SEARCH_INPUT_CLASS =
  "h-[38px] w-full rounded-lg border border-[var(--border-1)] bg-[var(--surface-2)] py-0 pl-10 pr-3.5 text-[13px] text-[var(--t1)] outline-none transition-[border-color,box-shadow] duration-[120ms] placeholder:text-[var(--t3)] focus-visible:border-[var(--accent-lo)] focus-visible:shadow-[0_0_0_2px_var(--accent-soft)] [font-family:var(--font-mono)]";
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

// Step 8: the balance is a magnitude — ink, not the direction green the
// chip carried since P8. The lime tint stays: the chip IS an action (it
// deep-links to the Point Store).
const TOP_BAR_BALANCE_CLASS =
  "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-[var(--r-pill)] bg-[var(--accent-soft)] px-3 py-[7px] text-[13px] font-semibold text-[var(--t1)] tabular-nums no-underline transition-[filter] duration-[120ms] hover:brightness-[0.97] font-mono";
// Ultra-narrow (<360px): the pill row keeps only what matters — the
// loyalty pill hides (TierPill max-[359px]:hidden, /rewards stays in the
// menu) and the BAL label drops so the number itself never crushes.
const TOP_BAR_BALANCE_LABEL_CLASS =
  "text-[11px] font-medium text-[var(--t3)] font-sans max-[359px]:hidden";
// Compact "Add Points" entry to /store, always adjacent to the balance
// chip. The top bar is already width-tight at common desktop sizes (search
// + tier pill + balance), so the label only appears on wide desktops and
// the control collapses to the plus glyph below 1360px (aria-label keeps
// it accessible). Sizing rides on ui/Button variant="primary".
const TOP_BAR_ADD_POINTS_SIZING =
  "min-h-11 shrink-0 px-3 text-[13px] no-underline max-[900px]:px-2.5";

// The avatar uses the selected lavender surface with AA purple text.
const TOP_BAR_AVATAR_CLASS =
  "grid size-11 cursor-pointer place-items-center rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] text-[15px] font-semibold text-[var(--accent-text)] transition-[border-color,background-color] duration-150 hover:border-[var(--accent-lo)] hover:bg-[var(--brand-lavender)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)]";

const TOP_BAR_AUTH_CTA_SIZING =
  "min-h-11 px-4 text-[13px] no-underline max-[480px]:px-2.5";

// FEED2-001: composed auth cluster is compact (32px) on desktop pointer
// surfaces; the 44px touch minimum returns below the 900px breakpoint.
const TERMINAL_TOP_BAR_AUTH_CTA_SIZING =
  "min-h-8 px-3 text-[12px] !text-[var(--brand-lavender)] no-underline hover:!text-[var(--on-brand)] max-[900px]:min-h-11 max-[480px]:px-2.5";

const TOP_BAR_MENU_WRAP_CLASS = "relative";
const TOP_BAR_MENU_CLASS =
  "absolute right-0 top-[calc(100%_+_6px)] z-[110] min-w-[200px] rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-1)] p-1 shadow-[var(--shadow-pop)]";
const TOP_BAR_MENU_ITEM_BASE_CLASS =
  "flex w-full cursor-pointer items-center gap-2 rounded-[var(--r-sm)] border-0 bg-transparent px-3 py-2 text-left text-[13px] no-underline hover:bg-[var(--surface-2)] [font-family:inherit]";
const TOP_BAR_MENU_ITEM_CLASS = `${TOP_BAR_MENU_ITEM_BASE_CLASS} text-[var(--t1)]`;
const TOP_BAR_MENU_LOGOUT_CLASS = `${TOP_BAR_MENU_ITEM_BASE_CLASS} text-[var(--brand-dark)]`;
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
        className={
          isTerminalRoute ? TERMINAL_TOP_BAR_INNER_CLASS : TOP_BAR_INNER_CLASS
        }
      >
        <Link
          href="/"
          className={TOP_BAR_BRAND_CLASS}
          aria-label={`${brand.name} — home`}
        >
          <BrandMark
            size={isTerminalRoute ? 24 : 30}
            tone={isTerminalRoute ? "light" : "ink"}
          />
          <span
            className={
              isTerminalRoute
                ? TERMINAL_TOP_BAR_WORDMARK_CLASS
                : TOP_BAR_WORDMARK_CLASS
            }
          >
            {brand.name}
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
                    className={linkClass}
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
          {!isTerminalRoute && isAuthenticated && (
            <>
              {/* The balance chip deep-links into the Point Store — the
                  pill is where users look when they want more points. */}
              <Link
                href="/store"
                className={TOP_BAR_BALANCE_CLASS}
                aria-label={t("OPEN_POINT_STORE", "Open the Point Store")}
              >
                <span className={TOP_BAR_BALANCE_LABEL_CLASS}>
                  {t("BALANCE_LABEL")}
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
                      <PointsFlow value={balance} />
                      <span className="max-[419px]:hidden">&nbsp;pts</span>
                    </>
                  ) : (
                    "—"
                  )}
                </span>
              </Link>
              <Button
                variant="primary"
                size="none"
                className={`${TOP_BAR_ADD_POINTS_SIZING} max-[419px]:hidden`}
                render={
                  <Link
                    href="/store"
                    data-testid="add-points-topbar"
                    aria-label={t("ADD_POINTS", "Add Points")}
                  />
                }
              >
                <Plus size={14} aria-hidden="true" />
                <span className="max-[1359px]:hidden">
                  {t("ADD_POINTS", "Add Points")}
                </span>
              </Button>
            </>
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
                className={TOP_BAR_AVATAR_CLASS}
                onClick={() => setUserMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                aria-label={t("USER_MENU")}
              >
                {initial}
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
                    <Plus size={14} /> {t("ADD_POINTS", "Add Points")}
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
      {isTerminalRoute && (
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </header>
  );
}
