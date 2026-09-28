package discover

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/lib/pq"
)

// Row is the persisted shape — the user-safe subset of Market plus our own
// UUID. This is what the public API serves.
type Row struct {
	ID                string
	ExternalHash      string
	Title             string
	Description       string
	SourceURL         string
	UpstreamStatus    string
	UpstreamUpdatedAt *time.Time
	RulesText         string
	EventGroup        string
	EventTitle        string
	OutcomeLabel      string
	Tags              []string
	ImagePath         *string
	EndTime           *time.Time
	Volume            float64
	Volume24h         float64
	Liquidity         float64
	Outcomes          []string
	Prices            []float64
}

// Repository persists imported markets and serves the read endpoint. SQL
// only; tests in phase 2.
type Repository struct {
	db *sql.DB
}

func NewRepository(db *sql.DB) *Repository {
	return &Repository{db: db}
}

// UpsertResult is what Upsert returns so the caller knows which UUID was
// assigned (needed before the image rehost runs, so the image filename
// matches the row id).
type UpsertResult struct {
	ID      string
	Created bool
}

// Reserve inserts a row keyed by the external_hash if it doesn't exist yet
// and returns the assigned UUID. Subsequent calls with the same hash return
// the same id. Title/volume/etc. are NOT updated here — that happens in
// Update once the image has (or hasn't) been rehosted, so we can write the
// final image_path in a single statement.
func (r *Repository) Reserve(ctx context.Context, externalHash string) (UpsertResult, error) {
	var id string
	var inserted bool
	err := r.db.QueryRowContext(ctx, `
		WITH ins AS (
			INSERT INTO imported_markets (external_hash, title, volume)
			VALUES ($1, '', 0)
			ON CONFLICT (external_hash) DO NOTHING
			RETURNING id
		)
		SELECT id, true AS inserted FROM ins
		UNION ALL
		SELECT id, false FROM imported_markets WHERE external_hash = $1
		LIMIT 1
	`, externalHash).Scan(&id, &inserted)
	if err != nil {
		return UpsertResult{}, fmt.Errorf("reserve: %w", err)
	}
	return UpsertResult{ID: id, Created: inserted}, nil
}

// Update writes the unified-shape fields for an already-reserved row. The
// caller passes nil for ImagePath if rehosting failed or no image existed.
func (r *Repository) Update(ctx context.Context, id string, row Row) error {
	outcomes, err := json.Marshal(row.Outcomes)
	if err != nil {
		outcomes = []byte("[]")
	}
	prices, err := json.Marshal(row.Prices)
	if err != nil {
		prices = []byte("[]")
	}
	tags, err := json.Marshal(row.Tags)
	if err != nil {
		tags = []byte("[]")
	}
	_, err = r.db.ExecContext(ctx, `
		UPDATE imported_markets SET
			title = $2,
			description = $3,
			image_path = CASE WHEN COALESCE(image_origin, '') IN ('', 'upstream') THEN COALESCE($4, image_path) ELSE image_path END,
			image_origin = CASE WHEN $4 IS NOT NULL AND COALESCE(image_origin, '') IN ('', 'upstream') THEN 'upstream' ELSE image_origin END,
			end_time = $5,
			volume = $6,
			outcomes = $7::jsonb,
			prices = $8::jsonb,
			source_url = $9,
			upstream_status = $10,
			upstream_updated_at = $11,
			rules_text = $12,
			event_group = $13,
			tags = $14::jsonb,
			volume_24h = $15,
			liquidity = $16,
			event_title = $17,
			outcome_label = $18,
			last_seen_at = now(),
			updated_at = now()
		WHERE id = $1
	`,
		id,
		row.Title,
		nullableText(row.Description),
		nullableText(ptrStr(row.ImagePath)),
		row.EndTime,
		row.Volume,
		string(outcomes),
		string(prices),
		nullableText(row.SourceURL),
		nullableText(row.UpstreamStatus),
		row.UpstreamUpdatedAt,
		nullableText(row.RulesText),
		nullableText(row.EventGroup),
		string(tags),
		row.Volume24h,
		row.Liquidity,
		nullableText(row.EventTitle),
		nullableText(row.OutcomeLabel),
	)
	if err != nil {
		return fmt.Errorf("update: %w", err)
	}
	if err := r.RecordSnapshot(ctx, id, row); err != nil {
		return err
	}
	return nil
}

