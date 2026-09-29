-- Back-office dashboard synthetic activity seed.
--
-- Idempotent by design: all rows created by this script use the bo-seed-* prefix
-- or deterministic UUIDs derived from bo-seed-* keys, then those rows are removed
-- before reseeding. Run from the gateway service directory with:
--
--   psql "$DATABASE_URL" -f seed-data/seed_backoffice_dashboard.sql
--
-- The script creates 24 standard users and exactly 75 primary activity records:
-- 30 payment transactions and 45 prediction-market trades.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TEMP TABLE bo_seed_users (
  seq integer PRIMARY KEY,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  status text NOT NULL,
  country_code text NOT NULL
) ON COMMIT DROP;

INSERT INTO bo_seed_users (seq, first_name, last_name, email, status, country_code) VALUES
  (1, 'Maya', 'Kapoor', 'maya.kapoor@example.test', 'active', 'US'),
  (2, 'Ethan', 'Brooks', 'ethan.brooks@example.test', 'active', 'US'),
  (3, 'Sofia', 'Martinez', 'sofia.martinez@example.test', 'flagged', 'US'),
  (4, 'Noah', 'Chen', 'noah.chen@example.test', 'active', 'CA'),
  (5, 'Ava', 'Patel', 'ava.patel@example.test', 'suspended', 'GB'),
  (6, 'Liam', 'O''Connor', 'liam.oconnor@example.test', 'active', 'IE'),
  (7, 'Isabella', 'Romano', 'isabella.romano@example.test', 'active', 'IT'),
  (8, 'Lucas', 'Nguyen', 'lucas.nguyen@example.test', 'flagged', 'US'),
  (9, 'Amelia', 'Hughes', 'amelia.hughes@example.test', 'active', 'GB'),
  (10, 'Mateo', 'Rivera', 'mateo.rivera@example.test', 'active', 'US'),
  (11, 'Olivia', 'Nakamura', 'olivia.nakamura@example.test', 'active', 'JP'),
  (12, 'James', 'Walker', 'james.walker@example.test', 'suspended', 'AU'),
  (13, 'Mia', 'Andersson', 'mia.andersson@example.test', 'active', 'SE'),
  (14, 'Benjamin', 'Kowalski', 'ben.kowalski@example.test', 'flagged', 'PL'),
  (15, 'Charlotte', 'Dubois', 'charlotte.dubois@example.test', 'active', 'FR'),
  (16, 'Henry', 'Adams', 'henry.adams@example.test', 'active', 'US'),
  (17, 'Ella', 'Wilson', 'ella.wilson@example.test', 'active', 'NZ'),
  (18, 'Daniel', 'Singh', 'daniel.singh@example.test', 'suspended', 'CA'),
  (19, 'Grace', 'Kim', 'grace.kim@example.test', 'active', 'KR'),
  (20, 'Leo', 'Mendes', 'leo.mendes@example.test', 'active', 'BR'),
  (21, 'Nora', 'Schmidt', 'nora.schmidt@example.test', 'flagged', 'DE'),
  (22, 'Caleb', 'Johnson', 'caleb.johnson@example.test', 'active', 'US'),
  (23, 'Zara', 'Ali', 'zara.ali@example.test', 'active', 'AE'),
  (24, 'Owen', 'Murphy', 'owen.murphy@example.test', 'active', 'IE');

CREATE TEMP TABLE bo_seed_market_specs (
  seq integer PRIMARY KEY,
  category_slug text NOT NULL,
  ticker text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  yes_price_points integer NOT NULL
) ON COMMIT DROP;

