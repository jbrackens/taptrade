# Error And Debugging Guide

This guide covers the errors a developer is most likely to hit while running Tap Trade locally.

## Error Shape

Gateway JSON errors should use this envelope:

```json
{
  "error": {
    "code": "not_found",
    "message": "market not found",
    "requestId": "13de804b17b9b2f800458e7faf7e4679",
    "details": {}
  }
}
```

Log the `requestId` when reporting a backend issue. It is the quickest way to connect a browser failure, gateway log line, and test failure.

## Common HTTP Errors

| Status | Typical code | Meaning | First checks |
| --- | --- | --- | --- |
| `400` | `bad_request` | The request body or query params are invalid. | Validate enum casing, required fields, quantity, price, and `notionalCapCents` for market buys. |
| `401` | `unauthorized` | No valid session or bearer token. | Re-login, clear stale cookies, verify auth service is running. |
| `403` | `forbidden` | Authenticated user lacks permission. | Use the admin demo user for admin routes. |
| `404` | `not_found` | Ticker, market ID, order ID, or route does not exist. | Re-fetch discovery data instead of hardcoding tickers. |
| `409` | `conflict` | Duplicate idempotency key, lifecycle race, or incompatible state. | Use a fresh idempotency key and reload the market state. |
| `422` | `validation_failed` | Domain validation failed. | Check market status, price bounds, position size, balance, and execution mode. |
| `500` | `internal` | Unexpected gateway/service error. | Capture `requestId`, gateway logs, and the exact request body. |

## Useful Local Commands

Stack health:

```bash
cd /Users/john/Sandbox/taptrade-workspace/taptrade/apps/taptrade-platform
docker compose ps
docker compose logs --tail=100 gateway auth
```

Gateway smoke:

```bash
curl -i http://localhost:18080/api/v1/discovery
curl -i http://localhost:18080/api/v1/markets/not-a-real-market
```

Player app checks:

```bash
cd /Users/john/Sandbox/taptrade-workspace/taptrade/apps/taptrade-platform/frontend/packages/app
npm run typecheck
PLAYWRIGHT_BASE_URL=http://localhost:3010 npx playwright test tests/smoke/market-detail.smoke.spec.ts --project=desktop-chromium
```

Go tests:

```bash
cd /Users/john/Sandbox/taptrade-workspace/taptrade/apps/taptrade-platform/go-platform
go test ./modules/platform/... ./services/gateway/... ./services/auth/...
```

## Browser Console Errors

Treat console errors as test failures unless they are explicitly known-safe in `tests/smoke/_shared.ts`.

Important cases:

- Public market detail pages may fetch public market data and trades without login.
- Public market detail pages must not subscribe to auth-gated WebSocket channels before auth state is known.
- Invalid market pages may show a browser network 404 for the intentionally missing market fetch, but the UI should render a helpful recovery message instead of the Next.js error boundary.

## Trading Validation Checklist

Before debugging the exchange engine, confirm the submitted order fields:

- `marketId` is the UUID, not just the ticker.
- `side` is `yes` or `no`.
- `action` is `buy` or `sell`.
- `orderType` is `limit` or `market`.
- Limit orders include `priceCents` in the 1-99 range.
- Market buy orders include `notionalCapCents`.
- `quantity` is positive.
- `timeInForce` is compatible with the order type: `gtc`, `ioc`, or `fok`.
- The market is open and uses the expected `executionMode`.

## What To Attach To A Bug

- URL and route, for example `/market/{ticker}`.
- Request method, URL, body, and response status.
- Error envelope including `requestId`.
- Browser console output.
- Gateway/auth logs around the request.
- Whether the user was authenticated, and which demo account was used.

