# Tech debt register

> **Scope:** known technical debt, security residuals and process gaps, each with
> evidence, impact, priority and a recommended fix.
> **Authoritative for:** open debt items and their priority. **Not for:** who is
> doing what, or decisions that block a fix → [TASKS.md](TASKS.md); dated audit
> narratives → [`audit/`](audit/).
> **Last verified:** 2026-09-29 at commit `4924a670` — every item was re-checked
> against source (read or grep) in the 2026-09-29 review rather than copied from an audit.
> Candidate lists came from `audit/AUDIT_REPORT.md`, `audit/IMPROVEMENT_PLAN.md`,
> `audit/SECURITY-REVIEW-2026-06-14.md`, `audit/ARCH-CLEANUP-2026-06-14.md`, the
> archived `CURRENT_STATE.md` and `licensability-gaps.md`, the ADRs,
> `player/FEATURE_MANIFEST.json`, and the research done for that review.

Audit findings that the code now shows as fixed are not listed; the notable ones
are under [Recently resolved](#recently-resolved). Nothing here changes
application behaviour — the 2026-09-29 review only recorded it.

**Priority:** **P0** real-money loss, critical auth or data-integrity breach, or a
production build break — none open. **P1** a live gap with no compensating
control, usually insider-triggered. **P2** a meaningful gap, defence-in-depth hole,
or drift with moderate impact. **P3** hygiene, cosmetic, or dormant surface.

## A. Admin controls and Points integrity

| ID | Title | Evidence | Impact | P | Remediation |
|---|---|---|---|---|---|
| TD-001 | Admin wallet credit/debit is single-admin and uncapped | `gateway/internal/http/admin_handlers.go` (`adminCreditPath`, `finances:write` only; amount only checked `> 0` in `wallet_handlers.go` `decodeWalletMutationRequest`) | One admin, or one compromised admin account, can create unlimited Points | P1 | Wire `gateway/internal/approval` above a threshold — blocked on [D-1](TASKS.md#needs-a-decision) |
| TD-002 | Manual settlement is single-admin | `gateway/internal/http/prediction_handlers.go` `/api/v1/admin/settlements/` (`settlements:resolve` only); proposal→finalize enforces two people, the direct resolve does not | One admin can settle and pay out a market alone | P1 | Same as TD-001 |
| TD-003 | `GrantBonus` has no ceiling; wagering enforcement is dead code | `gateway/internal/bonus/service.go` `GrantBonus` (no budget/status/window check on the override amount); `gateway/internal/wallet/wagering.go` `RecordWageringContribution` has no non-test caller | An admin override can over-grant; the wagering gate exists only on paper | P2 | Enforce campaign budget, status, window and an absolute cap; wire wagering into the order/settlement path |
| TD-004 | Loyalty tier edits in the office do not change accrual | `gateway/migrations/021_*` header; runtime reads Go constants in `gateway/internal/loyalty/tiers.go` (`PredictTierForPoints`, `PredictAccrualPoints`), not `loyalty_tier_config` | Operators can edit tiers that have no effect | P2 | Read tier config from the table at runtime, or make the settings page read-only |

## B. Authentication and access control

| ID | Title | Evidence | Impact | P | Remediation |
|---|---|---|---|---|---|
| TD-005 | Staff MFA does not exist; the 2FA toggle is cosmetic | No TOTP/MFA code in `auth/`; the account 2FA toggle writes an in-memory map login never reads; `player/app/account/security/page.tsx` never loads the current status | Admin accounts are password-only | P1 | DB-backed TOTP for `admin_users`, required at admin login (reference implementation on tag `archive/pam-p0-modernization-2026-07-06`; rebuild, don't cherry-pick) |
| TD-006 | KYC falls back to an auto-approving mock | `gateway/internal/http/handlers.go` wires `compliance.NewMockKYCService()` when the Postgres KYC store is unavailable, in every environment; `compliance.FailClosedKYCService` has no caller | A DB fault silently turns identity checks into auto-approve (matters once `KYC_REQUIRED_FOR_TRADING` is on) | P1 | Use `FailClosedKYCService` on init failure |
| TD-007 | Unrecognised `ENVIRONMENT` values fall into dev behaviour | `gateway/internal/http/pretrade_gate.go` treats only `production`/`staging` as real; `gateway/cmd/gateway/main.go` `validateGatewayRuntimeConfig` likewise | A typo such as `prod` disables the boot policy and the fail-closed trade gate | P2 | Allowlist environment names; refuse unknown ones at boot |
| TD-008 | Self-serve bot API key routes always return 401 | `/api/v1/bot/` is a public prefix (`gatewayPublicPrefixes`), so `httpx.Auth` never sets a user; it strips `X-User-ID`; `/api/v1/bot/keys` is not wrapped by `BotAuthMiddleware`, so `userIDFromRequest` is always empty (`gateway/internal/http/bot_handlers.go`) | Players cannot list, create or revoke their own keys; operators can still issue keys via `/api/v1/admin/partner-keys` | P2 | Take `/api/v1/bot/keys` out of the public prefix (session-authenticate it) |
| TD-009 | CMS and bonus admin routes check role only | `gateway/internal/http/content_handlers.go`, `bonus_handlers.go` use an inline `role == "admin"` check, not `requireAdminPermission` | Any admin can publish content or grant bonuses regardless of RBAC role | P3 | Gate with RBAC permissions like the other admin routes |
| TD-010 | Player tokens are mirrored into `localStorage` | `player/app/lib/api/client.ts` (`taptrade_access_token`, `taptrade_refresh_token`) | A future XSS could steal a session | P2 | Rely on the HttpOnly cookie only |
| TD-011 | Office proxy degrades open when the auth backend is unreachable | `office/proxy.ts` `validateSession` returns `null` on fetch error and the caller falls back to a token-presence check | A gateway outage or misconfigured URL lets any token-shaped cookie into the office shell (the gateway still enforces RBAC on data) | P2 | Fail closed in production |
| TD-012 | Rate limiters and login lockout fail open on Redis errors | `platform-mod/transport/httpx/ratelimit.go` `RedisRateLimiter.Allow`; `auth/internal/http/redis_rate_limiter.go` (limiter and `IsLocked`) | A Redis outage removes rate limiting and lockout | P3 | Decide the intended posture; alert on the error path at minimum |

## C. Compliance and licensability

| ID | Title | Evidence | Impact | P | Remediation |
|---|---|---|---|---|---|
| TD-013 | KYC review has no operator surface | `POST /api/v1/admin/kyc/decision` exists; no pending-review list route, no office KYC page; `kyc_documents` stores metadata, not files | Review is a curl-level operation | P2 | Build the review queue and document storage |
| TD-014 | No market-integrity surveillance | No wash/self-trade/spoofing detection in `gateway/internal/` | No manipulation monitoring on an order-book exchange | P2 | Scope to what a points market needs |
| TD-015 | No duplicate-account detection | No email-normalisation collision check (plus-addressing, dots, aliases) | Multi-accounting is the main abuse path for a faucet-funded economy | P2 | Add normalised-email uniqueness at signup |
| TD-016 | Session-duration limit is accepted but neither stored nor enforced | `gateway/internal/compliance/handlers.go` `/api/v1/compliance/rg/session-limit` validates and echoes; no table, no enforcement; `player/app/responsible-gaming/page.tsx` says session limits work | Users could believe a limit is active when it is not (page is behind `NEXT_PUBLIC_FEATURE_RG`, off by default) | P2 | Persist and enforce, or remove the endpoint and the copy |
| TD-017 | Mock GPS geo service is mounted in every environment | `gateway/internal/http/handlers.go` wires `compliance.NewMockGeoComplianceServiceFromEnv()` behind `POST /api/v1/compliance/geo/verify`, which takes `userId` from the body; `FailClosedGeoComplianceService` has no caller; the player client for it (`player/app/lib/services/geocomply.ts`) has no importer | A reachable mock with no effect today (the real gate uses `CF-IPCountry`); a trap if anything starts trusting it | P3 | Remove the route and client, or back it with the fail-closed service |

## D. Delivery and operations

| ID | Title | Evidence | Impact | P | Remediation |
|---|---|---|---|---|---|
| TD-018 | The deploy does not wait for CI | `.github/workflows/deploy-demo.yml` has no dependency on `test.yml` or the `guard-*` workflows; all start on the same push to `main` | A change that fails tests still deploys | P2 | Gate the deploy on the test and guard workflows (or on branch protection plus PR-only merges) |
| TD-019 | No rollback path | No procedure in any doc or workflow; images are built per run and not retained by tag | A bad deploy can only be undone by pushing a revert | P2 | Tag and keep recent images; document a rollback |
| TD-020 | Backups are local and the restore is untested since May | `stack/ops/backup/`; the `db-backup` sidecar is opt-in and writes to the same box; last recorded restore 2026-05-23 | Box loss loses the database | P2 | Configure `BACKUP_OFFSITE_CMD`; run and record a restore drill |
| TD-021 | On-call runbook SQL uses renamed columns | `stack/ops/RUNBOOK.md` queries `collateral_pool_cents`, `total_cost_cents`, `amount_cents`, `balance_after_cents`…; migration 050 renamed the prediction and wallet columns to `*_points` | Incident queries fail when they are needed | P2 | Rewrite the queries against the current schema ([DATA_MODEL.md](DATA_MODEL.md)); a warning banner was added on 2026-09-29 |
| TD-022 | Two runbooks, contradicting each other | `stack/RUNBOOKS.md` §6 says the WebSocket Redis backbone is not built; `gateway/internal/ws/backbone.go` and `stack/ops/RUNBOOK.md` say it is | Wrong operational guidance | P3 | Merge into one runbook |
| TD-023 | No metrics stack runs; tracing export is plaintext | Neither compose file runs Prometheus or Grafana (dashboards in `stack/ops/grafana/` are import-only); `gateway/internal/tracing/tracing.go` hard-codes `otlptracegrpc.WithInsecure()` and no exporter is configured anywhere | Alerts in `stack/ops/prometheus/alert-rules.yml` never fire; enabling tracing would send spans unencrypted | P3 | Stand up a scraper or drop the claims; add a TLS option |
| TD-024 | `go vet` is not in CI | No `go vet` step in `.github/workflows/` (the code is vet-clean today) | A vet warning can ship | P3 | Add `go vet ./...` to `test.yml` |
| TD-025 | `JWT_SECRET` is required but unused | Both compose files demand it (`${JWT_SECRET:?}`); no Go code reads it; the deploy passes `JWT_SECRET=unused` | Misleads operators into managing a secret that does nothing | P3 | Remove it from compose, the deploy and docs |
| TD-026 | Inert configuration keys | `GATEWAY_READ_REPO_MODE` (compose, `e2e.yml`) is read by nothing; compose sets `GATEWAY_PORT`/`AUTH_PORT`, but the services read `PORT` | Dead config | P3 | Remove or wire |
| TD-027 | `*_CENTS` env names hold Points | `STARTER_GRANT_CENTS`, `DAILY_CLAIM_CENTS`, `SMM_*_CENTS`, `MISSION_*`/`STREAK_*`/`POINT_PACK_*_CENTS` | Naming drift after migration 050 | P3 | Rename in one coordinated change, or accept and keep documenting |
| TD-028 | Stale comments in config files | `stack/docker-compose.demo.yml` header names `feat/binary-exchange-engine` as the deploy branch (it is `main`) | Misleads readers | P3 | Fix the comment (left alone on 2026-09-29 to keep that review Markdown-only) |

## E. Ledger, data model and tenancy

| ID | Title | Evidence | Impact | P | Remediation |
|---|---|---|---|---|---|
| TD-029 | Single-entry ledger | `gateway/internal/wallet/service.go`, `wallet_ledger`; conservation is checked after the fact by the reconciler | Money creation is detected, not structurally prevented | P2 | Owner decision on [ADR-0006](adr/0006-ledger-accounting-model.md) first ([D-2](TASKS.md#needs-a-decision)) |
| TD-030 | Multi-tenancy is plumbing only | Migration 037 columns and `gateway/internal/tenant` exist; no query filters by tenant; the middleware always resolves the default tenant and is not in the auth-enabled chain (TD-055) | A second operator needs a fork | P2 | [ADR-0005](adr/0005-multi-tenancy-foundation.md) epic, blocked on [D-3](TASKS.md#needs-a-decision) |
| TD-031 | Dead schema | `prediction_orders.wallet_reservation_id` is `UUID` while `wallet_reservations.id` is `BIGSERIAL` and nothing writes it; `wallets` and `ledger_entries` have no runtime reader, yet `seed-data/seed_backoffice_dashboard.sql` still writes them | Confusion when tracing money flows | P3 | Drop in a new migration after confirming no reader |
| TD-032 | OFFSET pagination on list queries | `gateway/internal/prediction/sql_repository.go` (four `LIMIT … OFFSET …` sites) | Deep pages scan; fine at current scale | P3 | Keyset pagination on hot lists |

## F. Gateway API and real-time

| ID | Title | Evidence | Impact | P | Remediation |
|---|---|---|---|---|---|
| TD-033 | The compliance gate is called per handler | `checkComplianceGates` in `prediction_handlers.go` and `bot_handlers.go`; no middleware | A new trade path can forget it | P2 | Wrap trade surfaces in middleware |
| TD-034 | WebSocket channel drift | `gateway/internal/ws/hub.go`: `NotifyEventUpdate`, `NotifyCategoryUpdate`, `NotifyLeaderboardUpdate` have no caller; `admin:resolutions`/`admin:disputes` are broadcast but `authorizeChannelAccess` rejects subscriptions to them; sportsbook prefixes (`fixture`, `bets`…) are still accepted | Clients subscribe to channels that never fire | P3 | Remove or wire each |
| TD-035 | Declared-but-empty API surface | `withdrawal.status` webhook event never enqueued (`gateway/internal/webhooks/types.go`); `/v1/provider-callbacks/` listed in `gatewayPublicPrefixes` with no handler; `/api/v1/admin/punters/{id}/{reset-password,risk-segment,limits}` always 501; `/api/v1/admin/promotions/usage`, `/feed-health`, `/config` return fixed payloads (`reports_handlers.go`) | Dead ends for API consumers and operators | P3 | Remove, or implement and document |
| TD-036 | Profile update is not saved | `gateway/internal/http/user_handlers.go` `PUT /api/v1/users/{id}/profile` echoes the body and does not check the path id against the session | The UI reports success for changes that vanish | P3 | Persist with an owner check, or remove the edit UI |
| TD-037 | Launch-boundary predicate is duplicated | `legacyMoneyRoutesEnabled` in both `gateway/cmd/gateway/main.go` and `gateway/internal/http/launch_boundary.go` | The two can drift | P3 | Share one implementation |
| TD-038 | AMM code retained without a decision | `gateway/internal/prediction/amm.go` still quotes legacy AMM markets; execution is refused ([ADR-0008](adr/0008-clob-execution-replaces-amm.md)); the `execution_mode` CHECK still allows `amm` | Dead-ish code path | P3 | Decide keep-as-quote-only or delete ([D-4](TASKS.md#needs-a-decision)) |
| TD-055 | Middleware order is the reverse of what the code comments say | `platform-mod/transport/httpx/middleware.go` `Chain` makes the **first** listed middleware outermost; `gateway/cmd/gateway/main.go` comments assume the opposite. Effective order with auth on: RequestID → NormalizeTrailingSlash → tracing → SecurityHeaders → CORS → Auth → CSRF → rate limit → AccessLog → Metrics → Recovery → MaxBodySize → handler (confirmed by running a copy of `Chain`). `tenant.Middleware` appears only in the auth-disabled chain | 401/403/429 responses from Auth, CSRF and the rate limiter never reach AccessLog or Metrics; `Recovery` only covers the handler; the tenant middleware is not wired in any deployment that has auth on | P2 | Reorder the list (Recovery, Metrics, AccessLog outermost) and add a test that pins the order; add `tenant.Middleware` to the auth-enabled chain |
| TD-039 | `cancel_both` self-match behaves like `cancel_taker` | `gateway/internal/prediction/exchange.go` `applySelfMatch` (commented "v1 simplification") | API accepts an option it does not honour | P3 | Implement or reject the value |

## G. Player app

| ID | Title | Evidence | Impact | P | Remediation |
|---|---|---|---|---|---|
| TD-040 | Server rendering not adopted | ~100 files start `"use client"`, including `player/app/predict/page.tsx` and `player/app/market/[ticker]/page.tsx` | Every page hydrates a full client tree before content | P2 | Server-render the board and market pages |
| TD-041 | Signed-in states of the 2026-09-29 redesign never visually checked | Balance chip, the bell below 480px, the account menu — not covered by `player/tests/visual` for signed-in users | Shipped UI may not match the approved mockups | P2 | [T-001](TASKS.md#agreed-work) |
| TD-042 | Gate 5 fails, and the manifest is stale | `player/gate.sh` gate 5 fails on 3 STUBBED entries (`/cashier`, `ChatSidebar`, `chat-client`); `player/FEATURE_MANIFEST.json` `pages[]` still lists sportsbook-era pages (`/bets`, `/match/[id]`, `/promotions`…) as REAL although they do not exist | `gate.sh` never exits 0, and the manifest overstates coverage | P2 | Resolve the stubs; rebuild `pages[]` from `player/app/**/page.tsx` |
| TD-043 | Account flow gaps | `/auth/forgot-password` is a static notice (no reset endpoint); notification preferences are never persisted (disclosed in the UI); `/contact-us` falls back to `mailto:` | Users cannot self-serve a password reset | P3 | Build the reset flow; persist preferences |
| TD-044 | "Clout" rename incomplete | `player/public/static/locales/en/rewards.json` (`STAT_BALANCE`: "Points Balance"), `bonus.json`, `win-loss-statistics.json` still say Points | Inconsistent currency name in the UI | P3 | Finish the rename in all six locales |
| TD-045 | Comments point at a missing `TODOS.md` | `player/app/contact-us/page.tsx`, `support-mailto.ts` | A tracked follow-up cannot be found | P3 | Point them at [TASKS.md](TASKS.md) |

## H. AI market drafting

| ID | Title | Evidence | Impact | P | Remediation |
|---|---|---|---|---|---|
| TD-046 | Never run end-to-end against a real model; SSRF redirect test and cost tracking missing | `office/app/api/market-bot/draft/route.ts` ("INTEGRATION-PENDING"); no `cost_micros` writer in `office/lib/ai/` (column exists, migration 024) | Spend-cap accuracy and SSRF egress are unverified (drafts always need human review) | P2 | One live run; a redirect/DNS-rebinding test; per-model pricing into `cost_micros` |

## I. Dormant cashier (not mounted in any deployment)

| ID | Title | Evidence | Impact | P | Remediation |
|---|---|---|---|---|---|
| TD-047 | Wallet-connect signature has no domain binding | `gateway/internal/alphacashier/signature.go` (plain `personal_sign`) | Replayable within the 10-minute TTL by a look-alike site | P3 | SIWE / EIP-4361 |
| TD-048 | `/cashier` is an information card only | `player/app/components/cashier/CryptoDepositCard.tsx`; STUBBED in the manifest | Nothing to deposit with, behind a flag that is off everywhere | P3 | Decision [D-10](TASKS.md#needs-a-decision) |
| TD-049 | cashier-api concurrency guard unused | `services/cashier-api/src/handlers.mjs` never passes `expectedStatus`; the service has no transition code yet | Guard protects nothing until transitions exist | P3 | Use it when transitions are written |
| TD-050 | SDK, relayer and bridge-watcher are specification only | `packages/cashier-sdk/`, `services/relayer/` (docs), `services/bridge-watcher/` (one fixture adapter) | No deployable non-custodial leg | P3 | None until a money rail is reopened ([ADR-0010](adr/0010-points-only-non-redeemable-launch-boundary.md)) |

## J. Legacy residue and hygiene

| ID | Title | Evidence | Impact | P | Remediation |
|---|---|---|---|---|---|
| TD-051 | Seed JSON still frames markets as sports | `gateway/seed-data.json` (`sportKey` on every market) | Sportsbook residue in seed content | P3 | Re-theme the seed (content decision) |
| TD-052 | Dead mock server and legacy Playwright config | `frontend/packages/mock-server/`, `frontend/playwright.config.ts` alongside the live `playwright.prediction.config.ts` | "Which e2e do I run?" | P3 | Remove as one unit after confirming no user |
| TD-053 | `gofmt` flags one file | `gateway/internal/prediction/types.go` (alignment only) | Cosmetic | P3 | `gofmt -w` |
| TD-054 | App-level guides drifted | `stack/ERRORS.md` (fixed 2026-09-29: 500 is `internal_error`, and there is no 422 `validation_failed`); `stack/API_EXAMPLES.md`, `stack/MIGRATION.md`, `stack/UPGRADE.md` still show `*Cents` wire fields | Examples that no longer match the API | P3 | Rewrite against [SPEC_CURRENT.md](SPEC_CURRENT.md) (warning banners added 2026-09-29) |

## Recently resolved

Fixed on 2026-09-29 (commits `d91b21c2`, `d69d4e73`, `af3d0611`, `185c982f`,
`71350057`, `4924a670`), though older audits still list them as open:

- Alpha cashier withdrawal completion trusted the operator — now requires an
  on-chain transfer from the payout wallet (`MarkWithdrawalCompleted` →
  `VerifyERC20Transfer`).
- The withdrawal KYC threshold could be split across the two rails — now summed
  across both (`payments.CrossRailWithdrawnCents`).
- Alpha cashier deposit/withdrawal requests could race — now serialized per user.
- Cashier admin actions could run without RBAC — refused when a DB is wired.
- Token decimals were trusted from config — checked against the contract at boot.
- `internal/cashier` dead code — deleted; its useful parts rebuilt as
  `gateway/internal/webhookauth` and `gateway/internal/approval`.
- Three copies of the inbound webhook check — one (`webhookauth`).
- `payments/crypto_rail.go` fail-closed stub — removed.
- Node cashier-api: unvalidated input, 500s on constraint errors, non-transactional
  reconciliation, inferred decimals, and the SDK's `permissive_beta` bypass — fixed.

Fixed before 2026-09-29 and dropped from the register after re-verification:
webhook SSRF guard, spoofable actor header, stored XSS in CMS pages, open
redirect, the leaderboard page-size clamp, and the two-person withdrawal default.

## Totals

55 open items: 0 P0, 4 P1 (TD-001, TD-002, TD-005, TD-006), 22 P2, 29 P3.
Backlog, owners and blocking decisions: [TASKS.md](TASKS.md).
