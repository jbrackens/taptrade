# ADR-0010: Points-only, non-redeemable launch boundary (supersedes the custodial USDC cashier / crypto-native launch)

**Status:** Accepted — live since 2026-07-07; supersession of the prior crypto-native posture recorded 2026-09-06. **Supersedes:** the archived cashier workstream's V1/V2 custodial-USDC decision (`docs/archive/cashier/README.md`, "Custody decision update (founder-confirmed 2026-05-27)") and its V3 non-custodial target — see the four archived ADRs listed under Related.
**Date:** Launch-model switch: 2026-07-07 (`docs/compliance/geofencing-kyc.md`, migration `050`). Supersession note written: 2026-09-06.
**Deciders:** Not individually named beyond "owner-directed" (migration `050` header) and "founder-confirmed" (the earlier, now-reversed custodial decision).

> **Scope:** the decision that Tap Trade launches on non-redeemable Points
> with no deposit, withdrawal or redemption path, and that this reverses
> the project's earlier crypto-native / custodial-cashier launch posture.
> **Authoritative for:** the launch-boundary decision itself.
> **Not for:** the unit rename mechanics ([ADR-0009](./0009-points-unit-model.md)) or the later merge-but-dark disposition of the cashier code ([ADR-0012](./0012-cashier-merged-dark-behind-flags.md)).

## Context

The project's launch posture went through (at least) three recorded
stances, each superseding the last:

1. **Non-custodial cashier boundary** (`docs/archive/cashier/adrs/ADR-001-non-custodial-cashier-boundary.md`, 2026-05-25): "TapTrade originally explored a custodial BSC cashier... The product direction has changed back to a Polymarket-like posture: users should control their funds through an EVM wallet." Status: superseded 2026-09-06, "reversed by the 2026-05-27 custodial decision."
2. **Custodial USDC cashier for V1/V2** (`docs/archive/cashier/README.md`, "Custody decision update (founder-confirmed 2026-05-27)"): "custodial for V1/V2, non-custodial deferred to V3" — users fund from MetaMask, send USDC to a TapTrade-controlled treasury, credited to an internal wallet ledger.
3. **Points-only, non-redeemable** (this ADR, live 2026-07-07): no deposit, no withdrawal, no redemption, no on-chain settlement of any kind.

`docs/archive/cashier/README.md`'s supersession note (2026-09-06, at the top
of the document) states what changed and where it is enforced:

> What superseded it: the product moved to non-redeemable points. There is
> no deposit, no withdrawal, no redemption and no on-chain settlement.

`docs/compliance/geofencing-kyc.md` independently confirms the same date
and adds why the document needed correcting: "This document was written
against a 'crypto-native, outside-US' launch. That posture was reversed.
Since 2026-07-07 the launch model is a non-redeemable Points economy."

## Decision and scope

Launch with Points as the only unit of account: non-redeemable, no cash-out,
no crypto rail. One money-in path exists and is separate from the retired
cashier — the point store (`/api/v1/store/*`, `STORE_ENABLED`, migration
`051_store_point_packs.sql`, landed 2026-07-12 per `STORE_AND_PAYMENTS.md`)
sells point packs for a USD price, closed-loop: money in, non-redeemable
points out, no cash-out ever.

Enforcement is boot-time and route-level, in `gateway/internal/http/launch_boundary.go`
and `cmd/gateway/main.go`:
- `TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED` (default off) is the single switch that mounts the legacy deposit/withdrawal/payments-webhook/provider-callback trees and the alpha cashier; setting it `true` when `ENVIRONMENT=production|staging` is a boot error.
- `ALPHA_CASHIER_ENABLED=true` is likewise a boot error in production/staging.
- `CRYPTO_RPC_URL`, `CRYPTO_ASSET_CONTRACT`, `CRYPTO_DEPOSIT_ADDRESS_SOURCE` must be unset — any non-empty value refuses boot in production/staging.
- `/api/v1/status` reports `pointMode: "non_redeemable_points"`.
- `internal/compliance/launch_safety.go` redacts "crypto", "deposit", "withdraw", "cash", "payout", "money", "redeem" from user-visible copy.

## Alternatives considered

