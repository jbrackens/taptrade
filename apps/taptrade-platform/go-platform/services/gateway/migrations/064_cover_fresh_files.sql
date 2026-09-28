-- 064: re-resolve resolver covers stored under a market's plain file name.
--
-- The resolver used to reuse any file already saved as <row id>.<ext>. For
-- a row whose source image had been swept (shared venue branding, or a
-- wide wordmark the thumbnail slices), that file was the swept image, so
-- the market kept it under the new cover's credit — the Nations League
-- games showed the sliced "UEFA NATIONS LEAGUE" wordmark credited to a
-- country's flag (2026-09-28). Resolver covers are now always written
-- under a fresh, content-named file (<row id>-<hash>.<ext>). Clearing
-- cover_checked_at queues every resolver cover still on a plain name for
-- the backfill, which downloads it again under a fresh name and removes
-- the row's older files.

-- +goose Up
UPDATE imported_markets
   SET cover_checked_at = NULL
 WHERE image_origin = 'entity'
   AND image_path !~ '-[0-9a-f]{8}\.[a-z]+$';

-- +goose Down
-- Data only: the re-check cannot be un-queued.
SELECT 1;
