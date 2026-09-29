> **Abandoned workstream — specification only.** `services/cashier-api/` is not a running
> service and this document describes nothing that exists. The product moved to
> non-redeemable points; the gateway's cashier, crypto and payment routes are
> unmounted by default and refuse to boot in production or staging. See
> `services/cashier-api/README.md` for why this tree is still in the repository, and
> `docs/archive/cashier/` for the design record.

# Recovery API Contract

**Status:** SUPERSEDED 2026-09-06 — abandoned workstream (was: "Draft.").
**Date:** 2026-05-25.

Recovery APIs are internal/operator-only. They must not ship without operator auth,
role checks, immutable audit logging, and two-person approval above beta caps.

## `GET /v1/admin/recovery-cases`

Filters:

- `status`
- `reason`
- `userId`
- `depositIntentId`
- `sourceTxHash`
- `providerRequestId`

## `POST /v1/admin/recovery-cases/:id/decisions`

Required body:

- decision: `settle_to_smart_wallet`, `refund_to_user_controlled_address`,
  `quarantine`, `deny`
- evidence hash
- operator note
- destination address when refunding

Rules:

- No screenshot-only decisions.
- Refund destination must be user-controlled.
- CEX source-address refunds are denied unless ownership is proven.
- Two-person review above cap.
- Every decision writes `compliance_decisions` and `cashier_audit_events`.

## `POST /v1/admin/recovery-cases/:id/retry-provider` — NOT IMPLEMENTED

No handler exists for this operation in `services/cashier-api/src/handlers.mjs`.
Documented here as a future requirement only: when built, it must re-fetch
provider status and write bridge events only through the normal watcher state
machine, and it must not directly mutate balances.

## `POST /v1/admin/recovery-cases/:id/retry-chain-evidence` — NOT IMPLEMENTED

No handler exists for this operation in `services/cashier-api/src/handlers.mjs`.
Documented here as a future requirement only: when built, it must re-fetch
source/destination chain evidence and write bridge events only through the
normal watcher state machine, and it must not directly mutate balances.