Recorded only for the *prior* decisions this one reverses, not for the
points-only launch itself:
- The non-custodial EVM-wallet posture (superseded ADR-001) was itself reversed by the custodial-USDC decision before the points-only decision reversed that in turn.
- The custodial-USDC V1/V2 plan (`docs/archive/cashier/README.md`) recorded a full alternatives analysis for *how* to run a crypto cashier (Tron intake vs. EVM settlement, Relay vs. Symbiosis vs. LI.FI vs. deBridge for deposits, Polygon vs. BSC for settlement — see the four archived ADRs).
- **Not recorded:** why points-only (vs., say, keeping the custodial cashier but hardening it, or pursuing a different real-money model) was chosen over continuing either crypto posture. No document weighs "stay crypto-native" against "go points-only."

## Rationale and trade-offs

Not recorded in causal form (no document says "we chose points-only
because X, trading off Y"). What is recorded is the *jurisdictional*
framing after the fact: `docs/compliance/geofencing-kyc.md` notes "With no
withdrawal and no redemption, the travel-rule and money-transmission
questions that prompted this item do not arise in the same form." That is
evidence of a consequence of the decision (simpler compliance posture), not
a stated reason for making it. `docs/adr/README.md`'s "Open questions...
where they landed" section states the launch-model question was "Answered"
by this switch but likewise does not record the deliberation, only the
outcome.

## Consequences and constraints

- **Verified at `4924a670`:** `gateway/internal/http/launch_boundary.go` and the boot-refusal logic in `cmd/gateway/main.go` are present and match the description above (also independently confirmed via `docs/archive/cashier/README.md`'s own line-numbered citations as of its 2026-09-06 writing — not re-verified line-by-line in the 2026-09-29 documentation review).
- `internal/payments/`, `internal/alphacashier/`, and the root-level `contracts/`, `packages/cashier-sdk/`, `services/{cashier-api,bridge-watcher,relayer}` remain in the repository as the dormant real-money workstream, validated only by `make cashier-check`, not deployed (`CLAUDE.md`, "Points-only launch boundary").
- The four archived cashier ADRs (non-custodial boundary, Tron provider shortlist, embedded-wallet shortlist, settlement-chain shortlist) are permanently moot: none of their open decisions (settlement chain, deposit provider, wallet provider) will be made under this posture, per each ADR's own "ARCHIVED 2026-09-06" banner.
- This decision is a precondition for [ADR-0012](./0012-cashier-merged-dark-behind-flags.md) (the 2026-09-29 decision to merge cashier code but keep it flag-gated off): the points-only boundary is what the flag gate sits behind.
- **Open question:** the jurisdiction allowlist and geo source-of-truth questions in `docs/compliance/geofencing-kyc.md` remain unresolved ("Still blocking — needed before `GEO_GATE_ENABLED=true` in production") — not answered by this ADR and not evaluated further here.

## Evidence

- `docs/archive/cashier/README.md` — top-of-file "ARCHIVED 2026-09-06" banner and supersession note.
- `docs/compliance/geofencing-kyc.md` — "Launch-posture correction (2026-09-06)" note, confirming the 2026-07-07 switch date.
- `gateway/migrations/050_points_unit_model.sql` — the 2026-07-07 unit-model change underpinning this posture (see [ADR-0009](./0009-points-unit-model.md)).
- `gateway/internal/http/launch_boundary.go`, `cmd/gateway/main.go` — boot-refusal enforcement.
- `STORE_AND_PAYMENTS.md` — the point store's closed-loop money-in path, landed 2026-07-12.
- `docs/archive/cashier/adrs/ADR-001..004` — the two superseded prior postures (non-custodial, then custodial) and their own open-decision shortlists, now moot.
- `docs/adr/README.md` — "Open questions from the 2026-05-22 audit — where they landed," item 1.

## Related

- [ADR-0009](./0009-points-unit-model.md) — the unit rename this posture depends on.
- [ADR-0012](./0012-cashier-merged-dark-behind-flags.md) — the 2026-09-29 decision on what to do with the dormant cashier code under this boundary.
- `docs/archive/cashier/adrs/ADR-001-non-custodial-cashier-boundary.md`, `ADR-002-tron-deposit-provider-shortlist.md`, `ADR-003-embedded-wallet-and-smart-account-shortlist.md`, `ADR-004-settlement-chain-shortlist.md` — superseded by this decision.
