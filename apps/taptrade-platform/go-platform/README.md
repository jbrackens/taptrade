# Tap Trade Go Platform

This directory is the Go workspace for Tap Trade backend services. Tap Trade is a
prediction-market app that uses non-redeemable gameplay points only.

## Workspace Layout

- `modules/platform`: shared runtime primitives and reusable platform utilities.
- `services/gateway`: prediction-market API gateway (HTTP + WebSocket).
- `services/auth`: authentication / session service.

`go.work` uses those three modules.

## Quick Start

```bash
cd /Users/john/Sandbox/taptrade-workspace/taptrade/apps/taptrade-platform/go-platform
go work sync
go test ./...
```

## Run Services

Both services fall back to in-memory stores without a database, which is only
useful for a smoke test. For real work start Postgres from
`apps/taptrade-platform` with `docker compose up -d postgres` (database
`predict`, user `predict`, host port 5434), then apply migrations — see
`services/gateway/migrations/README.md`.

```bash
cd /Users/john/Sandbox/taptrade-workspace/taptrade/apps/taptrade-platform/go-platform

# Both services take the same DSN:
#   postgres://predict:localdev@localhost:5434/predict?sslmode=disable

# Gateway
GATEWAY_DB_DSN="postgres://predict:localdev@localhost:5434/predict?sslmode=disable" \
  WALLET_DB_DSN="postgres://predict:localdev@localhost:5434/predict?sslmode=disable" \
  WALLET_STORE_MODE=db \
  go run ./services/gateway/cmd/gateway

# Auth service
AUTH_STORE_MODE=db \
  AUTH_DB_DSN="postgres://predict:localdev@localhost:5434/predict?sslmode=disable" \
  AUTH_COOKIE_SECURE=false \
  go run ./services/auth/cmd/auth
```

The gateway reaches the prediction schema through the wallet service's database
handle, so `WALLET_DB_DSN` and `WALLET_STORE_MODE=db` are what actually give it a
repository. Without them it starts but logs `prediction: no DB available` and the
prediction routes do not work. `AUTH_COOKIE_SECURE=false` is required over plain
HTTP on localhost.

Default service ports:

- gateway: `18080`
- auth: `18081`

Override with the `PORT` environment variable:

```bash
PORT=19000 go run ./services/gateway/cmd/gateway
```

## Launch Boundary

Launch services register points-only prediction, account, reward, moderation,
and admin operations. Historical compatibility packages may remain in source for
tests and archival migration work, but launch service configuration keeps those
external-value rails out of the active route tree — the gateway refuses to boot
in `production`/`staging` if `TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED` or
`ALPHA_CASHIER_ENABLED` is set to `true`.
