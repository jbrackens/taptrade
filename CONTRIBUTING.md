# Contributing

Thanks for working on Tap Trade. This project is a prediction-market fork of a sportsbook codebase, so the most important contribution rule is to keep new work in the prediction domain.

## Before You Start

Read:

- [README.md](./README.md)
- [CLAUDE.md](./CLAUDE.md)
- [The documentation map](./docs/README.md), then [what exists today](./docs/SPEC_CURRENT.md)
- [Environment and commands](./docs/ENVIRONMENT.md)
- [Migration guide](./apps/taptrade-platform/MIGRATION.md) (sportsbook → prediction vocabulary)

**Documentation is part of the change.** A change to behaviour, architecture,
schema, an integration or setup updates the authoritative document in `docs/`
in the same pull request; a significant architectural decision adds or
supersedes an ADR. The rules are in
[docs/README.md](./docs/README.md#how-to-maintain-these-documents).

## Local Checks

Install once from the yarn workspace root
(`apps/taptrade-platform/frontend`) with `yarn install --frozen-lockfile`, then:

Player app:

```bash
cd /Users/john/Sandbox/taptrade-workspace/taptrade/apps/taptrade-platform/frontend/packages/app
yarn typecheck
yarn test
PLAYWRIGHT_BASE_URL=http://localhost:3010 yarn test:smoke
```

Go services:

```bash
cd /Users/john/Sandbox/taptrade-workspace/taptrade/apps/taptrade-platform/go-platform
go test ./modules/platform/... ./services/gateway/... ./services/auth/...
```

## Prediction Domain Rules

- Use categories, series, events, markets, orders, positions, trades, and settlements.
- Do not add new sportsbook naming such as fixtures, selections, betslip, sport_key, or punter_bets.
- Use YES/NO prices in whole Points (1–99, `yes + no = 100`), not odds and not cents.
  Migration `050_points_unit_model.sql` retired the `*_cents` spellings across the active
  economy; the test suite fails if they come back on the wire.
- The product is points-only and non-redeemable. Do not add deposit, withdrawal,
  cash-out or crypto surfaces — the legacy route trees behind
  `TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED` and `ALPHA_CASHIER_ENABLED` are boot errors in
  production and staging.
- Keep prediction code decoupled from wallet internals through the existing adapter boundary.
- Add new goose migrations for schema changes. Do not edit shipped migrations in place.

## Pull Request Expectations

- Describe the user-visible behavior change.
- List the checks you ran.
- Include screenshots for player/backoffice UI changes.
- Call out any intentionally stubbed or incomplete behavior.
- Note whether the change affects setup, migrations, auth, wallet, or settlement.
