import type {
  MarketStatus,
  PredictionMarket,
} from "@taptrade-ui/api-client/src/prediction-types";

type Translate = (key: string, options?: Record<string, unknown>) => string;

// Points formatting (formatCompactPoints & friends) lives in app/lib/points —
// the single Points-display module. This file keeps market status/sorting
// helpers only.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Time until a market closes, in its one largest unit: "42m", "6h", "3d",
 * "5mo", "2y". `urgent` marks the last 24 hours. Null once closed or when
 * the date is unreadable — callers show nothing rather than a guess.
 */
export function timeLeft(
  closeAt: string,
  now: number = Date.now(),
): { value: string; urgent: boolean } | null {
  const diff = new Date(closeAt).getTime() - now;
  if (!Number.isFinite(diff) || diff <= 0) return null;
  const urgent = diff < DAY_MS;
  if (diff < HOUR_MS)
    return { value: `${Math.max(1, Math.floor(diff / 60_000))}m`, urgent };
  if (diff < DAY_MS) return { value: `${Math.floor(diff / HOUR_MS)}h`, urgent };
  const days = Math.floor(diff / DAY_MS);
  if (days < 60) return { value: `${days}d`, urgent };
  const months = Math.floor(days / 30);
  if (months < 24) return { value: `${months}mo`, urgent };
  return { value: `${Math.floor(days / 365)}y`, urgent };
}

export function isOpenMarketStatus(status: MarketStatus | string): boolean {
  return status === "open";
}

export function marketStatusLabel(
  status: MarketStatus | string,
  t: Translate,
): string {
  switch (status) {
    case "open":
      return t("LIVE");
    case "unopened":
      return t("UNOPENED");
    case "halted":
      return t("HALTED");
    case "closed":
      return t("CLOSED");
    case "proposed_resolution":
      return t("PROPOSED_RESOLUTION");
    case "disputed":
      return t("DISPUTED");
    case "settled":
      return t("SETTLED");
    case "voided":
      return t("VOIDED");
    default:
      return t("MARKET_STATUS", { status });
  }
}

export function dedupeMarkets(markets: PredictionMarket[]): PredictionMarket[] {
  const seen = new Set<string>();

  return markets.filter((market) => {
    const key = market.id || market.ticker;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function sortMarketsByVolume(
  markets: PredictionMarket[],
): PredictionMarket[] {
  return [...markets].sort((a, b) => b.volumePoints - a.volumePoints);
}

export function normalizePriceShares(
  yesPricePoints: number,
  noPricePoints: number,
) {
  const total = yesPricePoints + noPricePoints;
  if (total <= 0) {
    return { yesShare: 50, noShare: 50 };
  }

  return {
    yesShare: (yesPricePoints / total) * 100,
    noShare: (noPricePoints / total) * 100,
  };
}
