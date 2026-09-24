"use client";

/**
 * InspectorPanel — contextual market inspector (Figma: 05 Redesign ›
 * InspectorV2). Focused market: price readout + split bar, resolution
 * rules + source, liquidity line, MY exposure, the REAL ticket
 * (ConnectedTradeTicket — live preview/place path with hold-to-place), and
 * a link out to the full market page. Idle: an open-positions digest.
 * Hosts: the /event/[id] side panel and the QuickTradePanel overlay.
 */

import Link from "next/link";
import { useTranslation } from "react-i18next";
import type {
  OrderSide,
  PredictionMarket,
} from "@taptrade-ui/api-client/src/prediction-types";
import { formatCompactPoints } from "../../lib/points";
import { ConnectedTradeTicket } from "./ConnectedTradeTicket";
import type { RowPosition } from "./RowMarketV2";

function sourceLabel(key: string | undefined): string {
  if (!key) return "Manual";
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const EYEBROW_CLASS =
  "text-[12px] font-semibold text-[var(--t3)]";

const CARD_CHROME_CLASS =
  "rounded-[8px] border border-[var(--border-1)] bg-[var(--surface-1)] p-4";

export function InspectorPanel({
  market,
  position,
  openPositions,
  onMarketUpdate,
  label,
  defaultSide,
  bare = false,
}: {
  market: PredictionMarket | null;
  position?: RowPosition;
  openPositions: number;
  onMarketUpdate: (market: PredictionMarket) => void;
  /** Eyebrow label; defaults to "Inspector". */
  label?: string;
  /** Side the ticket opens on (e.g. the YES/NO button that opened it). */
  defaultSide?: OrderSide;
  /** Drop the card chrome when a host (dialog, sheet) already draws it. */
  bare?: boolean;
}) {
  const { t } = useTranslation("prediction");
  const eyebrow = label ?? t("FLOOR_INSPECTOR", "Inspector");
  const chrome = bare ? "" : ` ${CARD_CHROME_CLASS}`;
  // A bare host draws its own close control in the top-right corner.
  const eyebrowClass = bare ? `${EYEBROW_CLASS} pr-8` : EYEBROW_CLASS;

  if (!market) {
    return (
      <div className={`flex flex-col gap-3${chrome}`}>
        <span className={eyebrowClass}>{eyebrow}</span>
        <p className="m-0 text-[13px] leading-[1.5] text-[var(--t2)]">
          {t(
            "FLOOR_INSPECTOR_IDLE",
            "Select a market to evaluate and trade without leaving the board.",
          )}
        </p>
        <span className="font-mono text-[11px] font-semibold text-[var(--t2)] tabular-nums">
          {t("FLOOR_OPEN_POSITIONS", "Open positions")}: {openPositions}
        </span>
      </div>
    );
  }

  const yes = Math.max(0, Math.min(100, market.yesPricePoints));

  return (
    <div className={`flex flex-col gap-3.5${chrome}`}>
      <span className={eyebrowClass}>
        {eyebrow}
        {market.eventTitle ? ` — ${market.eventTitle}` : ""}
      </span>
      <h2 className="m-0 text-[15px] font-semibold leading-[1.35] text-[var(--t1)]">
        {market.title}
      </h2>

      <div className="flex items-start justify-between gap-3">
        <span className="flex items-baseline gap-2">
          <span className="mono mono-wide text-[32px] font-semibold leading-none tracking-[-0.05em] text-[var(--t1)] tabular-nums">
            {yes}%
          </span>
          <span className="text-[12px] text-[var(--t3)]">{t("CHANCE", "chance")}</span>
        </span>
        <span className="flex flex-col items-end gap-0.5 font-mono text-[11px] font-semibold tabular-nums">
          <span className="text-[var(--yes-text)]">
            {t("YES")} {market.yesPricePoints} pts
          </span>
          <span className="text-[var(--no-text)]">
            {t("NO")} {market.noPricePoints} pts
          </span>
        </span>
      </div>
      <span
        className="flex h-[5px] w-full gap-[2px]"
        role="img"
        aria-label={`${yes}%`}
      >
        <span
          className="h-full rounded-[var(--r-pill)] bg-[var(--yes-bar)]"
          style={{ width: `${yes}%` }}
        />
        <span className="h-full min-w-0 flex-1 rounded-[var(--r-pill)] bg-[var(--no-bar)]" />
      </span>

      {position && (
        <div className="flex items-baseline justify-between gap-2 rounded-[5px] bg-[var(--accent-soft)] px-2.5 py-1.5">
          <span className={EYEBROW_CLASS}>
            {t("FLOOR_MY_EXPOSURE", "My exposure")}
          </span>
          <span className="font-mono text-[10.5px] font-semibold text-[var(--accent-text)] tabular-nums">
            {position.quantity} {position.side === "yes" ? t("YES") : t("NO")}{" "}
            @ {position.avgPricePoints} {t("PTS", "pts")}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className={EYEBROW_CLASS}>
          {t("FLOOR_RESOLUTION", "Resolution")} ·{" "}
          {t("SETTLEMENT_SOURCE", {
            source: sourceLabel(market.settlementSourceKey),
          })}
        </span>
        <p className="m-0 line-clamp-3 text-[11.5px] leading-[1.5] text-[var(--t2)]">
          {/* A rule without whitespace is a machine key such as
              "manual_attestation", not prose: fall through, as the
              market page does. */}
          {(market.settlementRule && /\s/.test(market.settlementRule.trim())
            ? market.settlementRule.trim()
            : "") ||
            market.description?.trim() ||
            t("FLOOR_RULES_FALLBACK", "Resolves under the published market rules.")}
        </p>
      </div>

      <div className="flex items-baseline gap-2">
        <span className={EYEBROW_CLASS}>{t("LIQUIDITY")}</span>
        <span className="font-mono text-[11px] font-semibold text-[var(--t2)] tabular-nums">
          {formatCompactPoints(market.liquidityPoints)}
        </span>
      </div>

      <div className="border-t border-[var(--border-1)] pt-3">
        <ConnectedTradeTicket
          key={market.id}
          market={market}
          defaultSide={defaultSide}
          defaultAmount={100}
          onMarketUpdate={onMarketUpdate}
        />
      </div>

      <Link
        href={`/market/${market.ticker}`}
        className="self-start text-[12px] font-semibold text-[var(--accent-text)] no-underline hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)]"
      >
        {t("MARKET_DETAILS")} →
      </Link>
    </div>
  );
}
