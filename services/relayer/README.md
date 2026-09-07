# Tap Trade Relayer

> **NOT A SERVICE — NO CODE AT ALL.** This directory contains four files:
> `README.md`, `POLICY.md` and two JSON fixtures. There is no source file, no
> `package.json`, no Dockerfile, no compose entry and nothing that could run.
> The relayer policy logic that the fixtures exercise lives in
> `packages/cashier-sdk/`, not here.
>
> **Why it is still in the repository.**
> `scripts/replay-cashier-mock-e2e.mjs` reads
> `fixtures/policy-approved-withdrawal.json`, and that script runs under
> `scripts/check-cashier-all.sh`, which the `cashier-guards` job in
> `.github/workflows/test.yml` executes on every push and pull request to
> `main`. Deleting this directory breaks CI until that job and those scripts are
> removed with it.
>
> **What replaced it.** The product moved to non-redeemable points; there are no
> user funds on chain and no transactions to sponsor. The design record is
> archived at `docs/archive/cashier/`.

The rest of this file describes what the service was intended to be. It is a
historical specification, not a description of running code.

Gas sponsorship and user-operation submission boundary.

Responsibilities:

- Submit user-authorized wallet operations.
- Enforce policy before sending transactions.
- Keep provider API keys and paymaster credentials server-side.
- Record every submitted operation and final chain result.

Required controls:

- Domain-separated user signatures.
- Nonce and replay protection.
- Per-user, per-market, and per-withdrawal limits.
- Allowlisted contracts and calldata policies.

The relayer must never create a transaction that moves user funds without a
verifiable user authorization or an explicit recovery/admin workflow.

Additional design docs:

- [Policy](./POLICY.md)
- `fixtures/policy-approved-withdrawal.json`
- `fixtures/policy-approved-market-trade.json`
