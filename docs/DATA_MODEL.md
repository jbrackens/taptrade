# Data model

> **Scope:** the Postgres schema behind the gateway (prediction exchange, wallet/points, store, loyalty, social, compliance, RBAC, content, notifications, webhooks, discover, alpha cashier, legacy payments), the separate auth-service tables, and the dormant Node cashier-api schema.
> **Authoritative for:** table shapes, keys, constraints, state machines, table ownership, units. **Not for:** request/response payloads or route behaviour → [ARCHITECTURE.md](ARCHITECTURE.md), [SPEC_CURRENT.md](SPEC_CURRENT.md); store purchase flow detail → [STORE_AND_PAYMENTS.md](../STORE_AND_PAYMENTS.md).
> **Last verified:** 2026-09-29 at commit `4924a670` — every file in `gateway/migrations/001`–`065` (066 and the auth two-factor tables added the same day with the hardening change), `gateway/migrations/README.md`, the code-created schemas (`internal/wallet/service.go`, `internal/compliance/*_postgres.go`, `internal/http/market_social_handlers.go`, `internal/http/market_watchlist_handlers.go`, `internal/http/provider_ops_audit_store.go`, `internal/http/ratelimit.go`, `internal/payments/db_service.go`), `auth/internal/http/handlers.go`, `gateway/seed-data/*.sql`, `gateway/cmd/seed/*.go`, `api-client/src/prediction-types.ts`, `services/cashier-api/migrations/001_cashier_core.sql` and `SCHEMA.md`.

Migrations are the schema source of truth — there is no separate schema dump. `gateway/` uses goose; each numbered file is applied in order and never edited after it ships (`gateway/migrations/README.md`). The highest migration is `066_settlement_override_actor.sql`; the next is `067`. (That README said 056 until the 2026-09-29 review corrected it.)

Several load-bearing tables are **not** created by goose at all — they are bootstrapped by a Go service's `ensureSchema()` on boot, guarded with `CREATE TABLE IF NOT EXISTS`. Migrations that touch these tables (032, 037, 048, 050) do so defensively (`DO $$ ... IF EXISTS ...`) because the table may not exist yet on a fresh database. Code-owned tables in this doc are marked **(code-owned)**.

## Entity relationship (text)

```
prediction_categories ──< prediction_series ──< prediction_events ──< prediction_markets
                                                        │                      │
                                          cover_image_url (057)                ├──< prediction_orders ──< prediction_trades
                                                                                ├──< prediction_positions ──< prediction_payouts >── prediction_settlements
                                                                                ├──< prediction_resolution_proposals ──< prediction_disputes
                                                                                ├──< prediction_collateral_ledger
                                                                                ├──< prediction_lifecycle_events
                                                                                └──< prediction_market_comments ──< comment_reactions / comment_reports
punters (auth id ref, no FK) ──< wallet_balances (1:1) ──< wallet_ledger
                              ├──< wallet_reservations  (correlated to orders/purchases by reference_type+reference_id, not FK)
                              ├──< loyalty_accounts (1:1) ──< loyalty_ledger
                              ├──< store_purchases ──< store_payment_events
                              ├──< player_bonuses >── campaigns ──< campaign_rules
                              ├──< kyc_status (1:1) ──< kyc_documents
                              ├──< player_restrictions (1:1), player_bet_limits, player_deposit_limits, player_activity_log
                              ├──< alpha_wallet_connections ──< alpha_deposit_intents ──< alpha_chain_transactions
                              ├──< alpha_withdrawal_requests
                              └──< admin_users (SEPARATE identity — back office, not a punter)
imported_markets (discover catalog, never exposed by id) ──promote.go──> prediction_events / prediction_markets
auth_users / auth_identities  — separate DB-or-schema from the gateway; joined to admin_users/punters only by matching email/username, no FK
```

Categories → series → events → markets is the Kalshi-style hierarchy from `014_prediction_schema.sql`. A series is optional on an event (nullable `series_id`); many demo/imported events skip it. Orders, positions, trades and settlements all key off `market_id` (UUID); `prediction_payouts` is the per-position credit row that a settlement fans out into (`UNIQUE(settlement_id, position_id)`, migration 034).

## Units: Points, and where `_cents` survives

`050_points_unit_model.sql` (2026-07-07, owner-directed) renamed every `*_cents` column in the live points economy to `*_points`, **without changing a single stored value** — the migration's own header explains the prior naming was wrong: every stored integer was already cent-scale (a market priced at 8 stores `8`; a winning contract credits `100`), so the "Points" unit is that integer directly. The player app displays it with no `/100`. 1 Point = 1 former "cent" of in-platform value; Points are **non-redeemable play currency**, displayed to users as "Clout" since 2026-09-28 (`player/app/lib/points.ts`, `CURRENCY_NAME`).

Renamed (now `*_points`, `BIGINT`/`NUMERIC`): `prediction_markets`, `prediction_orders`, `prediction_trades`, `prediction_positions`, `prediction_payouts`, `prediction_settlements`, `prediction_collateral_ledger`, `prediction_disputes.bond_points`, `wallets`/`wallet_balances`/`wallet_ledger`/`wallet_reservations`, `player_activity_log`, `player_bonuses`, `campaigns`, `wagering_contributions`, `player_bet_limits`/`player_deposit_limits`.

