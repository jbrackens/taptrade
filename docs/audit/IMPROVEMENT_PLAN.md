# Tap Trade — Improvement Plan

**Written:** 2026-06-14 · **Status re-verified against the code:** 2026-09-06
**Companion to:** [AUDIT_REPORT.md](AUDIT_REPORT.md) (2026-06-14) · **Completion record:** [ARCH-CLEANUP-2026-06-14.md](ARCH-CLEANUP-2026-06-14.md)

**Ground rules:** every task is sized for one Claude Code session; money-path fixes write their failing test FIRST; structural deletions use `git rm` (history preserved); `go build ./... && go test ./...` and `yarn test` must be green before any commit.

**Path shorthand** (corrected 2026-09-06 — the original `apps/Phoenix-Predict-Combined/...` and `talon-backoffice` roots were renamed away on 2026-07-06 and never existed under those names in this checkout):

- `GW` = `apps/taptrade-platform/go-platform/services/gateway`
- `FE` = `apps/taptrade-platform/frontend/packages`

Effort: S ≤ ½ day · M ≈ 1 day · L ≈ 2–3 days · XL ≈ 1–3 weeks.

> **Read this before picking up a task.** This plan is nearly three months old. Every item below carries a **Status (2026-09-06)** line checked against the code on that date. Five of the twelve are done, two were withdrawn (one was a false positive, one would now delete a live feature), and one is obsolete under the points-only launch. Only the items marked **OPEN** are work.

| Task | Status (2026-09-06) |
|---|---|
| IMP-01 Fix `context.Background()` in payments | **WITHDRAWN** — false positive |
| IMP-02 Add `go vet` to CI | **PARTLY DONE** — code is clean, CI guard still missing |
| IMP-03 Retire AMM code path | **PARTLY DONE** — execution retired; deletion deferred |
| IMP-04 Geo gate as middleware | **OPEN** |
| IMP-05 Delete dead directories | **OPEN** — target list rewritten below |
| IMP-06 Purge sportsbook leakage from api-client | **DONE** 2026-06-14 |
| IMP-07 Remove bonus/freebet/loyalty dead code | **WITHDRAWN** — bonus is a live feature |
| IMP-08 Enable SSR for key pages | **OPEN** |
| IMP-09 Wire multi-tenancy query scoping | **OPEN** |
| IMP-10 Build webhook dispatcher | **DONE** |
| IMP-11 Build gateway OpenAPI spec | **DONE** |
| IMP-12 Build non-custodial settlement leg | **OBSOLETE** — points-only launch |

---

## Phase 1 — Correctness & Security

### IMP-01 · Fix `context.Background()` in payment paths · ~~S~~

**Status (2026-09-06): WITHDRAWN — not a defect.** `ARCH-CLEANUP-2026-06-14.md` §COR-06 dispositioned this as a FALSE POSITIVE on the same day this plan was written, and the fold-in never happened. Both sites — `GW/internal/payments/db_service.go:55` (`ensureSchema`) and `GW/internal/payments/crypto_rail.go:145` (`EnsureCryptoSchema`) — are boot-time DDL called from startup wiring, where there is no request context to thread. The code is unchanged and should stay unchanged. Do not "fix" it.

### IMP-02 · Add `go vet` to CI · S

**Status (2026-09-06): PARTLY DONE.** `go vet ./...` in `GW` now exits 0 — the three struct-tag warnings in `cmd/gateway/migrate_legacy_loyalty.go` are gone. What is still missing is the CI step, so nothing stops them coming back.

- **Finding(s):** SEC-05, QUAL-04
- **Remaining work:** add a `go vet ./...` step to `.github/workflows/test.yml` (or a new `guard-go-vet.yml`). No code fixes needed.
- **Acceptance criteria:** CI fails on a newly introduced `go vet` warning.
- **Effort:** S (30 minutes) · **Risk:** Low · **Dependencies:** None

### IMP-03 · Retire AMM code path · S

**Status (2026-09-06): PARTLY DONE, and the original instruction is now wrong in two places.** AMM *execution* is retired (P2-09): `Service.PlaceOrder` rejects markets left on `execution_mode='amm'`, and the comment in `GW/internal/prediction/service.go` records that `PreviewOrder` may still return read-only curve quotes from `AMMEngine` so legacy AMM market detail can show honest price impact without moving points. `amm.go` and `amm_test.go` therefore still exist **on purpose**.