INSERT INTO bo_seed_market_specs (seq, category_slug, ticker, title, description, yes_price_points) VALUES
  (1, 'crypto', 'BO-BTC-100K-Q4', 'Will Bitcoin hit $100k by Q4?', 'Resolves Yes if a reputable USD spot index records Bitcoin at or above $100,000 before the end of Q4.', 46),
  (2, 'sports', 'BO-OKC-SAS-G4', 'OKC Thunder vs San Antonio Spurs Game 4', 'Resolves Yes if Oklahoma City wins Game 4 against San Antonio.', 57),
  (3, 'crypto', 'BO-POLY-VOL-1B', 'Will Polymarket volume exceed $1B this month?', 'Resolves Yes if Polymarket reported monthly trading volume exceeds one billion US dollars.', 44),
  (4, 'crypto', 'BO-ETH-5000-ME', 'Will Ethereum close above $5,000 by month-end?', 'Resolves Yes if ETH/USD closes above $5,000 on a major spot exchange by month-end.', 38),
  (5, 'economics', 'BO-FED-CUT-NEXT', 'Will the Fed cut rates at the next meeting?', 'Resolves Yes if the Federal Reserve lowers the target range at its next scheduled FOMC decision.', 51),
  (6, 'tech', 'BO-OPENAI-GPT55-JUL', 'Will OpenAI announce GPT-5.5 before July?', 'Resolves Yes if OpenAI publicly announces a GPT-5.5 model before July 1.', 29),
  (7, 'tech', 'BO-NVDA-1200-QE', 'Will Nvidia close above $1,200 by quarter end?', 'Resolves Yes if Nvidia common stock closes above $1,200 on the final trading day of the quarter.', 34),
  (8, 'sports', 'BO-UCL-MADRID-FINAL', 'Will Real Madrid win the Champions League final?', 'Resolves Yes if Real Madrid is declared the winner of the Champions League final.', 55),
  (9, 'entertainment', 'BO-SWIFT-TOUR-AUG', 'Will Taylor Swift announce a new tour before August?', 'Resolves Yes if Taylor Swift or her official representatives announce a new concert tour before August 1.', 41),
  (10, 'crypto', 'BO-SOL-300-QTR', 'Will Solana trade above $300 this quarter?', 'Resolves Yes if SOL/USD trades above $300 on a major spot exchange before quarter end.', 36);

CREATE TEMP TABLE bo_seed_payment_activity AS
SELECT
  n,
  format('bo-seed-user-%s', lpad((((n - 1) % 24) + 1)::text, 2, '0')) AS user_id,
  CASE WHEN n IN (4, 9, 15, 21, 27, 30) THEN 'withdrawal' ELSE 'deposit' END AS txn_type,
  CASE
    WHEN n IN (6, 9, 13, 20, 27) THEN 'failed'
    WHEN n IN (3, 11, 15, 18, 24, 30) THEN 'pending'
    ELSE 'completed'
  END AS status,
  (ARRAY[1000, 2500, 5000, 7500, 12000, 18000, 25000, 37500, 50000, 75000, 100000, 150000, 225000, 350000, 500000])[((n - 1) % 15) + 1] AS amount_points,
  date_trunc('minute', now() - interval '30 days' + (n - 1) * interval '9 hours 36 minutes') AS created_at
FROM generate_series(1, 30) AS n;

CREATE TEMP TABLE bo_seed_trade_activity AS
SELECT
  n,
  format('bo-seed-user-%s', lpad((((n + 4) % 24) + 1)::text, 2, '0')) AS actor_user_id,
  format('bo-seed-user-%s', lpad((((n + 11) % 24) + 1)::text, 2, '0')) AS counterparty_user_id,
  (SELECT ticker FROM bo_seed_market_specs WHERE seq = (((n - 1) % 10) + 1)) AS market_ticker,
  CASE WHEN n % 2 = 0 THEN 'sell' ELSE 'buy' END AS action,
  CASE WHEN n % 3 = 0 THEN 'no' ELSE 'yes' END AS side,
  (28 + ((n * 7) % 56))::integer AS price_points,
  (3 + ((n * 11) % 118))::integer AS quantity,
  date_trunc('minute', now() - interval '30 days' + (30 * interval '9 hours 36 minutes') + (n - 1) * interval '9 hours 36 minutes') AS created_at
FROM generate_series(1, 45) AS n;

