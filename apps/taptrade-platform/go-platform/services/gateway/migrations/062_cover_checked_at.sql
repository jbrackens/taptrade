-- +goose Up
-- When the cover resolver last tried an imported market. The sync backfills
-- covers for every open import the board shows without an image, not only
-- the rows the sources returned that run; this lets it move through the
-- whole catalog, trying each bare market at most once per 30 days
-- (2026-09-28: most cards still showed a category icon).
ALTER TABLE imported_markets
    ADD COLUMN IF NOT EXISTS cover_checked_at TIMESTAMPTZ;

-- +goose Down
ALTER TABLE imported_markets DROP COLUMN IF EXISTS cover_checked_at;
