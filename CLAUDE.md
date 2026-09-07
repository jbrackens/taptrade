# Tap Trade — CLAUDE.md

## Project Overview

**Tap Trade** is a prediction event market platform in the shape of Polymarket and Kalshi. Users trade binary YES/NO contracts on real-world outcomes: politics, esports, sports, entertainment, tech, economics.

Contracts are priced in **Points**, 1–99, where the price is the implied probability. `yes_price_points + no_price_points = 100`; a correct contract settles at 100 Points, a wrong one at 0. **Points are non-redeemable play value** — the gateway reports `pointMode: "non_redeemable_points"` on `/api/v1/status`, the deposit/withdrawal/cashier/crypto route trees are unmounted by default, and the flags that would mount them are refused at boot in production/staging. See "Points-only launch boundary" below before touching anything money-shaped.

The project was **forked from Taya Na Sportsbook on 2026-04-16** and transformed: the sports-betting domain (sports/fixtures/markets/selections/bets) was replaced with a prediction-market domain (categories/series/events/markets/orders/positions). Shared infrastructure — auth, wallet/ledger, WebSocket hub, CSRF, OpenTelemetry — was preserved.

The app has three surfaces:
- **Player app** (Next.js 16 App Router) — discovery, market detail, trade ticket, portfolio, the Floor workspace
- **Backoffice** (Next.js 16 App Router + Ant Design v5) — market creation, settlement queue, risk, access control, analytics
- **Gateway API + Auth service** (Go) — HTTP+WebSocket API backed by PostgreSQL, with Redis for auth sessions, rate limiting and optional WS fan-out

## Repository Structure

Workspace root on this Mac: `/Users/john/Sandbox/taptrade-workspace/taptrade/`

```
taptrade/
├── apps/taptrade-platform/
│   ├── frontend/                          ← yarn-workspaces monorepo root (run yarn here)
│   │   └── packages/
│   │       ├── app/                       ← Player app (Next.js 16 App Router, local dev port 3010)
│   │       ├── office/                    ← Admin backoffice (Next.js 16 App Router, port 3001)
│   │       ├── api-client/                ← Shared TS API client (prediction-client.ts)
│   │       └── design-system/             ← Legacy styled-components kit — NOT used by app/
│   ├── go-platform/
│   │   ├── services/gateway/              ← API gateway (Go, port 18080)
│   │   │   ├── cmd/gateway/               ← gateway binary (also `gateway rbac-bootstrap`)
│   │   │   ├── cmd/migrate/               ← goose migration runner
│   │   │   ├── cmd/seed/                  ← seed loader (-mode base | demo | wipe)
│   │   │   ├── cmd/launch-boundary-report/← points-only launch boundary check
│   │   │   ├── internal/prediction/       ← prediction domain (types, exchange, AMM quotes, lifecycle, settlement, repo, workers, feeds)
│   │   │   ├── internal/wallet/           ← wallet + ledger (kept from sportsbook, adapted)
│   │   │   ├── internal/ws/               ← WebSocket hub
│   │   │   ├── internal/http/             ← HTTP handlers
│   │   │   ├── migrations/                ← 014 created the prediction schema; 056 is the highest today
│   │   │   └── seed-data/seed_prediction.sql
│   │   ├── services/auth/                 ← Auth service (Go, port 18081)
│   │   └── modules/platform/              ← Shared Go module `taptrade/platform` (canonical, logging, runtime, transport/httpx)
│   ├── docker-compose.yml                 ← PostgreSQL (5434) + Redis (6380) + gateway + auth
│   └── docker-compose.demo.yml            ← demo box: adds player, office, Caddy, backups
├── contracts/                             ← Solidity interfaces — dormant, see launch boundary
├── packages/cashier-sdk/                  ← dormant, see launch boundary
├── services/                              ← cashier-api, bridge-watcher, relayer — dormant, see launch boundary
├── docs/                                  ← docs, ADRs, and docs/archive/ (historical records only)
├── scripts/                               ← agent-preflight.sh, cashier guard scripts
├── Makefile                               ← one target: `make cashier-check` (validates the dormant trees)
├── CLAUDE.md                              ← this file
├── PRODUCT-USER-JOURNEYS.md               ← product spec: implemented user journeys
└── DESIGN.md                              ← design system (Tap Trade purple + gold); mirrors the code, does not govern it
```

Design values are canonical in `apps/taptrade-platform/frontend/packages/app/app/globals.css` `:root`, not in prose: the current brand identity (adopted 2026-08-22) is `--brand-purple #6334a8` for actions/focus/links, `--signal-gold #f5c454` for live/reward/featured, `--paper #f1f4f6` page ground, `--dir-yes #126d68` teal and `--dir-no #9c3b65` mulberry for market direction only, and `--reward-lime #c6f24e` limited to the reward hero (never a generic CTA or YES signal). Type is Switzer for UI and Geist Mono for every numeral. Those values are pinned by `app/__tests__/color-system.test.ts`. **Read `globals.css` and that test before any UI change**; `DESIGN.md` is the narrative mirror and covers the player app only — office runs a separate palette (see the Backoffice section).

## GitHub Repo

- Remote: `https://github.com/jbrackens/taptrade` (branch `main`)
- GitHub user: `jbrackens`
- The sister repo `jbrackens/Taya_Na_Sportsbook` is the on-hold sportsbook. Don't touch it unless the user explicitly asks.

## Agent Branch / Deploy Policy

Active development and demo deployment happen from the primary checkout
(P2-06 consolidated everything onto `main`; the old `-cashier` worktree and
`feat/binary-exchange-engine` deploy branch are retired):

