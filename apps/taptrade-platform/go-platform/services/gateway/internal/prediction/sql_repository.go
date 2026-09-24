package prediction

import (
	"context"
	"crypto/sha1"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/lib/pq"

	"taptrade/gateway/internal/compliance"
)

// SQLRepository implements Repository backed by PostgreSQL.
type SQLRepository struct {
	db *sql.DB
}

type sqlRowExecer interface {
	ExecContext(ctx context.Context, query string, args ...interface{}) (sql.Result, error)
	QueryRowContext(ctx context.Context, query string, args ...interface{}) *sql.Row
}

// NewSQLRepository creates a new PostgreSQL-backed repository.
func NewSQLRepository(db *sql.DB) *SQLRepository {
	return &SQLRepository{db: db}
}

// DB exposes the underlying database connection.
func (r *SQLRepository) DB() *sql.DB { return r.db }

// --- Categories ---

func (r *SQLRepository) ListCategories(ctx context.Context, activeOnly bool) ([]Category, error) {
	q := `SELECT id, slug, name, icon, sort_order, active, created_at, updated_at
	      FROM prediction_categories`
	if activeOnly {
		q += ` WHERE active = true`
	}
	q += ` ORDER BY sort_order`

	rows, err := r.db.QueryContext(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var cats []Category
	for rows.Next() {
		var c Category
		var icon sql.NullString
		if err := rows.Scan(&c.ID, &c.Slug, &c.Name, &icon, &c.SortOrder, &c.Active, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		c.Icon = icon.String
		cats = append(cats, c)
	}
	return cats, rows.Err()
}

func (r *SQLRepository) GetCategory(ctx context.Context, slug string) (*Category, error) {
	var c Category
	var icon sql.NullString
	err := r.db.QueryRowContext(ctx,
		`SELECT id, slug, name, icon, sort_order, active, created_at, updated_at
		 FROM prediction_categories WHERE slug = $1`, slug,
	).Scan(&c.ID, &c.Slug, &c.Name, &icon, &c.SortOrder, &c.Active, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return nil, err
	}
	c.Icon = icon.String
	return &c, nil
}

func (r *SQLRepository) CreateCategory(ctx context.Context, cat *Category) error {
	return r.db.QueryRowContext(ctx,
		`INSERT INTO prediction_categories (slug, name, icon, sort_order, active)
		 VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at, updated_at`,
		cat.Slug, cat.Name, nullStr(cat.Icon), cat.SortOrder, cat.Active,
	).Scan(&cat.ID, &cat.CreatedAt, &cat.UpdatedAt)
}

// --- Series ---

func (r *SQLRepository) ListSeries(ctx context.Context, categoryID *string) ([]Series, error) {
	q := `SELECT id, slug, title, description, category_id, frequency, tags, active, created_at, updated_at
	      FROM prediction_series WHERE active = true`
	var args []interface{}
	if categoryID != nil {
		q += ` AND category_id = $1`
		args = append(args, *categoryID)
	}
	q += ` ORDER BY created_at DESC`

	rows, err := r.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []Series
	for rows.Next() {
		var s Series
		var desc, freq sql.NullString
		if err := rows.Scan(&s.ID, &s.Slug, &s.Title, &desc, &s.CategoryID, &freq, pq.Array(&s.Tags), &s.Active, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		s.Description = desc.String
		s.Frequency = freq.String
		result = append(result, s)
	}
	return result, rows.Err()
}

func (r *SQLRepository) GetSeries(ctx context.Context, id string) (*Series, error) {
	var s Series
	var desc, freq sql.NullString
	err := r.db.QueryRowContext(ctx,
		`SELECT id, slug, title, description, category_id, frequency, tags, active, created_at, updated_at
		 FROM prediction_series WHERE id = $1`, id,
	).Scan(&s.ID, &s.Slug, &s.Title, &desc, &s.CategoryID, &freq, pq.Array(&s.Tags), &s.Active, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		return nil, err
	}
	s.Description = desc.String
	s.Frequency = freq.String
	return &s, nil
}

func (r *SQLRepository) CreateSeries(ctx context.Context, s *Series) error {
	return r.db.QueryRowContext(ctx,
		`INSERT INTO prediction_series (slug, title, description, category_id, frequency, tags, active)
		 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at, updated_at`,
		s.Slug, s.Title, nullStr(s.Description), s.CategoryID, nullStr(s.Frequency), pq.Array(s.Tags), s.Active,
	).Scan(&s.ID, &s.CreatedAt, &s.UpdatedAt)
}

// --- Events ---

func (r *SQLRepository) ListEvents(ctx context.Context, filter EventFilter) ([]Event, int, error) {
	where, args := buildEventWhere(filter)
	countQ := `SELECT COUNT(*) FROM prediction_events` + where
	var total int
	if err := r.db.QueryRowContext(ctx, countQ, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	q := `SELECT id, series_id, title, description, category_id, status, featured,
	             open_at, close_at, settle_at, settled_at, metadata, created_by, created_at, updated_at,
	             cover_image_url
	      FROM prediction_events` + where + ` ORDER BY close_at ASC`
	q += fmt.Sprintf(` LIMIT $%d OFFSET $%d`, len(args)+1, len(args)+2)
	args = append(args, filter.PageSize, (filter.Page-1)*filter.PageSize)

	rows, err := r.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var events []Event
	for rows.Next() {
		e, err := scanEvent(rows)
		if err != nil {
			return nil, 0, err
		}
		events = append(events, *e)
	}
	return events, total, rows.Err()
}

func (r *SQLRepository) GetEvent(ctx context.Context, id string) (*Event, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT id, series_id, title, description, category_id, status, featured,
		        open_at, close_at, settle_at, settled_at, metadata, created_by, created_at, updated_at,
		        cover_image_url
		 FROM prediction_events WHERE id = $1`, id)

	var e Event
	var seriesID, desc, createdBy, cover sql.NullString
	var openAt, settleAt, settledAt sql.NullTime
	var categoryID sql.NullString // nullable — see scanEvent
	err := row.Scan(&e.ID, &seriesID, &e.Title, &desc, &categoryID, &e.Status, &e.Featured,
		&openAt, &e.CloseAt, &settleAt, &settledAt, &e.Metadata, &createdBy, &e.CreatedAt, &e.UpdatedAt,
		&cover)
	if err != nil {
		return nil, err
	}
	if cover.Valid && cover.String != "" {
		e.CoverImageURL = &cover.String
	}
	e.CategoryID = categoryID.String
	if seriesID.Valid {
		e.SeriesID = &seriesID.String
	}
	e.Description = desc.String
	if openAt.Valid {
		e.OpenAt = &openAt.Time
	}
	if settleAt.Valid {
		e.SettleAt = &settleAt.Time
	}
	if settledAt.Valid {
		e.SettledAt = &settledAt.Time
	}
	if createdBy.Valid {
		e.CreatedBy = &createdBy.String
	}
	return &e, nil
}

func (r *SQLRepository) CreateEvent(ctx context.Context, e *Event) error {
	return r.db.QueryRowContext(ctx,
		`INSERT INTO prediction_events (series_id, title, description, category_id, status, featured,
		  open_at, close_at, settle_at, metadata, created_by, cover_image_url)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		 RETURNING id, created_at, updated_at`,
		e.SeriesID, e.Title, nullStr(e.Description), e.CategoryID, e.Status, e.Featured,
		e.OpenAt, e.CloseAt, e.SettleAt, e.Metadata, e.CreatedBy, e.CoverImageURL,
	).Scan(&e.ID, &e.CreatedAt, &e.UpdatedAt)
}

// UpdateEventPresentation curates an event's home-page presentation. The
// boolean $3 says whether the cover is being written at all, so a nil
// cover leaves it alone while "" clears it.
func (r *SQLRepository) UpdateEventPresentation(ctx context.Context, id string, featured *bool, coverImageURL *string) error {
	setCover := coverImageURL != nil
	cover := ""
	if coverImageURL != nil {
		cover = *coverImageURL
	}
	res, err := r.db.ExecContext(ctx,
		`UPDATE prediction_events
		    SET featured = COALESCE($2, featured),
		        cover_image_url = CASE WHEN $3 THEN NULLIF($4, '') ELSE cover_image_url END,
		        updated_at = NOW()
		  WHERE id = $1`,
		id, featured, setCover, cover)
	if err != nil {
		return err
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (r *SQLRepository) UpdateEventStatus(ctx context.Context, id string, status EventStatus) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE prediction_events SET status = $1, updated_at = NOW() WHERE id = $2`,
		status, id)
	return err
}

// --- Markets ---

func (r *SQLRepository) ListMarkets(ctx context.Context, filter MarketFilter) ([]Market, int, error) {
	where, args := buildMarketWhere(filter)
	// COUNT uses unprefixed `prediction_markets` (no `m.` alias), so the
	// where clause has to drop the alias prefix when used here. Rewriting
	// the WHERE in two forms is uglier than aliasing the count query —
	// alias the table.
	countQ := `SELECT COUNT(*) FROM prediction_markets m` + where
	var total int
	if err := r.db.QueryRowContext(ctx, countQ, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	// Use marketSelectQuery() as the single source of truth for the column
	// list. Any future column add lands in one place; ListMarkets and
	// GetMarket etc. all see it. Earlier inline SELECT here drifted apart
	// from marketSelectQuery() when image_path was added (migration 018),
	// breaking ListMarkets with a 500. Don't reintroduce that fork.
	q := `SELECT rm.* FROM (` + marketSelectQuery() + where + `) rm`
	if marketSortNeedsRankingJoins(filter.Sort) {
		// The pe/pc/v24 joins exist solely to feed the activity-ranking
		// ORDER BY (featured flag, category slug, 24h traded volume). Cheap
		// sorts order on rm columns only, so skipping the joins avoids a
		// per-row aggregate over prediction_trades — this is what keeps the
		// SMM/reconciler worker sweeps (Sort:"id") off the expensive shape.
		q += `
	      LEFT JOIN prediction_events pe ON pe.id = rm.event_id
	      LEFT JOIN prediction_categories pc ON pc.id = pe.category_id
	      LEFT JOIN LATERAL (
	          SELECT COALESCE(SUM(t.price_points::bigint * t.quantity), 0)::bigint AS volume_24h_points
	          FROM prediction_trades t
	          WHERE t.market_id = rm.id
	            AND t.traded_at >= NOW() - INTERVAL '24 hours'
	      ) v24 ON true`
	}
	q += marketOrderClause(filter.Sort)
	q += fmt.Sprintf(` LIMIT $%d OFFSET $%d`, len(args)+1, len(args)+2)
	args = append(args, filter.PageSize, (filter.Page-1)*filter.PageSize)

	rows, err := r.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	// Initialize as empty slice so JSON encodes [] for zero-row results.
	// nil-slice encodes as "data": null which is a contract gotcha for
	// every consumer (frontend, mobile, partner API).
	markets := []Market{}
	for rows.Next() {
		m, err := scanMarket(rows)
		if err != nil {
			return nil, 0, err
		}
		markets = append(markets, *m)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	// §3-09 commentCount: one batched, index-backed GROUP BY over just
	// this page's ids — stitched after the scan so marketSelectQuery()
	// (shared with GetMarket and the workers) stays untouched. Gated on
	// the sort being user-facing: the SMM/reconciler sweeps use
	// Sort:"id" and keep their cheap shape, while every sort a person
	// can pick (activity, closing_soon, newest) carries the count the
	// feed card's activity signal needs.
	if strings.TrimSpace(filter.Sort) != "id" && len(markets) > 0 {
		ids := make([]string, len(markets))
		for i := range markets {
			ids[i] = markets[i].ID
		}
		countRows, err := r.db.QueryContext(ctx,
			`SELECT market_id, COUNT(*) FROM prediction_market_comments
			 WHERE market_id = ANY($1) GROUP BY market_id`, pq.Array(ids))
		if err != nil {
			return nil, 0, err
		}
		defer countRows.Close()
		counts := make(map[string]int, len(ids))
		for countRows.Next() {
			var id string
			var n int
			if err := countRows.Scan(&id, &n); err != nil {
				return nil, 0, err
			}
			counts[id] = n
		}
		if err := countRows.Err(); err != nil {
			return nil, 0, err
		}
		for i := range markets {
			markets[i].CommentCount = counts[markets[i].ID]
		}
	}
	return markets, total, nil
}

func (r *SQLRepository) GetMarket(ctx context.Context, id string) (*Market, error) {
	row := r.db.QueryRowContext(ctx, marketSelectQuery()+` WHERE m.id = $1`, id)
	return scanMarketRow(row)
}

func (r *SQLRepository) GetMarketByTicker(ctx context.Context, ticker string) (*Market, error) {
	row := r.db.QueryRowContext(ctx, marketSelectQuery()+` WHERE m.ticker = $1`, ticker)
	return scanMarketRow(row)
}

func (r *SQLRepository) CreateMarket(ctx context.Context, m *Market) error {
	var resultArg interface{}
	if m.Result != nil {
		resultArg = string(*m.Result)
	}
	return r.db.QueryRowContext(ctx,
		`INSERT INTO prediction_markets
		 (event_id, ticker, title, description, translations, status, result,
		  yes_price_points, no_price_points, last_trade_price_points,
		  volume_points, liquidity_points,
		  amm_yes_shares, amm_no_shares,
		  amm_liquidity_param, amm_subsidy_points,
		  settlement_source_key, settlement_cutoff_at, settlement_rule, settlement_params,
		  fallback_source_key, fee_rate_bps, maker_rebate_bps, open_at, close_at, image_path,
		  article_source_id)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
		 RETURNING id, created_at, updated_at`,
		m.EventID, m.Ticker, m.Title, nullStr(m.Description), nullJSONArg(defaultJSONObject(m.Translations)), m.Status, resultArg,
		m.YesPricePoints, m.NoPricePoints, m.LastTradePricePoints,
		m.VolumePoints, m.LiquidityPoints,
		m.AMMYesShares, m.AMMNoShares,
		m.AMMLiquidityParam, m.AMMSubsidyPoints,
		m.SettlementSourceKey, m.SettlementCutoffAt, m.SettlementRule, m.SettlementParams,
		m.FallbackSourceKey, m.FeeRateBps, m.MakerRebateBps, m.OpenAt, m.CloseAt, nullStr(m.ImagePath),
		m.ArticleSourceID,
	).Scan(&m.ID, &m.CreatedAt, &m.UpdatedAt)
}

func (r *SQLRepository) CreateArticleSource(ctx context.Context, src *ArticleSource) error {
	lang := src.Language
	if lang == "" {
		lang = "en"
	}
	// Dedupe on text_hash. The no-op DO UPDATE (bump updated_at) makes
	// RETURNING fire on conflict, so callers always get the canonical id back.
	return r.db.QueryRowContext(ctx,
		`INSERT INTO prediction_article_sources
		 (source_url, source_name, title, author, published_at, language,
		  jurisdiction, excerpt, summary, text_hash, created_by)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		 ON CONFLICT (text_hash) DO UPDATE SET updated_at = now()
		 RETURNING id, created_at, updated_at`,
		src.SourceURL, src.SourceName, src.Title, src.Author, src.PublishedAt, lang,
		nullJSONArg(src.Jurisdiction), src.Excerpt, src.Summary, src.TextHash, src.CreatedBy,
	).Scan(&src.ID, &src.CreatedAt, &src.UpdatedAt)
}

func (r *SQLRepository) LogAIGeneration(ctx context.Context, entry *AIGenerationLog) error {
	return r.db.QueryRowContext(ctx,
		`INSERT INTO prediction_ai_generation_logs
		 (article_source_id, market_id, stage, tier, model_provider, model_name,
		  inference_endpoint, prompt_version, input_json, output_json, risk_level,
		  validator_result, blocked, latency_ms, input_tokens, output_tokens,
		  cost_micros, created_by, request_id, error_message)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
		 RETURNING id, created_at`,
		entry.ArticleSourceID, entry.MarketID, entry.Stage, entry.Tier, entry.ModelProvider, entry.ModelName,
		entry.InferenceEndpoint, entry.PromptVersion, nullJSONArg(entry.InputJSON), nullJSONArg(entry.OutputJSON), entry.RiskLevel,
		nullJSONArg(entry.ValidatorResult), entry.Blocked, entry.LatencyMs, entry.InputTokens, entry.OutputTokens,
		entry.CostMicros, entry.CreatedBy, entry.RequestID, entry.ErrorMessage,
	).Scan(&entry.ID, &entry.CreatedAt)
}

func (r *SQLRepository) LinkAIGenerationLogsToMarket(ctx context.Context, marketID string, logIDs []string, createdBy *string) error {
	for _, id := range logIDs {
		if strings.TrimSpace(id) == "" {
			continue
		}
		var res sql.Result
		var err error
		if createdBy != nil && strings.TrimSpace(*createdBy) != "" {
			res, err = r.db.ExecContext(ctx,
				`UPDATE prediction_ai_generation_logs
				    SET market_id = $1
				  WHERE id = $2 AND created_by = $3`,
				marketID, id, *createdBy,
			)
		} else {
			res, err = r.db.ExecContext(ctx,
				`UPDATE prediction_ai_generation_logs
				    SET market_id = $1
				  WHERE id = $2`,
				marketID, id,
			)
		}
		if err != nil {
			return err
		}
		if n, err := res.RowsAffected(); err == nil && n == 0 {
			return fmt.Errorf("ai generation log %s not found for actor", id)
		}
	}
	return nil
}

func (r *SQLRepository) AIUsage(ctx context.Context, createdBy string, since time.Time) (int, int64, error) {
	var draftCount int
	var totalTokens int64
	err := r.db.QueryRowContext(ctx,
		`SELECT
			   COUNT(*) FILTER (WHERE stage = 'draft_request'),
		   COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0)
		 FROM prediction_ai_generation_logs
		 WHERE created_by = $1 AND created_at >= $2`,
		createdBy, since,
	).Scan(&draftCount, &totalTokens)
	return draftCount, totalTokens, err
}

func (r *SQLRepository) ReserveAIUsage(ctx context.Context, createdBy string, estimatedInputTokens int, ratePerMin int, dailyTokenCap int64, now time.Time) (AIBudgetStatus, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return AIBudgetStatus{}, err
	}
	defer tx.Rollback()

	// Serialize reservations per admin so concurrent office instances cannot all
	// pass the same read-before-insert budget check.
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "ai-budget:"+createdBy); err != nil {
		return AIBudgetStatus{}, err
	}

	recentSince := now.Add(-time.Minute)
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	var recent int
	if err := tx.QueryRowContext(ctx,
		`SELECT COUNT(*) FILTER (WHERE stage = 'draft_request')
		   FROM prediction_ai_generation_logs
		  WHERE created_by = $1 AND created_at >= $2`,
		createdBy, recentSince,
	).Scan(&recent); err != nil {
		return AIBudgetStatus{}, err
	}
	var tokensToday int64
	if err := tx.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0)
		   FROM prediction_ai_generation_logs
		  WHERE created_by = $1 AND created_at >= $2`,
		createdBy, startOfDay,
	).Scan(&tokensToday); err != nil {
		return AIBudgetStatus{}, err
	}

	status := AIBudgetStatus{
		Allowed:            true,
		RequestsLastMinute: recent,
		RatePerMinute:      ratePerMin,
		TokensToday:        tokensToday,
		DailyTokenCap:      dailyTokenCap,
	}
	if recent+1 > ratePerMin {
		status.Allowed = false
		status.Reason = "rate limit exceeded — too many drafts in the last minute"
		return status, tx.Commit()
	}
	if tokensToday+int64(estimatedInputTokens) > dailyTokenCap {
		status.Allowed = false
		status.Reason = "daily AI token budget exhausted"
		return status, tx.Commit()
	}

	tier := "hard"
	promptVersion := "market_draft_v1"
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO prediction_ai_generation_logs
		 (stage, tier, prompt_version, input_tokens, created_by, created_at)
		 VALUES ('draft_request', $1, $2, $3, $4, $5)`,
		tier, promptVersion, estimatedInputTokens, createdBy, now,
	); err != nil {
		return AIBudgetStatus{}, err
	}
	status.RequestsLastMinute++
	status.TokensToday += int64(estimatedInputTokens)
	return status, tx.Commit()
}

func (r *SQLRepository) UpdateMarket(ctx context.Context, m *Market) error {
	return r.updateMarketWithExec(ctx, r.db, m)
}

func (r *SQLRepository) updateMarketWithExec(ctx context.Context, execer sqlRowExecer, m *Market) error {
	_, err := execer.ExecContext(ctx,
		`UPDATE prediction_markets SET
		  event_id=$1, ticker=$2, title=$3, description=$4, translations=$5,
		  status=$6, result=$7, yes_price_points=$8, no_price_points=$9,
		  last_trade_price_points=$10, volume_points=$11, open_interest_points=$12,
		  liquidity_points=$13, amm_yes_shares=$14, amm_no_shares=$15,
		  amm_liquidity_param=$16, amm_subsidy_points=$17,
		  settlement_source_key=$18, settlement_cutoff_at=$19,
		  settlement_rule=$20, settlement_params=$21, fallback_source_key=$22,
		  fee_rate_bps=$23, maker_rebate_bps=$24, open_at=$25, close_at=$26,
		  image_path=$27, article_source_id=$28, updated_at=NOW()
		 WHERE id=$29`,
		m.EventID, m.Ticker, m.Title, nullStr(m.Description), nullJSONArg(defaultJSONObject(m.Translations)),
		m.Status, m.Result, m.YesPricePoints, m.NoPricePoints,
		m.LastTradePricePoints, m.VolumePoints, m.OpenInterestPoints,
		m.LiquidityPoints, m.AMMYesShares, m.AMMNoShares,
		m.AMMLiquidityParam, m.AMMSubsidyPoints,
		m.SettlementSourceKey, m.SettlementCutoffAt,
		m.SettlementRule, nullJSONArg(defaultJSONObject(m.SettlementParams)), m.FallbackSourceKey,
		m.FeeRateBps, m.MakerRebateBps, m.OpenAt, m.CloseAt,
		nullStr(m.ImagePath), m.ArticleSourceID, m.ID)
	return err
}

// transitionMarketStatusWithExec persists the same fields as
// updateMarketWithExec but guards the write on the status the caller
// validated (optimistic concurrency on the lifecycle FSM). Zero rows updated
// means a concurrent settle/void/lifecycle transition won the race; the
// caller's transaction must abort so none of its money side-effects commit.
// Mirrors the guard PersistProposalAtomic has used since ADR-0003/0004.
func (r *SQLRepository) transitionMarketStatusWithExec(ctx context.Context, execer sqlRowExecer, m *Market, expectedPrev MarketStatus) error {
	res, err := execer.ExecContext(ctx,
		`UPDATE prediction_markets SET
		  status=$1, result=$2, yes_price_points=$3, no_price_points=$4,
		  last_trade_price_points=$5, volume_points=$6, open_interest_points=$7,
		  liquidity_points=$8, amm_yes_shares=$9, amm_no_shares=$10,
		  updated_at=NOW()
		 WHERE id=$11 AND status=$12`,
		m.Status, m.Result, m.YesPricePoints, m.NoPricePoints,
		m.LastTradePricePoints, m.VolumePoints, m.OpenInterestPoints,
		m.LiquidityPoints, m.AMMYesShares, m.AMMNoShares,
		m.ID, string(expectedPrev))
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return fmt.Errorf("market %s: expected status %q: %w", m.ID, expectedPrev, ErrStaleMarketStatus)
	}
	return nil
}

