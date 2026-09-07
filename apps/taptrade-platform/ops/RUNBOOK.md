# Tap Trade exchange — on-call runbook

You're on-call. Something tripped. This page is for the first 15 minutes.
Find the matching scenario, run the diagnostic, stop the bleeding, capture
evidence. Postmortem comes later.

All commands assume the local docker compose setup. In prod, substitute the
real Postgres / gateway endpoints — the queries themselves are identical.

```bash
# Local Postgres shorthand used throughout
alias psqldb='docker exec predict_postgres psql -U predict -d predict'

# Local gateway logs
alias gwlog='docker logs predict_gateway --tail 500'
```

---

## 1. Drift alert tripped

**Symptom:** Grafana panel "Drift events (24h)" goes yellow (≥1) or red
(≥5). The back-office Markets table shows a red `drift` tag on one or more
rows. Slack/PagerDuty fires on the slog line `reconciler: collateral drift
detected`.

**What it means:** the reconciler's two-phase check found that a market's
`collateral_pool_cents` column doesn't equal `sum(YES quantity) × 100¢` plus
`sum(NO quantity) × 100¢`. Confirmed drift writes a row to
`prediction_collateral_ledger` with `entry_type = 'adjustment'`.

### Diagnose

```sql
-- Recent adjustments (last 24h), most-affected markets first
SELECT m.ticker,
       m.id AS market_id,
       COUNT(*) AS adjustments,
       SUM(ABS(l.amount_cents)) AS total_drift_cents,
       MAX(l.created_at) AS most_recent
FROM prediction_collateral_ledger l
JOIN prediction_markets m ON m.id = l.market_id
WHERE l.entry_type = 'adjustment'
  AND l.created_at > NOW() - INTERVAL '24 hours'
GROUP BY m.ticker, m.id
ORDER BY total_drift_cents DESC;

-- Full forensic chain for one market
SELECT entry_type, amount_cents, balance_after_cents, reason, created_at
FROM prediction_collateral_ledger
WHERE market_id = '<UUID-from-above>'
ORDER BY created_at DESC
LIMIT 50;
```

### Triage

- **Drift < $10 on a low-volume market:** the reconciler already wrote the
  adjustment ledger row. Cross-user collateral invariant is restored. No
  user-visible impact. Log evidence, move on.
- **Drift ≥ $100 on any market, or any drift on a market with > $10K
  volume:** halt the market while you investigate.

```bash
# Halt one market (replaces the market lifecycle action UI; same effect)
TOKEN=$(curl -s -X POST http://localhost:18080/api/v1/auth/login/ \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin@taptrade.local","password":"admin123"}' \
  | jq -r .accessToken)
CSRF=$(curl -s -c /tmp/cookies -X POST http://localhost:18080/api/v1/auth/login/ \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin@taptrade.local","password":"admin123"}' >/dev/null \
  && grep csrf_token /tmp/cookies | awk '{print $7}')

curl -s -X POST "http://localhost:18080/api/v1/admin/markets/<MARKET_ID>/lifecycle/halt" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-CSRF-Token: $CSRF" \
  -H 'Content-Type: application/json' \
  -d '{"reason":"on-call: drift > $100, holding pending investigation"}'
```

### Recover

After halt, the engine rejects new orders. Existing positions are untouched.
Evidence to capture before unhalting:

```sql
-- Snapshot of positions on this market (sums should match the pool)
SELECT side,
       SUM(quantity) AS qty,
       SUM(total_cost_cents) AS cost_cents,
       SUM(quantity) * 100 AS expected_pool_contribution
FROM prediction_positions
WHERE market_id = '<MARKET_ID>' AND quantity > 0
GROUP BY side;

-- Pool right now
SELECT collateral_pool_cents FROM prediction_markets WHERE id = '<MARKET_ID>';

-- All trades, newest first
SELECT id, trade_kind, engine_kind, price_cents, quantity, created_at
FROM prediction_trades
WHERE market_id = '<MARKET_ID>'
ORDER BY created_at DESC
LIMIT 20;
```

When the numbers reconcile, resume the market via the same lifecycle
endpoint with action=`open` and reason=`drift resolved, ticket X`.

### Known caveat

