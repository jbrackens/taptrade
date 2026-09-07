# Tap Trade — Codebase & Platform Audit

> **Point-in-time record — 2026-06-14.** Kept as history; it is not a description of the system today and not a live plan.
> Two reading notes. (1) **Paths:** this document predates the 2026-07-06 directory rename. Read `apps/Phoenix-Predict-Combined/go-platform/...` as `apps/taptrade-platform/go-platform/...` and `talon-backoffice/packages/...` as `frontend/packages/...`. (2) **Units:** it says "cents". Migration `050_points_unit_model.sql` (2026-07-07) renamed every `*_cents` column to `*_points`; the launch unit is non-redeemable Points, not money.
> **Current status of the findings:** re-verified 2026-09-06 in [IMPROVEMENT_PLAN.md](IMPROVEMENT_PLAN.md), which carries a per-task status table. Read that before acting on anything here.

**Date:** 2026-06-14
**Auditor:** Claude (Opus 4.6), full-codebase engagement with delegated workstreams + independent verification
**Branch audited:** `main` @ HEAD
**Prior audit:** 2026-06-12 (Fable 5, branch `chore/safe-brand-text-cleanup`, overall grade C)
**Scope:** this repository only; judged against an enterprise-grade, commercially deployable B2C + B2B bar with a hybrid-CLOB (off-chain matching, on-chain settlement) target architecture.

---

## 1. Executive Summary

### Health grades

| Workstream | Grade | Prior (Jun-12) | One-line verdict |
|---|---|---|---|
| A. Money-path correctness | **B** | C+ | CRITICAL settle/void race (COR-01) fixed with status-guarded CAS + regression test; maker fill regression (COR-02) fixed with MakerPreFill guard; settlement batched (COR-05); held-funds SUM fail-closed (COR-04). Remaining: `context.Background()` in payment paths, ~25 ignored errors on money/audit writes |
| A2. On-chain settlement leg | **D+** | D+ | Unchanged — alpha cashier is custodial with real guardrails (reorg detection, two-person withdrawal, sanctions screening); non-custodial stack remains specification-only (SDK types + API scaffold + interface Solidity, no running service) |
| B. Security | **B** | B− | Bot API compliance bypass (SEC-02) fixed; geo anti-spoof (SEC-03) fixed with EDGE_SHARED_SECRET + constant-time compare; per-API-key rate limiting added. Boot validation is comprehensive (15+ prod-blocking checks) |
| C. Architecture & boundaries | **C+** | C | Exchange engine merged to main (no stale branch divergence); CLOB is clean price-time priority with complementary issuance. Still: 1.7 GB dead directories, sportsbook leakage in api-client, 33/34 pages `"use client"` |
| D. Code quality | **B** | B− | Player app: 0 `any` in source, 0 `@ts-ignore` in source (103 count is all auto-generated `.next/types`), 2 `console.*` violations. Go: 0 panics in request paths, `go vet` has 3 warnings in a non-critical migration helper |
| E. Build, test, operability | **B** | B | 145 Go test files pass (including race/property/fuzz), 203 TS tests pass, `tsc --noEmit` clean, 31+ migrations apply. CI has 9 workflows including `guard-money-path.yml`. No e2e coverage for prediction flows |
| F. Performance & scalability | **B−** | C− | WS slow-client fixed (PERF-03) with non-blocking sends + disconnect + Prometheus metrics; Redis pub/sub backbone added (P2-07) enabling multi-instance. Remaining: OFFSET-based pagination (4 locations), no read cache |
| G. Enterprise & commercial | **D+** | D | Multi-tenancy foundation laid (migration 037, 6 tables, dormant). Partner RBAC (038) and webhook schema (039) added. But: no query-boundary scoping, no webhook dispatcher, no OpenAPI for gateway, no sandbox |

**Overall: B− — a strong, money-safe matching engine wrapped in an improving but still incomplete enterprise shell, with the critical correctness and security findings from the prior audit now fixed.**

### How bad is it really?

