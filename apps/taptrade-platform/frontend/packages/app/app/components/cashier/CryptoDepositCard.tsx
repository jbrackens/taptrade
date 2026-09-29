"use client";

/**
 * CryptoDepositCard — the crypto cashier's deposit card (FEATURE_CASHIER_UI),
 * ported from feat/hula-na-cashier (2026-09-29) onto the gateway's alpha
 * cashier. Fail-closed like the original: nothing about a deposit is shown
 * until the gateway reports the rail enabled, and a missing or disabled rail
 * reads "not available", never a zero balance or an enabled button.
 *
 * Copy is inline English on purpose: money vocabulary never goes in the
 * locale files (the points-only boundary), like the landing page's legal
 * lines. There is no deposit action here yet: deposits need wallet
 * connection, which the app does not have (FEATURE_MANIFEST: STUBBED).
 */

import { useCallback, useEffect, useState } from "react";
import { WalletIcon as Wallet } from "@phosphor-icons/react/dist/csr/Wallet";
import { WarningCircleIcon as WarningCircle } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { ApiError } from "../../lib/api/client";
import {
  type AlphaCashierConfig,
  getAlphaCashierConfig,
} from "../../lib/api/cashier-client";
import { logger } from "../../lib/logger";

type LoadState = "loading" | "unavailable" | "ready" | "error";

const COPY = {
  title: "Crypto deposits",
  loading: "Checking crypto deposits…",
  unavailable: "Crypto deposits aren't available here.",
  error: "Crypto deposits couldn't be checked. Try again.",
  retry: "Try again",
  network: "Network",
  token: "Token",
  treasury: "Deposit address",
  confirmations: "Confirmations",
  limits: "Per deposit",
  walletNeeded:
    "Deposits are sent from a wallet you connect and verify. Wallet connection isn't available in the app yet.",
} as const;

const CARD_CLASS =
  "rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] p-6 shadow-[var(--shadow-card)] max-[640px]:p-4";
const ROW_CLASS = "flex items-start justify-between gap-4 py-2.5 text-[14px]";

function formatUnits(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function CryptoDepositCard() {
  const [state, setState] = useState<LoadState>("loading");
  const [config, setConfig] = useState<AlphaCashierConfig | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const cfg = await getAlphaCashierConfig();
      setConfig(cfg);
      setState(cfg.enabled ? "ready" : "unavailable");
    } catch (err: unknown) {
      // 404 (routes unmounted) and 403 (rail disabled) mean "not here".
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
        setState("unavailable");
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      logger.error("CryptoDeposit", "Failed to load the crypto cashier", message);
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className={CARD_CLASS} aria-labelledby="crypto-deposit-title">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-[var(--r-rh-md)] bg-[var(--surface-2)] text-[var(--t1)]" aria-hidden="true">
          <Wallet size={22} weight="duotone" />
        </span>
        <h2 id="crypto-deposit-title" className="m-0 text-[18px] font-semibold text-[var(--t1)]">
          {COPY.title}
        </h2>
      </div>

      {state === "loading" && (
        <p className="m-0 mt-4 text-[14px] text-[var(--t3)]" role="status">
          {COPY.loading}
        </p>
      )}

      {state === "unavailable" && (
        <p className="m-0 mt-4 text-[14px] text-[var(--t2)]">{COPY.unavailable}</p>
      )}

      {state === "error" && (
        <div className="mt-4 flex flex-wrap items-center gap-3" role="alert">
          <WarningCircle size={18} className="text-[var(--danger)]" aria-hidden="true" />
          <span className="text-[14px] text-[var(--t2)]">{COPY.error}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex min-h-11 cursor-pointer items-center rounded-[var(--r-rh-md)] border border-[var(--border-2)] bg-[var(--surface-1)] px-4 text-[14px] font-semibold text-[var(--t1)]"
          >
            {COPY.retry}
          </button>
        </div>
      )}

      {state === "ready" && config && (
        <>
          <dl className="m-0 mt-4 divide-y divide-[var(--border-1)]">
            <div className={ROW_CLASS}>
              <dt className="text-[var(--t3)]">{COPY.network}</dt>
              <dd className="m-0 font-medium text-[var(--t1)]">{config.chainName}</dd>
            </div>
            <div className={ROW_CLASS}>
              <dt className="text-[var(--t3)]">{COPY.token}</dt>
              <dd className="m-0 font-medium text-[var(--t1)]">{config.tokenSymbol}</dd>
            </div>
            <div className={ROW_CLASS}>
              <dt className="text-[var(--t3)]">{COPY.treasury}</dt>
              <dd className="m-0 break-all text-right font-mono text-[13px] text-[var(--t1)]">
                {config.treasuryAddress}
              </dd>
            </div>
            <div className={ROW_CLASS}>
              <dt className="text-[var(--t3)]">{COPY.confirmations}</dt>
              <dd className="m-0 font-medium tabular-nums text-[var(--t1)]">{config.confirmations}</dd>
            </div>
            <div className={ROW_CLASS}>
              <dt className="text-[var(--t3)]">{COPY.limits}</dt>
              <dd className="m-0 font-medium tabular-nums text-[var(--t1)]">
                {formatUnits(config.minDepositCents)} – {formatUnits(config.maxDepositCents)} {config.tokenSymbol}
              </dd>
            </div>
          </dl>
          <p className="m-0 mt-4 text-[13px] leading-[1.5] text-[var(--t2)]">{COPY.walletNeeded}</p>
        </>
      )}
    </section>
  );
}