-- Remove prior rows from this seed while respecting foreign-key dependencies.
DELETE FROM loyalty_ledger
WHERE user_id LIKE 'bo-seed-user-%'
   OR market_id IN (SELECT md5('bo-seed-market-' || ticker)::uuid FROM bo_seed_market_specs)
   OR trade_id IN (
      SELECT id FROM prediction_trades
      WHERE buyer_id LIKE 'bo-seed-user-%' OR seller_id LIKE 'bo-seed-user-%'
   );

DELETE FROM prediction_collateral_ledger
WHERE user_id LIKE 'bo-seed-user-%'
   OR market_id IN (SELECT md5('bo-seed-market-' || ticker)::uuid FROM bo_seed_market_specs)
   OR trade_id IN (
      SELECT id FROM prediction_trades
      WHERE buyer_id LIKE 'bo-seed-user-%' OR seller_id LIKE 'bo-seed-user-%'
   )
   OR order_id IN (
      SELECT id FROM prediction_orders
      WHERE user_id LIKE 'bo-seed-user-%'
   );

DELETE FROM prediction_payouts
WHERE user_id LIKE 'bo-seed-user-%'
   OR market_id IN (SELECT md5('bo-seed-market-' || ticker)::uuid FROM bo_seed_market_specs);

DELETE FROM prediction_settlements
WHERE market_id IN (SELECT md5('bo-seed-market-' || ticker)::uuid FROM bo_seed_market_specs);

DELETE FROM prediction_resolution_proposals
WHERE market_id IN (SELECT md5('bo-seed-market-' || ticker)::uuid FROM bo_seed_market_specs);

DELETE FROM prediction_disputes
WHERE market_id IN (SELECT md5('bo-seed-market-' || ticker)::uuid FROM bo_seed_market_specs);

DELETE FROM prediction_positions
WHERE user_id LIKE 'bo-seed-user-%'
   OR market_id IN (SELECT md5('bo-seed-market-' || ticker)::uuid FROM bo_seed_market_specs);

DELETE FROM prediction_lifecycle_events
WHERE market_id IN (SELECT md5('bo-seed-market-' || ticker)::uuid FROM bo_seed_market_specs);

DELETE FROM prediction_trades
WHERE buyer_id LIKE 'bo-seed-user-%'
   OR seller_id LIKE 'bo-seed-user-%'
   OR market_id IN (SELECT md5('bo-seed-market-' || ticker)::uuid FROM bo_seed_market_specs);

DELETE FROM prediction_orders
WHERE user_id LIKE 'bo-seed-user-%'
   OR market_id IN (SELECT md5('bo-seed-market-' || ticker)::uuid FROM bo_seed_market_specs);

DELETE FROM prediction_markets
WHERE ticker IN (SELECT ticker FROM bo_seed_market_specs);

DELETE FROM prediction_events
WHERE id IN (SELECT md5('bo-seed-event-' || ticker)::uuid FROM bo_seed_market_specs);

DELETE FROM prediction_series
WHERE slug = 'backoffice-synthetic-activity';

DELETE FROM payment_transactions
WHERE user_id LIKE 'bo-seed-user-%' OR txn_id LIKE 'bo-seed-%';

DELETE FROM wallet_ledger
WHERE user_id LIKE 'bo-seed-user-%' OR idempotency_key LIKE 'bo-seed:%';

DELETE FROM wallet_balances
WHERE user_id LIKE 'bo-seed-user-%';

DELETE FROM punters
WHERE id LIKE 'bo-seed-user-%' OR email LIKE '%@example.test';

