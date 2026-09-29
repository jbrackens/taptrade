> **ARCHIVED 2026-09-06.** Historical record only — this does not describe the current system.
> Superseded by the points-only launch — see the supersession note below for what replaced this workstream and where the boot refusal is enforced.
> See `CLAUDE.md` for current architecture.

> **Update 2026-09-29.** `feat/hula-na-cashier` was merged into `main` behind
> flags, so two statements below are no longer literal: the player app now has
> one cashier route, `/cashier`, and one cashier client,
> `app/lib/api/cashier-client.ts` (read-only, `GET /api/v1/cashier/alpha/config`).
> The page 404s unless `NEXT_PUBLIC_FEATURE_CASHIER_UI=true`, no deploy sets
> it, and `qa-regressions-2026-04-18.test.ts` and `cashier-flag.test.ts` pin
> both. The rail itself stays unmounted by the boot refusals described here.
> See the "Points-only launch boundary" section of `CLAUDE.md`.

# TapTrade Cashier — design & decision record

**Status:** SUPERSEDED 2026-09-06 — abandoned workstream (was: "Architecture timeline updated 2026-05-27.").
**Owner:** John Brackens.
**Decision (historical):** V1/V2 use a custodial USDC cashier; non-custodial cashier/settlement moves to V3.

## Why this whole directory is archived

This directory is the design and decision record of the TapTrade cashier and
crypto workstream. The workstream is **abandoned**, not paused. Every document
below is retained for the reasoning it captures; none of it describes a system
that exists.

What superseded it: the product moved to **non-redeemable points**. There is no
deposit, no withdrawal, no redemption and no on-chain settlement. Points are
whole integers (a contract priced at 8 costs 8 Points, a correct contract
settles at 100 Points) and cannot be converted back to money. Migration
`050_points_unit_model.sql` renamed every `*_cents` column in the active economy
to `*_points`, and the compliance and wallet APIs report the unit as `PTS`.

Where that is enforced in code, as of 2026-09-06:

- `apps/taptrade-platform/go-platform/services/gateway/internal/http/handlers.go:162`
  — `GET /api/v1/status` advertises `"pointMode": "non_redeemable_points"`.
- `.../internal/http/launch_boundary.go` — the cashier, crypto and payment route
  trees are gated on `TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED`, which defaults to
  off. With the flag unset, `handlers.go:456` (alpha cashier) and
  `handlers.go:569` (payments + crypto rail) register nothing and log
  "legacy money routes disabled for TapTrade launch".
- `.../cmd/gateway/main.go:354` — the gateway **refuses to boot** if
  `TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED=true` when `ENVIRONMENT` is
  `production` or `staging`.
- `.../cmd/gateway/main.go:358` — the gateway **refuses to boot** if
  `ALPHA_CASHIER_ENABLED=true` in those environments, because "TapTrade launch
  is points-only with no crypto cashier rail".
- `.../internal/http/launch_boundary_test.go` —
  `TestLegacyMoneyRoutesAreAbsentByDefault` asserts 404 on every
  `/api/v1/cashier/alpha/*`, `/api/v1/admin/cashier/alpha/*` and
  `/api/v1/payments/*` route with the flag unset.
- `apps/taptrade-platform/frontend/packages/office/proxy.ts` — the backoffice
  404s `/cashier`, `/deposit`, `/withdraw` and their siblings before auth.
- `apps/taptrade-platform/frontend/packages/app/app/__tests__/qa-regressions-2026-04-18.test.ts`
  — the player app has no cashier route, no cashier component and no cashier or
  crypto API client, and a test fails if any of them come back.

Consequences for anyone reading these documents:

- The launch blockers will not be cleared. No provider, wallet stack or
  settlement chain was ever selected, and none will be under a points-only
  product.
- The operator checklists cannot be executed. The backoffice `/cashier` page
  they open no longer exists.
- `make cashier-check` still passes, and that is not evidence of readiness. The
  guard scripts were retargeted to assert the cashier's *absence* from the
  player app; the fixture and schema checks only prove the archived artifacts
  are internally consistent.

