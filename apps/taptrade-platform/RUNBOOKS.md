# Tap Trade — Operational Runbooks

> Prediction-market operations. The previous sportsbook runbook documented tables
> that no longer exist — migration `033_drop_dead_sportsbook_tables.sql` dropped
> them — and was retired in the P2-04 cleanup; it survives only in git history
> (commit `3ec79f0a`).

Conventions: gateway `:18080`, auth `:18081`, Postgres `:5434` (local). On the
box, prefix DB commands with the compose exec, e.g.
`docker compose -f docker-compose.yml -f docker-compose.demo.yml exec postgres psql -U predict -d predict`.

---

## 1. Market lifecycle

States (`internal/prediction/lifecycle.go`): `unopened → open → halted/closed →
settled/voided`. Transitions go through `TransitionMarket`/`CanTransition`; invalid
transitions are rejected.

- **Open / halt / close a market:** backoffice → Prediction Admin → Markets, or
  `POST /api/v1/admin/markets/{id}/transition`. `MarketCloser` (30s) auto-closes
  markets past `close_at`.
- **A market is stuck in `pending` orders:** the `RestingOrderExpirer` finalizes
  resting orders on inactive markets and releases their reservations + RG stake.
  If orphaned pending orders persist, check the worker is running (gateway logs:
  `resting-order expirer`).

## 2. Settlement

The money-critical operation. Resolve a closed market to YES or NO; winners are
paid 100¢/contract.

- **Manual resolve (backoffice):** Prediction Admin → Settlements → resolve with
  attestation. Dual-control (propose → challenge window → finalize) is available
  via the resolution store.
- **Concurrency safety:** settle and void each take a status-guarded transition as
  the first statement of their transaction (COR-01 fix). A concurrent settle+void
  on the same market resolves to exactly one; the loser returns **409 Conflict**
  ("market was settled or voided by a concurrent operation"). This is expected —
  retry is unnecessary, the market is already terminal.
- **Auto-settlement:** `AutoSettler` (60s) settles/proposes closed markets that
  have an automated feed source. **No production feed is wired yet** — all
  settlement is currently manual admin attestation. A feed-source error leaves the
  market closed for manual settlement (visible in gateway logs as `resolution
  source unhealthy`).
- **Verify a settlement:** the payout total and per-position payouts are written
  in one transaction; `prediction_payouts` rows + `wallet_ledger` credits with key
  `prediction_payout:<market>:<position>`. Re-running a settle is idempotent.

## 3. Void / refund

Void refunds every position at entry cost (`prediction_void:<market>:<position>`
ledger keys). Use for mis-created or unresolvable markets. Cannot void a market
already in a terminal state.

## 4. Cashier (alpha custodial USDC — default OFF)

Only relevant when `ALPHA_CASHIER_ENABLED=true`.

- **Deposit review:** backoffice → Cashier. Deposits are credited after on-chain
  verification (≥ `ALPHA_CASHIER_CONFIRMATIONS`, default 12). Address screening
  (sanctions) runs on the depositing wallet; a hit blocks the intent (CMP-01).
- **Withdrawal (two-person):** an operator **approves** with a mandatory note; a
  **different** operator records the broadcast tx hash (`ALPHA_CASHIER_TWO_PERSON_WITHDRAWAL`,
  A2-04). The payout is broadcast **manually off-app** from the treasury wallet —
  the platform holds no withdrawal keys. Reconcile broadcasts against the treasury
  on-chain balance daily.
- **Reorg on a credited deposit:** the finality check
  (`CheckDepositFinality`) flags a deposit whose tx vanished or was re-mined; the
  amount is frozen with an idempotent hold (`alpha-cashier:reorg:<id>`) and
  surfaced for review (A2-03). Investigate before releasing.
- **Sanctions hit / quarantine:** blocked operations log at ERROR with surface +
  user; route to compliance review.

## 5. Reconciliation

`cmd/reconciliation-report` (and `internal/prediction/reconciliation.go`) computes
per-market collateral drift and cashier ledger balance. Schedule it and alert on
nonzero drift (P2-10). A nonzero drift on a settled market is a signal to
investigate before the next settlement batch.

## 6. WebSocket / realtime incident

Symptom: clients not receiving live price/portfolio updates.
- The hub is **per-instance** — if >1 gateway replica is running, realtime is
  broken by design (ARCH-01); run a single gateway until the Redis backbone
  (P2-07) lands.
- A slow client is now dropped + disconnected (it resyncs on reconnect); check the
  `ws_dropped_messages_total` / `ws_slow_clients_disconnected_total` counters.
- Auth failures at upgrade return 401 before the socket opens; check the auth
  service is healthy (`:18081/healthz`).

## 7. Database restore

1. Stop the gateway + auth (`docker compose … stop gateway auth`).
2. `ops/backup/restore-db.sh <dump.gz>` (see the script for flags).
3. Re-apply migrations if the dump predates the current schema (`run --rm migrate up`).
4. Start services; health-check `:18080/healthz` and `:18081/healthz`.
5. Run the reconciliation report and confirm zero unexpected drift before
   re-enabling trading.

## 8. Boot-validation failure (gateway won't start in prod/staging)

The gateway fails closed on missing compliance config. The boot error names the
exact missing variable (geo gate, allowlist, edge secret, KYC ack, etc.) — set it
per [DEPLOYMENT.md](DEPLOYMENT.md) "Required production/staging configuration".
This is intentional: a gateway that can't prove its jurisdiction posture must not
serve traffic.

## 9. Common health checks

```
curl -s -o /dev/null -w '%{http_code}' http://localhost:18080/healthz   # gateway
curl -s -o /dev/null -w '%{http_code}' http://localhost:18081/healthz   # auth
```
Gateway `/healthz` covers DB connectivity + worker startup; it needs longer than a
frontend to come up. The metrics endpoint is `/metrics`.