-- Ensure the dashboard markets have category dependencies even on a fresh DB.
INSERT INTO prediction_categories (id, slug, name, icon, sort_order, active, created_at, updated_at)
VALUES
  (md5('bo-seed-category-politics')::uuid, 'politics', 'Politics', 'landmark', 10, true, now(), now()),
  (md5('bo-seed-category-crypto')::uuid, 'crypto', 'Crypto', 'bitcoin', 20, true, now(), now()),
  (md5('bo-seed-category-sports')::uuid, 'sports', 'Sports', 'trophy', 30, true, now(), now()),
  (md5('bo-seed-category-entertainment')::uuid, 'entertainment', 'Entertainment', 'sparkles', 40, true, now(), now()),
  (md5('bo-seed-category-tech')::uuid, 'tech', 'Technology', 'cpu', 50, true, now(), now()),
  (md5('bo-seed-category-economics')::uuid, 'economics', 'Economics', 'chart-line', 60, true, now(), now()),
  (md5('bo-seed-category-general')::uuid, 'general', 'General', 'circle-help', 70, true, now(), now())
ON CONFLICT (slug) DO NOTHING;

INSERT INTO punters (
  id,
  email,
  username,
  password_hash,
  status,
  country_code,
  created_at,
  last_login_at,
  updated_at,
  display_anonymous
)
SELECT
  format('bo-seed-user-%s', lpad(seq::text, 2, '0')),
  email,
  lower(regexp_replace(first_name || '.' || last_name, '[^a-zA-Z0-9.]+', '', 'g')),
  'synthetic-seed-only',
  status,
  country_code,
  date_trunc('minute', now() - interval '30 days' + (seq - 1) * interval '30 hours'),
  CASE
    WHEN status = 'active' THEN date_trunc('minute', now() - ((seq % 9) + 1) * interval '7 hours')
    ELSE NULL
  END,
  now(),
  false
FROM bo_seed_users;


INSERT INTO prediction_series (
  id,
  slug,
  title,
  description,
  category_id,
  frequency,
  tags,
  active,
  created_at,
  updated_at
)
SELECT
  md5('bo-seed-series-backoffice-synthetic-activity')::uuid,
  'backoffice-synthetic-activity',
  'Back-office Synthetic Activity',
  'Synthetic markets used to exercise moderation, activity, and transaction dashboards.',
  (SELECT id FROM prediction_categories WHERE slug = 'general'),
  'adhoc',
  ARRAY['synthetic', 'backoffice', 'qa'],
  true,
  now() - interval '30 days',
  now()
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  updated_at = EXCLUDED.updated_at;

INSERT INTO prediction_events (
  id,
  series_id,
  title,
  description,
  category_id,
  status,
  featured,
  open_at,
  close_at,
  settle_at,
  metadata,
  created_by,
  created_at,
  updated_at,
  is_synthetic
)
SELECT
  md5('bo-seed-event-' || specs.ticker)::uuid,
  md5('bo-seed-series-backoffice-synthetic-activity')::uuid,
  specs.title,
  specs.description,
  categories.id,
  'open',
  specs.seq IN (1, 2, 3),
  now() - interval '30 days',
  now() + ((specs.seq + 10) * interval '3 days'),
  now() + ((specs.seq + 12) * interval '3 days'),
  jsonb_build_object('seed', 'backoffice-dashboard', 'category', specs.category_slug),
  'bo-seed',
  now() - interval '30 days',
  now(),
  true
FROM bo_seed_market_specs specs
JOIN prediction_categories categories ON categories.slug = specs.category_slug;

