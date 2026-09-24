-- +goose Up
-- A cover photo per event ("moment") for the photo-led home rail — "This
-- week in the Philippines". Events flagged `featured` with a cover become
-- rail tiles. Nullable: an event without one falls back to its lead
-- market's image, then a topic cover, then the category icon.
--
-- Holds either a site-relative path ("/images/covers/pba.jpg") or an
-- absolute https URL; the service validates the shape on write.
ALTER TABLE prediction_events
    ADD COLUMN IF NOT EXISTS cover_image_url TEXT;

-- +goose Down
ALTER TABLE prediction_events
    DROP COLUMN IF EXISTS cover_image_url;
