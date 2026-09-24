"use client";

/**
 * TradeTicket — the trade form on /market/[ticker]
 * (P9.2, 2026-07-07 — Robinhood-structure pass).
 *
 * Layout (DESIGN.md §6 + §8):
 *   Title + mode switcher (Market / Limit)
 *   Buy Yes / Buy No underline tabs (side-colored)
 *   Sparse label/value rows: Points (editable) · [Limit price] ·
 *     Price · Est. cost · Payout if <side> is correct
 *   Auth-aware CTA + trust copy
 *
 * Amount is in gameplay points. Quantity (shares) = amount / price * 100. The
 * PredictionApiClient interface still takes `quantity`, so we convert
 * at submit time. This preserves API wiring untouched (D5-style
 * design-only change).
 *
 * Legacy AMM markets are quote-only: the detail page can show preview-backed
 * curve impact, but the ticket must not submit orders against the retired AMM
 * execution path.
 */

import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import type {
  PredictionMarket,
  OrderSide,
  OrderAction,
  OrderPreview,
  PlaceOrderResponse,
  TimeInForce,
} from "@taptrade-ui/api-client/src/prediction-types";
import { useToast } from "../ToastProvider";
import { Button, Card } from "../ui";
import { PointsFlow } from "../ui/PointsFlow";
import { complianceDenialKind } from "../../lib/compliance-denial";
import { storeReturnSuffix } from "../../lib/storeReturnPath";

/**
 * Extra fields the trade ticket can pass to the parent's submit handler
 * when an exchange-mode market enables advanced order types.
 */
export interface TradeTicketSubmitOptions {
  orderType?: "market" | "limit";
  pricePoints?: number;
  action?: OrderAction;
  timeInForce?: TimeInForce;
  postOnly?: boolean;
  notionalCapPoints?: number;
}

/**
 * The viewer's own outcome on a settled/voided market, computed by the
 * page from the portfolio history row (settled) or the position row
 * (voided) — see market/[ticker]/page.tsx. Everything the personal
 * payout band needs; the ticket derives verdict and per-share settle
 * price from `market.status`/`market.result` + `side`.
 */
export interface TicketSettlement {
  side: OrderSide;
  quantity: number;
  /** What the position cost to open. */
  stakedPoints: number;
  /** What settlement paid out — for a voided market, the returned stake. */
  paidPoints: number;
  /** Signed result (paid − staked); 0 for voided. */
  resultPoints: number;
}

interface TradeTicketProps {
  market: PredictionMarket;
  balance?: number;
  /**
   * Preselected side for the ticket. Threaded through from the
   * `?side=yes|no` query param on /market/[ticker] so MarketCard's pills
   * can deep-link into a side-specific trade. Defaults to "yes".
   */
  defaultSide?: OrderSide;
  defaultAmount?: number;
  isAuthenticated: boolean;
  authLoading: boolean;
  /** Available shares the user can sell from their YES/NO position. */
  availableYesShares?: number;
  availableNoShares?: number;
  /**
   * Settlement 12a/12b/12e: the viewer's settled/voided outcome(s) on
   * this market — one entry per held side (almost always one). Absent or
   * empty = no position, no band.
   */
  settlements?: TicketSettlement[];
  onPreview?: (
    side: OrderSide,
    quantity: number,
    opts?: TradeTicketSubmitOptions,
  ) => Promise<OrderPreview | null>;
  /**
   * Submit handler returns the gateway's PlaceOrderResponse so the ticket
   * can show a truthful toast — what was filled vs. what rested vs. what
   * got rejected. Returning void (the prior contract) meant the toast had
   * to guess from the request, which produced "Bought 7 YES shares" when
   * the actual outcome was status=cancelled, filled_quantity=0 (no
   * matching liquidity for the IOC market order).
   *
   * Returning `void` is still accepted for back-compat with tests/mocks
   * that don't care about the response; the ticket falls back to a
   * neutral "Order accepted" toast in that case.
   */
  onSubmit?: (
    side: OrderSide,
    quantity: number,
    opts?: TradeTicketSubmitOptions,
  ) => Promise<PlaceOrderResponse | void>;
  onSideChange?: (side: OrderSide) => void;
  variant?: "default" | "terminal";
}

type TicketMode = "market" | "limit";

const TICKET_HEAD_CLASS = "mb-3 flex items-center justify-between";
// FEED2-006: the ticket head speaks the composed Organism/TradeTicket —
// a mono uppercase eyebrow, not a sentence-case heading.
const TICKET_TITLE_CLASS =
  "font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--t3)]";
const TICKET_MODE_CLASS =
  "inline-flex gap-0.5 rounded-md border border-[var(--border-1)] bg-[var(--surface-2)] p-[3px]";
const TICKET_MODE_BUTTON_BASE_CLASS =
  // Step 3: 38px — THE documented hit-target exception (44px inside a
  // 3px-padded track forces the track to 50px and dominates the ticket).
  "min-h-[38px] cursor-pointer rounded-md border-0 px-3 [font-family:inherit] text-[10px] font-mono font-semibold uppercase tracking-[0.08em] transition-[background-color,border-color,color,transform] duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] disabled:cursor-not-allowed disabled:border disabled:border-[var(--inert-border)] disabled:bg-[var(--inert-fill)] disabled:text-[var(--inert-label)] disabled:opacity-100";
// FEED2-006: sides are the composed price cells (label + live price),
// superseding the P9.2 underline tabs. Selection uses the purple/lavender
// action channel; direction color stays on the side's own text only.
const TICKET_SIDES_CLASS = "mb-4 grid grid-cols-2 gap-2.5";
const TICKET_SIDE_TAB_BASE_CLASS =
  "flex min-h-12 cursor-pointer items-center justify-between gap-2 whitespace-nowrap rounded-[var(--r-rh-md)] border-[1.5px] px-3 [font-family:inherit] text-[12px] font-bold uppercase tracking-[0.06em] transition-[background-color,border-color,box-shadow,color,transform] duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)]";
const TICKET_SIDE_PRICE_CLASS =
  "font-mono text-[15px] font-semibold normal-case tracking-normal tabular-nums";
// (The P9.2 sliding underline indicator retired with the tabs.)
const TICKET_ROWS_CLASS =
  "flex flex-col gap-3 text-[13px] [font-variant-numeric:tabular-nums]";
const TICKET_ROW_CLASS = "flex items-center justify-between gap-3";
const TICKET_ROW_LABEL_CLASS =
  "font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--t3)]";
const TICKET_ROW_VALUE_CLASS = "font-mono font-semibold text-[var(--t1)]";
const TICKET_ROW_SUB_CLASS =
  "font-mono mt-0.5 text-right text-[11px] font-normal text-[var(--t4)]";
