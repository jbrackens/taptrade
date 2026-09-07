# Tap Trade Cashier API

> **NOT A RUNNING SERVICE.** This directory is a design-and-fixture scaffold from
> the abandoned cashier / crypto workstream. It has no `package.json`, no HTTP
> server (nothing here calls `createServer` or `listen`), no Dockerfile and no
> entry in `apps/taptrade-platform/docker-compose.yml` or
> `docker-compose.demo.yml`. `.github/workflows/deploy-demo.yml` builds only the
> auth, gateway, player and office images. Nothing in the Go gateway or either
> Next.js app imports it. The `src/*.mjs` files are exported functions with no
> caller other than the guard scripts below.
>
> **Why it is still in the repository.** `scripts/check-cashier-all.sh` reads
> this tree — the SQL migration, the rollback and seed files, `openapi.yaml`,
> `observability-events.json` and the `fixtures/` directory — and that script is
> run by the `cashier-guards` job in `.github/workflows/test.yml` on every push
> and pull request to `main`. Deleting this tree breaks CI until that job and
> those scripts are removed with it.
>
> **What replaced it.** The product moved to non-redeemable points. The gateway
> mounts the cashier, crypto and payment route trees only behind
> `TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED`, which defaults to off, and refuses to
> boot with it (or `ALPHA_CASHIER_ENABLED`) set in production or staging —
> `apps/taptrade-platform/go-platform/services/gateway/cmd/gateway/main.go:354`
> and `:358`. The design record for this workstream is archived at
> `docs/archive/cashier/`.

The rest of this file describes what the service was intended to be. It is a
historical specification, not a description of running code.

API boundary for non-custodial wallet and cashier state.

Responsibilities:

- Resolve user identity to an embedded EVM wallet and smart-wallet address.
- Create idempotent deposit intents.
- Expose deposit status to the frontend.
- Verify provider callback signatures before state transitions.
- Persist auditable state without treating the Go cents ledger as fund custody.

Non-goals:

- No private-key custody.
- No HD deposit-address derivation.
- No direct calls to `wallet.Credit` for crypto deposits.

Every mutating endpoint must require an idempotency key.

Additional design docs:

- [API contract](./API_CONTRACT.md)
- [Recovery API contract](./RECOVERY_API_CONTRACT.md)
- [Schema sketch](./SCHEMA.md)
- [Migration rollback guide](./MIGRATION_ROLLBACK.md)
- `openapi.yaml`
- `observability-events.json`
- `migrations/001_cashier_core.sql`
- `migrations/001_cashier_core.rollback.sql`
- `seeds/local_cashier_seed.sql`
- `src/handlers.mjs`
- `src/repository.mjs`
- `src/sql-repository.mjs`
- `src/bootstrap.mjs`
- `src/reconciliation.mjs`
- `src/dashboard.mjs`
- `cashier_runtime_flags` defaults all money movement to disabled.
- `fixtures/wallet.resolved.json`
- `fixtures/deposit-intent.created.json`
- `fixtures/deposit-intent.evm-direct.created.json`
- `fixtures/withdrawal-intent.created.json`
- `fixtures/compliance-decision.quarantine.json`
- `fixtures/audit-event.recovery-created.json`
- `fixtures/recovery-case.destination-mismatch.json`
- `fixtures/recovery-approval.operator-a.json`
- `fixtures/canary-result.ok.json`
- `fixtures/runtime-flags.default.json`
- `fixtures/reconciliation-report.daily-ok.json`

## SQL repository

`src/sql-repository.mjs` implements the same repository methods as
`createInMemoryCashierRepository` against the tables in
`migrations/001_cashier_core.sql`. It accepts any `pg`-style client or pool with
`query(text, params)`, uses parameterized queries, and normalizes snake_case SQL
columns to the existing camelCase cashier API objects at the boundary.

This is repository plumbing only. Service bootstrap, credential loading,
connection pooling policy, and production rollout wiring live in
`src/bootstrap.mjs`.

## Repository bootstrap

Use `createCashierRepositoryFromEnv` from `src/bootstrap.mjs` at service startup.
It selects a repository from environment:

- `CASHIER_REPOSITORY_BACKEND=postgres` uses `CASHIER_DATABASE_URL` first, then
  `DATABASE_URL`.
- If no database URL is present, local/test environments default to the
  in-memory repository for deterministic contract tests.
- Production-like environments (`NODE_ENV=production`, `DEPLOY_ENV=staging`, or
  `VERCEL_ENV=preview`) fail closed if the selected backend is in-memory, unless
  `CASHIER_ALLOW_IN_MEMORY_REPOSITORY=true` is set for an explicit emergency or
  local override.
- `CASHIER_DATABASE_POOL_MAX` controls the optional `pg` pool size.
- `CASHIER_DATABASE_SSL=require|no-verify|disable` controls `pg` SSL config.

## Operator controls implemented locally

- Mutating cashier handlers write immutable `cashier_audit_events` through the
  repository boundary.
- Recovery approvals can be checked for two distinct approving operators through
  `getRecoveryApprovalStatus`.
- `generateReconciliationReport` builds and persists a daily reconciliation
  report from persisted deposit intents plus bridge/provider observations.
- `setRuntimeFlag` gives operators an audited kill-switch path for deposit,
  withdrawal, relayer, and provider-callback rails.

These controls still need live provider/chain evidence before real value is
enabled. They close the local implementation gap only.

Service-local test:

```sh
node --test services/cashier-api/test/*.mjs
```