**Deliberately NOT renamed** (migration 050's own scoping note) because the values are genuinely cash-denominated:
- `alpha_deposit_intents.amount_cents` / `alpha_withdrawal_requests.amount_cents` — real USDC cents (paired with `amount_units NUMERIC(78,0)`, the raw on-chain base-unit amount at the token's actual decimals).
- `payment_transactions.amount_cents` (legacy payments, code-owned) — real cash cents.
- `ledger_entries.amount_cents` — orphaned legacy table (migration 050: "zero live code references" — confirmed still true, see Discrepancies).

Env vars keep the historical `_CENTS` suffix but hold whole Points in the live economy: `STARTER_GRANT_CENTS`, `DAILY_CLAIM_CENTS`, the `MISSION_*_REWARD_CENTS` family, `POINT_PACK_*_CENTS`, `REWARD_DAILY_GRANT_LIMIT_CENTS`, `SMM_*_CENTS` (`internal/http/wallet_handlers.go` `starterGrantPoints()`, `dailyClaimPoints()` — read the env var and return it unscaled as Points). `KYC_WITHDRAWAL_THRESHOLD_CENTS` is the one cash-real exception — it gates `CrossRailWithdrawnCents` (`internal/payments/db_service.go:567`), genuine USD cents summed across `payment_transactions` and `alpha_withdrawal_requests`. `store_point_packs.price_usd_cents` is likewise genuine USD cents (the purchase price), never mixed with the pack's `base_points`/`bonus_points` columns.

## Prediction

| Table | Purpose | Keys / constraints | Owner (writes) |
|---|---|---|---|
| `prediction_categories` | Top-level taxonomy (Politics, Sports, Esports…) | PK `id` UUID, `slug` UNIQUE | `internal/discover/promote.go`, `internal/prediction/sql_repository.go`; seeded in 014, edited by 018/046 |
| `prediction_series` | Recurring event template | PK `id`, `slug` UNIQUE, FK `category_id` | `internal/prediction/sql_repository.go` |
| `prediction_events` | One occurrence of a series | PK `id`, FK `series_id`/`category_id`, `status` CHECK (`draft,open,trading_halt,closed,settling,settled,voided`), `cover_image_url` (057), `is_synthetic` (018) | `internal/discover/promote.go`, `internal/prediction/sql_repository.go`, `internal/prediction/activity.go` |
| `prediction_markets` | One binary YES/NO contract | PK `id`, `ticker` UNIQUE, FK `event_id`, `article_source_id`; **`CHECK (yes_price_points + no_price_points = 100)`**; price CHECKs `BETWEEN 1 AND 99`; `status` CHECK widened in 023 to `unopened,open,halted,closed,proposed_resolution,disputed,settled,voided`; `result` CHECK `yes,no`; `execution_mode` CHECK `order_book,amm` (019); `jurisdiction_policy` JSONB overlay (035); `translations` JSONB (028) | `internal/prediction/sql_repository.go`, `internal/prediction/sql_exchange_repository.go`, `internal/discover/promote.go` (create), `internal/prediction/risk.go`, `internal/prediction/best_quotes.go` |
| `prediction_orders` | Order-book order (unified YES/NO) | PK `id`, FK `user_id→punters`, `market_id`; `side` CHECK `yes,no`; `action` CHECK `buy,sell`; `status` CHECK `pending,open,partial,filled,cancelled,expired,rejected`; `idempotency_key` UNIQUE; partial UNIQUE `(user_id, client_order_id)` where not null; `time_in_force` CHECK `gtc,ioc,fok`; `self_match_action` CHECK `cancel_taker,cancel_maker,cancel_both` | `internal/prediction/sql_exchange_repository.go`, `internal/prediction/sql_repository.go` |
| `prediction_positions` | Net holding per user/market/side | PK `id`, **`UNIQUE(user_id, market_id, side)`**; `reserved_quantity` CHECK `0..quantity` (019) | `internal/prediction/exchange.go`, `sql_exchange_repository.go`, `reconciliation.go` |
| `prediction_trades` | Immutable fill log | PK `id`, FK `buy_order_id`/`sell_order_id`/`market_id`; `trade_kind` CHECK `secondary,issuance`; `engine_kind` (`amm`/`order_book`, backfilled 019) | `internal/prediction/sql_exchange_repository.go` |
| `prediction_settlements` | One resolution record per market | PK `id`, **`market_id` UNIQUE**; `result` CHECK `yes,no`; override columns (`override_reason`, `overridden_by_user_id`, `overridden_at`) all-or-none CHECK (019), written since 2026-09-29; 066 dropped the `overridden_by_user_id → punters` FK because the overriding admin is not a punter; `payouts_total`/`payouts_completed` resume cursor (034) | `internal/prediction/settlement.go`, `sql_repository.go` |
| `prediction_payouts` | Per-position settlement credit | PK `id`, **`UNIQUE(settlement_id, position_id)`** (034, makes disbursement idempotent) | `internal/prediction/sql_repository.go`, `sql_admin_repository.go` |
| `prediction_collateral_ledger` | Append-only per-market cash movements (issuance, payout, fee, refund, rebate) | PK `id`, `entry_type` CHECK 6 values | `internal/prediction/sql_exchange_repository.go` |
| `prediction_resolution_proposals` | Pending result awaiting the challenge window (ADR-0003/0004) | PK `id`, **`market_id` UNIQUE**; `status` CHECK `proposed,finalized,voided,disputed` | `internal/prediction/sql_resolution_store.go` |
| `prediction_lifecycle_events` | Admin/system audit trail of market status changes | PK `id`, FK `market_id` | `internal/discover/repository.go`, `internal/prediction/sql_repository.go` |
| `prediction_api_keys` | Bot/partner API keys | PK `id`, FK `user_id`; `key_prefix` UNIQUE index (043, fixed from non-unique to prevent bcrypt-compare-wrong-row) | `internal/prediction/sql_repository.go` |
| `prediction_article_sources` / `prediction_ai_generation_logs` | AI market-drafting provenance | `text_hash` UNIQUE dedupe key on sources | AI drafting pipeline (`internal/prediction`) |
| `prediction_market_translation_cache` | Machine-translation cache | **`UNIQUE(market_id, locale)`** | `internal/markettranslate/repository.go` |

`prediction_markets.jurisdiction_policy` is an optional per-market overlay evaluated **after** the global geo gate (`internal/compliance/geo_gate.go`) — it can only further restrict, never widen (`internal/prediction/jurisdiction.go`).

## Wallet / ledger

| Table | Purpose | Keys | Owner |
|---|---|---|---|
| `wallet_balances` **(code-owned)** | Current balance per user (1 row/user) | PK `user_id`; `tenant_id` default `'hula'` | `internal/wallet/service.go` `ensureSchema()` |
| `wallet_ledger` **(code-owned)** | Append-only ledger of every credit/debit | PK `id` BIGSERIAL; `amount_points CHECK > 0`; **`UNIQUE(entry_type, user_id, idempotency_key)`** — the exactly-once key | `internal/wallet/service.go` |
| `wallet_reservations` **(code-owned, also created defensively by migration 020)** | Hold → capture/release for in-flight orders/purchases | PK `id`; `status` CHECK `held,captured,released,expired`; **`UNIQUE(reference_type, reference_id)`**; `captured_amount_points CHECK 0..amount_points` | `internal/wallet/service.go` |
| `wallet_reward_clusters` **(code-owned + migration 048)** | Hashed device/IP evidence for reward-abuse clustering (not a point movement) | PK `(window_date, signal_type, signal_hash, user_id)` | `internal/wallet/service.go` |
| `wallets` **DEAD** | Legacy 1:1 wallet row (migration 006) | PK `id`, `punter_id` UNIQUE | No Go reader/writer except `cmd/seed` status count and `seed_backoffice_dashboard.sql` (see Discrepancies) |
| `ledger_entries` **DEAD** | Legacy ledger (migration 006) | PK `id` | Migration 050 calls it "orphaned … zero live code references"; confirmed — only written by `seed_backoffice_dashboard.sql` |

Correlation between `prediction_orders`/`store_purchases` and `wallet_reservations` is **by value**, not FK: the reservation's `(reference_type, reference_id)` matches the order/purchase id as text. `prediction_orders.wallet_reservation_id` is a `UUID` column (014) that cannot type-match `wallet_reservations.id` (`BIGSERIAL`); grep of `internal/prediction` finds no write path that ever sets it to a non-null value — it is read-only dead weight on every scan (`sql_repository.go:2158`).

## Store

Purchasable point packs (`STORE_AND_PAYMENTS.md`). All three tables are goose-owned (unlike the wallet tables) — no app-schema conflicts.

| Table | Purpose | Keys | Owner |
|---|---|---|---|
| `store_point_packs` | Catalogue (price, base/bonus points) | PK `id` TEXT; `price_usd_cents CHECK > 0` | `internal/store/repository.go` |
| `store_purchases` | One checkout attempt, server-resolved amount snapshot | PK `id`; **`UNIQUE(user_id, client_idempotency_key)`** (double-submit protection) | `internal/store/repository.go` |
| `store_payment_events` | Append-only provider webhook/confirm evidence | PK `id` BIGSERIAL; partial unique `provider_event_id` where not null (replay-safe) | `internal/store/repository.go` |

Idempotency keys for the wallet credits: `PurchaseCreditKey(purchaseID) = "store_purchase:"+id`, and `PurchaseBonusCreditKey = PurchaseCreditKey+":bonus"` (`internal/store/types.go`) — feeds the `wallet_ledger` unique key, so a retried fulfillment cannot double-credit.

## Loyalty, leaderboards, rewards

| Table | Purpose | Keys | Owner |
|---|---|---|---|
| `loyalty_accounts` | Current tier + lifetime points (1/user) | PK `user_id`; `tier CHECK 0..5` | `internal/loyalty/predict_repo.go`, `predict_admin_repo.go` |
| `loyalty_ledger` | Append-only accrual history | PK `id`; `event_type` CHECK `accrual,promotion,adjustment,migration`; `idempotency_key` UNIQUE | `internal/loyalty/predict_repo.go` |
| `loyalty_tier_config` | DB-backed tier name/threshold/benefits (021) | PK `tier SMALLINT`; `tier_code` UNIQUE | `internal/loyalty/predict_tier_config_repo.go` — admin-editable, but **Discrepancy:** the live accrual runtime (`PredictTierForPoints`, `PredictAccrualPoints`) still reads Go constants in `internal/loyalty/tiers.go`, not this table; only the settings-page read/write path uses it (migration 021 header is explicit about this gap) |
| `leaderboard_snapshots` | Precomputed rank per `(board_id, user_id, window_start)` | PK is that triple | `internal/leaderboards/predict_repo.go`, `predict_recomputer.go` |

## Content / CMS / banners / bonus

| Table | Purpose | Keys | Owner |
|---|---|---|---|
| `content_pages` | CMS pages | PK `id`; `slug` UNIQUE; `status` CHECK `draft,published,archived` | `internal/content/service.go` |
| `banners` | Homepage/promo banners | PK `id`; `position`, `active` | `internal/content/service.go` |
| `content_blocks` | Structured page blocks | PK `id`; FK `page_id`; `block_type` CHECK 5 values | `internal/content/service.go` |
| `campaigns` | Bonus campaign definitions | PK `id` BIGSERIAL; `campaign_type`/`status` CHECKs; `budget_points`/`spent_points` non-negative CHECKs (042) | `internal/bonus/repository.go` |
| `campaign_rules` | Eligibility/trigger/reward/wagering rules per campaign | PK `id`; `rule_type` CHECK 4 values | `internal/bonus/repository.go` |
| `player_bonuses` | Per-user bonus grant | PK `id`; **`UNIQUE(user_id, campaign_id)`**; `status` CHECK `active,completed,expired,forfeited`; 4 non-negative CHECKs (042) | `internal/wallet/bonus_ops.go`, `internal/bonus/repository.go` |
| `wagering_contributions` | Per-bet contribution toward a bonus's wagering requirement | PK `id`; **`UNIQUE(player_bonus_id, bet_id)`** | `internal/wallet/wagering.go` |

## Social / watchlist / disputes

| Table | Purpose | Keys | Owner |
|---|---|---|---|
| `prediction_market_comments` **(code-owned)** | Market comment thread | PK `id` (app-generated `mc_`+md5); self-FK `parent_id`; `position_disclosure` JSONB snapshot, never rewritten after post (054) | `internal/http/market_social_handlers.go` |
| `prediction_market_comment_reactions` | Like/react | PK `(comment_id, user_id)` | same |
| `prediction_market_comment_reports` | Abuse reports | PK `(comment_id, user_id)`; `status` default `open` | same |
| `prediction_user_follows` | Follow graph | PK `(target_user_id, follower_user_id)` | same |
| `prediction_market_watchlist` **(code-owned)** | Per-user favorites | PK `(user_id, market_id)` | `internal/http/market_watchlist_handlers.go` |
| `prediction_social_write_limits` **(code-owned)** | Shared token-bucket rate limiter across gateway instances | PK `limiter_key` | `internal/http/ratelimit.go` |
| `prediction_resolution_proposals` | See Prediction table above | | `internal/prediction/sql_resolution_store.go` |
| `prediction_disputes` | User dispute against a proposed resolution | PK `id`; `status` CHECK `open,upheld,rejected,withdrawn`; `bond_points`; partial unique index — **at most one OPEN dispute per (market, user)** | `internal/prediction/sql_resolution_store.go` |

## Compliance (KYC, responsible-gambling limits, geo)

All four RG tables are **code-owned** (`internal/compliance/rg_postgres.go` `ensureSchema()`), also defensively created by migration 050's `DO $$ IF EXISTS` guards for the rename.

| Table | Purpose | Keys | Owner |
|---|---|---|---|
| `kyc_status` **(code-owned)** | Current verification state, 1/user | PK `user_id`; `status` CHECK `unverified,pending,approved,declined,blocked` | `internal/compliance/kyc_postgres.go` |
| `kyc_documents` **(code-owned)** | Submitted ID documents | PK `id`; `status` CHECK `submitted,verifying,approved,rejected` | same |
| `player_bet_limits` / `player_deposit_limits` **(code-owned)** | Self-set caps | PK `(user_id, period)`; `period` CHECK `daily,weekly,monthly`; `limit_points CHECK > 0` | `internal/compliance/rg_postgres.go` |
| `player_restrictions` **(code-owned)** | Self-exclusion / cool-off / block | PK `user_id` | same |
| `player_activity_log` **(code-owned)** | Bet/deposit activity used to compute period usage against limits | PK `id` BIGSERIAL | same |

KYC state transitions are enforced in `PostgresKYCService.AdminDecision` (`internal/compliance/kyc_postgres.go:129`) — an admin approve/decline call, not a self-service flow. Deposit/bet limit checks (`CheckBetAllowed`, `CheckDepositAllowed`, `internal/compliance/rg_postgres.go`) sum `player_activity_log` over the period window before allowing an action. The global geo allow/deny gate is code-only (`internal/compliance/geo_gate.go`, `internal/http/pretrade_gate.go`) — no table; per-market overrides live in `prediction_markets.jurisdiction_policy`. `KYC_WITHDRAWAL_THRESHOLD_CENTS` gates the cross-rail cash withdrawal total (see Units) — the only place compliance state touches real cash cents rather than Points.

## Auth (separate service)

`auth/` is a **separate Go service** with its own DSN (`AUTH_DB_DSN`) and its own code-bootstrapped tables — not goose-migrated, no migrations directory exists under `auth/`.

| Table | Purpose | Keys |
|---|---|---|
| `auth_users` | Login identity: username/email + password hash, `role`, ToS/launch-disclosure acceptance, optional `oauth_provider`/`oauth_subject` | PK `id`; `username` UNIQUE; `email` unique among non-null rows (ISSUE-023) |
| `auth_identities` | OAuth-linked identities, keyed by `(provider, subject)` **not** email, so two providers asserting the same email only merge when the email is provider-verified | PK `id`; FK `user_id→auth_users`; **`UNIQUE(provider, subject)`** |
| `auth_mfa_totp` | Two-factor (TOTP) enrollment per account: `secret_ciphertext` (AES-256-GCM under `AUTH_MFA_ENCRYPTION_KEY`, bound to the row's identity), `activated_at` (NULL while setup waits for its first code), `last_used_step` (codes are single use) | PK `(directory, account_id)`; `directory` is `auth_users` or `admin_users`, so staff and player ids can't collide; no FK (it spans both directories) |
| `auth_mfa_challenges` | The 5-minute sign-in challenge between the password and the code: SHA-256 digest of the challenge token, the account, the typed login name (the lockout key), whether it enrolls, wrong-code `attempts` (5 ends it) | PK `token_digest`; expired rows are deleted when a new challenge is written |

Both two-factor tables are created by `auth/internal/http/mfa.go` `ensureMFASchema` (added 2026-09-29). `auth mfa-reset` also reads `admin_users`, so it expects the auth DSN to reach the gateway's schema, as it does on the demo.

`auth_users.id`/`username` line up with `punters.id`/`email` and `admin_users.email` **by convention only** — there is no FK across the two databases/schemas. Back-office RBAC enforcement binds a validated auth session to an `admin_users` row **by email** (`027_rbac_admin.sql` header).

## RBAC / admin / audit

| Table | Purpose | Keys | Owner |
|---|---|---|---|
| `admin_users` | Back-office staff directory (distinct from `punters` and from `auth_users`) | PK `id` UUID; `email` UNIQUE; `status` CHECK `active,suspended` | `internal/rbac/sql_repository.go` |
| `roles` | 3 seeded system roles: `super-admin`, `operations-manager`, `customer-support` | PK `id` TEXT slug | `internal/rbac/sql_repository.go` |
| `permissions` | Permission keys, e.g. `users:read` | PK `id` TEXT | migrations 027/030/038/040/041 seed; not app-writable beyond seed |
| `user_roles` / `role_permissions` | M:N join tables | composite PKs | `internal/rbac/sql_repository.go` |
| `audit_logs` | Generic admin action audit (migration 009) | PK `id`; GIN index on `details` | `internal/prediction/sql_admin_repository.go` |
| `provider_ops_audit_log` **(code-owned + migration 036)** | Append-only, DB-trigger-enforced (no UPDATE/DELETE/TRUNCATE by any role) | PK `id` | `internal/http/provider_ops_audit_store.go` |
| `user_notes` | Admin CRM notes on a punter | PK `id`; FK `punter_id` | `internal/prediction/sql_admin_repository.go` |

Full current permission set (accumulated across 027, 030, 038, 040, 041): `users:read/write`, `roles:read/write`, `markets:read/edit`, `settlements:resolve`, `finances:view/write`, `cashier:read/write/broadcast`, `partners:read/write`, `compliance:write`. `cashier:broadcast` was split from `cashier:write` in 041 specifically so approval and on-chain broadcast of a withdrawal can be forced onto different operators (separation of duties). No `admin_users` row or role assignment is ever seeded by a migration — production provisions its first super-admin with `gateway rbac-bootstrap` (`cmd/gateway/rbac_bootstrap.go`, reads `RBAC_BOOTSTRAP_EMAIL`/`_PASSWORD`); dev gets bootstrap staff from `cmd/seed`.

## Notifications

| Table | Purpose | Keys | Owner |
|---|---|---|---|
| `user_notifications` | Per-user inbox (settlement/void notices today) | PK `id` BIGSERIAL; `read_at` nullable | `internal/http/notification_handlers.go` |

## Webhooks

| Table | Purpose | Keys | Owner |
|---|---|---|---|
| `webhook_endpoints` | Partner receiver registration | PK `id`; FK `user_id→punters` | `internal/webhooks/store.go` |
| `webhook_deliveries` | Durable delivery outbox with backoff | PK `id` (== `X-TNA-Delivery-Id`); `status` CHECK `pending,delivered,failed`; FK `endpoint_id` | `internal/webhooks/store.go` |

Known event types (`internal/webhooks/types.go`): `order.filled`, `market.settled`, `market.voided`, `withdrawal.status`. v1 subscription model is "by event type" (firehose); per-tenant scoping deferred to the tenancy epic.

## Discover / imports / covers

Internal catalog tables — never exposed by id in any public API; the public shape is always re-served under Tap Trade's own UUIDs once `internal/discover/promote.go` copies a row into `prediction_events`/`prediction_markets`.

| Table | Purpose | Keys | Owner |
|---|---|---|---|
| `imported_markets` | Normalized external-feed market, keyed by hash not source name | PK `id`; `external_hash` UNIQUE (SHA-256, not a readable source string) | `internal/discover/repository.go`, `promote.go`, `image_rehost.go` |
| `imported_market_price_snapshots` | Hourly external price/volume/liquidity history | PK `id`; FK `imported_market_id` | `internal/discover/repository.go` |
| `discover_cursors` | Resume position per `(source, listing)` for deep upstream pagination | PK `(source, listing)` | `internal/discover/repository.go` |
| `cover_lookups` | Cache of cover-image resolution attempts, hit or miss | PK `lookup_key` | `internal/discover/repository.go`, `covers.go` |

`imported_markets.image_origin` records provenance (`upstream|entity|topic|tile|manual`); `manual` is a back-office choice the sync never overwrites (060). Migrations 052/053 are data repairs for a 100× volume/liquidity scaling bug in the promote path — see Discrepancies.

## Tenant

| Table | Purpose | Keys |
|---|---|---|
| `tenants` | Tenant directory, ADR-0005 multi-tenancy foundation | PK `id` TEXT slug; seeded with `hula` |

**Dormant** (Complete schema, zero runtime reads). `tenant_id` was added to `punters`, `prediction_markets`, `prediction_orders`, `prediction_positions`, `prediction_payouts` (037) and to `wallet_balances` (code, since that table doesn't exist when 037 runs on a fresh DB), always `DEFAULT 'hula'`. Grep of `internal/` and `cmd/` for `tenants` (the table) returns **zero** Go matches — nothing scopes a query by tenant yet; the migration's own header calls this "deliberately additive and dormant."

## Alpha cashier

Closed-alpha custodial USDC cashier (migration 030, hardened by 065). All amounts genuinely cash: `amount_cents` (USD-cents) paired with `amount_units NUMERIC(78,0)` (raw on-chain base units at the token's actual decimals).

| Table | Purpose | Keys | Owner |
|---|---|---|---|
| `alpha_wallet_challenges` | Sign-in-with-wallet nonce | PK `nonce` | `internal/alphacashier/sql_repository.go` |
| `alpha_wallet_connections` | Verified MetaMask ownership | PK `id`; **`UNIQUE(user_id, chain_id, normalized_address)`** | same |
| `alpha_deposit_intents` | Deposit request → credited wallet ledger entry | PK `id`; **`UNIQUE(user_id, idempotency_key)`**; partial unique `(chain_id, tx_hash)` where not null | same |
| `alpha_chain_transactions` | On-chain evidence log | PK `id`; **`UNIQUE(chain_id, tx_hash, log_index)`** | same |
| `alpha_withdrawal_requests` | Manual-review-only withdrawal | PK `id`; **`UNIQUE(user_id, idempotency_key)`** | same; cross-rail sum read by `internal/payments/db_service.go` |
| `alpha_cashier_audit_events` | Append-only, DB-trigger-enforced (036) | PK `id` | same |
| `alpha_cashier_scan_cursors` **(065)** | Deposit-scanner resume position per scanner name | PK `name` | `internal/alphacashier/deposit_scanner.go` |

Everything here is inert unless `ALPHA_CASHIER_ENABLED` (and, for the scanner, `ALPHA_CASHIER_DEPOSIT_SCANNER_ENABLED`) is set — neither is set on the demo, and `gateway/internal/http/demo_money_flags_test.go` fails CI if either appears in the demo compose file or deploy workflow.

## Legacy payments (dead sportsbook schema + fiat rail)

- Migrations 001–013 built a full sportsbook schema (`sports`, `tournaments`, `fixtures`, `markets`, `selections`, `bets`, `bet_legs`, `freebets`, `odds_boosts`, `match_timelines`, `incidents`). `033_drop_dead_sportsbook_tables.sql` dropped all eleven after verifying zero Go references. **Do not treat 001–013 as current schema** — read from 014 onward.
- `payment_transactions` **(code-owned, `internal/payments/db_service.go`)** — the surviving fiat/legacy-crypto rail. PK `id`; `txn_id`/`idempotency_key` UNIQUE; `txn_type` CHECK `deposit,withdrawal`; `amount_cents CHECK > 0` — genuinely cash. Feeds `CrossRailWithdrawnCents` alongside `alpha_withdrawal_requests` for the KYC gate.
- `internal/payments/crypto_rail.go` (created `crypto_deposit_addresses`) and the rest of `internal/cashier` were **removed** on 2026-09-29 (`185c982f`, `4924a670`); `CRYPTO_*` env vars still refuse to boot in prod/staging.

## Market/event lifecycle state machines

Both enforced in `gateway/internal/prediction/lifecycle.go`.

**Market** (`validTransitions`):
```
unopened → open | voided
open     → halted | closed | voided
halted   → open | closed | voided
closed   → proposed_resolution | settled | voided
proposed_resolution → settled | disputed | voided
disputed → settled | voided
settled, voided — terminal, no transitions out
```
`CanTransition(from, to)` gates every admin lifecycle action; `IsTradeable` is true only for `open`; `IsTerminal` is `settled`/`voided`.

**Event** (`validEventTransitions`):
```
draft → open | voided
open  → trading_halt | closed | voided
trading_halt → open | closed | voided
closed → settling | voided
settling → settled | voided
settled, voided — terminal
```

**Resolution / dispute** (`internal/prediction/sql_resolution_store.go`): a market moves `closed → proposed_resolution` when `prediction_resolution_proposals` gets a row (`status='proposed'`, `challenge_ends_at` starts the window). If nobody disputes before the window closes, `MarkProposalFinalized` flips it to `finalized` and the market becomes `settled` — payouts credit **only at finalize**, never at propose, so there is no clawback path (ADR-0003/0004). A dispute (`prediction_disputes`, `status: open → upheld|rejected|withdrawn`) moves the market to `disputed`; an admin then finalizes or voids.

**Orders** (`prediction_orders.status`): `pending → open → partial → filled`, or `→ cancelled/expired/rejected` (rejected added in 019 for self-match/notional-cap failures). Reservation-side states live separately on `wallet_reservations.status`: `held → captured → (released|expired)`.

**Store purchase** (`internal/store/types.go` `CanTransition`): `pending_payment → completed | failed | canceled`; only `pending_payment` rows transition, and only into a terminal state — a completed purchase can never be un-completed.

**KYC** (`kyc_status.status`): `unverified → pending → approved | declined`, or `→ blocked` (admin-only, `kyc_postgres.go` `AdminDecision`).

**Alpha cashier deposit intent** (`internal/alphacashier/service.go`): `created → submitted → confirmed → credited`, or `→ expired | failed | quarantined` at any point before `credited`. Finality bookkeeping added in 065: a `credited` deposit gets `finalized_at` once chain-deep enough; `reorg_detected_at` records if its backing tx ever left the canonical chain.

**Alpha cashier withdrawal request**: `requested → under_review → approved → broadcasted → completed`, or `→ rejected | failed | cancelled`. Broadcast requires the separate `cashier:broadcast` permission (041) so approver ≠ broadcaster can be enforced by role assignment.

## Idempotency keys (exactly-once)

| Mechanism | Column(s) | Scope |
|---|---|---|
| Wallet ledger | `wallet_ledger.(entry_type, user_id, idempotency_key)` UNIQUE | any credit/debit; callers build keys like `store_purchase:<id>`, `store_purchase:<id>:bonus` |
| Wallet reservation | `wallet_reservations.(reference_type, reference_id)` UNIQUE | one hold per order/purchase; `Capture`/`Release` are idempotent against `status` |
| Order client id | `prediction_orders.(user_id, client_order_id)` partial UNIQUE where not null | bot/partner-submitted orders |
| Order idempotency | `prediction_orders.idempotency_key` UNIQUE | direct order submission |
| Store purchase | `store_purchases.(user_id, client_idempotency_key)` UNIQUE | checkout double-submit |
| Store payment event | `store_payment_events.provider_event_id` partial UNIQUE where not null | provider webhook replay |
| Alpha deposit intent | `alpha_deposit_intents.(user_id, idempotency_key)` UNIQUE; also `(chain_id, tx_hash)` partial UNIQUE | client-submitted intent + on-chain dedupe |
| Alpha chain tx | `alpha_chain_transactions.(chain_id, tx_hash, log_index)` UNIQUE | scanner/watcher replay safety |
| Alpha withdrawal | `alpha_withdrawal_requests.(user_id, idempotency_key)` UNIQUE | withdrawal submission |
| Loyalty ledger | `loyalty_ledger.idempotency_key` UNIQUE | accrual events |
| Settlement payout | `prediction_payouts.(settlement_id, position_id)` UNIQUE | resumable batched settlement (034) |
| API key lookup | `prediction_api_keys.key_prefix` UNIQUE (043) | prevents bcrypt-compare against the wrong row on prefix collision |

## Seed data

`gateway/seed-data/` has three scripts, run by `gateway/cmd/seed` (no `seed.sql` in the migrations directory itself):

| File | Applied by | Contents |
|---|---|---|
| `seed_prediction.sql` | `-mode base` (default) and `-mode demo` | Test users (`user-001..003`, `user-bot`), taxonomy, series/events/markets with **deterministic `md5(slug)::uuid` ids** so re-running maps the same slug to the same row (e.g. `md5('series-mlbb-esports')::uuid`). Idempotent via `ON CONFLICT`; deletes and re-inserts a fixed set of legacy asset-price rows first. |
| `seed.sql` | not wired into `cmd/seed`'s default path (legacy) | — not read by `main.go`'s `findSeedFile()` candidates list |
| `seed_backoffice_dashboard.sql` | run manually (`psql -f`) | 24 synthetic users, 30 `payment_transactions`, 45 `prediction_trades` — 75 primary activity rows, idempotent via a `bo-seed-*` key prefix + delete-then-reinsert. Uses `CREATE TEMP TABLE bo_seed_users`/`bo_seed_market_specs` (dropped on commit, not persisted). **As of today** it no longer references `crypto_deposit_addresses` (that table's creator, `internal/payments/crypto_rail.go`, was deleted 2026-09-29) — but it still writes into the dead `wallets`/`ledger_entries` tables (see Discrepancies). |

`cmd/seed -mode demo` layers six phases on top of the base seed (`RunPhase1MarketMaker` books an order-book market maker, `RunPhase2Volume` generates historical trade volume, `RunPhase4DemoUser` places 12 BUY orders for the demo user, `RunPhase5Settle`/`RunPhase5BonusDemo`/`RunPhase5Leaderboards`/`RunPhase5RewardHistory` settle markets and backfill bonus/leaderboard/reward state, `RunPhase6Backoffice` writes the dashboard rows). `-mode wipe` removes only rows tagged with a `demo:` idempotency-key prefix or `trade_kind='demo_history'`, leaving the base seed untouched (`cmd/seed/cleanup.go`).

## Node cashier-api — dormant, separate schema

`services/cashier-api/` is a **separate Node service with its own Postgres schema** (`services/cashier-api/migrations/001_cashier_core.sql`, 12 tables: `cashier_wallets`, `deposit_intents`, `bridge_events`, `withdrawal_intents`, `relayer_submissions`, `compliance_decisions`, `recovery_cases`, `cashier_audit_events`, `cashier_runtime_flags`, `recovery_approvals`, `reconciliation_reports`, `reconciliation_items`). `SCHEMA.md` itself is marked **SUPERSEDED 2026-09-06 — abandoned workstream**: "not a running service and this document describes nothing that exists." The product moved to non-redeemable Points; the gateway's own cashier/crypto/payment routes are unmounted by default and refuse to boot in production or staging. This schema shares no tables, no FK, and no runtime path with anything above — it is included here only so it is not mistaken for a second copy of the alpha-cashier tables.

## Discrepancies found

- **`gateway/migrations/README.md`** said the directory ran through `056`; it ran through `065`. Corrected in this review (now `066`).
- **`wallets` / `ledger_entries` ownership contradiction across migrations.** `033_drop_dead_sportsbook_tables.sql` explicitly keeps these two "because [they're] still referenced by live prediction code." `050_points_unit_model.sql`, written five migrations later, calls `ledger_entries` "orphaned legacy table (zero live code references)." A grep of `internal/` and `cmd/` for `ledger_entries` and for `wallets` (excluding `wallet_*`) confirms **050 is the accurate read as of today**: no Go code selects, inserts, or updates either table except `cmd/seed/main.go`'s summary `SELECT COUNT(*) FROM wallets` and `seed-data/seed_backoffice_dashboard.sql`'s writes into both. The live wallet system is entirely `wallet_balances`/`wallet_ledger`/`wallet_reservations` (code-owned, `internal/wallet/service.go`).
- **`prediction_orders.wallet_reservation_id` is a dead/mistyped column** ([TD-031](TECH_DEBT.md#e-ledger-data-model-and-tenancy)). Declared `UUID` in migration 014; `wallet_reservations.id` is `BIGSERIAL`, so it can never hold a real FK match. No write path in `internal/prediction` ever sets it to a non-null value (only a read/scan at `sql_repository.go:2158`); actual order↔reservation correlation goes through `wallet_reservations.(reference_type, reference_id)` matched by value against the order id as text.
- **TS field naming drifts from DB column names** in `api-client/src/prediction-types.ts`: `Market.settlementPoolPoints` (line ~133) corresponds to DB column `settled_payout_pool_points`; `Position.realizedPoints` corresponds to `realized_pnl_points`. Both appear to be intentional API-shape renames rather than bugs, but they are not 1:1 with the column names, so do not assume the wire field name is the column name when tracing a bug.
- **`loyalty_tier_config` (021) is admin-editable but not yet load-bearing at runtime** ([TD-004](TECH_DEBT.md#a-admin-controls-and-points-integrity)). The settings page reads/writes it; the actual points-accrual formula and tier-from-balance mapping still read Go constants in `internal/loyalty/tiers.go` (migration 021's own header flags this as a known follow-up, not yet done).
- **`imported_markets` volume/liquidity 100× scaling bug**, fixed by two follow-up data-repair migrations (052, then 053 for catalog-drift escapees) — evidence this class of promote-path bug has recurred at least once; worth a regression test if none exists yet (not verified either way here).
- **Back-office dashboard seed writes to dead tables.** `seed_backoffice_dashboard.sql` inserts into `wallets` and `ledger_entries` (see above) even though no runtime code reads them — likely vestigial from before the wallet service moved to `wallet_balances`/`wallet_ledger`. It correctly stopped inserting into `crypto_deposit_addresses` today, after `internal/payments/crypto_rail.go` (the table's only creator) was deleted; no migration ever created that table, so a stale seed script would have failed outright on a fresh DB.
- **Two identity tables named similarly, no FK between them:** `admin_users` (gateway RBAC, back office) and `auth_users` (separate `auth` service). Enforcement binds them by matching email only (`027_rbac_admin.sql` header); a renamed or duplicated email on either side silently breaks the binding with no DB constraint to catch it.
- **`tenants` / `tenant_id` is schema-complete but functionally dormant** ([ADR-0005](adr/0005-multi-tenancy-foundation.md), [TD-030](TECH_DEBT.md#e-ledger-data-model-and-tenancy)) — confirmed zero Go references to the `tenants` table itself; the `tenant_id` columns are populated (`DEFAULT 'hula'`) but nothing filters by them yet.

## Open questions

- **Open question:** whether `seed.sql` (as opposed to `seed_prediction.sql`) is still meant to be run by anything — it exists in `seed-data/` but is not in `cmd/seed/main.go`'s `findSeedFile()` candidate list. Resolving this needs either a grep for any remaining caller (`Makefile`, CI, docs) or removal.
- **Open question:** whether the `imported_markets` 100×-scaling class of bug (052/053) is now covered by a regression test — not checked here; would need a look at `internal/discover` and `internal/prediction` test files for a promote-path scale assertion.
