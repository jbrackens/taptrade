"use client";

/**
 * DemoCheckout — the simulated provider panel for a pending purchase.
 *
 * Honestly labeled: a persistent "Demo checkout — simulated, no real charge"
 * banner sits above a legitimate-looking order panel. The four demo outcome
 * controls map 1:1 to the gateway's demo provider outcomes (success /
 * failure / cancel / delayed). Buttons disable while a confirmation is in
 * flight so a double-click cannot double-submit (the server is idempotent
 * regardless — duplicate confirms are 200 no-ops).
 */

import { useTranslation } from "react-i18next";
import { Button, Card } from "../ui";
import type {
  StoreDemoOutcome,
  StorePurchase,
} from "../../lib/api/store-client";
import { formatUsdCents } from "../../lib/usd";

// A disclosure banner is chrome, not an identity/liveness moment — neutral
// ink surface, never the reward pink.
const BANNER_CLASS =
  "mb-3 rounded-[var(--r-rh-sm)] border border-[var(--border-2)] bg-[var(--surface-2)] p-2.5 text-center text-xs font-semibold leading-[1.45] text-[var(--t2)]";
const PANEL_TITLE_CLASS =
  "m-0 mb-1 text-sm font-semibold tracking-[-0.01em] text-[var(--t1)]";
const PANEL_SUB_CLASS = "m-0 mb-4 text-xs leading-[1.5] text-[var(--t3)]";
const REF_ROW_CLASS =
  "mb-4 flex flex-col gap-1.5 rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-2)] p-3 text-[11px] text-[var(--t3)]";
const REF_LINE_CLASS =
  "flex items-center justify-between gap-3 overflow-hidden";
const REF_VALUE_CLASS =
  "overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[var(--t2)] [font-variant-numeric:tabular-nums]";
const ALT_GROUP_CLASS = "mt-4 border-t border-[var(--border-1)] pt-3.5";
const ALT_TITLE_CLASS =
  "m-0 mb-2 text-[12px] font-semibold text-[var(--t3)]";
const ALT_ROW_CLASS = "flex flex-wrap gap-2";

export interface DemoCheckoutProps {
  purchase: StorePurchase;
  processing: boolean;
  onOutcome: (outcome: StoreDemoOutcome) => void;
}

export function DemoCheckout({
  purchase,
  processing,
  onOutcome,
}: DemoCheckoutProps) {
  const { t } = useTranslation("store");
  return (
    <div>
      <div className={BANNER_CLASS} role="status">
        {t("checkout.banner", "Demo checkout — simulated, no real charge")}
      </div>
      <Card
        padding="md"
        aria-label={t("checkout.title", "Simulated checkout")}
      >
        <h2 className={PANEL_TITLE_CLASS}>
          {t("checkout.title", "Simulated checkout")}
        </h2>
        <p className={PANEL_SUB_CLASS}>
          {t(
            "checkout.subtitle",
            "Pick an outcome below to finish this simulated checkout. Points are added only on a completed checkout.",
          )}
        </p>
        <div className={REF_ROW_CLASS}>
          <span className={REF_LINE_CLASS}>
            <span>{t("checkout.orderRef", "Order reference")}</span>
            <span className={REF_VALUE_CLASS}>{purchase.id}</span>
          </span>
          <span className={REF_LINE_CLASS}>
            <span>{t("checkout.provider", "Provider")}</span>
            <span className={REF_VALUE_CLASS}>
              {t("checkout.providerDemo", "Demo (simulated)")}
            </span>
          </span>
          <span className={REF_LINE_CLASS}>
            <span>{t("checkout.amount", "Amount")}</span>
            <span className={REF_VALUE_CLASS}>
              {formatUsdCents(purchase.priceUsdCents)}
            </span>
          </span>
        </div>
        <Button
          variant="cta"
          size="none"
          data-testid="checkout-pay"
          disabled={processing}
          onClick={() => onOutcome("success")}
        >
          {processing
            ? t("checkout.processing", "Processing…")
            : t("checkout.pay", "Complete simulated checkout")}
        </Button>
        <div className={ALT_GROUP_CLASS}>
          <h3 className={ALT_TITLE_CLASS}>
            {t("checkout.outcomes", "Other demo outcomes")}
          </h3>
          <div className={ALT_ROW_CLASS}>
            <Button
              size="sm"
              className="min-h-11 flex-1 whitespace-nowrap"
              data-testid="checkout-fail"
              disabled={processing}
              onClick={() => onOutcome("failure")}
            >
              {t("checkout.fail", "Simulate a decline")}
            </Button>
            <Button
              size="sm"
              className="min-h-11 flex-1 whitespace-nowrap"
              data-testid="checkout-delay"
              disabled={processing}
              onClick={() => onOutcome("delayed")}
            >
              {t("checkout.delay", "Simulate delayed completion")}
            </Button>
            <Button
              size="sm"
              className="min-h-11 flex-1 whitespace-nowrap"
              data-testid="checkout-cancel"
              disabled={processing}
              onClick={() => onOutcome("cancel")}
            >
              {t("checkout.cancel", "Cancel checkout")}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