Two corrections to the original task text:
- Migration slot `040` is taken (`040_finance_compliance_perms.sql`); the head is `056_backfill_exchange_open_interest.sql`. Any new migration takes the next free number.
- `migrations/019_prediction_exchange_engine.sql` still declares `CHECK (execution_mode IN ('order_book','amm'))`. Tightening it to `'order_book'` only is the remaining step, and it requires first confirming no market row is still `amm`.

- **Remaining work (if still wanted):** decide whether the read-only preview path is worth keeping. If yes, this task is done and should be closed — but note that `CLAUDE.md` still describes `internal/prediction/amm.go` as "the pricing engine", which is no longer true and should be corrected there. If no, delete `amm.go`/`amm_test.go`, drop `previewAMMOrder`, and add the tightening migration.
- **Effort:** S · **Risk:** Medium · **Dependencies:** None

### IMP-04 · Geo gate as middleware · S

**Status (2026-09-06): OPEN.** Still per-handler. `GW/internal/http/pretrade_gate.go` exposes `checkComplianceGates(r, userID, surface)` and each money-path handler calls it individually — `prediction_handlers.go:734` and `bot_handlers.go:249`. A new money-path handler is not covered automatically.

- **Finding(s):** SEC-04
- **Approach:** extract the gate into an `http.Handler` middleware wrapping the money-path routes. `permissiveBetaComplianceMode()` must keep working in staging/demo. Note the deposit/withdraw surfaces named in the original task are launch-prohibited routes now — scope the middleware to the trade surfaces that actually exist.
- **Acceptance criteria:** a new money-path handler is covered without touching the handler; `pretrade_gate_test.go` and `edge_auth_gate_test.go` still pass; permissive mode still works in staging.
- **Effort:** S (3–4 hours) · **Risk:** Medium · **Dependencies:** None

---

## Phase 2 — Architecture & Cleanup

### IMP-05 · Delete dead directories · S

**Status (2026-09-06): DONE.** All seven paths below were deleted, and the script
coupling described in the caveat was retired in the same commit. The repository went
from 6,659 tracked files to 2,229.

The original 2026-06-14 target list was wrong in every path: the
`apps/Phoenix-Predict-Combined/` root does not exist, `archive/` and `tmp/` were already
removed (`3ec79f0a`), the "1.0 GB" figure for brand-viegg counted untracked
`node_modules`, and the "Do NOT delete `revival/`" line gave a reason that has never been
true in this checkout.

**The `revival/` protection reason was false and inverted.** It claimed an "active Go module path `phoenix-revival/platform`". `revival/` contains **zero** `.go` files — its tracked content is 1,248 `.md`, 116 `.json`, 96 `.jsonl`, 30 `.txt`, 5 `.csv`. The three Go modules in the repo are `taptrade/platform`, `taptrade/gateway` and `taptrade/auth`; no `phoenix-revival` module exists anywhere. `revival/` is in fact the **largest** dead tree at 75 MB.

**Corrected target list** (measured 2026-09-06):

| Path | Size | Note |
|---|---|---|
| `apps/taptrade-platform/revival/` | 75 MB | see the real caveat below |
| `apps/taptrade-platform/phoenix-backend/` | 20 MB | legacy sportsbook backend, superseded by `go-platform` |
| `apps/taptrade-platform/phoenix-frontend-brand-viegg/` | 14 MB | Next 11 brand frontend; not built by any workflow |
| `apps/taptrade-platform/phoenix-frontend/` | ~0 | empty |
| `.codex-reviews/` | 132 KB | |
| `.context/` | 8 KB | |
| `.gstack/` | 16 KB | |

**The caveat on `revival/`, and how it was resolved:** `revival/` was read *and written*
by ~39 scripts under `apps/taptrade-platform/scripts/`, which wrote reports into
`revival/artifacts/` and `revival/NN_*.md`. It was also named by
`apps/taptrade-platform/Makefile` and by workflows under
`apps/taptrade-platform/.github/workflows/`. All of that was retired together:

- `apps/taptrade-platform/scripts/` — 54 of 56 files deleted. That tree existed to drive
  the JVM stack, the preservation gates, and sportsbook route smoke; 43 of its scripts
  referenced a deleted path directly, and the rest were JVM- or sportsbook-era.
- **Two files were kept**, `scripts/security/cf-firewall.sh` and `cf-firewall.service`.
  `.github/workflows/deploy-demo.yml` runs them on the demo box as
  `/opt/phoenix/scripts/security/cf-firewall.sh`, so they are load-bearing for the live
  deploy. `docker-compose.demo.yml` and `Caddyfile` also point at them by name.
