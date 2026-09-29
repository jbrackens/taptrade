# ADR-0009: Points unit model (rename `*_cents` to `*_points`)

**Status:** Accepted — implemented 2026-07-07 (migration `050_points_unit_model.sql`).
**Date:** 2026-07-07, "owner-directed" per the migration's own header comment.
**Deciders:** Not named beyond "owner-directed" in the migration header.

> **Scope:** the unit-model correction that renamed the active economy's
> `*_cents` columns to `*_points`, and the reasoning the migration header
> records for it. **Authoritative for:** why the columns are named
> `*_points` and which tables were deliberately excluded.
> **Not for:** the points-only launch-boundary decision this fed into — see
> [ADR-0010](./0010-points-only-non-redeemable-launch-boundary.md).

## Context

Migration `050_points_unit_model.sql`'s own header is the primary and
essentially only record of this decision, quoted here in full because the
style guide for this doc set requires never inventing rationale — this is
the actual recorded reasoning, not a paraphrase:

> **THE FLAWED MODEL THIS FIXES:** columns were named `*_cents` as if
> Points had a nested cent subdivision ("point-cents"), and the UI divided
> by 100 at display. The audited reality: every stored integer was ALREADY
> cent-scale — a market price of 8 stores 8, a winning contract credits
> 100, fees floor on the same units. Under the corrected model (1 Point = 1
> cent of in-platform play value; a contract priced at 8¢ costs 8 Points;
> correct contracts settle at 100 Points) those integers ARE whole Points.
>
> **THEREFORE:** this migration renames columns only. It does not touch a
> single stored value — no multiplication, no division. Application code
> ships in the same release reading the new names and displaying integers
> directly (no /100).

## Decision and scope

Rename every `*_cents` column to `*_points` across the **active** points
economy — `prediction_*`, `wallet*`, bonuses/campaigns/wagering/limits, the
activity log — as a pure rename with no value transformation, shipped in
the same release as the application code that reads the new names and
displays integers directly.

**Deliberately excluded from the rename** (per the same migration header,
because renaming them would falsify money-era history):
- `alpha_deposit_intents` / `alpha_withdrawal_requests` — "launch-prohibited real-money cashier tables; their `_cents` were genuinely cash cents."
- `ledger_entries` — "orphaned legacy table (zero live code references)."

`reserved_cash_cents` / `captured_cash_cents` / `released_cash_cents` also
had the "cash" vocabulary dropped in the same pass — the migration records
these "hold Points and always did."

## Alternatives considered

Not recorded. The migration header explains why a value-preserving rename
was safe (the integers were already cent-scale) but does not discuss any
alternative approach (for example, an actual currency-precision redesign,
or leaving the misleading names in place with a translation layer at the
API boundary).

## Rationale and trade-offs

Recorded, in the migration header quoted above: the prior naming implied a
sub-unit ("point-cents") that never existed in the stored data, and the UI
compensated by dividing by 100 at display — a display-layer workaround for
a naming-layer bug rather than an actual value-precision requirement. The
fix removes the workaround along with the misleading name, in one
value-preserving migration.

## Consequences and constraints

- **Verified at `4924a670`:** `CLAUDE.md`'s standing rule 3 ("Never reintroduce `*Cents` / `*_cents` names in the prediction economy") cites `app/__tests__/qa-regressions-2026-04-18.test.ts` as the CI enforcement that fails the build if `yesPriceCents`/`noPriceCents` and siblings reappear on the wire types — this test predates the migration (2026-04-18 filename vs. 2026-07-07 migration date), meaning it was extended/repurposed rather than written fresh for this rename; not independently re-verified in the 2026-09-29 documentation review.
- `CLAUDE.md`, "Domain Model": "Every stored integer is already whole Points — there is no sub-Point subdivision and nothing divides by 100 at display," directly citing this migration's header as the explanation.
- The play-money faucet env var `STARTER_GRANT_CENTS` was **not** renamed despite gating a Points-denominated grant — `CLAUDE.md`'s environment-variable reference notes "the env name still says CENTS; the value is Points," an explicit, acknowledged inconsistency left in place.
- `docs/compliance/geofencing-kyc.md`'s `KYC_ENFORCEMENT` / `KYC_WITHDRAWAL_THRESHOLD_CENTS` var also kept its `_CENTS` suffix through this migration for the same reason as the excluded tables: "those legacy cashier amounts were genuinely cash cents."
- This migration is a precondition for, but is a distinct decision from, the points-only launch-boundary decision — see [ADR-0010](./0010-points-only-non-redeemable-launch-boundary.md).

## Evidence

- `gateway/migrations/050_points_unit_model.sql` — full header (quoted above) and the column-rename statements (e.g. `yes_price_cents` → `yes_price_points`).
- `CLAUDE.md`, "Domain Model" and "Critical Rules" (rule 3) — citing this migration.
- `docs/taptrade-economy-rules.md` — "## Unit Model (corrected 2026-07-07)" section header, confirming the same date.
- `docs/compliance/geofencing-kyc.md` — `KYC_ENFORCEMENT` row explaining the surviving `_CENTS` suffix.

## Related

- [ADR-0010](./0010-points-only-non-redeemable-launch-boundary.md) — the points-only launch model this unit correction underpins.
- `docs/taptrade-economy-rules.md` — the living economy-rules document.
