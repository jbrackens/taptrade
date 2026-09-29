"use client";

/**
 * /cashier — the crypto cashier (FEATURE_CASHIER_UI; 404 when off, which is
 * every deploy today, the demo included). Merged from feat/hula-na-cashier
 * on 2026-09-29 without its pre-fork sportsbook cashier (USD card/bank
 * methods, cheque payouts, casino-cage copy): only the fail-closed crypto
 * deposit card came across, reading the gateway's alpha cashier.
 */

import { notFound } from "next/navigation";
import CryptoDepositCard from "../components/cashier/CryptoDepositCard";
import { FEATURE_CASHIER_UI } from "../lib/features";

export default function CashierPage() {
  if (!FEATURE_CASHIER_UI) notFound();
  return (
    <div className="mx-auto w-full max-w-[640px] px-4 py-8">
      <CryptoDepositCard />
    </div>
  );
}
