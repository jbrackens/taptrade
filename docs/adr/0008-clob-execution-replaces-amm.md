# ADR-0008: Order-book (CLOB) execution replaces AMM execution

**Status:** Accepted — implemented 2026-06-13 (commit `e10a4446`, "feat(prediction): P2-09 retire the AMM execution path"). Execution only; AMM quote math is retained unwired (see Consequences).
**Date:** 2026-06-13.
**Deciders:** "Owner-approved" per the commit message; no name recorded.

> **Scope:** the decision to stop accepting new trades against the LMSR AMM
> and make the central limit order book (CLOB) the only live execution
> path. **Authoritative for:** execution-mode history and current state.
> **Not for:** the fork that introduced the AMM in the first place — see
> [ADR-0007](./0007-fork-from-sportsbook-to-prediction-market.md).

## Context

The 2026-04-16 fork ([ADR-0007](./0007-fork-from-sportsbook-to-prediction-market.md)) shipped with an LMSR AMM
(`gateway/internal/prediction/amm.go`) as the launch execution engine,
explicitly noting in its own commit message: "AMM (LMSR) at launch, data
model supports future CLOB migration." Migration `019_prediction_exchange_engine.sql`
(the real order-book engine) already existed by the time of the AMM
retirement and had defaulted new markets to `execution_mode='order_book'`
since it landed — existing markets stayed on `'amm'` (`UPDATE
prediction_markets SET execution_mode = 'amm'` in that migration, for rows
that predated it).

`docs/audit/IMPROVEMENT_PLAN.md` names this item **P2-09**, paired with
migration `033` (dropping 11 dead sportsbook tables the same day).

## Decision and scope

`Service.PlaceOrder` rejects any order against a market with
`execution_mode != 'order_book'`, replacing what the P2-09 commit describes
as "the ~220-line AMM execution branch" with "a clean rejection ... ('retired
AMM engine ... no longer tradeable; existing positions can still be
settled')." `PreviewOrder` on an AMM market returns the same retirement
error instead of an LMSR quote. The order book (`gateway/internal/prediction/exchange.go`)
becomes the only path that can open a new position.

Settlement and void are unaffected: per the commit message, "settlement/void
are engine-agnostic — they pay 100¢/contract from `prediction_positions` and
never touch AMM state" — so any pre-`019` AMM market's existing positions
remain settleable, only new trades on it are refused.

## Alternatives considered

Not recorded. No plan document weighs keeping dual execution modes, a
migration path for open AMM positions, or a phased AMM sunset against the
clean-rejection approach that shipped. The commit message states what was
done and why it is safe, not what else was considered.

## Rationale and trade-offs

Partially recorded, in the commit message rather than a dedicated planning
doc: the order book is "the live engine" and the AMM was "the interim
engine." The commit also records a safety argument for *why this order was
safe to ship* (settlement/void don't touch AMM state, fresh/seeded installs
have zero AMM markets) — that is evidence for risk mitigation, not for why
CLOB was chosen over AMM as a design in the first place. The broader
make-or-buy / design rationale (why order-book price discovery over LMSR
market-making) is **not recorded** anywhere in the repository.

## Consequences and constraints

- `PlaceOrder` rejection is verified at `4924a670`: `gateway/internal/prediction/service.go` carries the `execution_mode`-gate comments the P2-09 commit introduced (lines ~22, ~876, ~1214).
- **Not fully completed as originally scoped.** `docs/audit/IMPROVEMENT_PLAN.md` (P2-09 entry, "Status (2026-09-06)") records: "PARTLY DONE, and the original instruction is now wrong in two places" — `PreviewOrder` intentionally still returns read-only AMM curve quotes for legacy market detail, and migration `019`'s `CHECK (execution_mode IN ('order_book','amm'))` constraint has **not** been tightened to drop `'amm'`. **Verified at `4924a670`:** `git grep execution_mode` across `migrations/*.sql` shows no migration after `019` touches that CHECK constraint — the plan's "remaining step" is still open as of this ADR.
- `amm.go` and `amm_test.go` are kept on purpose (per the P2-09 commit and the improvement-plan note) as an unwired pricing library — `internal/discover` price tests use `PriceYes` from it.
- 12 AMM-execution tests were deleted as testing retired behavior (wallet_wiring_test.go, compliance_gate_test.go); a retirement guard (`TestPlaceOrder_AMMMarketRetired_Rejected`) was added in the same commit.
- **Open question:** whether to finish the IMPROVEMENT_PLAN's two remaining choices — drop the read-only AMM preview path (deleting `amm.go`/`amm_test.go`/`previewAMMOrder`) or keep it and tighten the CHECK constraint — is unresolved; the plan document itself frames it as a decision still to make ("Remaining work (if still wanted)").

## Evidence

- Commit `e10a4446` (2026-06-13) — the retirement commit and its full rationale/safety note.
- `gateway/migrations/019_prediction_exchange_engine.sql` — original `execution_mode` column, default `'order_book'` for new markets, CHECK constraint still including `'amm'` at `4924a670`.
- `gateway/internal/prediction/service.go` — `PlaceOrder`/`PreviewOrder` execution-mode gating comments.
- `docs/audit/IMPROVEMENT_PLAN.md`, P2-09 entry — "PARTLY DONE" status note (2026-09-06) and the two open corrections.
- Fork commit `8101a38a` (2026-04-16) — "AMM (LMSR) at launch, data model supports future CLOB migration."

## Related

- [ADR-0007](./0007-fork-from-sportsbook-to-prediction-market.md) — introduced the AMM this ADR retires.
- `CLAUDE.md`, "Tech Stack — Go Backend" — "Execution against the AMM is retired (P2-09)."
