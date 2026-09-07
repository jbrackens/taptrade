# Security Policy

Tap Trade handles auth, wallet balances, orders, positions, settlements, and admin controls. Treat security reports carefully.

## Reporting A Vulnerability

Do not open a public issue for vulnerabilities.

Send a private report to the project maintainers with:

- A short summary of the issue.
- Affected route, package, service, or migration.
- Reproduction steps.
- Impact, including whether auth, wallet point balances, order placement, settlement, or admin access is affected.
- Logs, screenshots, or request IDs when available.

If no private project channel is configured yet, contact the repository owner directly and avoid sharing exploit details publicly.

## Sensitive Areas

Use extra care around:

- Auth cookies, JWT refresh, session handling, and CSRF.
- Wallet credits, debits, holds, and ledger reconciliation.
- Exchange order matching, self-match behavior, idempotency, and cancellation.
- Settlement sources, admin lifecycle transitions, and payout calculations.
- WebSocket subscriptions that expose user-specific data.
- The launch money boundary: anything that could mount the retired deposit, withdrawal,
  cashier, crypto or provider-callback routes, which the gateway refuses to boot with in
  production and staging (`TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED`, `ALPHA_CASHIER_ENABLED`).
- Point-store checkout and its webhook signature verification (`STORE_WEBHOOK_SECRET`).
- Secrets in `.env`, Docker Compose, CI, logs, screenshots, and generated reports.

## Local Secret Hygiene

- Do not commit real `.env` files or credentials.
- Use demo accounts only for screenshots and smoke tests.
- Scrub bearer tokens, cookies, and request IDs from public reports when they identify a real environment.
- Rotate credentials after accidental exposure.

## Dependency And Supply Chain Checks

Before shipping dependency changes:

The frontend is a yarn-1 workspace, so audit with yarn — this is what the repo's own
baseline script (`scripts/security/dependency-baseline.sh`, wrapped as
`make security-deps`) runs:

```bash
cd /Users/john/Sandbox/Taya_NA_Predict/Taya_Na_Predict/apps/taptrade-platform/frontend/packages/app
yarn audit --level high
```

```bash
cd /Users/john/Sandbox/Taya_NA_Predict/Taya_Na_Predict/apps/taptrade-platform/go-platform
go list -m all
```

