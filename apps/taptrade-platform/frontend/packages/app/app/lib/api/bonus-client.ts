import { apiClient } from "./client";

interface TimedCacheEntry<T> {
  data: T;
  ts: number;
}

export interface PlayerBonus {
  bonusId: number;
  campaignName: string;
  bonusType: string;
  status: string;
  unit: string;
  grantedPoints: number;
  remainingPoints: number;
  expiresAt: string;
  grantedAt: string;
}

export interface WalletBreakdown {
  basePoints: number;
  bonusPoints: number;
  totalPoints: number;
  unit: string;
}

interface BonusListResponse {
  bonuses: PlayerBonusResponse[];
}

interface PlayerBonusResponse {
  unit?: string;
  bonus_id?: number;
  bonusId?: number;
  campaign_name?: string;
  campaignName?: string;
  bonus_type?: string;
  bonusType?: string;
  status: string;
  granted_amount_points?: number;
  grantedAmountPoints?: number;
  grantedPoints?: number;
  remaining_amount_points?: number;
  remainingAmountPoints?: number;
  remainingPoints?: number;
  expires_at?: string;
  expiresAt?: string;
  granted_at?: string;
  grantedAt?: string;
}

interface BreakdownResponse {
  unit?: string;
  basePoints?: number;
  bonusPoints?: number;
  totalPoints?: number;
  currency?: string;
  activeBonusCount?: number;
}

interface LegacyBreakdownResponse extends BreakdownResponse {
  realMoneyPoints?: number;
  bonusFundPoints?: number;
  totalPoints?: number;
}

const ACTIVE_CACHE_TTL_MS = 15_000;
const BREAKDOWN_CACHE_TTL_MS = 15_000;

const activeBonusesCache: {
  entry: TimedCacheEntry<PlayerBonus[]> | null;
  promise: Promise<PlayerBonus[]> | null;
} = { entry: null, promise: null };

const breakdownCache = new Map<
  string,
  {
    entry: TimedCacheEntry<WalletBreakdown> | null;
    promise: Promise<WalletBreakdown> | null;
  }
>();

function isFresh<T>(
  entry: TimedCacheEntry<T> | null,
  ttlMs: number,
): entry is TimedCacheEntry<T> {
  return entry !== null && Date.now() - entry.ts < ttlMs;
}

export async function getActiveBonuses(): Promise<PlayerBonus[]> {
  if (isFresh(activeBonusesCache.entry, ACTIVE_CACHE_TTL_MS)) {
    return activeBonusesCache.entry.data;
  }
  if (activeBonusesCache.promise) return activeBonusesCache.promise;

  const promise = apiClient
    .get<BonusListResponse>("/api/v1/bonuses/active")
    .then((res) => {
      const data = (res.bonuses || []).map(normalizePlayerBonus);
      activeBonusesCache.entry = { data, ts: Date.now() };
      activeBonusesCache.promise = null;
      return data;
    })
    .catch((err: unknown) => {
      activeBonusesCache.promise = null;
      throw err;
    });

  activeBonusesCache.promise = promise;
  return promise;
}

export async function claimBonus(
  campaignId: number,
  triggerReference?: string,
): Promise<PlayerBonus> {
  const body: Record<string, unknown> = { campaign_id: campaignId };
  if (triggerReference) body.trigger_reference = triggerReference;

  const result = await apiClient.post<PlayerBonusResponse>(
    "/api/v1/bonuses/claim",
    body,
  );
  // Invalidate cache after claim
  activeBonusesCache.entry = null;
  return normalizePlayerBonus(result);
}

export async function getWalletBreakdown(
  userId: string,
): Promise<WalletBreakdown> {
  const cached = breakdownCache.get(userId);
  if (cached && isFresh(cached.entry, BREAKDOWN_CACHE_TTL_MS)) {
    return cached.entry.data;
  }
  if (cached?.promise) return cached.promise;

  const promise = apiClient
    .get<BreakdownResponse>(`/api/v1/wallet/${userId}/breakdown`)
    .then((res) => {
      const legacyRes = res as LegacyBreakdownResponse;
      const basePoints = res.basePoints ?? legacyRes.realMoneyPoints ?? 0;
      const bonusPoints = res.bonusPoints ?? legacyRes.bonusFundPoints ?? 0;
      const totalPoints =
        res.totalPoints ?? legacyRes.totalPoints ?? basePoints + bonusPoints;
      const data: WalletBreakdown = {
        basePoints,
        bonusPoints,
        totalPoints,
        unit: res.unit || res.currency || "PTS",
      };
      breakdownCache.set(userId, {
        entry: { data, ts: Date.now() },
        promise: null,
      });
      return data;
    })
    .catch((err: unknown) => {
      breakdownCache.set(userId, { entry: null, promise: null });
      throw err;
    });

  breakdownCache.set(userId, { entry: cached?.entry ?? null, promise });
  return promise;
}

/** Invalidate all bonus caches (call after WebSocket bonus events). */
export function invalidateBonusCaches(): void {
  activeBonusesCache.entry = null;
  breakdownCache.clear();
}

function normalizePlayerBonus(raw: PlayerBonusResponse): PlayerBonus {
  const grantedPoints =
    raw.grantedPoints ??
    raw.grantedAmountPoints ??
    raw.granted_amount_points ??
    0;
  const remainingPoints =
    raw.remainingPoints ??
    raw.remainingAmountPoints ??
    raw.remaining_amount_points ??
    0;

  return {
    bonusId: raw.bonusId ?? raw.bonus_id ?? 0,
    campaignName: raw.campaignName ?? raw.campaign_name ?? "",
    bonusType: raw.bonusType ?? raw.bonus_type ?? "",
    status: raw.status,
    unit: raw.unit || "PTS",
    grantedPoints,
    remainingPoints,
    expiresAt: raw.expiresAt ?? raw.expires_at ?? "",
    grantedAt: raw.grantedAt ?? raw.granted_at ?? "",
  };
}
