"use client";

/**
 * Whole rows on the board. The grid is 4 columns wide, then 3, 2 and 1 as
 * the window narrows, and markets that share an event fold into one card —
 * so a page of 12 markets could render 10 cards and leave a half-empty last
 * row (the Fed, Israel and US–Iran cards each folded two markets,
 * 2026-09-28). The board therefore shows cards in blocks of 12, which fill
 * every column count, loads further pages quietly until it has a block,
 * and keeps any extra cards for "Load more". Only the very end of the list
 * may leave a short row.
 */

import { useEffect, useRef, useState } from "react";

/** Fills 4, 3, 2 and 1 columns exactly. */
export const ROW_UNIT = 12;

/** Cards shown for a target, given what is loaded and whether more exists. */
export function wholeRowLimit(cardCount: number, target: number, hasNext: boolean): number {
  if (cardCount >= target) return target;
  // Short of the target: wait for the next page rather than show a ragged
  // row — unless nothing more exists, or nothing whole can be shown yet.
  if (!hasNext) return cardCount;
  const whole = Math.floor(cardCount / ROW_UNIT) * ROW_UNIT;
  return whole > 0 ? whole : cardCount;
}

export function useWholeRows({
  cardCount,
  hasNext,
  busy,
  fetchNext,
  resetKey,
}: {
  /** Cards the loaded markets make (after event grouping). */
  cardCount: number;
  hasNext: boolean;
  /** A request is in flight or the last one failed: don't fetch again. */
  busy: boolean;
  fetchNext: () => void;
  /** Changes when the list starts over (a new filter or sort). */
  resetKey: unknown;
}) {
  const [target, setTarget] = useState(ROW_UNIT);
  const fetchRef = useRef(fetchNext);
  fetchRef.current = fetchNext;

  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey is the trigger; a new list starts from one block
  useEffect(() => {
    setTarget(ROW_UNIT);
  }, [resetKey]);

  useEffect(() => {
    if (!busy && hasNext && cardCount < target) fetchRef.current();
  }, [busy, hasNext, cardCount, target]);

  return {
    cardLimit: wholeRowLimit(cardCount, target, hasNext),
    canShowMore: hasNext || cardCount > target,
    showMore: () => setTarget((t) => t + ROW_UNIT),
  };
}
