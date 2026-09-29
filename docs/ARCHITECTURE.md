# Architecture

> **Scope:** How Tap Trade is built and runs today — surfaces, the gateway's
> internal package structure, core concurrency/money-safety patterns, request
> lifecycles, background workers, realtime, frontend shape, deployment.
> **Authoritative for:** system structure, package boundaries, request flows,
> worker wiring, deployment topology. **Not for:** env vars →
> [ENVIRONMENT.md](ENVIRONMENT.md); schema → [DATA_MODEL.md](DATA_MODEL.md);
> endpoint contracts → [SPEC_CURRENT.md](SPEC_CURRENT.md); point-store/payments
> detail → [../STORE_AND_PAYMENTS.md](../STORE_AND_PAYMENTS.md); UI/visual
> design → [../DESIGN.md](../DESIGN.md).
> **Last verified:** 2026-09-29 at commit `4924a670`; the middleware order and
> two-factor sign-in (built, off by default) were updated the same day with the
> hardening change. Read against
> `gateway/cmd/gateway/main.go`, `gateway/internal/http/handlers.go`,
> `gateway/internal/prediction/{wallet_adapter,exchange,settlement,sql_exchange_repository}.go`,
> `gateway/internal/ws/README.md`, `gateway/internal/discover/{sync,promote}.go`,
> `auth/cmd/auth/main.go`, `stack/{docker-compose.demo.yml,Caddyfile,DEPLOYMENT.md}`,
> `.github/workflows/*.yml`, `docs/DEMO_DEPLOYMENT.md`, `docs/adr/*`,
> migrations head (065).

## 1. System overview

