# Migration Guide: Sportsbook To Predict

This repository is now Tap Trade. The old sportsbook code remains in places for reference, but new work should use the prediction-market model.

## Domain Translation

| Old sportsbook term | New prediction-market term |
| --- | --- |
| Sport | Category |
| Fixture | Event |
| Selection | Market side |
| Bet | Order |
| Bet history | Positions and settled payouts |
| Betslip | Trade ticket |
| Odds | YES/NO price in cents |

## Code Rules

- New player app work belongs under `frontend/packages/app/app`.
- New prediction API calls should use `PredictionApiClient`.
- New tables or columns require a new goose migration in `go-platform/services/gateway/migrations`.
- Keep `internal/prediction` decoupled from `internal/wallet`; use the existing wallet adapter boundary.
- Archived sportsbook paths can be read for context, but should not be copied into new prediction code.

## Local Migration Checks

Run these before opening a PR that touches prediction flows:

```bash
cd /Users/john/Sandbox/taptrade-workspace/taptrade/apps/taptrade-platform/frontend/packages/app
npm run typecheck
npm test
PLAYWRIGHT_BASE_URL=http://localhost:3010 npm run test:smoke
```

```bash
cd /Users/john/Sandbox/taptrade-workspace/taptrade/apps/taptrade-platform/go-platform
go test ./modules/platform/... ./services/gateway/... ./services/auth/...
```

## Breaking Changes For Local Developers

- The player app local URL is `http://localhost:3010/predict` in the current Codex/Claude Preview setup.
- PostgreSQL is exposed on host port `5434`, not `5432`.
- Redis is exposed on host port `6380`, not `6379`.
- The prediction database is `predict` with user `predict` and password `localdev`.
