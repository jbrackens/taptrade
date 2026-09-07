# Tap Trade — Platform Architecture

Prediction-market platform: binary YES/NO contracts priced 1–99 Points (price =
implied probability, `yes + no = 100`), winners pay 100 Points/contract at
settlement. Forked from a sportsbook codebase on 2026-04-16 and transformed to
the prediction domain; the shared infrastructure (auth, wallet/ledger, WebSocket
hub, CSRF) was kept.

The platform is **points-only and non-redeemable**. Migration `050_points_unit_model.sql`
renamed every active `*_cents` column to `*_points` (a rename only — no stored
value changed), and `GET /api/v1/status` reports `pointMode: non_redeemable_points`.
The legacy money-route tree (deposits, withdrawals, payment webhooks, crypto, the
alpha custodial cashier) is **not mounted by default** — those paths return 404 —
and `TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED=true` is refused at boot when
`ENVIRONMENT` is `production` or `staging`.

> This document describes the system **as it actually runs**. The previous
> sportsbook-era ARCHITECTURE.md (and a fictional Kubernetes/Prometheus/ELK
> topology) was retired in the P2-04 / ARCH-01 cleanup; those trees were deleted
> from the working tree and survive only in git history (commit `3ec79f0a`).
> The real deployment is a single Hetzner box running docker-compose behind
> Caddy — see [DEPLOYMENT.md](DEPLOYMENT.md).

## Surfaces

| Surface | Path | Stack | Port |
|---|---|---|---|
| Player app | `frontend/packages/app` | Next.js 16 App Router, React 19, Redux Toolkit v1, React Query, Tailwind | 3000 (3010 in README quick-start) |
| Backoffice | `frontend/packages/office` | Next.js (Pages + App Router), Ant Design 5, styled-components | 3001 |
| API gateway | `go-platform/services/gateway` | Go 1.25, stdlib `net/http` + `httpx` middleware, `lib/pq` | 18080 |
| Auth service | `go-platform/services/auth` | Go, opaque bearer tokens (SHA-256 digests), bcrypt | 18081 |
| PostgreSQL 16 | docker-compose `postgres` | goose migrations | 5434 (host) |
| Redis | docker-compose `redis` | auth sessions + auth rate limiting; optional cross-instance WS backbone | 6380 (host) |

## Request topology

```
            Browser (player app / backoffice)
                    │  REST + WebSocket, HttpOnly cookies + CSRF double-submit
                    ▼
            Caddy (edge) ── strips client geo headers, stamps X-Edge-Auth,
                    │         terminates TLS, basic_auth gate on office host
                    ▼
   ┌────────────────────────────────────────────────────────────┐
   │ Gateway (:18080)  — httpx middleware chain:                 │
   │   Recovery → Metrics → AccessLog → CSRF → Auth → RequestID  │
   │   internal/prediction   CLOB exchange engine                │
   │   internal/wallet       points ledger (idempotent, FOR UPDATE)│
   │   internal/compliance   geo gate + KYC + responsible-trading │
   │   internal/rbac         staff RBAC                          │
   │   internal/ws           hub + cross-instance backbone       │
   └───────┬───────────────────────────────────┬────────────────┘
           │ validates session cookie           │ reads/writes
           ▼                                     ▼
   Auth service (:18081)                  PostgreSQL 16
   opaque tokens in Redis/file store      (single writer)
```

Key decoupling: the `prediction` package never imports `wallet` — it depends on
the `WalletAdapter` interface (`internal/prediction/wallet_adapter.go`), bridged
in `internal/http/prediction_wallet_adapter.go`.

## The money path (highest-weight subsystem)

**Order placement** (`internal/prediction/service.go: PlaceOrder`):
1. Idempotency check (`GetOrderByIdempotencyKey`).
2. Responsible-trading gate (atomic, before any money moves).
3. Compliance gate (geo/KYC) — applied at the HTTP layer on both the session
   route and the bot route (`internal/http/pretrade_gate.go`).