The core is genuinely good. The CLOB exchange engine (`exchange.go`, 726 lines) is the best code in the repo: deterministic, pure, well-tested (596-line test file), with price-time priority, complementary issuance, self-match prevention, and partial fills. The wallet ledger is integer-cents with idempotency keys on every mutation, `FOR UPDATE` row locking, and `SERIALIZABLE` isolation on captures. The settlement engine now has a status-guarded CAS (`WHERE id=$11 AND status=$12` + `RowsAffected` check) that prevents the settle/void race, verified by a dedicated regression test (`sql_settlement_race_test.go:83`).

What remains to fix: (1) the on-chain settlement leg is custodial-only — users' funds sit in one treasury wallet and withdrawals require a human operator to broadcast; the non-custodial stack is 1,354 lines of TypeScript specification and three Solidity interfaces with zero deployable code; (2) roughly 1.7 GB of dead sportsbook residue should be deleted; (3) `context.Background()` in payment paths (`crypto_rail.go:146`, `db_service.go:55`) orphans the request context, breaking tracing and cancellation; (4) multi-tenancy has schema but no query enforcement — a second operator cannot run without forking.

### Top 10 findings

| # | ID | Sev | Finding | Status |
|---|---|---|---|---|
| 1 | COR-01 | ~~CRITICAL~~ | Settle/void race pays both sides | **FIXED** — `transitionMarketStatusWithExec` at `sql_repository.go:484-506` |
| 2 | SEC-02 | ~~HIGH~~ | Bot API bypasses compliance gate | **FIXED** — compliance gate at `bot_handlers.go:206` |
| 3 | SEC-03 | ~~HIGH~~ | Geo-fence spoofable via direct-to-origin | **FIXED** — `EDGE_SHARED_SECRET` anti-spoof at `pretrade_gate.go:57-84` |
| 4 | COR-02 | ~~HIGH~~ | Maker fill state regressed by stale writes | **FIXED** — `MakerPreFill` guard at `exchange.go:66` |
| 5 | PERF-03 | ~~HIGH~~ | WS slow client freezes realtime plane | **FIXED** — non-blocking sends + disconnect metrics in `client.go` |
| 6 | A2-01 | HIGH (strategic) | Live cashier is custodial; non-custodial stack is specification-only | OPEN |
| 7 | ARCH-01 | MEDIUM | 1.7 GB dead directories (viegg 1.0 GB, phoenix-backend 18 MB, archive 632 MB) | OPEN |
| 8 | COR-06 | MEDIUM | `context.Background()` in payment paths orphans request context | OPEN — `crypto_rail.go:146`, `db_service.go:55` |
| 9 | ENT-01 | MEDIUM | Multi-tenancy is schema-only — no query scoping, no RLS, no auth-claim extraction | OPEN |
| 10 | ARCH-02 | MEDIUM | 159 sportsbook term violations in active code; `api-client` exports 15+ dead sportsbook methods | OPEN |

---

## 2. Findings

Severity rubric: **CRITICAL** = money loss / double-settlement / auth bypass / data corruption / repo doesn't build. **HIGH** = exploitable security flaw, conditional correctness bug, missing money-path tests, architecture blocking safe work. **MEDIUM** = significant debt/drift/dead weight. **LOW** = style/docs.

All paths relative to `apps/Phoenix-Predict-Combined/go-platform/services/gateway/` unless noted. Findings marked **✓self** were verified by direct code reading; others from delegated analysis with spot-verification.

### A. Money-path correctness (Grade: B)

**COR-01 · ~~CRITICAL~~ FIXED · Settle/void race pays both sides ✓self**
- Prior finding: `PersistResolvedMarketAtomic` and `PersistVoidedMarketAtomic` both wrote market status without a status guard. Two concurrent operations (settle + void) on the same market could both commit — winners paid 100¢/contract AND all holders refunded.
- Fix: `transitionMarketStatusWithExec` at `sql_repository.go:484-506` now issues `UPDATE ... WHERE id=$11 AND status=$12`, checks `RowsAffected()==1`, returns `ErrStaleMarketStatus` on miss. Called by both `PersistResolvedMarketAtomic` (line 947) and `PersistVoidedMarketAtomic` (line 1247) before any payouts.
- Regression test: `sql_settlement_race_test.go:83` — `TestConcurrentSettleAndVoidCannotBothCommit`.
- **Verdict: Correctly fixed. The pattern mirrors the proposal-path guard the author had already written.**