The current reconciler treats reservation cents the same as pool cents in
some edge cases — a market with many resting buy-limit orders that never
crossed can show a false-positive drift report. If your forensics shows
`actual_pool=0` and the "drift" exactly equals `sum(open buy-limit
reservation cents)`, the underlying invariant is fine and the reconciler
needs a fix. File a bug; don't unwind real positions.

---

## 2. Market stuck — orders failing or lifecycle won't advance

**Symptom:** users report "trade button does nothing" or "this market won't
close." Grafana panel "Rejection rate (5m)" pegs at 100% for one market.
Possibly stuck `pending` orders in the table.

### Diagnose

```sql
-- Orders stuck in 'pending' more than 5 minutes
SELECT id, market_id, user_id, side, action,
       EXTRACT(EPOCH FROM (NOW() - updated_at))::int AS stale_seconds,
       failure_reason
FROM prediction_orders
WHERE status = 'pending'
  AND updated_at < NOW() - INTERVAL '5 minutes'
ORDER BY updated_at
LIMIT 20;

-- Market lifecycle state
SELECT id, ticker, status, execution_mode, close_at, settled_at
FROM prediction_markets
WHERE ticker = '<TICKER>';

-- Recent rejected orders by reason
SELECT failure_reason, COUNT(*)
FROM prediction_orders
WHERE market_id = '<MARKET_ID>'
  AND status = 'rejected'
  AND created_at > NOW() - INTERVAL '30 minutes'
GROUP BY failure_reason
ORDER BY 2 DESC;
```

### Triage

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| status=`pending` rows piling up | Gateway crashed mid-match; the persist path didn't complete | Restart gateway, set the stuck orders to `cancelled` (below) |
| Lots of `insufficient_funds` rejections from one user | Wallet desync after a refund — wallet credit didn't land | Check wallet_reservations + wallet_ledger for that user |
| Lots of `price_band_violation` | A client is sending bad price values; rate-limit them at the edge | Find the offender via `user_id` distribution |
| `market_closed` rejections | The market auto-closed at `close_at`; that's intentional | Communicate to user, no action |
| `execution_mode` is `amm` and rejections complain about engine | A market that shouldn't be on AMM is | Use the back-office to flip to `order_book` |

### Mitigate stuck pending orders

```sql
-- Mark stuck pendings as cancelled. Releases wallet reservations on the
-- next ExpireStaleReservations tick (runs every 60s).
UPDATE prediction_orders
SET status = 'cancelled',
    failure_reason = 'admin: stuck pending recovered ' || NOW()::text,
    updated_at = NOW()
WHERE status = 'pending'
  AND updated_at < NOW() - INTERVAL '5 minutes';
```

Then restart the gateway:

```bash
docker compose restart gateway
sleep 5
curl -s http://localhost:18080/healthz   # expect "ok"
```

### Evidence

Before resolving, capture the failure-reason breakdown above plus the last
30 lines of gateway logs for that market_id:

```bash
gwlog | grep "<MARKET_ID>" | tail -30
```

---

## 3. Reconciler stalled

**Symptom:** Grafana panel "Reconciler outcomes" flat-lines (no
`clean`/`drift`/`error` ticks in the last 30 min). The 15-min tick is
silent in the logs.

### Diagnose

```bash
# Is the gateway up at all?
curl -s http://localhost:18080/healthz

# When did the reconciler last log anything?
gwlog | grep -i "reconciler" | tail -10

# How many open order_book markets does it need to scan?
psqldb -c "SELECT COUNT(*) FROM prediction_markets WHERE status = 'open' AND execution_mode = 'order_book';"
```

### Triage

- **Gateway is down:** restart it (same `docker compose restart gateway`
  block as scenario 2). The reconciler starts as a goroutine on gateway
  boot — see `internal/http/handlers.go` near `workers.NewReconciler`.
- **Gateway up, reconciler silent:** the tick is alive but every market
  raises an error before any `clean`/`drift` log. Tail for the error
  bucket: `gwlog | grep "reconciler: market check failed" | tail -20`.
  Most common cause is one market with corrupt position rows blowing up
  the per-market query. Skip that market (set its status to `halted`
  manually) and let the reconciler resume scanning the rest.