const TICKET_INPUT_CLASS =
  "font-mono w-[128px] rounded-[var(--r-rh-md)] border border-[var(--border-2)] bg-[var(--surface-1)] px-3 py-2 text-right text-[14px] font-semibold text-[var(--t1)] outline-none transition-[background-color,border-color,box-shadow,color] duration-[120ms] [font-variant-numeric:tabular-nums] focus:border-[var(--accent)] focus-visible:shadow-[0_0_0_2px_var(--focus-ring)] disabled:cursor-not-allowed disabled:border-[var(--inert-border)] disabled:bg-[var(--inert-fill)] disabled:text-[var(--inert-label)] disabled:opacity-100 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";
const TICKET_NOTE_CLASS =
  "mt-2.5 text-center text-xs leading-[1.45] text-[var(--t2)]";
// Mobile quick controls (≤1023px): 44px touch targets per DESIGN.md §8.
const TICKET_STEP_BTN_CLASS =
  "flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-md)] border border-[var(--hairline)] bg-[var(--raised)] font-mono text-[18px] font-semibold text-[var(--ink)] transition-[background-color,border-color,color,transform] duration-[120ms] [&:not(:disabled):hover]:border-[var(--t3)] [&:not(:disabled):hover]:text-[var(--t1)] [&:not(:disabled):active]:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] disabled:cursor-not-allowed disabled:border-[var(--inert-border)] disabled:bg-[var(--inert-fill)] disabled:text-[var(--inert-label)] disabled:opacity-100";
const TICKET_QUICK_CHIP_CLASS =
  "h-11 flex-1 cursor-pointer rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--card)] font-mono text-[12px] font-semibold text-[var(--ink-3)] transition-[background-color,border-color,color,transform] duration-[120ms] [font-variant-numeric:tabular-nums] [&:not(:disabled):hover]:border-[var(--t3)] [&:not(:disabled):hover]:text-[var(--t1)] [&:not(:disabled):active]:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] disabled:cursor-not-allowed disabled:border-[var(--inert-border)] disabled:bg-[var(--inert-fill)] disabled:text-[var(--inert-label)] disabled:opacity-100";
const TICKET_TRUST_CLASS =
  "mt-2.5 text-center text-xs leading-[1.45] text-[var(--t3)]";
const TICKET_ERROR_CLASS =
  "mt-2.5 text-center text-xs font-medium text-[var(--danger)]";
// Hold threshold: long enough to be deliberate, short enough to not feel
// broken. Matches the prototype's 0.7s timed transition within jitter.
const HOLD_TO_PLACE_MS = 650;
const TICKET_COMPLIANCE_CLASS =
  "mt-3 rounded-[var(--r-rh-md)] border border-[var(--border-1)] border-l-[3px] border-l-[var(--warning)] bg-[var(--surface-2)] px-3 py-2.5 text-left text-xs leading-[1.45] text-[var(--t1)]";
const TICKET_CLOSED_CLASS =
  "mt-3 rounded-[var(--r-rh-sm)] border border-dashed border-[var(--border-1)] p-2.5 text-center text-xs text-[var(--t3)]";
// Insufficient-balance escape hatch: a secondary link-button into the Point
// Store, below the (kept) disabled trade CTA. Carries the current market
// path as a validated ?return= context so the store can route back.
const TICKET_ADD_POINTS_CLASS =
  "mt-2 flex w-full cursor-pointer items-center justify-center rounded-[var(--r-rh-md)] border border-[var(--border-2)] bg-[var(--surface-1)] px-4 py-3 text-[13px] font-semibold text-[var(--t1)] no-underline transition-[border-color,transform] duration-150 hover:border-[var(--t3)] active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)]";
// Preview requests are debounced so per-keystroke amount edits don't fire
// an api.previewOrder round-trip each; 250ms trails typing comfortably.
const PREVIEW_DEBOUNCE_MS = 250;

function ticketModeButtonClass(active: boolean): string {
  return `${TICKET_MODE_BUTTON_BASE_CLASS} ${
    active
      ? "bg-[var(--surface-1)] text-[var(--t1)] ring-1 ring-[var(--border-2)]"
      : "bg-transparent text-[var(--t3)] hover:text-[var(--t1)] active:translate-y-px"
  }`;
}

function ticketSideTabClass(side: OrderSide, selected: boolean): string {
  // Unselected sides still carry their direction colour; selection adds
  // the side's stroke and soft wash (never the ink/brand voice).
  if (!selected) {
    return side === "yes"
      ? `${TICKET_SIDE_TAB_BASE_CLASS} border-[var(--border-1)] bg-[var(--surface-1)] text-[var(--yes-text)] hover:border-[var(--yes-border)] active:translate-y-px`
      : `${TICKET_SIDE_TAB_BASE_CLASS} border-[var(--border-1)] bg-[var(--surface-1)] text-[var(--no-text)] hover:border-[var(--no-border)] active:translate-y-px`;
  }
  return side === "yes"
    ? `${TICKET_SIDE_TAB_BASE_CLASS} border-[var(--yes)] bg-[var(--yes-soft)] text-[var(--yes-text)]`
    : `${TICKET_SIDE_TAB_BASE_CLASS} border-[var(--no)] bg-[var(--no-soft)] text-[var(--no-text)]`;
}

// Points are whole units of play value —
// never fractional in display.
function formatPointAmount(points: number): string {
  return `${Math.round(points).toLocaleString()} pts`;
}

type Translate = (key: string, values?: Record<string, unknown>) => string;

function formatSignedPoints(points: number): string {
  const sign = points >= 0 ? "+" : "−";
  return `${sign}${Math.abs(Math.round(points)).toLocaleString()}`;
}

/**
 * Settlement 12a/12b/12e — the viewer's own outcome, in the ticket.
 * One principle throughout: the win and the loss get the same layout;
 * only colour, glyph and one line of copy change. Voided is held
 * neutral end to end — no green, no red, a dash where the settlement
 * price would be, and the result stated as 0 rather than left blank.
 * The payout is the hero, but the working sits right underneath it:
 * showing the arithmetic is what separates a payout from a jackpot.
 */