**COR-02 · ~~HIGH~~ FIXED · Maker fill state regressed by stale writes ✓self**
- Prior finding: Match plans were built before the per-market advisory lock; maker order rows were written with absolute values from the pre-lock plan.
- Fix: `MakerPreFill` map added to `MatchPlan` (`exchange.go:60-66`). `recordMakerPreFill` (line 155) captures pre-plan state. `updateMakerFillStateGuardedWithTx` (`sql_exchange_repository.go:148`) issues a guarded UPDATE that checks pre-fill state, preventing stale writes.
- **Verdict: Correctly fixed. Phantom liquidity under concurrent taker flow is prevented.**

**COR-04 · ~~MEDIUM-HIGH~~ FIXED · Held-funds SUM failure weakened insufficient-funds check ✓self**
- Prior finding: `wallet/service.go` swallowed the held-funds SUM error with `_ =`, defaulting to `heldTotal=0`.
- Fix: `wallet/service.go:598-606` — error now propagated with `return Reservation{}, fmt.Errorf("sum held reservations: %w", err)`. Comment at line 598-600 explicitly references the audit finding.
- **Verdict: Correctly fixed. Fails closed on query failure.**

**COR-05 · ~~MEDIUM~~ FIXED · Settlement was one transaction over all positions ✓self**
- Prior finding: All position payouts committed in a single transaction — large markets would hold locks and risk timeout.
- Fix: Batched settlement via `PersistSettlementHeader` (line 569) + `CommitPayoutBatch` (line 588) pattern. Settlement header commits fast (market status + settlement record), then payouts disburse in configurable batches with resume capability.
- **Verdict: Correctly fixed.**

**COR-06 · MEDIUM · `context.Background()` in payment paths orphans request context ✓self**
- Evidence: `internal/payments/crypto_rail.go:146` and `internal/payments/db_service.go:55` both create `context.WithTimeout(context.Background(), paymentDBTimeout)`.
- Impact: upstream request cancellation (client disconnect, HTTP timeout) will not propagate to in-flight payment DB operations. Tracing context is also lost — payment operations will not appear in distributed traces.
- These are the only two production (non-test) instances in payment code.

**COR-07 · LOW · ~25 ignored errors on money/audit writes (improved but not eliminated)**
- Representative: `prediction/service.go:1036,1070` (taker order update after rejection), `settlement.go:153,188,227,278,317,380,593,730` (lifecycle/audit writes), `alphacashier/service.go:411` + 10× ignored `recordAudit`.
- Impact: silent audit-trail gaps. The critical `wallet/service.go:598` case (COR-04) has been fixed.

### B. Security (Grade: B)

**SEC-02 · ~~HIGH~~ FIXED · Bot API compliance bypass ✓self**
- Prior finding: Bot/partner API placed orders with no geo/KYC compliance gate.
- Fix: `bot_handlers.go:206` applies the compliance gate to bot order path. Comment at line 19 acknowledges the audit finding. Per-API-key rate limiting added at line 33 via `userRateLimiter` (`ratelimit.go`).
- **Verdict: Correctly fixed.**

**SEC-03 · ~~HIGH~~ FIXED · Geo-fence spoofable via direct-to-origin ✓self**
- Prior finding: Gateway trusted `CF-IPCountry` header; direct-origin requests bypassed the edge that strips forged headers.
- Fix: `pretrade_gate.go:57-84` — `EDGE_SHARED_SECRET` anti-spoof with `subtle.ConstantTimeCompare`. Required in prod/staging when `GEO_TRUSTED_PROXY_MODE=require` (boot fails without it). Money-path requests without the secret are denied.
- **Verdict: Correctly fixed.**

**SEC-04 · LOW · Geo gate applied per-handler, not as middleware**
- Evidence: `pretrade_gate.go:150-151` — `permissiveBetaComplianceMode()` bypasses both geo and KYC gates. The geo gate function is called explicitly in each money-path handler rather than as middleware.
- Risk: a new money-path handler could omit the gate call. Mitigated by `BETA_COMPLIANCE_MODE=permissive` being explicitly forbidden in production (`main.go:267`).
- Low severity because boot validation catches the most dangerous configuration.