- Checkout: `/Users/john/Sandbox/taptrade-workspace/taptrade`
- Branch: `main` (pushing to it IS the production deploy)
- Deploy workflow: `.github/workflows/deploy-demo.yml` (triggers on push to `main` under `apps/taptrade-platform/**`)

Before any agent starts edits, and again before any `commit/push/deploy`, run
`scripts/agent-preflight.sh` from the checkout root (verifies checkout, branch,
clean tree, and sync with `origin/main`).

Treat the user phrase `commit/push/deploy` as a strict procedure:

1. Stay in `/Users/john/Sandbox/taptrade-workspace/taptrade`.
2. Confirm the branch is `main`.
3. Fetch `origin` and refuse if the branch is behind or diverged.
4. Review `git status` and commit only intended files.
5. Run the relevant local validation before committing.
6. Push only `main`.
7. Monitor the GitHub Actions deploy run and smoke-check the demo URLs after success.

Feature work happens on short-lived branches merged into `main`; do not push a
non-`main` branch for deploy purposes unless the user explicitly names that
branch. Do not include unrelated untracked files without explicit user approval.

## Critical Rules

### Never Do These

1. **Never give placeholder paths.** Use real, full paths. The workspace is `/Users/john/Sandbox/taptrade-workspace/taptrade/` — not `~/...` or `your-project/...`.
2. **Never reintroduce sportsbook concepts.** No new code referencing `fixtures`, `selections`, `betslip`, `sport_key`, `punter_bets`, `freebets`, `odds_boosts`, `match_tracker`. This is a prediction market — markets have `yesPricePoints`/`noPricePoints`, not odds; users have positions, not bets.
3. **Never reintroduce `*Cents` / `*_cents` names in the prediction economy.** Migration 050 renamed them to `*_points`; `app/__tests__/qa-regressions-2026-04-18.test.ts` fails CI if `yesPriceCents` / `noPriceCents` and friends reappear on the wire types.
4. **Never use `@taptrade-ui/design-system` imports in `app/`** — it uses styled-components and causes webpack hangs. Use inline components or Tailwind.
5. **Never introduce `console.log/warn/error` in production code.** Use the structured `logger` from `app/lib/logger.ts`.
6. **Never use `any` type.** Use `unknown`, proper interfaces, or `Record<string, unknown>`.
7. **Never suppress TypeScript errors** with `@ts-nocheck`, `@ts-ignore`, or `as any`.
8. **Never declare something "done" if it uses mock/hardcoded data.** Either wire it to the real API or explicitly mark it STUB in the commit message.

### Always Do These

1. **Use real paths** when giving the user instructions. The Mac workspace is `/Users/john/Sandbox/taptrade-workspace/taptrade/`.
2. **Fix errors at the root, don't work around them.** Zero bug policy.
3. **Keep the `prediction` Go package decoupled from `wallet`.** It uses the `prediction.WalletAdapter` interface — the concrete bridge lives in `internal/http/prediction_wallet_adapter.go`. Don't import `wallet` from `prediction/`.
4. **New tables/columns** go through a new goose migration with the next free prefix — run `ls migrations/ | tail` first (056 is the highest today, so the next is 057). Never edit a shipped migration in place. In particular, 014's column names are no longer the live schema: 050 renamed them.

## Points-only launch boundary

The platform launches on non-redeemable Points. There is no cash-out.

- `/api/v1/status` reports `pointMode: "non_redeemable_points"` and the enabled/disabled state of the legacy money routes (`internal/http/handlers.go`).
- `TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED` (default off, `internal/http/launch_boundary.go`) is the single switch that mounts the legacy deposit / withdrawal / payments-webhook / provider-callback / crypto-rail trees. Setting it to `true` when `ENVIRONMENT=production|staging` is a **boot error**.
- `ALPHA_CASHIER_ENABLED=true` is likewise a boot error in production/staging, and outside those envs it additionally requires the legacy flag.
- `CRYPTO_RPC_URL`, `CRYPTO_ASSET_CONTRACT` and `CRYPTO_DEPOSIT_ADDRESS_SOURCE` **must be unset**: in production/staging any non-empty value refuses boot (`cmd/gateway/main.go`, `validateGatewayRuntimeConfig`). They are not activation knobs.
- `internal/payments/crypto_rail.go`, `internal/cashier/`, `internal/alphacashier/`, plus the root-level `contracts/`, `packages/cashier-sdk/` and `services/{cashier-api,bridge-watcher,relayer}` are the **dormant real-money workstream**. They are validated by `make cashier-check` and are not deployed. Do not treat them as live seams, and do not delete them without asking.
- `internal/http/launch_docs_test.go` `TestLaunchDocsStayPointsOnly` fails CI if the gateway `README.md`, `Makefile` or `api/openapi.yaml` reintroduce cashier/deposit/withdraw/crypto/USD/dollar vocabulary.
- The play-money faucet is `STARTER_GRANT_CENTS` (the env name still says CENTS; the value is Points). 0 or unset disables it.
- The point store (`internal/store`, migration 051, `/api/v1/store/*`) is the sanctioned way Points enter a wallet, gated by `STORE_ENABLED`.

## Domain Model

The prediction hierarchy (inspired by Kalshi):

```
Category        (politics, esports, sports, entertainment, tech, economics)
  └── Series    (recurring template, e.g. "Fed Rate Decisions")
        └── Event    (specific occurrence, e.g. "May 2026 FOMC")
              └── Market   (binary contract, e.g. "Fed cuts at May FOMC")
                    └── Orders / Positions / Trades / Settlement
```

Migration 014 seeded six categories including `crypto`; migration 046 deactivates `crypto` (renamed "Legacy Crypto", `active = false`) and seeds `esports` in its place. The player app's discovery rail filters to sports / politics / entertainment / tech / economics. Do not reactivate crypto or seed crypto markets.

