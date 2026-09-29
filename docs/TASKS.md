# Tasks

> **Scope:** the actionable backlog — agreed work, recommended work, decisions
> that block work, and what shipped recently.
> **Authoritative for:** what should be done next and what is waiting on whom.
> **Not for:** evidence and impact of each problem → [TECH_DEBT.md](TECH_DEBT.md)
> (linked by TD id, not repeated); decisions already made → [DECISIONS.md](DECISIONS.md).
> **Last verified:** 2026-09-29 at commit `4924a670` — reconciled with
> [TECH_DEBT.md](TECH_DEBT.md), the ADRs, the archived `CURRENT_STATE.md` and
> AI-drafting plan, and `git log --since=2026-09-15`. Updated the same day
> when the hardening change closed T-003 – T-006, T-008 – T-010, T-021 and T-029.

When a task is finished, move it to [Done recently](#done-recently) with its
commit, and close the matching TECH_DEBT entry. When one becomes obsolete, delete
it with a one-line reason in the commit message.

## Agreed work

Only work backed by an owner instruction, an accepted ADR or a recorded
requirement.

| ID | Action | Source | Done when |
|---|---|---|---|
| T-001 | Visually verify the signed-in states of the 2026-09-29 redesign — balance chip, the notification bell below 480px, the account menu — on the live demo against the approved mockups ([TD-041](TECH_DEBT.md#g-player-app)) | The owner adopted the 2026-09-29 mockups and asked for each phase to be checked on real pages; phases 1–4 shipped (`8e87a661` … `9bedeb0d`) with signed-in states unchecked because the agent cannot sign in | Each state captured signed-in and compared with its mockup; differences filed as tasks |

## Recommended

From the debt register and audits; not yet agreed by the owner. Ordered by
priority, then effort.

| ID | Action | Links | Done when |
|---|---|---|---|
| T-002 | Wire the two-person rule into admin wallet credit/debit and manual settlement | [TD-001, TD-002](TECH_DEBT.md#a-admin-controls-and-points-integrity) | Blocked on [D-1](#needs-a-decision); above the threshold, a second admin must approve before the action runs |
| T-007 | Send the demo's backups offsite, with a copy of the two-factor key kept apart from them | [TD-020](TECH_DEBT.md#d-delivery-and-operations) | Blocked on [D-13](#needs-a-decision). `BACKUP_OFFSITE_CMD` set on the demo and one dump restored from the offsite copy (the on-box drill passed on 2026-09-29) |
| T-011 | Harden front-end session handling: office proxy fails closed; stop mirroring tokens to `localStorage` | [TD-010, TD-011](TECH_DEBT.md#b-authentication-and-access-control) | No token readable from JS; an auth-backend outage keeps the office locked |
| T-012 | Cap `GrantBonus` and wire wagering contributions | [TD-003](TECH_DEBT.md#a-admin-controls-and-points-integrity) | Grants respect campaign budget and an absolute cap; a real order moves wagering progress |
| T-013 | Make loyalty tier edits take effect, or make the settings page read-only | [TD-004](TECH_DEBT.md#a-admin-controls-and-points-integrity) | Office edits and runtime accrual agree |
| T-014 | Build the KYC review queue | [TD-013](TECH_DEBT.md#c-compliance-and-licensability) | Operators see pending submissions and decide them in the office |
| T-015 | Persist and enforce session-duration limits, or remove the endpoint and the copy | [TD-016](TECH_DEBT.md#c-compliance-and-licensability) | The responsible-gaming page describes only what is enforced |
| T-030 | Make responsible-gaming limits fail closed when their store cannot start | [TD-059](TECH_DEBT.md#c-compliance-and-licensability) | A production/staging gateway with a broken RG store refuses trades instead of skipping limits |
| T-031 | Two-factor follow-ups: recovery codes, a QR code, operator-issued staff enrollment, and refresh for office-created staff | [TD-056 – TD-058](TECH_DEBT.md#b-authentication-and-access-control) | A lost phone doesn't need an operator; a new admin can't be enrolled by whoever learns the temporary password; office sessions refresh |
| T-016 | Move the trade compliance gate into middleware | [TD-033](TECH_DEBT.md#f-gateway-api-and-real-time) | New trade routes are covered without handler changes |
| T-017 | Server-render `/predict`, `/market/[ticker]`, `/category/[slug]` | [TD-040](TECH_DEBT.md#g-player-app) | Market content is in the initial HTML |
| T-018 | Make `gate.sh` pass: resolve the three stubs and rebuild `FEATURE_MANIFEST.json` `pages[]` from the real routes | [TD-042](TECH_DEBT.md#g-player-app) | `./gate.sh` exits 0 |
| T-019 | Run AI market drafting end-to-end with a real key; add the redirect/DNS-rebinding SSRF test; record `cost_micros` | [TD-046](TECH_DEBT.md#h-ai-market-drafting) | One live draft recorded; SSRF test in CI; cost column populated |
| T-020 | Build self-service password reset; persist notification preferences | [TD-043](TECH_DEBT.md#g-player-app) | Reset email works end to end; preferences survive reload |
| T-022 | Scope market-integrity surveillance and duplicate-account detection for a points market | [TD-014, TD-015](TECH_DEBT.md#c-compliance-and-licensability) | A written scope, then the first detector |
| T-023 | Remove dead or misleading surface: the mock geo route and client, never-broadcast WS channels, fixed-payload report endpoints, the `/v1/provider-callbacks/` prefix, the unsaved profile update, the unused `withdrawal.status` event, the duplicated launch predicate, `cancel_both` | [TD-017](TECH_DEBT.md#c-compliance-and-licensability), [TD-034 – TD-037, TD-039](TECH_DEBT.md#f-gateway-api-and-real-time) | Each item removed or wired, with the OpenAPI spec updated |
| T-024 | Config hygiene: `go vet` in CI, `gofmt`, drop `JWT_SECRET` and the inert keys, fix the compose header comment, repoint `TODOS.md` comments to this file | [TD-024 – TD-028](TECH_DEBT.md#d-delivery-and-operations), [TD-045, TD-053](TECH_DEBT.md#j-legacy-residue-and-hygiene) | Grep for each key returns nothing; CI runs vet |
| T-025 | Data-model cleanup migration and keyset pagination | [TD-031, TD-032](TECH_DEBT.md#e-ledger-data-model-and-tenancy) | Dead columns and tables dropped after a reader check; hot lists use keyset |
| T-026 | Rewrite `stack/API_EXAMPLES.md`, `MIGRATION.md`, `UPGRADE.md` for Points wire fields | [TD-054](TECH_DEBT.md#j-legacy-residue-and-hygiene) | Examples round-trip against a local gateway |
| T-027 | RBAC-gate CMS and bonus admin routes; decide the fail-open posture of rate limiters and lockout; stand up metrics or drop the dashboards | [TD-009, TD-012](TECH_DEBT.md#b-authentication-and-access-control), [TD-023](TECH_DEBT.md#d-delivery-and-operations) | Each decided and implemented |
| T-028 | Remove legacy residue: sportsbook-shaped seed JSON, the mock server and old Playwright config, and the locale namespaces nothing renders | [TD-051, TD-052, TD-060](TECH_DEBT.md#j-legacy-residue-and-hygiene) | Removed as one change after confirming nothing uses them |

## Needs a decision

Each names what would resolve it.

| ID | Decision | Who / evidence needed |
|---|---|---|
| D-1 | Which admin actions need a second approver, and at what Points threshold (candidates: wallet credit/debit, manual settlement) | Owner. `gateway/internal/approval` is built and waiting ([TD-001](TECH_DEBT.md#a-admin-controls-and-points-integrity)) |
| D-2 | Ledger model: keep single-entry with the reconciler and add contra accounts over time, or rewrite to double-entry | Owner. [ADR-0006](adr/0006-ledger-accounting-model.md) is still Proposed |
| D-3 | Green-light or schedule the multi-tenancy epic (steps 1b, 3–6) | Owner. [ADR-0005](adr/0005-multi-tenancy-foundation.md) |
| D-4 | Keep the AMM as a read-only quote path, or delete it and restrict `execution_mode` to `order_book` | Owner/engineering ([TD-038](TECH_DEBT.md#f-gateway-api-and-real-time)) |
| D-5 | Fee policy: the implemented variance fee versus a flat 1% | Owner (parked since 2026-09-06 in the archived `CURRENT_STATE.md`) |
| D-6 | Whether to rewrite cents-era keys inside stored bonus rule JSON | Owner (parked since 2026-09-06) |
| D-7 | Authorise the Cloudflare origin-firewall change to persist across reboots | Owner/ops (parked since 2026-09-06; the deploy now installs `cf-firewall.service` — confirm whether this is already resolved) |
| D-8 | Rotate two third-party API credentials that were exposed in a July session transcript, or reconfirm the recorded "keep" decision | Owner/security (recorded in the archived `CURRENT_STATE.md`, "Standing decisions") |
| D-9 | Move AI-drafted markets to propose → challenge → finalize once contested markets appear | Owner/product (archived AI-drafting plan §19) |
| D-10 | `/cashier`: build wallet connect and deposits, or leave a dormant information card | Owner/product/legal ([TD-048](TECH_DEBT.md#i-dormant-cashier-not-mounted-in-any-deployment), [ADR-0012](adr/0012-cashier-merged-dark-behind-flags.md)) |
| D-11 | Jurisdiction allowlist and geo source of truth for any production launch | Legal/counsel ([compliance/geofencing-kyc.md](compliance/geofencing-kyc.md)) |
| D-12 | Whether branch protection on `main` should also bind admins | Owner. Checked 2026-09-29 (GitHub API): `main` is protected and requires `cashier-guards`, `frontend-tests`, `go-build-and-test`, `money-path` and `conventions`, but enforcement is `non_admins`, so the owner's direct pushes skip them. The deploy now waits for CI either way (`scripts/wait-for-ci.sh`); binding admins would mean merging through pull requests ([ADR-0011](adr/0011-deployment-topology-single-branch-hetzner-compose.md)) |
| D-13 | Where the demo's backups go offsite (for example an S3-compatible bucket or a second box), and where a copy of the two-factor key is kept | Owner. The backup sidecar runs `BACKUP_OFFSITE_CMD` with each new dump's path; the key must not travel with the dumps ([TD-020](TECH_DEBT.md#d-delivery-and-operations)) |

## Done recently

From `git log --since=2026-09-15` on `main`, grouped:

- **Hardening (2026-09-29)** — staff two-factor sign-in, players optional
  (T-003); KYC fails closed (T-004); the deploy waits for CI (T-005); release
  images kept with a rollback workflow (T-006); the backup sidecar running and a
  restore drill recorded, offsite still open (T-007, D-13); the runbook's SQL
  rewritten and the two runbooks merged (T-008); unknown `ENVIRONMENT` refused
  (T-009); bot keys session-authenticated (T-010); the last rendered "pt" renamed
  (T-021); gateway middleware order fixed (T-029). Also: settlement override
  reasons are stored (migration 066). See
  [Recently resolved](TECH_DEBT.md#recently-resolved).
- **Cashier merged dark and money code hardened (2026-09-29)** — `d91b21c2`,
  `e50a897d`, `960c94b9`, `d69d4e73`, `af3d0611` (merge record), `71350057`
  (Node cashier fixes), `185c982f` (`webhookauth`, `approval`, `internal/cashier`
  deleted), `4924a670` (crypto rail removed). See [ADR-0012](adr/0012-cashier-merged-dark-behind-flags.md)
  and [Recently resolved](TECH_DEBT.md#recently-resolved).
- **Player redesign phases 1–4 (2026-09-29)** — `8e87a661`, `f880c432`,
  `99b74895`, `5cda9032`, `9bedeb0d`, then `eedffdf4` (closed-market covers, one
  icon family, one label per action). Signed-in verification remains: T-001.
- **Play currency renamed "Clout" (2026-09-28)** — `fe4338fb`, `df83f1aa`
  (finished by the hardening change).
- **Leaderboards, rewards and navigation** — `98da1271`, `c76505b1`, `2c22c12d`.
- **Covers and catalog** — the cover resolver, matchup tiles, event-card
  grouping, the 15-minute catalog sync and the market-image admin route
  (`cfe6800f` … `4dc8df4d`).
- **Design system and board** — `c14eed7c`, `4e2f383f` (Kilig adopted),
  `156e2d2a`, `a35b9e7a` (Floor trial retired; in-place quick trade).