- **Gateway up, reconciler "running" but the scan takes > 15 min:** your
  open-market count grew past what the worker can sweep in one interval.
  Increase the interval (currently hard-coded to 15 min in `handlers.go`)
  or parallelise the per-market scans. This is an actual code change, not
  an on-call fix — file a ticket and accept the reduced cadence in the
  interim.

### Evidence

```sql
-- How many markets does the reconciler need to keep up with?
SELECT execution_mode, status, COUNT(*)
FROM prediction_markets
GROUP BY execution_mode, status
ORDER BY 1, 2;

-- Last forensic ledger write — if this is hours old and there's no error
-- in the log, the loop is genuinely stalled (not just clean).
SELECT MAX(created_at) FROM prediction_collateral_ledger;
```

---

## 4. Single market saturating the advisory lock

**Symptom:** Grafana panel "Top 10 markets by order rate" shows one
market sustaining > 300 ops/sec. p95 latency on `POST /api/v1/orders`
climbs above 200 ms. Users on other markets unaffected (the lock is
keyed on `market_id`).

### Diagnose

```sql
-- Anyone holding the per-market advisory lock right now?
SELECT pid, locktype, objid, granted, mode,
       NOW() - state_change AS holding_for
FROM pg_locks l
LEFT JOIN pg_stat_activity a USING (pid)
WHERE locktype = 'advisory'
ORDER BY granted, holding_for DESC NULLS LAST;
```

Each `objid` is `hashtext(market_id)` — to find which market that is,
match against `hashtext(id::text)` for `prediction_markets`. Or just
inspect "Top markets by order rate" in Grafana for the hot one.

### Triage

- **Sustained > 300 ops/sec on one market:** that's at the measured
  ceiling. Options:
  1. **Throttle at the API edge.** Rate-limit POSTs per user on that
     market via the API gateway. Polymarket-style "max 1 order per 100
     ms" is the standard play.
  2. **Halt briefly to let the queue drain** if you suspect a buggy
     client. Same halt command as scenario 1.
  3. **Accept the latency** if it's organic and users don't complain —
     the engine is working as designed.
- **Lock held > 5 seconds by a single pid:** that's a slow transaction.
  Find the blocking query in `pg_stat_activity`, decide whether to kill
  it. `SELECT pg_cancel_backend(<pid>)` is the soft option;
  `pg_terminate_backend(<pid>)` is harder.

### Evidence

Capture the order rate panel + the `pg_locks` snapshot before mitigating.
The advisory-lock holding time is the actual scarcity metric.

---

## 5. Settlement with collateral imbalance (override required)

**Symptom:** admin clicks Settle in the back-office and gets the toast
"collateral imbalance — override required". The settlement modal now
exposes an Override Reason textarea, but the request body doesn't yet
pipe `overrideReason` to the gateway (tracked TODO in
`internal/prediction/settlement.go`).

### Right now (pre-wire-up)

Use `psql` directly. **Only do this after running the scenario-1 drift
diagnostic** — settle-with-override leaves money in or out of the system
that needs accounting somewhere.

```sql
BEGIN;

-- 1. Force the market to settled status
UPDATE prediction_markets
SET status = 'settled',
    result = '<yes|no>',
    settled_at = NOW(),
    updated_at = NOW()
WHERE id = '<MARKET_ID>';

-- 2. Write the settlement row by hand
INSERT INTO prediction_settlements
  (market_id, result, attestation_source, settled_by, override_reason, settled_at)
VALUES
  ('<MARKET_ID>', '<yes|no>', 'admin-manual', '<your-uuid>',
   'override: <ticket-link>, drift was $X.XX, manual reconciliation by <name>',
   NOW());

-- 3. Lifecycle audit row
INSERT INTO prediction_lifecycle_events (market_id, event_type, actor_id, actor_type, reason, occurred_at)
VALUES ('<MARKET_ID>', 'settled', '<your-uuid>', 'admin',
        'override settlement: ticket <link>', NOW());

-- 4. Verify before commit
SELECT id, status, result FROM prediction_markets WHERE id = '<MARKET_ID>';

COMMIT;  -- or ROLLBACK if anything looks wrong
```

