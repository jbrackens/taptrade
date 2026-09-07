# Upgrade Guide

Use this guide when moving an existing local or preview environment to a newer Tap Trade build.

## Before You Upgrade

Record the current version and state:

```bash
git rev-parse --short HEAD
docker compose ps
```

Back up local data when you care about preserving trades or wallet history:

```bash
docker compose exec -T postgres pg_dump -U predict predict > predict-backup.sql
```

Check for pending local migrations:

```bash
cd /Users/john/Sandbox/Taya_NA_Predict/Taya_Na_Predict/apps/taptrade-platform/go-platform/services/gateway
ls migrations
```

## Standard Local Upgrade

Pull or switch to the target commit, then rebuild and migrate:

```bash
cd /Users/john/Sandbox/Taya_NA_Predict/Taya_Na_Predict/apps/taptrade-platform
docker compose build gateway auth
docker compose up -d postgres redis gateway auth
```

Run gateway migrations:

```bash
cd /Users/john/Sandbox/Taya_NA_Predict/Taya_Na_Predict/apps/taptrade-platform/go-platform/services/gateway
GATEWAY_DB_DSN="postgres://predict:localdev@localhost:5434/predict?sslmode=disable" \
MIGRATIONS_DIR="$(pwd)/migrations" \
go run ./cmd/migrate up
```

Re-seed only when you intentionally want local demo data refreshed:

```bash
GATEWAY_DB_DSN="postgres://predict:localdev@localhost:5434/predict?sslmode=disable" \
go run ./cmd/seed
```

Start the player app:

```bash
cd /Users/john/Sandbox/Taya_NA_Predict/Taya_Na_Predict/apps/taptrade-platform/frontend/packages/app
NEXT_PUBLIC_API_URL=http://localhost:18080 \
NEXT_PUBLIC_AUTH_URL=http://localhost:18081 \
NEXT_PUBLIC_WS_URL=ws://localhost:18080/ws \
npm run dev -- -p 3010
```

## Domain Migration Notes

This repo was forked from a sportsbook product. New prediction-market work must not add fresh sportsbook concepts.

| Old sportsbook term | Current prediction term |
| --- | --- |
| Fixture | Event |
| Selection | Side or outcome |
| Bet | Order |
| Bet slip | Trade ticket |
| Punter | User |
| Stake | Notional amount |
| Odds | Price in cents |

When upgrading code or data:

- Prefer `prediction_*` tables for new exchange, portfolio, settlement, and order work.
- Do not add new use of `punter_bets`, `selections`, `fixtures`, `sport_key`, or bet-slip concepts for prediction features.
- Multi-outcome questions should be represented as multiple binary YES/NO markets.
- Existing archived sportsbook code may remain untouched unless the upgrade directly depends on it.

## Breaking-Change Checklist

Before merging an upgrade, answer these:

- Does the migration preserve existing `prediction_orders`, positions, and wallet ledger rows?
- Does any route, environment variable, or port change require README and DEVELOPMENT updates?
- Do generated API types or OpenAPI docs need to change?
- Do smoke tests still cover `/predict`, `/market/{ticker}`, login, portfolio, and invalid market recovery?
- Does the changelog name the user-visible change and any operator action?

## Verification

```bash
cd /Users/john/Sandbox/Taya_NA_Predict/Taya_Na_Predict/apps/taptrade-platform/frontend/packages/app
npm run typecheck
PLAYWRIGHT_BASE_URL=http://localhost:3010 npm run test:smoke
```

```bash
cd /Users/john/Sandbox/Taya_NA_Predict/Taya_Na_Predict/apps/taptrade-platform/go-platform
go test ./modules/platform/... ./services/gateway/... ./services/auth/...
```

## Rollback

For code-only rollback, switch back to the previous commit and rebuild:

```bash
git switch -
docker compose build gateway auth
docker compose up -d gateway auth
```

For schema rollback, prefer restoring a database backup over hand-editing rows:

```bash
docker compose exec -T postgres psql -U predict -d predict < predict-backup.sql
```

Do not roll back exchange-engine migrations on a shared environment without a data-specific plan. Orders, fills, wallet holds, and settlement state need to stay internally consistent.

