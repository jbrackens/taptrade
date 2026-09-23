"use client";

/**
 * RowMarketV2 — the redesign's board row (Figma: 05 Redesign › Row/MarketV2,
 * Gate 2/3 approved). Question stack (title + split probability bar) beside
 * PROB/24H/CLOSES/LIQ column stacks, plus the position badge when the
 * signed-in user holds this market. Selection focuses the Inspector — no
 * route change (the loop's continuity rule).
 */

import { useTranslation } from "react-i18next";
import type { PredictionMarket } from "@taptrade-ui/api-client/src/prediction-types";
import { formatCompactPoints } from "../../lib/points";

export interface RowPosition {
  side: "yes" | "no";
  quantity: number;
  avgPricePoints: number;
}

function formatCloseAt(iso: string): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date
    .toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "2-digit" }),
    })
    .toUpperCase();
}

function ColStack({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "muted";
}) {
  return (
    <span className="flex flex-col gap-[3px] max-[720px]:hidden">
      <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em] text-[var(--t3)]">
        {label}
      </span>
      <span
        className={`font-mono text-[14px] font-semibold tabular-nums ${
          tone === "muted" ? "text-[var(--t4)]" : "text-[var(--t1)]"
        }`}
      >
        {value}
      </span>
    </span>
  );
}

export function RowMarketV2({
  market,
  position,
  selected,
  onSelect,
}: {
  market: PredictionMarket;
  position?: RowPosition;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation("prediction");
  const yes = Math.max(0, Math.min(100, market.yesPricePoints));

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid={`floor-row-${market.id}`}
      className={`grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_70px_80px_90px] items-center gap-5 rounded-[8px] border border-l-2 px-4 py-3 text-left transition-[background-color,border-color] duration-150 max-[720px]:grid-cols-[minmax(0,1fr)_70px] max-[720px]:gap-3 ${
        selected
          ? "border-[var(--border-2)] border-l-[var(--accent-lo)] bg-[var(--accent-soft)]"
          : "border-[var(--border-1)] bg-[var(--surface-1)] hover:border-[var(--border-2)] hover:bg-[var(--surface-2)]"
      }`}
    >
      <span className="flex min-w-0 flex-col gap-1.5">
        <span className="flex items-center gap-2">
          <span className="line-clamp-2 text-[14px] font-semibold leading-[1.33] text-[var(--t1)]">
            {market.title}
          </span>
          {position && (
            <span className="flex-none rounded-[3px] bg-[var(--accent-soft)] px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-[0.06em] text-[var(--accent-text)]">
              {t("FLOOR_HOLD_BADGE", "Hold")} {position.quantity}{" "}
              {position.side === "yes" ? t("YES") : t("NO")}
            </span>
          )}
        </span>
        <span
          className="flex h-[5px] max-w-[220px] gap-[2px]"
          role="img"
          aria-label={`${yes}%`}
        >
          <span
            className="h-full rounded-[var(--r-pill)] bg-[var(--yes-bar)]"
            style={{ width: `${yes}%` }}
          />
          <span className="h-full min-w-0 flex-1 rounded-[var(--r-pill)] bg-[var(--no-bar)]" />
        </span>
      </span>

      <span className="flex flex-col gap-[3px]">
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em] text-[var(--t3)]">
          {t("COL_PROB", "Prob")}
        </span>
        <span className="font-mono text-[14px] font-semibold text-[var(--t1)] tabular-nums">
          {market.yesPricePoints}¢
        </span>
      </span>
      <ColStack
        label={t("CLOSES")}
        value={formatCloseAt(market.closeAt)}
      />
      <ColStack
        label={t("LIQUIDITY")}
        value={formatCompactPoints(market.liquidityPoints)}
      />
    </button>
  );
}