Multi-outcome events (e.g. "UCL 2025/26 Winner") decompose into **N binary markets** (one per candidate outcome) rather than introducing combinatorial matching.

Prices are **Points, 1–99** — enforced by CHECK constraints and the invariant `yes_price_points + no_price_points = 100`. Winners pay 100 Points per contract at settlement; losers pay 0. Every stored integer is already whole Points — there is no sub-Point subdivision and nothing divides by 100 at display (see the header comment in `migrations/050_points_unit_model.sql`, which explains the corrected unit model). There is no dollar unit in the schema, and Points are not redeemable.

## Tech Stack — Player App

**Path:** `apps/taptrade-platform/frontend/packages/app/`

- **Framework:** Next.js 16 with App Router (`app/` directory)
- **React:** 19 — `React.FC` does NOT include `children` prop; add explicitly
- **State:** Redux Toolkit v1 (NOT v2) — use `TypedUseSelectorHook`, NOT `.withTypes()`
- **Store types:** `app/lib/store/hooks.ts` for `useAppDispatch` / `useAppSelector`
- **Server state:** React Query (`@tanstack/react-query`, hoisted from the `frontend/` workspace root; provider in `app/lib/query/QueryProvider.tsx`)
- **Styling:** Tailwind CSS v4 + inline styles against the `globals.css` custom properties (NO styled-components in app/)
- **i18n:** react-i18next; namespaces in `public/static/locales/<locale>/*.json`. Six locales: en, zh-Hans, zh-Hant, tl, ms, id (`app/lib/i18n/locales.ts`)
- **Logging:** `app/lib/logger.ts` — structured logger (dev: console with `[context]` prefix, prod: no-op)
- **WebSocket:** `app/lib/websocket/predict-ws.ts` — one shared connection; subscribe to `market:<id>`, `orderbook:<id>`, `trades:<marketId>`, `portfolio:<userId>`, `loyalty:<userId>`
- **API client:** `@taptrade-ui/api-client/src/prediction-client.ts` — `PredictionApiClient`
- **Testing:** Node.js built-in test runner via tsx — `yarn test` runs `tsx --test app/__tests__/*.test.ts`

### Prediction pages

The app ships 40 routes under `app/`. The ones that matter:

- Classic surface: `app/predict/page.tsx` (discovery — featured, trending, closingSoon, recent), `app/market/[ticker]/page.tsx` (market detail + trade ticket), `app/portfolio/page.tsx` (Positions / Orders / History tabs + accuracy), `app/category/[slug]/page.tsx`
- **Floor workspace** (landed 2026-08-12): `app/floor/page.tsx` (lensed Board + persistent Inspector), `app/book/page.tsx`, `app/standing/page.tsx`, `app/event/[id]/page.tsx`, plus `app/components/floor/` (FloorTabBar, CommandPalette, InspectorPanel). Its own header states it "coexists with /predict while the new operating model proves itself" — both are live, so confirm which surface a task means before editing.
- Other product surfaces: `/` (landing), `/discover`, `/live`, `/series/[slug]`, `/leaderboards` + `/leaderboards/[id]`, `/users/[userId]`, `/activity`, `/rewards`, `/store`, `/profile`, `/account/*`, `/auth/*`
- Components: `app/components/prediction/` — MarketCard, TradeTicket, ConnectedTradeTicket, CategoryPills, PredictionWorkspace, OrderBook, MarketChart, TopBar, and more

### Redux slices

`lib/store/pointBalanceSlice.ts` is the **only** live slice (TopBar balance pill + post-trade refresh) and the only reducer registered in `lib/store/store.ts`. The sportsbook-era slices were deleted in the P12 dead-code sweep (2026-07-12). Market, order and category state is component-local or React Query — do not rebuild a Redux layer the codebase deliberately removed.

## Tech Stack — Backoffice

**Path:** `apps/taptrade-platform/frontend/packages/office/`

- **Framework:** Next.js 16 **App Router only** (`app/`). The Pages Router was removed because it never hydrated under Next 16 + React 19 (see `FEATURE_MANIFEST.json` `known_blockers/pages-router-no-hydration`). There is no `pages/` directory — do not add one.
- **UI:** Ant Design `^5.29.3` with `@ant-design/nextjs-registry` and `@ant-design/v5-patch-for-react-19`. No styled-components. AntD v5 is CSS-in-JS: there is no `antd/dist/antd.css` to import. The stylesheet stack is `styles/p8-tokens.css` → `styles/p8-antd.css` (AntD class overrides), plus the runtime theme in `app/lib/antd-config-provider.tsx`.
- **Tokens:** `styles/p8-tokens.css` declares `--bg-deep` / `--surface-1/2` / `--border-1/2` / `--t1..4` / `--yes-text` / `--no-text` / `--focus-ring` / `--accent[*]` / `--r-rh-*`. These are the legacy P8-named tokens (values P9-swapped 2026-07-07); office has not yet been swept onto the player app's purple + gold values. New styling work MUST reference these CSS custom properties — DO NOT introduce hex literals.
- **API:** `app/lib/admin-fetch.ts` for the App Router pages; the older containers use the shared `useApi` hook via `services/api/api-service`
- **Auth:** the `(dashboard)` App Router pages are **not** wrapped in `securedPage` — the gateway is the authorization boundary (`requireAdminRole` + `requireRBACPermission`). The sidebar filters entries from `GET /api/v1/admin/me` as a UX hint only, and fails open. `securedPage` still lives in `utils/auth.ts` and is used by the legacy `containers/terms-and-conditions` page; `PunterRoleEnum` is imported from `@taptrade-ui/utils`.

### Admin routes

