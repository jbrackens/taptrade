# Tap Trade Player App — Development Rules

## Mandatory Quality Gates

Before declaring ANY phase, milestone, or task complete, you MUST run:

```bash
./gate.sh
```

Nine gates: TypeScript zero errors, no `@taptrade-ui/design-system` imports, no
mock classes in production code, TODO/FIXME scan (informational), feature
manifest coverage, no `@ts-nocheck` in app code, Pages/App Router conflict
check, the Next.js build, and the Biome lint wall.

**A phase is NOT complete unless gate.sh exits 0.**

If gate.sh fails, you must:

1. Fix every failure (not suppress, not work around)
2. Re-run gate.sh
3. Only then declare the phase complete

## Feature Manifest

`FEATURE_MANIFEST.json` records migration completeness per feature. There is no
generator script in this package — it is maintained by hand and checked by gate
5, so an entry is a claim until someone verifies it against the code.

Rules:

- Every new feature implementation must update the manifest status from
  MISSING/STUBBED to REAL
- A feature is REAL only when it connects to actual API endpoints (no
  mock classes, no hardcoded data, no empty method bodies)
- STUBBED means the UI exists but the backend wiring is fake — this is technical
  debt, not a completed feature
- MISSING means the legacy feature has no equivalent in app/ at all

## Prohibited Patterns

These patterns are gate failures. Do not introduce them:

1. **Mock classes in production code** — Use real API clients from
   `app/lib/api/`. Mock classes belong in test files only.
2. **@taptrade-ui/design-system imports in app/** — This package uses
   styled-components and causes webpack hangs. Use inline components or
   Tailwind.
3. **@ts-nocheck in app/ directory** — Fix the types.
4. **`typescript: { ignoreBuildErrors: true }` in next.config.js** — Not present
   today, and must not come back. It masks real problems.
5. **Declaring a feature "done" when it uses hardcoded/mock data** — If the
   component doesn't fetch from a real API, it's STUBBED, not done.
6. **Sportsbook vocabulary** — no bets, betslip, fixtures, selections, odds or
   parlays. This is a prediction market: markets carry YES/NO prices in Points
   (1–99, summing to 100), users hold positions, and settlement pays 100 Points
   per correct contract.

## Architecture

- **App Router** (`app/`) is the whole codebase. There is no `pages/` directory
  and no Pages Router tree left in this package.
- **Redux Store** (`app/lib/store/`) — Redux Toolkit v1 (not v2). Use
  `TypedUseSelectorHook` pattern, not `.withTypes()`.
- **API Clients** (`app/lib/api/`) — one client per domain over a shared
  `client.ts`: auth, wallet, user, compliance, content, discover, bonus,
  loyalty, leaderboards, notifications, privacy, store, chat, live-markets,
  market-social, market-watchlist. Prediction market/order/portfolio calls come
  from `@taptrade-ui/api-client` instead.
- **WebSocket** (`app/lib/websocket/predict-ws.ts`) — one connection to the
  gateway, multiplexing handlers per channel (`market:<id>`, `orderbook:<id>`,
  `portfolio:<userId>`, `loyalty:<userId>`).
- **React Query** (`app/lib/query/`) — For server state. Redux for client state.

## Dev Server

```bash
npx next dev --webpack -p 3010   # 3000 is taken by an unrelated project on this Mac; root .claude/launch.json pins 3010
```

Point it at the local backend with `NEXT_PUBLIC_API_URL=http://localhost:18080`.

The dev server MUST boot without hanging. If it hangs, check:

1. `transpilePackages` in next.config.js — currently `@taptrade-ui/utils` and
   `@taptrade-ui/api-client`. Do NOT add `@taptrade-ui/design-system`.
2. Circular imports in app/lib/

## Testing

Unit tests live in `app/__tests__/` and run through the Node test runner:
`yarn test` (`tsx --test --test-reporter=tap`). Playwright suites are under
`tests/smoke` and `tests/visual` (`yarn test:smoke`).

Run TypeScript checks: `yarn typecheck` (scoped) or `yarn typecheck:full`
(`tsc --noEmit` over everything).

## No Shortcuts Policy

This project has a history of shortcuts being taken and then discovered later.
To prevent this:

1. Run gate.sh before every phase completion
2. Update FEATURE_MANIFEST.json when implementing features
3. Never suppress TypeScript errors — fix them
4. Never use mock classes in production — wire real APIs
5. If something can't be done right now, mark it STUBBED in the manifest and
   document why
