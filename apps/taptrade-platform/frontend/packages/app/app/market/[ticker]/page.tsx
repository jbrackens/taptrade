"use client";

/**
 * MarketDetailPage — Robinhood-treated market view (DESIGN.md §5 layout).
 *
 *   [breadcrumb]
 *   ┌──────────────────────────────┐ ┌─────────────┐
 *   │ Hero (MarketHead + Chart     │ │ TradeTicket │
 *   │       collapsed in one card) │ │ (sticky)    │
 *   ├──────────────────────────────┤ ├─────────────┤
 *   │ [OrderBook] [RecentTrades]   │ │ Related     │
 *   ├──────────────────────────────┤ │             │
 *   │ Market details & resolution  │ │             │
 *   └──────────────────────────────┘ └─────────────┘
 *
 * Data wiring is preserved from the prior versions: the gateway's REST
 * endpoints are untouched. Order-book markets render only real /orderbook
 * depth; AMM markets render an explicit curve-liquidity snapshot instead.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ArrowLeftIcon as ArrowLeft } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ShareNetworkIcon as ShareNetwork } from "@phosphor-icons/react/dist/csr/ShareNetwork";
import MarketHead from "../../components/prediction/MarketHead";
import MarketChart from "../../components/prediction/MarketChart";
import MarketDiscussion from "../../components/prediction/MarketDiscussion";
import { Button, Input } from "../../components/ui";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../components/ui/Dialog";
import { Sheet } from "../../components/ui/Sheet.lazy";
import OrderBook from "../../components/prediction/OrderBook";
import type { BookLevel } from "../../components/prediction/OrderBook";
import RecentTrades from "../../components/prediction/RecentTrades";
import { TerminalCategoryRail } from "../../components/prediction/TerminalCategoryRail";
import {
  TradeTicket,
  type TicketSettlement,
  type TradeTicketSubmitOptions,
} from "../../components/prediction/TradeTicket";
import { logger } from "../../lib/logger";
import { subscribePredictWs } from "../../lib/websocket/predict-ws";
import { useAuth } from "../../hooks/useAuth";
import { useAppDispatch, useAppSelector } from "../../lib/store/hooks";
import {
  selectCurrentBalance,
  setCurrentBalance,
} from "../../lib/store/pointBalanceSlice";
import { getBalance } from "../../lib/api/wallet-client";
import type {
  PredictionMarket,
  PredictionEvent,
  Trade,
  Category,
  OrderSide,
  OrderPreview,
  OrderBook as ApiOrderBook,
  Position,
} from "@taptrade-ui/api-client/src/prediction-types";
import { createPredictionClient } from "@taptrade-ui/api-client/src/prediction-client";
import {
  orderSignature,
  resolveIdempotencyKey,
  type PendingIdempotency,
} from "../../lib/orderIdempotency";
import {
  categoryName,
  localizedMarket,
} from "../../components/prediction/market-content";
import {
  isOpenMarketStatus,
  marketStatusLabel,
} from "../../components/prediction/market-display";
import { normalizeMarketUpdateFields } from "../../components/prediction/live";
import { formatCompactPoints } from "../../lib/points";

const api = createPredictionClient();

// normalizeMarketUpdateFields moved to components/prediction/live.ts —
// shared with the /predict workspace's live subscriptions (motion pass,
// 2026-08-07) so both surfaces apply market:{id} events identically.

const MARKET_WRAP_CLASS =
  "grid min-h-[calc(100vh-64px)] grid-cols-[200px_minmax(0,1fr)_380px] grid-rows-[auto_1fr] bg-[var(--bg-deep)] text-[var(--t1)] max-[1279px]:grid-cols-[72px_minmax(0,1fr)_340px] max-[1023px]:flex max-[1023px]:min-h-0 max-[1023px]:flex-col";
const MARKET_RAIL_CLASS =
  "col-start-1 row-start-1 row-span-2 min-w-0 max-[1023px]:hidden";
const MARKET_HERO_AREA_CLASS =
  "col-start-2 row-start-1 min-w-0 px-8 pb-0 pt-7 max-[1279px]:px-6 max-[1023px]:order-1 max-[1023px]:px-4 max-[1023px]:pt-5";
const MARKET_CONTENT_CLASS =
  "col-start-2 row-start-2 flex min-w-0 flex-col gap-5 px-8 pb-10 pt-5 max-[1279px]:px-6 max-[1023px]:order-3 max-[1023px]:px-4 max-[1023px]:pb-8";
const MARKET_CRUMB_CLASS =
  "mb-4 flex min-h-9 flex-wrap items-center gap-2 text-[12px] text-[var(--t3)]";
const MARKET_CRUMB_LINK_CLASS =
  "inline-flex min-h-9 items-center gap-2 rounded-md border border-[var(--border-1)] bg-[var(--surface-1)] px-3 font-semibold text-[var(--t2)] no-underline transition-colors hover:border-[var(--border-2)] hover:text-[var(--t1)]";
const MARKET_CRUMB_SEP_CLASS = "text-[var(--t4)]";
// <=1023px the workspace lives in the vaul Sheet (P3) — the aside is
// desktop-only and the old in-flow card styles are retired.
const MARKET_SIDE_CLASS =
  "col-start-3 row-start-1 row-span-2 min-w-0 border-l border-[var(--border-1)] bg-[var(--surface-1)] max-[1023px]:hidden";
const MARKET_TICKET_STICKY_CLASS =
  "terminal-scrollbar sticky top-16 max-h-[calc(100vh-64px)] overflow-y-auto px-5 py-6 max-[1023px]:static max-[1023px]:max-h-none max-[1023px]:overflow-visible";
const MARKET_TICKET_CONTEXT_CLASS =
  "mb-5 border-b border-[var(--border-1)] pb-5";
const MARKET_TICKET_EYEBROW_CLASS =
  "mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--accent-text)]";
const MARKET_TICKET_TITLE_CLASS =
  "type-display m-0 text-[20px] font-semibold leading-[1.22] text-[var(--t1)]";
const MARKET_TICKET_QUOTE_CLASS = "mt-5 flex items-end justify-between gap-4";
const MARKET_TICKET_QUOTE_LABEL_CLASS = "text-xs text-[var(--t3)]";
const MARKET_TICKET_QUOTE_VALUE_CLASS =
  // Step 3: probability readout is a magnitude — ink, never the accent.
  "font-mono mt-1 text-[44px] font-semibold leading-none tracking-[-0.04em] text-[var(--t1)]";
const MARKET_TICKET_BAR_CLASS =
  "mt-4 flex h-2 overflow-hidden rounded-full bg-[var(--surface-3)]";
const MARKET_TICKET_SOURCE_CLASS =
  "mb-5 rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-2)] p-4 text-[12px] leading-[1.5] text-[var(--t2)]";
const MARKET_MOBILE_TRADE_LINK_CLASS =
  "fixed inset-x-4 bottom-[76px] z-[80] hidden min-h-12 items-center justify-between rounded-[var(--r-rh-md)] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--on-brand)] no-underline shadow-[var(--shadow-pop)] transition-[background-color,box-shadow,transform] duration-150 hover:bg-[var(--brand-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] active:translate-y-px max-[1023px]:flex min-[900px]:bottom-4";
const MARKET_DATA_ROW_CLASS =
  "grid grid-cols-2 gap-4 pt-4 max-[720px]:grid-cols-1";
const MARKET_DEPTH_DISCLOSURE_CLASS =
  "rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] px-6 py-5 max-[720px]:px-5";
const MARKET_DEPTH_SUMMARY_CLASS =
  "cursor-pointer list-none text-sm font-semibold text-[var(--t1)] transition-colors duration-[120ms] hover:text-[var(--accent-text)] [&::-webkit-details-marker]:hidden";
const LIQUIDITY_CARD_CLASS =
  "rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-2)] p-5";
const LIQUIDITY_HEAD_CLASS =
  "mb-[14px] flex items-center justify-between border-b border-[var(--border-1)] pb-3";
const LIQUIDITY_TITLE_CLASS =
  "text-sm font-semibold tracking-[-0.01em] text-[var(--t1)]";
const LIQUIDITY_BADGE_CLASS =
  "font-mono rounded-md border border-[var(--border-1)] bg-[var(--surface-3)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--t3)]";
const LIQUIDITY_COPY_CLASS = "mb-4 text-[13px] leading-5 text-[var(--t2)]";
const LIQUIDITY_GRID_CLASS = "grid grid-cols-2 gap-3";
const LIQUIDITY_METRIC_CLASS =
  "rounded-md border border-[var(--border-1)] bg-[var(--surface-2)] px-3 py-2";
const LIQUIDITY_METRIC_LABEL_CLASS =
  "font-mono mb-1 text-[10px] uppercase tracking-[0.12em] text-[var(--t3)]";
const LIQUIDITY_METRIC_VALUE_CLASS =
  "font-mono text-[13px] font-semibold text-[var(--t1)] [font-variant-numeric:tabular-nums]";
const AMM_CURVE_CLASS =
  "mt-4 rounded-md border border-[var(--border-1)] bg-[var(--surface-2)] p-3";
const AMM_CURVE_ROW_CLASS = "mb-3 last:mb-0";
const AMM_CURVE_HEAD_CLASS =
  "mb-2 flex items-center justify-between gap-3 text-[11px] text-[var(--t3)]";
const AMM_CURVE_LABEL_CLASS =
  "font-mono text-[10px] uppercase text-[var(--t3)]";
const AMM_CURVE_VALUE_CLASS =
  "font-mono text-[11px] font-semibold text-[var(--t1)] [font-variant-numeric:tabular-nums]";
const AMM_CURVE_TRACK_CLASS =
  "relative flex h-3 overflow-hidden rounded-full border border-[var(--border-1)] bg-[var(--surface-3)]";
const AMM_CURVE_YES_FILL_CLASS = "h-full rounded-l-full bg-[color:var(--yes)]";
const AMM_CURVE_NO_FILL_CLASS = "h-full bg-[color:var(--no)]";
const AMM_CURVE_MARKER_CLASS =
  "absolute top-[-3px] h-[18px] w-0.5 rounded-full bg-[var(--t1)] shadow-[0_0_0_2px_var(--surface-2)]";
const AMM_CURVE_AXIS_CLASS =
  "font-mono mt-1 flex items-center justify-between text-[10px] text-[var(--t3)]";
const AMM_RESERVE_TRACK_CLASS =
  "flex h-3 overflow-hidden rounded-full border border-[var(--border-1)] bg-[var(--surface-3)]";
const AMM_RESERVE_YES_CLASS = "h-full bg-[color:var(--yes)]";
const AMM_RESERVE_NO_CLASS = "h-full bg-[color:var(--no)]";
const AMM_QUOTE_LIST_CLASS = "mt-2 flex flex-col gap-2";
const AMM_QUOTE_ROW_CLASS =
  "grid grid-cols-[minmax(0,_1fr)_auto_auto] items-center gap-3 rounded-md border border-[var(--border-1)] bg-[var(--surface-1)] px-3 py-2 max-[520px]:grid-cols-1 max-[520px]:gap-1";
const AMM_QUOTE_LABEL_CLASS =
  "min-w-0 text-[12px] font-medium text-[var(--t1)]";
const AMM_QUOTE_VALUE_CLASS =
  "font-mono text-[11px] text-[var(--t2)] [font-variant-numeric:tabular-nums]";
const MARKET_HERO_CLASS =
  "overflow-hidden rounded-[var(--radius-lg)] border border-[var(--hairline)] bg-[var(--card)]";
const MARKET_HERO_GRID_CLASS =
  "grid grid-cols-[minmax(280px,0.82fr)_minmax(420px,1.25fr)] max-[1180px]:grid-cols-1";
const MARKET_HEAD_PANEL_CLASS = "min-w-0 p-7 max-[720px]:p-5";
const MARKET_CHART_PANEL_CLASS =
  "min-w-0 border-l border-[var(--border-1)] p-7 max-[1180px]:border-l-0 max-[1180px]:border-t max-[720px]:p-5 [&_svg]:h-[268px] max-[720px]:[&_svg]:h-[220px]";
const MARKET_STATS_CLASS =
  "grid grid-cols-4 gap-2.5 border-t border-[var(--hairline)] p-4 max-[640px]:grid-cols-2";
const MARKET_STAT_CLASS =
  "min-w-0 rounded-[var(--radius-md)] border border-[var(--hairline)] bg-[var(--paper)] px-3.5 py-2.5";
const MARKET_STAT_LABEL_CLASS =
  "font-mono mb-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-3)]";
const MARKET_STAT_VALUE_CLASS =
  "font-mono truncate text-[14px] font-semibold text-[var(--ink)] [font-variant-numeric:tabular-nums]";
const MARKET_DETAILS_CLASS =
  "rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] px-6 py-6 max-[720px]:px-5";
const MARKET_DETAILS_TITLE_CLASS =
  "mb-3 text-base font-semibold tracking-[-0.01em] text-[var(--t1)]";
const MARKET_DETAILS_COPY_CLASS =
  "mb-2.5 text-sm leading-[1.6] text-[var(--t2)]";
const MARKET_RULES_CLASS =
  "mt-[14px] flex list-none flex-col gap-2 border-t border-[var(--border-1)] p-0 pt-[14px]";
const MARKET_RULE_CLASS =
  "relative pl-[18px] text-[13px] leading-[1.5] text-[var(--t2)] before:absolute before:left-1 before:top-2 before:h-1.5 before:w-1.5 before:rounded-full before:bg-[var(--accent)] before:content-['']";
const MARKET_SHARE_ROW_CLASS =
  "mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-1)] pt-4";
const MARKET_SHARE_STATUS_CLASS = "text-xs text-[var(--t3)]";
const RELATED_CARD_CLASS =
  "rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] p-5";
const RELATED_TITLE_CLASS =
  "mb-[14px] border-b border-[var(--border-1)] pb-3 text-sm font-semibold tracking-[-0.01em] text-[var(--t1)]";
const RELATED_EMPTY_CLASS = "text-xs text-[var(--t3)]";
const RELATED_LIST_CLASS = "grid grid-cols-2 gap-3 max-[640px]:grid-cols-1";
const RELATED_ROW_CLASS =
  "group block rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-2)] p-4 no-underline transition-colors hover:border-[var(--border-2)] hover:bg-[var(--surface-3)]";
const RELATED_QUESTION_CLASS =
  "mb-3 text-[13px] font-semibold leading-[1.4] text-[var(--t1)] group-hover:text-[var(--accent-text)]";
const RELATED_LINE_CLASS =
  "font-mono flex items-center justify-between text-[11px] text-[var(--t3)] [font-variant-numeric:tabular-nums]";
const RELATED_YES_CLASS = "font-semibold text-[var(--yes-text)]";
const PAGE_STATE_WRAP_CLASS = "grid min-h-[60vh] place-items-center px-4 py-8";
const PAGE_STATE_CARD_CLASS =
  "w-[min(100%,440px)] rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] p-7 text-center text-[var(--t1)]";
const PAGE_STATE_EYEBROW_BASE_CLASS =
  "mb-[14px] inline-flex min-h-7 items-center justify-center rounded-[var(--r-pill)] border px-3 text-[11px] font-bold uppercase tracking-[0.12em]";
const PAGE_STATE_TITLE_CLASS =
  "m-0 text-[22px] font-extrabold tracking-[-0.01em]";
const PAGE_STATE_COPY_CLASS =
  "mt-2.5 mb-0 text-sm leading-[1.5] text-[var(--t2)]";
const PAGE_STATE_ACTION_CLASS =
  "mt-[22px] inline-flex min-h-11 items-center justify-center rounded-[var(--r-rh-md)] border-0 bg-[var(--accent)] px-5 text-sm font-bold text-[var(--on-brand)] no-underline transition-[background-color,transform] duration-[150ms] hover:-translate-y-px hover:bg-[var(--brand-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] active:translate-y-0";

function pageStateEyebrowClass(isError: boolean): string {
  return `${PAGE_STATE_EYEBROW_BASE_CLASS} ${
    isError
      ? "border-[var(--brand-dark)] bg-[var(--brand-lavender)] text-[var(--brand-dark)]"
      : "border-[var(--border-1)] bg-[var(--accent-soft)] text-[var(--accent-text)]"
  }`;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function formatSourceLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatAMMShareCount(value?: number): string {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) return "—";
  return Math.round(value ?? 0).toLocaleString();
}

/**
 * Adapt a real /orderbook response into the legacy {bids, asks} pair the
 * OrderBook presentational component expects. The visual convention is:
 *   - bids = YES buy orders (pricePoints = YES price ladder, descending)
 *   - asks = NO buy orders rendered as YES sells (the OrderBook component
 *     internally inverts NO bids to "ask at 100-NoBid"). For an exchange
 *     market we use the real NO bid ladder for the ask side; real YES
 *     sells (yes.asks) would also belong here but the component doesn't
 *     yet know how to merge two ask sources, so v1 keeps the NO-bids
 *     convention for backward visual parity.
 */
