# Decisions

> **Scope:** the index of every architectural decision record — current,
> proposed and superseded — and where decisions recorded outside ADRs live.
> **Authoritative for:** which ADR governs a topic and the supersession chain.
> **Not for:** the content of each decision → follow the links; open decisions
> that block work → [TASKS.md](TASKS.md#needs-a-decision).
> **Last verified:** 2026-09-29 at commit `4924a670` — ADRs 0001–0013, the
> archived cashier ADRs, and the status claims of 0001–0006 against the code.

## Index

| ADR | Title | Status | Date | Supersedes / superseded by | Related |
|---|---|---|---|---|---|
| [0001](adr/0001-backoffice-type-safety.md) | Eliminate backoffice type-unsafety (`ignoreBuildErrors`) | Accepted — implemented 2026-05-22 | 2026-05-22 | — | `office/next.config.js` |
| [0002](adr/0002-authorization-hardening.md) | Authorization hardening for admin + wallet mutations | Accepted — implemented 2026-05-22 | 2026-05-22 | — | `gateway/internal/http/admin_handlers.go` |
| [0003](adr/0003-resolution-source-architecture.md) | Pluggable resolution-source (oracle) architecture | Accepted — implemented 2026-05-22 (narrower than sketched) | 2026-05-22 | — | ADR-0004 |
| [0004](adr/0004-dispute-and-appeal.md) | Dispute & appeal mechanism | Accepted — implemented 2026-05-22 | 2026-05-22 | — | ADR-0003 |
| [0005](adr/0005-multi-tenancy-foundation.md) | Multi-tenancy foundation (tenant model for B2B) | Accepted 2026-06-13 — migration 037 applied; tenant context package added 2026-06-13 (`2d927739`) but wired only in the auth-disabled chain; steps 1b and 3–6 not started (status update 2026-09-29) | 2026-06-13 | — | migration 037, `internal/tenant` |
| [0006](adr/0006-ledger-accounting-model.md) | Ledger accounting model (single-entry + reconciler vs. double-entry) | Proposed — awaiting owner decision | 2026-06-13 | — | `internal/prediction/workers/reconciler.go` |
| [0007](adr/0007-fork-from-sportsbook-to-prediction-market.md) | Fork from Taya Na Sportsbook to a prediction-market domain | Accepted (historical) | 2026-04-16 | — | ADR-0008, ADR-0009, ADR-0010 |
| [0008](adr/0008-clob-execution-replaces-amm.md) | Order-book (CLOB) execution replaces AMM execution | Accepted — implemented 2026-06-13 (partly: CHECK constraint not yet tightened) | 2026-06-13 | Narrows ADR-0007's launch AMM | ADR-0007 |
| [0009](adr/0009-points-unit-model.md) | Points unit model (`*_cents` → `*_points`) | Accepted — implemented 2026-07-07 | 2026-07-07 | — | ADR-0010, `docs/taptrade-economy-rules.md` |
| [0010](adr/0010-points-only-non-redeemable-launch-boundary.md) | Points-only, non-redeemable launch boundary | Accepted — live 2026-07-07 | 2026-07-07 (supersession note 2026-09-06) | **Supersedes** the archived cashier ADR-001..004 (custodial/non-custodial launch postures) | ADR-0009, ADR-0012, `docs/compliance/geofencing-kyc.md` |
| [0011](adr/0011-deployment-topology-single-branch-hetzner-compose.md) | Single `main` branch deploys the demo; docker-compose on one Hetzner box | Accepted — executed 2026-06-13/14 | 2026-06-13 (P2-04), 2026-06-14 (P2-06) | — | ADR-0012, [DEPLOYMENT.md](DEPLOYMENT.md) |
| [0012](adr/0012-cashier-merged-dark-behind-flags.md) | Merge `feat/hula-na-cashier` to `main`, keep it dark behind flags | Accepted — implemented 2026-09-29 | 2026-09-29 | — | ADR-0010, ADR-0011 |
| [0013](adr/0013-market-cover-sourcing-and-serving.md) | Market cover sourcing (Wikidata-only) and serving (Caddy from a volume) | Accepted — most recently revised 2026-09-28 | 2026-05-18 / 2026-09-28 | — | `CLAUDE.md` cover-resolver section |
| [cashier/ADR-001](archive/cashier/adrs/ADR-001-non-custodial-cashier-boundary.md) | Non-Custodial Cashier Boundary | **Superseded** 2026-09-06 (archived) | 2026-05-25 | Superseded by the 2026-05-27 custodial decision, then by ADR-0010 | `docs/archive/cashier/README.md` |
| [cashier/ADR-002](archive/cashier/adrs/ADR-002-tron-deposit-provider-shortlist.md) | Tron Deposit Provider Shortlist | **Superseded** 2026-09-06 (archived) — no provider ever selected | 2026-05-25 | Superseded by ADR-0010 | — |
| [cashier/ADR-003](archive/cashier/adrs/ADR-003-embedded-wallet-and-smart-account-shortlist.md) | Embedded Wallet and Smart Account Shortlist | **Superseded** 2026-09-06 (archived) — no provider ever selected | 2026-05-25 | Superseded by ADR-0010 | — |
| [cashier/ADR-004](archive/cashier/adrs/ADR-004-settlement-chain-shortlist.md) | Settlement Chain Shortlist | **Superseded** 2026-09-06 (archived) — no chain ever selected | 2026-05-25 | Superseded by ADR-0010 | — |

`docs/archive/cashier/README.md` (not only its four ADRs) is historical; see
[What's in `archive/`](#whats-in-archive).

## What shipped for 0001-0004

*(Carried over from the former `adr/README.md`, which now points here.)*

- **0002** — `requireAdminRole` trusts only the validated session role (the `X-Admin-Role` fallback is deleted, with a regression test); there are no public wallet `/credit` or `/debit` routes; `GATEWAY_AUTH_ENABLED=false` is refused at boot in production/staging.
- **0001** — `office/next.config.js` sets `ignoreBuildErrors: false`.
- **0003** — the source registry and per-source health tracking ship (`internal/prediction/feed/`), surfaced at `GET /api/v1/admin/resolution-sources`. Launch policy is manual/admin attestation; automated adapters are opt-in and `Corroborator` has no implementation.
- **0004** — migration 023 adds `prediction_resolution_proposals` and `prediction_disputes`; the market FSM gained `proposed_resolution` and `disputed`; payouts credit at finalize, not at proposal; the office review queue is `office/app/(dashboard)/disputes/`.

**Cross-cutting rule (still current):** every privileged or points-moving action must write an audit log. ADR-0003 and ADR-0004 share one proposed-result → finalize seam.

### Open questions from the 2026-05-22 audit — where they landed

1. **Real-money vs play-money launch, and jurisdiction?** — Answered by ADR-0010 (points-only, non-redeemable). The jurisdiction list itself is still open; see `docs/compliance/geofencing-kyc.md`.
2. **Is an HTTP wallet credit/debit API consumed by any client?** — Answered: no (ADR-0002).
3. **Challenge-window length per category, and dispute eligibility/anti-abuse** — still open (ADR-0004's `ChallengeEndsAt` mechanism exists; no per-category policy).
4. **On-chain ambition?** — moot for the points launch (ADR-0010).

## How to add or supersede an ADR

1. A significant architectural decision (a new boundary, dependency, data-ownership rule, deployment shape, or reversal of an earlier decision) gets a new ADR file in `docs/adr/`, numbered sequentially, plus a new row in this index.
2. **Accepted ADRs are never rewritten.** To change a decision, write a new ADR that supersedes it, mark the old one `Superseded by ADR-NNNN` in its status line, and update this index's Status and "Supersedes / superseded by" columns for both.
3. A **dated "Status update" note** may be appended at the bottom of an existing ADR for facts that don't change the decision (e.g., "implemented in migration 037") — ADR-0004 and ADR-0005 carry examples. The ADR's original body is never edited.
4. When a whole workstream is abandoned rather than superseded by a specific new decision, move its ADRs to `docs/archive/<workstream>/adrs/` with a banner at the top of each file and of the workstream's README stating what superseded it and the date — see `docs/archive/cashier/` for the pattern this repository already uses.
5. Never invent rationale, alternatives, dates or approvals when writing or reviewing an ADR. If the why is not recorded anywhere, write "Rationale not recorded."

## Decisions recorded outside ADRs

Some architectural and product decisions are recorded in living documents
rather than ADRs, either because they predate this ADR practice, are
narrower implementation notes, or are product/design calls rather than
system-architecture ones. This index points to them instead of duplicating
their content (one home per fact):

| Document | What it records |
|---|---|
| [DESIGN.md](../DESIGN.md) | The player app's design system ("Kilig", adopted 2026-09-24, decision `bbca37fe`) — palette, typography, layout rules. Mirrors the code; the code is authoritative if they disagree. |
| [taptrade-economy-rules.md](taptrade-economy-rules.md) | The Points unit model (corrected 2026-07-07, ADR-0009's companion doc) and the broader economy rules the unit model sits inside. |
| [STORE_AND_PAYMENTS.md](../STORE_AND_PAYMENTS.md) | The point-store closed-loop money-in path (`STORE_ENABLED`, migration 051, landed 2026-07-12) — the one live money-in surface under the ADR-0010 launch boundary. |
| [compliance/geofencing-kyc.md](compliance/geofencing-kyc.md) | Geofencing/KYC scaffolding, the boot-policy machinery, and the still-open jurisdiction-list and geo-source-of-truth legal decisions. |
| [content/2026-q4-ph-market-slate.md](content/2026-q4-ph-market-slate.md) | The approved Q4 2026 Philippine content/market slate. |

### Product & design decisions recorded elsewhere

These two 2026-09 product/design moves were evaluated for ADR-worthiness in
the 2026-09-29 documentation review and judged **not** to rise to architectural-decision level — they
change the player app's route surface and visual system, not a system
boundary, data-ownership rule, dependency, or deployment shape. They are
well-documented already, just not as ADRs:

- **Floor redesign trial retired** (2026-09-23) — `/floor`, `/book`,
  `/standing` and `components/floor/` were removed in favor of `/predict` +
  `/market/[ticker]`; `next.config.js` redirects the old routes and
  `app/__tests__/floor-retirement.test.ts` (present at `4924a670`) pins
  their absence. Recorded in `CLAUDE.md`'s "Retired" note under player-app
  pages.
- **Kilig design system adopted** (2026-09-24, decision `bbca37fe`) —
  replaced the 2026-08-22 purple + gold system. Recorded in `DESIGN.md`
  (see above), which is the authoritative, continuously-updated record.

## What's in `archive/`

`docs/archive/cashier/` holds the full design-and-decision record of the
abandoned custodial/non-custodial cashier workstream (superseded 2026-09-06
by ADR-0010), including the four ADRs indexed above, `CUSTODIAL_USDC_ALPHA_PLAN.md`,
provider/chain/wallet scorecards, and operational runbooks that no longer
describe a system that exists. Its own README carries the supersession
banner and a 2026-09-29 update note cross-referencing ADR-0012 (the merge
that ported a few pieces of this workstream's code back into `main`,
dark). Treat everything under `docs/archive/` as historical: useful for the
reasoning it captures, never as a description of the current system.

## Open questions

Decisions that no ADR resolves yet are tracked, with what would resolve them, in
[TASKS.md](TASKS.md#needs-a-decision): the ledger model (D-2, ADR-0006), the
multi-tenancy epic (D-3, ADR-0005), the jurisdiction allowlist (D-11,
ADR-0010), branch protection on `main` (D-12, ADR-0011), and which admin actions
need a second approver (D-1, ADR-0012).