Payouts still need to be credited. Manual wallet credits are an unsafe
path; prefer to let the auto-settler retry once the lifecycle row exists.
If that doesn't fire within 5 minutes, page an engineer.

### Long-term fix

Wire `overrideReason` through `ResolveMarketRequest` in
`internal/prediction/types.go` and the corresponding HTTP handler in
`internal/http/handlers.go`. Then the back-office modal works end-to-end
and this scenario reduces to a UI click. Tracked TODO in
`internal/prediction/settlement.go`.

---

## 6. SMM (synthetic market maker) misbehaving

**Symptom:** users report "I can't trade on market X" or the bot's own
orders are filling against each other in weird ways. Grafana panel
"Top 10 markets by order rate" shows user-bot dominating.

The SMM is a platform-operated bot (worker goroutine in the gateway)
that posts two-sided limit orders on every open order_book market.
Provides liquidity before external MMs sign. Identity: `user-bot`.
Code: `internal/prediction/workers/smm.go`.

### Diagnose

```bash
# Is the SMM enabled at all?
docker exec predict_gateway env | grep ^SMM_

# Recent SMM log lines
gwlog | grep -i "smm:" | tail -30
```

```sql
-- Bot's open orders right now
SELECT m.ticker, o.side, o.price_cents, o.quantity, o.created_at
FROM prediction_orders o
JOIN prediction_markets m ON m.id = o.market_id
WHERE o.user_id = 'user-bot' AND o.status = 'open'
ORDER BY o.created_at DESC LIMIT 50;

-- Bot's cash + commitment
SELECT
  (SELECT balance_cents FROM wallet_balances WHERE user_id = 'user-bot') AS balance,
  (SELECT COALESCE(SUM(amount_cents - captured_amount_cents), 0)
   FROM wallet_reservations WHERE user_id = 'user-bot' AND status = 'held') AS reserved,
  (SELECT COUNT(*) FROM prediction_orders WHERE user_id = 'user-bot' AND status = 'open') AS open_orders;
```

### Risk controls (Phase 2.1)

| Env var | Default | Purpose |
|---|---|---|
| `SMM_ENABLED` | `false` | Master kill switch |
| `SMM_DEPTH_CENTS` | `5000` | Cash committed per market per side ($50) |
| `SMM_HALF_SPREAD_CENTS` | `3` | Half spread (full spread = 2×) |
| `SMM_MAX_DRIFT_CENTS` | `2` | Re-quote when drifted > this from current target |
| `SMM_TICK_INTERVAL` | `30s` | Tick cadence |
| `SMM_MAX_MARKETS_PER_TICK` | `0` (unlimited) | Cap on markets touched per tick |
| `SMM_MAX_POSITION_QTY` | `500` | Cap on accumulated YES or NO inventory per market |

When position cap fires, expect log lines like:

```
smm: skip no — position cap  market=TICKER position=21 cap=10
```

And a Grafana / Prometheus signal:

```
prediction_smm_skips_total{market_id="<uuid>",side="no",reason="position_cap"} N
```

A sustained climb in `position_cap` skips on a single market means
the bot has accumulated its limit and either users keep crossing the
remaining side or the market is one-sided. Investigate: is mid moving
fast in one direction (bot underwater on one side)? Or did users
take all the bot's liquidity on the other side?

### Halt switch

Fastest stop: restart gateway with `SMM_ENABLED=false`. The bot's
shutdown handler cancels all its open orders before exit, so the
restart unwinds the book cleanly.

```bash
docker compose stop gateway
SMM_ENABLED=false docker compose up -d gateway
```

If you can't restart, cancel the bot's orders directly:

```sql
-- Inside a single transaction so it's reviewable
BEGIN;
UPDATE prediction_orders
SET status = 'cancelled',
    failure_reason = 'admin: halt SMM via ' || NOW()::text,
    updated_at = NOW()
WHERE user_id = 'user-bot' AND status = 'open';
COMMIT;
```

Reservations are released by the existing `ExpireStaleReservations`
worker within 60 seconds.

### Resolved — market orders now issuance-match (commit pending)

Earlier versions of the engine skipped the issuance loop for market
orders because the `taker.PriceCents != nil` guard short-circuited the
match — every market buy on a market with only SMM Buy-NO quotes
returned `cancelled — no matching liquidity` even when feasible fills
were sitting on the book.

