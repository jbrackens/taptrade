import { apiClient } from "./client";

/** One real fill on the exchange, with the market it happened on. */
export interface ActivityTrade {
  tradedAt: string;
  side: "yes" | "no";
  pricePoints: number;
  quantity: number;
  isAmmTrade: boolean;
  marketId: string;
  ticker: string;
  title: string;
  categorySlug?: string;
}

/** An open market whose traded Yes price moved over the last 24 hours. */
export interface Mover {
  marketId: string;
  ticker: string;
  title: string;
  categorySlug?: string;
  yesFrom: number;
  yesTo: number;
  changePoints: number;
  trades24h: number;
}

export interface RecentActivity {
  trades: ActivityTrade[];
  movers: Mover[];
}

/** GET /api/v1/activity/recent — empty lists when the exchange is quiet. */
export async function getRecentActivity(limit = 20): Promise<RecentActivity> {
  const payload = await apiClient.get<Partial<RecentActivity>>("/api/v1/activity/recent", {
    limit: String(limit),
  });
  return { trades: payload?.trades ?? [], movers: payload?.movers ?? [] };
}
