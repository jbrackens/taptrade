"use client";

/**
 * QuickTradePanel — trade a market straight from a market list. A card's
 * YES/NO button opens the InspectorPanel (price, resolution, the real
 * ConnectedTradeTicket preselected on that side, and a link to the full
 * market page) without leaving the list.
 *
 * Host by band, mirroring the market page's ticket: a centred Dialog above
 * 1023px, the vaul Sheet at or below it. Exactly one host is mounted at a
 * time — a second TradeTicket would fork amount state and double preview
 * fetches.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  OrderSide,
  PredictionMarket,
} from "@taptrade-ui/api-client/src/prediction-types";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "../ui/Dialog";
import { Sheet } from "../ui/Sheet.lazy";
import { InspectorPanel } from "./InspectorPanel";

export interface QuickTradeTarget {
  market: PredictionMarket;
  side: OrderSide;
}

const SHEET_BAND_QUERY = "(max-width: 1023px)";

export function QuickTradePanel({
  target,
  onClose,
}: {
  target: QuickTradeTarget | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("prediction");
  const [isSheetBand, setIsSheetBand] = useState(false);
  // The last opened target, kept after close so the content stays put
  // through the exit animation. Also takes a fill's price update.
  const [current, setCurrent] = useState<QuickTradeTarget | null>(null);

  useEffect(() => {
    const mql = window.matchMedia(SHEET_BAND_QUERY);
    const sync = () => setIsSheetBand(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (target) setCurrent(target);
  }, [target]);

  const open = target !== null;
  const label = t("QUICK_TRADE", "Quick trade");
  const title = current?.market.title ?? label;
  const onOpenChange = (next: boolean) => {
    if (!next) onClose();
  };
  const onMarketUpdate = (market: PredictionMarket) => {
    setCurrent((prev) =>
      prev && prev.market.id === market.id
        ? { ...prev, market: { ...prev.market, ...market } }
        : prev,
    );
  };

  const body = current ? (
    <InspectorPanel
      market={current.market}
      openPositions={0}
      onMarketUpdate={onMarketUpdate}
      label={label}
      defaultSide={current.side}
      bare
    />
  ) : null;

  if (isSheetBand) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange} title={title}>
        {body}
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="quick-trade-dialog">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogClose
          aria-label={t("CLOSE", "Close")}
          className="absolute right-3 top-3 grid h-8 w-8 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-[18px] leading-none text-[var(--t3)] hover:bg-[var(--surface-2)] hover:text-[var(--t1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        >
          <span aria-hidden="true">×</span>
        </DialogClose>
        <div className="terminal-scrollbar max-h-[calc(100dvh-96px)] overflow-y-auto">
          {body}
        </div>
      </DialogContent>
    </Dialog>
  );
}