function SettlementBand({
  market,
  s,
  t,
}: {
  market: PredictionMarket;
  s: TicketSettlement;
  t: Translate;
}) {
  const voided = market.status === "voided";
  const won = !voided && market.result === s.side;
  const markClass = voided
    ? "text-[var(--t3)]"
    : won
      ? "text-[var(--yes-text)]"
      : "text-[var(--no-text)]";
  const heroBgClass = voided
    ? "bg-[var(--surface-2)]"
    : won
      ? "bg-[var(--yes-soft)]"
      : "bg-[var(--no-soft)]";
  const verdict = voided
    ? t("SETTLEMENT_VERDICT_VOID")
    : won
      ? t("SETTLEMENT_VERDICT_WON")
      : t("SETTLEMENT_VERDICT_LOST");
  const resultLine = voided
    ? t("VOID_RESULT_LINE")
    : t("SETTLEMENT_RESULT_LINE", {
        result: formatSignedPoints(s.resultPoints),
        staked: Math.round(s.stakedPoints).toLocaleString(),
      });
  const resultClass = voided
    ? "text-[var(--t3)]"
    : s.resultPoints >= 0
      ? "text-[var(--yes-text)]"
      : "text-[var(--no-text)]";
  const rows: Array<{ label: string; value: string; className?: string }> = [
    {
      label: t("YOUR_POSITION"),
      value: `${s.quantity} ${s.side.toUpperCase()}`,
    },
    {
      label: t("SETTLED_AT"),
      value: voided ? "—" : t("SETTLED_AT_PER_SHARE", { price: won ? 100 : 0 }),
    },
    {
      label: voided ? t("ROW_RETURNED") : t("ROW_PAID"),
      value: formatPointAmount(s.paidPoints),
      className: won ? "text-[var(--yes-text)]" : undefined,
    },
    { label: t("ROW_STAKED"), value: formatPointAmount(s.stakedPoints) },
    {
      label: t("ROW_RESULT"),
      value: voided ? "0 pts" : `${formatSignedPoints(s.resultPoints)} pts`,
      className: voided ? undefined : resultClass,
    },
  ];
  return (
    <section className="mb-3" aria-label={verdict}>
      <div
        className={`rounded-t-[var(--r-rh-md)] border border-b-0 border-[var(--border-1)] px-4 py-5 text-center ${heroBgClass}`}
      >
        <span
          aria-hidden="true"
          className={`inline-grid h-11 w-11 place-items-center rounded-full bg-[var(--surface-1)] ${markClass}`}
        >
          {/* Glyph geometry from Settlement.dc.html (Lucide check / x /
           * minus) — read from the reference, not reconstructed. */}
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            {voided ? (
              <path d="M5 12h14" />
            ) : won ? (
              <path d="M20 6 9 17l-5-5" />
            ) : (
              <>
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </>
            )}
          </svg>
        </span>
        <div className={`mt-2.5 text-[13px] font-semibold ${markClass}`}>
          {verdict}
        </div>
        <div className="mt-1.5 font-mono text-[32px] font-medium leading-[1.05] tracking-[-0.04em] text-[var(--t1)] [font-variant-numeric:tabular-nums]">
          {formatPointAmount(s.paidPoints)}
        </div>
        <div
          className={`mt-1.5 font-mono text-[12px] font-medium [font-variant-numeric:tabular-nums] ${resultClass}`}
        >
          {resultLine}
        </div>
      </div>
      <div className="rounded-b-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-2)] px-4 py-3.5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--t3)]">
          {t("HOW_THIS_PAID")}
        </div>
        <div className="mt-2.5 flex flex-col gap-2">
          {rows.map((row) => (
            <div
              key={row.label}
              className="flex items-baseline justify-between gap-3 text-[13px]"
            >
              <span className="text-[var(--t2)]">{row.label}</span>
              <span
                className={`font-mono font-medium [font-variant-numeric:tabular-nums] ${
                  row.className ?? "text-[var(--t2)]"
                }`}
              >
                {row.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Replacement body for non-open markets (settled, halted, closed, voided,
 * proposed_resolution, disputed). Previously the full ticket rendered
 * with a pre-filled amount and a "buy 38 shares" projection on SETTLED
 * markets — investors read the projection as a tradeable quote. The
 * dedicated body shows the outcome, the viewer's own result when they
 * held a position (Settlement 12a/12b/12e), and a one-line explanation.
 */
function renderSettledTicket(
  market: PredictionMarket,
  t: Translate,
  settlements: TicketSettlement[],
) {
  const status = market.status;
  const isSettled = status === "settled";
  const isVoided = status === "voided";
  const isProposed = status === "proposed_resolution";
  const isDisputed = status === "disputed";
  const outcomeLabel = isSettled
    ? market.result === "yes"
      ? t("SETTLED_YES_WINS")
      : market.result === "no"
        ? t("SETTLED_NO_WINS")
        : t("SETTLED")
    : isVoided
      ? t("VOIDED")
      : isProposed
        ? t("RESOLUTION_PROPOSED")
        : isDisputed
          ? t("DISPUTED")
          : t("MARKET_STATUS", { status });
  const explainer = isSettled
    ? market.result
      ? t("MARKET_RESOLVED_EXPLAINER", {
          result: market.result.toUpperCase(),
        })
      : t("MARKET_SETTLED_CLOSED")
    : isVoided
      ? t("MARKET_VOIDED_EXPLAINER")
      : isProposed
        ? t("RESOLUTION_PROPOSED_BODY", {
            result: (market.result ?? "").toUpperCase() || t("RESOLVED"),
          })
        : isDisputed
          ? t("DISPUTED_BODY")
          : t("MARKET_PAUSED_EXPLAINER", { status });
  // Grounds only render when the gateway supplies them — the field is
  // optional in settlementParams and absent today (see step-9 notes).
  const disputeGrounds =
    isDisputed && typeof market.settlementParams?.disputeGrounds === "string"
      ? market.settlementParams.disputeGrounds
      : null;
  const showBands = (isSettled || isVoided) && settlements.length > 0;
  return (
    <>
      <div className={TICKET_HEAD_CLASS}>
        <span className={TICKET_TITLE_CLASS}>{outcomeLabel}</span>
      </div>
      {showBands &&
        settlements.map((s) => (
          <SettlementBand
            key={`${s.side}-${s.quantity}`}
            market={market}
            s={s}
            t={t}
          />
        ))}
      <div className={TICKET_CLOSED_CLASS}>{explainer}</div>
      {disputeGrounds && (
        <div className="mt-2.5 rounded-[var(--r-rh-sm)] bg-[var(--surface-2)] px-3.5 py-3">
          <div className="text-[11px] font-medium text-[var(--t3)]">
            {t("DISPUTE_GROUNDS")}
          </div>
          <p className="m-0 mt-1.5 text-xs leading-[1.5] text-[var(--t2)]">
            {disputeGrounds}
          </p>
        </div>
      )}
    </>
  );
}

export function TradeTicket({
  market,
  balance,
  defaultSide = "yes",
  defaultAmount = 100,
  isAuthenticated,
  authLoading,
  availableYesShares = 0,
  availableNoShares = 0,
  onPreview,
  onSubmit,
  onSideChange,
  variant = "default",
  settlements = [],
}: TradeTicketProps) {
  const { t } = useTranslation("prediction");
  const { t: tStore } = useTranslation("store");
  const pathname = usePathname();
  const [side, setSide] = useState<OrderSide>(defaultSide);
  const [amount, setAmount] = useState(defaultAmount);
  const [mode, setMode] = useState<TicketMode>("market");
  const [action, setAction] = useState<OrderAction>("buy");
  // Limit-mode price the user wants to bid/offer. Defaults to mid; exchange
  // mode enables editing.
  const [limitPricePoints, setLimitPricePoints] = useState<number>(
    side === "yes" ? market.yesPricePoints : market.noPricePoints,
  );
  const [preview, setPreview] = useState<OrderPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const ticketCardClass =
    variant === "terminal"
      ? "!rounded-none !border-0 !bg-transparent !p-0"
      : undefined;
  const ticketStyle = {
    "--ticket-cta-text": "var(--on-ink)",
    ...(variant === "terminal" ? { fontFamily: "var(--font-terminal)" } : {}),
  } as CSSProperties;

  useEffect(() => {
    setSide(defaultSide);
    onSideChange?.(defaultSide);
  }, [defaultSide, onSideChange]);

  const isOpen = market.status === "open";
  const isExchange = market.executionMode === "order_book";
  const isAmmQuoteOnly = market.executionMode === "amm";
  const marketPrice =
    side === "yes" ? market.yesPricePoints : market.noPricePoints;
  // Effective price drives quantity math: limit orders use the user's price
  // (capped to [1, 99] at the API boundary); market orders use the snapshot.
  const price = mode === "limit" && isExchange ? limitPricePoints : marketPrice;
  const otherPrice =
    side === "yes" ? market.noPricePoints : market.yesPricePoints;
  const availableShares =
    side === "yes" ? availableYesShares : availableNoShares;

  // Points unit-model (2026-07-07): a contract priced at 8c costs 8 Points.
  // quantity = whole contracts affordable; cost = quantity * price Points.
  //
  // QA fix ISSUE-018 (2026-07-26): the SELL input is labeled "Shares to
  // sell" and sits under an "Available N [shares]" caption — but the
  // value used to run through the buy-side points math (floor(amount /
  // price)). Typing "1" to sell 1 share became 1 POINT → 0 shares → a
  // silently disabled CTA, while typing a big number sailed through as
  // points. In sell mode the input now IS the share count, which also
  // lets the insufficientShares gate fire on real overs.
  const quantity = useMemo(() => {
    if (action === "sell") return Math.max(0, Math.floor(amount));
    return price > 0 ? Math.max(0, Math.floor(amount / price)) : 0;
  }, [action, amount, price]);
  const requestedQuantity = Math.floor(quantity);

  useEffect(() => {
    // Preview is an authenticated endpoint — logged-out visitors typing an
    // amount must not fire doomed 401 requests (they see the CTA "Log in to
    // trade" and static market pricing instead).
    if (!onPreview || !isOpen || requestedQuantity < 1 || !isAuthenticated) {
      setPreview(null);
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    const opts: TradeTicketSubmitOptions = {
      orderType: mode,
      action,
    };
    if (isExchange && mode === "limit") {
      opts.pricePoints = limitPricePoints;
      opts.timeInForce = "gtc";
    } else if (action === "buy") {
      opts.notionalCapPoints = Math.ceil(amount);
    }
    setPreviewLoading(true);
    // Debounced: typing in the amount field used to fire one previewOrder
    // per keystroke. The trailing timer coalesces edits; the cancelled flag
    // doubles as the stale-response guard — any dep change cancels both the
    // pending timer and the acceptance of an in-flight response, so an
    // out-of-date quote can never overwrite a newer one.
    const timer = setTimeout(() => {
      onPreview(side, requestedQuantity, opts)
        .then((quote) => {
          if (!cancelled) setPreview(quote);
        })
        .catch(() => {
          if (!cancelled) setPreview(null);
        })
        .finally(() => {
          if (!cancelled) setPreviewLoading(false);
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    action,
    amount,
    isAuthenticated,
    isExchange,
    isOpen,
    limitPricePoints,
    mode,
    onPreview,
    requestedQuantity,
    side,
  ]);

  const previewFilledQuantity = preview?.filledQuantity;
  const shares =
    typeof previewFilledQuantity === "number" && action === "buy"
      ? previewFilledQuantity
      : quantity;
  const pointsIfCorrect = shares * 100; // Correct contracts settle at 100 Points each.
  const summaryPrice =
    preview?.averageFillPricePoints || preview?.pricePoints || price;
  // (implied probability IS the price — cents are already 0-100, readable
  // as % — so the rows below reuse displayPrice for both.)
  const effectiveSpend =
    action === "buy" &&
    mode === "market" &&
    typeof preview?.totalCostWithFeesPoints === "number"
      ? preview.totalCostWithFeesPoints
      : quantity * price;

  // §3-03 quote freeze: on a screen where the total is what you're
  // agreeing to, a number that moves between reading it and pressing it
  // is the defect. previewLoading spans the full unsettled window (it is
  // set the moment a dep changes, before the 250ms debounce timer even
  // fires), so while it's true the summary rows HOLD the last settled
  // quote and the CTA waits. The safety gates (insufficient funds/shares)
  // deliberately keep reading the LIVE values.
  const quotePending = previewLoading;
  const lastSettledQuoteRef = useRef<{
    spend: number;
    price: number;
    shares: number;
    pointsIfCorrect: number;
  } | null>(null);
  useEffect(() => {
    if (!previewLoading) {
      lastSettledQuoteRef.current = {
        spend: effectiveSpend,
        price: summaryPrice,
        shares,
        pointsIfCorrect,
      };
    }
  }, [previewLoading, effectiveSpend, summaryPrice, shares, pointsIfCorrect]);
  const frozenQuote = quotePending ? lastSettledQuoteRef.current : null;
  const displaySpend = frozenQuote ? frozenQuote.spend : effectiveSpend;
  const displayPrice = frozenQuote ? frozenQuote.price : summaryPrice;
  const displayShares = frozenQuote ? frozenQuote.shares : shares;
  const displayPointsIfCorrect = frozenQuote
    ? frozenQuote.pointsIfCorrect
    : pointsIfCorrect;

  const hasKnownBalance = typeof balance === "number";
  // Point-balance check applies only to buys. Sells require enough position.
  //
  // QA fix ISSUE-013 (2026-07-26): gate on the FULL requested notional,
  // not just the preview cost. The preview prices only the FILLABLE
  // slice of a market order (e.g. 622 shares of a 6,172-share request on
  // a thin book), so a wildly over-balance order sailed past this check
  // and died server-side ("hold reservation: insufficient funds") — the
  // gateway holds quantity × price for the whole request. Mirror that:
  // whichever is larger of the fee-inclusive preview cost and the raw
  // requested notional must fit the balance.
  const requestedNotional = action === "buy" ? quantity * price : 0;
  const insufficientFunds =
    action === "buy" &&
    isAuthenticated &&
    hasKnownBalance &&
    (effectiveSpend > balance || requestedNotional > balance);
  const insufficientShares =
    action === "sell" &&
    isAuthenticated &&
    Math.floor(quantity) > availableShares;
  const marketBuyHasNoLiquidity =
    isExchange &&
    mode === "market" &&
    action === "buy" &&
    preview?.quoteStatus === "cancelled" &&
    preview.filledQuantity === 0;
  const loginReturnPath = `/market/${market.ticker}?side=${side}&amount=${Math.round(amount)}`;
  const loginHref = `/auth/login?returnUrl=${encodeURIComponent(loginReturnPath)}`;
  const registerHref = `/auth/register?returnUrl=${encodeURIComponent(loginReturnPath)}`;

  const handleSubmit = useCallback(async () => {
    if (!onSubmit) return;
    if (!isAuthenticated || authLoading || !isOpen || isAmmQuoteOnly) return;
    if (insufficientFunds || insufficientShares || marketBuyHasNoLiquidity)
      return;
    // §3-03 belt-and-braces: the CTA is disabled while the quote is
    // unsettled, but a queued click must not slip through either.
    if (quotePending) return;
    if (quantity < 1) {
      setError(t("AMOUNT_TOO_SMALL"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const qty = Math.floor(quantity);
      let response: PlaceOrderResponse | void;
      const opts: TradeTicketSubmitOptions = {
        orderType: mode,
        action,
      };
      if (mode === "limit") {
        opts.pricePoints = limitPricePoints;
        // Default time-in-force gtc; advanced section can override later.
        opts.timeInForce = "gtc";
      } else if (action === "buy") {
        opts.notionalCapPoints = Math.ceil(amount);
      }
      response = await onSubmit(side, qty, opts);
      // Truthful post-trade toast. The old version unconditionally said
      // "Bought N YES shares" based on the requested quantity, which lied
      // when the order didn't actually fill — e.g. an IOC market buy
      // against an empty book lands as status=cancelled, filled=0, yet
      // we used to claim "Bought 7 YES shares." Inspect the response and
      // branch on the terminal order status the gateway returns.
      //
      // Keep the user's chosen amount in either branch so a follow-up
      // click reissues the same size — most users want to repeat the
      // prediction order, not restart from the default point amount.
      const sideLabel = side.toUpperCase();
      const status = response?.order?.status;
      const filled = response?.order?.filledQuantity ?? 0;
      const failureReason = response?.order?.failureReason;
      if (!response) {
        // Legacy onSubmit returning void (tests/mocks). Don't claim a
        // fill we can't confirm; just acknowledge.
        toast.info(
          t("ORDER_SUBMITTED"),
          t("ORDER_SUBMITTED_BODY", {
            quantity: qty,
            side: sideLabel,
            ticker: market.ticker,
          }),
        );
      } else if (filled > 0) {
        // ANYTHING with a non-zero fill counts as a success toast,
        // regardless of the terminal status. IOC market orders that
        // exhaust their feasible liquidity end with status='cancelled'
        // and filled=N>0 (the unfilled remainder is what got
        // cancelled, not the fill). Showing "Order cancelled" for a
        // 21-share fill would lie to the user — they did buy 21
        // shares. Order of clauses matters: check filled first.
        if (filled === qty) {
          // Full fill — clean success toast.
          toast.success(
            t(action === "sell" ? "SOLD_SHARES" : "BOUGHT_SHARES", {
              quantity: filled,
              side: sideLabel,
              plural: filled === 1 ? "" : "s",
            }),
            t("ORDER_AMOUNT_ON_MARKET", {
              // ISSUE-018: `amount` is a SHARE count in sell mode — the
              // points figure comes from the fill itself. Prefer the
              // actual average fill price when the gateway reports one;
              // fall back to the snapshot price estimate.
              amount: formatPointAmount(
                filled *
                  (response?.order?.averageFillPricePoints ?? price),
              ),
              ticker: market.ticker,
            }),
          );
        } else {
          // Partial — explain what happened to the remainder. IOC
          // market orders cancel the rest; resting limit orders book it.
          const verb =
            action === "sell" ? t("PARTIALLY_SOLD") : t("PARTIALLY_FILLED");
          const remainderFate =
            status === "open"
              ? t("RESTING_ON_BOOK")
              : status === "partial" && mode === "limit"
                ? t("RESTING_ON_BOOK")
                : t("CANCELLED_NO_LIQUIDITY");
          toast.success(
            t("PARTIAL_FILL_SUMMARY", {
              verb,
              filled,
              quantity: qty,
              side: sideLabel,
            }),
            t("REMAINDER_STATUS", {
              remainder: qty - filled,
              status: remainderFate,
            }),
            // §3-07: a partial fill is a receipt with two numbers to
            // reconcile — give it three reads, not one.
            { duration: 12_000 },
          );
        }
      } else if (status === "open") {
        // Limit order rested without crossing — most common outcome on a
        // thin book. (filled=0, status=open.)
        const priceLabel =
          mode === "limit" ? `${limitPricePoints} pts` : `${price} pts`;
        toast.info(
          t("ORDER_RESTING"),
          t("ORDER_RESTING_BODY", {
            quantity: qty,
            side: sideLabel,
            price: priceLabel,
          }),
        );
      } else if (status === "cancelled" || status === "rejected") {
        // Zero-fill cancellation/rejection. failureReason is one of the
        // typed sentinels; fall back to a generic message if missing.
        const why = failureReason
          ? failureReason.replace(/_/g, " ")
          : "no matching liquidity";
        toast.error(
          t("ORDER_STATUS", { status }),
          t("ORDER_STATUS_BODY", {
            quantity: qty,
            side: sideLabel,
            ticker: market.ticker,
            reason: why,
          }),
          // §3-07: rejections need reading time too.
          { duration: 12_000 },
        );
      } else {
        // pending/expired/unknown: don't pretend it worked.
        toast.info(
          t("ORDER_STATUS", { status: status || t("SUBMITTED") }),
          t("ORDER_SUBMITTED_BODY", {
            quantity: qty,
            side: sideLabel,
            ticker: market.ticker,
          }),
        );
      }
    } catch (err: unknown) {
      // QA fix ISSUE-014 (2026-07-26): a server-side rejection used to be
      // invisible — the inline error renders at the BOTTOM of the ticket,
      // which sits below the sticky rail's fold on laptop-height
      // viewports, and the raw gateway string ("persist match: hold
      // reservation: insufficient funds") leaked through verbatim. Fire a
      // viewport-fixed error toast (always visible) with humanized copy,
      // and keep the inline error as the in-ticket record.
      const raw = err instanceof Error ? err.message : "";
      const friendly = /insufficient funds/i.test(raw)
        ? t("BALANCE_BELOW_ORDER", { amount: formatPointAmount(amount) })
        : raw
          ? raw.replace(/^persist match:\s*/i, "").replace(/_/g, " ")
          : t("ORDER_FAILED");
      setError(friendly);
      toast.error(t("ORDER_FAILED"), friendly);
    } finally {
      setSubmitting(false);
    }
  }, [
    side,
    quantity,
    onSubmit,
    isAuthenticated,
    authLoading,
    isAmmQuoteOnly,
    insufficientFunds,
    insufficientShares,
    marketBuyHasNoLiquidity,
    isOpen,
    quotePending,
    mode,
    action,
    limitPricePoints,
    amount,
    price,
    market.ticker,
    toast,
    t,
  ]);

  // Press-and-hold submit (DESIGN.md §7, mobile-flow 2026-08-06). The hold
  // IS the confirmation: the pointer must stay down for HOLD_TO_PLACE_MS
  // before the order fires; releasing earlier cancels with nothing placed.
  // Keyboard and assistive-tech activation (click with detail === 0)
  // submits immediately — a timing gesture must never be the only path.
  // Progress runs on rAF against real elapsed time so the overlay cannot
  // drift from the actual threshold.
  const [holdProgress, setHoldProgress] = useState(0);
  const holdRafRef = useRef<number | null>(null);
  const cancelHold = useCallback((): void => {
    if (holdRafRef.current !== null) {
      cancelAnimationFrame(holdRafRef.current);
      holdRafRef.current = null;
    }
    setHoldProgress(0);
  }, []);
  const startHold = useCallback((): void => {
    if (holdRafRef.current !== null) return;
    const startedAt = performance.now();
    const tick = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / HOLD_TO_PLACE_MS);
      setHoldProgress(progress);
      if (progress >= 1) {
        holdRafRef.current = null;
        setHoldProgress(0);
        void handleSubmit();
        return;
      }
      holdRafRef.current = requestAnimationFrame(tick);
    };
    holdRafRef.current = requestAnimationFrame(tick);
  }, [handleSubmit]);
  useEffect(() => cancelHold, [cancelHold]);

  const setSideAndReset = (s: OrderSide) => {
    setSide(s);
    onSideChange?.(s);
    setError(null);
  };

  return (
    <Card
      as="section"
      padding="md"
      className={ticketCardClass}
      aria-label={t("TRADE_TICKET")}
      style={ticketStyle}
    >
      {!isOpen && renderSettledTicket(market, t, settlements)}
      {isOpen && (
        <>
          <div className={TICKET_HEAD_CLASS}>
            <span className={TICKET_TITLE_CLASS}>{t("TRADE")}</span>
            <div
              className={TICKET_MODE_CLASS}
              role="tablist"
              aria-label={t("ORDER_TYPE")}
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === "market"}
                className={ticketModeButtonClass(mode === "market")}
                onClick={() => setMode("market")}
              >
                {t("MARKET_ORDER")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "limit"}
                className={ticketModeButtonClass(mode === "limit")}
                onClick={() => isExchange && setMode("limit")}
                disabled={!isExchange}
                title={
                  isExchange
                    ? t("LIMIT_ORDER_TITLE")
                    : t("LIMIT_ORDER_DISABLED_TITLE")
                }
              >
                {t("LIMIT_ORDER")}
              </button>
            </div>
          </div>

          {/* Buy/Sell toggle — only meaningful for exchange markets. AMM stays
            buy-only because the curve only mints; sell support is the
            order-book book's job. */}
          {isExchange && isAuthenticated && (
            <div
              className={`${TICKET_MODE_CLASS} mb-[14px] self-start`}
              role="tablist"
              aria-label={t("ACTION")}
            >
              <button
                type="button"
                role="tab"
                aria-selected={action === "buy"}
                className={ticketModeButtonClass(action === "buy")}
                onClick={() => setAction("buy")}
              >
                {t("BUY")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={action === "sell"}
                className={ticketModeButtonClass(action === "sell")}
                onClick={() => setAction("sell")}
                disabled={availableShares === 0}
                title={
                  availableShares === 0
                    ? t("NO_SHARES_TO_SELL")
                    : t("SELL_UP_TO_SHARES", {
                        quantity: availableShares,
                        side: side.toUpperCase(),
                      })
                }
              >
                {t("SELL")}
              </button>
            </div>
          )}

          <div
            className={TICKET_SIDES_CLASS}
            role="tablist"
            aria-label={t("SIDE")}
          >
            <button
              type="button"
              role="tab"
              aria-selected={side === "yes"}
              onClick={() => setSideAndReset("yes")}
              className={ticketSideTabClass("yes", side === "yes")}
            >
              <span>{t("BUY_YES")}</span>
              <span className={TICKET_SIDE_PRICE_CLASS}>
                {market.yesPricePoints} pts
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={side === "no"}
              onClick={() => setSideAndReset("no")}
              className={ticketSideTabClass("no", side === "no")}
            >
              <span>{t("BUY_NO")}</span>
              <span className={TICKET_SIDE_PRICE_CLASS}>
                {market.noPricePoints} pts
              </span>
            </button>
          </div>

          {/* Limit price input — appears in exchange + limit mode. Bounded
            [1, 99] cents per the engine's price bounds (out-of-range prices
            are rejected at the API). Step is 1 pt to match tick size. */}
          {isExchange && mode === "limit" && (
            <div className="mb-3">
              <div className={TICKET_ROW_CLASS}>
                <span className={TICKET_ROW_LABEL_CLASS}>
                  {t("LIMIT_PRICE_SIDE", { side: side.toUpperCase() })}
                </span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  step={1}
                  value={limitPricePoints}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (Number.isFinite(v)) {
                      setLimitPricePoints(Math.max(1, Math.min(99, v)));
                    }
                  }}
                  className={TICKET_INPUT_CLASS}
                  aria-label={t("LIMIT_PRICE")}
                />
              </div>
              <p className={TICKET_ROW_SUB_CLASS}>
                {t("MID_PRICE", { price: marketPrice })} ·{" "}
                {action === "buy"
                  ? t("LIMIT_BUY_HELP", { price: limitPricePoints })
                  : t("LIMIT_SELL_HELP", { price: limitPricePoints })}
              </p>
            </div>
          )}

          <div className={TICKET_ROWS_CLASS}>
            <div>
              <div className={TICKET_ROW_CLASS}>
                <label
                  className={TICKET_ROW_LABEL_CLASS}
                  htmlFor="ticket-amount"
                >
                  {action === "sell" ? t("SHARES_TO_SELL") : t("AMOUNT")}
                </label>
                <input
                  id="ticket-amount"
                  type="number"
                  min={1}
                  step={1}
                  value={Number.isFinite(amount) ? amount : ""}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setAmount(Number.isFinite(v) ? Math.max(0, v) : 0);
                  }}
                  className={TICKET_INPUT_CLASS}
                  aria-label={
                    action === "sell" ? t("SHARES_TO_SELL") : t("AMOUNT")
                  }
                />
              </div>
              {/* Mobile quick controls (≤1023px, buy only): steppers +
                  quick amounts at 44px touch size. Desktop keeps the bare
                  input — pointer precision differs (mobile-flow 2026-08-06). */}
              {action === "buy" && (
                <div className="mt-2 hidden items-center gap-1.5 max-[1023px]:flex">
                  <button
                    type="button"
                    aria-label={t("DECREASE_AMOUNT")}
                    className={TICKET_STEP_BTN_CLASS}
                    onClick={() =>
                      setAmount(Math.max(1, Math.round(amount) - 50))
                    }
                  >
                    −
                  </button>
                  {[100, 500, 1000].map((quick) => (
                    <button
                      key={quick}
                      type="button"
                      className={TICKET_QUICK_CHIP_CLASS}
                      onClick={() => setAmount(quick)}
                    >
                      {quick.toLocaleString()}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={TICKET_QUICK_CHIP_CLASS}
                    disabled={typeof balance !== "number" || balance < 1}
                    onClick={() => {
                      if (typeof balance === "number" && balance >= 1) {
                        setAmount(Math.floor(balance));
                      }
                    }}
                  >
                    {t("MAX_AMOUNT")}
                  </button>
                  <button
                    type="button"
                    aria-label={t("INCREASE_AMOUNT")}
                    className={TICKET_STEP_BTN_CLASS}
                    onClick={() => setAmount(Math.round(amount) + 50)}
                  >
                    +
                  </button>
                </div>
              )}
              <p className={TICKET_ROW_SUB_CLASS}>
                {action === "sell"
                  ? t("AVAILABLE_SHARES", { quantity: availableShares })
                  : t("BALANCE_AMOUNT", {
                      // Bare grouped number: the locale template appends the
                      // unit ("Balance {{amount}} pts") — formatPointAmount
                      // here doubled it ("1,000 pts pts").
                      amount:
                        typeof balance === "number"
                          ? Math.round(balance).toLocaleString()
                          : "—",
                    })}
              </p>
              {/* QA fix ISSUE-017 (2026-07-26): amounts below one share
                  used to disable the CTA with zero explanation
                  (AMOUNT_TOO_SMALL only fired on click, which the
                  disabled button swallowed). Say why, passively. */}
              {action === "buy" && amount > 0 && quantity < 1 && price > 0 && (
                <p className={TICKET_ROW_SUB_CLASS} role="status">
                  {t("MIN_ONE_SHARE_HINT", {
                    price,
                    defaultValue:
                      "At {{price}} pts a share, you need at least {{price}} pts.",
                  })}
                </p>
              )}
            </div>

            <div>
              <div className={TICKET_ROW_CLASS}>
                <span className={TICKET_ROW_LABEL_CLASS}>{t("PRICE")}</span>
                {/* §3-03: the price no longer swaps to "Loading…" text —
                 * the frozen figure holds and the pending dot on the
                 * total row carries the in-flight signal. */}
                <span className={TICKET_ROW_VALUE_CLASS}>
                  {displayPrice} pts
                </span>
              </div>
              <p className={TICKET_ROW_SUB_CLASS}>
                {t("IMPLIED_PROB")} {displayPrice}% ·{" "}
                {t("SHARES_COUNT", { quantity: Math.floor(displayShares) })}
              </p>
            </div>

            <div className={TICKET_ROW_CLASS}>
              {/* §4 EST_PROCEEDS: in sell mode the points COME BACK to you
               * — "Est. cost" read backwards. The value is already the
               * proceeds estimate (qty × price); only the label lied. */}
              <span className={TICKET_ROW_LABEL_CLASS}>
                {t(action === "sell" ? "EST_PROCEEDS" : "EST_COST")}
              </span>
              <span className={TICKET_ROW_VALUE_CLASS} aria-busy={quotePending}>
                <PointsFlow value={displaySpend} suffix=" pts" />
                {quotePending && (
                  <span
                    className="ml-1.5 inline-block h-2 w-2 animate-pulse rounded-full border border-[var(--pending-border)] bg-[var(--pending-fill)] align-middle"
                    aria-hidden="true"
                  />
                )}
                {quotePending && <span className="sr-only">{t("LOADING")}</span>}
              </span>
            </div>

            <div className={TICKET_ROW_CLASS}>
              <span className={TICKET_ROW_LABEL_CLASS}>
                {t("POINTS_IF_SIDE", { side: side.toUpperCase() })}
              </span>
              <span
                className={`${TICKET_ROW_VALUE_CLASS} ${
                  side === "yes"
                    ? "text-[var(--yes-text)]"
                    : "text-[var(--no-text)]"
                }`}
              >
                <PointsFlow value={displayPointsIfCorrect} suffix=" pts" />
              </span>
            </div>
          </div>

          {authLoading ? (
            <Button variant="cta" size="none" className="mt-4" disabled>
              {t("CHECKING_SESSION")}
            </Button>
          ) : !isAuthenticated ? (
            <>
              {/* §4 SIGNUP_TO_TRADE (step 9): the signed-out CTA invites
               * sign-up — the landing, register split-screen and share
               * cards all speak sign-up, and "Log in to trade" contradicted
               * them (the same drift the landing mockup had). The note
               * below stays the log-in path for returning users. */}
              <Button
                variant="cta"
                size="none"
                className="mt-4"
                render={<Link href={registerHref} />}
              >
                {t("SIGNUP_TO_TRADE")}
              </Button>
              <p className={TICKET_NOTE_CLASS}>
                <Link
                  href={loginHref}
                  className="text-inherit underline decoration-[var(--border-2)] underline-offset-2 hover:decoration-[var(--t2)]"
                >
                  {t("SIGN_IN_TO_PLACE_ORDER", { side: side.toUpperCase() })}
                </Link>
              </p>
            </>
          ) : insufficientFunds ? (
            <>
              <Button variant="cta" size="none" className="mt-4" disabled>
                {t("NOT_ENOUGH_POINTS")}
              </Button>
              <p className={TICKET_NOTE_CLASS} role="alert">
                {t("BALANCE_BELOW_ORDER", {
                  amount: formatPointAmount(amount),
                })}
              </p>
              <Link
                href={`/store${storeReturnSuffix(
                  pathname || `/market/${market.ticker}`,
                )}`}
                className={TICKET_ADD_POINTS_CLASS}
                data-testid="add-points-tradeticket"
              >
                {tStore("entry.addPoints", "Add Points")}
              </Link>
            </>
          ) : marketBuyHasNoLiquidity ? (
            // Pre-order preview state — nothing was placed, so nothing was
            // "cancelled". The old copy rendered the preview's quote status
            // through the ORDER_STATUS template and greeted users with
            // "Order cancelled (no more liquidity)" on page load (QA
            // ISSUE-004). Say what's true and point at the action that
            // works on an empty book: a resting limit order.
            <>
              <Button variant="cta" size="none" className="mt-4" disabled>
                {t("NO_LIQUIDITY_CTA")}
              </Button>
              <p className={TICKET_NOTE_CLASS} role="status">
                {t("NO_LIQUIDITY_BODY", { ticker: market.ticker })}
              </p>
            </>
          ) : isAmmQuoteOnly ? (
            <>
              <Button variant="cta" size="none" className="mt-4" disabled>
                {t("AMM_QUOTE_ONLY", "Quote only")}
              </Button>
              <p className={TICKET_NOTE_CLASS} role="status">
                {t(
                  "AMM_QUOTE_ONLY_DETAIL",
                  "This legacy AMM market is shown for curve and impact inspection. New orders use order-book markets.",
                )}
              </p>
            </>
          ) : insufficientShares ? (
            <>
              <Button variant="cta" size="none" className="mt-4" disabled>
                {t("NOT_ENOUGH_SHARES")}
              </Button>
              <p className={TICKET_NOTE_CLASS} role="alert">
                {t("NOT_ENOUGH_SHARES_DETAIL", {
                  available: availableShares,
                  side: side.toUpperCase(),
                  quantity: Math.floor(quantity),
                })}
              </p>
            </>
          ) : (
            <>
              <Button
                variant="cta"
                size="none"
                className="relative mt-4 select-none touch-none overflow-hidden"
                // Buying commits in the side's colour (blue YES, orange NO)
                // so the button restates the direction being taken; a sell
                // stays ink. The cta recipe reads --accent, so the side
                // colour is scoped to this element only.
                style={
                  action === "sell"
                    ? undefined
                    : ({
                        "--accent": side === "yes" ? "var(--yes)" : "var(--no)",
                      } as CSSProperties)
                }
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  // Claim the pointer explicitly: the vaul Sheet captures
                  // pointers for its drag-to-close, which would retarget
                  // pointerup away from this button — and a hold whose
                  // release can't cancel it is a misfire waiting to
                  // happen. Last capture wins, so the button takes it.
                  // Best-effort only: capture throws NotFoundError for
                  // pointers with no active id (synthetic events, some
                  // AT) — the hold must start regardless.
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch {
                    // no active pointer to capture — proceed uncaptured
                  }
                  startHold();
                }}
                onPointerUp={cancelHold}
                onPointerLeave={cancelHold}
                onPointerCancel={cancelHold}
                onContextMenu={(e) => e.preventDefault()}
                onClick={(e) => {
                  // detail === 0 → keyboard (Enter/Space) or AT activation:
                  // submit immediately. Pointer clicks (detail > 0) do
                  // nothing — the hold is the pointer path.
                  if (e.detail === 0) void handleSubmit();
                }}
                // §3-03: the CTA waits for the quote to settle — pressing a
                // total that's still moving is agreeing to a number you
                // haven't seen.
                disabled={submitting || quantity < 1 || quotePending}
              >
                {holdProgress > 0 && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 left-0 bg-[var(--on-ink)] opacity-[0.2]"
                    style={{ width: `${Math.round(holdProgress * 100)}%` }}
                  />
                )}
                {/*
                  Label says "Hold to place" (DESIGN.md §7): completing the
                  hold submits the order immediately — the quote panel above
                  IS the review surface, and there is no confirm modal (a
                  "Review" label was a stage gotcha in the 2026-05-03 demo
                  dry-run). The hold replaces the old bare click as the
                  deliberate-commit gesture; keyboard activation stays
                  immediate because timing gestures need a non-timing path.
                */}
                <span className="relative">
                  {submitting
                    ? t("PLACING")
                    : holdProgress > 0
                      ? t("HOLDING_KEEP_PRESSING")
                      : action === "sell"
                        ? // ISSUE-018: sell is share-denominated — the CTA
                          // states the share count and estimated proceeds,
                          // never "N pts" for a share count.
                          t("SELL_SHARES_HOLD_CTA", {
                            count: requestedQuantity,
                            amount: formatPointAmount(
                              requestedQuantity * price,
                            ),
                          })
                        : t("HOLD_TO_PLACE_AMOUNT", {
                            amount: formatPointAmount(amount),
                          })}
                </span>
              </Button>
              <p className={TICKET_TRUST_CLASS} aria-live="polite">
                {holdProgress > 0 ? t("HOLD_RELEASE_CANCELS") : t("HOLD_HINT")}
              </p>
            </>
          )}

          <p className={TICKET_TRUST_CLASS}>
            {/* §3-03: the trust note quotes the price — it freezes with
             * the rest of the quote. */}
            {t("TRADE_TRUST_NOTE", {
              price: displayPrice,
              probability: displayPrice,
            })}
          </p>

          {/* Suppress unused-warning: API surface preserved for Phase 4 */}
          <input type="hidden" value={otherPrice} readOnly />

          {error &&
            (complianceDenialKind(error) ? (
              // Jurisdiction/KYC gate denial from the gateway: surface the
              // user-readable reason as a banner; KYC denials deep-link to
              // verification.
              <div className={TICKET_COMPLIANCE_CLASS} role="alert">
                {error}
                {complianceDenialKind(error) === "kyc" && (
                  <Link
                    href="/profile"
                    className="mt-1.5 block font-semibold text-[var(--t1)] underline"
                  >
                    {t("COMPLETE_VERIFICATION")}
                  </Link>
                )}
              </div>
            ) : (
              <div className={TICKET_ERROR_CLASS}>{error}</div>
            ))}
        </>
      )}
    </Card>
  );
}