The scaffolding this record refers to — `contracts/`, `packages/cashier-sdk/`,
`services/cashier-api/`, `services/bridge-watcher/`, `services/relayer/` — is
still in the repository but is not wired into any build or deployment. See each
tree's README.

> **Update 2026-05-27:** Non-custodial cashier/settlement is now deferred to
> **V3**. The closed Alpha and Beta execution path is custodial USDC funded from
> MetaMask into a TapTrade-controlled treasury and credited to the internal wallet
> ledger. The non-custodial material below remains useful as the V3 strategy
> record, but it is no longer the V1/V2 implementation target. See
> [Closed Alpha custodial USDC cashier plan](./CUSTODIAL_USDC_ALPHA_PLAN.md).

---

## TL;DR

TapTrade Cashier V1/V2 should launch with the simplest credible crypto-native rail:
users fund from MetaMask, send USDC to a TapTrade-controlled treasury, and receive an
internal TapTrade wallet balance after server-side chain verification. This lets the
closed Alpha and Beta test real prediction-market workflows without waiting for a
PSP, bridge provider, smart-wallet stack, or Polymarket-style settlement layer.

The Polymarket-like direction still matters, but it is now a **V3** track:
non-custodial smart wallets, gas abstraction, tokenized positions, and on-chain
settlement should be revisited after the custodial cashier is operating safely.

**Custody decision update (founder-confirmed 2026-05-27): custodial for V1/V2,
non-custodial deferred to V3.** Custodial code may be wired for closed Alpha and
Beta only when it is feature-flagged, low-limit, ledger-backed, chain-verified,
manually reconciled, and operationally reviewed.

---

## V3 Target Architecture

The remainder of this section records the V3 non-custodial target. It is not the
V1/V2 implementation plan.

### Core shape

1. User signs in with email or connects an external wallet.
2. TapTrade creates or resolves the user's non-custodial EVM smart wallet.
3. User deposits from one of several source rails.
4. Bridge/onramp converts source funds into on-chain USD collateral controlled by
   the user's smart wallet.
5. Markets spend that collateral through signed, gas-sponsored user actions.
6. Withdrawals return funds from the user's smart wallet to a supported external
   address.

### Settlement layer

Keep trading collateral on an EVM chain with mature wallet, account abstraction,
auditing, and market tooling. Final chain selection is still open, but the shortlist
is:

| Chain | Why consider it | Concern |
|---|---|---|
| Polygon | Closest to Polymarket, good USDC/pUSD precedent | SEA users often hold USDT, not Polygon USDC |
| BSC | Familiar to Binance/OKX users, USDT liquidity, low fees | Less Polymarket-like; noisier risk/compliance surface |
| Base / Arbitrum | Strong EVM infra and AA ecosystem | Less natural for Asian USDT users |

Default recommendation: **BSC or Polygon for V3 settlement, decided by bridge UX and
liquidity tests.** Do not settle markets directly on Tron.

### Funding rails

| Priority | Rail | Product role |
|---|---|---|
| P0 | TRC-20 USDT | Primary SEA/Maria deposit path |
| P0 | Direct EVM stablecoin deposit | Crypto-native path; BSC USDT or Polygon USDC depending on settlement chain |
| P1 | Polygon USDC/USDC.e | Polymarket-compatible funding path if settlement is not Polygon |
| P1 | Bridge-out to Tron | Withdrawal convenience; not required for first non-custodial V3 release |

---

## What We Reuse / Build / Drop

