"use client";

/**
 * useMarketWatch — one market's watchlist star (the market page header).
 * Same contract as the board's stars: optimistic, reverted with a toast on
 * failure, and signed out it says what's needed instead of doing nothing.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  addMarketToWatchlist,
  getMarketWatchlist,
  removeMarketFromWatchlist,
} from "../../lib/api/market-watchlist-client";
import { useToast } from "../ToastProvider";

export function useMarketWatch(
  marketId: string | undefined,
  isAuthenticated: boolean,
): { watched: boolean; toggle: () => void } {
  const { t } = useTranslation("prediction");
  const toast = useToast();
  const [watched, setWatched] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !marketId) {
      setWatched(false);
      return;
    }
    let cancelled = false;
    getMarketWatchlist()
      .then((ids) => {
        if (!cancelled) setWatched(ids.includes(marketId));
      })
      .catch(() => {
        if (!cancelled) setWatched(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, marketId]);

  const toggle = useCallback(() => {
    if (!marketId) return;
    if (!isAuthenticated) {
      toast.info(
        t("WATCHLIST_SIGN_IN", "Sign in to save markets"),
        t("WATCHLIST_SIGN_IN_BODY", "Log in and tap the star to build your watchlist."),
      );
      return;
    }
    const wasWatched = watched;
    setWatched(!wasWatched);
    const request = wasWatched
      ? removeMarketFromWatchlist(marketId)
      : addMarketToWatchlist(marketId);
    request.catch((err: unknown) => {
      setWatched(wasWatched);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(t("WATCHLIST_UPDATE_FAILED", "Watchlist not updated"), msg);
    });
  }, [isAuthenticated, marketId, t, toast, watched]);

  return { watched, toggle };
}
