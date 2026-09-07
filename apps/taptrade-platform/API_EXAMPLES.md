# API Examples

Concrete calls for the local Tap Trade gateway. Start the backend stack first:

```bash
cd /Users/john/Sandbox/taptrade-workspace/taptrade/apps/taptrade-platform
docker compose up -d postgres redis gateway auth
```

Use these variables for the examples:

```bash
export API=http://localhost:18080
export DEMO_USERNAME=demo@taptrade.local
export DEMO_PASSWORD=demo123
```

## Public Market Data

Discovery feed:

```bash
curl -s "$API/api/v1/discovery" | jq '.featured[0] | {id, ticker, title, status, yesPriceCents, noPriceCents, executionMode}'
```

Categories:

```bash
curl -s "$API/api/v1/categories" | jq '.[0:5] | map({id, slug, name})'
```

Open markets:

```bash
curl -s "$API/api/v1/markets?status=open&page=1&pageSize=5" | jq '.data[] | {id, ticker, title}'
```

Market detail by ticker or ID:

```bash
export TICKER="$(curl -s "$API/api/v1/discovery" | jq -r '.featured[0].ticker // .trending[0].ticker')"
curl -s "$API/api/v1/markets/$TICKER" | jq '{id, ticker, title, status, executionMode}'
```

Order book:

```bash
export MARKET_ID="$(curl -s "$API/api/v1/markets/$TICKER" | jq -r '.id')"
curl -s "$API/api/v1/markets/$MARKET_ID/orderbook?depth=5" | jq '{marketId, yes, no}'
```

Recent trades:

```bash
curl -s "$API/api/v1/markets/$MARKET_ID/trades?limit=10" | jq '.[0:3]'
```

## Authenticated Calls

Login and save cookies:

```bash
curl -i -s -c /tmp/taptrade.cookies \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$DEMO_USERNAME\",\"password\":\"$DEMO_PASSWORD\"}" \
  "$API/api/v1/auth/login/"
```

Check the current session:

```bash
curl -s -b /tmp/taptrade.cookies "$API/api/v1/auth/session/" | jq
```

Portfolio:

```bash
curl -s -b /tmp/taptrade.cookies "$API/api/v1/portfolio" | jq '.[0:5]'
curl -s -b /tmp/taptrade.cookies "$API/api/v1/portfolio/summary" | jq
```

Open orders:

```bash
curl -s -b /tmp/taptrade.cookies "$API/api/v1/orders?status=open&page=1&pageSize=20" | jq
```

## Trading

Preview a limit buy before placing it:

```bash
curl -s -b /tmp/taptrade.cookies \
  -H 'Content-Type: application/json' \
  -d "{
    \"marketId\":\"$MARKET_ID\",
    \"side\":\"yes\",
    \"action\":\"buy\",
    \"orderType\":\"limit\",
    \"priceCents\":55,
    \"quantity\":10,
    \"timeInForce\":\"gtc\",
    \"clientOrderId\":\"example-preview-$(date +%s)\"
  }" \
  "$API/api/v1/orders/preview" | jq
```

Place a small limit buy:

```bash
curl -s -b /tmp/taptrade.cookies \
  -H 'Content-Type: application/json' \
  -d "{
    \"marketId\":\"$MARKET_ID\",
    \"side\":\"yes\",
    \"action\":\"buy\",
    \"orderType\":\"limit\",
    \"priceCents\":55,
    \"quantity\":1,
    \"timeInForce\":\"gtc\",
    \"idempotencyKey\":\"example-order-$(date +%s)\",
    \"clientOrderId\":\"example-client-order-$(date +%s)\"
  }" \
  "$API/api/v1/orders" | jq
```

Market buy orders require a slippage cap:

```bash
curl -s -b /tmp/taptrade.cookies \
  -H 'Content-Type: application/json' \
  -d "{
    \"marketId\":\"$MARKET_ID\",
    \"side\":\"yes\",
    \"action\":\"buy\",
    \"orderType\":\"market\",
    \"quantity\":1,
    \"timeInForce\":\"ioc\",
    \"notionalCapCents\":100
  }" \
  "$API/api/v1/orders/preview" | jq
```

## TypeScript Client

The package exports a prediction-specific client:

```ts
import { createPredictionClient } from "@taptrade-ui/api-client";

const predict = createPredictionClient("http://localhost:18080");

const discovery = await predict.getDiscovery();
const market = await predict.getMarket(discovery.featured[0].ticker);
const book = await predict.getOrderBook(market.id, 20);

console.log(market.title, book.yes.bids[0]);
```

In the Next.js player app, call `createPredictionClient()` without arguments so the client uses the same-origin `/api/v1/*` rewrite and avoids CORS during local development.

## WebSocket Channels

The player app subscribes through `NEXT_PUBLIC_WS_URL`:

```bash
NEXT_PUBLIC_WS_URL=ws://localhost:18080/ws npm run dev -- -p 3010
```

Known channels:

- `market:{marketId}` for price, status, and market metadata hints.
- `orderbook:{marketId}` for order-book hints. Clients should refetch `GET /api/v1/markets/{marketId}/orderbook` after receiving a hint.
- `loyalty:{userId}` for authenticated loyalty updates.

Public market pages should not subscribe to auth-gated order-book channels before the session state is known.
