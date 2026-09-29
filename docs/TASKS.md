# Tasks

> **Scope:** the actionable backlog — agreed work, recommended work, decisions
> that block work, and what shipped recently.
> **Authoritative for:** what should be done next and what is waiting on whom.
> **Not for:** evidence and impact of each problem → [TECH_DEBT.md](TECH_DEBT.md)
> (linked by TD id, not repeated); decisions already made → [DECISIONS.md](DECISIONS.md).
> **Last verified:** 2026-09-29 at commit `4924a670` — reconciled with
> [TECH_DEBT.md](TECH_DEBT.md), the ADRs, the archived `CURRENT_STATE.md` and
> AI-drafting plan, and `git log --since=2026-09-15`.

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
| T-003 | Add TOTP MFA for back-office staff | [TD-005](TECH_DEBT.md#b-authentication-and-access-control) | Admin login requires a second factor; the account 2FA toggle reflects real state |
| T-004 | Fail closed when the KYC store cannot start | [TD-006](TECH_DEBT.md#b-authentication-and-access-control) | `FailClosedKYCService` replaces the mock fallback |
| T-005 | Gate the demo deploy on CI | [TD-018](TECH_DEBT.md#d-delivery-and-operations) | A red test or guard run stops the deploy |
| T-006 | Keep deploy images by tag and write a rollback procedure | [TD-019](TECH_DEBT.md#d-delivery-and-operations) | A documented command restores the previous release in [DEPLOYMENT.md](DEPLOYMENT.md) |
| T-007 | Configure offsite backups and run a restore drill | [TD-020](TECH_DEBT.md#d-delivery-and-operations) | `BACKUP_OFFSITE_CMD` set on the demo; restore time recorded in [DEPLOYMENT.md](DEPLOYMENT.md) |
| T-008 | Rewrite the on-call runbook's SQL for the `*_points` schema, and merge the two runbooks | [TD-021, TD-022](TECH_DEBT.md#d-delivery-and-operations) | Every query in the runbook runs against a fresh migrated DB; one runbook remains |
| T-009 | Refuse unknown `ENVIRONMENT` values at boot | [TD-007](TECH_DEBT.md#b-authentication-and-access-control) | `ENVIRONMENT=prod` fails boot instead of running in dev mode |
| T-010 | Make `/api/v1/bot/keys` session-authenticated | [TD-008](TECH_DEBT.md#b-authentication-and-access-control) | A signed-in player can list and create keys (subject to `BOT_KEYS_SELF_SERVE`) |
| T-011 | Harden front-end session handling: office proxy fails closed; stop mirroring tokens to `localStorage` | [TD-010, TD-011](TECH_DEBT.md#b-authentication-and-access-control) | No token readable from JS; an auth-backend outage keeps the office locked |
| T-012 | Cap `GrantBonus` and wire wagering contributions | [TD-003](TECH_DEBT.md#a-admin-controls-and-points-integrity) | Grants respect campaign budget and an absolute cap; a real order moves wagering progress |
| T-013 | Make loyalty tier edits take effect, or make the settings page read-only | [TD-004](TECH_DEBT.md#a-admin-controls-and-points-integrity) | Office edits and runtime accrual agree |
| T-014 | Build the KYC review queue | [TD-013](TECH_DEBT.md#c-compliance-and-licensability) | Operators see pending submissions and decide them in the office |
| T-015 | Persist and enforce session-duration limits, or remove the endpoint and the copy | [TD-016](TECH_DEBT.md#c-compliance-and-licensability) | The responsible-gaming page describes only what is enforced |
| T-016 | Move the trade compliance gate into middleware | [TD-033](TECH_DEBT.md#f-gateway-api-and-real-time) | New trade routes are covered without handler changes |
| T-029 | Put Recovery, Metrics and AccessLog outermost in the gateway middleware chain, pin the order with a test, and add the tenant middleware to the auth-enabled chain | [TD-055](TECH_DEBT.md#f-gateway-api-and-real-time) | 401/403/429 responses appear in the access log and metrics; a test fails if the order changes |
| T-017 | Server-render `/predict`, `/market/[ticker]`, `/category/[slug]` | [TD-040](TECH_DEBT.md#g-player-app) | Market content is in the initial HTML |
| T-018 | Make `gate.sh` pass: resolve the three stubs and rebuild `FEATURE_MANIFEST.json` `pages[]` from the real routes | [TD-042](TECH_DEBT.md#g-player-app) | `./gate.sh` exits 0 |
| T-019 | Run AI market drafting end-to-end with a real key; add the redirect/DNS-rebinding SSRF test; record `cost_micros` | [TD-046](TECH_DEBT.md#h-ai-market-drafting) | One live draft recorded; SSRF test in CI; cost column populated |
| T-020 | Build self-service password reset; persist notification preferences | [TD-043](TECH_DEBT.md#g-player-app) | Reset email works end to end; preferences survive reload |
| T-021 | Finish the "Clout" rename in all locales | [TD-044](TECH_DEBT.md#g-player-app) | No player-facing "Points" label remains except where Points is deliberate |
| T-022 | Scope market-integrity surveillance and duplicate-account detection for a points market | [TD-014, TD-015](TECH_DEBT.md#c-compliance-and-licensability) | A written scope, then the first detector |
| T-023 | Remove dead or misleading surface: the mock geo route and client, never-broadcast WS channels, fixed-payload report endpoints, the `/v1/provider-callbacks/` prefix, the unsaved profile update, the unused `withdrawal.status` event, the duplicated launch predicate, `cancel_both` | [TD-017](TECH_DEBT.md#c-compliance-and-licensability), [TD-034 – TD-037, TD-039](TECH_DEBT.md#f-gateway-api-and-real-time) | Each item removed or wired, with the OpenAPI spec updated |
| T-024 | Config hygiene: `go vet` in CI, `gofmt`, drop `JWT_SECRET` and the inert keys, fix the compose header comment, repoint `TODOS.md` comments to this file | [TD-024 – TD-028](TECH_DEBT.md#d-delivery-and-operations), [TD-045, TD-053](TECH_DEBT.md#j-legacy-residue-and-hygiene) | Grep for each key returns nothing; CI runs vet |
| T-025 | Data-model cleanup migration and keyset pagination | [TD-031, TD-032](TECH_DEBT.md#e-ledger-data-model-and-tenancy) | Dead columns and tables dropped after a reader check; hot lists use keyset |
| T-026 | Rewrite `stack/API_EXAMPLES.md`, `MIGRATION.md`, `UPGRADE.md` for Points wire fields | [TD-054](TECH_DEBT.md#j-legacy-residue-and-hygiene) | Examples round-trip against a local gateway |
| T-027 | RBAC-gate CMS and bonus admin routes; decide the fail-open posture of rate limiters and lockout; stand up metrics or drop the dashboards | [TD-009, TD-012](TECH_DEBT.md#b-authentication-and-access-control), [TD-023](TECH_DEBT.md#d-delivery-and-operations) | Each decided and implemented |
| T-028 | Remove legacy residue: sportsbook-shaped seed JSON, the mock server and old Playwright config | [TD-051, TD-052](TECH_DEBT.md#j-legacy-residue-and-hygiene) | Removed as one change after confirming nothing uses them |

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
| D-12 | Whether `main` has branch protection requiring the guard workflows | Owner — a GitHub setting, not visible in the repository ([ADR-0011](adr/0011-deployment-topology-single-branch-hetzner-compose.md)) |

## Done recently

From `git log --since=2026-09-15` on `main`, grouped:

- **Cashier merged dark and money code hardened (2026-09-29)** — `d91b21c2`,
  `e50a897d`, `960c94b9`, `d69d4e73`, `af3d0611` (merge record), `71350057`
  (Node cashier fixes), `185c982f` (`webhookauth`, `approval`, `internal/cashier`
  deleted), `4924a670` (crypto rail removed). See [ADR-0012](adr/0012-cashier-merged-dark-behind-flags.md)
  and [Recently resolved](TECH_DEBT.md#recently-resolved).
- **Player redesign phases 1–4 (2026-09-29)** — `8e87a661`, `f880c432`,
  `99b74895`, `5cda9032`, `9bedeb0d`, then `eedffdf4` (closed-market covers, one
  icon family, one label per action). Signed-in verification remains: T-001.
- **Play currency renamed "Clout" (2026-09-28)** — `fe4338fb`, `df83f1aa`
  (incomplete in three locale files: T-021).
- **Leaderboards, rewards and navigation** — `98da1271`, `c76505b1`, `2c22c12d`.
- **Covers and catalog** — the cover resolver, matchup tiles, event-card
  grouping, the 15-minute catalog sync and the market-image admin route
  (`cfe6800f` … `4dc8df4d`).
- **Design system and board** — `c14eed7c`, `4e2f383f` (Kilig adopted),
  `156e2d2a`, `a35b9e7a` (Floor trial retired; in-place quick trade).