function adaptBookForDisplay(book: ApiOrderBook): {
  bids: BookLevel[];
  asks: BookLevel[];
} {
  const bids: BookLevel[] = book.yes.bids.map((lvl) => ({
    pricePoints: lvl.pricePoints,
    shares: lvl.shares,
    cumulativeShares: lvl.cumulativeShares,
  }));
  // Ask side: render NO bids in descending order for visual stack consistency.
  // The OrderBook component inverts these to "NO Xc" labels via its own logic.
  const asks: BookLevel[] = book.no.bids
    .slice()
    .reverse()
    .map((lvl) => ({
      pricePoints: lvl.pricePoints,
      shares: lvl.shares,
      cumulativeShares: lvl.cumulativeShares,
    }));
  return { bids, asks };
}

type OrderBookStatus = "idle" | "loading" | "ready" | "error";
type AMMQuoteStatus = "idle" | "loading" | "ready" | "error";

const AMM_QUOTE_SIZES = [1, 10, 25];

interface MarketDepthProps {
  ammQuoteStatus: AMMQuoteStatus;
  ammQuotes: OrderPreview[];
  market: PredictionMarket;
  orderBook: ApiOrderBook | null;
  orderBookStatus: OrderBookStatus;
}

function MarketDepth({
  ammQuoteStatus,
  ammQuotes,
  market,
  orderBook,
  orderBookStatus,
}: MarketDepthProps) {
  const { t } = useTranslation("prediction");
  if (market.executionMode === "order_book") {
    if (orderBook) {
      const { bids, asks } = adaptBookForDisplay(orderBook);
      return <OrderBook bids={bids} asks={asks} />;
    }
    const copy =
      orderBookStatus === "error"
        ? t(
            "ORDER_BOOK_UNAVAILABLE",
            "Real order book depth is unavailable right now.",
          )
        : t("ORDER_BOOK_LOADING", "Loading real order book depth.");
    return (
      <LiquiditySnapshot
        badge={t("ORDER_BOOK", "Order book")}
        copy={copy}
        market={market}
        title={t("ORDER_BOOK", "Order book")}
      />
    );
  }

  return (
    <LiquiditySnapshot
      badge={t("AMM", "AMM")}
      copy={t(
        "AMM_LIQUIDITY_MODEL_COPY",
        "Pricing uses the market's automated curve. This market does not show public order-book depth.",
      )}
      ammQuoteStatus={ammQuoteStatus}
      ammQuotes={ammQuotes}
      market={market}
      title={t("AMM_LIQUIDITY", "AMM liquidity")}
    />
  );
}

