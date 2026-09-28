-- 063: look again at every resolver cover under the square-mark rules.
--
-- Resolver covers chose an organisation's logo (P154) whatever its shape;
-- a wide wordmark padded into a square tile read as a grey line at 40px
-- (Anthropic's, 2026-09-28). The resolver now takes a small icon or a
-- roughly square logo or seal, never a wordmark, and as its last resort —
-- only when no free image exists for any subject of the market — the icon
-- of a named company's own App Store app. cover_lookups.app_name records,
-- on a miss for a company, brand or app, the name to try there.
--
-- Clearing cover_checked_at queues each resolver cover for the backfill,
-- which replaces it or removes it; the old cached answers (key prefix
-- "wd:") are superseded by "wd2:" and deleted.

-- +goose Up
ALTER TABLE cover_lookups ADD COLUMN IF NOT EXISTS app_name TEXT;
UPDATE imported_markets SET cover_checked_at = NULL WHERE image_origin = 'entity';
DELETE FROM cover_lookups WHERE lookup_key LIKE 'wd:%';

-- +goose Down
-- The re-check cannot be un-queued and the old answers are not restorable
-- (the resolver would recompute them under the new rules anyway).
ALTER TABLE cover_lookups DROP COLUMN IF EXISTS app_name;