All under `app/(dashboard)/`: `access-control`, `audit-logs`, `campaigns`, `content`, `dashboard`, `disputes`, `leaderboards`, `loyalty`, `prediction-admin`, `reports`, `risk-management`, `social-moderation`, `users`. Of those, `campaigns` and `reports` are retired shells that redirect to `/dashboard`, and `risk-management` redirects to `/prediction-admin/risk`.

Prediction admin is `app/(dashboard)/prediction-admin/` with sub-routes `activity`, `markets`, `reward-clusters`, `risk`, `settlements`, `store-packs`, `taxonomy`:

- `.../prediction-admin/markets/page.tsx` — market list, create, lifecycle transitions (open/halt/close)
- `.../prediction-admin/settlements/page.tsx` — settlement queue, manual resolve with attestation
- Containers: `containers/prediction-markets/`, `containers/prediction-settlements/`, `containers/prediction-taxonomy/`

## Back-office RBAC (Access Control)

Staff authorization for the back-office, distinct from `punters` (customers) and
the auth service's `auth_users` (player login). Schema in migration
`027_rbac_admin.sql`: `admin_users` (gateway-owned staff directory, bcrypt
password), `roles`, `permissions`, and the `user_roles` / `role_permissions`
join tables. Seeded roles: Super Admin, Operations Manager, Customer Support;
granular permissions like `users:read/write`, `roles:read/write`,
`markets:read/edit`, `settlements:resolve`, `finances:view`.

- **UI:** `office/app/(dashboard)/access-control/` → `office/app/components/access-control/`
  (User Management tab: table, Create User, Edit Roles, suspend/activate,
  reset password, delete; Role Matrix tab: Create Role + a roles × permissions
  checkbox grid).
- **API:** `/api/v1/admin/users` (GET/POST), `/api/v1/admin/users/{id}/{roles,status,password}` (PUT),
  `/api/v1/admin/users/{id}` (DELETE), `/api/v1/admin/roles` (GET),
  `/api/v1/admin/roles/{id}/permissions` (PUT). Code: `internal/rbac/` +
  `internal/http/rbac_admin_handlers.go`.
- **Enforcement:** every endpoint runs `requireAdminRole` (session role==admin)
  then `requireRBACPermission`, which resolves the caller's email →
  `admin_users` → roles → permissions (active users only; suspended/unknown get
  none). Dev bypass: `GATEWAY_ALLOW_ADMIN_ANON=true` (refused at boot in
  prod/staging).
- **Login:** the auth service `Login` falls back to authenticating against
  `admin_users` (active, role=admin), so a staff member created via Create User
  signs in with their temporary password — no separate `auth_users` row needed
  (`services/auth/internal/http/handlers.go` `lookupAdminUser`).
- **Safety invariants:** the `super-admin` role is immutable via the API; an
  actor can only assign roles / grant permissions within their own set; the last
  active super-admin cannot be role-stripped, suspended, or deleted; an actor
  cannot suspend or delete their own account.
- **Dev bootstrap staff** (dev-only, via `cmd/seed` → `seed_prediction.sql`):
  `admin@taptrade.local` (Super Admin), `ops@taptrade.local` (Operations Manager),
  `support@taptrade.local` (Customer Support) — all password `admin123`.
- **Prod bootstrap** (prod is fail-closed: the migration seeds no staff): run
  `gateway rbac-bootstrap` once with `RBAC_BOOTSTRAP_EMAIL` +
  `RBAC_BOOTSTRAP_PASSWORD` (+ `GATEWAY_DB_DSN`) to create the first super-admin.

## Tech Stack — Go Backend

**Path:** `apps/taptrade-platform/go-platform/services/gateway/`

- **Language:** Go 1.25 (module `taptrade/gateway`; shared module `taptrade/platform` is Go 1.24)
- **HTTP:** stdlib `net/http` + `taptrade/platform/transport/httpx` middleware
- **DB:** PostgreSQL 16 via `lib/pq`, migrations via `pressly/goose/v3`
- **Redis:** not a read cache — there is no read cache in the gateway. `REDIS_URL` backs (a) the HTTP rate limiter, which degrades to in-process counters that are not shared across replicas when unset, and (b) the optional cross-replica WebSocket backbone, enabled with `WS_BACKBONE=redis`. Redis also backs auth sessions and the auth rate limiter in the auth service.
- **WebSocket:** hub with typed notifiers (see `internal/ws/notifier.go` and `internal/ws/hub.go`)
- **Auth:** JWT cookies via auth service proxy; `httpx.Auth` middleware checks `gatewayPublicPrefixes()` in `cmd/gateway/main.go`
- **Matching:** the binary exchange (`internal/prediction/exchange.go`) is the live execution path — a central limit order book with limit + market orders, partial fills, complementary issuance, sells from existing positions, and wallet reservations. Matching runs at READ COMMITTED under `pg_advisory_xact_lock` per market; the engine is pure and `SQLRepository.PersistMatchAtomic` does the writing.
- **AMM:** LMSR in `internal/prediction/amm.go` — cost function `C(q) = b * ln(e^(q_yes/b) + e^(q_no/b))`. **Execution against the AMM is retired (P2-09).** `PlaceOrder` rejects markets with `execution_mode='amm'`; the engine survives only to quote legacy AMM market detail. New markets default to `execution_mode='order_book'` (migration 019).
- **Background workers** (wired in `internal/http/handlers.go`, all in `internal/prediction/workers/`):
  - `MarketCloser` — 30s, closes markets past `close_at`
  - `AutoSettler` — 60s, auto-settles with feed adapters
  - `RestingOrderExpirer` — 60s, expires resting orders and releases their reservations
  - `Reconciler` — 15m, ledger-consistency check
  - `SMM` — synthetic market maker, 30s default tick, off unless `SMM_ENABLED=true`, configured by `NewSMMFromEnv`