interface LiquiditySnapshotProps {
  ammQuoteStatus?: AMMQuoteStatus;
  ammQuotes?: OrderPreview[];
  badge: string;
  copy: string;
  market: PredictionMarket;
  title: string;
}

function LiquiditySnapshot({
  ammQuoteStatus = "idle",
  ammQuotes = [],
  badge,
  copy,
  market,
  title,
}: LiquiditySnapshotProps) {
  const { t } = useTranslation("prediction");
  const collateral = market.collateralPoolPoints ?? 0;
  const liquidityParam = market.ammLiquidityParam ?? 0;
  const metrics = [
    {
      label: t("YES_PRICE", "YES price"),
      value: `${market.yesPricePoints}¢`,
    },
    {
      label: t("NO_PRICE", "NO price"),
      value: `${market.noPricePoints}¢`,
    },
    {
      label: t("VISIBLE_LIQUIDITY", "Liquidity"),
      value: formatCompactPoints(market.liquidityPoints),
    },
    {
      label:
        collateral > 0 ? t("COLLATERAL_POOL", "Pool") : t("CURVE_K", "Curve K"),
      value:
        collateral > 0
          ? formatCompactPoints(collateral)
          : liquidityParam > 0
            ? liquidityParam.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })
            : "—",
    },
  ];
  return (
    <section className={LIQUIDITY_CARD_CLASS} aria-label={title}>
      <div className={LIQUIDITY_HEAD_CLASS}>
        <span className={LIQUIDITY_TITLE_CLASS}>{title}</span>
        <span className={LIQUIDITY_BADGE_CLASS}>{badge}</span>
      </div>
      <p className={LIQUIDITY_COPY_CLASS}>{copy}</p>
      <div className={LIQUIDITY_GRID_CLASS}>
        {metrics.map((metric) => (
          <div key={metric.label} className={LIQUIDITY_METRIC_CLASS}>
            <div className={LIQUIDITY_METRIC_LABEL_CLASS}>{metric.label}</div>
            <div className={LIQUIDITY_METRIC_VALUE_CLASS}>{metric.value}</div>
          </div>
        ))}
      </div>
      {market.executionMode !== "order_book" ? (
        <AMMCurve
          market={market}
          quoteStatus={ammQuoteStatus}
          quotes={ammQuotes}
        />
      ) : null}
    </section>
  );
}