**SEC-05 · LOW · `go vet` warnings undetected by CI**
- Evidence: `cmd/gateway/migrate_legacy_loyalty.go` lines 39-41 — 3 warnings for unexported struct fields with json tags. CI does not run `go vet`.
- Impact: these specific warnings are in a non-critical migration helper and do not affect runtime correctness. But the missing CI check means future `go vet` issues also ship undetected.

### C. Architecture & boundaries (Grade: C+)

**ARCH-01 · MEDIUM · 1.7 GB of dead directories ✓self**

| Directory | Files | Size | Referenced? | Verdict |
|-----------|-------|------|-------------|---------|
| `phoenix-frontend-brand-viegg/` | 90,557 | 1.0 GB | No | DELETE — committed node_modules from dead sportsbook frontend |
| `archive/` | 19,032 | 632 MB | No | DELETE or move out of tree |
| `phoenix-backend/` | 1,719 | 18 MB | No | DELETE — legacy Scala backend |
| `revival/` | 510 | 20 MB | Yes (Go module path) | KEEP — `phoenix-revival/platform` is the active Go module name |
| `tmp/` | 32 | 19 MB | No | DELETE |
| `.codex-reviews/` | 11 | 128 KB | No | DELETE |
| `.context/` | 1 | 4 KB | No | DELETE |

**ARCH-02 · MEDIUM · 159 sportsbook term violations in active code ✓self**
- Breakdown: `fixtures` (80), `betslip` (35), `selections` (34), `freebets` (7), `match_tracker` (2), `sport_key` (1).
- Worst offender: `api-client/src/client.ts` (10 hits) — exports `fixtures`, `freebets`, `selections`, `match-tracker` endpoints as first-class methods. Every consumer inherits sportsbook vocabulary through it.
- Active Go backend is largely clean — most violations are in e2e test suites (`e2e/player-app/responsive.spec.ts`, `e2e/backoffice/trading.spec.ts`) and the bonus service (`bonus/service.go`).

**ARCH-03 · MEDIUM · No single API source of truth for prediction flows**
- The `api-client` package covers only sportsbook-era endpoints. Prediction-market flows bypass it entirely — both `app/` and `office/` hand-roll `fetch()` calls (15+ in player app, 11+ in office).
- Impact: no type-safe contract between frontend and gateway for prediction endpoints.

**ARCH-04 · LOW · 33/34 page.tsx files marked `"use client"` ✓self**
- The entire player app renders client-side, forfeiting SSR/streaming benefits. This is a performance concern for SEO-critical pages (discovery, market detail) but not a correctness issue.

**ARCH-05 · INFORMATIONAL · Exchange engine is on main (no branch divergence)**
- Verified: `feat/binary-exchange-engine` has 0 unique commits vs main (76 behind). The CLOB exchange engine work is already fully merged.

**ARCH-06 · POSITIVE · Gateway layering is clean**
- Handlers → domain services → repositories is consistently enforced. 5 minor handler-layer SQL direct-access cases exist (`provider_ops_audit_store.go`, `predict_privacy_handlers.go`, `discover_handlers.go`) but these are read-only queries, not write-path violations.
- `modules/platform/` is a genuine shared library (canonical market model, httpx middleware, runtime utilities) — not a dumping ground.
- `prediction` package correctly depends on `WalletAdapter` interface, never imports `wallet` directly.

### D. Code quality (Grade: B)

**QUAL-01 · LOW · `any` type usage is confined to dead/generated code ✓self**
- 252 total `any`/`as any` instances across the monorepo. Breakdown:
  - `mock-server/` (dead): 27
  - `api-client/src/client.ts` (sportsbook surface): 10
  - Player app source (`app/`): **0**
  - The `any` count is not a quality problem for the active prediction codebase.

**QUAL-02 · LOW · `@ts-ignore` count is zero in source ✓self**
- 103 instances — ALL in auto-generated `.next/types/validator.ts`. Zero in developer-authored code.

**QUAL-03 · LOW · 2 `console.*` violations in production code ✓self**
- Down from 26 in the prior audit. The remaining 2 are minor.

