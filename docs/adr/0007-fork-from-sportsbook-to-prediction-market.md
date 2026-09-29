# ADR-0007: Fork from Taya Na Sportsbook to a prediction-market domain

**Status:** Accepted (historical fact — the fork happened; not a live decision to revisit).
**Date:** 2026-04-16 (commit `8101a38a`, "feat: transform sportsbook into prediction event platform (Phases 1-6)").
**Deciders:** Not recorded. No ADR, plan doc or commit trailer names who approved the fork.

> **Scope:** why and how the codebase moved from a sportsbook domain to a
> prediction-market domain, and what was kept vs. replaced in that move.
> **Authoritative for:** the fork boundary only. **Not for:** the points/CLOB/
> launch-boundary decisions that followed it — see
> [ADR-0008](./0008-clob-execution-replaces-amm.md),
> [ADR-0009](./0009-points-unit-model.md),
> [ADR-0010](./0010-points-only-non-redeemable-launch-boundary.md).

## Context

The repository originated as **Taya Na Sportsbook**, a sports-betting
platform (fixtures, selections, betslips, odds). `CLAUDE.md` records: "The
project was forked from Taya Na Sportsbook on 2026-04-16 and transformed."
The sister repository `jbrackens/Taya_Na_Sportsbook` still exists as the
on-hold sportsbook (`CLAUDE.md`, "GitHub Repo" section).

Commit `8101a38a` (2026-04-16, "feat: transform sportsbook into prediction
event platform (Phases 1-6)") is the single largest commit in the fork
sequence and its message records its own "Architecture decisions" section
verbatim:

> AMM (LMSR) at launch, data model supports future CLOB migration.
> Unified order book (YES/NO cross-match). Per-market fee parameters
> (zero-default). Split oracle: automated feeds for numeric, admin-attested
> for subjective. Cent-based pricing (0-100 = probability).

The same commit day (2026-04-16) carries the rest of the transformation
sequence in git history: `12d61a1b` (prediction seed data), `cc5ca5e9`
(wire wallet to orders/settlements), `a4e1f8b3` (replace sportsbook chrome
with prediction nav), `c3f2a7d1` (redesign player frontend), `6256a977`
(rebuild auth on prediction tokens), `53342374` (rewrite Player Hub as a
prediction-native profile page).

## Decision and scope

Replace the sports-betting domain model (`sports`/`fixtures`/`selections`/
`bets`/`odds`) with a prediction-market domain model
(`categories`/`series`/`events`/`markets`/`orders`/`positions`), while
preserving the shared platform infrastructure that does not encode
sportsbook-specific concepts.

**Kept** (per `CLAUDE.md`, "Shared infrastructure ... was preserved"):
- **Auth** — `auth/` (`apps/taptrade-platform/go-platform/services/auth/`), rebuilt onto prediction tokens the same day (`6256a977`) but as the same service.
- **Wallet/ledger** — `gateway/internal/wallet/` (single-entry running-balance model; see [ADR-0006](./0006-ledger-accounting-model.md)), adapted rather than replaced (`cc5ca5e9` "wire wallet to orders and settlements").
- **WebSocket hub** — `gateway/internal/ws/`, "updated ... with prediction channels (market, portfolio, trades)" per the fork commit message, i.e. the hub itself carried over.
- **CSRF** — the shared middleware in `platform-mod/transport/httpx/middleware.go` and the auth-service handlers (`auth/internal/http/handlers.go`, `oauth.go`) still carry CSRF checks; not sportsbook-specific and not rebuilt.
- **OpenTelemetry** — `gateway/internal/tracing/tracing.go` — a generic tracing setup, not domain-specific.

**Replaced:**
- Domain schema: 12 new prediction tables (categories, series, events, markets, orders, positions, trades, settlements, payouts, lifecycle events, API keys) per the fork commit.
- Pricing/matching: LMSR AMM at launch (later retired for CLOB — [ADR-0008](./0008-clob-execution-replaces-amm.md)).
- Settlement: oracle-attestation engine, feed adapters (manual/crypto), background auto-close/auto-settle workers.
- Both frontends' domain surfaces: player discovery/market-detail/trade-ticket/portfolio; backoffice market management + settlement queue.
- Bot API (new `tna_`-prefixed key auth — the prefix itself is a sportsbook-era artifact that survived the rename; not evaluated further here).

`CLAUDE.md`'s standing rule against reintroducing sportsbook vocabulary
(`fixtures`, `selections`, `betslip`, `sport_key`, `punter_bets`,
`freebets`, `odds_boosts`, `match_tracker`) is the durable enforcement
mechanism for this boundary — there is no automated test cited for it, only
the CLAUDE.md rule itself.

## Alternatives considered

Not recorded. No plan document, ADR-shaped note, or commit message from
this period discusses an alternative to forking the existing sportsbook
codebase (for example, a greenfield build, or forking a different
starting point). The fork commit message states what was built, not why a
fork was chosen over other approaches.

## Rationale and trade-offs

Rationale not recorded. Nothing in the repository states why the team
started from the sportsbook codebase rather than building the prediction
platform from scratch, beyond the implicit inference (not stated anywhere)
that auth/wallet/WS/CSRF/OTel already existed and worked. That inference is
plausible given what was kept, but it is a reconstruction, not a recorded
decision — treat it as **Unverified**.

## Consequences and constraints

- **Verified today:** the sister repo `jbrackens/Taya_Na_Sportsbook` still exists and is explicitly "on-hold" (`CLAUDE.md`); the active repo's sportsbook-vocabulary ban is a standing CLAUDE.md rule, enforced in CI by `scripts/check-conventions.sh` (G-01, which passed on 2026-09-29).
- Pre-fork sportsbook trees were later bulk-deleted in `3ec79f0a` (2026-06-14, "ARCH-01 — remove archived dead sportsbook trees", 582 MB / 19,047 files) — the fork's discarded material is no longer in the working tree, only in git history (reversible via branch `archive/2026-06-pre-cleanup`, per that commit's own message).
- The sportsbook-era `tna_` bot-key prefix persisted past the rename (not renamed as part of this or any later commit found).
- A large amount of subsequent architectural work (AMM retirement, points renaming, launch-boundary gating) is downstream of choices made in this single fork commit ("AMM at launch, data model supports future CLOB migration" foreshadows [ADR-0008](./0008-clob-execution-replaces-amm.md) explicitly).

## Evidence

- `CLAUDE.md` — "Project Overview" ("forked from Taya Na Sportsbook on 2026-04-16") and "GitHub Repo" (sister repo on-hold).
- Commit `8101a38a` (2026-04-16) — the transformation commit and its "Architecture decisions" note.
- Commits `12d61a1b`, `cc5ca5e9`, `a4e1f8b3`, `c3f2a7d1`, `6256a977`, `53342374` (all 2026-04-16) — the rest of the same-day transformation sequence.
- `gateway/internal/wallet/`, `gateway/internal/ws/`, `gateway/internal/tracing/tracing.go`, `platform-mod/transport/httpx/middleware.go`, `auth/internal/http/handlers.go` and `oauth.go` — the carried-over infrastructure, present at `4924a670`.
- Commit `3ec79f0a` (2026-06-14) — bulk removal of the pre-fork sportsbook trees.

## Related

- [ADR-0008](./0008-clob-execution-replaces-amm.md) — CLOB execution replaces AMM (the fork commit's own "future CLOB migration" note).
- [ADR-0006](./0006-ledger-accounting-model.md) — the wallet/ledger model this fork carried forward.
- `CLAUDE.md` — "Never reintroduce sportsbook concepts" rule.
