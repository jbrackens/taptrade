"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createPredictionClient } from "@taptrade-ui/api-client/src/prediction-client";
import type { OrderSide } from "@taptrade-ui/api-client/src/prediction-types";
import { useAuth } from "../../hooks/useAuth";

const api = createPredictionClient();

export const positionQueryKeys = {
  all: ["positions"] as const,
};

export interface HeldPosition {
  side: OrderSide;
  quantity: number;
}

/**
 * The signed-in player's open positions, keyed by market id — one request
 * shared by every market grid on the page. Signed-out players get an empty
 * map without a request. Where a player holds both sides of a market, the
 * larger holding wins.
 */
export function useHeldPositions(): Map<string, HeldPosition> {
  const { isAuthenticated } = useAuth();
  const { data } = useQuery({
    queryKey: positionQueryKeys.all,
    queryFn: () => api.getPositions(),
    enabled: isAuthenticated,
    staleTime: 30 * 1000,
  });

  return useMemo(() => {
    const held = new Map<string, HeldPosition>();
    if (!isAuthenticated) return held;
    for (const p of data ?? []) {
      if (!(p.quantity > 0)) continue;
      const prev = held.get(p.marketId);
      if (!prev || p.quantity > prev.quantity) {
        held.set(p.marketId, { side: p.side, quantity: p.quantity });
      }
    }
    return held;
  }, [data, isAuthenticated]);
}
