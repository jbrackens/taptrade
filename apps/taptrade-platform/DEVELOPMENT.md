# Tap Trade Developer Setup

This guide is the canonical local setup for the prediction-market stack.

## Prerequisites

- Node.js 20+
- Yarn 1.22.22
- Go 1.25+
- Docker Desktop
- Optional: `psql` and `redis-cli` for direct inspection

## One-Minute Local Start

Start the backend stack:

```bash
cd /Users/john/Sandbox/taptrade-workspace/taptrade/apps/taptrade-platform
docker compose up -d postgres redis gateway auth
docker compose ps
```

Start the player app:

```bash
cd /Users/john/Sandbox/taptrade-workspace/taptrade/apps/taptrade-platform/frontend/packages/app
NEXT_PUBLIC_API_URL=http://localhost:18080 \
NEXT_PUBLIC_AUTH_URL=http://localhost:18081 \
NEXT_PUBLIC_WS_URL=ws://localhost:18080/ws \
npm run dev -- -p 3010
```

Open `http://localhost:3010/predict`.

Demo login:

- Player: `demo@taptrade.local` / `demo123`
- Admin: `admin@taptrade.local` / `admin123`

## Ports

| Service | Port | URL |
| --- | --- | --- |
| Player app | 3010 | `http://localhost:3010/predict` |
| Backoffice | 3001 | `http://localhost:3001` |
| Gateway | 18080 | `http://localhost:18080/api/v1` |
| Auth | 18081 | `http://localhost:18081` |
| PostgreSQL | 5434 | `postgres://predict:localdev@localhost:5434/predict?sslmode=disable` |
| Redis | 6380 | `redis://localhost:6380/0` |

The Docker Compose database and Redis ports intentionally avoid the old sportsbook defaults on 5432 and 6379.

## Manual Database Reset

Use this only for local development data.

```bash
cd /Users/john/Sandbox/taptrade-workspace/taptrade/apps/taptrade-platform
docker compose down
docker volume rm taptrade-platform_postgres_data taptrade-platform_redis_data
# (pre-rebrand checkouts used: phoenix-predict-combined_postgres_data / _redis_data)
docker compose up -d postgres redis gateway auth
```

Apply migrations manually:

```bash
cd /Users/john/Sandbox/taptrade-workspace/taptrade/apps/taptrade-platform/go-platform/services/gateway
GATEWAY_DB_DSN="postgres://predict:localdev@localhost:5434/predict?sslmode=disable" \
MIGRATIONS_DIR="$(pwd)/migrations" \
go run ./cmd/migrate up
```

Seed prediction data manually:

```bash
cd /Users/john/Sandbox/taptrade-workspace/taptrade/apps/taptrade-platform/go-platform/services/gateway
GATEWAY_DB_DSN="postgres://predict:localdev@localhost:5434/predict?sslmode=disable" \
go run ./cmd/seed
```

## Player App Commands

```bash
cd /Users/john/Sandbox/taptrade-workspace/taptrade/apps/taptrade-platform/frontend/packages/app
npm run dev -- -p 3010
npm run typecheck
npm run typecheck:full
npm test
PLAYWRIGHT_BASE_URL=http://localhost:3010 npm run test:smoke
```

The app package exposes both `dev` and `run-local:dev`. Prefer `npm run dev -- -p 3010` for the player-only loop; use workspace commands only when you also need legacy workspace tooling.

## Go Commands

```bash
cd /Users/john/Sandbox/taptrade-workspace/taptrade/apps/taptrade-platform/go-platform
go test ./modules/platform/... ./services/gateway/... ./services/auth/...
```

Run gateway manually:

```bash
cd /Users/john/Sandbox/taptrade-workspace/taptrade/apps/taptrade-platform/go-platform/services/gateway
GATEWAY_DB_DSN="postgres://predict:localdev@localhost:5434/predict?sslmode=disable" \
WALLET_DB_DSN="postgres://predict:localdev@localhost:5434/predict?sslmode=disable" \
WALLET_STORE_MODE=db \
GATEWAY_READ_REPO_MODE=db \
GATEWAY_PORT=18080 \
AUTH_SERVICE_URL=http://localhost:18081 \
PAYMENTS_WEBHOOK_SECRET=whsec_local \
go run ./cmd/gateway
```

Closed Alpha USDC cashier local flags are disabled by default. Add these only
when testing the Alpha cashier flow with a fake RPC, test RPC, or reviewed live
RPC:

```bash
ALPHA_CASHIER_ENABLED=false
ALPHA_CASHIER_CHAIN_ID=8453
ALPHA_CASHIER_CHAIN_NAME=base
ALPHA_CASHIER_RPC_URL=
ALPHA_CASHIER_TOKEN_SYMBOL=USDC
ALPHA_CASHIER_TOKEN_ADDRESS=
ALPHA_CASHIER_TOKEN_DECIMALS=6
ALPHA_CASHIER_TREASURY_ADDRESS=
ALPHA_CASHIER_CONFIRMATIONS=12
ALPHA_CASHIER_MIN_DEPOSIT_CENTS=100
ALPHA_CASHIER_MAX_DEPOSIT_CENTS=25000
ALPHA_CASHIER_DAILY_DEPOSIT_LIMIT_CENTS=100000
ALPHA_CASHIER_WITHDRAWALS_ENABLED=false
ALPHA_CASHIER_WITHDRAWAL_REVIEW_REQUIRED=true
ALPHA_CASHIER_WITHDRAWAL_BROADCAST_ACK=false
```

Keep `ALPHA_CASHIER_WITHDRAWALS_ENABLED=false` for Stage 1. Manual payout keys
stay outside the app, and local development should not set the legacy
`CRYPTO_RPC_URL`/`CRYPTO_ASSET_CONTRACT` rail for Alpha cashier testing.

Run auth manually:

```bash
cd /Users/john/Sandbox/taptrade-workspace/taptrade/apps/taptrade-platform/go-platform/services/auth
AUTH_STORE_MODE=db \
AUTH_DB_DSN="postgres://predict:localdev@localhost:5434/predict?sslmode=disable" \
AUTH_COOKIE_SECURE=false \
AUTH_PORT=18081 \
go run ./cmd/auth
```

## API Smoke Checks

```bash
curl -i http://localhost:18080/api/v1/discovery/
curl -i http://localhost:18080/api/v1/categories/
curl -i http://localhost:18080/api/v1/markets/
```

Login through the player app at `http://localhost:3010/auth/login`, then test authenticated pages:

- `http://localhost:3010/portfolio`
- `http://localhost:3010/market/SENATE-DEM-2026/?side=yes&amount=5`

## Troubleshooting

For concrete response shapes, common status codes, and request evidence to collect, see [Error and debugging guide](./ERRORS.md). For copy-paste API calls, see [API examples](./API_EXAMPLES.md).

If `npm run dev` says the port is in use:

```bash
lsof -nP -iTCP:3010 -sTCP:LISTEN
```

If public market pages show WebSocket auth errors, check that the page is not subscribing before auth is available and that `NEXT_PUBLIC_WS_URL=ws://localhost:18080/ws`.

If API calls return `401 authentication required`, confirm that the endpoint is meant to be public. Portfolio, orders, and trading endpoints require login.

If data looks stale, check Docker container health:

```bash
cd /Users/john/Sandbox/taptrade-workspace/taptrade/apps/taptrade-platform
docker compose ps
docker compose logs --tail=100 gateway auth
```