| Capability | Decision |
|---|---|
| Email sign-in | Use an embedded wallet provider or smart-wallet provider that supports email login and recovery. Thirdweb remains acceptable; Privy/Web3Auth can be evaluated. |
| External wallet sign-in | Keep wallet-connect style EVM support. TronLink is only needed for Tron-source flows if passive deposit addresses are not available. |
| Smart wallet | Build around a user-controlled EVM smart wallet: Safe, ERC-4337 account, or Polymarket-style proxy. |
| Internal collateral | Restore the original on-chain collateral concept (`hUSD`/pUSD-style). Markets should consume wallet-controlled collateral, not a custodial cents ledger. |
| Gas sponsorship | Restore relayer/paymaster/account-abstraction work. Users should not need BNB/MATIC/ETH. |
| TRC-20 deposit | Build as a bridge/deposit-address rail into the user's EVM wallet/collateral account. |
| BEP-20 or Polygon direct deposit | Keep as secondary direct deposit rail. |
| Existing Go wallet ledger | V1/V2 source of truth for custodial internal balances; V3 should demote it to mirror/reporting data if non-custodial settlement ships. |
| Existing Go crypto watcher | Treat as prototype/reference for finality, idempotency, and decimal tests. Do not ship it as the production cashier money path. |
| Custodial HD wallet / KMS sweeper | Out of Stage 1; evaluate in V2 only if manual withdrawals become too operationally heavy. |

---

## V3 Production Money-Path Requirements

These are V3 non-custodial requirements. The V1/V2 custodial requirements live in
[Closed Alpha custodial USDC cashier plan](./CUSTODIAL_USDC_ALPHA_PLAN.md).

1. **Non-custodial source of truth.** User funds must live in user-controlled smart
   wallets or protocol contracts, not TapTrade treasury addresses.
2. **Tron as intake, EVM as settlement.** TRC-20 USDT deposits bridge into the user's
   EVM smart wallet or collateral onramp. Tron is not the market execution layer.
3. **Passive deposit UX or no-go.** The Tron flow must be "show address, user sends
   USDT, balance appears." If a provider requires Maria to sign a multi-step bridge
   transaction in TronLink, that provider is not V3 material.
4. **Bridge attribution must be deterministic.** Every incoming bridge event must map
   to exactly one user wallet and one source transaction. Ambiguous deposits go to
   recovery, not credit.
5. **Finality and replay safety.** Deposits are detected, tracked, and credited once.
   Reorgs, duplicate webhooks, partial bridge fills, and failed swaps must not create
   double collateral.
6. **Decimals remain explicit.** TRC-20 USDT is 6 decimals. BSC USDT is 18 decimals.
   Polygon USDC/USDC.e commonly uses 6 decimals. Convert only at typed rail boundaries.
7. **Gasless user actions.** Wrap, trade, redeem, and withdraw flows are signed by the
   user and submitted by relayer/paymaster infrastructure.
8. **Sanctions and geo policy.** Screen source and destination addresses where
   possible. Define a freeze/recovery process for sanctioned inbound funds before
   mainnet.
9. **Recovery tool.** Unsupported-token and wrong-chain deposits need an explicit
   recovery path. Polymarket has one; TapTrade needs one before public launch.

---

## Current Repo State

The repo currently contains custodial wallet and payment primitives that are now
useful for V1/V2, plus non-custodial prototype artifacts that should remain V3
reference material:

- Go payment and wallet services with cents ledger accounting.
- `internal/payments` crypto deposit watcher that scans ERC-20 transfers.
- BSC USDT decimal conversion and idempotent deposit-credit tests.
- A fail-closed Next cashier card that can show a BSC deposit address.

Useful pieces to keep:

- Decimal test cases and conversion discipline.
- Finality/reorg/idempotency thinking.
- UI fail-closed posture.
- Server-proxied chain access pattern.

Pieces not suitable for Stage 1 closed Alpha:

- Per-user custodial deposit addresses controlled by TapTrade.
- KMS sweeper/withdrawal signer design.
- Legacy fiat/card cashier UI mixed with crypto deposit UX.

---

## V1/V2 Execution Plan

The immediate build target is the custodial USDC Alpha/Beta plan:

- Build the Alpha cashier in the Go gateway.
- Use MetaMask wallet ownership proof.
- Verify exact USDC ERC-20 transfers to the TapTrade treasury.
- Credit the existing wallet ledger idempotently.
- Keep withdrawals manual-review only in Stage 1.
- Add reconciliation and backoffice review before enabling real users.

