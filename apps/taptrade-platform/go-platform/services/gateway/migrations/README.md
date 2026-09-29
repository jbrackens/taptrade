# Gateway migrations

Goose SQL migrations for the Go gateway, run by `services/gateway/cmd/migrate`.

The gateway was migrated in place from the sportsbook fork, so the numbering
starts in the old domain: **001–013 are sportsbook-era**, the prediction-market
schema begins at `014_prediction_schema.sql`, and the directory currently runs
through `065_alpha_cashier_finality_and_scan.sql` (next free prefix: `066`). The
current schema, table by table, is described in
[`docs/DATA_MODEL.md`](../../../../../../docs/DATA_MODEL.md).

`033_drop_dead_sportsbook_tables.sql` drops eleven of those early tables —
`freebets`, `bet_legs`, `odds_boosts`, `bets`, `incidents`, `match_timelines`,
`selections`, `markets`, `fixtures`, `tournaments`, `sports`. Do not treat
001–013 as a description of the live schema; read the current DDL from 014
onward, or from the database itself.

Migrations are the schema source of truth — there is no separate schema dump in
this repo. A few worth knowing about:

| Migration | What it does |
|---|---|
| `014_prediction_schema.sql` | Categories, series, events, markets, orders, positions, trades, settlement |
| `019_prediction_exchange_engine.sql` | Order-book matching: exchange-mode columns, book indexes, collateral ledger |
| `027_rbac_admin.sql` | Back-office staff directory, roles, permissions |
| `037_multitenancy_foundation.sql` | Tenant scoping |
| `050_points_unit_model.sql` | Renames every live `*_cents` column to `*_points` (rename only — no stored value is changed) |

## Running migrations

`cmd/migrate` reads three environment variables:

| Variable | Required | Default |
|---|---|---|
| `GATEWAY_DB_DSN` | yes | — |
| `GATEWAY_DB_DRIVER` | no | `postgres` |
| `MIGRATIONS_DIR` | no | resolved relative to the binary |

Against the local Postgres from `apps/taptrade-platform/docker-compose.yml`
(database `predict`, user `predict`, host port **5434**):

```bash
cd apps/taptrade-platform/go-platform/services/gateway
export GATEWAY_DB_DSN="postgres://predict:localdev@localhost:5434/predict?sslmode=disable"
export MIGRATIONS_DIR="$(pwd)/migrations"

go run ./cmd/migrate up        # apply all pending
go run ./cmd/migrate status    # show applied/pending
go run ./cmd/migrate version   # current schema version
go run ./cmd/migrate down      # roll back one
go run ./cmd/migrate create add_something   # scaffold a new migration
```

`reset` (roll back everything) and `fix` are also accepted.

Setting `MIGRATE_ALLOW_MISSING=true` makes `up` apply out-of-order migrations.
That exists for the demo deploy, where a feature branch can add a lower-numbered
migration after a higher-numbered one has already been applied. Leave it unset
locally so ordering problems surface.

## Adding a migration

Add a new numbered file. Do not edit a migration that has already shipped —
`014_prediction_schema.sql` in particular is applied everywhere and must not
change. Prices, balances and volumes are stored in **Points** (`*_points`
columns, `BIGINT`); the product is points-only and non-redeemable, so nothing new
should introduce a `*_cents` column.

## Validation gate

From `apps/taptrade-platform/`:

```bash
make validate-go-migrations
```

That runs `scripts/data/validate-go-gateway-migrations.sh`, which starts a
throwaway `postgres:16-alpine` container on a free high port, applies this
directory from empty, and writes a log under `revival/artifacts/` plus a report
at `revival/GO_GATEWAY_DB_MIGRATION_VALIDATION.md`. It needs Docker. This is the
release gate for this directory; the root `make validate-migrations` target
covers the legacy JVM backend and does not check these files.

## Seeding

There is no `seed.sql` in this directory. Seed data is loaded by
`services/gateway/cmd/seed`, which applies `seed-data/seed_prediction.sql` and
then optional demo phases:

```bash
cd apps/taptrade-platform/go-platform/services/gateway
GATEWAY_DB_DSN="postgres://predict:localdev@localhost:5434/predict?sslmode=disable" \
  go run ./cmd/seed              # -mode base (default): taxonomy, markets, users, wallets
```

`-mode demo` layers on clickable demo state, and `-mode wipe` removes only the
rows the demo phases wrote. `services/gateway/Makefile` wraps all three as
`make seed`, `make demo-data` and `make wipe-demo`. `GATEWAY_DB_DSN` is the only
variable the seeder needs — it builds the wallet service on that same DSN.

Note that the same Makefile's `createdb` / `dev-setup` targets still create a
database named `taptrade_predict` on port 5432. That is not the stack described
above; use the `predict` database on 5434 from `docker-compose.yml`.
