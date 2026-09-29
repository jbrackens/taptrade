-- +goose Up
-- Settlement overrides are made by back-office staff, whose ids live in
-- admin_users (or the auth service), not in punters. Migration 019 tied
-- prediction_settlements.overridden_by_user_id to punters(id), so storing the
-- override actor would fail for every real admin. settled_by, the same kind
-- of actor column, has no foreign key; this makes the override actor match.
-- Until 2026-09-29 the override reason was never written at all, so no
-- existing row is affected.
ALTER TABLE prediction_settlements
    DROP CONSTRAINT IF EXISTS prediction_settlements_overridden_by_user_id_fkey;

-- +goose Down
-- NOT VALID: rows written after the Up (staff ids) would fail validation.
ALTER TABLE prediction_settlements
    ADD CONSTRAINT prediction_settlements_overridden_by_user_id_fkey
    FOREIGN KEY (overridden_by_user_id) REFERENCES punters(id) NOT VALID;