See [Closed Alpha custodial USDC cashier plan](./CUSTODIAL_USDC_ALPHA_PLAN.md)
for the implementation checklist.

### V1/V2 Handoff And Environment

The active Stage 1 rail is the Go gateway `alphacashier` package and the
`ALPHA_CASHIER_*` environment contract. Do not configure the legacy
`CRYPTO_RPC_URL`, `CRYPTO_ASSET_CONTRACT`, or `CRYPTO_DEPOSIT_ADDRESS_SOURCE`
variables for the Alpha cashier; production startup still treats those as the
old prototype rail.

Committed samples keep `ALPHA_CASHIER_ENABLED=false`. A live Alpha deployment
must provide `ALPHA_CASHIER_RPC_URL`, `ALPHA_CASHIER_TOKEN_ADDRESS`, and
`ALPHA_CASHIER_TREASURY_ADDRESS`, keep `ALPHA_CASHIER_WITHDRAWALS_ENABLED=false`,
and keep `ALPHA_CASHIER_WITHDRAWAL_REVIEW_REQUIRED=true`.

Before turning on the rail, operators still need to choose the single live chain,
verify the USDC token contract from chain-native sources, create and label the
TapTrade treasury wallet, provision RPC secrets, run the `030_alpha_cashier.sql`
migration, run `GET /api/v1/admin/cashier/alpha/preflight`, and complete
deposit/replay/reconciliation smoke tests with a fake or test RPC.

## V3 Non-Custodial Planning

The previous non-custodial work should move to V3 planning. Do not block V1/V2 on
these spikes.

### Phase A — Select non-custodial stack

Run four spikes:

1. **Smart wallet spike:** Safe vs ERC-4337 account vs Polymarket-style proxy.
2. **Embedded wallet spike:** Thirdweb vs Privy vs Web3Auth for email recovery and
   EVM smart-wallet control.
3. **Tron deposit spike:** provider can generate passive per-user Tron deposit
   addresses and bridge into a target EVM address/collateral account.
4. **Settlement-chain spike:** compare Polygon and BSC on direct deposit UX,
   stablecoin liquidity, AA support, bridge support, and exchange withdrawal UX in PH/VN/ID.

Local TronGrid smoke check, once `TRONGRID_API_KEY` is available in your shell:

```bash
TRONGRID_API_KEY=... node scripts/check-trongrid-smoke.mjs
```

This validates authenticated TronGrid access and confirms TRC-20 USDT decimals
are 6 on Tron. Do not commit API keys; `.env*` files are ignored.

### Phase B — Build the V3 cashier package

Recommended repo shape once stack is selected:

```
contracts/                 # hUSD / collateral onramp / proxy or account factory
services/cashier-api/       # wallet resolution, deposit status, bridge callbacks
services/relayer/           # gas sponsorship and signed tx submission
services/bridge-watcher/    # Tron/EVM bridge tracking
packages/cashier-sdk/       # typed SDK consumed by markets app
apps/taptrade-platform/frontend/packages/app/app/cashier/
```

The existing Go gateway can consume the SDK during V3 migration, but the V3
cashier should not be implemented as a custodial extension of the legacy Go
payments package.

## Archived artifacts