Forked from a sportsbook codebase on 2026-04-16 ([ADR-0007](adr/0007-fork-from-sportsbook-to-prediction-market.md);
shared infrastructure kept: auth, wallet/ledger, WS hub, CSRF). Two Next.js
front ends — the player app (`player/`) and the back office (`office/`) — call
the Go gateway (`gateway/`), which proxies authentication to the Go auth
service (`auth/`). Only the two Go services touch Postgres and Redis. A **dormant Node cashier workstream**
(`services/cashier-api`, `services/bridge-watcher`, `services/relayer`,
`packages/cashier-sdk`, `contracts/`) is a non-custodial crypto-cashier seed
predating the points-only pivot — validated by `make cashier-check`, not
deployed, unreachable from any launch surface (see [§9](#9-boundaries--invariants)).

| Component | Path | Runtime / port | Responsibility | Entry point |
|---|---|---|---|---|
| Player app | `player/` | Next.js, dev :3010 (:3000 in the demo container) | Discovery, trading UI, portfolio, auth pages | `player/app/layout.tsx` |
| Back office | `office/` | Next.js, dev :3001 | Market/settlement/risk/RBAC admin UI | `office/app/layout.tsx` |
| Gateway | `gateway/` | Go 1.25, stdlib `net/http`, :18080 | REST + WS API: prediction, wallet, compliance, loyalty, leaderboards, discover, content, RBAC | `gateway/cmd/gateway/main.go` |
| Auth service | `auth/` | Go, :18081 | Login/register/OAuth, opaque bearer tokens, session cookies | `auth/cmd/auth/main.go` |
| PostgreSQL 16 | docker-compose `postgres` | :5434 (host) | Single writer; goose migrations, head 066 | `gateway/migrations/` |
| Redis | docker-compose `redis` | :6380 (host) | Auth sessions + rate limiter; gateway rate limiter; optional WS backbone | n/a |
| Node cashier API / bridge-watcher / relayer | `services/*` | Node (dormant) | Non-custodial cashier seed — not deployed | `services/*/src/` |
| Cashier SDK | `packages/cashier-sdk/` | TS (dormant) | Client SDK for the cashier API seed | `packages/cashier-sdk/src/` |
| Contracts | `contracts/` | Solidity (dormant) | Interfaces for the crypto cashier seed | `contracts/src/` |

## 2. Gateway internals

### `gateway/internal/*` — 23 packages

**Domain (18)** — `prediction` (matching, settlement, lifecycle FSM,
resolution/dispute, reconciliation, workers), `wallet` (points ledger,
idempotent + reserved), `http` (routes, handlers, worker wiring, launch
gating), `ws` (hub, channels, backbone), `rbac` (staff RBAC, migration 027),
`compliance` (geo gate, KYC, responsible gambling), `store` (point store,
`STORE_ENABLED`), `loyalty` (tiers/ledger), `leaderboards`, `discover`
(external catalog import, §4d), `livemarkets` (live/in-play feed), `content`
(CMS pages/banners), `bonus` (campaigns), `notify` (out-of-band
notifications), `tenant` (multi-tenant scaffolding, ADR-0005),
`markettranslate` (copy translation), `webhooks` (outbound, admin-managed),
`events` (in-process pub/sub bus, single-instance — used by `bonus`).

**Platform/infra (2)** — `tracing` (OpenTelemetry setup), `webhookauth` (the
one inbound webhook HMAC-SHA256 check, shared by `store` and `payments`).

**Dormant / not wired (3)** — `payments` (legacy sportsbook money tree,
unmounted unless `TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED=true`), `alphacashier`
(alpha custodial USDC cashier, same gate), `approval` (two-person rule for
admin actions over a Points threshold — implemented but **not wired**: no
caller decides which actions require it).

### `gateway/cmd/*` binaries

| Binary | What it does |
|---|---|
| `gateway` | The server; also dispatches `gateway migrate-legacy-loyalty` and `gateway rbac-bootstrap` before server bootstrap |
| `migrate` | Goose runner (`up`/`down`/`status`); reads `GATEWAY_DB_DSN`, `MIGRATIONS_DIR` |
| `seed` | Seed loader — `-mode base\|demo\|wipe` |
| `launch-boundary-report` | Probes a running gateway for the expected 404s on legacy money-route paths |
| `prediction-reconciliation-report` | Runs reconciler math against fixture cases offline |
| `windowed-resolution-live-proof` | Live smoke test: player + two admins through propose → challenge → finalize |
| `sync-markets` | One-shot: pulls external markets into `imported_markets` (manual demo reseed) |
| `translate-markets` | Backfills cached market-copy translations, skipping already-cached source hashes |
| `loadtest` | Concurrent order placements against a running gateway; throughput/latency percentiles |

### Middleware chain and auth

`gateway/cmd/gateway/main.go` builds the chain in `gatewayMiddlewares` with
`httpx.Chain`, which makes the **first** listed middleware the outermost. The
order a request passes through, with auth enabled (the default):

`RequestID → NormalizeTrailingSlash → AccessLog → Metrics → Recovery →
MaxBodySize → tracing → SecurityHeaders → CORS → RateLimit → Auth → CSRF →
tenant → handler`

Logging, metrics and panic recovery sit outside everything that can reject a
request, so 401/403/429 responses and panics in any middleware are logged and
counted. `cmd/gateway/middleware_order_test.go` fails if that changes (it
checks a 401 from Auth, a 429 from the limiter and a recovered panic all reach
the access log and metrics). Until 2026-09-29 the list was reversed, and the
tenant middleware ran only with auth disabled.

With `GATEWAY_AUTH_ENABLED=false` (dev only, refused at boot in
production/staging) the tail is `stripClientIdentityHeaders → tenant` instead
of `Auth → CSRF → tenant`; `stripClientIdentityHeaders` removes `X-User-ID`,
`X-Admin-Role`… at ingress so no handler can honour a forged identity.

- **`gatewayPublicPrefixes()`** — skips `httpx.Auth`: health/status,
  `/auth/`, `/ws` (self-authenticates), CMS delivery, public prediction reads
  (`discover`, `discovery`, `live-markets`, `categories`, `series`, `tags`,
  `events`, `markets`, `leaderboards`), the key-authenticated bot routes
  (`/api/v1/bot/orders`, `/positions`, `/markets` — not `/api/v1/bot/keys`,
  which needs a session); webhook
  prefixes are appended only when their tree is enabled (self-verifying HMAC).
- **CSRF** — `gatewayCSRFSkipPrefixes()` skips auth endpoints, webhooks and
  the key-authenticated bot routes (API clients carry no cookies). The auth
  service checks the CSRF pair itself on its cookie-authenticated
  state-changing routes.
- **Rate limit** — IP-keyed, only on `rateLimitedReadPrefixes()` (public
  reads, which Auth passes through without calling the auth service). Redis-backed
  (shared across replicas) when `REDIS_URL` set, else in-memory; default 120
  rpm (`GATEWAY_RATELIMIT_RPM`). `GATEWAY_TRUSTED_PROXY_CIDRS` keys it on the
  real client via `X-Forwarded-For`; unset behind a proxy, every visitor
  shares one bucket (root cause of the 2026-08-16 "markets won't load"
  incident — the demo compose now sets Cloudflare's ranges).
- **Edge secret** — `EDGE_SHARED_SECRET`, stamped by Caddy as `X-Edge-Auth`,
  checked under `GEO_TRUSTED_PROXY_MODE=require` to prove a request transited
  the edge (anti-spoof, SEC-03); required at boot under that mode in
  prod/staging.

### Route registration (`internal/http/handlers.go`, `RegisterRoutes`)

One ~930-line function; order matters, later steps depend on earlier ones:
wallet service + reservation-expiry job → WS hub + `/ws` → health/status →
prediction repo/service/wallet-adapter → resolution store, webhooks store →
order/portfolio/settlement/discover/social routes → RBAC service + admin
routes → background workers (§5, only with a DB) → wallet HTTP routes +
admin mutation routes → point store → legacy money routes (only if
`TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED=true`) → compliance routes + gate
wiring (shared geo/KYC instances feed the pre-trade gate and the store) →
loyalty/leaderboards (Predict-native DB path or legacy in-memory fallback,
mutually exclusive) → content/bonus admin routes → reports → auth reverse
proxy (`/api/v1/auth/`, `/auth/` → `AUTH_SERVICE_URL`).

### Prediction ↔ wallet boundary — the WalletAdapter pattern

`prediction` never imports `wallet`; it depends on interfaces in
`internal/prediction/wallet_adapter.go`: `WalletAdapter`
(`Debit`/`Credit`/`Balance`, idempotency-keyed) → `TxWalletAdapter` (adds
`BeginTx`/`DebitWithTx`/`CreditWithTx`) → `ExchangeWalletAdapter` (adds
`BeginExchangeTx` (READ COMMITTED), `HoldWithTx`,
`CaptureReservationWithTx`, `ReleaseReservationWithTx`, keyed on
`(refType, refID)` for idempotent retries); `NoopWallet` is the do-nothing
stand-in (`Balance` returns `math.MaxInt64` so checks never reject). The
concrete bridge is `internal/http/prediction_wallet_adapter.go`'s
`PredictionWalletAdapter`, wrapping `wallet.Service`; it returns
`prediction.NoopWallet{}` when the wallet service is nil.

## 3. Core patterns

**Idempotency keys + reservations** — order funds are *reserved*
(`HoldWithTx`), not debited, under `refType="prediction_order"`/
`refID=<order id>`; `CaptureReservationWithTx` debits per fill
(`prediction_fill:<tradeID>`, cumulative captures cannot exceed the hold);
`ReleaseReservationWithTx` frees the uncaptured remainder, idempotent
(no-op if already released/captured). Settlement credit uses
`prediction_payout:<marketID>:<positionID>`; void refund uses
`prediction_void:<marketID>:<positionID>`.

**Advisory locks** — `pg_advisory_xact_lock(hashtext(key))`, auto-released on
commit/rollback: per-market matching lock (`hashtext(market_id)`, taken in
`SQLRepository.PersistMatchAtomic`, `sql_exchange_repository.go`, and again by
the reconciler's phase-2 check and by resolution finalize/dispute filing,
`sql_resolution_store.go`); per-user cashier lock (`hashtext(userID)`, a
**session-level** `pg_advisory_lock` in `alphacashier/sql_repository.go`'s
`LockUser` — the same key the dormant payments rail's withdrawal path uses,
so deposit/withdrawal on either rail for one user never race);
responsible-gambling gate (`hashtext(userID)`, `compliance/rg_postgres.go`,
serializes concurrent same-user orders against the stake limit).

**Fail-closed flags** — refused outright in `production`/`staging`:
`TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED`, `ALPHA_CASHIER_ENABLED`,
`GATEWAY_AUTH_ENABLED=false`, `GATEWAY_ALLOW_ADMIN_ANON=true`, any
`CRYPTO_RPC_URL`/`CRYPTO_ASSET_CONTRACT`/`CRYPTO_DEPOSIT_ADDRESS_SOURCE`
value. Compliance is deny-by-default: `GEO_GATE_ENABLED=true` + a non-empty
allowlist required, each KYC flag `true` or explicitly acked off. Full
variable reference: [ENVIRONMENT.md](ENVIRONMENT.md) — this doc covers only
the boot-time *behavior*.

**Boot-time config validation** — `validateGatewayRuntimeConfig`
(`cmd/gateway/main.go`) runs before the server starts and `log.Fatalf`s on
any violation above, plus dev-password DSNs (`:localdev@`) in a real
environment, a non-DB-backed audit store, and placeholder webhook secrets
(`whsec_local`). It calls `alphacashier.ValidateRuntimeConfig` and
`store.ValidateRuntimeConfig`, so those subsystems' boot rules run from the
same place.

**Launch boundary** spans several files: `internal/http/launch_boundary.go`
(12 lines, `legacyMoneyRoutesEnabled()`) gates route *mounting*; separately
`internal/http/launch_reason.go` + `internal/compliance/launch_safety.go`
define the **content** scrub — `HasLaunchProhibitedCopy` regex-rejects
money/wagering vocabulary (`cash`, `deposit`, `withdraw`, `crypto`, `usd`,
bare `redeemable`, `$`) in any admin-authored user-facing string before save;
`LaunchRedactedText` is mirrored client-side in `api-client`. Both mechanisms
together are "the launch boundary" (see [§9](#9-boundaries--invariants)).

## 4. Request / data lifecycles

**(a) Place order → match → ledger → WS fan-out**
1. `POST` order route (`internal/http/prediction_handlers.go`) →
   `prediction.Service.PlaceOrder` (`internal/prediction/service.go`) —
   idempotency check → responsible-trading gate (atomic, before money moves)
   → compliance gate (`internal/http/pretrade_gate.go`).
2. `execution_mode='order_book'` (every current market): `placeExchangeOrder`
   → `ExchangeEngine.BuildPlan` (`internal/prediction/exchange.go`) — pure,
   price-time priority, complementary issuance, self-match prevention,
   partial fills.
3. `SQLRepository.PersistMatchAtomic` (`sql_exchange_repository.go`) applies
   the plan in one tx: advisory lock → re-verify market open → holds/
   captures/releases/seller-credits → insert trades → update orders → mutate
   positions → insert ledger entries → update quote snapshot → commit.
4. Post-commit: `SetMarketLifecycleHandler` fires `NotifyPredictionMarketUpdate`
   / trade / order-book-update on `market:<id>`, `trades:<marketId>`,
   `orderbook:<marketId>`.

`execution_mode='amm'` is **retired** (P2-09): `PlaceOrder` rejects new
orders there; `amm.go` (LMSR) survives only to quote legacy AMM detail —
settlement is engine-agnostic.

**(b) Market lifecycle: close → settle/void → payouts**
1. `workers.MarketCloser` (30s) transitions past-`close_at` markets to
   `closed` (`internal/prediction/lifecycle.go` FSM).
2. `SettlementEngine.ResolveMarket`/`resolveMarket` (`settlement.go`) — admin
   action or `AutoSettler` (60s, feed-sourced) — computes payouts (100 Points
   × winning contracts). **The atomic persister's first statement is a
   status-guarded UPDATE**, so a concurrent settle/void/halt that wins the
   race aborts the whole tx instead of double-paying (COR-01). `VoidMarket`
   follows the same guarded shape.
3. A settlement resumer (boot + 60s) finishes any payout batch left
   mid-disbursement by a prior crash (idempotent, batched — P3-12/COR-05).
4. Post-commit: per-user payout notification (bell + WS + email) and the
   resolution-phase WS channel + out-of-band notify for terminal states.

**(c) Auth login/session**
1. Browser → gateway `/api/v1/auth/*`/`/auth/*` → reverse-proxied
   (`registerAuthProxy`) to `AUTH_SERVICE_URL` — the gateway does not
   implement login.
2. Auth service validates against `auth_users` (bcrypt), or falls back to
   `admin_users` for staff login; issues an opaque bearer token (SHA-256
   digest stored), writes HttpOnly session cookies, persists the session in
   Redis (`RedisSessionStore`) or a file-backed store.
   **Two-factor sign-in** (`auth/internal/http/mfa.go`, off unless
   `AUTH_MFA_ENABLED=true`; off on the demo): for an account with an
   authenticator (every admin while `AUTH_ADMIN_MFA_REQUIRED` is on), the
   password step returns a 5-minute challenge instead (`mfaRequired`,
   `mfaToken`, also set as an HttpOnly `mfa_challenge` cookie), and
   `POST /api/v1/auth/login/mfa` exchanges it plus a TOTP code for the
   session. An admin with no authenticator is enrolled inside that challenge.
   Social sign-in hands its challenge to the player login page
   (`/auth/login?mfa=1`). Secrets are AES-256-GCM encrypted
   (`AUTH_MFA_ENCRYPTION_KEY`), codes are single use, and wrong codes count
   toward the login lockout. The office's server-side login proxy relays the
   challenge (`office/app/api/auth/login/mfa`).
3. Gateway requests: `httpx.Auth` calls the auth service to validate before
   the handler runs (except public prefixes, [§2](#2-gateway-internals)).
4. WS auth is separate: `internal/ws/handler.go` reads the `access_token`
   cookie (or bearer header), calls the auth service's `/api/v1/auth/session`
   itself, 401s before upgrade — never through `httpx.Auth`.

**(d) Market import → discover → promotion → covers**
1. Hourly worker (`startHourlyMarketSyncWorker`, demo: 15m) curates first
   (`discover.CurateImportedCatalog`, retires stale imports even if every
   upstream is down), then `discover.Sync` fetches Polymarket/Kalshi/
   Manifold, dedupes by title, rehosts images, upserts `imported_markets` by
   `external_hash`. Rows mentioning an upstream venue name are dropped at
   ingest.
2. `discover.Promote` turns deduped imports into `prediction_markets`:
   classify → category → synthetic or real event → stable ticker → insert/
   skip/resolve via `Service.CreateMarket`/`TransitionMarketStatus`/
   `ResolveMarket` — the same FSM-enforced paths as admin actions.
3. Cover resolution (`discover/covers.go`) backfills a Wikidata/Commons image
   (or matchup tile, or App Store icon as last resort); credits ship on the
   market payload and `/api/v1/attributions`.
4. `MARKET_IMAGE_PUBLIC_ROOT` writes images to a shared filesystem root the
   player and (in the demo) Caddy serve — see [§8](#8-deployment-view).

**(e) Point-store purchase → webhook → credit** (brief — full flow:
[STORE_AND_PAYMENTS.md](../STORE_AND_PAYMENTS.md))
1. Checkout creates a pending purchase (provider `demo` today; `stripe` is a
   reserved, boot-refused seam).
2. Provider webhook → `POST /api/v1/store/webhook` (public, HMAC-verified via
   `internal/webhookauth`) → purchase marked paid → Points credited through
   the same ledger as every other credit (idempotent).
3. Purchases are jurisdiction-gated like deposits and count against
   responsible-play limits (`store.ComplianceGate`, `store.RGLimits`).

## 5. Background workers

All started from `RegisterRoutes`, only when the prediction repo has a DB:

| Worker | Interval | Job | Flag |
|---|---|---|---|
| `MarketCloser` | 30s | Close markets past `close_at` | always on |
| `AutoSettler` | 60s | Auto-settle/propose closed markets with a feed source | always on |
| `RestingOrderExpirer` | 60s | Finalize resting orders on inactive markets; release reservations + RG stake | always on |
| Settlement resumer | boot + 60s | Finish crash-interrupted payout batches | always on |
| `Reconciler` | 15m | Two-phase per-market collateral drift check | always on |
| `SMM` (synthetic MM) | 30s default | Two-sided resting liquidity, seeded user-bot | `SMM_ENABLED` (off by default; on for demo) |
| Leaderboards recomputer | 5m (immediate first tick) | Recompute snapshots | on when Predict-native repo wired |
| Market sync worker | 1h (demo 15m) | Discover/curate/promote external markets (§4d) | `MARKET_SYNC_ENABLED=false` disables |
| Webhook dispatcher | poll loop | Drain outbound outbox, HMAC-sign, retry/dead-letter | on whenever webhook store wired |
| Wallet reservation expirer | 60s | Expire stale reservations | always on |
| Cover backfill | folded into market sync | Resolve covers for bare open imports | `MARKET_COVER_RESOLVER=false` disables |
| `ReorgWatcher` (alphacashier) | 5m | Freeze deposits orphaned by a reorg | legacy + alpha cashier enabled, EVM client connected |
| `DepositScanner` (alphacashier) | 15s | Watch treasury, credit matching deposit intents | `ALPHA_CASHIER_DEPOSIT_SCANNER_ENABLED` |

## 6. Real-time

`gateway/internal/ws`: one in-process hub per process, one goroutine owns the
subscription map; each client runs a read + write pump. `GET /ws`
self-authenticates (cookie or bearer, validated against the auth service)
rather than via `httpx.Auth`; query-parameter auth was removed.

**Channels** (`<prefix>:<id>`; which ones actually fire:
[SPEC_CURRENT.md](SPEC_CURRENT.md), [TD-034](TECH_DEBT.md#f-gateway-api-and-real-time)): `market:<id>`, `trades:<id>`,
`orderbook:<id>`, `event:<id>`, `category:<slug>`, `leaderboard:accuracy` are
open to any authenticated user; `portfolio:<userID>`, `wallet:<userID>`,
`loyalty:<userID>` are owner-only. Unknown prefixes reject fail-closed.
`admin:resolutions`/`admin:disputes` are broadcast to but nothing can
subscribe (not in the allowlist); four sportsbook-era prefixes (`markets`,
`fixture`, `fixtures`, `bets`) still accept subscriptions that receive nothing.

**Backpressure** — nothing blocks the broadcast caller. `Hub.Broadcast` drops
on a full hub queue (100); `Client.SendMessage` drops on a full per-client
buffer (256) and disconnects that client. Both counted in `/metrics`.

**Cross-instance backbone** (`internal/ws/backbone.go`, opt-in) — the hub
always fans out locally and *additionally* publishes to a `Backbone`:
`LocalBackbone` (default) is a no-op; `RedisBackbone`
(`WS_BACKBONE=redis` + parseable `REDIS_URL`) publishes on one tagged pub/sub
channel so a publisher skips its own echo. Local delivery never routes
through the backbone, so a Redis outage degrades to local-only; `/readyz`
reports `ws_backbone: ok | degraded` informationally. Full wire protocol and
file map: `gateway/internal/ws/README.md` (read directly — this summarizes it).

## 7. Frontend architecture

Visual/design detail: [../DESIGN.md](../DESIGN.md). Structure only here.

**Player app** — Next.js App Router, React 19. Server state: React Query
(`@tanstack/react-query`, hoisted to the `frontend/` workspace root). Client
state: one Redux Toolkit v1 slice (`lib/store/pointBalanceSlice.ts` — TopBar
balance pill + post-trade refresh; every sportsbook-era slice was deleted
2026-07-12) — everything else is component-local or React Query. i18n:
`react-i18next`, six locales (`app/lib/i18n/locales.ts`), namespace JSON
under `public/static/locales/<locale>/`. WS client:
`app/lib/websocket/predict-ws.ts`, one shared connection. API access:
`@taptrade-ui/api-client` (`prediction-client.ts`, `PredictionApiClient`),
shared with `office`. Tailwind v4 + inline styles against `globals.css`
custom properties; the legacy `@taptrade-ui/design-system` (styled-components)
package is **not** used here ([§9](#9-boundaries--invariants)).

**Back office** — Next.js App Router only (Pages Router removed — never
hydrated under Next 16 + React 19). Ant Design v5 (CSS-in-JS, no
styled-components). App Router pages call the gateway via
`app/lib/admin-fetch.ts`; older containers use a `useApi` hook.
Authorization is enforced **server-side by the gateway**
(`requireAdminRole` + `requireRBACPermission`); the sidebar filters entries
from `GET /api/v1/admin/me` as a **UX hint only** and fails open — RBAC is
not enforced in the office UI, only at the gateway.

## 8. Deployment view

### Demo topology (single Hetzner box)

```
Cloudflare (orange-cloud, Full Strict TLS) ──▶ Hetzner box (:80/:443 firewalled to CF ranges)
  Caddy (TLS, basic_auth on office host, strips client geo headers, stamps
         X-Edge-Auth, serves /images/markets/* off the market_images volume)
    ├─ predict_gateway :18080 (loopback-bound; Caddy only)   ├─ predict_auth :18081
    ├─ predict_player  :3000                                 ├─ predict_office :3001
    ├─ postgres 16 (named volume, survives rsync --delete)   ├─ redis
    ├─ db-backup (6h pg_dump sidecar, opt-in)                └─ rocketchat(+mongo), iframed under /chat
```
GitHub Actions deploys over SSH; see the CI/CD table below.

Compose: `docker-compose.yml` (base: postgres, redis, gateway, auth) +
`docker-compose.demo.yml` (overlay: rocketchat, player, office, caddy,
db-backup, SMM + feature-flag env), both pinning fixed `container_name`s —
one stack per box. **Discrepancy:** the overlay's own top-of-file comment
still says pushes to `feat/binary-exchange-engine` trigger the deploy; the
actual workflow trigger and every other doc (`CLAUDE.md`, `DEPLOYMENT.md`,
`docs/DEMO_DEPLOYMENT.md`) agree the live branch is `main` — stale comment.

Market thumbnails (`MARKET_IMAGE_PUBLIC_ROOT`, `market_images` volume) are
runtime state written by the catalog sync worker; Caddy serves them directly
from the volume rather than through Next.js, which only serves `public/`
files present at process start (a cover written after the player last
started would otherwise 404). Backups: `ops/backup/backup-db.sh` (pg_dump,
gzip, retention) via the `db-backup` sidecar every `BACKUP_INTERVAL_SECONDS`
(6h default), local-only unless `BACKUP_OFFSITE_CMD` is set — no tested
restore drill (`docs/audit/IMPROVEMENT_PLAN.md` P3-08).

### CI/CD — `.github/workflows/*.yml`

| Workflow | Trigger |
|---|---|
| `deploy-demo.yml` | push to `main` touching `apps/taptrade-platform/**`, or manual |
| `migrate-demo.yml` | manual — runs goose against the box DB |
| `demo-ops.yml` | manual — read-only box maintenance |
| `test.yml` | push/PR → `main` — conventions/cashier guards, FE Biome + unit tests, Go build + `test -race` |
| `e2e.yml` | PR → `main` (frontend/go-platform paths), or manual — Playwright journey suite |
| `frontend-build.yml` | PR touching `frontend/**` — clean-clone install, typecheck, unit tests, build |
| `guard-conventions.yml` | PR → `main`, or manual — convention gate (G-01) |
| `guard-db-migrations.yml` | push/PR → `main` — fresh-DB migration run (G-03) |
| `guard-money-path.yml` | push/PR → `main` — money-path test gate (G-02) |
| `guard-openapi-drift.yml` | push/PR → `main` — OpenAPI drift gate (G-04) |

**Unverified:** whether the `guard-*` workflows block merging depends on
branch protection, which is not visible in the repository ([D-12](TASKS.md#needs-a-decision)).
The deploy does not wait for any of them ([TD-018](TECH_DEBT.md#d-delivery-and-operations)).
Full deploy pipeline: [DEPLOYMENT.md](DEPLOYMENT.md).

## 9. Boundaries & invariants

- **Points-only launch boundary.** No cash-out.
  `TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED` (default off) is the single switch
  for the legacy money trees + alpha cashier; enabling it, or
  `ALPHA_CASHIER_ENABLED=true`, in `production`/`staging` is a boot error, as
  is any non-empty `CRYPTO_*` value. Mechanism: [§3](#3-core-patterns);
  pinning test: `internal/http/launch_boundary_test.go`. Decision record:
  [ADR-0010](adr/0010-points-only-non-redeemable-launch-boundary.md); the
  cashier code kept dark behind it: [ADR-0012](adr/0012-cashier-merged-dark-behind-flags.md).
- **`prediction` must not import `wallet`.** Enforced by review only — no lint
  rule or test checks it — via the `WalletAdapter` seam ([§2](#2-gateway-internals)).
- **No sportsbook vocabulary.** `player/app/__tests__/qa-regressions-2026-04-18.test.ts`
  fails CI on `yesPriceCents`/`noPriceCents` etc.;
  `internal/http/launch_docs_test.go` fails CI if gateway README/Makefile/
  `openapi.yaml` reintroduce cashier/deposit/withdraw/crypto/USD vocabulary;
  `scripts/check-conventions.sh` (G-01) fails on sportsbook concepts
  (`fixtures`, `selections`, `betslip`, `sport_key`, `punter_bets`, `freebets`,
  `odds_boosts`, `match_tracker`) in prediction Go and the player app.
- **No `@taptrade-ui/design-system` in the player app** — styled-components
  causes webpack hangs in `app/`; use Tailwind/inline components.
- **Ledger is single-entry, not double-entry.** ADR-0006 proposes
  double-entry; status **Proposed — awaiting owner decision**, not
  implemented.
- **Multi-tenancy is a foundation only.** ADR-0005's migration 037 and the
  `tenant` package exist; nothing filters by tenant ([TD-030](TECH_DEBT.md#e-ledger-data-model-and-tenancy)).

## 10. Related ADRs

Full index: [DECISIONS.md](DECISIONS.md).

- [0001](adr/0001-backoffice-type-safety.md) — back-office type safety; implemented.
- [0002](adr/0002-authorization-hardening.md) — admin/wallet authorization hardening; underlies the RBAC and admin-only wallet routes in [§2](#2-gateway-internals).
- [0003](adr/0003-resolution-source-architecture.md) — pluggable resolution sources, implemented narrower than sketched; underlies `AutoSettler` ([§5](#5-background-workers)).
- [0004](adr/0004-dispute-and-appeal.md) — dispute and appeal; underlies `proposed_resolution`/`disputed` in [§4b](#4-request--data-lifecycles).
- [0005](adr/0005-multi-tenancy-foundation.md) — multi-tenancy foundation; schema applied, not enforced.
- [0006](adr/0006-ledger-accounting-model.md) — ledger model; **Proposed**, not decided.
- [0007](adr/0007-fork-from-sportsbook-to-prediction-market.md) — the fork from the sportsbook codebase.
- [0008](adr/0008-clob-execution-replaces-amm.md) — order-book execution replaces the AMM ([§4a](#4-request--data-lifecycles)).
- [0009](adr/0009-points-unit-model.md) — the Points unit model.
- [0010](adr/0010-points-only-non-redeemable-launch-boundary.md) — the points-only launch boundary ([§9](#9-boundaries--invariants)).
- [0011](adr/0011-deployment-topology-single-branch-hetzner-compose.md) — `main` deploys one Hetzner box with docker-compose ([§8](#8-deployment-view)).
- [0012](adr/0012-cashier-merged-dark-behind-flags.md) — cashier code merged but dark.
- [0013](adr/0013-market-cover-sourcing-and-serving.md) — market cover sourcing and serving by Caddy ([§4d](#4-request--data-lifecycles), [§8](#8-deployment-view)).
