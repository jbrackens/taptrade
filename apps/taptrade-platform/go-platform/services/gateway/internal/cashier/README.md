# Gateway Cashier Domain

**Orphaned — nothing imports this package.** No gateway or service handler calls
it, and it is not in the `./cmd/gateway` dependency graph. It stays compiled only
because `scripts/check-cashier-all.sh` runs `go test ./internal/cashier`.

It is a reference implementation of credential-free, provider-independent cashier
rules, written during the non-custodial migration. That workstream did not ship:
Tap Trade launched points-only and non-redeemable, and the gateway now refuses to
boot with `TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED=true` or
`ALPHA_CASHIER_ENABLED=true` when `ENVIRONMENT` is `production` or `staging`.

Treat it as archived source, not as a description of live behaviour. Do not wire
new code to it without an explicit decision to reopen a money rail.

What the package contains (~1,200 lines, each with tests):

- Fail-closed state transitions for deposits, withdrawals, relayer submissions,
  and recovery cases.
- A conservative bridge-event reducer for deposit status changes.
- Compliance policy decisions for caps, geo policy, address screening, and pause
  state.
- Runtime flag helpers that fail closed for missing or unknown flags.
- Deterministic idempotency-key builders for deposit, withdrawal, and relayer
  operations.
- Decimal metadata for Tron USDT, BSC USDT, Polygon USDC, and hUSD.
- Provider callback raw-body SHA-256 and HMAC verification helpers.
- A two-person recovery approval helper requiring distinct approving operators.
- A relayer policy evaluator for allowlisted targets/selectors, amount caps,
  paymaster runway, duplicate submissions, compliance decisions, pause state, and
  authorization expiry.
- Reconciliation item classification (matched / missing-provider / missing-chain
  / amount-mismatch / quarantined).

Non-goals it deliberately kept: no provider SDKs, no chain RPC calls, no
custodial wallet crediting, no secrets, no live money movement.