- `apps/taptrade-platform/Makefile` — deleted. All 66 targets drove the deleted scripts.
  Seed, demo and migration helpers live in the gateway Makefile
  (`go-platform/services/gateway/Makefile`) and were never in this one.
- `apps/taptrade-platform/.github/workflows/` — deleted. GitHub only executes the
  workflow directory at the repository root, so these five never ran.
- `ALLOWLIST.md` — deleted. It was the preservation manifest for the trees above and
  addressed them by their pre-rename `apps/Phoenix-Predict-Combined/` paths.

- **Finding(s):** ARCH-01 (partly closed by `3ec79f0a`; see ARCH-CLEANUP §ARCH-01)
- **Acceptance criteria met:** `go build ./...` passes; the gateway Go suite, the player
  app (499 tests) and office (159 tests) pass; `scripts/check-cashier-all.sh`,
  `check-conventions.sh`, `check-openapi-drift.sh` and `check-no-external-symlinks.sh`
  all exit 0; no remaining CI workflow or script references a deleted path.
- **Effort:** S–M · **Risk:** Medium (the script coupling) · **Dependencies:** None

### IMP-06 · Purge sportsbook leakage from api-client · M

**Status (2026-09-06): DONE 2026-06-14.** Landed in `aa18c283`, `ab1a585c` and `ca673163` — see `ARCH-CLEANUP-2026-06-14.md` §ARCH-02 for the per-commit scope and verification. `scripts/check-conventions.sh` rule 6 now fails CI if `betslip|sport_key|punter_bets|freebets|odds_boosts|match_tracker` reappears in the app or api-client production trees. Three residual product/content calls are flagged there, not here.

### IMP-07 · Remove bonus/freebet/loyalty dead code · ~~S~~

**Status (2026-09-06): WITHDRAWN — executing this would delete a live feature.** The premise ("dead sportsbook code") is no longer true. `GW/internal/bonus/` is wired in `internal/http/handlers.go`, backed by migrations `011_campaigns_bonuses.sql`, `012_content.sql` and `042_bonus_money_constraints.sql`, exercised by `internal/http/bonus_handlers_test.go`, and surfaced to players through the `bonus` i18n namespace ("Activity Progress", "This trade contributes {{amount}} toward your bonus"). `GW/internal/loyalty/` likewise carries live predict admin code.

If anything here is still worth doing it is narrow and separate: the legacy promo granter is deliberately left unset (see the comment in `handlers.go`), and `cmd/gateway/migrate_legacy_loyalty.go` is a one-shot migration command that could be retired on its own. Re-scope it as a new task rather than reviving this one.

### IMP-08 · Enable SSR for key pages · M

**Status (2026-09-06): OPEN, unchanged.** 39 of the player app's 40 `page.tsx` files still start with `"use client"`, including all three named below.

- **Finding(s):** ARCH-04
- **Files:** `FE/app/app/predict/page.tsx`, `FE/app/app/market/[ticker]/page.tsx`, `FE/app/app/category/[slug]/page.tsx`
- **Approach:** remove `"use client"` from these three pages; extract the interactive parts (trade ticket, WebSocket price updates) into client components; fetch initial data server-side. Note the i18n init path already renders English synchronously on the server (`app/lib/i18n/config.ts`), so translated copy is available to an RSC render.
- **Acceptance criteria:** market cards appear in the raw HTML of `/predict`; market detail renders initial data in the HTML source; trade ticket and WS still work after hydration.
- **Effort:** M (6–8 hours) · **Risk:** Medium · **Dependencies:** None

---

## Phase 3 — Enterprise & B2B

### IMP-09 · Wire multi-tenancy query scoping · XL

**Status (2026-09-06): OPEN.** The foundation landed and is deliberately dormant: migration `037_multitenancy_foundation.sql` adds `tenant_id NOT NULL DEFAULT 'hula'` to the six core tables, and its own header says "nothing reads `tenant_id` yet". Confirmed — `GW/internal/prediction/sql_repository.go` contains **zero** `tenant_id` references. `internal/tenant/` holds the model only. This is epic steps 2–6 of [ADR-0005](../adr/0005-multi-tenancy-foundation.md).

