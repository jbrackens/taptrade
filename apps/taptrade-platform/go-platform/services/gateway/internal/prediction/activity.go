package prediction

import (
	"context"
	"database/sql"
	"time"

	"taptrade/gateway/internal/compliance"
)

// Proof of life (2026-09-27): what actually happened on the exchange, for
// the board's activity rail. Everything here is real fills from
// prediction_trades; the rail hides itself when there is nothing to show
// rather than invent a signal.

// ActivityTrade is one recent fill with the market it happened on.
type ActivityTrade struct {
	TradedAt     time.Time `json:"tradedAt"`
	Side         OrderSide `json:"side"`
	PricePoints  int       `json:"pricePoints"`
	Quantity     int       `json:"quantity"`
	IsAMMTrade   bool      `json:"isAmmTrade"`
	MarketID     string    `json:"marketId"`
	Ticker       string    `json:"ticker"`
	Title        string    `json:"title"`
	CategorySlug string    `json:"categorySlug,omitempty"`
}

// Mover is an open market whose traded Yes price moved over the last 24
// hours: the first and last fills of the window, expressed as Yes points.
type Mover struct {
	MarketID     string `json:"marketId"`
	Ticker       string `json:"ticker"`
	Title        string `json:"title"`
	CategorySlug string `json:"categorySlug,omitempty"`
	YesFrom      int    `json:"yesFrom"`
	YesTo        int    `json:"yesTo"`
	ChangePoints int    `json:"changePoints"`
	Trades24h    int    `json:"trades24h"`
}

// publicTitleOK is the public listing's launch-scrub exclusion, so the rail
// never surfaces a market the board itself would hide.
var publicTitleOK = "NOT " + compliance.LaunchProhibitedCopySQLCondition("m.title")

// ListRecentActivity returns the latest fills on open, publicly listable
// markets, newest first.
func (r *SQLRepository) ListRecentActivity(ctx context.Context, limit int) ([]ActivityTrade, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := r.db.QueryContext(ctx, `
		SELECT t.traded_at, t.side, t.price_points, t.quantity, t.is_amm_trade,
		       m.id, m.ticker, m.title, COALESCE(pc.slug, '')
		  FROM prediction_trades t
		  JOIN prediction_markets m ON m.id = t.market_id
		  LEFT JOIN prediction_events pe ON pe.id = m.event_id
		  LEFT JOIN prediction_categories pc ON pc.id = pe.category_id
		 WHERE m.status = 'open' AND `+publicTitleOK+`
		 ORDER BY t.traded_at DESC
		 LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ActivityTrade{}
	for rows.Next() {
		var a ActivityTrade
		if err := rows.Scan(&a.TradedAt, &a.Side, &a.PricePoints, &a.Quantity, &a.IsAMMTrade, &a.MarketID, &a.Ticker, &a.Title, &a.CategorySlug); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ListMovers24h returns open markets whose traded Yes price changed over
// the last 24 hours, largest move first. A No fill at p counts as Yes at
// 100-p so both sides land on one scale.
func (r *SQLRepository) ListMovers24h(ctx context.Context, limit int) ([]Mover, error) {
	if limit <= 0 || limit > 50 {
		limit = 8
	}
	rows, err := r.db.QueryContext(ctx, `
		WITH fills AS (
			SELECT t.market_id,
			       CASE WHEN t.side = 'yes' THEN t.price_points ELSE 100 - t.price_points END AS yes_px,
			       t.traded_at
			  FROM prediction_trades t
			 WHERE t.traded_at >= NOW() - INTERVAL '24 hours'
		),
		spans AS (
			SELECT DISTINCT market_id,
			       first_value(yes_px) OVER (PARTITION BY market_id ORDER BY traded_at ASC)  AS yes_from,
			       first_value(yes_px) OVER (PARTITION BY market_id ORDER BY traded_at DESC) AS yes_to,
			       count(*) OVER (PARTITION BY market_id) AS n
			  FROM fills
		)
		SELECT m.id, m.ticker, m.title, COALESCE(pc.slug, ''), s.yes_from, s.yes_to, s.yes_to - s.yes_from, s.n
		  FROM spans s
		  JOIN prediction_markets m ON m.id = s.market_id
		  LEFT JOIN prediction_events pe ON pe.id = m.event_id
		  LEFT JOIN prediction_categories pc ON pc.id = pe.category_id
		 WHERE m.status = 'open' AND s.yes_to <> s.yes_from AND `+publicTitleOK+`
		 ORDER BY abs(s.yes_to - s.yes_from) DESC, s.n DESC, m.id
		 LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Mover{}
	for rows.Next() {
		var mv Mover
		var n sql.NullInt64
		if err := rows.Scan(&mv.MarketID, &mv.Ticker, &mv.Title, &mv.CategorySlug, &mv.YesFrom, &mv.YesTo, &mv.ChangePoints, &n); err != nil {
			return nil, err
		}
		mv.Trades24h = int(n.Int64)
		out = append(out, mv)
	}
	return out, rows.Err()
}