function AMMCurve({
  market,
  quoteStatus,
  quotes,
}: {
  market: PredictionMarket;
  quoteStatus: AMMQuoteStatus;
  quotes: OrderPreview[];
}) {
  const { t } = useTranslation("prediction");
  const yesPrice = clampPercent(market.yesPricePoints);
  const noPrice = clampPercent(100 - yesPrice);
  const yesShares = market.ammYesShares ?? 0;
  const noShares = market.ammNoShares ?? 0;
  const reserveTotal = Math.max(0, yesShares) + Math.max(0, noShares);
  const hasReserveData = reserveTotal > 0;
  const yesReserveShare = hasReserveData
    ? clampPercent((Math.max(0, yesShares) / reserveTotal) * 100)
    : 50;
  const noReserveShare = 100 - yesReserveShare;
  const curveK = market.ammLiquidityParam ?? 0;
  const subsidy = market.ammSubsidyPoints ?? 0;

  return (
    <div className={AMM_CURVE_CLASS}>
      <div className={AMM_CURVE_ROW_CLASS}>
        <div className={AMM_CURVE_HEAD_CLASS}>
          <span className={AMM_CURVE_LABEL_CLASS}>
            {t("AMM_PRICE_MARKER", "Price marker")}
          </span>
          <span className={AMM_CURVE_VALUE_CLASS}>
            {t("YES_PRICE_VALUE", "YES {{price}}¢", {
              price: Math.round(yesPrice),
            })}
          </span>
        </div>
        <div className={AMM_CURVE_TRACK_CLASS} aria-hidden="true">
          <div
            className={AMM_CURVE_YES_FILL_CLASS}
            style={{ width: `${yesPrice}%` }}
          />
          <div
            className={AMM_CURVE_NO_FILL_CLASS}
            style={{ width: `${noPrice}%` }}
          />
          <span
            className={AMM_CURVE_MARKER_CLASS}
            style={{ left: `${yesPrice}%` }}
          />
        </div>
        <div className={AMM_CURVE_AXIS_CLASS}>
          <span>0¢</span>
          <span>100¢</span>
        </div>
      </div>

      <div className={AMM_CURVE_ROW_CLASS}>
        <div className={AMM_CURVE_HEAD_CLASS}>
          <span className={AMM_CURVE_LABEL_CLASS}>
            {t("AMM_RESERVE_BALANCE", "Reserve balance")}
          </span>
          <span className={AMM_CURVE_VALUE_CLASS}>
            {hasReserveData
              ? t("AMM_RESERVE_SPLIT", "YES {{yes}} / NO {{no}}", {
                  yes: formatAMMShareCount(yesShares),
                  no: formatAMMShareCount(noShares),
                })
              : t("AMM_RESERVES_UNAVAILABLE", "Reserves unavailable")}
          </span>
        </div>
        <div className={AMM_RESERVE_TRACK_CLASS} aria-hidden="true">
          <div
            className={AMM_RESERVE_YES_CLASS}
            style={{ width: `${yesReserveShare}%` }}
          />
          <div
            className={AMM_RESERVE_NO_CLASS}
            style={{ width: `${noReserveShare}%` }}
          />
        </div>
      </div>

      <div className={LIQUIDITY_GRID_CLASS}>
        <div className={LIQUIDITY_METRIC_CLASS}>
          <div className={LIQUIDITY_METRIC_LABEL_CLASS}>
            {t("YES_RESERVE", "YES reserve")}
          </div>
          <div className={LIQUIDITY_METRIC_VALUE_CLASS}>
            {formatAMMShareCount(yesShares)}
          </div>
        </div>
        <div className={LIQUIDITY_METRIC_CLASS}>
          <div className={LIQUIDITY_METRIC_LABEL_CLASS}>
            {t("NO_RESERVE", "NO reserve")}
          </div>
          <div className={LIQUIDITY_METRIC_VALUE_CLASS}>
            {formatAMMShareCount(noShares)}
          </div>
        </div>
        <div className={LIQUIDITY_METRIC_CLASS}>
          <div className={LIQUIDITY_METRIC_LABEL_CLASS}>
            {t("AMM_SUBSIDY", "AMM subsidy")}
          </div>
          <div className={LIQUIDITY_METRIC_VALUE_CLASS}>
            {subsidy > 0 ? formatCompactPoints(subsidy) : "—"}
          </div>
        </div>
        <div className={LIQUIDITY_METRIC_CLASS}>
          <div className={LIQUIDITY_METRIC_LABEL_CLASS}>
            {t("CURVE_K", "Curve K")}
          </div>
          <div className={LIQUIDITY_METRIC_VALUE_CLASS}>
            {curveK > 0
              ? curveK.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })
              : "—"}
          </div>
        </div>
      </div>

      <div className={AMM_CURVE_ROW_CLASS}>
        <div className={AMM_CURVE_HEAD_CLASS}>
          <span className={AMM_CURVE_LABEL_CLASS}>
            {t("AMM_IMPACT_QUOTES", "Impact quotes")}
          </span>
          <span className={AMM_CURVE_VALUE_CLASS}>
            {quoteStatus === "loading"
              ? t("LOADING")
              : quoteStatus === "ready"
                ? t("PREVIEW_BACKED", "Preview-backed")
                : t("QUOTE_UNAVAILABLE", "Quote unavailable")}
          </span>
        </div>
        {quoteStatus === "ready" && quotes.length > 0 ? (
          <div className={AMM_QUOTE_LIST_CLASS}>
            {quotes.map((quote) => {
              const afterPrice =
                quote.side === "no"
                  ? quote.newNoPricePoints
                  : quote.newYesPricePoints;
              const impact = Math.max(0, afterPrice - quote.pricePoints);
              const totalCost =
                quote.totalCostWithFeesPoints ?? quote.totalCostPoints;
              const avgPrice =
                quote.averageFillPricePoints || quote.pricePoints;
              return (
                <div key={quote.quantity} className={AMM_QUOTE_ROW_CLASS}>
                  <span className={AMM_QUOTE_LABEL_CLASS}>
                    {t("BUY_YES_QUANTITY", "Buy {{quantity}} YES", {
                      quantity: quote.quantity,
                    })}
                  </span>
                  <span className={AMM_QUOTE_VALUE_CLASS}>
                    {formatCompactPoints(totalCost)}
                  </span>
                  <span className={AMM_QUOTE_VALUE_CLASS}>
                    {t("AMM_AFTER_IMPACT", "{{avg}}¢ avg -> {{after}}¢", {
                      avg: avgPrice,
                      after: afterPrice,
                      impact,
                    })}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className={LIQUIDITY_COPY_CLASS}>
            {quoteStatus === "loading"
              ? t("AMM_QUOTES_LOADING", "Loading preview-backed impact quotes.")
              : t(
                  "AMM_QUOTES_UNAVAILABLE",
                  "Preview-backed impact quotes are unavailable right now.",
                )}
          </p>
        )}
      </div>
    </div>
  );
}

export default function MarketDetailPage() {
  const { t } = useTranslation("prediction");
  const { t: contentT } = useTranslation("market-content");
  const params = useParams() ?? {};
  const ticker = (params.ticker as string | undefined) ?? "";
  // MarketCard's YES/NO pills deep-link here with `?side=yes` or
  // `?side=no` so the ticket opens preselected on that side.
  const search = useSearchParams();
  const sideParam = search?.get("side");
  const initialSide: OrderSide = sideParam === "no" ? "no" : "yes";
  const amountParam = Number(search?.get("amount"));
  const initialAmount =
    Number.isFinite(amountParam) && amountParam >= 1
      ? Math.round(amountParam)
      : 100;

  const [market, setMarket] = useState<PredictionMarket | null>(null);
  // <=1023px band: ticket in a vaul Sheet, opened by the fixed trade CTA.
  const [ticketSheetOpen, setTicketSheetOpen] = useState(false);
  const [isTicketBand, setIsTicketBand] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 1023px)");
    const sync = () => setIsTicketBand(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (!isTicketBand) setTicketSheetOpen(false);
  }, [isTicketBand]);
  const [event, setEvent] = useState<PredictionEvent | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [related, setRelated] = useState<PredictionMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Real /orderbook fetch (only populated when executionMode='order_book').
  // AMM markets render an explicit curve-liquidity snapshot instead.
  const [orderBook, setOrderBook] = useState<ApiOrderBook | null>(null);
  const [orderBookStatus, setOrderBookStatus] =
    useState<OrderBookStatus>("idle");
  const [ammQuotes, setAmmQuotes] = useState<OrderPreview[]>([]);
  const [ammQuoteStatus, setAmmQuoteStatus] = useState<AMMQuoteStatus>("idle");
  // User's positions on THIS market — drives the Sell tab. Empty array when
  // signed out (no positions) or before /portfolio responds. Without this,
  // TradeTicket received availableYes/NoShares = 0 and the Sell button was
  // permanently disabled even for users holding hundreds of contracts.
  const [positions, setPositions] = useState<Position[]>([]);
  const [selectedSide, setSelectedSide] = useState<OrderSide>(initialSide);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const balance = useAppSelector(selectCurrentBalance);
  const dispatch = useAppDispatch();
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();

  const loadMarket = useCallback(async () => {
    const m = await api.getMarket(ticker);
    setMarket(m);
    return m;
  }, [ticker]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const m = await loadMarket();
        if (cancelled) return;

        // The secondary fetches only need ids off the market row, so they
        // run CONCURRENTLY instead of the old await-chain (market → event →
        // trades → categories cost one RTT each). Every branch keeps its own
        // error handling: a failed event/trades/categories fetch degrades
        // that section only and never rejects the batch, exactly like the
        // per-fetch try/catch blocks it replaces.
        const eventPromise: Promise<PredictionEvent | null> = api
          .getEvent(m.eventId)
          .then((ev) => {
            if (!cancelled) setEvent(ev);
            return ev;
          })
          .catch((err: unknown) => {
            logger.warn("MarketDetail", "event fetch failed", err);
            return null;
          });
        const tradesPromise = api
          .getMarketTrades(m.id, 20)
          .then((t) => {
            if (!cancelled) setTrades(t);
          })
          .catch((err: unknown) => {
            logger.warn("MarketDetail", "trades fetch failed", err);
          });
        const categoriesPromise = api
          .getCategories()
          .then((cats) => {
            if (!cancelled) setCategories(cats);
          })
          .catch((err: unknown) => {
            logger.warn("MarketDetail", "categories fetch failed", err);
          });

        // Related markets: prefer markets genuinely related to this one —
        // same event first, then recurring series, then category, with a
        // general fallback only to avoid an empty sidebar on sparse seed
        // data. The chain is lazy (each step fires only while fewer than 4
        // picks have accumulated) and starts alongside the other secondary
        // fetches: the event-scoped step needs nothing but m.eventId, while
        // the series/category steps await the event fetch already in flight
        // above. Fire-and-forget — related never gates the page loading
        // state, and running it once here (instead of an effect re-keyed on
        // the event fields) means it no longer re-runs the whole chain when
        // the event arrives.
        void (async () => {
          const picks: PredictionMarket[] = [];
          const seen = new Set([m.id]);
          async function addRelated(params: {
            eventId?: string;
            seriesId?: string;
            categoryId?: string;
          }) {
            if (picks.length >= 4) return;
            const res = await api.getMarkets({
              ...params,
              status: "open",
              pageSize: 8,
            });
            for (const candidate of res.data || []) {
              if (seen.has(candidate.id)) continue;
              seen.add(candidate.id);
              picks.push(candidate);
              if (picks.length >= 4) break;
            }
          }

          try {
            await addRelated({ eventId: m.eventId });
            const ev = await eventPromise;
            if (ev?.seriesId) {
              await addRelated({ seriesId: ev.seriesId });
            }
            if (ev?.categoryId) {
              await addRelated({ categoryId: ev.categoryId });
            }
            await addRelated({});
            if (!cancelled) setRelated(picks);
          } catch (err: unknown) {
            logger.warn("MarketDetail", "related fetch failed", err);
          }
        })();

        await Promise.all([eventPromise, tradesPromise, categoriesPromise]);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load market",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [loadMarket]);

  // Fetch the user's positions filtered to this market so the Sell tab can
  // show actual available share counts. Refreshes when the market id or
  // auth state changes; refetched after a successful submit (see handleSubmit
  // below) so the count reflects the new fill.
  //
  // Keyed on the market ID, not the market object: post-trade loadMarket()
  // and every WS `market:<id>` frame replace the market object with a fresh
  // reference, and keying on the object re-armed the mount effect below on
  // each of those — post-trade that meant the effect refetch AND
  // handleSubmit's explicit loadPositions() both fired, a duplicate
  // GET /api/v1/portfolio on every fill. With the id key, handleSubmit's
  // call is the single post-trade refresh.
  const marketId = market?.id;
  const loadPositions = useCallback(async () => {
    if (!isAuthenticated || !marketId) {
      setPositions([]);
      return;
    }
    try {
      const all = await api.getPositions();
      const onThisMarket = (all || []).filter((p) => p.marketId === marketId);
      setPositions(onThisMarket);
    } catch (err: unknown) {
      logger.warn("MarketDetail", "positions fetch failed", err);
      setPositions([]);
    }
  }, [isAuthenticated, marketId]);

  useEffect(() => {
    loadPositions();
  }, [loadPositions]);

  // Settlement 12a/12b/12e: the viewer's own outcome on a settled or
  // voided market, for the ticket's personal payout band. Settled markets
  // prefer the portfolio history row (authoritative paid/realized from
  // the disbursement); if the first history page doesn't carry this
  // market (deep history), or the market was VOIDED (voided positions
  // never enter /portfolio/history — they stay position rows, refunded
  // at cost), derive from the position rows instead.
  const marketStatus = market?.status;
  const marketResult = market?.result;
  const [ticketSettlements, setTicketSettlements] = useState<
    TicketSettlement[]
  >([]);
  useEffect(() => {
    if (
      !isAuthenticated ||
      !marketId ||
      (marketStatus !== "settled" && marketStatus !== "voided")
    ) {
      setTicketSettlements([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        if (marketStatus === "settled") {
          const history = await api.getSettledPositions(1, 50);
          const rows = (history.data || []).filter(
            (r) => r.marketId === marketId,
          );
          if (rows.length > 0) {
            if (!cancelled) {
              setTicketSettlements(
                rows.map((r) => ({
                  side: r.side,
                  quantity: r.quantity,
                  // paid − realized = what the position cost to open.
                  stakedPoints: r.settlementPoints - r.realizedPoints,
                  paidPoints: r.settlementPoints,
                  resultPoints: r.realizedPoints,
                })),
              );
            }
            return;
          }
        }
        const all = await api.getPositions();
        if (cancelled) return;
        const mine = (all || []).filter(
          (p) => p.marketId === marketId && p.quantity > 0,
        );
        setTicketSettlements(
          mine.map((p) => {
            if (marketStatus === "voided") {
              // A void refunds at cost: returned = staked, result = 0.
              return {
                side: p.side,
                quantity: p.quantity,
                stakedPoints: p.totalCostPoints,
                paidPoints: p.totalCostPoints,
                resultPoints: 0,
              };
            }
            const paid = marketResult === p.side ? p.quantity * 100 : 0;
            return {
              side: p.side,
              quantity: p.quantity,
              stakedPoints: p.totalCostPoints,
              paidPoints: paid,
              resultPoints: paid - p.totalCostPoints,
            };
          }),
        );
      } catch (err: unknown) {
        logger.warn("MarketDetail", "settlement outcome fetch failed", err);
        if (!cancelled) setTicketSettlements([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, marketId, marketStatus, marketResult]);

  // Live price updates via the gateway's `market:<id>` channel. Gateway
  // publishes the post-AMM market state after every successful order on
  // this market. Payload shape mirrors the gateway's marketUpdatePayload
  // (see go-platform internal/http/prediction_handlers.go) — a few price
  // and volume fields plus a `ts` RFC3339 timestamp.
  //
  // The latestTsRef guards against last-write-wins clobbering: an
  // out-of-order frame, or a stale frame arriving after a fresh
  // loadMarket() refetch (e.g. post-submit at line ~210), would otherwise
  // overwrite newer state. We compare timestamps and skip older payloads.
  // If the WS drops, predict-ws.ts handles reconnect + re-subscribe.
  const latestTsRef = useRef<string>("");
  // LC-38: holds the idempotency key + order signature of an order whose
  // outcome is not yet confirmed, so a manual re-submit after a dropped
  // response reuses the key (gateway dedupes) instead of double-executing.
  const pendingIdemRef = useRef<PendingIdempotency | null>(null);
  useEffect(() => {
    const id = market?.id;
    if (!id || authLoading || !isAuthenticated) return;
    // Reset the ts watermark each time we resubscribe — a new market id
    // means the timeline restarts.
    latestTsRef.current = "";
    const unsubscribe = subscribePredictWs(`market:${id}`, (_eventId, data) => {
      const payload = data as
        | (Partial<PredictionMarket> & { ts?: string })
        | null;
      if (!payload || typeof payload !== "object") return;
      // RFC3339 timestamps compare lexicographically in time order, so a
      // string compare is sufficient — no Date parsing needed.
      if (payload.ts && payload.ts <= latestTsRef.current) return;
      if (payload.ts) latestTsRef.current = payload.ts;
      // Strip ts before merging so it doesn't drift onto state (it's not
      // part of the canonical PredictionMarket shape).
      const { ts: _ts, ...marketFields } = payload;
      const normalizedMarketFields = normalizeMarketUpdateFields(marketFields);
      setMarket((prev) =>
        prev ? { ...prev, ...normalizedMarketFields } : prev,
      );
    });
    return unsubscribe;
  }, [market?.id, authLoading, isAuthenticated]);

  // Real /orderbook fetch + WS refresh for exchange-mode markets. AMM markets
  // skip this entirely and render their AMM liquidity snapshot.
  useEffect(() => {
    const id = market?.id;
    if (!id) return;
    if (market?.executionMode !== "order_book") {
      setOrderBook(null);
      setOrderBookStatus("idle");
      return;
    }
    let cancelled = false;
    setOrderBook(null);
    setOrderBookStatus("loading");
    const fetchBook = async () => {
      try {
        const book = await api.getOrderBook(id, 20);
        if (!cancelled) {
          setOrderBook(book);
          setOrderBookStatus("ready");
        }
      } catch (err: unknown) {
        logger.warn("MarketDetail", "orderbook fetch failed", err);
        if (!cancelled) {
          setOrderBook(null);
          setOrderBookStatus("error");
        }
      }
    };
    fetchBook();
    if (authLoading || !isAuthenticated) {
      return () => {
        cancelled = true;
      };
    }
    const unsubscribe = subscribePredictWs(`orderbook:${id}`, () => {
      // Hint payload carries best bid/ask but the OrderBook component
      // wants full depth; refetch on every hint.
      if (!cancelled) fetchBook();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [market?.id, market?.executionMode, authLoading, isAuthenticated]);

  useEffect(() => {
    const id = market?.id;
    if (
      !id ||
      market?.executionMode === "order_book" ||
      market.status !== "open"
    ) {
      setAmmQuotes([]);
      setAmmQuoteStatus("idle");
      return;
    }
    let cancelled = false;
    setAmmQuotes([]);
    setAmmQuoteStatus("loading");
    Promise.all(
      AMM_QUOTE_SIZES.map((quantity) =>
        api.previewOrder({
          marketId: id,
          side: "yes",
          action: "buy",
          orderType: "market",
          quantity,
        }),
      ),
    )
      .then((quotes) => {
        if (!cancelled) {
          setAmmQuotes(quotes);
          setAmmQuoteStatus("ready");
        }
      })
      .catch((err: unknown) => {
        logger.warn("MarketDetail", "AMM quote preview failed", err);
        if (!cancelled) {
          setAmmQuotes([]);
          setAmmQuoteStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [market?.executionMode, market?.id, market?.status]);

  const handlePreview = useCallback(
    async (
      side: OrderSide,
      quantity: number,
      opts?: TradeTicketSubmitOptions,
    ): Promise<OrderPreview | null> => {
      if (!market || authLoading || !isAuthenticated) return null;
      try {
        return await api.previewOrder({
          marketId: market.id,
          side,
          action: opts?.action ?? "buy",
          orderType: opts?.orderType ?? "market",
          quantity,
          pricePoints: opts?.pricePoints,
          timeInForce: opts?.timeInForce,
          postOnly: opts?.postOnly,
          notionalCapPoints: opts?.notionalCapPoints,
        });
      } catch (err: unknown) {
        logger.warn("MarketDetail", "preview failed", err);
        return null;
      }
    },
    [authLoading, isAuthenticated, market],
  );

  const handleSubmit = useCallback(
    async (
      side: OrderSide,
      quantity: number,
      opts?: TradeTicketSubmitOptions,
    ) => {
      if (!market) return;
      // AMM-mode default: market buy. Exchange-mode markets pass opts that
      // carry order type, action (buy/sell), limit price, TIF, and notional
      // cap. Forward straight through to the gateway. Return the response
      // so TradeTicket can show a truthful toast (filled vs. rested vs.
      // cancelled) instead of guessing from the requested quantity.
      const orderReq = {
        marketId: market.id,
        side,
        action: opts?.action ?? "buy",
        orderType: opts?.orderType ?? "market",
        quantity,
        pricePoints: opts?.pricePoints,
        timeInForce: opts?.timeInForce,
        postOnly: opts?.postOnly,
        notionalCapPoints: opts?.notionalCapPoints,
      };
      // LC-38: attach a stable idempotency key. A manual re-submit after a
      // dropped network response (same order params, outcome unconfirmed)
      // reuses the key so the gateway replays the original order and the
      // wallet is debited once — instead of the gateway minting a fresh
      // per-request key and double-executing.
      const sig = orderSignature(orderReq);
      const { key, pending } = resolveIdempotencyKey(
        pendingIdemRef.current,
        sig,
        () => crypto.randomUUID(),
      );
      pendingIdemRef.current = pending;
      const response = await api.placeOrder({
        ...orderReq,
        idempotencyKey: key,
      });
      // The gateway accepted the order here (placeOrder resolved). Clear the
      // pending key so a later identical order is a NEW order, not a replay.
      // A throw above leaves the ref set, so the next manual retry of the
      // same order reuses the key and is deduped.
      pendingIdemRef.current = null;
      try {
        const updated = await loadMarket();
        try {
          const t = await api.getMarketTrades(updated.id, 20);
          setTrades(t);
        } catch (err: unknown) {
          logger.warn("MarketDetail", "post-trade trades refresh failed", err);
        }
        // Refresh the order book too — a successful order on an exchange
        // market changes the depth even when the order rests (no fill).
        if (updated.executionMode === "order_book") {
          try {
            setOrderBookStatus("loading");
            const book = await api.getOrderBook(updated.id, 20);
            setOrderBook(book);
            setOrderBookStatus("ready");
          } catch (err: unknown) {
            logger.warn("MarketDetail", "post-trade book refresh failed", err);
            setOrderBook(null);
            setOrderBookStatus("error");
          }
        }
        // Refresh positions so the Sell tab's available-shares count
        // reflects the new fill (or the new reservation, for a resting
        // limit order). Without this the count is stale until the next
        // navigation.
        await loadPositions();
        // Refresh the point-balance slice's currentBalance so the top-nav BAL
        // pill matches the post-trade ledger. Without this, the pill is
        // stale until the next page navigation triggers TopBar's onMount
        // fetch.
        if (user?.id) {
          try {
            const bal = await getBalance(user.id);
            dispatch(setCurrentBalance(bal.availableBalance));
          } catch (err: unknown) {
            logger.warn(
              "MarketDetail",
              "post-trade balance refresh failed",
              err,
            );
          }
        }
      } catch (err: unknown) {
        logger.error("MarketDetail", "post-trade market refresh failed", err);
      }
      return response;
    },
    [market, loadMarket, loadPositions, user?.id, dispatch],
  );

  const category = useMemo(() => {
    if (!market || !event) return undefined;
    return categories.find((c) => c.id === event.categoryId);
  }, [market, event, categories]);
  const displayMarket = market ? localizedMarket(contentT, market) : null;
  const displayCategory = category ? categoryName(contentT, category) : "";
  const humanSettlementRule =
    market?.settlementRule && /\s/.test(market.settlementRule)
      ? market.settlementRule
      : null;
  const resolutionCopy = humanSettlementRule || displayMarket?.description;
  const canPreviewOrders = isAuthenticated && !authLoading;

  const shareUrl =
    typeof window !== "undefined" && market
      ? window.location.href
      : market
        ? `/market/${market.ticker}`
        : "";

  async function handleShareMarket() {
    if (!market || !displayMarket) return;
    // Native share sheet only on TOUCH devices — desktop Chrome/Safari
    // also implement navigator.share (a macOS picker), but the in-app
    // dialog is the better desktop experience and makes the ui/Dialog
    // path the real flow, not a test-only fallback (Codex re-review
    // 2026-07-19).
    const prefersNativeShare =
      typeof navigator !== "undefined" &&
      !!navigator.share &&
      (navigator.maxTouchPoints > 0 ||
        (typeof window !== "undefined" &&
          window.matchMedia("(pointer: coarse)").matches));
    try {
      if (prefersNativeShare) {
        await navigator.share({
          title: displayMarket.title,
          text: displayMarket.description || displayMarket.title,
          url: shareUrl,
        });
        setShareMessage(t("SHARE_COPIED", "Market link copied."));
      } else {
        setShareOpen(true);
      }
    } catch (err) {
      logger.warn("MarketDetail", "share failed", err);
      setShareMessage(t("SHARE_FAILED", "Share could not be opened."));
    }
  }

  async function handleCopyShareLink() {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
      }
      setShareOpen(false);
      setShareMessage(t("SHARE_COPIED", "Market link copied."));
    } catch (err) {
      logger.warn("MarketDetail", "share copy failed", err);
      setShareMessage(t("SHARE_FAILED", "Share could not be opened."));
    }
  }

  if (loading) {
    return (
      <PageState loadingLabel={t("LOADING")}>{t("LOADING_MARKET")}</PageState>
    );
  }
  if (error || !market) {
    return (
      <PageState
        actionLabel={t("BACK_TO_MARKETS")}
        errorLabel={t("MARKET_UNAVAILABLE")}
        errorTitle={t("MARKET_OPEN_ERROR")}
        tone="error"
      >
        {error || t("MARKET_NOT_FOUND")}
      </PageState>
    );
  }

  // Step 3 / UAT-006 (Settlement 12a/12b): a settled market's rail shows
  // FINAL settlement prices as a historical record, not live probability.
  const isSettledMarket = market?.status === "settled";
  const settledFinalYes =
    market?.result === "yes" ? 100 : market?.result === "no" ? 0 : null;
  const railYes =
    isSettledMarket && settledFinalYes !== null
      ? settledFinalYes
      : (market?.yesPricePoints ?? 0);
  const railNo =
    isSettledMarket && settledFinalYes !== null
      ? 100 - settledFinalYes
      : (market?.noPricePoints ?? 0);

  // The trade workspace renders once: in the desktop aside, or inside
  // the vaul Sheet on the <=1023px band (never both — a second mounted
  // TradeTicket would fork amount state and double preview fetches).
  const renderTradeWorkspace = (inSheet: boolean) => (
    <>
        <div className={inSheet ? "" : MARKET_TICKET_STICKY_CLASS}>
          <div className={MARKET_TICKET_CONTEXT_CLASS}>
            <p className={MARKET_TICKET_EYEBROW_CLASS}>
              {displayCategory || t("PREDICTION_MARKET", "Prediction market")}
            </p>
            <h2 className={MARKET_TICKET_TITLE_CLASS}>
              {displayMarket?.title}
            </h2>
            <div className={MARKET_TICKET_QUOTE_CLASS}>
              <div>
                <div className={MARKET_TICKET_QUOTE_LABEL_CLASS}>
                  {isSettledMarket
                    ? t("SETTLED_AT_LABEL", "Settled at")
                    : t("LATEST_PROBABILITY", "Latest probability")}
                </div>
                <div className={MARKET_TICKET_QUOTE_VALUE_CLASS}>
                  {railYes}¢
                </div>
              </div>
              <div className="font-mono pb-1 text-right text-[11px] leading-5 text-[var(--t3)]">
                <div className="font-semibold text-[var(--yes-text)]">
                  {t("YES")} {railYes}¢
                </div>
                <div>
                  {t("NO")} {railNo}¢
                </div>
              </div>
            </div>
            <div
              className={MARKET_TICKET_BAR_CLASS}
              role="img"
              aria-label={t("YES_NO_PRICES", {
                yes: railYes,
                no: railNo,
                defaultValue: `Yes ${railYes} cents, No ${railNo} cents`,
              })}
            >
              {/* Step 3: probability bars are the pale direction fill —
                  lime is action/navigation, never a signal (spec §2). */}
              <span
                className="h-full bg-[var(--yes-bar)]"
                style={{ width: `${clampPercent(railYes)}%` }}
              />
              <span className="h-full flex-1 bg-[var(--no-bar)]" />
            </div>
          </div>

          <div className={MARKET_TICKET_SOURCE_CLASS}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--t3)]">
              {t("RESOLUTION_SOURCE_LABEL", "Resolution source")}
            </div>
            <div className="font-semibold text-[var(--t1)]">
              {formatSourceLabel(market.settlementSourceKey)}
            </div>
            {resolutionCopy && (
              <p className="mb-0 mt-2 text-[var(--t2)]">{resolutionCopy}</p>
            )}
          </div>

          <TradeTicket
            variant="terminal"
            market={market}
            balance={typeof balance === "number" ? balance : undefined}
            defaultSide={initialSide}
            defaultAmount={initialAmount}
            onSideChange={setSelectedSide}
            isAuthenticated={isAuthenticated}
            authLoading={authLoading}
            settlements={ticketSettlements}
            // Available = quantity minus reserved (already-spoken-for in
            // open sell orders). Sum across positions on this side; in
            // practice the gateway returns at most one row per (user,
            // market, side) but defensively reduce in case that changes.
            availableYesShares={positions
              .filter((p) => p.side === "yes")
              .reduce(
                (sum, p) =>
                  sum + Math.max(0, p.quantity - (p.reservedQuantity || 0)),
                0,
              )}
            availableNoShares={positions
              .filter((p) => p.side === "no")
              .reduce(
                (sum, p) =>
                  sum + Math.max(0, p.quantity - (p.reservedQuantity || 0)),
                0,
              )}
            onPreview={canPreviewOrders ? handlePreview : undefined}
            onSubmit={handleSubmit}
          />
        </div>
    </>
  );

  return (
    <div className={MARKET_WRAP_CLASS}>
      <div className={MARKET_RAIL_CLASS}>
        <TerminalCategoryRail
          categories={categories}
          mode="predict"
          activeCategorySlug={category?.slug.toLowerCase()}
        />
      </div>

      <div className={MARKET_HERO_AREA_CLASS}>
        <nav className={MARKET_CRUMB_CLASS} aria-label="Breadcrumb">
          <Link href="/predict" className={MARKET_CRUMB_LINK_CLASS}>
            <ArrowLeft size={16} aria-hidden="true" />
            {t("BACK_TO_MARKETS")}
          </Link>
          {category && (
            <>
              <span className={MARKET_CRUMB_SEP_CLASS}>/</span>
              <Link
                href={`/category/${category.slug}`}
                className="font-semibold text-[var(--t2)] no-underline hover:text-[var(--t1)]"
              >
                {displayCategory}
              </Link>
            </>
          )}
          {event && (
            <>
              <span className={MARKET_CRUMB_SEP_CLASS}>/</span>
              <Link
                href={`/event/${event.id}`}
                title={t("VIEW_EVENT_MARKETS", "All markets in this event")}
                className="max-w-[320px] truncate font-semibold text-[var(--t2)] no-underline hover:text-[var(--t1)] max-[640px]:max-w-[200px]"
              >
                {event.title}
              </Link>
            </>
          )}
          <span className={MARKET_CRUMB_SEP_CLASS}>/</span>
          <span className="font-mono uppercase tracking-[0.08em]">
            {market.ticker}
          </span>
        </nav>

        <section className={MARKET_HERO_CLASS}>
          <div className={MARKET_HERO_GRID_CLASS}>
            <div className={MARKET_HEAD_PANEL_CLASS}>
              <MarketHead
                market={displayMarket ?? market}
                categoryName={displayCategory}
              />
            </div>
            <div className={MARKET_CHART_PANEL_CLASS}>
              <div className="mb-3 flex items-end justify-between gap-4">
                <div>
                  <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--t3)]">
                    {t("PRICE_HISTORY", "Price history")}
                  </p>
                  <p className="m-0 mt-1 text-xs text-[var(--t2)]">
                    {t("LIVE_MARKET_DATA", "Live market data")}
                  </p>
                </div>
                <span className="font-mono text-[18px] font-semibold text-[var(--accent-lo)]">
                  {selectedSide.toUpperCase()}{" "}
                  {selectedSide === "yes"
                    ? market.yesPricePoints
                    : market.noPricePoints}
                  ¢
                </span>
              </div>
              <MarketChart
                ticker={market.ticker}
                side={selectedSide}
                yesPricePoints={market.yesPricePoints}
                noPricePoints={market.noPricePoints}
              />
            </div>
          </div>
          <dl className={MARKET_STATS_CLASS}>
            {[
              {
                label: t("VOLUME", "Volume"),
                value: formatCompactPoints(market.volumePoints),
              },
              {
                label: t("LIQUIDITY", "Liquidity"),
                value: formatCompactPoints(market.liquidityPoints),
              },
              {
                label: t("OPEN_INTEREST", "Open interest"),
                value: formatCompactPoints(market.openInterestPoints),
              },
              {
                // Step 3 / UAT-006: a settled market showing a FUTURE
                // "Closes" date read as still-tradeable. The market
                // object carries no settlement timestamp, so the cell
                // states the verdict instead — the historical fact.
                label: isSettledMarket
                  ? t("RESULT_LABEL", "Result")
                  : t("CLOSES", "Closes"),
                value: isSettledMarket
                  ? market.result === "yes"
                    ? t("YES_WINS", "YES wins")
                    : market.result === "no"
                      ? t("NO_WINS", "NO wins")
                      : t("SETTLED", "Settled")
                  : new Date(market.closeAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    }),
              },
            ].map((stat) => (
              <div key={stat.label} className={MARKET_STAT_CLASS}>
                <dt className={MARKET_STAT_LABEL_CLASS}>{stat.label}</dt>
                <dd className={`m-0 ${MARKET_STAT_VALUE_CLASS}`}>
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
        {/* §4 SETTLED_SHEET_LABEL: "Trade market" is dishonest on a market
         * that can no longer be traded — the sheet behind this button holds
         * the payout band, not a ticket. Settled markets show the FINAL
         * side price (the rail's derivation, not the stale snapshot);
         * voided markets show no price at all — theirs means nothing. */}
        <button
          type="button"
          data-testid="open-trade-sheet"
          onClick={() => setTicketSheetOpen(true)}
          className={`${MARKET_MOBILE_TRADE_LINK_CLASS} cursor-pointer border-0`}
        >
          <span>
            {isSettledMarket || market.status === "voided"
              ? t("SETTLED_SHEET_LABEL", "See the result")
              : t("TRADE_MARKET", "Trade market")}
          </span>
          {market.status !== "voided" && (
            <span className="font-mono">
              {selectedSide.toUpperCase()}{" "}
              {selectedSide === "yes" ? railYes : railNo}¢
            </span>
          )}
        </button>
      </div>

      {!isTicketBand && (
        <aside
          id="market-trade-workspace"
          className={MARKET_SIDE_CLASS}
          aria-label={t("TRADE_WORKSPACE", "Trade workspace")}
        >
          {renderTradeWorkspace(false)}
        </aside>
      )}
      {isTicketBand && (
        <Sheet
          open={ticketSheetOpen}
          onOpenChange={setTicketSheetOpen}
          title={t("TRADE_WORKSPACE", "Trade workspace")}
        >
          {renderTradeWorkspace(true)}
        </Sheet>
      )}

      <div className={MARKET_CONTENT_CLASS}>
        <section className={MARKET_DETAILS_CLASS}>
          <h2 className={MARKET_DETAILS_TITLE_CLASS}>
            {t("MARKET_DETAILS_RESOLUTION")}
          </h2>
          {displayMarket?.description && (
            <p className={MARKET_DETAILS_COPY_CLASS}>
              {displayMarket.description}
            </p>
          )}
          {humanSettlementRule &&
            humanSettlementRule !== displayMarket?.description && (
              <p className={MARKET_DETAILS_COPY_CLASS}>{humanSettlementRule}</p>
            )}
          <div className="mt-4 grid grid-cols-2 gap-3 max-[640px]:grid-cols-1">
            <div className="rounded-md border border-[var(--border-1)] bg-[var(--surface-2)] p-4">
              <div className={MARKET_STAT_LABEL_CLASS}>
                {t("RESOLUTION_SOURCE_LABEL", "Resolution source")}
              </div>
              <div className="text-sm font-semibold text-[var(--t1)]">
                {formatSourceLabel(market.settlementSourceKey)}
              </div>
            </div>
            <div className="rounded-md border border-[var(--border-1)] bg-[var(--surface-2)] p-4">
              <div className={MARKET_STAT_LABEL_CLASS}>
                {t("MARKET_STATUS_LABEL", "Market status")}
              </div>
              <div className="text-sm font-semibold text-[var(--t1)]">
                {marketStatusLabel(market.status, t)}
              </div>
            </div>
          </div>
          <ul className={MARKET_RULES_CLASS}>
            <li className={MARKET_RULE_CLASS}>
              {isOpenMarketStatus(market.status)
                ? t("CLOSES_AT_UTC", {
                    date: new Date(market.closeAt).toUTCString().slice(5, -4),
                  })
                : t("MARKET_CURRENT_STATUS", {
                    status: marketStatusLabel(market.status, t),
                  })}
            </li>
          </ul>
          <div className={MARKET_SHARE_ROW_CLASS}>
            <Button
              className="gap-2"
              onClick={handleShareMarket}
              data-testid="share-market"
            >
              <ShareNetwork size={16} aria-hidden="true" />
              {t("SHARE_MARKET", "Share market")}
            </Button>
            {shareMessage && (
              <span className={MARKET_SHARE_STATUS_CLASS}>{shareMessage}</span>
            )}
            <Dialog open={shareOpen} onOpenChange={setShareOpen}>
              <DialogContent data-testid="share-dialog">
                <DialogTitle>{t("SHARE_MARKET", "Share market")}</DialogTitle>
                <DialogDescription>
                  {t(
                    "SHARE_DIALOG_HINT",
                    "Copy the link to share this market.",
                  )}
                </DialogDescription>
                <Input
                  readOnly
                  value={shareUrl}
                  aria-label={t("SHARE_LINK", "Market link")}
                  data-testid="share-link"
                  onFocus={(event) => event.currentTarget.select()}
                  className="w-full font-mono text-xs"
                />
                <div className="mt-4 flex justify-end gap-2">
                  <DialogClose
                    render={<Button size="md">{t("CLOSE", "Close")}</Button>}
                  />
                  <Button
                    variant="primary"
                    onClick={handleCopyShareLink}
                    data-testid="share-copy"
                  >
                    {t("SHARE_COPY_LINK", "Copy link")}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </section>

        {/* Liquidity honesty (2026-06 audit locks): real depth or the
          explicit AMM snapshot stays available, but collapsed so the page
          leads with the tradable quote and real price history. */}
        {isAuthenticated && (
          <details className={MARKET_DEPTH_DISCLOSURE_CLASS}>
            <summary className={MARKET_DEPTH_SUMMARY_CLASS}>
              {t("MARKET_DEPTH_AND_TRADES", "Market depth & recent trades")}
            </summary>
            <div className={MARKET_DATA_ROW_CLASS}>
              <MarketDepth
                ammQuoteStatus={ammQuoteStatus}
                ammQuotes={ammQuotes}
                market={market}
                orderBook={orderBook}
                orderBookStatus={orderBookStatus}
              />
              <RecentTrades trades={trades} />
            </div>
          </details>
        )}

        <MarketDiscussion
          marketId={market.id}
          isAuthenticated={isAuthenticated}
          authLoading={authLoading}
          canDisclosePosition={positions.some((p) => p.quantity > 0)}
        />

        <aside className={RELATED_CARD_CLASS} aria-label={t("RELATED_MARKETS")}>
          <h2 className={RELATED_TITLE_CLASS}>{t("RELATED_MARKETS")}</h2>
          {related.length === 0 ? (
            <p className={RELATED_EMPTY_CLASS}>{t("NO_RELATED_MARKETS")}</p>
          ) : (
            <div className={RELATED_LIST_CLASS}>
              {related.map((market) => {
                const m = localizedMarket(contentT, market);
                return (
                  <Link
                    key={m.id}
                    href={`/market/${m.ticker}`}
                    className={RELATED_ROW_CLASS}
                  >
                    <div className={RELATED_QUESTION_CLASS}>{m.title}</div>
                    <div className={RELATED_LINE_CLASS}>
                      <span className={RELATED_YES_CLASS}>
                        {t("YES")} {m.yesPricePoints}¢
                      </span>
                      <span>
                        {t("VOLUME_VALUE", {
                          value: formatCompactPoints(m.volumePoints),
                        })}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function PageState({
  children,
  actionLabel,
  errorLabel,
  errorTitle,
  loadingLabel,
  tone = "muted",
}: {
  children: React.ReactNode;
  actionLabel?: string;
  errorLabel?: string;
  errorTitle?: string;
  loadingLabel?: string;
  tone?: "muted" | "error";
}) {
  const isError = tone === "error";

  return (
    <div className={PAGE_STATE_WRAP_CLASS}>
      <section className={PAGE_STATE_CARD_CLASS} aria-live="polite">
        <div className={pageStateEyebrowClass(isError)}>
          {isError ? errorLabel : loadingLabel}
        </div>
        <h1 className={PAGE_STATE_TITLE_CLASS}>
          {isError ? errorTitle : children}
        </h1>
        {isError && (
          <>
            <p className={PAGE_STATE_COPY_CLASS}>{children}</p>
            <Link href="/predict" className={PAGE_STATE_ACTION_CLASS}>
              {actionLabel}
            </Link>
          </>
        )}
      </section>
    </div>
  );
}