**QUAL-04 · LOW · Go build is clean; `go vet` has 3 non-critical warnings**
- `go build ./...` passes. `go test ./...` passes (145 test files). `go vet` flags 3 unexported struct fields with json tags in `cmd/gateway/migrate_legacy_loyalty.go:39-41`. CI does not run `go vet`.

### E. Build, test, operability (Grade: B)

**OPS-01 · MEDIUM · No e2e coverage for prediction flows**
- Existing e2e suites (`e2e/player-app/`, `e2e/backoffice/`) exercise sportsbook flows only. No prediction-market e2e tests exist.
- Unit/integration testing is strong: 145 Go test files including race tests (`-race`), property tests, fuzz tests, and the settlement race regression test. 203 TS tests pass.

**OPS-02 · LOW · CI is comprehensive**
- 9 workflows: `guard-money-path.yml`, `guard-db-migrations.yml`, `guard-openapi-drift.yml`, `guard-conventions.yml`, e2e, deploy-demo, test.yml.
- Missing: `go vet` in CI.

**OPS-03 · LOW · No database backup/DR automation**
- No backup scripts, cron jobs, or DR documentation. The cashier docs mention "provision primary and backup RPC providers" but no DB disaster recovery.

### F. Performance & scalability (Grade: B−)

**PERF-03 · ~~HIGH~~ FIXED · WS slow client freezes realtime plane ✓self**
- Fix: Non-blocking sends with `droppedMessagesTotal` and `slowClientsDisconnectedTotal` Prometheus counters in `client.go`. Slow clients are detected and disconnected.
- P2-07 Redis pub/sub backbone added via `Backbone` interface in `hub.go` — enables multi-instance gateway with shared realtime.
- **Verdict: Correctly fixed.**

**PERF-01 · MEDIUM · OFFSET-based pagination (4 locations) ✓self**
- Evidence: `sql_repository.go:153`, `:251`, `:565`, `:1595`.
- Impact: `OFFSET N` scans and discards N rows. On deep pages (page 1000+) this becomes a full-table scan. No pagination endpoint clamps `PageSize`.
- For current scale this is not a problem; it becomes one with growth.

**PERF-02 · LOW · No read cache in gateway**
- The gateway has no Redis-backed read cache despite older docs claiming one. All reads hit PostgreSQL directly. Fine at current scale.

### A2. On-chain settlement leg (Grade: D+)

**A2-01 · HIGH (strategic) · Non-custodial stack is specification-only**

| Component | Status | Detail |
|-----------|--------|--------|
| Web2 wallet (internal ledger) | **Production-ready** | Full CRUD, holds, captures, idempotent, integer-cents, `FOR UPDATE` + `SERIALIZABLE` |
| Alpha cashier (custodial) | **Functional with guardrails** | Live in gateway, deposits verified on-chain (USDC on Base, chain 8453), 12-block confirmation, 64-block finality recheck, reorg detection + freeze, two-person withdrawal, sanctions screening, daily limits, boot validation |
| Cashier-SDK (TS) | **Complete specification** | 1,354 lines: domain types, state machines, validators, idempotency key builders, relayer policy evaluator, HMAC verification. 720 lines tests. Not connected to chain or DB |
| Cashier-API (Node) | **Scaffold** | Handlers, SQL repository, 481-line migration with DB-level state-machine triggers, OpenAPI 3.1 spec (474 lines), 1,013 lines tests. Uses mock provider adapter. Not wired to real chain |
| Smart contracts | **Interface sketches** | 3 Solidity ^0.8.24 interfaces (`IHulaCashierCollateral`, `IHulaCashierTradeAuthorization`, `IHulaCashierRecovery`). Zero implementations, tests, or deployment artifacts |
| Relayer | **Unbuilt** | README + policy doc only. The `evaluateRelayerPolicy()` function exists in cashier-sdk (TypeScript), not as a service |
| Bridge-watcher | **Mock only** | One file: `src/local-provider-adapter.mjs` reads JSON fixtures from disk. No RPC, no polling, no reorg handling |

- The UI uses the Web2 wallet for all trading. Alpha cashier is behind `ALPHA_CASHIER_ENABLED`.
- The non-custodial cashier page exists (`app/cashier/page.tsx`) but connects to the unbuilt cashier-api.

