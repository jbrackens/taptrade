-- 065: alpha cashier — finality bookkeeping and the deposit scanner cursor.
--
-- 2026-09-29 audit of the dormant money code (and the port of the
-- feat/hula-na-cashier deposit watcher):
--
-- 1. The reorg watcher re-checked every credited deposit on every tick and
--    listed them in uuid order with a LIMIT, so deposits beyond the first 500
--    were never re-checked while finalized ones were re-checked forever.
--    finalized_at retires a deposit once it is finality-deep; the watcher
--    lists the oldest unfinalized credits first.
-- 2. reorg_detected_at records the first time a credited deposit's backing
--    transaction left the canonical chain, so the escalation (audit event,
--    error log) happens once instead of every five minutes when the freeze
--    cannot be placed.
-- 3. alpha_cashier_scan_cursors stores where the deposit scanner resumes
--    (one row per scanner). The branch's prototype created its tables with
--    CREATE TABLE IF NOT EXISTS on every boot; this is the migration.
--
-- All of this is inert unless ALPHA_CASHIER_ENABLED (and, for the scanner,
-- ALPHA_CASHIER_DEPOSIT_SCANNER_ENABLED) is on — neither is set on the demo.

-- +goose Up
ALTER TABLE alpha_deposit_intents
    ADD COLUMN IF NOT EXISTS finalized_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reorg_detected_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_alpha_deposit_intents_unfinalized
    ON alpha_deposit_intents (credited_at)
    WHERE status = 'credited' AND finalized_at IS NULL;

CREATE TABLE IF NOT EXISTS alpha_cashier_scan_cursors (
    name       TEXT PRIMARY KEY,
    next_block BIGINT NOT NULL CHECK (next_block >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- +goose Down
DROP TABLE IF EXISTS alpha_cashier_scan_cursors;
DROP INDEX IF EXISTS idx_alpha_deposit_intents_unfinalized;
ALTER TABLE alpha_deposit_intents
    DROP COLUMN IF EXISTS reorg_detected_at,
    DROP COLUMN IF EXISTS finalized_at;