Fixed by treating a market buy as having an implied taker limit of
`MaxTickPriceCents` (99). Feasibility check `99 + maker_limit >= 100`
is true for any in-band maker, so every Buy-NO maker becomes
eligible. The notional cap on the request bounds total dollar
exposure. See `service.go::placeExchangeOrder` and
`exchange.go::BuildPlan` for the wiring; regression coverage is in
`exchange_market_issuance_test.go`.

Side note for on-call: an IOC market order with partial fill returns
`status='cancelled'` with `filled_quantity > 0`. That's correct
behavior — IOC fills what it can and cancels the unfilled remainder.
The trade ticket UI handles this by toasting "Partially filled: N of M"
rather than "Order cancelled" when filled > 0.

---

## Evidence checklist before closing any ticket

Every scenario above ends here. Don't resolve a ticket without:

- [ ] Screenshot or text dump of the Grafana panel that fired
- [ ] Output of the diagnostic SQL
- [ ] Last 100 lines of `gwlog | grep <market_id>`
- [ ] If you mutated DB rows: the `BEGIN ... COMMIT` block you ran
- [ ] One-line summary of root cause + fix in the ticket

Stash these in the incident channel before saying "resolved." A future
on-call will thank you when the same alert fires again.

## Pinned legacy infrastructure names: /opt/phoenix + COMPOSE_PROJECT_NAME=phoenix
Two infrastructure names on the demo box predate the Tap Trade brand and are
**pinned permanently, by decision (2026-09-06)**:

- `/opt/phoenix` — the rsync/deploy root the deploy workflow writes to.
- `COMPOSE_PROJECT_NAME=phoenix` — written into `/opt/phoenix/.env` on every deploy
  (`.github/workflows/deploy-demo.yml`). It prefixes every container and **named volume**.

**Do not rename either.** Neither is user-visible: they are a directory path and a Docker
name prefix. Nothing a player or an operator sees derives from them. The cost of changing
them is a full-outage volume migration; the benefit is cosmetic.

Seven named volumes carry the `phoenix_` prefix, and renaming the compose project orphans
all of them at once:

| Volume | Holds | Loss if orphaned |
|---|---|---|
| `phoenix_postgres_data` | the entire platform database | total product data loss |
| `phoenix_redis_data` | auth sessions (db 1), cache + rate limits (db 0) | every user logged out |
| `phoenix_caddy_data` | Let's Encrypt certs **and the ACME account key** | re-issue against LE rate limits; 526 while Cloudflare is Full (Strict) |
| `phoenix_caddy_config` | Caddy autosave state | low |
| `phoenix_market_images` | rehosted market thumbnails referenced by DB `image_url` | DB rows desync from files |
| `phoenix_db_backups` | the pg_dump history — i.e. the recovery path itself | recovery artifact destroyed with the data |
| `phoenix_rocketchat_mongo_data` | all Rocket.Chat history, rooms, accounts | **permanent — Mongo has no backup sidecar** |

A previous version of this section documented a five-step cutover. **That procedure was
unsafe and has been removed.** Its volume-copy step mounted the same volume as both source
and destination (`-v taptrade_X:/from -v taptrade_X:/to`) against a volume created empty
moments earlier, so it copied nothing, exited 0, and looked successful. The stack would
have come up on empty volumes — Postgres running `initdb` on a fresh database — and the
final step would then have deleted the only surviving copy. It also took no backup first,
never enumerated the volume set, and never verified a copy before deleting.

If a rename is ever genuinely required, it needs: an off-box, restore-verified `pg_dump`
taken while the stack is healthy; a separate off-box tar of all seven volumes; read-only
source mounts (`-v phoenix_$V:/from:ro -v taptrade_$V:/to`); per-volume file/byte
verification before any deletion; and a lockstep update of `deploy-demo.yml`,
`migrate-on-box.sh`, `migrate-demo.yml`, `cf-firewall.sh`, and the `cf-firewall.service`
systemd unit **installed in /etc** (which the `mv` does not touch, and whose failure
silently leaves the Cloudflare origin filter fail-open at next boot).
