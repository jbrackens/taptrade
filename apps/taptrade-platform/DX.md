# Developer Experience Scorecard

Use this checklist before and after changes that affect setup, docs, player flows, API ergonomics, auth, trading, or tests.

## Target Scores

| Dimension | Target | Evidence |
| --- | ---: | --- |
| Getting Started | 8/10 | New developer reaches `/predict` with demo data in under 5 minutes |
| API/SDK | 8/10 | Prediction client exported from package entrypoint; API examples cover discovery, auth, order book, orders, and TypeScript usage |
| Error Messages | 8/10 | Error guide documents request IDs, common HTTP failures, console policy, and exchange validation |
| Documentation | 8/10 | README, DEVELOPMENT, CHANGELOG, and MIGRATION match current prediction stack |
| Upgrade Path | 8/10 | Upgrade guide covers backup, migration, domain changes, verification, and rollback |
| Dev Environment | 8/10 | `npm run dev`, typecheck, unit tests, smoke tests, and Go tests work from docs |
| Community | 8/10 | PR template, bug template, DX issue template, support doc, security policy, and code of conduct exist |
| DX Measurement | 7/10 | TTHW, smoke-test pass/fail, and devex-review score are recorded |

## Time To Hello World

Measure from a clean terminal with Docker available:

```bash
date
cd /Users/john/Sandbox/taptrade-workspace/taptrade/apps/taptrade-platform
docker compose up -d postgres redis gateway auth
cd frontend/packages/app
NEXT_PUBLIC_API_URL=http://localhost:18080 \
NEXT_PUBLIC_AUTH_URL=http://localhost:18081 \
NEXT_PUBLIC_WS_URL=ws://localhost:18080/ws \
npm run dev -- -p 3010
```

Stop the clock when `http://localhost:3010/predict` loads with market cards and demo login works.

Record:

- Commit:
- Date:
- TTHW:
- Any command that failed:
- Screenshot path:

## Evidence Commands

```bash
cd /Users/john/Sandbox/taptrade-workspace/taptrade/apps/taptrade-platform
docker compose ps
```

```bash
curl -i http://localhost:18080/api/v1/discovery/
curl -i http://localhost:18080/api/v1/markets/NOT-A-REAL-MARKET/
```

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

## Regression Triggers

Re-run the DX checklist when a change touches:

- `README.md`, `DEVELOPMENT.md`, `API_EXAMPLES.md`, `ERRORS.md`, `CHANGELOG.md`, `MIGRATION.md`, or `UPGRADE.md`
- `docker-compose.yml`
- `frontend/packages/app/package.json`
- `frontend/packages/api-client`
- `go-platform/services/gateway/internal/http`
- `go-platform/services/gateway/internal/prediction`
- Auth, wallet, orders, portfolio, or settlement flows

## Devex Review Log

After a full pass, record the score with gstack devex-review. Include:

- Overall score
- TTHW
- Tested dimensions
- Inferred dimensions
- Commit hash
