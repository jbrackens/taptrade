# Tap Trade Cashier Contract Invariants

**Status:** SUPERSEDED 2026-09-06 — abandoned workstream (was: "Draft gate for
contract implementation and audit."). No contract was implemented or deployed,
and none will be: the product moved to non-redeemable points and settles nothing
on chain. See `docs/archive/cashier/` for the design record and
`contracts/README.md` for why this directory is still here.
**Date:** 2026-05-25.

These invariants applied to collateral, recovery, and any account/factory
adapters in the interface sketches under `src/`. They are kept as a record of the
security properties the contracts were meant to hold, and because
`scripts/check-cashier-contracts.mjs` asserts five of them are still stated here.

## Collateral

- Mint only after a settled bridge/deposit intent is proven by the authorized
  cashier service or verifier contract.
- A deposit intent id can mint at most once.
- Burn only for a user-authorized withdrawal or explicit recovery workflow.
- Asset decimals are fixed at deployment and exposed.
- No admin can mint arbitrary collateral without a deposit/recovery subject id.

## Recovery

- Recovery action ids are unique.
- Recovery evidence hash is immutable.
- Quarantine and denial actions do not move funds.
- Refund actions must target a user-controlled address, not an unproven exchange
  hot wallet.

## Trade Authorization

- Authorization hash is domain-separated by chain id, smart wallet, target,
  selector, amount, nonce, and deadline.
- A trade authorization can be consumed at most once.
- Allowed selectors are limited to market trade, redemption, collateral wrap, and
  collateral unwrap.
- Authorization expiry is enforced on-chain or by a verifiable account policy.
- No approval-for-all, delegatecall, arbitrary transfer, or upgrade selector is
  valid through the cashier relayer.

## Access Control

- Pauser cannot mint.
- Operator cannot upgrade.
- Upgrader cannot bypass pending timelock.
- Relayer cannot change policy.
- Emergency pause blocks new mint/burn but preserves read/recovery evidence.

## Audit Gates

- Unit tests for every invariant.
- Stateful fuzz tests for mint/burn/recovery ordering.
- Slither or equivalent static analysis.
- External audit before public beta.
- No proxy upgrade key controlled by a single human.
