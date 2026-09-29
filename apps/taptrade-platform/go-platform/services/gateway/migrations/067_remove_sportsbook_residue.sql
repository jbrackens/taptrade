-- +goose Up
-- 067_remove_sportsbook_residue.sql
--
-- Tap Trade is a points-only prediction market. On 2026-09-29 the owner asked
-- for everything that only served sports betting or casino-style gambling to
-- leave the code base. This migration removes the matching schema:
--
--   * Bonus wagering (play-through): the wagering_contributions table, the
--     wagering_* columns on player_bonuses, and the 'wagering' campaign rule
--     type. A campaign bonus is now a plain Points grant.
--   * Sportsbook campaign types: existing rows are mapped to the point-native
--     names the API has returned since the Points unit model, and the CHECK
--     constraint stops allowing the old ones.
--   * Responsible-gambling tables (bet/deposit limits, cool-off,
--     self-exclusion), which the auth-less RG service created at runtime and
--     nothing reads any more.
--   * wallets and ledger_entries, the sportsbook wallet tables that
--     033 kept "because live code references them" — it did not; the live
--     wallet is wallet_balances / wallet_ledger (see 050's header).
--
-- Plain statements only: goose splits on ';' and needs no re-run guard.

DROP TABLE IF EXISTS wagering_contributions;
ALTER TABLE player_bonuses DROP COLUMN IF EXISTS wagering_required_points;
ALTER TABLE player_bonuses DROP COLUMN IF EXISTS wagering_completed_points;

DELETE FROM campaign_rules WHERE rule_type = 'wagering';
ALTER TABLE campaign_rules DROP CONSTRAINT IF EXISTS campaign_rules_rule_type_check;
ALTER TABLE campaign_rules ADD CONSTRAINT campaign_rules_rule_type_check
    CHECK (rule_type IN ('eligibility', 'trigger', 'reward'));

UPDATE campaigns SET campaign_type = CASE campaign_type
    WHEN 'deposit_match' THEN 'point_match'
    WHEN 'freebet_grant' THEN 'point_grant'
    WHEN 'odds_boost_grant' THEN 'point_grant'
    ELSE campaign_type END
WHERE campaign_type IN ('deposit_match', 'freebet_grant', 'odds_boost_grant');
UPDATE player_bonuses SET bonus_type = CASE bonus_type
    WHEN 'deposit_match' THEN 'point_match'
    WHEN 'freebet_grant' THEN 'point_grant'
    WHEN 'odds_boost_grant' THEN 'point_grant'
    WHEN 'freebet' THEN 'point_grant'
    WHEN 'odds_boost' THEN 'point_grant'
    WHEN 'cash' THEN 'point_grant'
    ELSE bonus_type END
WHERE bonus_type IN ('deposit_match', 'freebet_grant', 'odds_boost_grant', 'freebet', 'odds_boost', 'cash');
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_campaign_type_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_campaign_type_check
    CHECK (campaign_type IN ('point_grant', 'point_match', 'signup_bonus', 'reload_bonus', 'referral_bonus', 'custom'));

DROP TABLE IF EXISTS player_bet_limits;
DROP TABLE IF EXISTS player_deposit_limits;
DROP TABLE IF EXISTS player_restrictions;
DROP TABLE IF EXISTS player_activity_log;

DROP TABLE IF EXISTS ledger_entries;
DROP TABLE IF EXISTS wallets;

-- +goose Down
-- The sportsbook tables are recreated empty with their post-050 column names
-- so an older binary can start; their rows are gone.
CREATE TABLE IF NOT EXISTS wallets (
    id VARCHAR(255) PRIMARY KEY,
    punter_id VARCHAR(255) NOT NULL UNIQUE REFERENCES punters(id) ON DELETE CASCADE,
    balance_points BIGINT NOT NULL DEFAULT 0,
    bonus_balance_points BIGINT NOT NULL DEFAULT 0,
    currency_code VARCHAR(3) NOT NULL DEFAULT 'PTS',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ledger_entries (
    id VARCHAR(255) PRIMARY KEY,
    wallet_id VARCHAR(255) NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    punter_id VARCHAR(255) NOT NULL REFERENCES punters(id) ON DELETE CASCADE,
    transaction_type VARCHAR(50) NOT NULL,
    amount_cents BIGINT NOT NULL,
    bonus_amount_cents BIGINT DEFAULT 0,
    balance_before_cents BIGINT NOT NULL,
    balance_after_cents BIGINT NOT NULL,
    reference_type VARCHAR(50),
    reference_id VARCHAR(255),
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_campaign_type_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_campaign_type_check
    CHECK (campaign_type IN ('point_grant', 'point_match', 'deposit_match', 'freebet_grant', 'odds_boost_grant', 'signup_bonus', 'reload_bonus', 'referral_bonus', 'custom'));
ALTER TABLE campaign_rules DROP CONSTRAINT IF EXISTS campaign_rules_rule_type_check;
ALTER TABLE campaign_rules ADD CONSTRAINT campaign_rules_rule_type_check
    CHECK (rule_type IN ('eligibility', 'trigger', 'reward', 'wagering'));

ALTER TABLE player_bonuses ADD COLUMN IF NOT EXISTS wagering_required_points BIGINT NOT NULL DEFAULT 0;
ALTER TABLE player_bonuses ADD COLUMN IF NOT EXISTS wagering_completed_points BIGINT NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS wagering_contributions (
    id BIGSERIAL PRIMARY KEY,
    player_bonus_id BIGINT NOT NULL REFERENCES player_bonuses(id),
    bet_id TEXT NOT NULL,
    bet_type TEXT NOT NULL DEFAULT 'single' CHECK (bet_type IN ('single', 'parlay', 'system')),
    stake_points BIGINT NOT NULL,
    contribution_points BIGINT NOT NULL,
    odds_decimal NUMERIC(10, 4),
    leg_count INT DEFAULT 1,
    contributed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (player_bonus_id, bet_id)
);