INSERT INTO prediction_markets (
  id,
  event_id,
  ticker,
  title,
  description,
  status,
  yes_price_points,
  no_price_points,
  last_trade_price_points,
  volume_points,
  open_interest_points,
  liquidity_points,
  amm_yes_shares,
  amm_no_shares,
  amm_liquidity_param,
  amm_subsidy_points,
  settlement_source_key,
  settlement_cutoff_at,
  settlement_rule,
  settlement_params,
  fee_rate_bps,
  maker_rebate_bps,
  open_at,
  close_at,
  created_at,
  updated_at,
  execution_mode,
  collateral_pool_points,
  best_yes_bid_points,
  best_yes_ask_points,
  best_no_bid_points,
  best_no_ask_points,
  last_quote_at
)
SELECT
  md5('bo-seed-market-' || ticker)::uuid,
  md5('bo-seed-event-' || ticker)::uuid,
  ticker,
  title,
  description,
  'open',
  yes_price_points,
  100 - yes_price_points,
  yes_price_points,
  0,
  0,
  250000 + (seq * 50000),
  5000 + (seq * 125),
  5000 + (seq * 125),
  100,
  100000,
  'manual_review',
  now() + ((seq + 10) * interval '3 days'),
  'Resolves according to the plain-English rule in the market description using reputable public sources.',
  jsonb_build_object('seed', 'backoffice-dashboard', 'resolutionWindowDays', 2),
  150,
  25,
  now() - interval '30 days',
  now() + ((seq + 10) * interval '3 days'),
  now() - interval '30 days',
  now(),
  'order_book',
  0,
  GREATEST(1, yes_price_points - 2),
  LEAST(99, yes_price_points + 2),
  GREATEST(1, (100 - yes_price_points) - 2),
  LEAST(99, (100 - yes_price_points) + 2),
  now() - interval '10 minutes'
FROM bo_seed_market_specs;

INSERT INTO payment_transactions (
  txn_id,
  user_id,
  txn_type,
  amount_points,
  payment_method,
  status,
  confirmation_code,
  error_message,
  idempotency_key,
  created_at,
  updated_at,
  processed_at
)
SELECT
  format('bo-seed-payment-%s', lpad(n::text, 2, '0')),
  user_id,
  txn_type,
  amount_points,
  CASE WHEN txn_type = 'deposit' THEN 'usdc_polygon' ELSE 'usdc_withdrawal' END,
  status,
  CASE WHEN status = 'completed' THEN upper(substr(md5('bo-seed-confirmation-' || n), 1, 10)) ELSE NULL END,
  CASE WHEN status = 'failed' THEN 'Synthetic processor decline for dashboard QA' ELSE NULL END,
  format('bo-seed:payment:%s', lpad(n::text, 2, '0')),
  created_at,
  CASE WHEN status = 'pending' THEN created_at ELSE created_at + interval '18 minutes' END,
  CASE WHEN status = 'completed' THEN created_at + interval '18 minutes' ELSE NULL END
FROM bo_seed_payment_activity;

INSERT INTO wallet_ledger (
  user_id,
  entry_type,
  fund_type,
  amount_points,
  balance_points,
  idempotency_key,
  reason,
  transaction_time
)
SELECT
  user_id,
  CASE WHEN txn_type = 'deposit' THEN 'credit' ELSE 'debit' END,
  'real',
  amount_points,
  100000 + (n * 2500),
  format('bo-seed:wallet-ledger:payment:%s', lpad(n::text, 2, '0')),
  CASE
    WHEN txn_type = 'deposit' THEN 'Synthetic USDC deposit completed'
    ELSE 'Synthetic USDC withdrawal completed'
  END,
  created_at + interval '18 minutes'
FROM bo_seed_payment_activity
WHERE status = 'completed';


INSERT INTO prediction_orders (
  id,
  user_id,
  market_id,
  side,
  action,
  order_type,
  price_points,
  quantity,
  filled_quantity,
  remaining_quantity,
  total_cost_points,
  status,
  idempotency_key,
  expires_at,
  filled_at,
  cancelled_at,
  created_at,
  updated_at,
  time_in_force,
  captured_points,
  average_fill_price_points,
  filled_cost_points,
  client_order_id,
  notional_cap_points
)
SELECT
  md5('bo-seed-order-' || n)::uuid,
  actor_user_id,
  md5('bo-seed-market-' || market_ticker)::uuid,
  side,
  action,
  'market',
  price_points,
  quantity,
  quantity,
  0,
  price_points * quantity,
  'filled',
  format('bo-seed:prediction-order:%s', lpad(n::text, 2, '0')),
  NULL,
  created_at + interval '2 minutes',
  NULL,
  created_at,
  created_at + interval '2 minutes',
  'ioc',
  CASE WHEN action = 'buy' THEN price_points * quantity ELSE 0 END,
  price_points,
  price_points * quantity,
  format('BO-SEED-%s', lpad(n::text, 2, '0')),
  price_points * quantity