// UpdateMarketStatus performs a guarded compare-and-set: the row is updated
// only while its current status still equals expectedPrev (mirroring
// transitionMarketStatusWithExec). This stops the closer or an admin
// transition from silently clobbering a concurrent settle/void — which would
// resurrect a terminal market into a settleable state and double-pay.
// Returns ErrStaleMarketStatus when the precondition no longer holds.
func (r *SQLRepository) UpdateMarketStatus(ctx context.Context, id string, status, expectedPrev MarketStatus) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE prediction_markets SET status = $1, updated_at = NOW() WHERE id = $2 AND status = $3`,
		status, id, string(expectedPrev))
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return fmt.Errorf("market %s: expected status %q: %w", id, expectedPrev, ErrStaleMarketStatus)
	}
	return nil
}

func (r *SQLRepository) ListMarketsToClose(ctx context.Context) ([]Market, error) {
	rows, err := r.db.QueryContext(ctx,
		marketSelectQuery()+` WHERE m.status = 'open' AND m.close_at <= $1`, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanMarkets(rows)
}

func (r *SQLRepository) ListMarketsToSettle(ctx context.Context) ([]Market, error) {
	rows, err := r.db.QueryContext(ctx,
		marketSelectQuery()+` WHERE m.status = 'closed' AND m.settlement_cutoff_at <= $1
		  AND m.id NOT IN (SELECT market_id FROM prediction_settlements)`,
		time.Now().UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanMarkets(rows)
}

// --- Orders ---

func (r *SQLRepository) ListOrders(ctx context.Context, filter OrderFilter) ([]Order, int, error) {
	where := ` WHERE user_id = $1`
	args := []interface{}{filter.UserID}
	idx := 2
	if filter.MarketID != nil {
		where += fmt.Sprintf(` AND market_id = $%d`, idx)
		args = append(args, *filter.MarketID)
		idx++
	}
	if filter.Status != nil {
		where += fmt.Sprintf(` AND status = $%d`, idx)
		args = append(args, *filter.Status)
		idx++
	}

	var total int
	if err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM prediction_orders`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	q := `SELECT id, user_id, market_id, side, action, order_type, price_points,
	             quantity, filled_quantity, remaining_quantity, total_cost_points,
	             status, wallet_reservation_id, idempotency_key,
	             expires_at, filled_at, cancelled_at, created_at, updated_at
	      FROM prediction_orders` + where + ` ORDER BY created_at DESC`
	q += fmt.Sprintf(` LIMIT $%d OFFSET $%d`, len(args)+1, len(args)+2)
	args = append(args, filter.PageSize, (filter.Page-1)*filter.PageSize)

	rows, err := r.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var orders []Order
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			return nil, 0, err
		}
		orders = append(orders, *o)
	}
	return orders, total, rows.Err()
}