### G. Enterprise & commercial readiness (Grade: D+)

**ENT-01 · MEDIUM · Multi-tenancy is schema-only**
- Migration `037_multitenancy_foundation.sql` adds `tenants` table and `tenant_id TEXT NOT NULL DEFAULT 'hula'` to 6 core tables (punters, markets, orders, positions, payouts, wallet_balances). Indexes exist.
- No query-boundary scoping, no auth-claim tenant extraction, no RLS, no per-tenant RBAC.
- A second operator cannot run without forking — all queries are un-scoped.

**ENT-02 · MEDIUM · Webhook infrastructure is schema-only**
- Migration `039_webhooks.sql` creates `webhook_endpoints` and `webhook_deliveries` tables with proper delivery outbox pattern (pending/delivered/failed, exponential backoff, partial index on due rows).
- No dispatcher worker exists. No endpoint registration API. The schema is well-designed but not yet backed by code.

**ENT-03 · MEDIUM · Partner RBAC added but thin**
- Migration `038_partner_api_rbac.sql` adds `partners:read` and `partners:write` permissions, granted to super-admin.
- The bot API has per-API-key rate limiting (`bot_handlers.go:84`) — this is new and good.
- No OpenAPI spec for the main gateway API (only cashier-api has one).

**ENT-04 · LOW · Boot validation is comprehensive (strength)**
- `validateGatewayRuntimeConfig` (`main.go:187-306`) blocks prod/staging boot without: geo gate enabled + allowlist, KYC posture explicitly stated, real DB credentials, real webhook secret, DB-backed audit store, `BETA_COMPLIANCE_MODE=permissive` forbidden in production. 15+ distinct checks.
- This is a genuine enterprise-grade control that exceeds many production systems.

---

## 3. Prior Audit Disposition (Jun-12 → Jun-14)

| Finding | Prior Sev | Status | Evidence |
|---|---|---|---|
| COR-01 settle/void race | CRITICAL | **FIXED** | `transitionMarketStatusWithExec` at `sql_repository.go:484-506`, regression test at `sql_settlement_race_test.go:83` |
| COR-02 maker fill regression | HIGH | **FIXED** | `MakerPreFill` map at `exchange.go:60-66`, guarded UPDATE at `sql_exchange_repository.go:148` |
| COR-04 held-funds SUM swallowed | MEDIUM-HIGH | **FIXED** | Fail-closed return at `wallet/service.go:601-606` |
| COR-05 single-tx settlement | MEDIUM | **FIXED** | Batched via `PersistSettlementHeader` + `CommitPayoutBatch` pattern at `settlement.go:569,588` |
| SEC-02 bot API compliance bypass | HIGH | **FIXED** | Compliance gate at `bot_handlers.go:206` |
| SEC-03 geo-spoof via direct-to-origin | HIGH | **FIXED** | `EDGE_SHARED_SECRET` + constant-time compare at `pretrade_gate.go:57-84` |
| PERF-03 WS slow client blocks hub | HIGH | **FIXED** | Non-blocking sends + disconnect + Prometheus metrics in `client.go` |
| P2-07 WS single-instance only | HIGH | **FIXED** | Redis pub/sub backbone via `Backbone` interface in `hub.go` |
| COR-03 AMM unlocked read-modify-write | HIGH | **MITIGATED** | New markets default to `order_book` (`service.go:652-656`); AMM is legacy-only. `PlaceOrder` rejects `execution_mode='amm'` markets. Strategic recommendation: retire AMM code |
| A2-01 custodial-only cashier | CRITICAL (strategic) | **OPEN** | Non-custodial stack remains specification-only |

**7 of 10 top findings from the prior audit have been fixed.** The fixes are correct and well-tested. The remaining items are strategic (on-chain architecture) or require the AMM to be formally retired.

---

## 4. Strategic Decision: Refactor vs. Rewrite

### Layer-by-layer stack fitness