- **Finding(s):** ENT-01
- **Approach:** (1) put `tenant_id` in the request context from the session or API key; (2) add `AND tenant_id = $N` to every query in `sql_repository.go`; (3) add RLS policies as defence in depth; (4) integration test that tenant A cannot see tenant B's data. Extend `tenant_id` to the remaining tenant-owned tables (`wallet_ledger`, `wallet_reservations`, `events`, `series`, `categories`) per the migration's own note.
- **Effort:** XL (2–3 weeks) · **Risk:** High — touches every query · **Dependencies:** migration 037 (done)

### IMP-10 · Build webhook dispatcher · L

**Status (2026-09-06): DONE.** `GW/internal/webhooks/` ships `dispatcher.go` (with `Run`/`tick`/`process`/`deadLetter`), `deliver.go`, `signer.go`, `secret.go`, `ssrf.go` and `store.go`, all with tests. The dispatcher is constructed in `internal/http/handlers.go`; endpoint CRUD is `internal/http/webhook_admin_handlers.go`; event enqueue is `internal/http/webhook_wiring.go`, post-commit and fire-and-forget. Schema is migration `039_webhooks.sql`.

One documented follow-up remains, in the source rather than here: the transactional-outbox upgrade (enqueue inside the prediction transaction for exactly-once) is deliberately deferred — see the comment on `webhookEnqueuer` in `webhook_wiring.go`.

### IMP-11 · Build gateway OpenAPI spec · M

**Status (2026-09-06): DONE.** The spec is `GW/api/openapi.yaml` (~179 KB) and drift is CI-guarded by `.github/workflows/guard-openapi-drift.yml` → `scripts/check-openapi-drift.sh` (G-04): every documented path must resolve to a route, and no undocumented public route group may appear. The optional extra from the original task — generating the TypeScript client from the spec to replace hand-rolled fetches — was not done; `FE/api-client` is still hand-written.

### IMP-12 · Build non-custodial settlement leg · ~~XL~~

**Status (2026-09-06): OBSOLETE.** The launch model is a non-redeemable points economy — no deposits, no withdrawals, no on-chain leg. `GW/cmd/gateway/main.go` refuses to boot with `ALPHA_CASHIER_ENABLED=true` or the legacy money routes when `ENVIRONMENT` is production or staging, and `internal/compliance/launch_safety.go` redacts the money vocabulary from user-visible copy. The scaffolds this task names (`contracts/`, `services/relayer/`, `services/bridge-watcher/`, `services/cashier-api/`, `packages/cashier-sdk/`) are retired stubs whose own READMEs say they have no runtime consumer; they survive only because `scripts/check-cashier-all.sh` reads their fixtures. See `docs/taptrade-economy-rules.md` and migration `050_points_unit_model.sql`.

Do not restart this without an explicit owner decision to reintroduce a money rail, which is a legal and compliance decision before it is an engineering one.

---

## What is actually left

| Task | Effort | Why |
|---|---|---|
| **IMP-02** `go vet` step in CI | 30m | The code is clean; only the guard is missing |
| **IMP-04** Geo gate as middleware | 3–4h | Defence in depth for new money-path handlers |
| **IMP-05** Delete dead directories | S–M | 109 MB, but retire the coupled scripts in the same commit |
| **IMP-03** Close out or finish the AMM retirement | S | Decide on the read-only preview path |
| **IMP-08** SSR for the three discovery/detail pages | 6–8h | 39/40 pages are client components |
| **IMP-09** Multi-tenancy query scoping | XL | ADR-0005 epic steps 2–6 |

## CI guardrails

| Check | State (2026-09-06) |
|---|---|
| `go vet ./...` | Missing — IMP-02 |
| `grep context.Background() payments/` | Not needed — COR-06 was a false positive |
| `grep ": any\|as any" app/` | Missing — no such rule in `scripts/check-conventions.sh` |
| e2e prediction flow tests | Exists — `.github/workflows/e2e.yml` (P3-11) runs the player app's Playwright suite against a freshly seeded postgres + auth + gateway stack on PRs |
| `go build ./...` | Exists — `test.yml` |
| `go test -race ./...` | Exists — `test.yml` (all three Go modules) and `guard-money-path.yml` (`-count=2` on prediction/wallet/alphacashier) |
| Frontend typecheck | Exists — `frontend-build.yml` runs `yarn workspace @taptrade-ui/app typecheck` |
| `guard-money-path.yml` | Exists |
| `guard-db-migrations.yml` | Exists |
| `guard-conventions.yml` | Exists |
| `guard-openapi-drift.yml` | Exists — IMP-11 |
