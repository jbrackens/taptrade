-- +goose Up
-- The upstream event an import belongs to gets a title of its own
-- ("Chiefs vs. Dolphins", "Who will be the next Pope?") so promotion can
-- create a real prediction_events row per upstream event instead of parking
-- every import in a per-category catch-all (2026-09-27, event cards).
ALTER TABLE imported_markets
    ADD COLUMN IF NOT EXISTS event_title TEXT;

-- +goose Down
ALTER TABLE imported_markets DROP COLUMN IF EXISTS event_title;
