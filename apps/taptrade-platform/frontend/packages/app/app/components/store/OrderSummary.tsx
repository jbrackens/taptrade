"use client";

/**
 * OrderSummary — the label/value ticket for the selected pack (and, in the
 * checkout/result steps, for the server purchase snapshot). Follows the
 * TradeTicket row recipe: --t3 labels, Geist Mono values, tabular nums.
 */

import { useTranslation } from "react-i18next";
import { Card } from "../ui";
import { PointsFlow } from "../ui/PointsFlow";
import { formatPointsAmount } from "../../lib/points";
import { formatUsdCents } from "../../lib/usd";
import type { StorePurchaseStatus } from "../../lib/api/store-client";

const TITLE_CLASS =
  "m-0 mb-3.5 text-sm font-semibold tracking-[-0.01em] text-[var(--t1)]";
const ROWS_CLASS =
  "flex flex-col gap-3 text-[13px] [font-variant-numeric:tabular-nums]";
const ROW_CLASS = "flex items-center justify-between gap-3";
const LABEL_CLASS = "font-medium text-[var(--t3)]";
const VALUE_CLASS =
  "font-mono font-semibold text-[var(--t1)]";
const TOTAL_ROW_CLASS =
  "flex items-center justify-between gap-3 border-t border-[var(--border-1)] pt-3";
const STATUS_CLASS =
  "inline-flex items-center rounded-[var(--r-pill)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--t2)]";

export interface OrderSummaryData {
  packName: string;
  basePoints: number;
  bonusPoints: number;
  totalPoints: number;
  priceUsdCents: number;
  status?: StorePurchaseStatus;
}

export function OrderSummary({
  order,
  children,
}: {
  order: OrderSummaryData;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation("store");

  const statusLabel = (status: StorePurchaseStatus): string => {
    switch (status) {
      case "pending_payment":
        return t("status.pending_payment", "Awaiting checkout");
      case "completed":
        return t("status.completed", "Completed");
      case "failed":
        return t("status.failed", "Did not complete");
      case "canceled":
        return t("status.canceled", "Canceled");
    }
  };

  return (
    <Card
      padding="md"
      data-testid="order-summary"
      aria-label={t("summary.title", "Order summary")}
    >
      <h2 className={TITLE_CLASS}>{t("summary.title", "Order summary")}</h2>
      <div className={ROWS_CLASS}>
        <div className={ROW_CLASS}>
          <span className={LABEL_CLASS}>{t("summary.pack", "Point pack")}</span>
          <span className={VALUE_CLASS}>{order.packName}</span>
        </div>
        <div className={ROW_CLASS}>
          <span className={LABEL_CLASS}>
            {t("summary.base", "Base points")}
          </span>
          <span className={VALUE_CLASS}>
            {formatPointsAmount(order.basePoints)}
          </span>
        </div>
        {order.bonusPoints > 0 ? (
          <div className={ROW_CLASS}>
            <span className={LABEL_CLASS}>
              {t("summary.bonus", "Bonus points")}
            </span>
            <span className={VALUE_CLASS}>
              +{formatPointsAmount(order.bonusPoints)}
            </span>
          </div>
        ) : null}
        <div className={TOTAL_ROW_CLASS}>
          <span className={LABEL_CLASS}>
            {t("summary.total", "Total points")}
          </span>
          <span className={VALUE_CLASS}>
            <PointsFlow value={order.totalPoints} /> {t("packs.unit", "pts")}
          </span>
        </div>
        <div className={ROW_CLASS}>
          <span className={LABEL_CLASS}>{t("summary.price", "Price")}</span>
          <span className={VALUE_CLASS}>
            {formatUsdCents(order.priceUsdCents)}
          </span>
        </div>
        {order.status ? (
          <div className={ROW_CLASS}>
            <span className={LABEL_CLASS}>{t("summary.status", "Status")}</span>
            <span className={STATUS_CLASS}>{statusLabel(order.status)}</span>
          </div>
        ) : null}
      </div>
      {children}
    </Card>
  );
}