- [Closed Alpha custodial USDC cashier plan](./CUSTODIAL_USDC_ALPHA_PLAN.md)
- [Phase 0-10 execution board](./PHASE_0_TO_10_EXECUTION_BOARD.md)
- [Non-custodial implementation kickoff](./NON_CUSTODIAL_IMPLEMENTATION_PLAN.md)
- [ADR-001: Non-custodial cashier boundary](./adrs/ADR-001-non-custodial-cashier-boundary.md)
- [ADR-002: Tron deposit provider shortlist](./adrs/ADR-002-tron-deposit-provider-shortlist.md)
- [ADR-003: Embedded wallet and smart account shortlist](./adrs/ADR-003-embedded-wallet-and-smart-account-shortlist.md)
- [ADR-004: Settlement chain shortlist](./adrs/ADR-004-settlement-chain-shortlist.md)
- [Testnet E2E acceptance](./TESTNET_E2E_ACCEPTANCE.md)
- [Recovery and support runbook](./RECOVERY_AND_SUPPORT_RUNBOOK.md)
- [Operator checklists](./OPERATOR_CHECKLISTS.md)
- [Compliance controls](./COMPLIANCE_CONTROLS.md)
- [Security threat model](./SECURITY_THREAT_MODEL.md)
- [Beta launch and reconciliation](./BETA_LAUNCH_AND_RECONCILIATION.md)
- [Launch blockers](./LAUNCH_BLOCKERS.md)
- [What remains](./WHAT_REMAINS.md)
- [Launch readiness matrix](./LAUNCH_READINESS_MATRIX.json)
- [Risk acceptance template](./RISK_ACCEPTANCE_TEMPLATE.md)
- [Provider spike transcript template](./PROVIDER_SPIKE_TRANSCRIPT_TEMPLATE.md)
- [Provider scorecard](./PROVIDER_SCORECARD.md)
- [Settlement chain scorecard](./SETTLEMENT_CHAIN_SCORECARD.md)
- [Wallet provider scorecard](./WALLET_PROVIDER_SCORECARD.md)
- [Mock E2E trace](./MOCK_E2E_TRACE.md)
- [Observability and canaries](./OBSERVABILITY_AND_CANARIES.md)
- [Incident response](./INCIDENT_RESPONSE.md)
- [Cashier API contract](../../../services/cashier-api/API_CONTRACT.md)
- [Recovery API contract](../../../services/cashier-api/RECOVERY_API_CONTRACT.md)
- [Cashier schema sketch](../../../services/cashier-api/SCHEMA.md)
- [Bridge watcher state machine](../../../services/bridge-watcher/STATE_MACHINE.md)
- [Provider adapter contract](../../../services/bridge-watcher/PROVIDER_ADAPTER_CONTRACT.md)
- [Relayer policy](../../../services/relayer/POLICY.md)
- [Cashier core SQL migration](../../../services/cashier-api/migrations/001_cashier_core.sql)
- [Cashier OpenAPI skeleton](../../../services/cashier-api/openapi.yaml)
- [Cashier SDK tests](../../../packages/cashier-sdk/test/cashier-sdk.test.mjs)
- [Cashier guard checks](../../../scripts/check-cashier-all.sh)
- [Provider scenario manifest](../../../services/bridge-watcher/fixtures/provider-scenarios.manifest.json)
- Gateway cashier domain package (`internal/cashier`): deleted 2026-09-29. Its webhook signature check and two-person rule survive, fixed, as the gateway's `internal/webhookauth` and `internal/approval`.
- [Alpha cashier gateway package](../../../apps/taptrade-platform/go-platform/services/gateway/internal/alphacashier)

Primary local check:

```bash
make cashier-check
```

---

## V3 Open Decisions

1. **Settlement chain:** Polygon vs BSC for V3.
2. **Collateral token:** `hUSD` wrapper vs provider-native pUSD-style accounting.
3. **Embedded wallet provider:** Thirdweb vs Privy vs Web3Auth.
4. **Smart wallet pattern:** Safe, ERC-4337 account, or Polymarket proxy fork.
5. **Bridge provider:** Symbiosis, Relay, deBridge, LI.FI, custom provider mix, or
   Polymarket-like bridge API pattern.
6. **Tron withdrawal:** V3 or fast-follow. Recommended: fast-follow unless bridge-out
   UX is simple and reliable.

---

## V3 Consequences

- More up-front engineering than custodial BSC.
- Lower custody and licensing burden than holding user funds.
- Closer to Polymarket's trust model.
- Better fit for users who care about getting funds back out without trusting TapTrade.
- Requires contract audits and relayer/paymaster hardening before mainnet.

This remains the right V3 shape if TapTrade wants to converge toward Polymarket's
trust model after proving the product with a custodial Alpha/Beta cashier.