FROM bo_seed_trade_activity;

INSERT INTO prediction_trades (
  id,
  market_id,
  buy_order_id,
  sell_order_id,
  buyer_id,
  seller_id,
  side,
  price_points,
  quantity,
  fee_points,
  is_amm_trade,
  traded_at,
  match_id,
  trade_kind,
  engine_kind
)
SELECT
  md5('bo-seed-trade-' || n)::uuid,
  md5('bo-seed-market-' || market_ticker)::uuid,
  CASE WHEN action = 'buy' THEN md5('bo-seed-order-' || n)::uuid ELSE NULL END,
  CASE WHEN action = 'sell' THEN md5('bo-seed-order-' || n)::uuid ELSE NULL END,
  CASE WHEN action = 'buy' THEN actor_user_id ELSE counterparty_user_id END,
  CASE WHEN action = 'sell' THEN actor_user_id ELSE counterparty_user_id END,
  side,
  price_points,
  quantity,
  GREATEST(1, round((price_points * quantity)::numeric * 0.015))::bigint,
  false,
  created_at + interval '2 minutes',
  md5('bo-seed-match-' || n)::uuid,
  'secondary',
  'order_book'
FROM bo_seed_trade_activity;

INSERT INTO wallet_ledger (
  user_id,
  entry_type,
  fund_type,
  amount_points,
  balance_points,
  idempotency_key,
  reason,
  transaction_time
)
SELECT
  actor_user_id,
  CASE WHEN action = 'buy' THEN 'debit' ELSE 'credit' END,
  'real',
  price_points * quantity,
  125000 + (n * 1750),
  format('bo-seed:wallet-ledger:trade:%s', lpad(n::text, 2, '0')),
  format(
    'Synthetic %s %s shares on %s at %s cents',
    action,
    upper(side),
    market_ticker,
    price_points
  ),
  created_at + interval '2 minutes'
FROM bo_seed_trade_activity;


UPDATE prediction_markets markets
SET
  volume_points = COALESCE(activity.volume_points, 0),
  open_interest_points = COALESCE(activity.open_interest_points, 0),
  last_trade_price_points = activity.last_trade_price_points,
  updated_at = now()
FROM (
  SELECT
    market_id,
    SUM(price_points * quantity)::bigint AS volume_points,
    SUM(quantity * 100)::bigint AS open_interest_points,
    (ARRAY_AGG(price_points ORDER BY traded_at DESC))[1] AS last_trade_price_points
  FROM prediction_trades
  WHERE market_id IN (SELECT md5('bo-seed-market-' || ticker)::uuid FROM bo_seed_market_specs)
  GROUP BY market_id
) activity
WHERE markets.id = activity.market_id;

INSERT INTO wallet_balances (user_id, balance_points, bonus_balance_points, updated_at)
SELECT DISTINCT ON (user_id) user_id, balance_points, 0, now()
FROM wallet_ledger
WHERE user_id LIKE 'bo-seed-user-%'
ORDER BY user_id, transaction_time DESC
ON CONFLICT (user_id) DO UPDATE SET
  balance_points = EXCLUDED.balance_points,
  bonus_balance_points = EXCLUDED.bonus_balance_points,
  updated_at = EXCLUDED.updated_at;

COMMIT;

SELECT 'synthetic_users' AS dataset, count(*) AS rows
FROM punters
WHERE id LIKE 'bo-seed-user-%'
UNION ALL
SELECT 'payment_transactions', count(*)
FROM payment_transactions
WHERE txn_id LIKE 'bo-seed-payment-%'
UNION ALL
SELECT 'prediction_trades', count(*)
FROM prediction_trades
WHERE id IN (SELECT md5('bo-seed-trade-' || n)::uuid FROM generate_series(1, 45) AS n)
UNION ALL
SELECT 'dashboard_markets', count(*)
FROM prediction_markets
WHERE ticker LIKE 'BO-%';
