# Architecture Decision Records

ADR-0001 through ADR-0004 are the remediation ADRs from the production-readiness audit (2026-05-22) of the Tap Trade prediction exchange. ADR-0005 and ADR-0006 came later, out of the 2026-06 improvement plan. Each ADR is grounded in specific files in `apps/taptrade-platform`.

| ADR | Title | Priority | Status |
|-----|-------|----------|--------|
| [0001](./0001-backoffice-type-safety.md) | Eliminate backoffice type-unsafety (retire `ignoreBuildErrors`) | P1 | Accepted — implemented 2026-05-22 |
| [0002](./0002-authorization-hardening.md) | Authorization hardening for admin + wallet mutations | **P0** | Accepted — implemented 2026-05-22 |
| [0003](./0003-resolution-source-architecture.md) | Pluggable resolution-source (oracle) architecture | P1 | Accepted — implemented 2026-05-22 (narrower than sketched; see the ADR) |
| [0004](./0004-dispute-and-appeal.md) | Dispute & appeal mechanism (resolution finality with recourse) | P1 | Accepted — implemented 2026-05-22 |
| [0005](./0005-multi-tenancy-foundation.md) | Multi-tenancy foundation (tenant model for B2B) | P3 | Accepted 2026-06-13 — foundation applied (migration 037, dormant); epic steps 2-6 open |
| [0006](./0006-ledger-accounting-model.md) | Ledger accounting model (single-entry + reconciler vs. double-entry) | P2 | Proposed — awaiting owner decision |

## What shipped for 0001-0004

The 2026-05-22 sequencing plan that used to sit here is done and has been removed; it read as open work. The implementation pointers live in each ADR's header. In short:

- **0002** — `requireAdminRole` trusts only the validated session role (the `X-Admin-Role` fallback is deleted, with a regression test); there are no public wallet `/credit` or `/debit` routes; `GATEWAY_AUTH_ENABLED=false` is refused at boot in production/staging.
- **0001** — `office/next.config.js` sets `ignoreBuildErrors: false`.
- **0003** — the source registry and per-source health tracking ship (`internal/prediction/feed/`), surfaced at `GET /api/v1/admin/resolution-sources`. Launch policy is manual/admin attestation; automated adapters are opt-in and `Corroborator` has no implementation.
- **0004** — migration 023 adds `prediction_resolution_proposals` and `prediction_disputes`; the market FSM gained `proposed_resolution` and `disputed`; payouts credit at finalize, not at proposal; the office review queue is `office/app/(dashboard)/disputes/`.

**Cross-cutting rule (still current):** every privileged or points-moving action must write an audit log. ADR-0003 and ADR-0004 share one proposed-result → finalize seam.

## Open questions from the 2026-05-22 audit — where they landed

1. **Real-money vs play-money launch, and jurisdiction?** — **Answered.** The launch model is a non-redeemable points economy with no withdrawal and no redemption path (`docs/taptrade-economy-rules.md`, migration `050_points_unit_model.sql`). Value can enter — the point store sells packs for USD, closed-loop (`STORE_AND_PAYMENTS.md`, migration `051_store_point_packs.sql`) — but it cannot leave. The jurisdiction list itself is still open; see `docs/compliance/geofencing-kyc.md`.
2. **Is an HTTP wallet credit/debit API consumed by any client?** — **Answered.** No. The public routes were removed under ADR-0002; points move through the in-process `WalletAdapter` on the order and settlement paths, plus the admin-gated `/api/v1/admin/wallet/{credit,debit}`.
3. **Challenge-window length per category, and dispute eligibility/anti-abuse** — still open. The window mechanism exists (`ChallengeEndsAt`); the per-category policy does not.
4. **On-chain ambition?** — moot for the points launch. `cmd/gateway/main.go` refuses to boot in production with the legacy money routes or `ALPHA_CASHIER_ENABLED=true`, and `internal/compliance/launch_safety.go` redacts "crypto", "deposit", "withdraw" and the rest of the money vocabulary from user-visible copy.