| Layer | Language | Fit for CLOB pred-market | Verdict |
|---|---|---|---|
| Matching engine + settlement | Go | **Excellent** — integer arithmetic, goroutine concurrency, strong type system, `pg_advisory_xact_lock` serialization. The exchange engine is the best code in the repo. | **KEEP** |
| Gateway HTTP + auth | Go | **Good** — stdlib `net/http` + custom middleware is lean and fast. RBAC is clean. | **KEEP** |
| WebSocket hub | Go | **Good** — hub-and-spoke with Redis backbone works. Prometheus metrics. | **KEEP** |
| Player app | Next.js/React/TS | **Adequate** — App Router is modern, Redux Toolkit works, Tailwind is fine. SSR is mostly forfeited (33/34 `"use client"`) but fixable without rewrite. | **KEEP, improve SSR** |
| Backoffice | Next.js/Ant Design/TS | **Adequate** — Pages Router + parallel App Router is messy but functional. | **KEEP** |
| API client | TypeScript | **Replace surface** — sportsbook-era endpoints dominate. Prediction flows bypass it. | **REWRITE this package** |
| Smart contracts | Solidity | **Not yet built** — interfaces only. No assessment possible on code quality. | **BUILD** |
| Relayer / bridge-watcher | N/A | **Not yet built** — design docs only. | **BUILD** |
| Cashier-SDK | TypeScript | **Good specification** — 1,354 lines of clean types + validators. | **KEEP as spec, build implementation** |

### Option analysis

**Option A: Evolve in place (RECOMMENDED)**
- The matching engine, wallet ledger, and settlement engine are production-quality code that would be expensive to rewrite and easy to break. The exchange engine alone is 726 lines of deterministic, well-tested logic with price-time priority, complementary issuance, and self-match prevention.
- The critical correctness and security findings have been fixed. The remaining work is additive (build the on-chain leg, wire multi-tenancy, add enterprise features) not corrective.
- Estimated effort to reach enterprise-grade: 3-4 months with current stack.

**Option B: Partial rewrite at engine seam**
- Replace the matching engine in a different language (Rust, C++) while keeping the Go gateway.
- Not justified: the Go engine is the *strongest* code. Rewriting it introduces risk for no measurable gain. Go's integer arithmetic is exact, its concurrency model is well-suited, and the existing test suite provides a safety net.

**Option C: Full rewrite**
- Not justified by the evidence. The core is sound. The problems are at the edges (dead code, missing enterprise features, unbuilt on-chain leg) — none of which a rewrite addresses. A rewrite would discard 7 months of hardened money-path code and its test suite.

### Recommendation

**Option A: Evolve in place.** The matching engine, ledger, and settlement code have earned trust through two audits and systematic fix verification. The right sequence is:

1. **Phase 1 (correctness/security):** Fix `context.Background()` in payment paths, add `go vet` to CI, formalize AMM retirement
2. **Phase 2 (architecture/cleanup):** Delete 1.7 GB dead directories, purge sportsbook leakage from api-client, build prediction-typed API client
3. **Phase 3 (enterprise):** Wire multi-tenancy query scoping, build webhook dispatcher, build non-custodial settlement leg

---

## 5. Strengths to Preserve

These are genuinely well-built and should not be refactored, rewritten, or "improved" without specific cause:

1. **Exchange engine** (`exchange.go`) — pure deterministic `BuildPlan` that takes a snapshot and produces a `MatchPlan`. No side effects, no DB access, no mutation. Caller owns the transaction, lock, and persistence. This is textbook engine design.

2. **Status-guarded CAS on market transitions** (`transitionMarketStatusWithExec`) — the fix for COR-01 is now the canonical pattern. `WHERE id=$N AND status=$M` + `RowsAffected` check prevents all concurrent-transition races.

3. **WalletAdapter interface** — `prediction` package depends on `WalletAdapter` interface, not `wallet` directly. Concrete bridge in `prediction_wallet_adapter.go`. This keeps the domain replaceable.

4. **Idempotency key discipline** — every wallet mutation uses a scoped key: `prediction_order:<key>`, `prediction_payout:<settlementID>:<positionID>`, `prediction_void:<marketID>:<positionID>`. Re-running settle/void is safe.

5. **Boot validation** (`validateGatewayRuntimeConfig`) — 15+ checks that block prod boot without proper configuration. `BETA_COMPLIANCE_MODE=permissive` forbidden in production. This is better than most production systems.

