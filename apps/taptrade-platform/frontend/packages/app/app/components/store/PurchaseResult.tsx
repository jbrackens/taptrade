"use client";

/**
 * PurchaseResult — the terminal/pending panels for a store purchase.
 *
 * success   → points credited banner + new balance + ledger link +
 *             "Return to market" (only with a validated return context) +
 *             "Back to store".
 * failed    → failure reason + retry CTA. Failed is TERMINAL on the server:
 *             retry creates a NEW checkout for the same pack (onRetry),
 *             never a re-confirm of the dead purchase.
 * canceled  → back to the order summary, nothing credited.
 * pending   → delayed completion panel + "Check status" (getPurchase poll);
 *             the page flips this to success when the server completes.
 */

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { Button, Card } from "../ui";
import type { StorePurchase } from "../../lib/api/store-client";
import { formatPoints, formatPointsAmount } from "../../lib/points";

const DOT_BASE_CLASS = "mx-auto mb-3 block size-2.5 rounded-full";
const TITLE_CLASS =
  "m-0 mb-1.5 text-[17px] font-bold tracking-[-0.01em] text-[var(--t1)]";
const BODY_CLASS = "m-0 mb-4 text-[13px] leading-[1.55] text-[var(--t2)]";
const BALANCE_ROW_CLASS =
  "mx-auto mb-4 flex max-w-[320px] items-center justify-between gap-3 rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-2)] p-3 text-[13px]";
const BALANCE_LABEL_CLASS = "font-medium text-[var(--t3)]";
const BALANCE_VALUE_CLASS =
  "font-mono font-semibold text-[var(--t1)] [font-variant-numeric:tabular-nums]";
const ACTIONS_CLASS = "flex flex-col items-stretch gap-2";
// Result actions use the shared Button recipes.
const SECONDARY_SIZING = "w-full px-4 py-3 text-[13px]";
const QUIET_LINK_CLASS =
  "mt-1 inline-block border-b border-[var(--border-1)] pb-0.5 text-[13px] text-[var(--t2)] no-underline hover:border-[var(--accent)] hover:text-[var(--t1)]";

function ResultShell({
  testid,
  dotClass,
  title,
  body,
  children,
}: {
  testid: string;
  dotClass: string;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <Card padding="md" className="text-center" data-testid={testid} role="status">
      <span className={`${DOT_BASE_CLASS} ${dotClass}`} aria-hidden="true" />
      <h2 className={TITLE_CLASS}>{title}</h2>
      <p className={BODY_CLASS}>{body}</p>
      {children}
    </Card>
  );
}

export function PurchaseSuccess({
  purchase,
  newBalance,
  returnPath,
  onBackToStore,
}: {
  purchase: StorePurchase;
  newBalance: number | null;
  returnPath: string | null;
  onBackToStore: () => void;
}) {
  const { t } = useTranslation("store");
  return (
    <ResultShell
      testid="purchase-success"
      dotClass="bg-[var(--success)]"
      title={t("result.successTitle", "Points added")}
      body={t(
        "result.successBody",
        "{{points}} pts were added to your balance.",
        {
          points: formatPointsAmount(purchase.totalPoints),
        },
      )}
    >
      <div className={BALANCE_ROW_CLASS}>
        <span className={BALANCE_LABEL_CLASS}>
          {t("result.newBalance", "New balance")}
        </span>
        <span className={BALANCE_VALUE_CLASS}>
          {typeof newBalance === "number" ? formatPoints(newBalance) : "—"}
        </span>
      </div>
      <div className={ACTIONS_CLASS}>
        {returnPath ? (
          <Button
            variant="cta"
            size="none"
            render={<Link href={returnPath} data-testid="return-to-market" />}
          >
            {t("result.returnToMarket", "Return to market")}
          </Button>
        ) : null}
        <Button
          variant={returnPath ? "secondary" : "cta"}
          size="none"
          className={returnPath ? SECONDARY_SIZING : undefined}
          onClick={onBackToStore}
        >
          {t("result.backToStore", "Back to store")}
        </Button>
        <Link href="/account/transactions" className={QUIET_LINK_CLASS}>
          {t("result.viewLedger", "View point ledger")} →
        </Link>
      </div>
    </ResultShell>
  );
}

export function PurchaseFailed({
  purchase,
  retrying,
  onRetry,
  onBackToStore,
}: {
  purchase: StorePurchase;
  retrying: boolean;
  onRetry: () => void;
  onBackToStore: () => void;
}) {
  const { t } = useTranslation("store");
  const rawReason =
    purchase.failureReason ||
    t(
      "result.failedReasonFallback",
      "The simulated checkout did not complete.",
    );
  // Server reasons arrive lowercase and unpunctuated ("simulated checkout
  // declined") — sentence-case them so the composed body reads cleanly.
  const reason = `${rawReason.charAt(0).toUpperCase()}${rawReason.slice(1)}${
    /[.!?]$/.test(rawReason) ? "" : "."
  }`;
  return (
    <ResultShell
      testid="purchase-failed"
      dotClass="bg-[var(--border-2)]"
      title={t("result.failedTitle", "Checkout did not complete")}
      body={t(
        "result.failedBody",
        "{{reason}} No points were added. You can start a new checkout for the same pack.",
        { reason },
      )}
    >
      <div className={ACTIONS_CLASS}>
        <Button
          variant="cta"
          size="none"
          onClick={onRetry}
          disabled={retrying}
        >
          {retrying
            ? t("checkout.processing", "Processing…")
            : t("result.retry", "Try again")}
        </Button>
        <Button
          size="none"
          className={SECONDARY_SIZING}
          onClick={onBackToStore}
          disabled={retrying}
        >
          {t("result.backToStore", "Back to store")}
        </Button>
      </div>
    </ResultShell>
  );
}

export function PurchaseCanceled({
  onBackToSummary,
}: {
  onBackToSummary: () => void;
}) {
  const { t } = useTranslation("store");
  return (
    <ResultShell
      testid="purchase-canceled"
      dotClass="bg-[var(--border-2)]"
      title={t("result.canceledTitle", "Checkout canceled")}
      body={t(
        "result.canceledBody",
        "This simulated checkout was canceled. No points were added.",
      )}
    >
      <div className={ACTIONS_CLASS}>
        <Button
          variant="cta"
          size="none"
          onClick={onBackToSummary}
        >
          {t("result.backToSummary", "Back to order summary")}
        </Button>
      </div>
    </ResultShell>
  );
}

export function PurchasePending({
  checking,
  onCheckStatus,
}: {
  checking: boolean;
  onCheckStatus: () => void;
}) {
  const { t } = useTranslation("store");
  return (
    <ResultShell
      testid="purchase-pending"
      dotClass="bg-[var(--info-dot)]"
      title={t("result.pendingTitle", "Completion pending")}
      body={t(
        "result.pendingBody",
        "The simulated provider reported a delay. Points are added only once the checkout completes — check the status below.",
      )}
    >
      <div className={ACTIONS_CLASS}>
        <Button
          variant="cta"
          size="none"
          onClick={onCheckStatus}
          disabled={checking}
        >
          {checking
            ? t("result.checking", "Checking…")
            : t("result.checkStatus", "Check status")}
        </Button>
      </div>
    </ResultShell>
  );
}
