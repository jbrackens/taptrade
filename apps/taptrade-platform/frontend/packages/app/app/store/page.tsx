"use client";

/**
 * /store — the Point Store (STORE_AND_PAYMENTS.md §8).
 *
 * Browse: pack grid (server catalogue; badges from real config only;
 * "popular" pre-selected so it reads highlighted without hiding others) →
 * order summary → Continue to checkout. Checkout: an explicitly labeled
 * simulated demo provider panel; outcomes map to the gateway's demo
 * confirm endpoint. Results derive from the SERVER purchase status — the
 * purchase id lives in the URL (?purchase=sp_…), so a mid-flow refresh
 * re-fetches the row and lands on the correct state instead of corrupting
 * the flow. `?return=` carries a validated same-origin market path from
 * the TradeTicket insufficient-balance entry point.
 *
 * On completion the wallet balance cache is invalidated and the fresh
 * balance is dispatched to Redux so the TopBar pill updates immediately.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button, Card } from "../components/ui";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "../components/ToastProvider";
import TapDot from "../components/TapDot";
import { logger } from "../lib/logger";
import { useAppDispatch } from "../lib/store/hooks";
import { setCurrentBalance } from "../lib/store/pointBalanceSlice";
import { getBalance, invalidateBalanceCache } from "../lib/api/wallet-client";
import {
  confirmPurchase,
  createCheckout,
  getPacks,
  getPurchase,
  resolveCheckoutIdempotency,
  type PendingCheckoutKey,
  type StoreDemoOutcome,
  type StorePack,
  type StorePurchase,
} from "../lib/api/store-client";
import { formatPointsAmount } from "../lib/points";
import { storeReturnPath } from "../lib/storeReturnPath";
import { PackGrid } from "../components/store/PackGrid";
import { OrderSummary } from "../components/store/OrderSummary";
import { DemoCheckout } from "../components/store/DemoCheckout";
import {
  PurchaseCanceled,
  PurchaseFailed,
  PurchasePending,
  PurchaseSuccess,
} from "../components/store/PurchaseResult";

const WRAP_CLASS = "mx-auto max-w-[1120px] pb-[60px] max-[768px]:px-4";
const HEAD_CLASS = "mb-[22px] flex items-end justify-between gap-4";
const KICKER_CLASS =
  "mb-1.5 inline-block text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--reward-text)]";
const TITLE_CLASS =
  "m-0 text-[34px] font-extrabold tracking-[-0.02em] text-[var(--t1)] max-[768px]:text-[26px]";
const CROSS_LINK_CLASS =
  "border-b border-[var(--border-1)] pb-0.5 text-[13px] text-[var(--t2)] no-underline hover:border-[var(--accent)] hover:text-[var(--t1)]";
const GRID_CLASS =
  "grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-start gap-[18px] max-[1024px]:grid-cols-1";
const SIDE_COL_CLASS = "flex flex-col gap-[18px]";
const HOW_CARD_CLASS =
  "rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-2)] p-3.5";
const HOW_TITLE_CLASS =
  "m-0 mb-1 text-[13px] font-bold uppercase tracking-[0.04em] text-[var(--t3)]";
const HOW_BODY_CLASS = "m-0 text-xs leading-[1.55] text-[var(--t2)]";
const FIRST_PURCHASE_CLASS = "mt-3 text-xs leading-[1.5] text-[var(--t3)]";
const STATE_CLASS = "flex min-h-[50vh] items-center justify-center px-6";
// State cards/CTAs use ui/Card + ui/Button; only layout rides here.
const STATE_CARD_SIZING = "w-full max-w-[440px] text-center";
const STATE_CTA_SIZING = "gap-1.5 px-5 py-3 text-[13px] no-underline";
const STATE_MESSAGE_CLASS = "m-0 mb-3.5 leading-[1.6] text-[var(--t2)]";
const ERROR_NOTE_CLASS =
  "mb-3 rounded-[var(--r-rh-sm)] border border-[var(--border-2)] bg-[var(--surface-2)] p-2.5 text-center text-xs leading-[1.45] text-[var(--t2)]";

const DELAYED_POLL_MS = 5_000;

// Sentinel for "catalogue failed with no server message" — translated at
// render time so the fetch callback stays dependency-free.
const GENERIC_ERROR = "__store_generic_error__";

function is401(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("401") ||
    msg.includes("unauthorized") ||
    msg.includes("authentication required")
  );
}

function purchaseUrl(purchaseId: string, safeReturn: string | null): string {
  const suffix = safeReturn ? `&return=${encodeURIComponent(safeReturn)}` : "";
  return `/store?purchase=${encodeURIComponent(purchaseId)}${suffix}`;
}

function browseUrl(safeReturn: string | null): string {
  return safeReturn
    ? `/store?return=${encodeURIComponent(safeReturn)}`
    : "/store";
}

export default function StorePage() {
  const { t } = useTranslation("store");
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const dispatch = useAppDispatch();

  const purchaseParam = searchParams.get("purchase");
  const safeReturn = storeReturnPath(searchParams.get("return"));

  const [packs, setPacks] = useState<StorePack[]>([]);
  const [firstPurchase, setFirstPurchase] = useState(false);
  const [packsLoading, setPacksLoading] = useState(true);
  const [packsError, setPacksError] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);

  const [purchase, setPurchase] = useState<StorePurchase | null>(null);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [checking, setChecking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Set once the user picks "delayed": the purchase stays pending_payment on
  // the server until the provider delay elapses, and we show the pending
  // panel + status polling instead of the checkout controls.
  const [awaitingDelayed, setAwaitingDelayed] = useState(false);
  const [newBalance, setNewBalance] = useState<number | null>(null);

  // LC-38 pattern: reuse one idempotency key per unconfirmed checkout
  // attempt for a pack; cleared once the purchase row exists server-side.
  const pendingKeyRef = useRef<PendingCheckoutKey | null>(null);
  // True between a successful checkout POST and the router.push committing
  // ?purchase= to the URL. The hydration effect below must not treat that
  // window's param-less URL as a "back to clean /store" reset — doing so
  // wipes the just-created purchase and can cancel the in-flight transition
  // (race observed under E2E: purchase created server-side, UI stuck on the
  // pack grid with no error).
  const pushingPurchaseRef = useRef(false);
  // Guards the one-time credit side effects (balance refresh + toast) per
  // completed purchase, across re-renders and duplicate status reads.
  const celebratedRef = useRef<Set<string>>(new Set());

  const selectedPack = useMemo(
    () => packs.find((p) => p.id === selectedPackId) ?? null,
    [packs, selectedPackId],
  );

  // ── catalogue ────────────────────────────────────────────────────────────
  // Deliberately dependency-free (translation of the generic error happens
  // at render time via the sentinel) so the load effect fires once per auth
  // resolution instead of re-running when the lazy i18n namespace lands.
  const loadPacks = useCallback(async () => {
    setPacksLoading(true);
    setPacksError(null);
    try {
      const catalogue = await getPacks();
      setPacks(catalogue.packs);
      setFirstPurchase(catalogue.firstPurchase);
      setSelectedPackId((current) => {
        if (current && catalogue.packs.some((p) => p.id === current)) {
          return current;
        }
        // "popular" is the default highlight (real config), every other pack
        // stays fully visible and selectable.
        const popular = catalogue.packs.find((p) => p.id === "popular");
        return (popular ?? catalogue.packs[0])?.id ?? null;
      });
    } catch (err: unknown) {
      if (is401(err)) {
        setAuthError(true);
      } else {
        logger.error("Store", "catalogue fetch failed", err);
        setPacksError(
          err instanceof Error && err.message ? err.message : GENERIC_ERROR,
        );
      }
    } finally {
      setPacksLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user?.id) {
      setPacksLoading(false);
      return;
    }
    void loadPacks();
  }, [authLoading, user?.id, loadPacks]);

  // ── completion side effects (exactly once per purchase) ─────────────────
  // announce=false on URL hydration of an already-completed purchase (page
  // refresh): the balance display still refreshes, but no "points added"
  // toast fires for an old order.
  const handleCompleted = useCallback(
    async (completed: StorePurchase, announce = true) => {
      if (celebratedRef.current.has(completed.id)) return;
      celebratedRef.current.add(completed.id);
      setAwaitingDelayed(false);
      if (!user?.id) return;
      invalidateBalanceCache(user.id);
      try {
        const bal = await getBalance(user.id);
        dispatch(setCurrentBalance(bal.availableBalance));
        setNewBalance(bal.availableBalance);
      } catch (err: unknown) {
        logger.warn("Store", "post-purchase balance refresh failed", err);
      }
      if (announce) {
        toast.success(
          t("result.successTitle", "Points added"),
          t("result.successToast", "+{{points}} pts from the {{pack}} pack", {
            points: formatPointsAmount(completed.totalPoints),
            pack: completed.packId,
          }),
        );
      }
    },
    [user?.id, dispatch, toast, t],
  );

  // ── purchase hydration from the URL (refresh-safe) ───────────────────────
  useEffect(() => {
    if (authLoading || !user?.id) return;
    if (!purchaseParam) {
      // Back-navigation to a clean /store clears URL-hydrated state — but a
      // just-created purchase whose ?purchase= push has not committed yet
      // must survive (see pushingPurchaseRef above).
      if (!pushingPurchaseRef.current) {
        setPurchase(null);
        setAwaitingDelayed(false);
        setActionError(null);
      }
      return;
    }
    pushingPurchaseRef.current = false;
    if (purchase?.id === purchaseParam) return;
    let cancelled = false;
    setPurchaseLoading(true);
    getPurchase(purchaseParam)
      .then((row) => {
        if (cancelled) return;
        setPurchase(row);
        if (row.status === "completed") {
          void handleCompleted(row, false);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (is401(err)) {
          setAuthError(true);
          return;
        }
        logger.error("Store", "purchase fetch failed", err);
        setActionError(
          err instanceof Error
            ? err.message
            : t("state.purchaseError", "This purchase could not be loaded."),
        );
      })
      .finally(() => {
        if (!cancelled) setPurchaseLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, user?.id, purchaseParam, purchase?.id, handleCompleted, t]);

  // ── actions ──────────────────────────────────────────────────────────────
  const handleContinue = useCallback(async () => {
    if (!selectedPack || creating) return;
    setCreating(true);
    setActionError(null);
    const { key, pending } = resolveCheckoutIdempotency(
      pendingKeyRef.current,
      selectedPack.id,
    );
    pendingKeyRef.current = pending;
    try {
      const result = await createCheckout(selectedPack.id, key);
      // The purchase row exists server-side now — the next attempt is a new
      // order, not a replay of this one.
      pendingKeyRef.current = null;
      pushingPurchaseRef.current = true;
      setPurchase(result.purchase);
      setAwaitingDelayed(false);
      router.push(purchaseUrl(result.purchase.id, safeReturn));
    } catch (err: unknown) {
      if (is401(err)) {
        setAuthError(true);
      } else {
        logger.error("Store", "checkout create failed", err);
        setActionError(
          err instanceof Error
            ? err.message
            : t("state.checkoutError", "Checkout could not be started."),
        );
      }
    } finally {
      setCreating(false);
    }
  }, [selectedPack, creating, router, safeReturn, t]);

  const handleOutcome = useCallback(
    async (outcome: StoreDemoOutcome) => {
      if (!purchase || confirming) return;
      setConfirming(true);
      setActionError(null);
      try {
        const result = await confirmPurchase(purchase.id, outcome);
        setPurchase(result.purchase);
        if (result.purchase.status === "completed") {
          await handleCompleted(result.purchase);
        } else if (
          outcome === "delayed" &&
          result.purchase.status === "pending_payment"
        ) {
          setAwaitingDelayed(true);
        }
      } catch (err: unknown) {
        if (is401(err)) {
          setAuthError(true);
        } else {
          logger.error("Store", "confirm failed", err);
          setActionError(
            err instanceof Error
              ? err.message
              : t("state.confirmError", "The simulated outcome failed."),
          );
        }
      } finally {
        setConfirming(false);
      }
    },
    [purchase, confirming, handleCompleted, t],
  );

  const handleCheckStatus = useCallback(async () => {
    if (!purchase || checking) return;
    setChecking(true);
    try {
      const row = await getPurchase(purchase.id);
      setPurchase(row);
      if (row.status === "completed") {
        await handleCompleted(row);
      }
    } catch (err: unknown) {
      logger.warn("Store", "status check failed", err);
    } finally {
      setChecking(false);
    }
  }, [purchase, checking, handleCompleted]);

  // Gentle auto-poll while a delayed completion is pending; the manual
  // "Check status" button shares the same handler.
  useEffect(() => {
    if (!awaitingDelayed || purchase?.status !== "pending_payment") return;
    const timer = setInterval(() => {
      void handleCheckStatus();
    }, DELAYED_POLL_MS);
    return () => clearInterval(timer);
  }, [awaitingDelayed, purchase?.status, handleCheckStatus]);

  const handleRetry = useCallback(async () => {
    if (!purchase || creating) return;
    setCreating(true);
    setActionError(null);
    // Failed purchases are terminal server-side: a retry is a brand-new
    // checkout for the same pack with a FRESH idempotency key.
    const { key, pending } = resolveCheckoutIdempotency(null, purchase.packId);
    pendingKeyRef.current = pending;
    try {
      const result = await createCheckout(purchase.packId, key);
      pendingKeyRef.current = null;
      setPurchase(result.purchase);
      setAwaitingDelayed(false);
      router.replace(purchaseUrl(result.purchase.id, safeReturn));
    } catch (err: unknown) {
      logger.error("Store", "retry checkout failed", err);
      setActionError(
        err instanceof Error
          ? err.message
          : t("state.checkoutError", "Checkout could not be started."),
      );
    } finally {
      setCreating(false);
    }
  }, [purchase, creating, router, safeReturn, t]);

  const backToBrowse = useCallback(
    (packId?: string) => {
      if (packId) setSelectedPackId(packId);
      setPurchase(null);
      setAwaitingDelayed(false);
      setActionError(null);
      router.push(browseUrl(safeReturn));
    },
    [router, safeReturn],
  );

  // ── page states ──────────────────────────────────────────────────────────
  if (authLoading || (user?.id && packsLoading && !purchaseParam)) {
    return (
      <div className={STATE_CLASS}>
        <TapDot label={t("state.loading", "Loading the point store…")} />
      </div>
    );
  }

  if (!user?.id || authError) {
    return (
      <div className={STATE_CLASS}>
        <Card as="div" padding="md" className={STATE_CARD_SIZING}>
          <p className={STATE_MESSAGE_CLASS}>
            {t(
              "state.signIn",
              "Sign in to browse point packs and add points to your balance.",
            )}
          </p>
          <Button
            variant="primary"
            size="none"
            className={STATE_CTA_SIZING}
            render={
              <Link
                href={`/auth/login?returnUrl=${encodeURIComponent(
                  purchaseParam
                    ? purchaseUrl(purchaseParam, safeReturn)
                    : browseUrl(safeReturn),
                )}`}
              />
            }
          >
            {t("state.login", "Log in")}
          </Button>
        </Card>
      </div>
    );
  }

  if (packsError && !purchaseParam) {
    return (
      <div className={STATE_CLASS}>
        <Card as="div" padding="md" className={STATE_CARD_SIZING}>
          <p className={STATE_MESSAGE_CLASS}>
            {packsError === GENERIC_ERROR
              ? t("state.error", "The point store could not load.")
              : packsError}
          </p>
          <Button
            variant="primary"
            size="none"
            className={STATE_CTA_SIZING}
            onClick={() => void loadPacks()}
          >
            {t("state.retry", "Try again")}
          </Button>
        </Card>
      </div>
    );
  }

  const inPurchaseStep = Boolean(purchaseParam);

  return (
    <div className={WRAP_CLASS}>
      <header className={HEAD_CLASS}>
        <div>
          <span className={KICKER_CLASS}>{t("kicker", "Point Store")}</span>
          <h1 className={TITLE_CLASS}>{t("title", "Add Points")}</h1>
        </div>
        <Link href="/account/transactions" className={CROSS_LINK_CLASS}>
          {t("ledgerLink", "View point ledger")} →
        </Link>
      </header>

      {inPurchaseStep ? (
        purchaseLoading || !purchase ? (
          <div className={STATE_CLASS}>
            {actionError ? (
              <Card as="div" padding="md" className={STATE_CARD_SIZING}>
                <p className={STATE_MESSAGE_CLASS}>{actionError}</p>
                <Button
                  variant="primary"
                  size="none"
                  className={STATE_CTA_SIZING}
                  onClick={() => backToBrowse()}
                >
                  {t("result.backToStore", "Back to store")}
                </Button>
              </Card>
            ) : (
              <TapDot
                label={t("state.loadingPurchase", "Checking your order…")}
              />
            )}
          </div>
        ) : (
          <div className={GRID_CLASS}>
            <div>
              {actionError ? (
                <div className={ERROR_NOTE_CLASS} role="alert">
                  {actionError}
                </div>
              ) : null}
              {purchase.status === "pending_payment" && !awaitingDelayed ? (
                <DemoCheckout
                  purchase={purchase}
                  processing={confirming}
                  onOutcome={(outcome) => void handleOutcome(outcome)}
                />
              ) : purchase.status === "pending_payment" ? (
                <PurchasePending
                  checking={checking}
                  onCheckStatus={() => void handleCheckStatus()}
                />
              ) : purchase.status === "completed" ? (
                <PurchaseSuccess
                  purchase={purchase}
                  newBalance={newBalance}
                  returnPath={safeReturn}
                  onBackToStore={() => backToBrowse()}
                />
              ) : purchase.status === "failed" ? (
                <PurchaseFailed
                  purchase={purchase}
                  retrying={creating}
                  onRetry={() => void handleRetry()}
                  onBackToStore={() => backToBrowse(purchase.packId)}
                />
              ) : (
                <PurchaseCanceled
                  onBackToSummary={() => backToBrowse(purchase.packId)}
                />
              )}
            </div>
            <div className={SIDE_COL_CLASS}>
              <OrderSummary
                order={{
                  packName:
                    packs.find((p) => p.id === purchase.packId)?.name ??
                    purchase.packId,
                  basePoints: purchase.basePoints,
                  bonusPoints: purchase.bonusPoints,
                  totalPoints: purchase.totalPoints,
                  priceUsdCents: purchase.priceUsdCents,
                  status: purchase.status,
                }}
              />
              <HowPointsWork />
            </div>
          </div>
        )
      ) : (
        <div className={GRID_CLASS}>
          <div>
            <PackGrid
              packs={packs}
              selectedPackId={selectedPackId}
              onSelect={setSelectedPackId}
            />
            {firstPurchase ? (
              <p className={FIRST_PURCHASE_CLASS}>
                {t(
                  "packs.firstPurchase",
                  "This would be your first point pack purchase.",
                )}
              </p>
            ) : null}
          </div>
          <div className={SIDE_COL_CLASS}>
            {selectedPack ? (
              <OrderSummary
                order={{
                  packName: selectedPack.name,
                  basePoints: selectedPack.basePoints,
                  bonusPoints: selectedPack.bonusPoints,
                  totalPoints: selectedPack.totalPoints,
                  priceUsdCents: selectedPack.priceUsdCents,
                }}
              >
                {actionError ? (
                  <div className={`${ERROR_NOTE_CLASS} mt-3.5`} role="alert">
                    {actionError}
                  </div>
                ) : null}
                <Button
                  variant="cta"
                  size="none"
                  className="mt-4"
                  data-testid="store-continue"
                  disabled={creating}
                  onClick={() => void handleContinue()}
                >
                  {creating
                    ? t("checkout.processing", "Processing…")
                    : t("summary.continue", "Continue to checkout")}
                </Button>
              </OrderSummary>
            ) : null}
            <HowPointsWork />
          </div>
        </div>
      )}
    </div>
  );
}

function HowPointsWork() {
  const { t } = useTranslation("store");
  return (
    <aside
      className={HOW_CARD_CLASS}
      aria-label={t("how.title", "How points work")}
    >
      <h3 className={HOW_TITLE_CLASS}>{t("how.title", "How points work")}</h3>
      <p className={HOW_BODY_CLASS}>
        {t(
          "how.body",
          "Point packs add non-redeemable gameplay points to your balance for predictions on Tap Trade. Points are play credits only — they carry no cash value, and there is no cash-out, transfer, or conversion of any kind.",
        )}
      </p>
    </aside>
  );
}
