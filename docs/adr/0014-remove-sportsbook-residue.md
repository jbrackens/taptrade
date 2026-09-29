# ADR-0014: Sportsbook and gambling-only code is removed, not completed

**Status:** Accepted — implemented 2026-09-29.
**Date:** 2026-09-29.
**Deciders:** John Brackens (owner), per the instruction recorded below.

> **Scope:** the rule that code inherited from the sportsbook fork which only
> serves sports betting or casino-style gambling is deleted from the code base
> rather than finished, and the record of what the first pass removed.
> **Authoritative for:** the boundary between prediction-market features and
> sportsbook residue. **Not for:** the points-only launch boundary
> ([ADR-0010](./0010-points-only-non-redeemable-launch-boundary.md)) or the
> fork itself ([ADR-0007](./0007-fork-from-sportsbook-to-prediction-market.md)).

## Context

Tap Trade was forked from Taya Na Sportsbook on 2026-04-16
([ADR-0007](./0007-fork-from-sportsbook-to-prediction-market.md)). The fork
replaced the betting domain with markets, orders and positions, but several
sportsbook and casino subsystems survived with their names changed:
responsible-gambling controls (bet and deposit limits, cool-off,
self-exclusion, a session-limit endpoint), bonus wagering (play-through)
requirements, the canonical fixture/odds/settlement schema, betslip and odds
helpers, and their tables, seeds, locale files and tests.

On 2026-09-29 the documentation audit and the hardening pass treated some of
these as unfinished features — recommending that the responsible-gambling
gate be hardened, that session limits be enforced, and that wagering
contributions be wired. The owner rejected that direction: *"this is a
prediction market not a sports book — you're adopting sportsbook logic"*, and
asked for everything that only pertains to sports betting to be removed from
the code base.

## Decision

1. **Sportsbook-only or gambling-only code is removed, not completed.** A
   module that exists only for bets, odds, fixtures, betslips, bet cash-out,
   responsible-gambling limits, cool-off, self-exclusion, session timers,
   bonus wagering or deposit-match promotions is deleted when found, with its
   tables, docs and tests. It is never re-prioritised as a task.
2. **What stays** is what a points prediction market needs: markets, events,
   series and categories (sports and esports as *categories* are fine),
   orders, positions, trades and settlement, the Points wallet and ledger,
   the point store, loyalty, leaderboards, rewards, campaign Points grants
   (an admin grants Points, a player claims them), jurisdiction and KYC
   checks, RBAC, and the dormant cashier ([ADR-0012](./0012-cashier-merged-dark-behind-flags.md)).
3. **Risk controls are framed in market terms**: settlement integrity (a
   second admin for direct settlement and large grants), market integrity
   (wash and self-trading, multi-account faucet abuse), per-market position
   limits, and resolution sources. Gambling-compliance questions — stake
   limits, deposit limits, cool-off, playthrough, session limits — are not
   asked of this product.
4. **Naming residue is a rename, not a removal.** "Punter" identifiers, the
   `bet_settlement` loyalty source and `EligibleBetTypes` describe live
   prediction-market behaviour with old words; they are tracked in
   [TECH_DEBT.md](../TECH_DEBT.md) and renamed opportunistically.

## What the first pass removed (2026-09-29)

Gateway and platform module:
- `internal/compliance`: the responsible-gambling service, its
  `/api/v1/compliance/rg/*` routes (limits, cool-off, self-exclude,
  restrictions, session-limit and the check routes), the `ComplianceChecker`
  seam in `prediction.Service.PlaceOrder`, the point store's purchase-limit
  seam, the dormant payments deposit-limit seam, and the `self_excluded` admin
  punter status. KYC and geo compliance stay.
- `internal/bonus` and `internal/wallet`: the wagering rule type and config,
  the `wagering_*` fields and progress endpoint, `wagering.go`,
  `DrawdownDebit`, `ConvertBonusToReal`.
- `modules/platform/canonical`: the `adapter` and `replay` packages and the
  fixture, odds, bet, settlement, freebet and odds-boost types; the loyalty
  and leaderboard types remain.
- Seeds: `seed-data.json`, `seed-data/seed.sql`, and the dead-table writes in
  `seed_backoffice_dashboard.sql`.
- Migration `067_remove_sportsbook_residue.sql`: drops `wagering_contributions`,
  the `player_bonuses.wagering_*` columns, the four responsible-gambling
  tables, and `wallets` / `ledger_entries`; maps legacy campaign types to
  point-native ones and tightens both CHECK constraints.

Front ends:
- Player: the responsible-gaming, self-exclusion and RG-history pages, the
  play-limits card, the cool-off check at sign-in, the wagering progress bar,
  `FEATURE_RG` / `FEATURE_LIMITS`, and the locale namespaces nothing read.
- Office: the dead punter limits, cool-off and bet-cancel screens and the
  odds calculators.
- Shared: the betslip store and bet/odds/fixture types in `@taptrade-ui/utils`,
  the whole `@taptrade-ui/design-system` package, the mock server, the legacy
  Playwright config and its specs, and the sport icon art.

## Consequences

- Order placement no longer consults any limit service; the jurisdiction and
  KYC gates (`pretrade_gate.go`) are the only pre-trade checks.
- Campaign bonuses are plain Points grants with an expiry; nothing accrues
  toward them.
- `033_drop_dead_sportsbook_tables.sql`'s comment that `wallets` and
  `ledger_entries` were kept for live code was wrong; 067 drops them.
- The in-memory sportsbook loyalty service (`internal/loyalty/service.go`)
  still backs the legacy loyalty admin routes and was left for a separate pass
  ([TD-061](../TECH_DEBT.md#j-legacy-residue-and-hygiene)).
- Later finds of the same kind follow rule 1 without a new ADR.
