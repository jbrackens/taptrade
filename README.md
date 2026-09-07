# Tap Trade

Prediction-market platform for trading binary YES/NO contracts on real-world outcomes.

Prices are whole **Points**, 1–99, where the YES price is the implied probability and
`yes + no = 100`. A correct contract settles at 100 Points. Points are non-redeemable
in-platform play value (1 Point = 1 cent nominal): there is no withdrawal, cash-out, or
redemption path anywhere in the product. Points can be bought through the point store
(`/api/v1/store/*`, player route `app/store/page.tsx`) — money in, points out, never back.
The store routes mount only under `STORE_ENABLED=true`, so add it to the gateway
environment if you want `/store` working locally.

This repo was forked from the Taya NA sportsbook codebase on 2026-04-16. Current product
language, setup commands, and docs use the prediction-market domain: categories, series,
events, markets, orders, positions, trades, and settlements.

## Surfaces

| Surface | Path | Local URL |
| --- | --- | --- |
| Player app | `apps/taptrade-platform/frontend/packages/app` | `http://localhost:3010/predict` |
| Backoffice | `apps/taptrade-platform/frontend/packages/office` | `http://localhost:3001` |
| Gateway API | `apps/taptrade-platform/go-platform/services/gateway` | `http://localhost:18080/api/v1` |
| Auth service | `apps/taptrade-platform/go-platform/services/auth` | `http://localhost:18081` |
| PostgreSQL | Docker Compose service `postgres` | `localhost:5434` |
| Redis | Docker Compose service `redis` | `localhost:6380` |

## Quick Start

Prerequisites:

- Node.js 20+
- Yarn 1.22.22
- Go 1.25+
- Docker Desktop

### 1. Start the datastores

```bash
cd /Users/john/Sandbox/Taya_NA_Predict/Taya_Na_Predict/apps/taptrade-platform
docker compose up -d postgres redis
```

### 2. Migrate and seed

Nothing migrates the database for you — the gateway does not self-migrate, and Compose
has no migrate or seed service. Skip this and every market page comes up empty against a
schema-less database.

```bash
cd /Users/john/Sandbox/Taya_NA_Predict/Taya_Na_Predict/apps/taptrade-platform/go-platform/services/gateway
export GATEWAY_DB_DSN="postgres://predict:localdev@localhost:5434/predict?sslmode=disable"
export MIGRATIONS_DIR="$(pwd)/migrations"
go run ./cmd/migrate up
make seed
```

`make seed` loads the base catalogue with empty order books. For a clickable demo — a
market-maker book, backdated volume, an open portfolio and settled markets — run
`make demo-data` instead; `make wipe-demo` removes only what the demo phases wrote.

### 3. Run the Go services

```bash
# Gateway, port 18080
cd /Users/john/Sandbox/Taya_NA_Predict/Taya_Na_Predict/apps/taptrade-platform/go-platform/services/gateway
GATEWAY_DB_DSN="postgres://predict:localdev@localhost:5434/predict?sslmode=disable" \
WALLET_DB_DSN="postgres://predict:localdev@localhost:5434/predict?sslmode=disable" \
WALLET_STORE_MODE=db \
go run ./cmd/gateway

# Auth service, port 18081 — needed for anything behind a session
cd ../auth
AUTH_STORE_MODE=db \
AUTH_DB_DSN="postgres://predict:localdev@localhost:5434/predict?sslmode=disable" \
AUTH_COOKIE_SECURE=false \
go run ./cmd/auth
```

### 4. Install the frontend and run the player app

`frontend/` is a yarn-1 workspace. Install from the workspace root, not from a
sub-package — npm does not detect the workspace declaration up-tree and hangs.

```bash
cd /Users/john/Sandbox/Taya_NA_Predict/Taya_Na_Predict/apps/taptrade-platform/frontend
yarn install --frozen-lockfile

cd packages/app
NEXT_PUBLIC_API_URL=http://localhost:18080 \
NEXT_PUBLIC_AUTH_URL=http://localhost:18081 \
NEXT_PUBLIC_WS_URL=ws://localhost:18080/ws \
yarn dev -p 3010
```

Open `http://localhost:3010/predict`. Port 3010 is a convention, not a requirement —
Next defaults to 3000 — but the Playwright suite's default `baseURL` is 3010, so using it
keeps the smoke commands below working unchanged.

Demo player login:

- Email: `demo@taptrade.local`
- Password: `demo123`

## Developer Checks

Player app:

```bash
cd /Users/john/Sandbox/Taya_NA_Predict/Taya_Na_Predict/apps/taptrade-platform/frontend/packages/app
yarn typecheck
yarn test
PLAYWRIGHT_BASE_URL=http://localhost:3010 yarn test:smoke
```

Gateway/auth:

```bash
cd /Users/john/Sandbox/Taya_NA_Predict/Taya_Na_Predict/apps/taptrade-platform/go-platform
go test ./modules/platform/... ./services/gateway/... ./services/auth/...
```

## Docs

- [Project instructions](./CLAUDE.md) — architecture, conventions, agent rules
- [Current state](./CURRENT_STATE.md) — what is live, what is off, what is open
- [Design system](./DESIGN.md) — mirrors `globals.css`; the CSS wins
- [Point store and payments](./STORE_AND_PAYMENTS.md)
- [Product user journeys](./PRODUCT-USER-JOURNEYS.md)
- [Combined app README](./apps/taptrade-platform/README.md)
- [Developer setup](./apps/taptrade-platform/DEVELOPMENT.md)
- [API examples](./apps/taptrade-platform/API_EXAMPLES.md)
- [Error and debugging guide](./apps/taptrade-platform/ERRORS.md)
- [Changelog](./apps/taptrade-platform/CHANGELOG.md)
- [Migration guide](./apps/taptrade-platform/MIGRATION.md)
- [Upgrade guide](./apps/taptrade-platform/UPGRADE.md)
- [Developer experience scorecard](./apps/taptrade-platform/DX.md)
- [Contributing](./CONTRIBUTING.md)
- [Support](./SUPPORT.md)
- [Security](./SECURITY.md)
- [Code of conduct](./CODE_OF_CONDUCT.md)
- [Archived documentation](./docs/archive/) — historical records; none of it describes
  the current system

## Current Product Model

```
Category
  -> Series
      -> Event
          -> Market
              -> Orders / Positions / Trades / Settlement
```

Multi-outcome questions are represented as multiple binary markets, one market per
candidate outcome.

## Important Guardrails

- Do not reintroduce sportsbook concepts in prediction-market code.
- Do not use `fixtures`, `selections`, `betslip`, `sport_key`, or `punter_bets` for new
  prediction features.
- Amounts are Points, not cents and not dollars. The wire contract is `*Points` with
  `unit: "PTS"`; migration `050_points_unit_model.sql` retired every `*_cents` column in
  the active economy and the test suite fails on the old spellings.
- The legacy cashier, deposit, withdrawal, crypto and provider-callback route trees are
  boot-blocked in production and staging
  (`TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED`, `ALPHA_CASHIER_ENABLED`). Do not re-enable them.
- Player app UI uses Tailwind/inline styles, not `@taptrade-ui/design-system`.
- Production code should use structured loggers, not raw `console.*`.
- New database tables or columns require a new goose migration.