### Key files to know

- `internal/prediction/types.go` — all domain types and API request/response shapes
- `internal/prediction/service.go` — business logic entrypoint; `PlaceOrder` + compliance gates
- `internal/prediction/exchange.go` — the matching engine (`BuildPlan`, `MatchPlan`)
- `internal/prediction/amm.go` — legacy LMSR quotes (execution retired)
- `internal/prediction/settlement.go` — settlement + void + payout
- `internal/prediction/resolution.go` — proposed-resolution / dispute flow
- `internal/prediction/sql_repository.go` (+ `sql_exchange_repository.go`, `sql_admin_repository.go`) — PostgreSQL implementations
- `internal/prediction/wallet_adapter.go` — the interfaces that keep prediction decoupled from wallet
- `internal/prediction/lifecycle.go` — market/event state machines
- `internal/http/handlers.go` — top-level route registration and worker wiring
- `internal/http/prediction_handlers.go` — public + authenticated prediction routes
- `internal/http/bot_handlers.go` — bot API with API-key auth
- `internal/http/prediction_wallet_adapter.go` — bridges `wallet.Service` → `prediction.WalletAdapter`
- `internal/http/launch_boundary.go` + `launch_reason.go` — points-only route gating and redaction
- `internal/http/pretrade_gate.go` — jurisdiction + KYC gates on the trading path
- `internal/compliance/kyc_postgres.go` + `idv.go` — DB-backed KYC + pluggable IDV provider (manual review default; vendor seam)
- `internal/compliance/rg_postgres.go` — DB-backed responsible-gambling limits + atomic stake-limit gate
- `internal/compliance/geo_gate.go` — jurisdiction allow/deny evaluation
- `internal/notify/notify.go` — out-of-band notification channel (SMTP + log fallback)

### Other backend subsystems

`internal/` holds 22 packages. Beyond `prediction`, `wallet`, `http`, `ws`, `rbac` and `compliance`:

| Package | Surface |
|---|---|
| `store` | Point store — `/api/v1/store/*`, migration 051, gated by `STORE_ENABLED` |
| `loyalty` | Tiers, standing, ledger — `/api/v1/loyalty/*`, migrations 015/021 |
| `leaderboards` | `/api/v1/leaderboards` (public) + `/api/v1/me/leaderboards` |
| `discover` | Imported/curated market catalog from external venues — `/api/v1/discover` |
| `livemarkets` | Live/in-play feed — `/api/v1/live-markets` |
| `content` | CMS pages and banners — `/api/v1/content/*`, `/api/v1/banners` |
| `bonus` | Bonuses and campaigns — `/api/v1/bonuses/*` |
| `notify` | Notifications — `/api/v1/notifications`, migration 055 |
| `tenant` | Multi-tenant scaffolding (ADR-0005) |
| `markettranslate` | Market copy translation |
| `webhooks` | Outbound webhook endpoints (admin-managed) |
| `tracing` | OpenTelemetry setup |
| `payments`, `cashier`, `alphacashier` | Dormant — see the launch boundary section |

Social (comments, follows, moderation) lives in `internal/http/market_social_handlers.go` under `/api/v1/social/*` (migrations 044/049/054); the watchlist is `/api/v1/watchlist/*` (migration 045); disputes are `/api/v1/disputes`.

## Local Development

### One-time setup

```bash
cd /Users/john/Sandbox/taptrade-workspace/taptrade/apps/taptrade-platform

# Start Postgres (port 5434 to avoid colliding with any sportsbook container)
docker compose up -d postgres redis

# Run migrations
cd go-platform/services/gateway
export GATEWAY_DB_DSN="postgres://predict:localdev@localhost:5434/predict?sslmode=disable"
export MIGRATIONS_DIR="$(pwd)/migrations"
go run ./cmd/migrate up

# Seed base data (categories, series, events, markets, 4 test punters + wallets)
make seed
```

Three seed modes (targets live in the **gateway** Makefile, not the platform one):

- `make seed` / `go run ./cmd/seed` (default `-mode base`) — categories, series, events, markets, users, wallets only. Empty order books on `execution_mode=order_book` markets. The exact row counts move with the seed file; run it and count rather than trusting a number in this doc.
- `make demo-data` (`-mode demo`) — base seed + demo state for clickable demos. Phases 0, 1, 2, 4, 5, 5b, 6 (3 is intentionally skipped — charts are client-side):
  1. **Phase 0** — cancels stale `pending` orders, removes any prior demo rows
  2. **Wallet top-up** — demo user / alice / bob / charlie and the bot get demo balances
  3. **Phase 1** — market-maker book: multi-level YES + NO bids on every order_book market via `user-bot`. Fixes "no matching liquidity" for taker market orders.
  4. **Phase 2** — synthetic taker volume from alice/bob/charlie, backdated
  5. **Phase 4** — demo user (u-1) opens positions across categories with varied PnL
  6. **Phase 5** — settles the markets listed in `cmd/seed/demo_phase5_settle.go` `phase5Plan` (10 named tickers plus IMP-* extras) so History + Leaderboards populate
  7. **Phase 5b** — leaderboard snapshots
  8. **Phase 6** — backoffice `audit_logs` + `loyalty_accounts`
- `make wipe-demo` (`-mode wipe`) — removes only the rows demo phases wrote (idempotency_key LIKE 'demo:%', attestation_source='demo', trade_kind='demo_history'). Base seed rows untouched. Re-runnable.

All demo writes go through `Service.PlaceOrder` and `Service.ResolveMarket` — same path as live HTTP requests — so the ledger stays consistent and the reconciler reads clean.

### Running services