// ListRestingOrdersOnInactiveMarkets returns open/partial orders whose
// market is closed/settled/voided — orders that can never match again but
// were never finalized, so their RG committed stake + wallet reservation
// stay counted. Oldest first so the sweep drains the backlog deterministically.
func (r *SQLRepository) ListRestingOrdersOnInactiveMarkets(ctx context.Context, limit int) ([]Order, error) {
	if limit <= 0 {
		limit = 500
	}
	rows, err := r.db.QueryContext(ctx,
		`SELECT o.id, o.user_id, o.market_id, o.side, o.action, o.order_type, o.price_points,
		        o.quantity, o.filled_quantity, o.remaining_quantity, o.total_cost_points,
		        o.status, o.wallet_reservation_id, o.idempotency_key,
		        o.expires_at, o.filled_at, o.cancelled_at, o.created_at, o.updated_at
		   FROM prediction_orders o
		   JOIN prediction_markets m ON m.id = o.market_id
		  WHERE o.status IN ('open','partial')
		    AND m.status IN ('closed','settled','voided')
		  ORDER BY o.created_at
		  LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var orders []Order
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			return nil, err
		}
		orders = append(orders, *o)
	}
	return orders, rows.Err()
}

func (r *SQLRepository) GetOrder(ctx context.Context, id string) (*Order, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT id, user_id, market_id, side, action, order_type, price_points,
		        quantity, filled_quantity, remaining_quantity, total_cost_points,
		        status, wallet_reservation_id, idempotency_key,
		        expires_at, filled_at, cancelled_at, created_at, updated_at
		 FROM prediction_orders WHERE id = $1`, id)
	return scanOrderRow(row)
}