4. Branch on `execution_mode`:
   - **`order_book`** (every market): `placeExchangeOrder` →
     `ExchangeEngine.BuildPlan` (price-time priority, complementary issuance,
     self-match prevention, partial fills) → `PersistMatchAtomic`. Matching is
     serialized per market by `pg_advisory_xact_lock(hashtext(market_id))`; maker
     fill state is re-asserted under the lock with a guarded UPDATE and a bounded
     replan on contention (COR-02 fix).
   - **`amm`** — **retired** (P2-09). Market creation only ever produces
     `order_book`; a pre-019 market still carrying `execution_mode='amm'` has new
     orders rejected outright ("uses the retired AMM engine and is no longer
     tradeable"). `amm.go` (LMSR) remains only so those markets stay settleable
     and voidable — settlement is engine-agnostic.

**Settlement** (`internal/prediction/settlement.go`): admin/AutoSettler resolves
a closed market → payouts computed (100 Points × winning contracts) → committed in one
transaction whose **first** statement is a status-guarded market transition, so a
concurrent settle/void can never both commit (COR-01 fix). Payout credits use
idempotency key `prediction_payout:<market>:<position>`; void refunds use
`prediction_void:<market>:<position>`.

**Ledger** (`internal/wallet/`): Points balances (`wallet_balances.balance_points` /
`bonus_balance_points`) — single-entry running-balance with an idempotency
key (and amount/reason conflict detection) on every mutation, `SELECT … FOR
UPDATE` on the balance row, `SERIALIZABLE` isolation on standalone mutations. A
reconciler (`internal/prediction/reconciliation.go`) detects collateral drift.

## Background workers (`internal/prediction/workers/`)

| Worker | Cadence | Job |
|---|---|---|
| `MarketCloser` | 30s | Transition markets past `close_at` to `closed` |
| `AutoSettler` | 60s | Settle/propose closed markets with an automated feed source (no production feed wired yet) |
| `RestingOrderExpirer` | periodic | Finalize resting orders on inactive markets; release reservations + RG stake |
| `Reconciler` | periodic | Per-market collateral drift report |
| `SMM` (synthetic MM) | `SMM_ENABLED` | Two-sided liquidity on the book |

## Realtime plane (`internal/ws/`)

In-process hub, one goroutine fans out to per-client buffered channels (non-blocking
sends after the PERF-03 fix — a slow client is dropped + disconnected, never freezes
the hub).

**Cross-instance fan-out** (`internal/ws/backbone.go`, ARCH-01 / P2-07) is done.
The hub always fans its own broadcasts out locally and *additionally* publishes
them to a `Backbone`:

- `LocalBackbone` (default, and what `WS_BACKBONE` unset selects) — publish is a
  no-op, so behaviour is identical to the pre-backbone gateway.
- `RedisBackbone` — selected by `WS_BACKBONE=redis` with a valid `REDIS_URL`
  (`internal/http/handlers.go`). Broadcasts are PUBLISHed tagged with the
  publisher's id and subscribers skip their own echoes, so a trade matched on one
  replica reaches subscribers on another. Because local delivery never goes
  through the backbone, a Redis outage degrades to local-only rather than
  crashing; `/readyz` reports `ws_backbone: ok | degraded` (informational — a
  degraded backbone is not a readiness failure).

Channels: `market:<id>`, `trades:<marketId>`, `orderbook:<marketId>`,
`portfolio:<userId>`, `loyalty:<userId>`. Auth happens before the upgrade
(cookie/header, never query string); per-channel authorization is fail-closed.

## Compliance & custody posture

- **Geo-fencing** is a load-bearing control (the platform does not operate in the
  US). Prod/staging boot **requires** `GEO_GATE_ENABLED=true` + a non-empty
  allowlist; `BETA_COMPLIANCE_MODE=permissive` is a boot error in production.
  Anti-spoof: Caddy strips client geo headers and stamps `X-Edge-Auth`; with
  `GEO_TRUSTED_PROXY_MODE=require` the gateway rejects money-path requests lacking
  the shared secret (SEC-03 fix). Bind the gateway port to loopback so only the
  edge can reach it.
- **KYC** is DB-backed with a fail-closed vendor seam (manual-review default).
- **Custody: none.** The platform holds no customer funds. Balances are
  non-redeemable Points. The whole legacy money-route tree — `/api/v1/payments/*`
  (including the crypto deposit endpoints), `/v1/provider-callbacks/*` and
  `/api/v1/cashier/alpha/*` — is unmounted by default and returns 404
  (`internal/http/launch_boundary_test.go` pins this). Mounting it needs
  `TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED=true`, which `validateGatewayRuntimeConfig`
  refuses when `ENVIRONMENT` is production or staging, as it refuses
  `ALPHA_CASHIER_ENABLED=true` and any `CRYPTO_RPC_URL` / `CRYPTO_ASSET_CONTRACT` /
  `CRYPTO_DEPOSIT_ADDRESS_SOURCE` value.
- **Dormant cashier code** still sits in the tree — `internal/alphacashier`,
  `internal/payments`, `internal/cashier`, plus the non-custodial seed
  (`contracts/`, `services/{relayer,bridge-watcher,cashier-api}`,
  `packages/cashier-sdk`). None of it is reachable at launch. Its design record
  is archived under `docs/archive/cashier/`.

## Data store

Single PostgreSQL 16, goose migrations under
`go-platform/services/gateway/migrations/` — see `migrations/README.md` for the
per-file inventory rather than duplicating it here. Landmarks: 001–013 created the
sportsbook schema and **033 dropped the dead ones** (`fixtures`, `selections`,
`markets`, `bets`, `freebets`, `odds_boosts`, …; `punters`, the CMS and audit
tables were deliberately kept); 014 is the prediction schema; 019 the exchange
engine; 027 back-office RBAC; 037 the multitenancy foundation; 050 the points unit
model. Head is 056.

The `wallet_*` tables are created in code by the wallet service at boot, not by a
migration.

Redis backs auth sessions and the auth rate limiter, plus the opt-in WebSocket
backbone above — **the gateway has no read cache** (the old "Redis wraps reads"
claim was never true of the prediction gateway).

## References

- `docs/audit/AUDIT_REPORT.md` — full system audit (workstreams A–G), the
  authoritative description of what is solid vs. what has gaps.
- `docs/audit/IMPROVEMENT_PLAN.md` — the sequenced remediation plan.
- [DEPLOYMENT.md](DEPLOYMENT.md), [RUNBOOKS.md](RUNBOOKS.md).
- `../../CLAUDE.md` — developer setup, env vars, domain model.
