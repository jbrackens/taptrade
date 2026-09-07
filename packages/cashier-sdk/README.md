# Tap Trade Cashier SDK

> **NO RUNTIME CONSUMER — abandoned scaffold.** This package was written as the
> shared contract for a cashier UI and cashier backend services. Neither exists.
> The player app has no cashier UI and a test fails if one returns
> (`app/__tests__/qa-regressions-2026-04-18.test.ts`), and
> `services/cashier-api/`, `services/bridge-watcher/` and `services/relayer/` are
> not running services.
>
> **It is also outside every workspace.** There is no `package.json` at the
> repository root. The yarn workspace root is
> `apps/taptrade-platform/frontend/`, whose `workspaces: ["packages/**/*"]`
> resolves to `apps/taptrade-platform/frontend/packages/**` — not this
> directory. So `@taptrade/cashier-sdk` is never installed, hoisted or resolved
> by any application build; it is built only ad hoc into `.tmp-test-dist/`.
> The package was renamed into the `@taptrade` scope on 2026-09-06; nothing
> outside this directory referenced the old scope, so no consumer moved with it.
>
> **Why it is still in the repository.** `scripts/check-cashier-all.sh` runs
> `npm --prefix packages/cashier-sdk test` and `run build`, then
> `scripts/check-cashier-service-stubs.mjs` and
> `scripts/replay-cashier-mock-e2e.mjs` import the built output from
> `.tmp-test-dist/`. That script is run by the `cashier-guards` job in
> `.github/workflows/test.yml` on every push and pull request to `main`.
> Deleting this package breaks CI until that job and those scripts are removed
> with it.
>
> **What replaced it.** The product moved to non-redeemable points. The design
> record for this workstream is archived at `docs/archive/cashier/`.

The rest of this file describes what the package was intended to be.

Shared typed contract for a cashier UI and cashier backend services (neither
was built).

This package is a dependency-free TypeScript domain model: types, discriminated
unions, status helpers, decimal metadata, and request shape definitions. Provider
SDKs were meant to live in services, not in this package.

Verification:

- `npm test` builds the package to a temporary directory and runs runtime tests
  for state transitions, idempotency keys, and decimal/base-unit validation.
- Fixture validation covers the archived cashier API, bridge watcher, relayer,
  recovery, runtime flag, canary, and reconciliation JSON artifacts. It proves
  those fixtures are internally consistent with these types — nothing more.
- The runtime helpers intentionally include service-side reducers and policy
  checks, but no provider SDKs and no network calls.