```bash
# Gateway (port 18080 by default; override with PORT)
GATEWAY_DB_DSN="postgres://predict:localdev@localhost:5434/predict?sslmode=disable" \
WALLET_DB_DSN="postgres://predict:localdev@localhost:5434/predict?sslmode=disable" \
WALLET_STORE_MODE=db \
go run ./cmd/gateway

# Auth service (port 18081) — needed for authenticated endpoints
cd ../auth
AUTH_STORE_MODE=db \
AUTH_DB_DSN="postgres://predict:localdev@localhost:5434/predict?sslmode=disable" \
AUTH_COOKIE_SECURE=false \
go run ./cmd/auth

# Frontends — install once at the workspace root
cd ../../../frontend
yarn install --frozen-lockfile

# Player app (local dev port 3010 — 3000 is occupied by an unrelated local project)
cd packages/app
NEXT_PUBLIC_API_URL=http://localhost:18080 npx next dev --webpack -p 3010

# Backoffice (port 3001) — office has no `dev` script of its own
cd ../office
npx next dev --webpack -p 3001
```

`packages/office` exposes `run-local:dev`, not `dev`, and it does not pin a port — the port comes from the runner, which is why the command above passes `-p 3001` (the same thing `.claude/launch.json` does). From `frontend/` you can also run `yarn dev` / `yarn dev:office`, which drive the same scripts through lerna alongside the mock server.

### Ports

| Service | Port | Notes |
|---------|------|-------|
| Player app (Next.js) | 3010 | 3000 is occupied by an unrelated local project; root `.claude/launch.json` pins 3010. Only `docker-compose.demo.yml` containerizes it |
| Backoffice (Next.js) | 3001 | set by the dev runner, not by package.json |
| Go Gateway | 18080 | default in code; `PORT` overrides |
| Go Auth Service | 18081 | default in code; `PORT` overrides |
| PostgreSQL (Docker) | 5434 | 5432 is the sportsbook container, 5433 is swarmqa |
| Redis (Docker) | 6380 | 6379 is the sportsbook container |

### Test credentials

**Active login:** `demo@taptrade.local` / `demo123`

> **Local drift notes (observed 2026-07, still unresolved at the 2026-09 hold).**
> If `demo@taptrade.local` is rejected against your local DB, fall back to
> `alice@predict.dev` / `predict123`. Separately, the dockerized gateway image can
> go stale and market buys start returning 400 — rebuild the image, or run the
> gateway from source (`go run ./cmd/gateway`) when trading locally.

In DB mode (`AUTH_STORE_MODE=db`) and outside production/staging, the auth service seeds six accounts into `auth_users` on startup: `demo@taptrade.local` / `demo123` (player), `admin@taptrade.local` / `admin123` (admin), and the four Predict punters below with IDs matching `seed_prediction.sql`, so all of them log in out of the box.

| User | Password | Role | Seeded wallet balance |
|------|----------|------|----------------------:|
| `alice@predict.dev` | `predict123` | player | 100,000 PTS |
| `bob@predict.dev` | `predict123` | player | 50,000 PTS |
| `charlie@predict.dev` | `predict123` | player | 250,000 PTS |
| `bot@predict.dev` | `predict123` | bot | 1,000,000 PTS |

Seeded wallets carry `currency_code = 'PTS'`. The `make demo-data` phases top these balances up further.

### Known macOS Issue — Brotli

If a frontend install crashes with `libbrotlicommon.1.dylib` code signature error:
```bash
codesign --force --sign - /opt/homebrew/lib/libbrotlicommon.1.dylib
codesign --force --sign - /opt/homebrew/lib/libbrotlidec.1.dylib
codesign --force --sign - /opt/homebrew/lib/libbrotlienc.1.dylib
```
On Intel Macs: check `/usr/local/lib/` instead of `/opt/homebrew/lib/`.

### Use yarn at the workspace root

The `frontend/` directory is a yarn-workspaces monorepo (`workspaces: ["packages/**/*"]` in `package.json`, `engines: { node: ">=20", yarn: ">=1.22.22 <2" }`). Run `yarn install --frozen-lockfile` from `frontend/`, not from any sub-package. CI does the same — see `.github/workflows/test.yml`.

Older notes recommended `npm install --legacy-peer-deps` from the app sub-directory; that path hangs in CI for hours because npm doesn't detect the workspace declaration up-tree. Yarn install at the workspace root completes in seconds.

## Environment Variables

