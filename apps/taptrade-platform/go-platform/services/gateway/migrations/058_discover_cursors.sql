-- +goose Up
-- Rotating scan positions for upstream catalog listings that are too deep to
-- read in one run (Kalshi's event listing, 2026-09-27). One row per source
-- and listing; the sync worker reads its cursor at the start of a run and
-- writes the position it reached, so a deploy or restart continues the
-- sweep instead of starting from page one.
CREATE TABLE IF NOT EXISTS discover_cursors (
    source      TEXT NOT NULL,
    listing     TEXT NOT NULL,
    cursor      TEXT NOT NULL DEFAULT '',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source, listing)
);

-- +goose Down
DROP TABLE IF EXISTS discover_cursors;
