# Tap Trade — CLAUDE.md

> **Documentation:** the project's knowledge base is [`docs/`](docs/README.md) —
> architecture, data model, current spec, integrations, environment, deployment,
> tech debt, tasks and ADRs, each the single home for its topic. This file keeps
> the rules and procedures agents must follow and links to `docs/` for reference
> detail. A change to behaviour, architecture, schema, an integration or setup
> updates the authoritative doc in the same change
> ([rules](docs/README.md#how-to-maintain-these-documents)).

## Project Overview

**Tap Trade** is a prediction event market platform in the shape of Polymarket and Kalshi. Users trade binary YES/NO contracts on real-world outcomes: politics, esports, sports, entertainment, tech, economics.

Contracts are priced in **Points** (shown to players as **Clout**), 1–99, where the price is the implied probability. `yes_price_points + no_price_points = 100`; a correct contract settles at 100 Points, a wrong one at 0. **Points are non-redeemable play value** — the gateway reports `pointMode: "non_redeemable_points"` on `/api/v1/status`, the deposit/withdrawal/cashier/crypto route trees are unmounted by default, and the flags that would mount them are refused at boot in production/staging. See "Points-only launch boundary" below before touching anything money-shaped.

The project was **forked from Taya Na Sportsbook on 2026-04-16** and transformed: the sports-betting domain (sports/fixtures/markets/selections/bets) was replaced with a prediction-market domain (categories/series/events/markets/orders/positions). Shared infrastructure — auth, wallet/ledger, WebSocket hub, CSRF, OpenTelemetry — was preserved.

The app has three surfaces:
- **Player app** (Next.js 16 App Router) — discovery (featured market + card grid) with in-place quick trade, market detail, event pages, trade ticket, portfolio
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
│   │   │   ├── migrations/                ← 014 created the prediction schema; 065 is the highest today
│   │   │   └── seed-data/seed_prediction.sql
│   │   ├── services/auth/                 ← Auth service (Go, port 18081)
│   │   └── modules/platform/              ← Shared Go module `taptrade/platform` (canonical, logging, runtime, transport/httpx)
│   ├── docker-compose.yml                 ← PostgreSQL (5434) + Redis (6380) + gateway + auth
│   └── docker-compose.demo.yml            ← demo box: adds player, office, Caddy, backups
├── contracts/                             ← Solidity interfaces — dormant, see launch boundary
├── packages/cashier-sdk/                  ← dormant, see launch boundary
├── services/                              ← cashier-api, bridge-watcher, relayer — dormant, see launch boundary
├── docs/                                  ← the documentation: start at docs/README.md (ADRs, audits, archive inside)
├── scripts/                               ← agent-preflight.sh, cashier guard scripts
├── Makefile                               ← one target: `make cashier-check` (validates the dormant trees)
├── CLAUDE.md                              ← this file
└── DESIGN.md                              ← design system (Kilig palette: ink + white, Kilig pink, blue/orange YES/NO; Inter); mirrors the code
```

Design values are canonical in `apps/taptrade-platform/frontend/packages/app/app/globals.css` `:root` and the fonts in `app/layout.tsx`, not in prose. The current system is **Kilig** (adopted 2026-09-24): ink `#111114` and white chrome with ink as the interaction colour (primary buttons, selection, focus), `--kilig #e0126e` pink for identity and liveness only (text on light uses `--kilig-text #c40f60`; never the default button), `--paper #f5f5f7` page ground, YES blue `--dir-yes #1f5fe0` and NO orange `--dir-no #c94a12` for market direction only, and one typeface, Inter (next/font), in sentence case with tabular figures for numbers (`font-mono` is a numeric utility, not a second face; `.type-poster` is the semibold heading class). Every market shows a `MarketThumb` image tile (photo or tinted category icon). Cards are 12px with a whisper of elevation; controls are 8px. Those values are pinned by `app/__tests__/color-system.test.ts`. Prices read "44 Clout" (the play currency's name since 2026-09-28, on the same 0–100 scale as a 0–$1 contract), never "¢" or "pts", and loyalty progress reads "XP"; `app/__tests__/clout-currency.test.ts` pins that. **Read `DESIGN.md`, `globals.css` and `color-system.test.ts` before any UI change**; `DESIGN.md` is the narrative mirror and covers the player app only — office runs a separate palette (see the Backoffice section). The old `--brand-*` / `--signal-gold*` / `--on-brand` names are deprecated aliases kept only so unmigrated files render; replace them when you touch a file.

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
4. **New tables/columns** go through a new goose migration with the next free prefix — run `ls migrations/ | tail` first (065 is the highest today, so the next is 066). Never edit a shipped migration in place. In particular, 014's column names are no longer the live schema: 050 renamed them.

## Points-only launch boundary

The platform launches on non-redeemable Points. There is no cash-out.

- `/api/v1/status` reports `pointMode: "non_redeemable_points"` and the enabled/disabled state of the legacy money routes (`internal/http/handlers.go`).
- `TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED` (default off, `internal/http/launch_boundary.go`) is the single switch that mounts the legacy deposit / withdrawal / payments-webhook / provider-callback trees and the alpha cashier. Setting it to `true` when `ENVIRONMENT=production|staging` is a **boot error**.
- `ALPHA_CASHIER_ENABLED=true` is likewise a boot error in production/staging, and outside those envs it additionally requires the legacy flag.
- `CRYPTO_RPC_URL`, `CRYPTO_ASSET_CONTRACT` and `CRYPTO_DEPOSIT_ADDRESS_SOURCE` **must be unset**: in production/staging any non-empty value refuses boot (`cmd/gateway/main.go`, `validateGatewayRuntimeConfig`). They configured the legacy crypto rail (`payments/crypto_rail.go`), removed on 2026-09-29 as a fail-closed stub duplicating the alpha cashier; the refusal stays so a stale config fails loudly. They are not activation knobs.
- `internal/payments/`, `internal/alphacashier/`, plus the root-level `contracts/`, `packages/cashier-sdk/` and `services/{cashier-api,bridge-watcher,relayer}` are the **dormant real-money workstream**. They are validated by `make cashier-check` and are not deployed. Do not treat them as live seams, and do not delete them without asking.
- **The cashier is merged but dark (2026-09-29).** `feat/hula-na-cashier` was reconciled into `main` by hand: its crypto deposit watcher became alphacashier's `DepositScanner` (`internal/alphacashier/deposit_scanner.go`, migration 065, `ALPHA_CASHIER_DEPOSIT_SCANNER_ENABLED`), and the player app gained one page, `/cashier` (a read-only deposit card on `GET /api/v1/cashier/alpha/config`), which calls `notFound()` unless `NEXT_PUBLIC_FEATURE_CASHIER_UI=true` at build time. Nothing links to it. Its sportsbook-era cashier UI (USD methods, cheque payouts) and duplicate Solidity were dropped. The same pass hardened the rails: withdrawal completion requires on-chain proof from `ALPHA_CASHIER_PAYOUT_ADDRESS` (default: the treasury), deposit/withdrawal requests serialize per user, the withdrawal KYC threshold counts both rails (`payments.CrossRailWithdrawnCents`), and cashier admin actions refuse to run without RBAC when a DB is configured. `internal/http/demo_money_flags_test.go` fails CI if the demo compose file or deploy workflow ever sets a money flag, and `app/__tests__/cashier-flag.test.ts` pins the page's gate.
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

The app ships 38 pages (plus one API route) under `app/`. Every page with its
status is in [docs/SPEC_CURRENT.md §3](docs/SPEC_CURRENT.md#3-player-app-pages);
board, event-card, featured-rail, quick-trade and landing behaviour in §3.1;
market covers in [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md#market-covers).
Rules to keep in mind:

- The trading surface is `/predict` (board), `/market/[ticker]`, `/event/[id]`
  and `/portfolio`; the components live in `app/components/prediction/`.
- **Retired:** the 2026-08-12 Floor redesign trial (`/floor`, `/book`,
  `/standing`, `components/floor/`) was removed on 2026-09-23. `next.config.js`
  redirects those routes and `app/__tests__/floor-retirement.test.ts` keeps them
  gone. Discovery pages use `CategoryTabs`; the old `TerminalCategoryRail` is gone.
- Public read routes must be listed in `gatewayPublicPrefixes()`
  (`cmd/gateway/main.go`) or they 401.
- Market thumbnails (`/images/markets/*`) are served by Caddy from the
  `market_images` volume, not by Next.js (which only serves `public/` files
  present at start-up).
- Before changing the cover resolver, run
  `COVER_LIVE_TEST=titles.json go test ./internal/discover -run Live` against
  real board titles and review the picks. `image_origin='manual'` covers are
  never overwritten.
- The `/` landing page's money-word legal lines are inline English constants in
  `components/welcome/WelcomeSections.tsx`, not locale strings (the locale
  scanner bans that vocabulary).

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

All under `app/(dashboard)/`; the full list with status is in
[docs/SPEC_CURRENT.md §5](docs/SPEC_CURRENT.md#5-back-office). `campaigns` and
`reports` are retired shells that redirect to `/dashboard`, and
`risk-management` redirects to `/prediction-admin/risk` — don't build on them.

## Back-office RBAC (Access Control)

Staff authorization is separate from players: `admin_users`, `roles`,
`permissions`, `user_roles`, `role_permissions` (migration 027 and later), bound
to the session by email. Roles, permissions, the enforcement functions and the
safety invariants are in [docs/SPEC_CURRENT.md §6](docs/SPEC_CURRENT.md#6-permissions).
Code: `internal/rbac/`, `internal/http/rbac_admin_handlers.go`; UI:
`office/app/(dashboard)/access-control/`.

- **Enforce at the gateway.** New admin routes use `requireAdminPermission`
  with a specific permission — never a header, and never only the office UI.
- **Login:** the auth service `Login` falls back to `admin_users` (active,
  role=admin), so staff created in the office sign in with their temporary
  password (`services/auth/internal/http/handlers.go` `lookupAdminUser`).
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
- **Auth:** opaque session tokens issued by the auth service (HttpOnly cookies or bearer), validated by `httpx.Auth` against the auth service; `gatewayPublicPrefixes()` in `cmd/gateway/main.go` lists the routes that skip it. `JWT_SECRET` in the compose files is read by no code
- **Matching:** the binary exchange (`internal/prediction/exchange.go`) is the live execution path — a central limit order book with limit + market orders, partial fills, complementary issuance, sells from existing positions, and wallet reservations. Matching runs at READ COMMITTED under `pg_advisory_xact_lock` per market; the engine is pure and `SQLRepository.PersistMatchAtomic` does the writing.
- **AMM:** LMSR in `internal/prediction/amm.go` — cost function `C(q) = b * ln(e^(q_yes/b) + e^(q_no/b))`. **Execution against the AMM is retired (P2-09).** `PlaceOrder` rejects markets with `execution_mode='amm'`; the engine survives only to quote legacy AMM market detail. New markets default to `execution_mode='order_book'` (migration 019).
- **Background workers** are wired in `internal/http/handlers.go` (most in
  `internal/prediction/workers/`); every worker, its interval, flag and failure
  handling: [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md#background-workers-and-scheduled-jobs).
- **Middleware order:** `httpx.Chain` makes the *first* listed middleware the
  outermost — the opposite of what the comments in `cmd/gateway/main.go` assume
  ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), TD-055).

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

`internal/` holds 23 packages; the package map (domain, platform, dormant) is in
[docs/ARCHITECTURE.md §2](docs/ARCHITECTURE.md#2-gateway-internals). Dormant:
`payments`, `alphacashier` (see the launch boundary). Built but not wired:
`approval` (the two-person rule, waiting on a decision about which admin actions
need a second admin). `webhookauth` is the one inbound webhook signature check.

## Local Development

Setup, running each service, ports, seed modes and commands are in
[docs/ENVIRONMENT.md](docs/ENVIRONMENT.md). The essentials: Postgres on 5434,
Redis on 6380, gateway 18080, auth 18081, player 3010, office 3001. Install the
front ends with `yarn install --frozen-lockfile` **from `apps/taptrade-platform/frontend/`**
(never `npm install` in a package — it hangs). Seed modes (`make seed`,
`make demo-data`, `make wipe-demo`) live in the **gateway** Makefile. Demo data
is written through `Service.PlaceOrder` and `Service.ResolveMarket`, the same
paths as live requests, so the ledger stays consistent.

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

A macOS brotli code-signature crash during install has a fix in
[docs/ENVIRONMENT.md](docs/ENVIRONMENT.md#known-macos-issue--brotli).

## Environment Variables

Every variable the code reads — gateway, auth, player, office — with defaults
and production/staging constraints is in
[docs/ENVIRONMENT.md §3](docs/ENVIRONMENT.md#3-environment-variables); the
production boot rules are in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#required-productionstaging-configuration).
The launch-boundary variables are summarised in the section above. Never set a
money flag in the demo compose file or deploy workflow — CI fails if you do.

## Public API Prefixes

`gatewayPublicPrefixes()` in `cmd/gateway/main.go` is the authority for which
routes skip session auth; a summary is in
[docs/SPEC_CURRENT.md §6](docs/SPEC_CURRENT.md#6-permissions). A new public read
route must be added there or it 401s. Everything else requires a valid session.

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

### WalletAdapter, idempotency keys, lifecycle, seed ids

- `prediction` never imports `wallet`; it depends on the interfaces in
  `internal/prediction/wallet_adapter.go`, bridged by
  `internal/http/prediction_wallet_adapter.go`
  ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#prediction--wallet-boundary--the-walletadapter-pattern)).
- Every wallet mutation carries an idempotency key; order funds are reserved,
  not debited ([docs/ARCHITECTURE.md §3](docs/ARCHITECTURE.md#3-core-patterns),
  [docs/DATA_MODEL.md](docs/DATA_MODEL.md#idempotency-keys-exactly-once)).
- Market and event status changes go through `prediction.TransitionMarket()` /
  `CanTransition()` in `internal/prediction/lifecycle.go` (state diagram:
  [docs/DATA_MODEL.md](docs/DATA_MODEL.md#marketevent-lifecycle-state-machines)).
- Seed data uses `md5(slug)::uuid` ids so re-running seeds is safe.

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