```
# Frontend
NEXT_PUBLIC_API_URL=http://localhost:18080
NEXT_PUBLIC_AUTH_URL=http://localhost:18081
NEXT_PUBLIC_WS_URL=ws://localhost:18080/ws

# Frontend feature flags (see app/lib/features.ts) — default off, set "true" to enable
NEXT_PUBLIC_FEATURE_RG=          # responsible-gambling pages (rg-history, self-exclude, /responsible-gaming/)
NEXT_PUBLIC_FEATURE_KYC=         # KYC / identity verification surface on /profile/
NEXT_PUBLIC_FEATURE_LIMITS=      # user-set deposit/stake/session limits — Limits tab on /profile/
NEXT_PUBLIC_FEATURE_CHAT=        # chat entry points; pairs with NEXT_PUBLIC_CHAT_PUBLIC_URL
NEXT_PUBLIC_CHAT_PUBLIC_URL=
NEXT_PUBLIC_FEATURE_SOCIAL_AUTH= # social login buttons (demo sets this true at build time)
NEXT_PUBLIC_FEATURE_LIVE_MARKETS=# /live route content + Live nav entries
NEXT_PUBLIC_DEMO_SYNTHETIC_CHARTS= # demo boxes ONLY: synthetic-walk chart fallback while loading/error/flat
NEXT_PUBLIC_HERO_AMBIENT_VIDEO=  # public asset path for the landing hero video; empty = no video element

# Gateway
GATEWAY_DB_DSN=postgres://...
WALLET_DB_DSN=postgres://...    # same DB, separate env (wallet service reads its own)
WALLET_STORE_MODE=db            # 'db' | 'memory' (default: memory)
PORT=18080                      # gateway/auth both read PORT; GATEWAY_PORT/AUTH_PORT are NOT read
GATEWAY_DB_DRIVER=postgres      # read by cmd/migrate
MIGRATIONS_DIR=                 # read by cmd/migrate; auto-detected if unset
REDIS_URL=redis://localhost:6380/0   # HTTP rate limiter + (with WS_BACKBONE=redis) WS fan-out
WS_BACKBONE=                    # 'redis' fans WebSocket broadcasts across gateway replicas over REDIS_URL
GATEWAY_RATELIMIT_RPM=120
GATEWAY_TRUSTED_PROXY_CIDRS=    # enables per-client rate-limit keying behind a proxy
AUTH_SERVICE_URL=http://localhost:18081
AUTH_COOKIE_SECURE=false        # required for localhost HTTP
GATEWAY_ALLOW_ADMIN_ANON=       # dev-only admin/RBAC bypass; refused at boot in prod/staging
GATEWAY_AUTH_ENABLED=           # 'false' is a dev-only kill switch; refused at boot in prod/staging
GATEWAY_READ_REPO_MODE=         # appears in docker-compose/CI but no Go code reads it — inert

# Gateway — activation knobs (all default OFF / fail-closed; the commented
# block in docker-compose.demo.yml is the canonical reference)
SMM_ENABLED=true                # synthetic market maker (also SMM_USER_ID, SMM_TICK_INTERVAL, SMM_DEPTH_CENTS, SMM_HALF_SPREAD_CENTS, SMM_MAX_DRIFT_CENTS — env names kept, values are Points)
STARTER_GRANT_CENTS=            # >0 enables the play-money faucet (one grant/user); Points, despite the name
DAILY_CLAIM_CENTS=              # >0 enables the daily claim; Points, despite the name
STORE_ENABLED=                  # 'true' mounts /api/v1/store/*; needs STORE_WEBHOOK_SECRET in prod/staging
KYC_IDV_PROVIDER=               # ''/'manual' = back-office review; else a vendor (needs KYC_IDV_API_KEY)
KYC_ENFORCEMENT=                # withdrawal-side KYC gate — only reachable when the legacy money routes are on
KYC_REQUIRED_FOR_TRADING=       # 'true' requires verified identity to trade
# Deny-by-default boot policy (ENVIRONMENT=production/staging, not acked-permissive):
# boot REQUIRES GEO_GATE_ENABLED=true + non-empty GEO_ALLOWED_COUNTRIES (allowlist
# mode mandatory) and each KYC flag above either 'true' or explicitly acked off:
KYC_ENFORCEMENT_ACK_DISABLED=          # 'true' = deliberately run without the withdrawal KYC gate
KYC_REQUIRED_FOR_TRADING_ACK_DISABLED= # 'true' = deliberately run without trading KYC
# BETA_COMPLIANCE_MODE=permissive is INVALID in production (boot error); staging/demo
# only, with COMPLIANCE_STARTUP_ACK=true.
GEO_GATE_ENABLED=               # 'true' enforces jurisdiction on the trading path (needs an edge country header, e.g. CF-IPCountry)
GEO_ALLOWED_COUNTRIES=          # comma-separated ISO-3166 allowlist; required in prod/staging
GEO_BLOCKED_COUNTRIES=          # denylist, evaluated by internal/compliance/geo_gate.go
GEO_TRUSTED_PROXY_MODE=         # 'require' = edge always sets the header; missing-signal denials log Error + counter
EDGE_SHARED_SECRET=             # anti-spoof (SEC-03): with TRUSTED_PROXY_MODE=require, guarded requests must carry this secret (stamped by Caddy as X-Edge-Auth) or be denied. REQUIRED in prod/staging when require-mode is on (boot fails otherwise). Bind gateway :18080 to loopback so only the edge can reach it.
PROVIDER_OPS_AUDIT_STORE_MODE=db # must be DB-backed in prod/staging (boot error otherwise)
SMTP_HOST=                      # set to send resolution emails; otherwise notifications log

# Gateway — launch boundary (see the Points-only section; all boot-refused in prod/staging)
TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED=  # mounts deposit/withdraw/cashier/crypto/provider-callback routes
ALPHA_CASHIER_ENABLED=                 # alpha crypto cashier; also requires the flag above
PAYMENTS_WEBHOOK_SECRET=               # only validated when the legacy money routes are enabled
CRYPTO_RPC_URL=                        # MUST be unset — any value refuses boot in production/staging
CRYPTO_ASSET_CONTRACT=                 # MUST be unset
CRYPTO_DEPOSIT_ADDRESS_SOURCE=         # MUST be unset

# Auth service — Social OAuth (full reference: go-platform/services/auth/.env.example).
# Each provider is OFF until its CLIENT_ID (TikTok: CLIENT_KEY) is set. Google /
# Discord assert a verified email (auto-link enabled); Facebook returns an email but
# no verified claim, so it is treated as unverified (isolated account, no auto-link);
# X / TikTok / Reddit return no email (isolated identity accounts). Each *_REDIRECT_URI must be
# registered in the provider console and be same-origin with the player app so the
# session cookies land on the right origin.
AUTH_FRONTEND_URL=http://localhost:3000   # where OAuth callbacks send the user post-login.
                                          # This is the code default (handlers.go). Local dev
                                          # runs the player app on 3010 — set it to :3010 there,
                                          # or OAuth returns the user to a dead port.
GOOGLE_OAUTH_CLIENT_ID=         # + GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REDIRECT_URI
FACEBOOK_OAUTH_CLIENT_ID=       # + FACEBOOK_OAUTH_CLIENT_SECRET / FACEBOOK_OAUTH_REDIRECT_URI
DISCORD_OAUTH_CLIENT_ID=        # + DISCORD_OAUTH_CLIENT_SECRET / DISCORD_OAUTH_REDIRECT_URI
TWITTER_OAUTH_CLIENT_ID=        # X (Twitter), PKCE: + TWITTER_OAUTH_CLIENT_SECRET / TWITTER_OAUTH_REDIRECT_URI
TIKTOK_OAUTH_CLIENT_KEY=        # TikTok: + TIKTOK_OAUTH_CLIENT_SECRET / TIKTOK_OAUTH_REDIRECT_URI
REDDIT_OAUTH_CLIENT_ID=         # + REDDIT_OAUTH_CLIENT_SECRET / REDDIT_OAUTH_REDIRECT_URI
```

