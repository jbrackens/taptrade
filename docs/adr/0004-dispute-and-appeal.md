# ADR-0004: Dispute & appeal mechanism (resolution finality with recourse)

**Status:** Accepted — implemented 2026-05-22 (`d5984b82` gateway, `2d3bacb4` office dispute-review queue)
**Date:** 2026-05-22
**Deciders:** Eng lead, John (CEO), compliance/legal

**Implemented in:**
- `gateway/migrations/023_resolution_proposals_disputes.sql` — tables `prediction_resolution_proposals` and `prediction_disputes`.
- `gateway/internal/prediction/resolution.go` — `ResolutionProposal` (with `ChallengeEndsAt`), `Dispute`, and `ListFinalizableProposals`. Payouts are credited only at `FinalizeResolution`, not at proposal time.
- `gateway/internal/prediction/lifecycle.go` + `types.go` — Option A shipped: the FSM gained `proposed_resolution` and `disputed`. `closed → proposed_resolution → settled | disputed | voided`, `disputed → settled | voided`. `closed → settled` is still permitted for immediate finalize / backward compatibility.
- `gateway/internal/http/admin_dispute_handlers.go` — admin dispute routes.
- `office/app/(dashboard)/disputes/page.tsx` — the admin review queue.

> Source: production-readiness audit (2026-05-22). Depends on [ADR-0003](./0003-resolution-source-architecture.md). See [README](./README.md).

## Context

*(State as of 2026-05-22, before the fix — kept as the historical record.)*

The market FSM (`gateway/internal/prediction/lifecycle.go:6–14`) is `unopened → open → halted → closed → settled/voided` — there is **no `disputed` state**. `settlement.go` `ResolveMarket` resolves and **atomically credits payouts immediately and irreversibly** (winners 100¢/contract). The only recourse is an admin `override_reason`; there is **no user-facing dispute/appeal**.

For a value-bearing market, finality without recourse is a trust and (likely) regulatory problem, and once funds are paid (and potentially withdrawn) reversal is impractical.

Path shorthand: `gateway` = `apps/taptrade-platform/go-platform/services/gateway`.

## Decision

Introduce a **resolution lifecycle with a challenge window** and a dispute branch:

```
closed → proposed_resolution → (challenge window) → settled
proposed_resolution / disputed → admin review → settled | voided
```

**Hold payouts during the window.** Add a user-facing dispute submission + status, backed by a new goose migration (`023`).

## Options Considered

### Option A: Pre-settlement challenge window (hold payouts until finalized) *(Recommended)*
| Dimension | Assessment |
|-----------|------------|
| Complexity | Med–High (FSM + settlement split) |
| Money safety | High (no clawbacks — funds not yet paid) |
| UX | Slight payout delay (e.g., 1–24h) |
| Auditability | High |

**Pros:** no clawbacks; clean integrity story; composes with ADR-0003's proposal step.
**Cons:** delayed payouts; settlement engine must support hold→finalize.

### Option B: Post-settlement dispute with clawback/reversal — **Rejected for money-bearing**
**Pros:** instant payouts.
**Cons:** clawbacks are often impossible once funds are withdrawn; corrosive to trust.

### Option C: Off-platform manual dispute (support email → admin void/re-settle)
**Pros:** minimal build.
**Cons:** opaque, unauditable, no SLA, doesn't scale. *Interim stopgap only.*

## Trade-off Analysis

Option A trades a bounded **payout latency** for **integrity and the elimination of clawbacks**, and reuses the proposal seam from ADR-0003. Window length is a business dial (shorter = better UX, longer = safer); make it per-category.

## Consequences

- **Easier:** credible finality with recourse; auditable resolution trail; stronger regulatory posture.
- **Harder:** settlement becomes two-phase (propose → finalize); new states/tables/UI; ledger must distinguish **held vs paid**.
- **Revisit:** anti-abuse (dispute bond/stake), arbitration/escalation tiers, SLAs.

## Action Items

1. [ ] Extend `MarketStatus` FSM (`lifecycle.go`) with `proposed_resolution` and `disputed` + valid transitions; update `lifecycle_test.go`.
2. [ ] Migration `023_*.sql`: `resolution_proposals`, `disputes` tables + FSM/timestamp columns + CHECK constraints (append-only; do not edit 014/019).
3. [ ] Split `settlement.go` `ResolveMarket` into **`ProposeResolution`** and **`FinalizeResolution`** (idempotent); enforce the challenge window in `AutoSettler` (`workers/settler.go`).
4. [ ] Payout-hold accounting: settlement credits move only at **finalize**; reflect "pending settlement" in wallet/portfolio.
5. [ ] Dispute API: `POST /api/v1/disputes` (authenticated, **rate-limited**, eligibility = holds a position in the market) + `GET` status; **block finalize while an open dispute exists**.
6. [ ] Office **dispute-review queue** (dual-control with ADR-0003); decision = uphold/settle/void with reason + attestation.
7. [ ] Notifications on proposed-result, dispute filed, and finalize.
8. [ ] Tests: FSM transitions, finalize idempotency, "open dispute blocks finalize," challenge-window expiry auto-finalize.

## Status update (2026-09-29)

Every action item above is implemented, although the checkboxes were never
ticked: the FSM states (`gateway/internal/prediction/lifecycle.go`), migration
023, the split propose/finalize path with payouts held until finalize, the
dispute API (`POST /api/v1/disputes`, `POST /api/v1/admin/disputes/{id}/resolve`),
dual control (finalizer and dispute reviewer must differ from the proposer,
`gateway/internal/prediction/settlement.go`), and the office review queue
(`office/app/(dashboard)/disputes/`). The default challenge window is one hour
(`prediction.DefaultChallengeWindow`); per-category windows were never set.