6. **Integer-cents money** — no floating-point in the money path. `CHECK (yes_price_cents + no_price_cents = 100)` enforced at the DB level.

7. **Per-market advisory lock** — `pg_advisory_xact_lock(hashtext(market_id))` serializes all matches within a market without locking the entire table.

8. **Batched settlement with resume** — `PersistSettlementHeader` commits the market status fast, then `CommitPayoutBatch` disburses in configurable batches. If the process dies mid-payout, it resumes from where it left off.

9. **Alpha cashier guardrails** — reorg detection + deposit freeze, two-person withdrawal control, fail-closed sanctions screening, daily deposit limits, boot validation. For a custodial system, this is well-defended.

10. **Test culture** — race tests, property tests, fuzz tests, dedicated regression tests for audit findings. 145 Go test files, 203 TS tests.

---

## 6. Verification log

Commands run and results (representative, not exhaustive):

```
# COR-01 fix verification
grep -n "transitionMarketStatusWithExec" sql_repository.go
  → lines 484, 947, 1003, 1247 — function defined and called in both settle + void paths

grep -n "AND status=\$" sql_repository.go
  → line 491: WHERE id=$11 AND status=$12

grep -n "TestConcurrentSettleAndVoid" sql_settlement_race_test.go
  → line 83,91,92 — regression test exists

# COR-02 fix verification
grep -n "MakerPreFill" exchange.go
  → lines 60,66,155,157,158 — map defined, populated, used

# COR-04 fix verification
Read wallet/service.go:595-609
  → error propagated at line 606, comment references COR-04

# SEC-02 fix verification
grep -n "compliance" bot_handlers.go
  → line 206 — compliance gate applied

# SEC-03 fix verification
Read pretrade_gate.go:57-84
  → EDGE_SHARED_SECRET with subtle.ConstantTimeCompare

# PERF-03 fix verification
grep -n "droppedMessagesTotal\|slowClientsDisconnected" client.go
  → Prometheus counters present

# context.Background() verification
grep -rn "context.Background()" payments/crypto_rail.go payments/db_service.go
  → crypto_rail.go:146, db_service.go:55 — confirmed in non-test code

# Dead directory sizes
du -sh phoenix-frontend-brand-viegg/ phoenix-backend/ archive/ revival/ tmp/
  → 1.0G, 18M, 632M, 20M, 19M

# Sportsbook leakage count
grep -rn "fixtures|betslip|selections|freebets|match_tracker|sport_key" (active code)
  → 159 violations

# any type verification (player app source)
grep -rn ": any\|as any" app/ (excluding node_modules, .next, test files)
  → 0 in player app source

# ts-ignore verification
grep -rn "@ts-ignore\|@ts-nocheck" (all source, excluding .next/types)
  → 0 in developer-authored code

# OFFSET pagination
grep -n "OFFSET" sql_repository.go
  → lines 153, 251, 565, 1595

# Rate limiting
grep -n "userRateLimiter\|botRateLimitMiddleware" bot_handlers.go ratelimit.go
  → Per-API-key rate limiting at bot_handlers.go:66,84

# Build verification
go build ./... → clean
go test ./... → 145 test files pass
tsc --noEmit → clean
yarn test → 203 tests pass

# go vet
go vet ./... → 3 warnings in cmd/gateway/migrate_legacy_loyalty.go:39-41
```

---

## 7. Appendix: AMM retirement note

The LMSR AMM (`internal/prediction/amm.go`) uses float64 throughout — mathematically necessary for the cost function `C(q) = b * ln(e^(q_yes/b) + e^(q_no/b))` but a correctness hazard compared to the integer-cents CLOB. The AMM path has an unlocked read-modify-write with no serialization retry (prior finding COR-03).

Current mitigation: `PlaceOrder` (`service.go:652-656`) rejects any `execution_mode='amm'` market. All new markets default to `order_book`. The AMM is effectively retired at the application level but still compiled and wired.

Recommendation: formally remove the AMM code path. Delete `amm.go`, remove the `execution_mode` column or constrain it to `'order_book'`, and drop the float64 fields from the `Market` struct. This eliminates ~100 lines of high-risk dead code.