// MarkMissing marks imported rows as no longer active upstream and voids their
// promoted player markets. Native/admin markets are untouched: promoted imports
// are identified only by their deterministic IMP-* ticker.
func (r *Repository) MarkMissing(ctx context.Context, externalHashes []string) (int, error) {
	if len(externalHashes) == 0 {
		return 0, nil
	}
	_, err := r.db.ExecContext(ctx, `
		UPDATE imported_markets
		   SET missing_since = COALESCE(missing_since, now()),
		       updated_at = now()
		 WHERE external_hash = ANY($1::text[])
		   AND missing_since IS NULL
	`, pq.Array(externalHashes))
	if err != nil {
		return 0, fmt.Errorf("mark missing imported markets: %w", err)
	}

	res, err := r.db.ExecContext(ctx, `
		WITH candidates AS (
			SELECT pm.id, pm.ticker
			  FROM imported_markets im
			  JOIN prediction_markets pm
			    ON pm.ticker = 'IMP-' || upper(substr(im.external_hash, 1, 8))
			 WHERE im.external_hash = ANY($1::text[])
			   AND pm.status IN ('unopened','open','halted','closed','proposed_resolution','disputed')
		),
		updated AS (
			UPDATE prediction_markets pm
			   SET status = 'voided',
			       updated_at = now()
			  FROM candidates c
			 WHERE pm.id = c.id
			RETURNING pm.id
		)
		INSERT INTO prediction_lifecycle_events
			(market_id, event_type, actor_id, actor_type, reason, metadata)
		SELECT id,
		       'voided',
		       'market-sync',
		       'system',
		       'removed from player catalog because upstream market is no longer active',
		       '{}'::jsonb
		  FROM updated
	`, pq.Array(externalHashes))
	if err != nil {
		return 0, fmt.Errorf("void missing imported markets: %w", err)
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

// StaleImportedHashes returns imported rows whose promoted player-market
// counterpart is still non-terminal even though the market is no longer
// appropriate for the player catalog.
func (r *Repository) StaleImportedHashes(ctx context.Context, now time.Time) ([]string, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT im.external_hash,
		       im.title,
		       COALESCE(im.description, ''),
		       COALESCE(im.rules_text, ''),
		       im.end_time
		  FROM imported_markets im
		  JOIN prediction_markets pm
		    ON pm.ticker = 'IMP-' || upper(substr(im.external_hash, 1, 8))
		 WHERE pm.status IN ('unopened','open','halted','closed','proposed_resolution','disputed')
		   AND (
		       im.end_time <= $1
		       OR im.description ~* '(originally[[:space:]]+scheduled[[:space:]]+for|scheduled[[:space:]]+for|scheduled[[:space:]]+on)[[:space:]]+[A-Z][a-z]+[[:space:]]+[0-9]{1,2},[[:space:]]*[0-9]{4}'
		       OR im.rules_text ~* '(originally[[:space:]]+scheduled[[:space:]]+for|scheduled[[:space:]]+for|scheduled[[:space:]]+on)[[:space:]]+[A-Z][a-z]+[[:space:]]+[0-9]{1,2},[[:space:]]*[0-9]{4}'
		       OR im.title ~* '^Will .+ win the [0-9]{4} (NBA Finals|NHL Stanley Cup)'
		   )
	`, now.UTC())
	if err != nil {
		return nil, fmt.Errorf("list stale imported markets: %w", err)
	}
	defer rows.Close()

	var out []string
	for rows.Next() {
		var hash string
		var title, description, rulesText string
		var endTime sql.NullTime
		if err := rows.Scan(&hash, &title, &description, &rulesText, &endTime); err != nil {
			return nil, err
		}
		if endTime.Valid && !endTime.Time.After(now.UTC()) {
			out = append(out, hash)
			continue
		}
		if textHasPastScheduledDate(description, now.UTC()) || textHasPastScheduledDate(rulesText, now.UTC()) {
			out = append(out, hash)
			continue
		}
		if outrightWinnerNoLongerActive(title, now.UTC()) {
			out = append(out, hash)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// ImportedImageRow is the projection the shared-cover sweep reads: every
// imported row that currently carries a rehosted thumbnail, plus the upstream
// event group it belongs to (empty when the source had none).
type ImportedImageRow struct {
	ID         string
	ImagePath  string
	EventGroup string
}

// ListImageRows returns all imported rows with a non-null image_path.
func (r *Repository) ListImageRows(ctx context.Context) ([]ImportedImageRow, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, image_path, COALESCE(event_group, '')
		  FROM imported_markets
		 WHERE image_path IS NOT NULL
		   AND COALESCE(image_origin, 'upstream') = 'upstream'
	`)
	if err != nil {
		return nil, fmt.Errorf("list image rows: %w", err)
	}
	defer rows.Close()

	var out []ImportedImageRow
	for rows.Next() {
		var row ImportedImageRow
		if err := rows.Scan(&row.ID, &row.ImagePath, &row.EventGroup); err != nil {
			return nil, fmt.Errorf("scan image row: %w", err)
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// ClearImagePaths nulls the thumbnail on the given imported rows. Used by the
// shared-cover sweep when an image turns out to be venue/series branding
// rather than market-specific art.
func (r *Repository) ClearImagePaths(ctx context.Context, ids []string) (int, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	res, err := r.db.ExecContext(ctx, `
		UPDATE imported_markets
		   SET image_path = NULL,
		       image_credit = NULL,
		       image_license = NULL,
		       image_source_url = NULL,
		       image_origin = 'swept',
		       cover_checked_at = NULL,
		       updated_at = now()
		 WHERE id = ANY($1::uuid[])
		   AND image_path IS NOT NULL
		   AND COALESCE(image_origin, 'upstream') = 'upstream'
	`, pq.Array(ids))
	if err != nil {
		return 0, fmt.Errorf("clear image paths: %w", err)
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

// AlignPromotedMarketImages makes each promoted IMP-* market's thumbnail
// follow its imported catalog row — correcting historical mismatches (e.g. a
// shared game cover stamped at promote time) and dropping thumbnails the
// shared-cover sweep cleared. Imported rows are the source of truth for
// promoted imports only; native/admin markets have non-IMP tickers and are
// never touched.
func (r *Repository) AlignPromotedMarketImages(ctx context.Context) (int, error) {
	res, err := r.db.ExecContext(ctx, `
		UPDATE prediction_markets pm
		   SET image_path = im.image_path,
		       updated_at = now()
		  FROM imported_markets im
		 WHERE pm.ticker = 'IMP-' || upper(substr(im.external_hash, 1, 8))
		   AND pm.image_path IS DISTINCT FROM im.image_path
	`)
	if err != nil {
		return 0, fmt.Errorf("align promoted market images: %w", err)
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

func (r *Repository) RecordSnapshot(ctx context.Context, id string, row Row) error {
	prices, err := json.Marshal(row.Prices)
	if err != nil {
		prices = []byte("[]")
	}
	_, err = r.db.ExecContext(ctx, `
		INSERT INTO imported_market_price_snapshots
			(imported_market_id, external_hash, prices, volume, volume_24h, liquidity, upstream_status)
		VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
	`,
		id,
		row.ExternalHash,
		string(prices),
		row.Volume,
		row.Volume24h,
		row.Liquidity,
		nullableText(row.UpstreamStatus),
	)
	if err != nil {
		return fmt.Errorf("record snapshot: %w", err)
	}
	return nil
}

// List returns rows sorted by volume DESC, id DESC, with cursor-based
// pagination. Cursor is opaque; format is internal to encodeCursor /
// decodeCursor.
func (r *Repository) List(ctx context.Context, q string, limit int, cursor string) ([]Row, string, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	args := []any{}
	where := []string{}

	if trimmed := strings.TrimSpace(q); trimmed != "" {
		args = append(args, "%"+strings.ToLower(trimmed)+"%")
		where = append(where, fmt.Sprintf("lower(title) LIKE $%d", len(args)))
	}

	if cursor != "" {
		cv, cid, ok := decodeCursor(cursor)
		if ok {
			args = append(args, cv, cid)
			where = append(where,
				fmt.Sprintf("(volume, id) < ($%d, $%d::uuid)", len(args)-1, len(args)),
			)
		}
	}

	whereSQL := ""
	if len(where) > 0 {
		whereSQL = "WHERE " + strings.Join(where, " AND ")
	}
	args = append(args, limit+1)
	limitArg := len(args)

	query := fmt.Sprintf(`
		SELECT id, title, COALESCE(description,''), image_path, end_time,
		       volume, outcomes, prices
		FROM imported_markets
		%s
		ORDER BY volume DESC, id DESC
		LIMIT $%d
	`, whereSQL, limitArg)

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, "", fmt.Errorf("list: %w", err)
	}
	defer rows.Close()

	out := make([]Row, 0, limit)
	for rows.Next() {
		var (
			row       Row
			imagePath sql.NullString
			endTime   sql.NullTime
			outcomesB []byte
			pricesB   []byte
		)
		if err := rows.Scan(&row.ID, &row.Title, &row.Description,
			&imagePath, &endTime, &row.Volume, &outcomesB, &pricesB); err != nil {
			return nil, "", fmt.Errorf("scan: %w", err)
		}
		if imagePath.Valid {
			s := imagePath.String
			row.ImagePath = &s
		}
		if endTime.Valid {
			t := endTime.Time
			row.EndTime = &t
		}
		_ = json.Unmarshal(outcomesB, &row.Outcomes)
		_ = json.Unmarshal(pricesB, &row.Prices)
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, "", err
	}

	next := ""
	if len(out) > limit {
		last := out[limit-1]
		next = encodeCursor(last.Volume, last.ID)
		out = out[:limit]
	}
	return out, next, nil
}

func nullableText(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func ptrStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// LoadCursor returns the saved position of a rotating listing scan ("" when
// none has been saved, i.e. start from the top). See migration 058.
func (r *Repository) LoadCursor(ctx context.Context, source, listing string) (string, error) {
	var cursor string
	err := r.db.QueryRowContext(ctx,
		`SELECT cursor FROM discover_cursors WHERE source = $1 AND listing = $2`,
		source, listing).Scan(&cursor)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("load %s/%s cursor: %w", source, listing, err)
	}
	return cursor, nil
}

// SaveCursor records where a rotating listing scan should resume.
func (r *Repository) SaveCursor(ctx context.Context, source, listing, cursor string) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO discover_cursors (source, listing, cursor, updated_at)
		VALUES ($1, $2, $3, now())
		ON CONFLICT (source, listing) DO UPDATE
		   SET cursor = EXCLUDED.cursor, updated_at = now()`,
		source, listing, cursor)
	if err != nil {
		return fmt.Errorf("save %s/%s cursor: %w", source, listing, err)
	}
	return nil
}

// ── Covers (migration 060) ──────────────────────────────────────────────

// NeedsCover reports whether an imported row has no thumbnail and has not
// been given one by hand.
func (r *Repository) NeedsCover(ctx context.Context, id string) (bool, error) {
	var needs bool
	err := r.db.QueryRowContext(ctx,
		`SELECT image_path IS NULL AND COALESCE(image_origin, '') <> 'manual' FROM imported_markets WHERE id = $1`,
		id).Scan(&needs)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return needs, err
}

// SetImage records a resolved cover and its credit on an imported row; a
// manual cover is left alone.
func (r *Repository) SetImage(ctx context.Context, id string, meta CoverMeta) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE imported_markets
		   SET image_path = $2,
		       image_credit = NULLIF($3, ''),
		       image_license = NULLIF($4, ''),
		       image_source_url = NULLIF($5, ''),
		       image_origin = $6,
		       cover_checked_at = now(),
		       updated_at = now()
		 WHERE id = $1
		   AND COALESCE(image_origin, '') <> 'manual'`,
		id, meta.Path, meta.Credit, meta.License, meta.SourceURL, meta.Origin)
	if err != nil {
		return fmt.Errorf("set image: %w", err)
	}
	return nil
}

func (r *Repository) LoadCoverLookup(ctx context.Context, key string) (*CoverLookup, error) {
	var l CoverLookup
	var imageURL, credit, license, sourceURL, origin, appName sql.NullString
	err := r.db.QueryRowContext(ctx,
		`SELECT lookup_key, found, image_url, credit, license, source_url, origin, app_name, checked_at
		   FROM cover_lookups WHERE lookup_key = $1`, key,
	).Scan(&l.Key, &l.Found, &imageURL, &credit, &license, &sourceURL, &origin, &appName, &l.CheckedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load cover lookup: %w", err)
	}
	l.ImageURL, l.Credit, l.License, l.SourceURL, l.Origin = imageURL.String, credit.String, license.String, sourceURL.String, origin.String
	l.AppName = appName.String
	return &l, nil
}

func (r *Repository) SaveCoverLookup(ctx context.Context, l CoverLookup) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO cover_lookups (lookup_key, found, image_url, credit, license, source_url, origin, app_name, checked_at)
		VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), NULLIF($5, ''), NULLIF($6, ''), NULLIF($7, ''), NULLIF($8, ''), now())
		ON CONFLICT (lookup_key) DO UPDATE SET
		   found = EXCLUDED.found, image_url = EXCLUDED.image_url, credit = EXCLUDED.credit,
		   license = EXCLUDED.license, source_url = EXCLUDED.source_url, origin = EXCLUDED.origin,
		   app_name = EXCLUDED.app_name, checked_at = now()`,
		l.Key, l.Found, l.ImageURL, l.Credit, l.License, l.SourceURL, l.Origin, l.AppName)
	if err != nil {
		return fmt.Errorf("save cover lookup: %w", err)
	}
	return nil
}

// ResolvedCover is one auto-chosen (or hand-set) thumbnail for back-office
// review.
type ResolvedCover struct {
	MarketID  string    `json:"marketId"`
	Ticker    string    `json:"ticker"`
	Title     string    `json:"title"`
	ImagePath string    `json:"imagePath"`
	Credit    string    `json:"credit,omitempty"`
	Origin    string    `json:"origin"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// ListResolvedCovers returns open imports whose thumbnail was resolved by
// the catalog (or set by hand), newest first.
func (r *Repository) ListResolvedCovers(ctx context.Context, limit int) ([]ResolvedCover, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := r.db.QueryContext(ctx, `
		SELECT pm.id, pm.ticker, pm.title, im.image_path, COALESCE(im.image_credit, ''), im.image_origin, im.updated_at
		  FROM imported_markets im
		  JOIN prediction_markets pm ON pm.ticker = 'IMP-' || upper(substr(im.external_hash, 1, 8))
		 WHERE im.image_origin IN ('entity', 'topic', 'tile', 'manual')
		   AND pm.status = 'open'
		 ORDER BY im.updated_at DESC
		 LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("list resolved covers: %w", err)
	}
	defer rows.Close()
	out := []ResolvedCover{}
	for rows.Next() {
		var c ResolvedCover
		var path sql.NullString
		if err := rows.Scan(&c.MarketID, &c.Ticker, &c.Title, &path, &c.Credit, &c.Origin, &c.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan resolved cover: %w", err)
		}
		c.ImagePath = path.String
		out = append(out, c)
	}
	return out, rows.Err()
}

// SetManualImage sets (or, with an empty path, removes) a market's thumbnail
// by hand and marks the imported row manual so no sync overwrites it.
// Returns false when the market does not exist.
func (r *Repository) SetManualImage(ctx context.Context, marketID, path string) (bool, error) {
	var ticker string
	err := r.db.QueryRowContext(ctx,
		`UPDATE prediction_markets SET image_path = NULLIF($2, ''), updated_at = now() WHERE id = $1 RETURNING ticker`,
		marketID, path).Scan(&ticker)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("set manual image: %w", err)
	}
	if _, err := r.db.ExecContext(ctx, `
		UPDATE imported_markets
		   SET image_path = NULLIF($2, ''), image_credit = NULL, image_license = NULL, image_source_url = NULL,
		       image_origin = 'manual', updated_at = now()
		 WHERE 'IMP-' || upper(substr(external_hash, 1, 8)) = $1`, ticker, path); err != nil {
		return false, fmt.Errorf("mark manual image: %w", err)
	}
	return true, nil
}

// Attribution is one credited cover for the public /attributions page.
type Attribution struct {
	Ticker    string `json:"ticker"`
	Title     string `json:"title"`
	ImagePath string `json:"imagePath"`
	Credit    string `json:"credit"`
	License   string `json:"license,omitempty"`
	SourceURL string `json:"sourceUrl,omitempty"`
}

// ListAttributions returns every market whose cover carries a credit.
func (r *Repository) ListAttributions(ctx context.Context, limit int) ([]Attribution, error) {
	if limit <= 0 || limit > 1000 {
		limit = 500
	}
	rows, err := r.db.QueryContext(ctx, `
		SELECT pm.ticker, pm.title, im.image_path, im.image_credit, COALESCE(im.image_license, ''), COALESCE(im.image_source_url, '')
		  FROM imported_markets im
		  JOIN prediction_markets pm ON pm.ticker = 'IMP-' || upper(substr(im.external_hash, 1, 8))
		 WHERE im.image_credit IS NOT NULL AND im.image_path IS NOT NULL
		 ORDER BY pm.title
		 LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("list attributions: %w", err)
	}
	defer rows.Close()
	out := []Attribution{}
	for rows.Next() {
		var a Attribution
		if err := rows.Scan(&a.Ticker, &a.Title, &a.ImagePath, &a.Credit, &a.License, &a.SourceURL); err != nil {
			return nil, fmt.Errorf("scan attribution: %w", err)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ClearResolverCover removes a resolver cover that no longer passes the
// resolver's rules (a wide wordmark), leaving the row bare and checked;
// AlignPromotedMarketImages then clears the market's image too.
func (r *Repository) ClearResolverCover(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE imported_markets
		   SET image_path = NULL, image_credit = NULL, image_license = NULL,
		       image_source_url = NULL, image_origin = NULL,
		       cover_checked_at = now(), updated_at = now()
		 WHERE id = $1 AND image_origin = 'entity'`, id)
	if err != nil {
		return fmt.Errorf("clear resolver cover: %w", err)
	}
	return nil
}

// MarkCoverChecked records that the resolver tried a row and found nothing,
// so the backfill moves on and retries it after coverMissRetryAfter.
func (r *Repository) MarkCoverChecked(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE imported_markets SET cover_checked_at = now() WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("mark cover checked: %w", err)
	}
	return nil
}

// BareImport is an open, promoted import the cover backfill should work
// on: one with no thumbnail, or (HasCover) one whose resolver cover is due
// to be looked up again under the current rules.
type BareImport struct {
	ID           string
	Title        string
	EventTitle   string
	Description  string
	CategorySlug string
	HasCover     bool
}

// ListBareOpenImports returns open promoted imports without an image that
// the resolver has not tried in the last 30 days, plus resolver covers
// marked for another look (cover_checked_at cleared, migration 063), the
// ones the board is likeliest to show first: contested prices, then 24h
// and lifetime volume.
func (r *Repository) ListBareOpenImports(ctx context.Context, limit int) ([]BareImport, error) {
	if limit <= 0 {
		return nil, nil
	}
	rows, err := r.db.QueryContext(ctx, `
		SELECT im.id, im.title, COALESCE(im.event_title, ''), COALESCE(im.description, ''), COALESCE(pc.slug, ''),
		       im.image_path IS NOT NULL
		  FROM imported_markets im
		  JOIN prediction_markets pm ON pm.ticker = 'IMP-' || upper(substr(im.external_hash, 1, 8))
		  LEFT JOIN prediction_events pe ON pe.id = pm.event_id
		  LEFT JOIN prediction_categories pc ON pc.id = pe.category_id
		 WHERE pm.status = 'open'
		   AND COALESCE(im.image_origin, '') <> 'manual'
		   AND ((im.image_path IS NULL
		         AND (im.cover_checked_at IS NULL OR im.cover_checked_at < now() - interval '30 days'))
		        OR (im.image_origin = 'entity' AND im.cover_checked_at IS NULL))
		 ORDER BY (pm.yes_price_points BETWEEN 5 AND 95) DESC,
		          COALESCE(im.volume_24h, 0) DESC,
		          pm.volume_points DESC,
		          im.id
		 LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("list bare imports: %w", err)
	}
	defer rows.Close()
	var out []BareImport
	for rows.Next() {
		var b BareImport
		if err := rows.Scan(&b.ID, &b.Title, &b.EventTitle, &b.Description, &b.CategorySlug, &b.HasCover); err != nil {
			return nil, fmt.Errorf("scan bare import: %w", err)
		}
		out = append(out, b)
	}
	return out, rows.Err()
}