func (r *SQLRepository) GetOrderByIdempotencyKey(ctx context.Context, key string) (*Order, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT id, user_id, market_id, side, action, order_type, price_points,
		        quantity, filled_quantity, remaining_quantity, total_cost_points,
		        status, wallet_reservation_id, idempotency_key,
		        expires_at, filled_at, cancelled_at, created_at, updated_at
		 FROM prediction_orders WHERE idempotency_key = $1`, key)
	return scanOrderRow(row)
}

func (r *SQLRepository) CreateOrder(ctx context.Context, o *Order) error {
	return r.createOrderWithExec(ctx, r.db, o)
}

func (r *SQLRepository) createOrderWithExec(ctx context.Context, execer sqlRowExecer, o *Order) error {
	if err := r.ensurePunterExistsWithExec(ctx, execer, o.UserID); err != nil {
		return err
	}
	return execer.QueryRowContext(ctx,
		`INSERT INTO prediction_orders
		 (user_id, market_id, side, action, order_type, price_points,
		  quantity, filled_quantity, remaining_quantity, total_cost_points,
		  status, wallet_reservation_id, idempotency_key, expires_at, filled_at,
		  reserved_points, captured_points, failure_reason)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
		 RETURNING id, created_at, updated_at`,
		o.UserID, o.MarketID, o.Side, o.Action, o.OrderType, o.PricePoints,
		o.Quantity, o.FilledQuantity, o.RemainingQuantity, o.TotalCostPoints,
		o.Status, o.WalletReservationID, o.IdempotencyKey, o.ExpiresAt, o.FilledAt,
		o.ReservedCashPoints, o.CapturedCashPoints, o.FailureReason,
	).Scan(&o.ID, &o.CreatedAt, &o.UpdatedAt)
}

func (r *SQLRepository) UpdateOrder(ctx context.Context, o *Order) error {
	// failure_reason is persisted so engine/persist-failure rejects keep
	// their reason on the DB row, not only in the in-flight API response
	// (the column existed but nothing ever wrote it).
	_, err := r.db.ExecContext(ctx,
		`UPDATE prediction_orders SET
		  filled_quantity=$1, remaining_quantity=$2, status=$3,
		  filled_at=$4, cancelled_at=$5, failure_reason=$6, updated_at=NOW()
		 WHERE id=$7`,
		o.FilledQuantity, o.RemainingQuantity, o.Status,
		o.FilledAt, o.CancelledAt, o.FailureReason, o.ID)
	return err
}

// --- Positions ---

func (r *SQLRepository) ListPositions(ctx context.Context, userID string) ([]Position, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, user_id, market_id, side, quantity, avg_price_points, total_cost_points,
		        realized_pnl_points, reserved_quantity, created_at, updated_at
		 FROM prediction_positions WHERE user_id = $1 AND quantity > 0
		 ORDER BY updated_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var positions []Position
	for rows.Next() {
		var p Position
		if err := rows.Scan(&p.ID, &p.UserID, &p.MarketID, &p.Side, &p.Quantity,
			&p.AvgPricePoints, &p.TotalCostPoints, &p.RealizedPnlPoints, &p.ReservedQuantity, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		positions = append(positions, p)
	}
	return positions, rows.Err()
}

func (r *SQLRepository) GetPosition(ctx context.Context, userID, marketID string, side OrderSide) (*Position, error) {
	var p Position
	err := r.db.QueryRowContext(ctx,
		`SELECT id, user_id, market_id, side, quantity, avg_price_points, total_cost_points,
		        realized_pnl_points, reserved_quantity, created_at, updated_at
		 FROM prediction_positions WHERE user_id = $1 AND market_id = $2 AND side = $3`,
		userID, marketID, side,
	).Scan(&p.ID, &p.UserID, &p.MarketID, &p.Side, &p.Quantity,
		&p.AvgPricePoints, &p.TotalCostPoints, &p.RealizedPnlPoints, &p.ReservedQuantity,
		&p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrPositionNotFound
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (r *SQLRepository) UpsertPosition(ctx context.Context, p *Position) error {
	return r.upsertPositionWithExec(ctx, r.db, p)
}

func (r *SQLRepository) upsertPositionWithExec(ctx context.Context, execer sqlRowExecer, p *Position) error {
	if err := r.ensurePunterExistsWithExec(ctx, execer, p.UserID); err != nil {
		return err
	}
	return execer.QueryRowContext(ctx,
		`INSERT INTO prediction_positions (user_id, market_id, side, quantity, avg_price_points, total_cost_points, realized_pnl_points)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 ON CONFLICT (user_id, market_id, side) DO UPDATE SET
		   quantity = EXCLUDED.quantity,
		   avg_price_points = EXCLUDED.avg_price_points,
		   total_cost_points = EXCLUDED.total_cost_points,
		   realized_pnl_points = EXCLUDED.realized_pnl_points,
		   updated_at = NOW()
		 RETURNING id, created_at, updated_at`,
		p.UserID, p.MarketID, p.Side, p.Quantity, p.AvgPricePoints, p.TotalCostPoints, p.RealizedPnlPoints,
	).Scan(&p.ID, &p.CreatedAt, &p.UpdatedAt)
}

func (r *SQLRepository) upsertPositionWithReservedWithExec(ctx context.Context, execer sqlRowExecer, p *Position) error {
	if err := r.ensurePunterExistsWithExec(ctx, execer, p.UserID); err != nil {
		return err
	}
	return execer.QueryRowContext(ctx,
		`INSERT INTO prediction_positions
		   (user_id, market_id, side, quantity, avg_price_points, total_cost_points, realized_pnl_points, reserved_quantity)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 ON CONFLICT (user_id, market_id, side) DO UPDATE SET
		   quantity = EXCLUDED.quantity,
		   avg_price_points = EXCLUDED.avg_price_points,
		   total_cost_points = EXCLUDED.total_cost_points,
		   realized_pnl_points = EXCLUDED.realized_pnl_points,
		   reserved_quantity = EXCLUDED.reserved_quantity,
		   updated_at = NOW()
		 RETURNING id, created_at, updated_at`,
		p.UserID, p.MarketID, p.Side, p.Quantity, p.AvgPricePoints, p.TotalCostPoints, p.RealizedPnlPoints, p.ReservedQuantity,
	).Scan(&p.ID, &p.CreatedAt, &p.UpdatedAt)
}

func (r *SQLRepository) ListPositionsByMarket(ctx context.Context, marketID string) ([]Position, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, user_id, market_id, side, quantity, avg_price_points, total_cost_points,
		        realized_pnl_points, reserved_quantity, created_at, updated_at
		 FROM prediction_positions WHERE market_id = $1 AND quantity > 0`, marketID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var positions []Position
	for rows.Next() {
		var p Position
		if err := rows.Scan(&p.ID, &p.UserID, &p.MarketID, &p.Side, &p.Quantity,
			&p.AvgPricePoints, &p.TotalCostPoints, &p.RealizedPnlPoints, &p.ReservedQuantity, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		positions = append(positions, p)
	}
	return positions, rows.Err()
}

// --- Trades ---

func (r *SQLRepository) ListTrades(ctx context.Context, marketID string, limit int) ([]Trade, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, market_id, buy_order_id, sell_order_id, buyer_id, seller_id,
		        side, price_points, quantity, fee_points, is_amm_trade, traded_at
		 FROM prediction_trades WHERE market_id = $1 ORDER BY traded_at DESC LIMIT $2`,
		marketID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var trades []Trade
	for rows.Next() {
		var t Trade
		var buyOID, sellOID, sellerID sql.NullString
		if err := rows.Scan(&t.ID, &t.MarketID, &buyOID, &sellOID, &t.BuyerID, &sellerID,
			&t.Side, &t.PricePoints, &t.Quantity, &t.FeePoints, &t.IsAMMTrade, &t.TradedAt); err != nil {
			return nil, err
		}
		if buyOID.Valid {
			t.BuyOrderID = &buyOID.String
		}
		if sellOID.Valid {
			t.SellOrderID = &sellOID.String
		}
		if sellerID.Valid {
			t.SellerID = &sellerID.String
		}
		trades = append(trades, t)
	}
	return trades, rows.Err()
}

func (r *SQLRepository) CreateTrade(ctx context.Context, t *Trade) error {
	return r.createTradeWithExec(ctx, r.db, t)
}

func (r *SQLRepository) createTradeWithExec(ctx context.Context, execer sqlRowExecer, t *Trade) error {
	if err := r.ensurePunterExistsWithExec(ctx, execer, t.BuyerID); err != nil {
		return err
	}
	if t.SellerID != nil {
		if err := r.ensurePunterExistsWithExec(ctx, execer, *t.SellerID); err != nil {
			return err
		}
	}
	// Migration 019 added match_id / trade_kind / engine_kind as NOT NULL.
	// The exchange path populates them explicitly via sql_exchange_repository.go.
	// This AMM path (still the only one for amm markets) didn't, which broke
	// every AMM order with `null value in column "match_id" violates
	// not-null constraint`. Defaults that make sense for AMM trades:
	//   match_id   = the trade's own id (matches the migration backfill rule
	//                — AMM trades aren't paired so a self-reference is the
	//                cleanest "match")
	//   trade_kind = 'secondary' (curve-driven single-counterparty fills,
	//                not the complementary YES+NO mint of issuance)
	//   engine_kind = 'amm'
	// gen_random_uuid() once + reuse for both id and match_id keeps the
	// invariant `id = match_id` for unpaired trades.
	return execer.QueryRowContext(ctx,
		`WITH new_id AS (SELECT gen_random_uuid() AS id)
		 INSERT INTO prediction_trades
		 (id, match_id, market_id, buy_order_id, sell_order_id,
		  buyer_id, seller_id, side, price_points, quantity, fee_points,
		  is_amm_trade, trade_kind, engine_kind)
		 SELECT new_id.id, new_id.id, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
		        'secondary', 'amm'
		 FROM new_id
		 RETURNING id, traded_at`,
		t.MarketID, t.BuyOrderID, t.SellOrderID, t.BuyerID, t.SellerID,
		t.Side, t.PricePoints, t.Quantity, t.FeePoints, t.IsAMMTrade,
	).Scan(&t.ID, &t.TradedAt)
}

func (r *SQLRepository) PersistFilledOrder(ctx context.Context, order *Order, trade *Trade, position *Position, market *Market) error {
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if err := r.persistFilledOrderWithTx(ctx, tx, order, trade, position, market); err != nil {
		return err
	}

	return tx.Commit()
}

func (r *SQLRepository) PersistFilledOrderAtomic(
	ctx context.Context,
	wallet WalletAdapter,
	userID string,
	totalCost int64,
	debitKey string,
	debitReason string,
	order *Order,
	trade *Trade,
	position *Position,
	market *Market,
) error {
	txWallet, ok := wallet.(TxWalletAdapter)
	if !ok {
		return fmt.Errorf("wallet does not support shared transactions")
	}

	tx, err := txWallet.BeginTx(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if err := txWallet.DebitWithTx(ctx, tx, userID, totalCost, debitKey, debitReason); err != nil {
		return fmt.Errorf("wallet debit failed: %w", err)
	}

	if err := r.persistFilledOrderWithTx(ctx, tx, order, trade, position, market); err != nil {
		return err
	}

	return tx.Commit()
}

func (r *SQLRepository) persistFilledOrderWithTx(ctx context.Context, tx *sql.Tx, order *Order, trade *Trade, position *Position, market *Market) error {
	if err := r.createOrderWithExec(ctx, tx, order); err != nil {
		return err
	}
	if err := r.createTradeWithExec(ctx, tx, trade); err != nil {
		return err
	}
	if err := r.upsertPositionWithExec(ctx, tx, position); err != nil {
		return err
	}
	if err := r.updateMarketWithExec(ctx, tx, market); err != nil {
		return err
	}
	return nil
}

func (r *SQLRepository) PersistResolvedMarketAtomic(
	ctx context.Context,
	wallet WalletAdapter,
	market *Market,
	prevStatus MarketStatus,
	settlement *Settlement,
	payouts []Payout,
	credits []WalletCreditRequest,
	loyalty LoyaltyAdapter,
	accruals []LoyaltyAccrualRequest,
	lifecycle *LifecycleEvent,
) ([]LoyaltyAccrualResult, error) {
	txWallet, ok := wallet.(TxWalletAdapter)
	if !ok {
		return nil, fmt.Errorf("wallet does not support shared transactions")
	}

	tx, err := txWallet.BeginTx(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	// Status-guarded transition FIRST: it takes the market row lock and
	// fails fast with ErrStaleMarketStatus if a concurrent settle/void won,
	// before any payout or credit is written (COR-01).
	if err := r.transitionMarketStatusWithExec(ctx, tx, market, prevStatus); err != nil {
		return nil, err
	}

	if err := r.createSettlementWithExec(ctx, tx, settlement); err != nil {
		return nil, err
	}
	for i := range payouts {
		payouts[i].SettlementID = settlement.ID
		if err := r.createPayoutWithExec(ctx, tx, &payouts[i]); err != nil {
			return nil, err
		}
		if err := r.closeSettledPositionWithExec(ctx, tx, payouts[i].PositionID, payouts[i].PnlPoints); err != nil {
			return nil, fmt.Errorf("close settled position %s: %w", payouts[i].PositionID, err)
		}
	}
	for _, credit := range credits {
		if err := txWallet.CreditWithTx(ctx, tx, credit.UserID, credit.AmountPoints, credit.IdempotencyKey, credit.Reason); err != nil {
			return nil, fmt.Errorf("wallet credit failed for user %s: %w", credit.UserID, err)
		}
	}
	var loyaltyResults []LoyaltyAccrualResult
	if loyalty != nil {
		for _, accrual := range accruals {
			res, err := loyalty.AccrueSettledWithTx(ctx, tx, accrual)
			if err != nil {
				return nil, fmt.Errorf("loyalty accrual failed for user %s: %w", accrual.UserID, err)
			}
			if res != nil {
				loyaltyResults = append(loyaltyResults, *res)
			}
		}
	}
	if lifecycle != nil {
		if err := r.createLifecycleEventWithExec(ctx, tx, lifecycle); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return loyaltyResults, nil
}

// PersistSettlementHeader commits the settlement header — the status-guarded
// transition (COR-01), the settlement row with its payouts_total snapshot, and
// the lifecycle event — in one fast transaction, releasing the market lock
// before the payout batches run (P3-12 / COR-05).
func (r *SQLRepository) PersistSettlementHeader(ctx context.Context, market *Market, prevStatus MarketStatus, settlement *Settlement, lifecycle *LifecycleEvent) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if err := r.transitionMarketStatusWithExec(ctx, tx, market, prevStatus); err != nil {
		return err
	}
	if err := tx.QueryRowContext(ctx,
		`INSERT INTO prediction_settlements
		 (market_id, result, attestation_source, attestation_id, attestation_digest,
		  attestation_data, settled_by, total_payout_points, positions_settled,
		  payouts_total, payouts_completed)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0)
		 RETURNING id, settled_at`,
		settlement.MarketID, settlement.Result, settlement.AttestationSource,
		settlement.AttestationID, settlement.AttestationDigest, settlement.AttestationData,
		settlement.SettledBy, settlement.TotalPayoutPoints, settlement.PositionsSettled,
		settlement.PayoutsTotal,
	).Scan(&settlement.ID, &settlement.SettledAt); err != nil {
		return fmt.Errorf("insert settlement header: %w", err)
	}
	if lifecycle != nil {
		if err := r.createLifecycleEventWithExec(ctx, tx, lifecycle); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// CommitPayoutBatch writes one chunk of positions' payouts, position closes,
// wallet credits, and loyalty accruals, then re-derives payouts_completed from
// the actual payout-row count — all in one transaction (P3-12). Every write is
// idempotent and the cursor is recomputed (not incremented), so a re-applied
// batch after a crash, or a duplicate batch from two concurrent resume passes,
// can neither double-pay nor over-count (audit COR-05 resume safety).
func (r *SQLRepository) CommitPayoutBatch(ctx context.Context, wallet WalletAdapter, settlementID string, payouts []Payout, credits []*WalletCreditRequest, loyalty LoyaltyAdapter, accruals []*LoyaltyAccrualRequest) ([]LoyaltyAccrualResult, error) {
	if len(payouts) == 0 {
		return nil, nil
	}
	txWallet, ok := wallet.(TxWalletAdapter)
	if !ok {
		return nil, fmt.Errorf("wallet does not support shared transactions")
	}
	tx, err := txWallet.BeginTx(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var loyaltyResults []LoyaltyAccrualResult
	for i := range payouts {
		payouts[i].SettlementID = settlementID
		if err := r.createPayoutWithExec(ctx, tx, &payouts[i]); err != nil {
			return nil, fmt.Errorf("create payout for position %s: %w", payouts[i].PositionID, err)
		}
		if err := r.closeSettledPositionWithExec(ctx, tx, payouts[i].PositionID, payouts[i].PnlPoints); err != nil {
			return nil, fmt.Errorf("close settled position %s: %w", payouts[i].PositionID, err)
		}
		if i < len(credits) && credits[i] != nil {
			if err := txWallet.CreditWithTx(ctx, tx, credits[i].UserID, credits[i].AmountPoints, credits[i].IdempotencyKey, credits[i].Reason); err != nil {
				return nil, fmt.Errorf("wallet credit for user %s: %w", credits[i].UserID, err)
			}
		}
		if loyalty != nil && i < len(accruals) && accruals[i] != nil {
			res, err := loyalty.AccrueSettledWithTx(ctx, tx, *accruals[i])
			if err != nil {
				return nil, fmt.Errorf("loyalty accrual for user %s: %w", accruals[i].UserID, err)
			}
			if res != nil {
				loyaltyResults = append(loyaltyResults, *res)
			}
		}
	}
	// Recompute the cursor from the source of truth (payout rows) rather than
	// incrementing, so a re-run or concurrent batch is self-correcting.
	if _, err := tx.ExecContext(ctx,
		`UPDATE prediction_settlements
		   SET payouts_completed = (SELECT COUNT(*) FROM prediction_payouts WHERE settlement_id = $1)
		 WHERE id = $1`,
		settlementID,
	); err != nil {
		return nil, fmt.Errorf("advance payout cursor: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return loyaltyResults, nil
}

// ListUnpaidSettlementPositions returns up to `limit` positions for the market
// that still have no payout row for this settlement and a positive quantity, in
// stable id order. Already-paid positions are excluded (they carry a payout row
// and quantity 0), so recomputing their payout from the live row — which has
// been zeroed — is never attempted. Drives the resume scanner.
func (r *SQLRepository) ListUnpaidSettlementPositions(ctx context.Context, settlementID, marketID string, limit int) ([]Position, error) {
	if limit <= 0 {
		limit = 500
	}
	rows, err := r.db.QueryContext(ctx,
		`SELECT p.id, p.user_id, p.market_id, p.side, p.quantity, p.avg_price_points,
		        p.total_cost_points, p.realized_pnl_points, p.reserved_quantity,
		        p.created_at, p.updated_at
		 FROM prediction_positions p
		 WHERE p.market_id = $1 AND p.quantity > 0
		   AND NOT EXISTS (
		     SELECT 1 FROM prediction_payouts pay
		     WHERE pay.settlement_id = $2 AND pay.position_id = p.id)
		 ORDER BY p.id
		 LIMIT $3`, marketID, settlementID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var positions []Position
	for rows.Next() {
		var p Position
		if err := rows.Scan(&p.ID, &p.UserID, &p.MarketID, &p.Side, &p.Quantity,
			&p.AvgPricePoints, &p.TotalCostPoints, &p.RealizedPnlPoints, &p.ReservedQuantity, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		positions = append(positions, p)
	}
	return positions, rows.Err()
}

// ListIncompleteSettlements returns up to `limit` settlements whose
// disbursement did not finish (payouts_completed < payouts_total), oldest
// first. Drives the resume scanner (P3-12).
func (r *SQLRepository) ListIncompleteSettlements(ctx context.Context, limit int) ([]Settlement, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, market_id, result, attestation_source, attestation_id,
		        attestation_digest, attestation_data, settled_by, settled_at,
		        total_payout_points, positions_settled, payouts_total, payouts_completed
		 FROM prediction_settlements
		 WHERE payouts_completed < payouts_total
		 ORDER BY settled_at
		 LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Settlement
	for rows.Next() {
		var s Settlement
		var attID, attDigest, settledBy sql.NullString
		var attData []byte // attestation_data may be NULL
		if err := rows.Scan(&s.ID, &s.MarketID, &s.Result, &s.AttestationSource, &attID,
			&attDigest, &attData, &settledBy, &s.SettledAt,
			&s.TotalPayoutPoints, &s.PositionsSettled, &s.PayoutsTotal, &s.PayoutsCompleted); err != nil {
			return nil, err
		}
		if attData != nil {
			s.AttestationData = attData
		}
		if attID.Valid {
			s.AttestationID = &attID.String
		}
		if attDigest.Valid {
			s.AttestationDigest = &attDigest.String
		}
		if settledBy.Valid {
			s.SettledBy = &settledBy.String
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// PersistProposalAtomic records a resolution proposal and the closed ->
// proposed_resolution market transition (plus the lifecycle event) in one
// transaction (ADR-0003/0004). The market UPDATE is guarded on status='closed',
// so a stale read or a concurrent propose cannot double-transition: if it
// doesn't update exactly one row the whole tx rolls back and nothing is
// written. This prevents the unrecoverable orphan a crash between two separate
// writes would otherwise leave (a proposal row on a still-closed market that
// UNIQUE(market_id) blocks from being re-proposed).
func (r *SQLRepository) PersistProposalAtomic(ctx context.Context, proposal *ResolutionProposal, lifecycle *LifecycleEvent) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	res, err := tx.ExecContext(ctx,
		`UPDATE prediction_markets SET status=$1, result=$2, updated_at=NOW()
		 WHERE id=$3 AND status=$4`,
		MarketStatusProposedResolution, proposal.Result, proposal.MarketID, MarketStatusClosed,
	)
	if err != nil {
		return fmt.Errorf("transition market: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return fmt.Errorf("market %s is not closed; cannot propose", proposal.MarketID)
	}

	if err := tx.QueryRowContext(ctx,
		`INSERT INTO prediction_resolution_proposals
		   (market_id, result, status, attestation_source, attestation_id,
		    attestation_digest, attestation_data, proposed_by, challenge_ends_at, proposed_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		 RETURNING id`,
		proposal.MarketID, proposal.Result, proposal.Status, proposal.AttestationSource,
		proposal.AttestationID, proposal.AttestationDigest, string(proposal.AttestationData),
		proposal.ProposedBy, proposal.ChallengeEndsAt, proposal.ProposedAt,
	).Scan(&proposal.ID); err != nil {
		return fmt.Errorf("insert proposal: %w", err)
	}

	if lifecycle != nil {
		if err := r.createLifecycleEventWithExec(ctx, tx, lifecycle); err != nil {
			return fmt.Errorf("create lifecycle event: %w", err)
		}
	}
	return tx.Commit()
}

func (r *SQLRepository) PersistVoidedMarketAtomic(
	ctx context.Context,
	wallet WalletAdapter,
	market *Market,
	prevStatus MarketStatus,
	payouts []Payout,
	credits []WalletCreditRequest,
	lifecycle *LifecycleEvent,
) error {
	txWallet, ok := wallet.(TxWalletAdapter)
	if !ok {
		return fmt.Errorf("wallet does not support shared transactions")
	}

	tx, err := txWallet.BeginTx(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	// Status-guarded transition FIRST — a void must never land on top of a
	// concurrent settle (or another void): if the status moved since the
	// engine validated it, abort before any refund is written (COR-01).
	if err := r.transitionMarketStatusWithExec(ctx, tx, market, prevStatus); err != nil {
		return err
	}
	for _, credit := range credits {
		if err := txWallet.CreditWithTx(ctx, tx, credit.UserID, credit.AmountPoints, credit.IdempotencyKey, credit.Reason); err != nil {
			return fmt.Errorf("wallet credit failed for user %s: %w", credit.UserID, err)
		}
	}
	if lifecycle != nil {
		if err := r.createLifecycleEventWithExec(ctx, tx, lifecycle); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// --- Settlements ---

func (r *SQLRepository) GetSettlement(ctx context.Context, marketID string) (*Settlement, error) {
	var s Settlement
	var attID, attDigest, settledBy sql.NullString
	err := r.db.QueryRowContext(ctx,
		`SELECT id, market_id, result, attestation_source, attestation_id,
		        attestation_digest, attestation_data, settled_by, settled_at,
		        total_payout_points, positions_settled
		 FROM prediction_settlements WHERE market_id = $1`, marketID,
	).Scan(&s.ID, &s.MarketID, &s.Result, &s.AttestationSource, &attID,
		&attDigest, &s.AttestationData, &settledBy, &s.SettledAt,
		&s.TotalPayoutPoints, &s.PositionsSettled)
	if err != nil {
		return nil, err
	}
	if attID.Valid {
		s.AttestationID = &attID.String
	}
	if attDigest.Valid {
		s.AttestationDigest = &attDigest.String
	}
	if settledBy.Valid {
		s.SettledBy = &settledBy.String
	}
	return &s, nil
}

func (r *SQLRepository) CreateSettlement(ctx context.Context, s *Settlement) error {
	return r.createSettlementWithExec(ctx, r.db, s)
}

// GetMarketJurisdictionPolicy returns the parsed per-market jurisdiction overlay
// (P3-07), or (nil, nil) when the market carries no policy or does not exist
// (the order path's own market load produces the canonical not-found error).
func (r *SQLRepository) GetMarketJurisdictionPolicy(ctx context.Context, marketID string) (*MarketJurisdictionPolicy, error) {
	var raw []byte
	err := r.db.QueryRowContext(ctx,
		`SELECT jurisdiction_policy FROM prediction_markets WHERE id=$1`, marketID,
	).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return ParseMarketJurisdictionPolicy(raw)
}

// SetMarketJurisdictionPolicy writes (policy != nil) or clears (policy == nil)
// the per-market jurisdiction overlay. Errors if the market does not exist.
func (r *SQLRepository) SetMarketJurisdictionPolicy(ctx context.Context, marketID string, policy *MarketJurisdictionPolicy) error {
	var raw interface{} // nil → SQL NULL (clears the overlay)
	if policy != nil {
		b, err := json.Marshal(policy)
		if err != nil {
			return err
		}
		raw = b
	}
	res, err := r.db.ExecContext(ctx,
		`UPDATE prediction_markets SET jurisdiction_policy=$1, updated_at=NOW() WHERE id=$2`,
		raw, marketID,
	)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return fmt.Errorf("market %s not found", marketID)
	}
	return nil
}

func (r *SQLRepository) createSettlementWithExec(ctx context.Context, execer sqlRowExecer, s *Settlement) error {
	return execer.QueryRowContext(ctx,
		`INSERT INTO prediction_settlements
		 (market_id, result, attestation_source, attestation_id,
		  attestation_digest, attestation_data, settled_by, total_payout_points, positions_settled)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		 RETURNING id, settled_at`,
		s.MarketID, s.Result, s.AttestationSource, s.AttestationID,
		s.AttestationDigest, s.AttestationData, s.SettledBy,
		s.TotalPayoutPoints, s.PositionsSettled,
	).Scan(&s.ID, &s.SettledAt)
}

func (r *SQLRepository) CreatePayout(ctx context.Context, p *Payout) error {
	return r.createPayoutWithExec(ctx, r.db, p)
}

func (r *SQLRepository) createPayoutWithExec(ctx context.Context, execer sqlRowExecer, p *Payout) error {
	if err := r.ensurePunterExistsWithExec(ctx, execer, p.UserID); err != nil {
		return err
	}
	// ON CONFLICT makes this idempotent against uq_payout_settlement_position
	// (migration 034): a resumed/retried settlement batch that re-inserts the
	// payout for a (settlement, position) already paid is a no-op rather than a
	// duplicate row. In the single-tx path no conflict ever fires, so the
	// RETURNING populates p.ID/p.PaidAt exactly as before. On conflict the
	// RETURNING yields no row (sql.ErrNoRows) — that is the success signal for
	// the resume path, so we swallow it.
	err := execer.QueryRowContext(ctx,
		`INSERT INTO prediction_payouts
		 (settlement_id, position_id, user_id, market_id, side,
		  quantity, entry_price_points, exit_price_points, pnl_points, payout_points)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		 ON CONFLICT (settlement_id, position_id) DO NOTHING
		 RETURNING id, paid_at`,
		p.SettlementID, p.PositionID, p.UserID, p.MarketID, p.Side,
		p.Quantity, p.EntryPricePoints, p.ExitPricePoints, p.PnlPoints, p.PayoutPoints,
	).Scan(&p.ID, &p.PaidAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	return err
}

// closeSettledPositionWithExec zeroes a settled position's quantity AND its
// cost basis, and writes the realized pnl from its payout. Quantity is zeroed
// so the portfolio summary (filters `quantity > 0`) stops counting settled
// holdings. Cost basis (total_cost_points, avg_price_points) must ALSO reset:
// the contracts are gone, so the next buy into this market is a fresh basis.
// Leaving them caused F-4 — a re-buy ran avg = (stale_total + new_cost) / qty
// in service.go, producing >100¢ avg prices (577¢, 1229¢) that settlement
// then copied verbatim into prediction_payouts.entry_price_points and the
// portfolio History "Entry" column. The Payout row for THIS settlement is
// built before this call (settlement.go), so its recorded entry price / pnl
// are unaffected. realized_pnl_points accumulates and is preserved.
func (r *SQLRepository) closeSettledPositionWithExec(ctx context.Context, execer sqlRowExecer, positionID string, pnlPoints int64) error {
	// The `AND quantity > 0` guard makes this idempotent: realized_pnl_points is
	// accumulated (+= $2), so re-running a settlement batch on a position that
	// was already closed (quantity == 0) would otherwise double-count its PnL.
	// With the guard a re-close matches zero rows and is a no-op. Required by
	// the resumable batched settler (P3-12); harmless in the single-tx path
	// where each position is closed exactly once.
	_, err := execer.ExecContext(ctx,
		`UPDATE prediction_positions
		   SET quantity = 0,
		       total_cost_points = 0,
		       avg_price_points = 0,
		       realized_pnl_points = realized_pnl_points + $2,
		       updated_at = NOW()
		 WHERE id = $1 AND quantity > 0`,
		positionID, pnlPoints,
	)
	return err
}

// --- Lifecycle Events ---

func (r *SQLRepository) ListLifecycleEvents(ctx context.Context, marketID string) ([]LifecycleEvent, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, market_id, event_type, actor_id, actor_type, reason, metadata, occurred_at
		 FROM prediction_lifecycle_events WHERE market_id = $1 ORDER BY occurred_at ASC`, marketID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []LifecycleEvent
	for rows.Next() {
		var e LifecycleEvent
		var actorID, reason, metadata sql.NullString
		if err := rows.Scan(&e.ID, &e.MarketID, &e.EventType, &actorID, &e.ActorType, &reason, &metadata, &e.OccurredAt); err != nil {
			return nil, err
		}
		if actorID.Valid {
			e.ActorID = &actorID.String
		}
		if reason.Valid {
			e.Reason = &reason.String
		}
		if metadata.Valid {
			e.Metadata = json.RawMessage(metadata.String)
		}
		events = append(events, e)
	}
	return events, rows.Err()
}

func (r *SQLRepository) CreateLifecycleEvent(ctx context.Context, e *LifecycleEvent) error {
	return r.createLifecycleEventWithExec(ctx, r.db, e)
}

func (r *SQLRepository) createLifecycleEventWithExec(ctx context.Context, execer sqlRowExecer, e *LifecycleEvent) error {
	return execer.QueryRowContext(ctx,
		`INSERT INTO prediction_lifecycle_events
		 (market_id, event_type, actor_id, actor_type, reason, metadata)
		 VALUES ($1,$2,$3,$4,$5,$6)
		 RETURNING id, occurred_at`,
		e.MarketID, e.EventType, e.ActorID, e.ActorType, e.Reason, e.Metadata,
	).Scan(&e.ID, &e.OccurredAt)
}

// --- API Keys ---

func (r *SQLRepository) ListAPIKeys(ctx context.Context, userID string) ([]APIKey, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, user_id, name, key_prefix, scopes, active, expires_at, last_used_at, created_at
		 FROM prediction_api_keys WHERE user_id = $1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var keys []APIKey
	for rows.Next() {
		var k APIKey
		var expiresAt, lastUsed sql.NullTime
		if err := rows.Scan(&k.ID, &k.UserID, &k.Name, &k.KeyPrefix, pq.Array(&k.Scopes),
			&k.Active, &expiresAt, &lastUsed, &k.CreatedAt); err != nil {
			return nil, err
		}
		if expiresAt.Valid {
			k.ExpiresAt = &expiresAt.Time
		}
		if lastUsed.Valid {
			k.LastUsedAt = &lastUsed.Time
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

func (r *SQLRepository) GetAPIKeyByPrefix(ctx context.Context, prefix string) (*APIKey, error) {
	var k APIKey
	var expiresAt, lastUsed sql.NullTime
	err := r.db.QueryRowContext(ctx,
		`SELECT id, user_id, name, key_hash, key_prefix, scopes, active, expires_at, last_used_at, created_at
		 FROM prediction_api_keys WHERE key_prefix = $1 AND active = true`, prefix,
	).Scan(&k.ID, &k.UserID, &k.Name, &k.KeyHash, &k.KeyPrefix, pq.Array(&k.Scopes),
		&k.Active, &expiresAt, &lastUsed, &k.CreatedAt)
	if err != nil {
		return nil, err
	}
	if expiresAt.Valid {
		k.ExpiresAt = &expiresAt.Time
	}
	if lastUsed.Valid {
		k.LastUsedAt = &lastUsed.Time
	}
	return &k, nil
}

func (r *SQLRepository) CreateAPIKey(ctx context.Context, k *APIKey) error {
	return r.db.QueryRowContext(ctx,
		`INSERT INTO prediction_api_keys (user_id, name, key_hash, key_prefix, scopes, active, expires_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
		k.UserID, k.Name, k.KeyHash, k.KeyPrefix, pq.Array(k.Scopes), k.Active, k.ExpiresAt,
	).Scan(&k.ID, &k.CreatedAt)
}

func (r *SQLRepository) DeactivateAPIKey(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE prediction_api_keys SET active = false WHERE id = $1`, id)
	return err
}

func (r *SQLRepository) TouchAPIKeyLastUsed(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE prediction_api_keys SET last_used_at = NOW() WHERE id = $1`, id)
	return err
}

// --- Portfolio ---

func (r *SQLRepository) GetPortfolioSummary(ctx context.Context, userID string) (*PortfolioSummary, error) {
	var s PortfolioSummary

	// Open positions count and value
	err := r.db.QueryRowContext(ctx,
		`SELECT COALESCE(COUNT(*), 0), COALESCE(SUM(total_cost_points), 0)
		 FROM prediction_positions WHERE user_id = $1 AND quantity > 0`, userID,
	).Scan(&s.OpenPositions, &s.TotalValuePoints)
	if err != nil {
		return nil, err
	}

	// Realized PnL from settled payouts
	err = r.db.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(pnl_points), 0) FROM prediction_payouts WHERE user_id = $1`, userID,
	).Scan(&s.RealizedPnlPoints)
	if err != nil {
		return nil, err
	}

	// Unrealized PnL: mark open positions to the current market price minus
	// their cost basis. yes positions mark at yes_price_points, no at no.
	err = r.db.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(
		        p.quantity * (CASE WHEN p.side = 'yes' THEN m.yes_price_points ELSE m.no_price_points END)
		        - p.total_cost_points
		 ), 0)
		 FROM prediction_positions p
		 JOIN prediction_markets m ON m.id = p.market_id
		 WHERE p.user_id = $1 AND p.quantity > 0`, userID,
	).Scan(&s.UnrealizedPnlPoints)
	if err != nil {
		return nil, err
	}

	// Accuracy: correct predictions / total predictions
	err = r.db.QueryRowContext(ctx,
		`SELECT COALESCE(COUNT(*), 0),
		        COALESCE(SUM(CASE WHEN exit_price_points = 100 THEN 1 ELSE 0 END), 0)
		 FROM prediction_payouts WHERE user_id = $1`, userID,
	).Scan(&s.TotalPredictions, &s.CorrectPredictions)
	if err != nil {
		return nil, err
	}

	if s.TotalPredictions > 0 {
		s.AccuracyPct = float64(s.CorrectPredictions) / float64(s.TotalPredictions) * 100
	}

	return &s, nil
}

func (r *SQLRepository) ListSettledPositions(ctx context.Context, userID string, page, pageSize int) ([]Payout, int, error) {
	var total int
	if err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM prediction_payouts WHERE user_id = $1`, userID,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	rows, err := r.db.QueryContext(ctx,
		`SELECT id, settlement_id, position_id, user_id, market_id, side,
		        quantity, entry_price_points, exit_price_points, pnl_points, payout_points, paid_at
		 FROM prediction_payouts WHERE user_id = $1
		 ORDER BY paid_at DESC LIMIT $2 OFFSET $3`,
		userID, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var payouts []Payout
	for rows.Next() {
		var p Payout
		if err := rows.Scan(&p.ID, &p.SettlementID, &p.PositionID, &p.UserID, &p.MarketID, &p.Side,
			&p.Quantity, &p.EntryPricePoints, &p.ExitPricePoints, &p.PnlPoints, &p.PayoutPoints, &p.PaidAt); err != nil {
			return nil, 0, err
		}
		payouts = append(payouts, p)
	}
	return payouts, total, rows.Err()
}

// --- Discovery ---

func (r *SQLRepository) GetDiscovery(ctx context.Context) (*DiscoveryResponse, error) {
	// Initialize with empty (non-nil) slices so the JSON encoder emits `[]`
	// rather than `null` when a section has no rows — the frontend treats
	// the response as `.featured.length` and would NPE on null.
	d := &DiscoveryResponse{
		Featured:    []Market{},
		Trending:    []Market{},
		ClosingSoon: []Market{},
		Recent:      []Market{},
	}

	// scanMarkets returns nil when a query has zero rows. Assigning that back
	// to d.Featured etc. would overwrite the [] init and let the JSON encoder
	// emit null. assign() copies only when scanMarkets returned a populated
	// slice, preserving the [] init for empty results.
	assign := func(dst *[]Market, src []Market) {
		if src != nil {
			*dst = src
		}
	}

	// Discovery is a public-only surface, so every bucket excludes markets the
	// launch-safety scrub would strip to the sentinel — same rule as the
	// default MarketFilter in buildMarketWhere.
	notScrubbed := ` AND NOT ` + compliance.LaunchProhibitedCopySQLCondition("m.title")

	// Featured: markets flagged in featured events
	rows, err := r.db.QueryContext(ctx,
		marketSelectQuery()+` WHERE m.status = 'open'
		  AND m.event_id IN (SELECT id FROM prediction_events WHERE featured = true)`+
			notScrubbed+`
		  ORDER BY m.volume_points DESC LIMIT 12`)
	if err == nil {
		got, _ := scanMarkets(rows)
		rows.Close()
		assign(&d.Featured, got)
	}

	// Trending: highest volume across the whole AMM (lifetime volume proxy
	// until last-hour tracking lands). Bumped to 12 in alpha because
	// imported markets pushed the AMM from 17 markets to ~170 — six rows
	// duplicated content with Featured for the old size.
	rows, err = r.db.QueryContext(ctx,
		marketSelectQuery()+` WHERE m.status = 'open'`+notScrubbed+`
		  ORDER BY m.volume_points DESC LIMIT 12`)
	if err == nil {
		got, _ := scanMarkets(rows)
		rows.Close()
		assign(&d.Trending, got)
	}

	// Closing soon: markets closing within 7 days. Was 24h pre-imports;
	// imported markets are dated 90+ days out by default, so a tight 24h
	// window left this section empty most of the time.
	rows, err = r.db.QueryContext(ctx,
		marketSelectQuery()+` WHERE m.status = 'open'
		  AND m.close_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'`+
			notScrubbed+`
		  ORDER BY m.close_at ASC LIMIT 12`)
	if err == nil {
		got, _ := scanMarkets(rows)
		rows.Close()
		assign(&d.ClosingSoon, got)
	}

	// Recent: dropped from the discovery payload at the SQL layer because
	// every imported market is "newest" by created_at (they all landed in
	// the same sync run), so the section duplicated Trending content.
	// Frontend no longer renders it; we keep the empty slice so the JSON
	// shape stays stable for any downstream consumer.
	return d, nil
}

// --- Helpers ---

func marketSelectQuery() string {
	// Points unit-model (migration 050): imported_markets.volume/liquidity are
	// already whole Points — overlay them 1:1. The retired `im.volume * 100`
	// was a cents-era conversion that inflated imported markets 100× (and the
	// SMM's read-modify-write persisted the inflated value back into
	// prediction_markets; migration 052 repairs those rows).
	return `SELECT m.id, m.event_id, pe.category_id, pc.slug, pc.name, m.ticker, m.title, m.description,
		               COALESCE(m.translations, '{}'::jsonb) AS translations,
	               m.status, m.result,
	               m.yes_price_points, m.no_price_points, m.last_trade_price_points,
	               GREATEST(m.volume_points, COALESCE(ROUND(im.volume), 0)::bigint) AS volume_points,
	               m.open_interest_points,
	               GREATEST(m.liquidity_points, COALESCE(ROUND(im.liquidity), 0)::bigint) AS liquidity_points,
	               m.amm_yes_shares, m.amm_no_shares, m.amm_liquidity_param, m.amm_subsidy_points,
	               m.settlement_source_key, m.settlement_cutoff_at, m.settlement_rule, m.settlement_params,
	               m.fallback_source_key, m.fee_rate_bps, m.maker_rebate_bps,
	               m.open_at, m.close_at, m.created_at, m.updated_at, COALESCE(m.image_path, im.image_path) AS image_path,
	               m.execution_mode, m.collateral_pool_points, m.settled_payout_pool_points,
	               m.best_yes_bid_points, m.best_yes_ask_points,
	               m.best_no_bid_points, m.best_no_ask_points, m.last_quote_at,
	               m.article_source_id, pe.title AS event_title
	        FROM prediction_markets m
	        LEFT JOIN prediction_events pe ON pe.id = m.event_id
	        LEFT JOIN prediction_categories pc ON pc.id = pe.category_id
	        LEFT JOIN LATERAL (
	            SELECT volume, liquidity, image_path
	            FROM imported_markets im
	            WHERE m.ticker LIKE 'IMP-%'
	              AND upper(substr(im.external_hash, 1, 8)) = upper(substr(m.ticker, 5, 8))
	            ORDER BY im.volume DESC
	            LIMIT 1
		        ) im ON true`
}

func marketOrderClause(sort string) string {
	switch strings.TrimSpace(sort) {
	case "closing_soon":
		return ` ORDER BY rm.close_at ASC, rm.volume_points DESC, rm.id DESC`
	case "newest":
		return ` ORDER BY rm.created_at DESC, rm.volume_points DESC, rm.id DESC`
	case "id":
		// Internal-only cheap ordering for worker sweeps (SMM, reconciler)
		// that need the row set, not a ranking. Not accepted by the public
		// /markets handler — its sort allowlist gates what clients can pass.
		return ` ORDER BY rm.id`
	default:
		return marketRankingOrderClause()
	}
}

// marketSortNeedsRankingJoins reports whether the sort resolves to
// marketRankingOrderClause — the only ORDER BY that references the pe/pc/v24
// joins ListMarkets adds around the filtered subquery. Keep the cheap-sort
// case list in lockstep with marketOrderClause above.
func marketSortNeedsRankingJoins(sort string) bool {
	switch strings.TrimSpace(sort) {
	case "closing_soon", "newest", "id":
		return false
	default:
		return true
	}
}

func marketRankingOrderClause() string {
	return ` ORDER BY (
		-- Polymarket/Kalshi-style activity score:
		-- 35% 24h volume, 20% liquidity/depth proxy, 15% open interest,
		-- 10% total volume, 10% freshness/trending movement,
		-- 5% closing-soon relevance, 5% editorial/featured boost.
		0.35 * COALESCE(
			COALESCE(v24.volume_24h_points, 0)::double precision /
			NULLIF(MAX(COALESCE(v24.volume_24h_points, 0)) OVER (), 0),
			0
		) +
		0.20 * COALESCE(
			rm.liquidity_points::double precision /
			NULLIF(MAX(rm.liquidity_points) OVER (), 0),
			0
		) +
		0.15 * COALESCE(
			rm.open_interest_points::double precision /
			NULLIF(MAX(rm.open_interest_points) OVER (), 0),
			0
		) +
		0.10 * COALESCE(
			rm.volume_points::double precision /
			NULLIF(MAX(rm.volume_points) OVER (), 0),
			0
		) +
		0.10 * GREATEST(
			0,
			1 - LEAST(
				EXTRACT(EPOCH FROM (NOW() - GREATEST(rm.updated_at, COALESCE(rm.last_quote_at, rm.updated_at)))) / 604800.0,
				1
			)
		) +
		0.05 * CASE
			WHEN rm.close_at <= NOW() THEN 0
			ELSE 1 - LEAST(EXTRACT(EPOCH FROM (rm.close_at - NOW())) / 2592000.0, 1)
		END +
		CASE WHEN COALESCE(pe.featured, false) THEN 0.05 ELSE 0 END +
		-- Light category preference: entertainment/tech/politics first, then sports.
		CASE COALESCE(pc.slug, '')
			WHEN 'entertainment' THEN 0.04
			WHEN 'tech' THEN 0.035
			WHEN 'technology' THEN 0.035
			WHEN 'politics' THEN 0.03
			WHEN 'sports' THEN 0.02
			ELSE 0
		END -
		CASE
			WHEN rm.best_yes_bid_points IS NOT NULL AND rm.best_yes_ask_points IS NOT NULL
			THEN 0.08 * LEAST(GREATEST((rm.best_yes_ask_points - rm.best_yes_bid_points)::double precision, 0) / 25.0, 1)
			ELSE 0
		END -
		CASE WHEN COALESCE(rm.image_path, '') = '' THEN 0.06 ELSE 0 END -
		CASE
			WHEN NOW() - GREATEST(rm.updated_at, COALESCE(rm.last_quote_at, rm.updated_at)) > INTERVAL '14 days'
			THEN 0.05
			ELSE 0
		END -
		CASE WHEN rm.status <> 'open' THEN 0.20 ELSE 0 END
	) DESC, rm.close_at ASC, rm.id DESC`
}

type scannable interface {
	Scan(dest ...interface{}) error
}

func scanMarketRow(row scannable) (*Market, error) {
	var m Market
	var desc sql.NullString
	var translations []byte
	var result, fallback, imagePath sql.NullString
	var categoryID, categorySlug, categoryName sql.NullString
	var lastTradePrice sql.NullInt64
	var settleCutoff, openAt sql.NullTime
	// Exchange engine fields (migration 019). Best-quote columns are
	// populated by the post-match refresher; null until first match.
	var bestYesBid, bestYesAsk, bestNoBid, bestNoAsk sql.NullInt64
	var lastQuoteAt sql.NullTime
	var articleSourceID, eventTitle sql.NullString

	err := row.Scan(&m.ID, &m.EventID, &categoryID, &categorySlug, &categoryName, &m.Ticker, &m.Title, &desc, &translations, &m.Status, &result,
		&m.YesPricePoints, &m.NoPricePoints, &lastTradePrice,
		&m.VolumePoints, &m.OpenInterestPoints, &m.LiquidityPoints,
		&m.AMMYesShares, &m.AMMNoShares, &m.AMMLiquidityParam, &m.AMMSubsidyPoints,
		&m.SettlementSourceKey, &settleCutoff, &m.SettlementRule, &m.SettlementParams,
		&fallback, &m.FeeRateBps, &m.MakerRebateBps,
		&openAt, &m.CloseAt, &m.CreatedAt, &m.UpdatedAt, &imagePath,
		&m.ExecutionMode, &m.CollateralPoolPoints, &m.SettledPayoutPoolPoints,
		&bestYesBid, &bestYesAsk, &bestNoBid, &bestNoAsk, &lastQuoteAt,
		&articleSourceID, &eventTitle)
	if err != nil {
		return nil, err
	}
	if eventTitle.Valid && eventTitle.String != "" {
		m.EventTitle = &eventTitle.String
	}
	if categoryID.Valid {
		m.CategoryID = categoryID.String
	}
	if categorySlug.Valid {
		m.CategorySlug = categorySlug.String
	}
	if categoryName.Valid {
		m.CategoryName = categoryName.String
	}
	m.Description = desc.String
	m.Translations = defaultJSONObject(json.RawMessage(translations))
	if result.Valid {
		r := MarketResult(result.String)
		m.Result = &r
	}
	if lastTradePrice.Valid {
		ltp := int(lastTradePrice.Int64)
		m.LastTradePricePoints = &ltp
	}
	if settleCutoff.Valid {
		m.SettlementCutoffAt = &settleCutoff.Time
	}
	if fallback.Valid {
		m.FallbackSourceKey = &fallback.String
	}
	if openAt.Valid {
		m.OpenAt = &openAt.Time
	}
	if imagePath.Valid {
		m.ImagePath = imagePath.String
	}
	if bestYesBid.Valid {
		v := int(bestYesBid.Int64)
		m.BestYesBidPoints = &v
	}
	if bestYesAsk.Valid {
		v := int(bestYesAsk.Int64)
		m.BestYesAskPoints = &v
	}
	if bestNoBid.Valid {
		v := int(bestNoBid.Int64)
		m.BestNoBidPoints = &v
	}
	if bestNoAsk.Valid {
		v := int(bestNoAsk.Int64)
		m.BestNoAskPoints = &v
	}
	if lastQuoteAt.Valid {
		m.LastQuoteAt = &lastQuoteAt.Time
	}
	if articleSourceID.Valid {
		m.ArticleSourceID = &articleSourceID.String
	}
	return &m, nil
}

func scanMarket(rows *sql.Rows) (*Market, error) {
	return scanMarketRow(rows)
}

func scanMarkets(rows *sql.Rows) ([]Market, error) {
	var markets []Market
	for rows.Next() {
		m, err := scanMarket(rows)
		if err != nil {
			return nil, err
		}
		markets = append(markets, *m)
	}
	return markets, rows.Err()
}

func scanEvent(rows *sql.Rows) (*Event, error) {
	var e Event
	var seriesID, desc, createdBy, cover sql.NullString
	var openAt, settleAt, settledAt sql.NullTime
	// category_id is nullable in the schema (integration-test events and
	// legacy rows carry NULL). Scanning it into a bare string made ONE such
	// row 500 the whole /api/v1/events listing.
	var categoryID sql.NullString
	err := rows.Scan(&e.ID, &seriesID, &e.Title, &desc, &categoryID, &e.Status, &e.Featured,
		&openAt, &e.CloseAt, &settleAt, &settledAt, &e.Metadata, &createdBy, &e.CreatedAt, &e.UpdatedAt,
		&cover)
	if err != nil {
		return nil, err
	}
	if cover.Valid && cover.String != "" {
		e.CoverImageURL = &cover.String
	}
	e.CategoryID = categoryID.String
	if seriesID.Valid {
		e.SeriesID = &seriesID.String
	}
	e.Description = desc.String
	if openAt.Valid {
		e.OpenAt = &openAt.Time
	}
	if settleAt.Valid {
		e.SettleAt = &settleAt.Time
	}
	if settledAt.Valid {
		e.SettledAt = &settledAt.Time
	}
	if createdBy.Valid {
		e.CreatedBy = &createdBy.String
	}
	return &e, nil
}

func scanOrderRow(row scannable) (*Order, error) {
	var o Order
	var pricePoints sql.NullInt64
	var walletRes, idemp sql.NullString
	var expiresAt, filledAt, cancelledAt sql.NullTime

	err := row.Scan(&o.ID, &o.UserID, &o.MarketID, &o.Side, &o.Action, &o.OrderType, &pricePoints,
		&o.Quantity, &o.FilledQuantity, &o.RemainingQuantity, &o.TotalCostPoints,
		&o.Status, &walletRes, &idemp, &expiresAt, &filledAt, &cancelledAt, &o.CreatedAt, &o.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if pricePoints.Valid {
		pc := int(pricePoints.Int64)
		o.PricePoints = &pc
	}
	if walletRes.Valid {
		o.WalletReservationID = &walletRes.String
	}
	if idemp.Valid {
		o.IdempotencyKey = &idemp.String
	}
	if expiresAt.Valid {
		o.ExpiresAt = &expiresAt.Time
	}
	if filledAt.Valid {
		o.FilledAt = &filledAt.Time
	}
	if cancelledAt.Valid {
		o.CancelledAt = &cancelledAt.Time
	}
	return &o, nil
}

func scanOrder(rows *sql.Rows) (*Order, error) {
	return scanOrderRow(rows)
}

func buildEventWhere(f EventFilter) (string, []interface{}) {
	var conds []string
	var args []interface{}
	idx := 1

	if f.CategoryID != nil {
		conds = append(conds, fmt.Sprintf("category_id = $%d", idx))
		args = append(args, *f.CategoryID)
		idx++
	}
	if f.Status != nil {
		conds = append(conds, fmt.Sprintf("status = $%d", idx))
		args = append(args, *f.Status)
		idx++
	}
	if f.Featured != nil {
		conds = append(conds, fmt.Sprintf("featured = $%d", idx))
		args = append(args, *f.Featured)
		idx++
	}
	if f.SeriesID != nil {
		conds = append(conds, fmt.Sprintf("series_id = $%d", idx))
		args = append(args, *f.SeriesID)
		idx++
	}

	// Hide synthetic catalog-host events from public listings. They exist in
	// the schema purely to host imported markets (see migration 018) and
	// would otherwise show up as oversized "Politics Markets" / "Sports
	// Markets" / etc. cards on /events and /category/*. The markets they
	// host still surface via market-level queries (which join through
	// event_id) — only the *event listing* is filtered.
	conds = append(conds, "is_synthetic = false")

	return " WHERE " + strings.Join(conds, " AND "), args
}

func buildMarketWhere(f MarketFilter) (string, []interface{}) {
	var conds []string
	var args []interface{}
	idx := 1

	// Safe-by-default publication gate: never return pre-launch `unopened`
	// markets unless the caller explicitly opts in (admin-authenticated views).
	// Keeps not-yet-approved markets (e.g. AI drafts) off every player-facing
	// list/by-event query regardless of any client `status` param
	// (status='unopened' AND status<>'unopened' yields nothing). Literal
	// condition — no bound parameter, so idx is unaffected.
	if !f.IncludeUnopened {
		conds = append(conds, "m.status <> 'unopened'")
	}

	// Safe-by-default launch-safety gate: markets whose title would be
	// replaced with the scrub sentinel carry no listable content, so public
	// list/by-event queries exclude them unless the caller opts in
	// (back-office, workers, ops tooling). Direct GetMarket/GetMarketByTicker
	// reads bypass this filter, keeping scrubbed markets auditable. Literal
	// condition — no bound parameter, so idx is unaffected.
	if !f.IncludeLaunchScrubbed {
		conds = append(conds, "NOT "+compliance.LaunchProhibitedCopySQLCondition("m.title"))
	}

	if len(f.IDs) > 0 {
		// Compare as text: this is a public filter, and casting arbitrary
		// caller strings to uuid ("m.id = ANY($n::uuid[])") makes Postgres
		// error the whole query on one malformed id — a garbage ?ids= value
		// must yield zero rows, not a 500. The text cast costs nothing extra
		// here: the launch-scrub regex above already keeps this query off a
		// pure index path.
		conds = append(conds, fmt.Sprintf("m.id::text = ANY($%d)", idx))
		args = append(args, pq.Array(f.IDs))
		idx++
	}
	if f.EventID != nil {
		conds = append(conds, fmt.Sprintf("m.event_id = $%d", idx))
		args = append(args, *f.EventID)
		idx++
	}
	if f.SeriesID != nil {
		conds = append(conds,
			fmt.Sprintf("m.event_id IN (SELECT id FROM prediction_events WHERE series_id = $%d)", idx))
		args = append(args, *f.SeriesID)
		idx++
	}
	if f.CategoryID != nil {
		// Subquery joins markets to events to filter by category. Synthetic
		// catalog-host events are intentionally NOT excluded here — players
		// browsing /category/* should see imported markets just like real ones.
		// Only the event-listing endpoint hides synthetic events; the markets
		// they host still surface flat under each category.
		conds = append(conds,
			fmt.Sprintf("m.event_id IN (SELECT id FROM prediction_events WHERE category_id = $%d)", idx))
		args = append(args, *f.CategoryID)
		idx++
	}
	if f.Status != nil {
		conds = append(conds, fmt.Sprintf("m.status = $%d", idx))
		args = append(args, *f.Status)
		idx++
	}
	if f.Ticker != nil {
		conds = append(conds, fmt.Sprintf("m.ticker = $%d", idx))
		args = append(args, *f.Ticker)
		idx++
	}
	if f.Search != nil && strings.TrimSpace(*f.Search) != "" {
		conds = append(conds,
			fmt.Sprintf("(m.ticker ILIKE $%d OR m.title ILIKE $%d OR COALESCE(m.description, '') ILIKE $%d)", idx, idx, idx))
		args = append(args, "%"+strings.TrimSpace(*f.Search)+"%")
		idx++
	}
	if f.Tag != nil && strings.TrimSpace(*f.Tag) != "" {
		conds = append(conds,
			fmt.Sprintf(`m.event_id IN (
				SELECT e.id
				FROM prediction_events e
				JOIN prediction_series s ON s.id = e.series_id
				WHERE lower($%d) IN (SELECT lower(unnest(s.tags)))
			)`, idx))
		args = append(args, strings.TrimSpace(*f.Tag))
		idx++
	}
	if f.CloseBefore != nil {
		// Players use this to ask "what's about to settle?". The bound is
		// inclusive on the upper edge so a market closing exactly at the
		// requested instant still appears in the result.
		conds = append(conds, fmt.Sprintf("m.close_at <= $%d", idx))
		args = append(args, *f.CloseBefore)
		idx++
	}

	if len(conds) == 0 {
		return "", nil
	}
	return " WHERE " + strings.Join(conds, " AND "), args
}

// nullJSONArg returns nil for empty JSON so a nullable jsonb column stores
// NULL rather than failing on an empty string.
func nullJSONArg(b []byte) interface{} {
	if len(b) == 0 {
		return nil
	}
	return b
}

func nullStr(s string) sql.NullString {
	if s == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}

// DashboardVolumeStatsSince aggregates trade activity since `since` and returns
// total volume, trade count, and the top N markets by absolute YES-price change
// over the same window. Used by the admin dashboard.
func (r *SQLRepository) DashboardVolumeStatsSince(
	ctx context.Context,
	since time.Time,
	topMovers int,
) (*DashboardVolumeStats, error) {
	if topMovers <= 0 {
		topMovers = 5
	}

	stats := &DashboardVolumeStats{
		Since:         since,
		WindowSeconds: int(time.Since(since).Seconds()),
		TopMovers:     []DashboardMover{},
	}

	// Aggregate volume + count across all trades in the window. Volume is
	// price_points * quantity (the dollar size of each fill).
	row := r.db.QueryRowContext(ctx, `
		SELECT
			COALESCE(SUM(price_points::BIGINT * quantity), 0)::BIGINT,
			COUNT(*)
		FROM prediction_trades
		WHERE traded_at > $1
	`, since)
	if err := row.Scan(&stats.TotalVolumePoints, &stats.TradeCount); err != nil {
		return nil, fmt.Errorf("dashboard volume aggregate: %w", err)
	}

	if stats.TradeCount == 0 {
		return stats, nil
	}

	// Top movers: per-market first vs last YES-side trade in the window,
	// ranked by absolute price delta. side='yes' restricts to fills against
	// YES contracts so the price arc is comparable across markets.
	rows, err := r.db.QueryContext(ctx, `
		WITH window_trades AS (
			SELECT market_id, price_points, quantity, traded_at
			FROM prediction_trades
			WHERE traded_at > $1 AND side = 'yes'
		),
		first_last AS (
			SELECT
				market_id,
				(array_agg(price_points ORDER BY traded_at ASC))[1]  AS first_price,
				(array_agg(price_points ORDER BY traded_at DESC))[1] AS last_price,
				COALESCE(SUM(price_points::BIGINT * quantity), 0)::BIGINT AS volume_points
			FROM window_trades
			GROUP BY market_id
		)
		SELECT
			fl.market_id,
			m.ticker,
			m.title,
			fl.first_price,
			fl.last_price,
			fl.volume_points
		FROM first_last fl
		JOIN prediction_markets m ON m.id = fl.market_id
		ORDER BY ABS(fl.last_price - fl.first_price) DESC, fl.volume_points DESC
		LIMIT $2
	`, since, topMovers)
	if err != nil {
		return nil, fmt.Errorf("dashboard top movers query: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var m DashboardMover
		if err := rows.Scan(
			&m.MarketID,
			&m.Ticker,
			&m.Title,
			&m.YesPricePointsStart,
			&m.YesPricePointsNow,
			&m.VolumePoints,
		); err != nil {
			return nil, fmt.Errorf("dashboard top movers scan: %w", err)
		}
		stats.TopMovers = append(stats.TopMovers, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("dashboard top movers rows: %w", err)
	}

	return stats, nil
}

func (r *SQLRepository) ensurePunterExists(ctx context.Context, userID string) error {
	return r.ensurePunterExistsWithExec(ctx, r.db, userID)
}

func (r *SQLRepository) ensurePunterExistsWithExec(ctx context.Context, execer sqlRowExecer, userID string) error {
	if strings.TrimSpace(userID) == "" {
		return fmt.Errorf("empty user id")
	}

	emailDigest := fmt.Sprintf("%x", sha1.Sum([]byte(userID)))
	email := fmt.Sprintf("%s@predict.local", emailDigest)

	// Leave username NULL on auto-provision. The leaderboards display
	// query falls back to a short id-derived label when there's no set
	// username; setting username=userID here would show raw ids like
	// "u-71612d736d6f" on public boards.
	_, err := execer.ExecContext(ctx,
		`INSERT INTO punters (id, email, status)
		 VALUES ($1, $2, 'active')
		 ON CONFLICT (id) DO NOTHING`,
		userID, email,
	)
	return err
}

// ListPriceBuckets aggregates prediction_trades into volume-weighted YES
// price buckets of bucketSec width over [since, until]. Returns only
// buckets that have at least one trade; the caller (Service) fills the
// empty buckets via carry-forward.
//
// Notes on the SQL:
//   - YES price is the YES-side price of every trade (issuance pairs
//     write one YES-side row and one NO-side row; we read the YES rows
//     to keep the chart Y-axis consistent).
//   - Volume-weighted mean uses SUM(price × qty) / SUM(qty) so big
//     fills move the bucket price more than tiny ones.
//   - Bucket key is `to_timestamp(floor(epoch / N) * N)` so buckets
//     align with the Go-side bucketAlign helper.
func (r *SQLRepository) ListPriceBuckets(ctx context.Context, marketID string, since, until time.Time, bucketSec int) ([]PricePoint, error) {
	if bucketSec <= 0 {
		return nil, fmt.Errorf("bucketSec must be > 0")
	}
	rows, err := r.db.QueryContext(ctx, `
		SELECT
		  to_timestamp(floor(extract(epoch from traded_at) / $4) * $4) AS bucket_start,
		  (SUM(price_points::bigint * quantity) / NULLIF(SUM(quantity), 0))::int AS vwap_yes,
		  COUNT(*) AS trade_count,
		  SUM(price_points::bigint * quantity) AS volume_points
		FROM prediction_trades
		WHERE market_id = $1
		  AND traded_at >= $2
		  AND traded_at <  $3
		  AND side = 'yes'
		GROUP BY bucket_start
		ORDER BY bucket_start ASC
	`, marketID, since, until, bucketSec)
	if err != nil {
		return nil, fmt.Errorf("query price buckets: %w", err)
	}
	defer rows.Close()

	var out []PricePoint
	for rows.Next() {
		var p PricePoint
		var bucketStart time.Time
		if err := rows.Scan(&bucketStart, &p.YesPricePoints, &p.TradeCount, &p.VolumePoints); err != nil {
			return nil, fmt.Errorf("scan price bucket: %w", err)
		}
		p.BucketStart = bucketStart.UTC()
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate price buckets: %w", err)
	}
	return out, nil
}

// ListImportedPriceBuckets reads hourly source snapshots for promoted
// imported markets. Promotion tickers are IMP-<first 8 hex chars of
// imported_markets.external_hash>, so the lookup deliberately matches that
// prefix instead of exposing source IDs through the public prediction tables.
func (r *SQLRepository) ListImportedPriceBuckets(ctx context.Context, ticker string, since, until time.Time, bucketSec int) ([]PricePoint, error) {
	if bucketSec <= 0 {
		return nil, fmt.Errorf("bucketSec must be > 0")
	}
	prefix := strings.TrimPrefix(strings.ToUpper(strings.TrimSpace(ticker)), "IMP-")
	if prefix == "" || prefix == strings.ToUpper(strings.TrimSpace(ticker)) {
		return nil, nil
	}

	rows, err := r.db.QueryContext(ctx, `
		WITH snapshot_prices AS (
		  SELECT
		    to_timestamp(floor(extract(epoch from observed_at) / $4) * $4) AS bucket_start,
		    observed_at,
		    LEAST(99, GREATEST(1, ROUND(((prices->>0)::numeric) * 100)))::int AS yes_price_points
		  FROM imported_market_price_snapshots
		  WHERE upper(substr(external_hash, 1, 8)) = $1
		    AND observed_at >= $2
		    AND observed_at <  $3
		    AND jsonb_typeof(prices) = 'array'
		    AND jsonb_array_length(prices) > 0
		    AND (prices->>0) ~ '^-?[0-9]+(\.[0-9]+)?$'
		),
		latest_per_bucket AS (
		  SELECT
		    bucket_start,
		    yes_price_points,
		    row_number() OVER (PARTITION BY bucket_start ORDER BY observed_at DESC) AS rn
		  FROM snapshot_prices
		)
		SELECT bucket_start, yes_price_points
		FROM latest_per_bucket
		WHERE rn = 1
		ORDER BY bucket_start ASC
	`, prefix, since, until, bucketSec)
	if err != nil {
		return nil, fmt.Errorf("query imported price buckets: %w", err)
	}
	defer rows.Close()

	var out []PricePoint
	for rows.Next() {
		var p PricePoint
		var bucketStart time.Time
		if err := rows.Scan(&bucketStart, &p.YesPricePoints); err != nil {
			return nil, fmt.Errorf("scan imported price bucket: %w", err)
		}
		p.BucketStart = bucketStart.UTC()
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate imported price buckets: %w", err)
	}
	return out, nil
}
