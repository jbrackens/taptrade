# ADR-0012: Merge `feat/hula-na-cashier` to `main`, keep it dark behind flags

**Status:** Accepted — implemented 2026-09-29 (merge commit `af3d0611` and its preceding/following commits).
**Date:** 2026-09-29.
**Deciders:** John Brackens (owner), per the instruction recorded below.

> **Scope:** the decision to merge the long-diverged `feat/hula-na-cashier`
> branch's useful parts into `main` while keeping every cashier surface
> unreachable on the demo. **Authoritative for:** what was ported, what was
> dropped, and how the "dark" guarantee is enforced.
> **Not for:** the points-only launch boundary this sits behind — see
> [ADR-0010](./0010-points-only-non-redeemable-launch-boundary.md).

## Context

`feat/hula-na-cashier` was the one branch P2-06 (2026-06-14) explicitly
declined to prune, flagged "ties to the `-cashier` worktree — don't prune
without checking it" (`docs/audit/P2-06-BRANCH-TRIAGE.md`, §6). It had
forked on 2026-05-09 — before the repo's directory rename from
`apps/Phoenix-Predict-Combined` to `apps/taptrade-platform` — so by
2026-09-29 a literal 3-way content merge would have resurrected the old
directory tree structure (merge commit `af3d0611`: "a content merge would
have resurrected the old tree").

**Decision source.** The owner gave the instruction in a working session with
the coding agent on 2026-09-29: *"merge it to main but hide it under a feature
flag so its not available on the demo."* This ADR is the first place that
instruction is written down in the repository; the commits below carry it out.

## Decision and scope

Port the branch's still-relevant content onto `main`'s current code instead
of merging the divergent tree, land it as a sequence of ordinary commits,
then record the fork with a no-op merge commit for history. Every ported
surface stays behind a flag that defaults off and is never set on the demo.

**Ported** (merge commit `af3d0611`'s own list):
- The deposit watcher → `internal/alphacashier`'s `DepositScanner` (`gateway/internal/alphacashier/deposit_scanner.go`), reusing the alpha rail's verify-once/credit-once path, with a persisted cursor (migration `065`), bounded `eth_getLogs` ranges, a leader lock and retries. Flag: `ALPHA_CASHIER_DEPOSIT_SCANNER_ENABLED`.
- Rail-boundary dust accounting (`TokenUnitsToCentsWithDust`), reported by reconciliation.
- The on-chain decimals guard (`VerifyTokenDecimals` at wiring) — commit `d69d4e73`.
- The fail-closed deposit card — commit `e50a897d` — a read-only crypto deposit card at player route `/cashier`, gated by `NEXT_PUBLIC_FEATURE_CASHIER_UI` (build-time; `notFound()` without it), reading `GET /api/v1/cashier/alpha/config`. Deposit actions themselves (wallet connect, intent, tx submit) were explicitly **not wired** — `FEATURE_MANIFEST.json` marks it `STUBBED`.

**Dropped** (same commit message):
- `payments/crypto_rail.go` and its gateway wiring — "mounted unconditionally, bypassing the points-only launch boundary; ad hoc DDL at boot; scanned from block 0; its reorg check could never fire" (subsequently deleted entirely in `4924a670`, 2026-09-29 same day).
- The pre-fork sportsbook-era cashier UI (USD card/bank methods, cheque payouts with SSN capture, casino-cage copy) and its QR add-on.
- `docs/cashier` (superseded by `docs/archive/cashier`), duplicate `contracts/*.sol` files, a stray Makefile.
- `services/` and `packages/cashier-sdk` copies — older than `main`'s.

**Hardening landed alongside the merge** (commit `d91b21c2`, same day):
withdrawal completion now requires on-chain proof against
`ALPHA_CASHIER_PAYOUT_ADDRESS`; deposit/withdrawal requests serialize per
user on a shared advisory-lock key; the withdrawal KYC threshold now counts
both rails (`payments.CrossRailWithdrawnCents`); admin cashier actions
refuse to run without RBAC when a DB is configured; the reorg watcher
retires finalized deposits and escalates unrecoverable reorgs once, not
every tick.

**"Dark" enforcement:**
- `gateway/internal/http/demo_money_flags_test.go` — `TestDemoDeployNeverSetsMoneyFlags` (named in commit `d91b21c2`) fails CI if the demo compose file or deploy workflow ever sets a money flag.
- `app/__tests__/cashier-flag.test.ts` pins the player `/cashier` page's flag gate.
- The points-only boundary tests (per commit `e50a897d`) assert `/cashier/page.tsx` 404s without the flag, and that `cashier-client.ts` may request only the config endpoint.
- The same day's separate cleanup (`185c982f`) deleted the orphaned `internal/cashier` package entirely — "nothing imported it" — keeping only the two pieces that had a real use in the points product: `internal/webhookauth` (the one inbound HMAC check, now shared by the store and payments webhooks) and `internal/approval` (the two-person rule, explicitly **not wired yet**).

## Alternatives considered

Not recorded as a deliberated list. The merge commit explains *why not* a
literal 3-way merge (would resurrect the pre-rename directory tree) but
does not discuss alternatives to merging at all — e.g., abandoning the
branch outright (as the four cashier ADRs and the rest of
`docs/archive/cashier/` were), or porting the code without shipping the
`/cashier` UI page.

## Rationale and trade-offs

Partially recorded. The merge commit records the *mechanical* rationale
(why port-then-record-merge instead of a real merge) and a per-piece
keep/drop rationale (quoted above: what each dropped piece duplicated or
what was wrong with it). The *product* rationale — why merge a
long-abandoned branch's cashier code into `main` at all, for a
points-only, no-redemption launch, rather than leave it on its branch or
delete it — is the owner instruction quoted above — the only recorded rationale for the
top-level decision. No cost/benefit
analysis beyond that instruction is written anywhere in the repository.

## Consequences and constraints

- **Verified at `4924a670`:** `CLAUDE.md`'s "Points-only launch boundary" section independently confirms this same state ("The cashier is merged but dark (2026-09-29)") with matching detail, and lists the same enforcement tests.
- `FEATURE_MANIFEST.json` carries 3 `STUBBED` entries at `4924a670` (confirmed by direct read); one of them is exactly the cashier UI, with the note: "Merged from feat/hula-na-cashier 2026-09-29: a fail-closed deposit card that reads the gateway alpha cashier's real config... but has no deposit action, because the app has no wallet connection yet. STUBBED until wallet connect + deposit intents are wired." The player app's gate suite (`./gate.sh`) fails Gate 5 (feature manifest) specifically because of these STUBBED entries — this is a known, currently-failing local gate, not a hidden defect.
- `internal/approval`'s two-person rule is built but explicitly unwired — `CLAUDE.md`: "waiting on a decision about which admin actions (large credits, manual settlement) should need a second admin." **Open question**, named in the code's own package doc, not resolved by this ADR.
- This decision sits entirely inside the points-only launch boundary established by [ADR-0010](./0010-points-only-non-redeemable-launch-boundary.md) — nothing here reopens that boundary; every flag this ADR discusses defaults off and is boot-refused in production/staging independent of this merge.

## Evidence

- Merge commit `af3d0611` (2026-09-29) — full ported/dropped list, quoted above.
- Commit `d91b21c2` (2026-09-29) — rail hardening, `TestDemoDeployNeverSetsMoneyFlags`.
- Commit `e50a897d` (2026-09-29) — the flag-gated `/cashier` page and its boundary-test coverage.
- Commit `d69d4e73` (2026-09-29) — on-chain decimals guard.
- Commit `185c982f` (2026-09-29) — `internal/cashier` deletion, `internal/webhookauth` and `internal/approval` extraction.
- Commit `4924a670` (2026-09-29) — removal of `payments/crypto_rail.go`.
- `CLAUDE.md`, "Points-only launch boundary" — independent corroborating summary.
- `apps/taptrade-platform/frontend/packages/app/FEATURE_MANIFEST.json` — the cashier-UI `STUBBED` entry (line ~187-189 at review time).
- `gateway/internal/http/demo_money_flags_test.go`, `app/__tests__/cashier-flag.test.ts` — enforcement tests, present at `4924a670`.

## Related

- [ADR-0010](./0010-points-only-non-redeemable-launch-boundary.md) — the launch boundary this merge stays behind.
- [ADR-0011](./0011-deployment-topology-single-branch-hetzner-compose.md) — `feat/hula-na-cashier` was the one branch P2-06 declined to prune; this ADR is that branch's eventual disposition.
- `docs/archive/cashier/README.md` — the "Update 2026-09-29" note added to the archived record, cross-referencing this merge.
