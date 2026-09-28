-- +goose Up
-- The short label a source gives a market inside its event ("Spread -3.5",
-- "25 bps increase", "Lamine Yamal", "September 30, 2026") — Polymarket's
-- groupItemTitle, Kalshi's yes_sub_title. Event cards show it instead of
-- the full question, which truncates to the words every row shares
-- ("US x Iran cease…" twice, 2026-09-28).
ALTER TABLE imported_markets
    ADD COLUMN IF NOT EXISTS outcome_label TEXT;

-- +goose Down
ALTER TABLE imported_markets DROP COLUMN IF EXISTS outcome_label;
