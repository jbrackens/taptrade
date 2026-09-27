-- +goose Up
-- Cover resolver (2026-09-27): an import whose source ships no image gets a
-- cover from an open repository (a Wikimedia Commons photo of the person it
-- names, an openly licensed topic photo, or a generated matchup tile), with
-- the credit the licence asks for. image_origin says where a cover came from
-- ('upstream' | 'entity' | 'topic' | 'tile' | 'manual'); 'manual' is a
-- back-office choice the sync never overwrites.
ALTER TABLE imported_markets
    ADD COLUMN IF NOT EXISTS image_credit     TEXT,
    ADD COLUMN IF NOT EXISTS image_license    TEXT,
    ADD COLUMN IF NOT EXISTS image_source_url TEXT,
    ADD COLUMN IF NOT EXISTS image_origin     TEXT;

UPDATE imported_markets SET image_origin = 'upstream'
 WHERE image_path IS NOT NULL AND image_origin IS NULL;

-- One row per lookup (an entity name or a topic query), hit or miss, so the
-- sync never asks the same question twice within the retry window.
CREATE TABLE IF NOT EXISTS cover_lookups (
    lookup_key  TEXT PRIMARY KEY,
    found       BOOLEAN NOT NULL DEFAULT false,
    image_url   TEXT,
    credit      TEXT,
    license     TEXT,
    source_url  TEXT,
    origin      TEXT,
    checked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS cover_lookups;
ALTER TABLE imported_markets
    DROP COLUMN IF EXISTS image_origin,
    DROP COLUMN IF EXISTS image_source_url,
    DROP COLUMN IF EXISTS image_license,
    DROP COLUMN IF EXISTS image_credit;