## Public API Prefixes

Unauthenticated endpoints, from `gatewayPublicPrefixes()` in `cmd/gateway/main.go`. That function is the authority — re-read it rather than trusting this copy.

- `/healthz`, `/readyz`, `/metrics`, `/api/v1/status`
- `/api/v1/auth/`, `/auth/` (login/register/refresh proxy)
- `/ws` (WebSocket has its own auth)
- `/api/v1/content/`, `/api/v1/banners` (CMS)
- `/api/v1/discover`, `/api/v1/discovery`, `/api/v1/live-markets`, `/api/v1/categories`, `/api/v1/series`, `/api/v1/tags`, `/api/v1/events`, `/api/v1/markets`
- `/api/v1/leaderboards` (board list + entries; the per-user `/api/v1/me/leaderboards` still needs a session)
- `/api/v1/bot/` (bot API has its own API-key auth via `prediction.BotAuthMiddleware`)

Two conditional groups are appended only when their gate is on:

- `/api/v1/payments/webhook` and `/v1/provider-callbacks/` when `TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED=true`
- `/api/v1/store/webhook` when `STORE_ENABLED=true` (the handler verifies its own HMAC; every other `/api/v1/store/*` route stays session-authenticated)

Everything else requires a valid session cookie.

## Key Patterns

### Error Handling (TypeScript)

```typescript
// CORRECT — catch with unknown, type-check before use
catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  logger.error('Context', 'What failed', message);
}

// WRONG — never use any in catch blocks
catch (err: any) { ... }
```

### Logger Usage (TypeScript)

```typescript
import { logger } from '../lib/logger';
logger.error('Auth', 'Session check failed', err);
logger.info('WebSocket', 'Subscribed to channel', channelId);
```

### WalletAdapter pattern (Go)

The `prediction` package never imports `wallet` directly. Instead it depends on the `WalletAdapter` interface in `internal/prediction/wallet_adapter.go`:

```go
type WalletAdapter interface {
    Debit(ctx context.Context, userID string, amountPoints int64, idempotencyKey, reason string) error
    Credit(ctx context.Context, userID string, amountPoints int64, idempotencyKey, reason string) error
    Balance(ctx context.Context, userID string) int64
}
```

Two extensions live in the same file: `TxWalletAdapter` adds `BeginTx` / `DebitWithTx` / `CreditWithTx`, and `ExchangeWalletAdapter` adds the reservation primitives the matching engine needs (`BeginExchangeTx` at READ COMMITTED, `HoldWithTx`, `CaptureReservationWithTx`, `ReleaseReservationWithTx`). `NoopWallet` is the do-nothing implementation used in tests.

The concrete bridge lives in `internal/http/prediction_wallet_adapter.go`. Tests use `fakeWallet` (see `internal/prediction/wallet_wiring_test.go`). This keeps the prediction domain replaceable.

### Idempotency keys for wallet ops

Every wallet mutation is keyed so retries are safe:

- Order funds are **reserved**, not debited up front: `refType="prediction_order"`, `refID=<order id>` (idempotent on that pair)
- Fill capture: `prediction_fill:<tradeID>`
- Settlement credit: `prediction_payout:<marketID>:<positionID>`
- Void refund: `prediction_void:<marketID>:<positionID>`

This makes re-running a settle operation (or retrying a failed order) safe.

### Market lifecycle state machine

`internal/prediction/lifecycle.go` enforces valid transitions:

```
unopened             → open | voided
open                 → halted | closed | voided
halted               → open | closed | voided
closed               → proposed_resolution | settled | voided
proposed_resolution  → settled | disputed | voided
disputed             → settled | voided
settled              → (terminal)
voided               → (terminal)
```

Event status has a parallel FSM. Use `prediction.TransitionMarket()` / `CanTransition()`; `DescribeTapTradeMarketLifecycle()` produces the action list the back-office renders.

### Deterministic seed UUIDs

Seed data uses `md5(slug)::uuid` so `'series-mlbb-esports'` always maps to the same UUID. This makes re-running seeds safe (`ON CONFLICT DO NOTHING`) and lets integration tests reference markets by slug.

## Quality Standards

- 0 `any` types — use `unknown` or proper interfaces
- 0 `console.*` statements in TS production code — use `logger`
- 0 hardcoded user-facing strings — extract to `public/static/locales/<locale>/*.json`
- All catch blocks use `(err: unknown)` with `instanceof Error` checks
- All Go packages that touch the DB are testable via `Repository` interfaces + fakes
- Full build (`go build ./...` in gateway) and full tests (`go test ./...`) must pass before committing
- Frontend: `yarn test` in `packages/app`, `yarn lint:biome` from `frontend/`

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules (these are gstack plugin commands, not repo-local skills — this
repo ships no `.claude/skills/`):
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Code quality, health check → invoke health
