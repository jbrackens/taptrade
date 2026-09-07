# Tap Trade Bridge Watcher

> **NOT A RUNNING SERVICE.** This directory is a design-and-fixture scaffold from
> the abandoned cashier / crypto workstream. It holds one source file —
> `src/local-provider-adapter.mjs`, a deterministic in-memory stand-in — plus
> two design documents and a fixture set. There is no `package.json`, no
> Dockerfile, no compose entry and no worker loop; nothing polls or subscribes to
> anything. Nothing in the Go gateway or either Next.js app imports it (two
> comments in `gateway/internal/alphacashier/` mention this path as future work
> that never happened).
>
> **Why it is still in the repository.** `scripts/check-cashier-provider-scenarios.mjs`
> validates `fixtures/provider-scenarios.manifest.json` and the relay fixtures,
> and `scripts/check-cashier-service-stubs.mjs` and
> `scripts/replay-cashier-mock-e2e.mjs` import the local adapter. All three run
> under `scripts/check-cashier-all.sh`, which the `cashier-guards` job in
> `.github/workflows/test.yml` executes on every push and pull request to `main`.
> Deleting this tree breaks CI until that job and those scripts are removed
> with it.
>
> **What replaced it.** The product moved to non-redeemable points; there is no
> deposit rail to watch. The design record is archived at `docs/archive/cashier/`.

The rest of this file describes what the service was intended to be. It is a
historical specification, not a description of running code.

Reconciliation worker for Tron-source deposits and EVM destination settlement.

Responsibilities:

- Poll or subscribe to provider request status.
- Reconcile provider status with source and destination chain evidence.
- Deduplicate callbacks, status polls, and regenerated child requests.
- Move ambiguous deposits into recovery rather than crediting them.
- Emit audit events for support and compliance review.

This service must be restart-safe. Reprocessing the same source transaction,
deposit address, callback, or destination transaction must not change balances
twice.

Additional design docs:

- [State machine](./STATE_MACHINE.md)
- [Provider adapter contract](./PROVIDER_ADAPTER_CONTRACT.md)
- `fixtures/provider-scenarios.manifest.json`
- `fixtures/relay-source-detected.json`
- `fixtures/relay-callback-source-detected.json`
- `fixtures/relay-destination-confirmed.json`
- `fixtures/relay-duplicate-callback-replay.json`
- `fixtures/relay-quarantined-unknown-request.json`
- `fixtures/relay-quarantined-under-minimum.json`
- `fixtures/relay-quarantined-destination-mismatch.json`
- `fixtures/relay-failed-expired-quote.json`
- `fixtures/relay-failed-after-source-detection.json`
- `fixtures/relay-quarantined-missing-destination-evidence.json`
- `fixtures/relay-quarantined-sanctions-review.json`
