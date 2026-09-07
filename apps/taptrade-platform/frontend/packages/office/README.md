# Back office — `@taptrade-ui/office`

Staff back office for the Tap Trade prediction market: market creation and
lifecycle, settlement and disputes, risk, moderation, users and access control.
Next.js 16 App Router (`app/`) with Ant Design 5. Runs on port 3001.

## Configuration

Local overrides go in `.env.local`, which is git-ignored per
[Next.js convention](https://nextjs.org/docs/basic-features/environment-variables#default-environment-variables).

```
NEXT_PUBLIC_API_URL=http://localhost:18080
NEXT_PUBLIC_AUTH_URL=http://localhost:18081
```

Install from the yarn workspace root (`frontend/`), not from this package.

## Scripts

- `run-local:dev` — dev server with hot reload plus the translation watcher
- `build` — regenerates locales, then `next build --webpack`
- `test` — `vitest run`; `test:watch` and `test:coverage` are the vitest
  variants
- `test:jest` — the remaining legacy Jest suite

`./gate.sh` runs this package's quality gates.

## Current Admin Surfaces

All routes live under `app/(dashboard)/`. There is no Pages Router tree in this
package. Every surface is point-native Tap Trade administration: balances,
ledger entries and rewards are all denominated in Points, and there is no
cash-out.

Prediction operations:

- `prediction-admin/markets` — market list, create, lifecycle transitions
- `prediction-admin/settlements` — settlement queue and manual resolve
- `prediction-admin/taxonomy` — categories, series, events
- `prediction-admin/risk`, `prediction-admin/activity`,
  `prediction-admin/store-packs`, `prediction-admin/reward-clusters`
- `disputes` — resolution challenge queue

Platform operations:

- `access-control` — RBAC: user management and the role × permission matrix
- `users`, `users/[id]` — customer accounts
- `social-moderation`, `campaigns`, `content`
- `dashboard`, `reports`, `audit-logs`, `risk-management`
- `loyalty`, `loyalty/settings`, `leaderboards`, `leaderboards/[id]`
- `loyalty/[id]` — manual adjustments, point-ledger inspection, referral history

`FEATURE_MANIFEST.json` tracks per-route status. Its entries carry a
`verification` field, and the manifest itself says it was hand-seeded (dated
2026-05-18) — so `inferred`/`unverified` rows are claims, not evidence. Check
the route against the gateway call it makes before trusting either the manifest
or this file.

## Styling

Ant Design components are re-skinned against CSS custom properties, not hex
literals: `styles/p8-tokens.css` declares the tokens and `styles/p8-antd.css`
overrides AntD classes against them. New styling work must reference those
variables.

## Auth

`utils/auth.ts` guards pages with a `jsonwebtoken`-verified JWT session — there
is no Keycloak anywhere in this package.

Staff authorization itself is enforced server-side by the gateway: every
`/api/v1/admin/*` endpoint checks the session role and then an RBAC permission.

### Dev-mode auth

For local development against the Go gateway, which issues opaque `atk_...`
bearer tokens rather than JWTs, a bypass accepts an undecodable token when
`NODE_ENV === "development"` (`isDevOpaqueToken`). Sign in with any credentials
at `/auth/login` and the guard will accept the gateway's token.

### Other scripts

See core [README.md](../../README.md#scripts)
