# Player app — `@taptrade-ui/app`

The Tap Trade player app: a prediction market where users trade binary YES/NO
contracts priced in Points (1–99, YES + NO = 100). Next.js 16 App Router; the
route tree lives in `app/`.

## Configuration

Local overrides go in `.env.local`, which is git-ignored per
[Next.js convention](https://nextjs.org/docs/basic-features/environment-variables#default-environment-variables).

```
NEXT_PUBLIC_API_URL=http://localhost:18080
NEXT_PUBLIC_AUTH_URL=http://localhost:18081
NEXT_PUBLIC_WS_URL=ws://localhost:18080/ws
```

Feature flags default off and are read in `app/lib/features.ts`:
`NEXT_PUBLIC_FEATURE_RG`, `NEXT_PUBLIC_FEATURE_KYC`,
`NEXT_PUBLIC_FEATURE_LIMITS`, `NEXT_PUBLIC_FEATURE_CHAT`,
`NEXT_PUBLIC_FEATURE_LIVE_MARKETS`, `NEXT_PUBLIC_FEATURE_SOCIAL_AUTH`.

Install from the yarn workspace root (`frontend/`), not from this package.

## Scripts

- `dev` — `next dev --webpack` on port 3000
- `run-local:dev` — the same dev server plus the translation watcher
- `build` — `next build --webpack`, then the upstream-leak check
- `test` — `tsx --test --test-reporter=tap app/__tests__/*.test.ts` (no
  coverage)
- `test:smoke` — Playwright smoke suite
- `typecheck` — scoped `tsc`; `typecheck:full` runs `tsc --noEmit` over
  everything

`./gate.sh` runs the nine quality gates and must exit 0 before a change is
called done. See `CLAUDE.md` in this package.

## Product surfaces

Prediction market:

- `/predict` — discovery: featured, trending, closing soon, recent
- `/market/[ticker]` — market detail, price chart, order book, trade ticket
- `/category/[slug]` — markets filtered by category
- `/series/[slug]`, `/event/[id]` — the taxonomy above a market
- `/portfolio` — open positions, orders, history, accuracy
- `/discover`, `/book`, `/floor`, `/live`, `/standing`, `/activity`

Account and social:

- `/account` — prediction-native profile hub: identity, points balance,
  portfolio summary, and links out to profile, points, security, alerts and
  responsible-play settings
- `/rewards` — loyalty standing, tiers, ledger, missions, streaks, point packs
- `/leaderboards` and `/leaderboards/[id]` — accuracy boards
- `/store` — point packs
- `/profile`, `/users/[userId]`, `/auth`, `/responsible-gaming`

There is no betslip and no `/bets` route; this is not a sportsbook. Prices are
Points, not odds and not cents.

## Real-time

`app/lib/websocket/predict-ws.ts` holds one WebSocket to the gateway and
multiplexes channel subscriptions. Channels in use by this app: `market:<id>`,
`orderbook:<id>`, `portfolio:<userId>`, `loyalty:<userId>`. The full channel
list and payload shapes are documented in
`go-platform/services/gateway/internal/ws/README.md`.

## API clients

One client per domain under `app/lib/api/` — auth, wallet, user, compliance,
content, discover, bonus, loyalty, leaderboards, notifications, privacy, store,
chat, live-markets, market-social, market-watchlist — over the shared
`client.ts`. The prediction endpoints themselves come from
`@taptrade-ui/api-client`.

### Other scripts

See core [README.md](../../README.md#scripts)
