package http

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	stdhttp "net/http"
	"strconv"
	"strings"
	"time"

	"taptrade/gateway/internal/compliance"
	"taptrade/gateway/internal/prediction"
	"taptrade/platform/transport/httpx"
)

type marketLifecycleRequest struct {
	Reason string `json:"reason"`
}

// maxMarketIDFilterCount caps the public `ids` filter on GET /api/v1/markets.
// 50 covers the largest batched-hydration page the player app issues
// (portfolio: 50 orders + 20 history rows deduped) while keeping the ANY()
// predicate bounded for anonymous callers.
const maxMarketIDFilterCount = 50

func decodeCreateMarketRequest(r *stdhttp.Request) (prediction.CreateMarketRequest, error) {
	var req prediction.CreateMarketRequest
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		return req, httpx.BadRequest("invalid request body", nil)
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		return req, httpx.BadRequest("invalid request body", nil)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return req, httpx.BadRequest("invalid request body", nil)
	}
	// Points unit-model (2026-07-07): launch boundary rejects the retired
	// cents-era key outright ("ammSubsidyCents" kept as the banned literal,
	// not a live field); ammSubsidyPoints is the canonical request key.
	if _, ok := fields["ammSubsidyCents"]; ok {
		return req, httpx.BadRequest("ammSubsidyCents is retired; use ammSubsidyPoints", map[string]any{"field": "ammSubsidyPoints"})
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		return req, httpx.BadRequest("invalid request body", nil)
	}
	return req, nil
}

type marketLifecycleEventResponse struct {
	prediction.LifecycleEvent
	TapTradeLifecycle prediction.TapTradeMarketLifecycle `json:"taptradeLifecycle"`
}

type portfolioHistoryItem struct {
	ID               string               `json:"id"`
	SettlementID     string               `json:"settlementId"`
	PositionID       string               `json:"positionId"`
	UserID           string               `json:"userId"`
	MarketID         string               `json:"marketId"`
	Side             prediction.OrderSide `json:"side"`
	Quantity         int                  `json:"quantity"`
	EntryPricePoints int                  `json:"entryPricePoints"`
	ExitPricePoints  int                  `json:"exitPricePoints"`
	RealizedPoints   int64                `json:"realizedPoints"`
	SettlementPoints int64                `json:"settlementPoints"`
	PaidAt           time.Time            `json:"paidAt"`
	Unit             string               `json:"unit"`
}

type settlementRecordResponse struct {
	ID                    string                  `json:"id"`
	MarketID              string                  `json:"marketId"`
	Result                prediction.MarketResult `json:"result"`
	AttestationSource     string                  `json:"attestationSource"`
	AttestationID         *string                 `json:"attestationId,omitempty"`
	AttestationDigest     *string                 `json:"attestationDigest,omitempty"`
	AttestationData       json.RawMessage         `json:"attestationData,omitempty"`
	SettledBy             *string                 `json:"settledBy,omitempty"`
	SettledAt             time.Time               `json:"settledAt"`
	PositionsSettled      int                     `json:"positionsSettled"`
	OverrideReason        *string                 `json:"overrideReason,omitempty"`
	OverriddenByUserID    *string                 `json:"overriddenByUserId,omitempty"`
	OverriddenAt          *time.Time              `json:"overriddenAt,omitempty"`
	TotalSettlementPoints int64                   `json:"totalSettlementPoints"`
	Unit                  string                  `json:"unit"`
}

type settlementPointDisbursement struct {
	ID               string               `json:"id"`
	SettlementID     string               `json:"settlementId"`
	PositionID       string               `json:"positionId"`
	UserID           string               `json:"userId"`
	MarketID         string               `json:"marketId"`
	Side             prediction.OrderSide `json:"side"`
	Quantity         int                  `json:"quantity"`
	EntryPricePoints int                  `json:"entryPricePoints"`
	ExitPricePoints  int                  `json:"exitPricePoints"`
	RealizedPoints   int64                `json:"realizedPoints"`
	SettlementPoints int64                `json:"settlementPoints"`
	PaidAt           time.Time            `json:"paidAt"`
	Unit             string               `json:"unit"`
}

type settlementOperationResponse struct {
	Settlement            settlementRecordResponse           `json:"settlement"`
	PointDisbursements    []settlementPointDisbursement      `json:"pointDisbursements"`
	TotalSettlementPoints int64                              `json:"totalSettlementPoints"`
	Unit                  string                             `json:"unit"`
	TapTradeLifecycle     prediction.TapTradeMarketLifecycle `json:"taptradeLifecycle"`
}

type adminCategoryRequest struct {
	Slug      string `json:"slug"`
	Name      string `json:"name"`
	Icon      string `json:"icon"`
	SortOrder int    `json:"sortOrder"`
	Active    *bool  `json:"active"`
}

type adminSeriesRequest struct {
	Slug        string   `json:"slug"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	CategoryID  string   `json:"categoryId"`
	Frequency   string   `json:"frequency"`
	Tags        []string `json:"tags"`
	Active      *bool    `json:"active"`
}

func registerPredictionRoutes(mux *stdhttp.ServeMux, svc *prediction.Service) {
	// --- Public: Discovery ---
	mux.Handle("/api/v1/discovery", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		result, err := svc.GetDiscovery(r.Context())
		if err != nil {
			return httpx.Internal("failed to fetch data", err)
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, predictionDiscoveryPayload(result))
	}))

	// --- Public: Categories ---
	mux.Handle("/api/v1/categories", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		cats, err := svc.ListCategories(r.Context(), true)
		if err != nil {
			return httpx.Internal("failed to fetch data", err)
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, predictionCategoryPayloads(cats))
	}))

	mux.Handle("/api/v1/categories/", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		slug := r.URL.Path[len("/api/v1/categories/"):]
		if slug == "" {
			return httpx.BadRequest("category slug required", nil)
		}
		cat, err := svc.GetCategory(r.Context(), slug)
		if err != nil {
			return httpx.NotFound("category not found")
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, predictionCategoryPayload(*cat))
	}))

	// --- Public: Series and tags ---
	mux.Handle("/api/v1/series", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		var categoryID *string
		if cid := r.URL.Query().Get("categoryId"); cid != "" {
			categoryID = &cid
		}
		series, err := svc.ListSeries(r.Context(), categoryID)
		if err != nil {
			return httpx.Internal("failed to fetch series", err)
		}
		if series == nil {
			series = []prediction.Series{}
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, predictionSeriesPayloads(series))
	}))

	mux.Handle("/api/v1/tags", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		var categoryID *string
		if cid := r.URL.Query().Get("categoryId"); cid != "" {
			categoryID = &cid
		}
		tags, err := svc.ListTags(r.Context(), categoryID)
		if err != nil {
			return httpx.Internal("failed to fetch tags", err)
		}
		tags = launchListableStrings(tags)
		if tags == nil {
			tags = []string{}
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{"tags": tags})
	}))

	// --- Public: Events ---
	mux.Handle("/api/v1/events", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		filter := prediction.EventFilter{
			Page:     clampedQueryParam(r, "page", 1, 100000),
			PageSize: clampedQueryParam(r, "pageSize", 20, 100),
		}
		if cat := r.URL.Query().Get("categoryId"); cat != "" {
			filter.CategoryID = &cat
		}
		if seriesID := r.URL.Query().Get("seriesId"); seriesID != "" {
			filter.SeriesID = &seriesID
		}
		if status := r.URL.Query().Get("status"); status != "" {
			s := prediction.EventStatus(status)
			filter.Status = &s
		}
		if r.URL.Query().Get("featured") == "true" {
			featured := true
			filter.Featured = &featured
		}
		events, total, err := svc.ListEvents(r.Context(), filter)
		if err != nil {
			return httpx.Internal("failed to fetch data", err)
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]interface{}{
			"data": predictionEventPayloads(events),
			"meta": prediction.PageMeta{
				Page:     filter.Page,
				PageSize: filter.PageSize,
				Total:    total,
				HasNext:  filter.Page*filter.PageSize < total,
			},
		})
	}))

	mux.Handle("/api/v1/events/", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		id := r.URL.Path[len("/api/v1/events/"):]
		if id == "" {
			return httpx.BadRequest("event id required", nil)
		}
		event, err := svc.GetEvent(r.Context(), id)
		if err != nil {
			return httpx.NotFound("event not found")
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, predictionEventPayload(*event))
	}))

	// --- Public: Markets ---
	mux.Handle("/api/v1/markets", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		filter := prediction.MarketFilter{
			Page:     clampedQueryParam(r, "page", 1, 100000),
			PageSize: clampedQueryParam(r, "pageSize", 20, 100),
		}
		if eid := r.URL.Query().Get("eventId"); eid != "" {
			filter.EventID = &eid
		}
		if sid := r.URL.Query().Get("seriesId"); sid != "" {
			filter.SeriesID = &sid
		}
		if cid := r.URL.Query().Get("categoryId"); cid != "" {
			filter.CategoryID = &cid
		}
		if status := r.URL.Query().Get("status"); status != "" {
			s := prediction.MarketStatus(status)
			filter.Status = &s
		}
		if ticker := r.URL.Query().Get("ticker"); ticker != "" {
			filter.Ticker = &ticker
		}
		// Batched id lookup (comma-separated) so hydration flows (e.g. the
		// portfolio page resolving position/order market ids) cost one query
		// instead of N GET /markets/{id} round-trips. Capped so a public
		// caller cannot turn one request into an unbounded ANY() scan. The
		// filter composes into the same WHERE as every other param, so the
		// unopened + launch-scrub safety gates still apply.
		if rawIDs := strings.TrimSpace(r.URL.Query().Get("ids")); rawIDs != "" {
			parts := strings.Split(rawIDs, ",")
			ids := make([]string, 0, len(parts))
			for _, part := range parts {
				if trimmed := strings.TrimSpace(part); trimmed != "" {
					ids = append(ids, trimmed)
				}
			}
			if len(ids) > maxMarketIDFilterCount {
				return httpx.BadRequest("ids filter accepts at most 50 ids", map[string]any{"field": "ids"})
			}
			if len(ids) > 0 {
				filter.IDs = ids
			}
		}
		if q := strings.TrimSpace(r.URL.Query().Get("q")); q != "" {
			filter.Search = &q
		}
		if tag := strings.TrimSpace(r.URL.Query().Get("tag")); tag != "" {
			filter.Tag = &tag
		}
		switch sort := strings.TrimSpace(r.URL.Query().Get("sort")); sort {
		case "", "activity":
			filter.Sort = "activity"
		case "closing_soon", "newest":
			filter.Sort = sort
		default:
			return httpx.BadRequest("invalid market sort", map[string]any{"field": "sort"})
		}
		if cb := r.URL.Query().Get("closeBefore"); cb != "" {
			if t, err := time.Parse(time.RFC3339, cb); err == nil {
				filter.CloseBefore = &t
			}
		}
		markets, total, err := svc.ListMarkets(r.Context(), filter)
		if err != nil {
			return httpx.Internal("failed to fetch data", err)
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]interface{}{
			"data": predictionMarketPayloads(markets),
			"meta": prediction.PageMeta{
				Page:     filter.Page,
				PageSize: filter.PageSize,
				Total:    total,
				HasNext:  filter.Page*filter.PageSize < total,
			},
		})
	}))

	mux.Handle("/api/v1/markets/", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		path := r.URL.Path[len("/api/v1/markets/"):]
		if path == "" {
			return httpx.BadRequest("market id or ticker required", nil)
		}
		// Sub-path routing: /api/v1/markets/{idOrTicker}/trades
		parts := strings.SplitN(path, "/", 2)
		id := parts[0]
		sub := ""
		if len(parts) == 2 {
			sub = parts[1]
		}
		market, err := svc.GetMarketByTicker(r.Context(), id)
		if err != nil {
			market, err = svc.GetMarket(r.Context(), id)
			if err != nil {
				return httpx.NotFound("market not found")
			}
		}
		// Publication gate: pre-launch `unopened` markets are not public. This is
		// a public route (no admin context), so 404 them for everyone — the
		// backoffice views drafts via the admin list, never this endpoint.
		if market.Status == prediction.MarketStatusUnopened {
			return httpx.NotFound("market not found")
		}
		switch sub {
		case "":
			return httpx.WriteJSON(w, stdhttp.StatusOK, predictionMarketPayload(*market))
		case "trades":
			limit := intQueryParam(r, "limit", 50)
			// Clamp limit to a sane range; the trade tape ships with the
			// new match_id column so clients can group issuance pairs.
			if limit > 200 {
				limit = 200
			}
			if limit < 1 {
				return httpx.BadRequest("limit must be >= 1", nil)
			}
			trades, err := svc.ListTrades(r.Context(), market.ID, limit)
			if err != nil {
				return httpx.Internal("failed to fetch trades", err)
			}
			if trades == nil {
				trades = []prediction.Trade{}
			}
			return httpx.WriteJSON(w, stdhttp.StatusOK, trades)
		case "orderbook":
			// Order-book depth: server-side capped at 100 (matches Kalshi).
			// Smaller defaults reduce payload for typical UI use.
			depth := intQueryParam(r, "depth", 20)
			if depth < 1 {
				return httpx.BadRequest("depth must be >= 1", nil)
			}
			book, err := svc.GetOrderBook(r.Context(), market.ID, depth)
			if err != nil {
				return httpx.Internal("failed to fetch orderbook", err)
			}
			return httpx.WriteJSON(w, stdhttp.StatusOK, book)
		case "prices":
			// GET /api/v1/markets/{id}/prices?range=1h|1d|1w|1m|all
			// Returns volume-weighted YES price buckets over the
			// requested window. Buckets without trades carry forward
			// the prior price so the line is continuous. Frontend
			// hero + market-detail charts read from here instead of
			// synthesizing a fake walk.
			rng := prediction.PriceHistoryRange(r.URL.Query().Get("range"))
			history, err := svc.GetPriceHistory(r.Context(), market.ID, rng)
			if err != nil {
				return httpx.Internal("failed to fetch price history", err)
			}
			return httpx.WriteJSON(w, stdhttp.StatusOK, history)
		default:
			return httpx.NotFound("market subresource not found")
		}
	}))

	slog.Info("prediction routes registered")
}

func predictionDiscoveryPayload(result *prediction.DiscoveryResponse) *prediction.DiscoveryResponse {
	if result == nil {
		return nil
	}
	out := *result
	out.Featured = predictionMarketPayloads(result.Featured)
	out.Trending = predictionMarketPayloads(result.Trending)
	out.ClosingSoon = predictionMarketPayloads(result.ClosingSoon)
	out.Recent = predictionMarketPayloads(result.Recent)
	return &out
}

func predictionCategoryPayload(category prediction.Category) prediction.Category {
	category.Name = redactLaunchProhibitedUserText(category.Name)
	category.Icon = redactLaunchProhibitedUserText(category.Icon)
	return category
}

func predictionCategoryPayloads(categories []prediction.Category) []prediction.Category {
	if len(categories) == 0 {
		return categories
	}
	out := make([]prediction.Category, 0, len(categories))
	for _, category := range categories {
		out = append(out, predictionCategoryPayload(category))
	}
	return out
}

func predictionSeriesPayload(series prediction.Series) prediction.Series {
	series.Title = redactLaunchProhibitedUserText(series.Title)
	series.Description = redactLaunchProhibitedUserText(series.Description)
	// Tags are list content: drop prohibited entries instead of emitting the
	// sentinel as a browsable tag (matches /api/v1/tags).
	series.Tags = launchListableStrings(series.Tags)
	return series
}

func predictionSeriesPayloads(series []prediction.Series) []prediction.Series {
	if len(series) == 0 {
		return series
	}
	out := make([]prediction.Series, 0, len(series))
	for _, item := range series {
		out = append(out, predictionSeriesPayload(item))
	}
	return out
}

func predictionEventPayload(event prediction.Event) prediction.Event {
	event.Title = redactLaunchProhibitedUserText(event.Title)
	event.Description = redactLaunchProhibitedUserText(event.Description)
	event.Metadata = redactPredictionRawJSONStrings(event.Metadata)
	event.Markets = predictionMarketPayloads(event.Markets)
	return event
}

func predictionEventPayloads(events []prediction.Event) []prediction.Event {
	if len(events) == 0 {
		return events
	}
	out := make([]prediction.Event, 0, len(events))
	for _, event := range events {
		out = append(out, predictionEventPayload(event))
	}
	return out
}

func predictionMarketPayload(market prediction.Market) prediction.Market {
	market.CategoryName = redactLaunchProhibitedUserText(market.CategoryName)
	market.Title = redactLaunchProhibitedUserText(market.Title)
	market.Description = redactLaunchProhibitedUserText(market.Description)
	market.Translations = redactPredictionRawJSONStrings(market.Translations)
	market.SettlementParams = redactPredictionRawJSONStrings(market.SettlementParams)
	market.SettlementRule = redactLaunchProhibitedUserText(market.SettlementRule)
	market.SettlementSourceKey = redactLaunchProhibitedUserText(market.SettlementSourceKey)
	market.FallbackSourceKey = redactStringPointer(market.FallbackSourceKey)
	return market
}

func predictionMarketPayloads(markets []prediction.Market) []prediction.Market {
	if len(markets) == 0 {
		return markets
	}
	out := make([]prediction.Market, 0, len(markets))
	for _, market := range markets {
		out = append(out, predictionMarketPayload(market))
	}
	return out
}

func redactStringPointer(value *string) *string {
	if value == nil {
		return nil
	}
	redacted := redactLaunchProhibitedUserText(*value)
	return &redacted
}

func redactPredictionRawJSONStrings(raw json.RawMessage) json.RawMessage {
	if len(bytes.TrimSpace(raw)) == 0 {
		return raw
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return raw
	}
	encoded, err := json.Marshal(redactLaunchProhibitedJSONStrings(value))
	if err != nil {
		return raw
	}
	return json.RawMessage(encoded)
}

// marketUpdateBroadcaster is the slice of ws.Notifier the order
// handlers need. Defined here (not imported from internal/ws) so the
// prediction HTTP layer stays loosely coupled — any test or future
// transport can plug in a stub.
//
// Includes the four event channels emitted on a successful order fill:
//   - market:<id>     — price/status snapshot for chart + ticker
//   - trades:<id>     — individual trade fill (timestamp, side, price, qty)
//   - portfolio:<uid> — the buyer's updated position row
//   - wallet:<uid>    — the buyer's new balance after the cost+fee debit
//
// All four are fire-and-forget per PLAN §8 — a missed publish is
// recoverable on the client by refetching, but emitting them is what
// makes the live order book / portfolio / balance feel real.
type marketUpdateBroadcaster interface {
	NotifyPredictionMarketUpdate(marketID string, data interface{})
	NotifyPredictionTrade(marketID string, data interface{})
	NotifyPredictionOrderBookUpdate(marketID string, data interface{})
	NotifyPortfolioUpdate(userID string, data interface{})
	NotifyWalletUpdate(userID string, data interface{})
}

// marketUpdatePayload is the wire shape published on `market:<id>` after
// a successful order OR a market lifecycle transition. Keep this in sync
// with the TS PredictionMarket shape on the frontend
// (api-client/src/prediction-types.ts) — the frontend merges these fields
// into local market state on receive.
//
// Status and Result are included so lifecycle transitions (open → halted →
// closed → settled / voided) propagate to subscribers without a refresh.
// Order-fill paths also include them — those don't change on a fill, but
// sending them is harmless and keeps the payload schema uniform.
type marketUpdatePayload struct {
	MarketID             string                   `json:"marketId"`
	Ticker               string                   `json:"ticker"`
	Status               prediction.MarketStatus  `json:"status"`
	Result               *prediction.MarketResult `json:"result,omitempty"`
	YesPricePoints       int                      `json:"yesPricePoints"`
	NoPricePoints        int                      `json:"noPricePoints"`
	LastTradePricePoints *int                     `json:"lastTradePricePoints,omitempty"`
	VolumePoints         int64                    `json:"volumePoints"`
	OpenInterestPoints   int64                    `json:"openInterestPoints"`
	Unit                 string                   `json:"unit"`
	Ts                   string                   `json:"ts"`
}

// wsEventTS returns the `ts` watermark for WS payloads: UTC milliseconds
// with a FIXED-WIDTH fraction, so lexicographic string comparison equals
// time order. RFC3339's whole-second precision was too coarse — a resting
// order's broadcast and the fill that crosses it routinely land in the
// same wall-clock second, and the frontend's ts watermark then saw the
// fill event as "not newer" and dropped it (the price moved in the DB but
// never on screen).
func wsEventTS() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z07:00")
}

// buildOrderBookHintPayload is the wire shape published on `orderbook:<id>`
// after a successful exchange match. Carries best bid/ask for a quick-look
// update; clients refetch GET /markets/{id}/orderbook for full depth.
func buildOrderBookHintPayload(m *prediction.Market) map[string]any {
	return map[string]any{
		"marketId":         m.ID,
		"bestYesBidPoints": m.BestYesBidPoints,
		"bestYesAskPoints": m.BestYesAskPoints,
		"bestNoBidPoints":  m.BestNoBidPoints,
		"bestNoAskPoints":  m.BestNoAskPoints,
		"lastQuoteAt":      m.LastQuoteAt,
		"unit":             "PTS",
		"ts":               wsEventTS(),
	}
}

func buildMarketUpdatePayload(m *prediction.Market) marketUpdatePayload {
	return marketUpdatePayload{
		MarketID:             m.ID,
		Ticker:               m.Ticker,
		Status:               m.Status,
		Result:               m.Result,
		YesPricePoints:       m.YesPricePoints,
		NoPricePoints:        m.NoPricePoints,
		LastTradePricePoints: m.LastTradePricePoints,
		VolumePoints:         m.VolumePoints,
		OpenInterestPoints:   m.OpenInterestPoints,
		Unit:                 "PTS",
		Ts:                   wsEventTS(),
	}
}

// buildTradeFillPayload is the wire shape published on `trades:<marketID>`
// after a fill. The TS PredictionTradeFeed component on the player app
// consumes this to render the live tape.
func buildTradeFillPayload(t *prediction.Trade) map[string]any {
	return map[string]any{
		"tradeId":        t.ID,
		"marketId":       t.MarketID,
		"side":           t.Side,
		"pricePoints":    t.PricePoints,
		"quantity":       t.Quantity,
		"feePoints":      t.FeePoints,
		"notionalPoints": int64(t.PricePoints) * int64(t.Quantity),
		"unit":           "PTS",
		"isAmmTrade":     t.IsAMMTrade,
		"tradedAt":       t.TradedAt.UTC().Format(time.RFC3339),
		"ts":             wsEventTS(),
	}
}

// buildPortfolioUpdatePayload is the wire shape published on
// `portfolio:<userID>` after a fill. The TS portfolio store merges this
// onto the user's local position cache so a trade in one tab updates
// portfolio totals in another tab without a refetch.
//
// Only fields the client actually needs to merge are included — full
// position details still come from /api/v1/portfolio on demand.
func buildPortfolioUpdatePayload(o *prediction.Order, t *prediction.Trade) map[string]any {
	out := map[string]any{
		"userId":   o.UserID,
		"marketId": o.MarketID,
		"orderId":  o.ID,
		"side":     o.Side,
		"action":   o.Action,
		"ts":       wsEventTS(),
	}
	if t != nil {
		out["tradeId"] = t.ID
		out["filledQuantity"] = t.Quantity
		out["filledPricePoints"] = t.PricePoints
		out["unit"] = "PTS"
	}
	return out
}

// buildWalletUpdatePayload is the wire shape published on `wallet:<userID>`
// after a fill. It mirrors the point-native wallet read contract rather than
// exposing the old cash-balance alias.
func buildWalletUpdatePayload(userID string, balancePoints int64, orderID string) map[string]any {
	return map[string]any{
		"userId":        userID,
		"balancePoints": balancePoints,
		"unit":          "PTS",
		"reason":        "order_fill",
		"orderId":       orderID,
	}
}

func registerOrderRoutes(mux *stdhttp.ServeMux, svc *prediction.Service, notifier marketUpdateBroadcaster, webhookEnq webhookEnqueuer) {
	// --- Authenticated: Orders ---
	mux.Handle("/api/v1/orders", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		switch r.Method {
		case stdhttp.MethodGet:
			userID := userIDFromRequest(r)
			if userID == "" {
				return httpx.Unauthorized("authentication required")
			}
			filter := prediction.OrderFilter{
				UserID:   userID,
				Page:     clampedQueryParam(r, "page", 1, 100000),
				PageSize: clampedQueryParam(r, "pageSize", 20, 200),
			}
			if mid := r.URL.Query().Get("marketId"); mid != "" {
				filter.MarketID = &mid
			}
			if status := r.URL.Query().Get("status"); status != "" {
				s := prediction.OrderStatus(status)
				filter.Status = &s
			}
			orders, total, err := svc.ListOrders(r.Context(), filter)
			if err != nil {
				return httpx.Internal("failed to fetch data", err)
			}
			if orders == nil {
				orders = []prediction.Order{}
			}
			return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]interface{}{
				"data": orders,
				"meta": prediction.PageMeta{
					Page:     filter.Page,
					PageSize: filter.PageSize,
					Total:    total,
					HasNext:  filter.Page*filter.PageSize < total,
				},
			})

		case stdhttp.MethodPost:
			userID := userIDFromRequest(r)
			if userID == "" {
				return httpx.Unauthorized("authentication required")
			}
			// Jurisdiction + KYC gates. Both default-off; no-op until configured
			// (see pretrade_gate.go).
			if err := checkComplianceGates(r, userID, compliance.SurfaceTrade); err != nil {
				return err
			}
			req, err := decodePlaceOrderHTTPRequest(r.Body)
			if err != nil {
				return err
			}
			if err := validatePlaceOrderHTTPRequest(req); err != nil {
				return err
			}
			// Per-market jurisdiction overlay (P3-07): once the global gate has
			// passed, a market may further restrict by country. Fail closed if
			// the policy lookup errors.
			jpolicy, jerr := svc.GetMarketJurisdictionPolicy(r.Context(), req.MarketID)
			if jerr != nil {
				slog.ErrorContext(r.Context(), "order: jurisdiction policy lookup failed", "market_id", req.MarketID, "error", jerr)
				return httpx.Forbidden("jurisdiction check unavailable")
			}
			if cerr := checkMarketJurisdiction(r, userID, req.MarketID, jpolicy); cerr != nil {
				return cerr
			}
			order, trade, err := svc.PlaceOrder(r.Context(), req, userID)
			if err != nil {
				return orderPlacementError(err)
			}

			// Broadcast the post-trade state on four channels.
			// All publishes are fire-and-forget per PLAN §8 — a missed
			// broadcast is recoverable on the client by refetching, and
			// the next trade re-publishes anyway.
			//
			//   market:<id>     — price/status snapshot for chart + ticker
			//   trades:<id>     — the new trade fill (price, qty, side, ts)
			//   portfolio:<uid> — buyer's updated position holdings + cost basis
			//   wallet:<uid>    — buyer's new balance after debit + fee
			//
			// Without these broadcasts a user watching their portfolio in
			// one tab would not see their own trade until they manually
			// refreshed. Defining the wider notifier interface but not
			// calling it (the prior state) was dead wiring.
			if notifier != nil {
				if updated, mErr := svc.GetMarket(r.Context(), req.MarketID); mErr == nil {
					notifier.NotifyPredictionMarketUpdate(req.MarketID, buildMarketUpdatePayload(updated))
					// Exchange-mode markets also publish a book-change hint
					// so subscribers know to refetch /orderbook. The payload
					// carries best bid/ask for a quick-look update.
					if updated.ExecutionMode == prediction.ExecutionModeOrderBook {
						notifier.NotifyPredictionOrderBookUpdate(req.MarketID, buildOrderBookHintPayload(updated))
					}
				}
				if trade != nil {
					notifier.NotifyPredictionTrade(req.MarketID, buildTradeFillPayload(trade))
				}
				notifier.NotifyPortfolioUpdate(userID, buildPortfolioUpdatePayload(order, trade))
				if balance := svc.WalletBalance(r.Context(), userID); balance >= 0 {
					notifier.NotifyWalletUpdate(userID, buildWalletUpdatePayload(userID, balance, order.ID))
				}
			}

			// Outbound webhook (P3-03): a fill enqueues an order.filled event
			// for subscribed partner endpoints. Independent of the WS notifier
			// (separate sink) and post-commit fire-and-forget — the dispatch
			// worker signs, delivers, and retries.
			if trade != nil {
				enqueueOrderFilled(r.Context(), webhookEnq, trade)
			}

			return httpx.WriteJSON(w, stdhttp.StatusCreated, map[string]interface{}{
				"order": order,
				"trade": trade,
			})

		default:
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet, stdhttp.MethodPost)
		}
	}))

	mux.Handle("/api/v1/orders/preview", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}
		req, err := decodePlaceOrderHTTPRequest(r.Body)
		if err != nil {
			return err
		}
		preview, err := svc.PreviewOrderForUser(r.Context(), req, userIDFromRequest(r))
		if err != nil {
			return serviceBadRequestError(err, nil)
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, preview)
	}))

	// POST /api/v1/orders/{id}/cancel — release reservation + mark cancelled.
	// The api-client's cancelOrder() has been calling this path since the
	// client was first written, but the server route was missing — calls
	// 404'd. Service.CancelOrder is fully implemented (releases the
	// wallet reservation in a tx for exchange orders); we just needed to
	// expose it. The catch-all on /api/v1/orders/ dispatches to this
	// handler when the path matches.
	mux.Handle("/api/v1/orders/", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		// Path shape: /api/v1/orders/{id}/cancel
		const prefix = "/api/v1/orders/"
		const suffix = "/cancel"
		path := r.URL.Path
		if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
			return httpx.NotFound("unknown orders subpath")
		}
		orderID := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
		if orderID == "" || strings.Contains(orderID, "/") {
			return httpx.BadRequest("invalid order id", nil)
		}
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}
		userID := userIDFromRequest(r)
		if userID == "" {
			return httpx.Unauthorized("authentication required")
		}
		if err := svc.CancelOrder(r.Context(), orderID, userID); err != nil {
			// Distinguish ownership / not-found / state-transition errors so
			// the frontend can surface a useful message.
			msg := err.Error()
			switch {
			case strings.Contains(msg, "not found"):
				return httpx.NotFound(msg)
			case strings.Contains(msg, "does not belong"):
				return httpx.Forbidden(msg)
			default:
				return httpx.BadRequest(msg, nil)
			}
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]string{"status": "cancelled"})
	}))

	slog.Info("order routes registered")
}

func orderPlacementError(err error) error {
	if err == nil {
		return nil
	}
	message := err.Error()
	if strings.Contains(message, "Prediction limit exceeded") || strings.Contains(message, "prediction limit exceeded") {
		return serviceBadRequestError(err, map[string]any{"reasonCode": "prediction_limit_exceeded"})
	}
	if strings.Contains(message, "responsible-play controls") {
		return serviceBadRequestError(err, map[string]any{"reasonCode": "responsible_play_blocked"})
	}
	return serviceBadRequestError(err, nil)
}

func serviceBadRequestError(err error, details any) error {
	if err == nil {
		return nil
	}
	return httpx.BadRequest(redactLaunchProhibitedUserText(err.Error()), details)
}

func decodePlaceOrderHTTPRequest(r io.Reader) (prediction.PlaceOrderRequest, error) {
	var raw map[string]json.RawMessage
	if err := json.NewDecoder(r).Decode(&raw); err != nil {
		return prediction.PlaceOrderRequest{}, httpx.BadRequest("invalid request body", nil)
	}
	// Points unit-model (2026-07-07): launch boundary rejects the retired
	// cents-era keys outright (banned literals, not live fields); the
	// canonical request keys are pricePoints / notionalCapPoints.
	if _, ok := raw["priceCents"]; ok {
		return prediction.PlaceOrderRequest{}, httpx.BadRequest("use pricePoints for limit order prices", map[string]any{"field": "pricePoints"})
	}
	if _, ok := raw["notionalCapCents"]; ok {
		return prediction.PlaceOrderRequest{}, httpx.BadRequest("use notionalCapPoints for market buy caps", map[string]any{"field": "notionalCapPoints"})
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return prediction.PlaceOrderRequest{}, httpx.BadRequest("invalid request body", nil)
	}
	var req prediction.PlaceOrderRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return prediction.PlaceOrderRequest{}, httpx.BadRequest("invalid request body", nil)
	}
	return req, nil
}

func validatePlaceOrderHTTPRequest(req prediction.PlaceOrderRequest) error {
	// Explicit field validation. The struct already carries
	// `validate:"required,oneof=..."` tags, but no validator is wired into
	// the handler chain. Without these checks, invalid requests can reach the
	// repository INSERT and surface as confusing schema constraint errors.
	if strings.TrimSpace(req.MarketID) == "" {
		return httpx.BadRequest("marketId is required", map[string]any{"field": "marketId"})
	}
	switch req.Side {
	case prediction.OrderSideYes, prediction.OrderSideNo:
	default:
		return httpx.BadRequest("side must be \"yes\" or \"no\"", map[string]any{"field": "side", "got": string(req.Side)})
	}
	switch req.Action {
	case prediction.OrderActionBuy, prediction.OrderActionSell:
	default:
		return httpx.BadRequest("action must be \"buy\" or \"sell\"", map[string]any{"field": "action", "got": string(req.Action)})
	}
	switch req.OrderType {
	case prediction.OrderTypeMarket, prediction.OrderTypeLimit:
	default:
		return httpx.BadRequest("orderType must be \"market\" or \"limit\"", map[string]any{"field": "orderType", "got": string(req.OrderType)})
	}
	if req.Quantity <= 0 {
		return httpx.BadRequest("quantity must be > 0", map[string]any{"field": "quantity", "got": req.Quantity})
	}
	if req.OrderType == prediction.OrderTypeLimit {
		if req.PricePoints == nil || *req.PricePoints < 1 || *req.PricePoints > 99 {
			return httpx.BadRequest("limit orders require pricePoints in 1..99", map[string]any{"field": "pricePoints"})
		}
	}
	// Exchange-engine field validation. These map 1:1 to schema CHECK
	// constraints from migration 019. Empty/zero values are fine; the service
	// applies defaults (gtc + cancel_taker).
	if req.TimeInForce != "" {
		switch req.TimeInForce {
		case prediction.TIFGTC, prediction.TIFIOC, prediction.TIFFOK:
		default:
			return httpx.BadRequest("timeInForce must be one of gtc, ioc, fok", map[string]any{"field": "timeInForce", "got": string(req.TimeInForce)})
		}
	}
	if req.SelfMatchAction != "" {
		switch req.SelfMatchAction {
		case prediction.SelfMatchCancelTaker, prediction.SelfMatchCancelMaker, prediction.SelfMatchCancelBoth:
		default:
			return httpx.BadRequest("selfMatchAction must be one of cancel_taker, cancel_maker, cancel_both", map[string]any{"field": "selfMatchAction", "got": string(req.SelfMatchAction)})
		}
	}
	if req.OrderType == prediction.OrderTypeMarket && req.Action == prediction.OrderActionBuy {
		if req.NotionalCapPoints == nil || *req.NotionalCapPoints <= 0 {
			return httpx.BadRequest("market buy orders require notionalCapPoints > 0", map[string]any{"field": "notionalCapPoints"})
		}
	}
	return nil
}

func registerPortfolioRoutes(mux *stdhttp.ServeMux, svc *prediction.Service) {
	mux.Handle("/api/v1/portfolio", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		userID := userIDFromRequest(r)
		if userID == "" {
			return httpx.Unauthorized("authentication required")
		}
		positions, err := svc.ListPositions(r.Context(), userID)
		if err != nil {
			return httpx.Internal("failed to fetch data", err)
		}
		if positions == nil {
			positions = []prediction.Position{}
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, positions)
	}))

	mux.Handle("/api/v1/portfolio/summary", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		userID := userIDFromRequest(r)
		if userID == "" {
			return httpx.Unauthorized("authentication required")
		}
		summary, err := svc.GetPortfolioSummary(r.Context(), userID)
		if err != nil {
			return httpx.Internal("failed to fetch data", err)
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, summary)
	}))

	// Portfolio history — paginated settled prediction results.
	mux.Handle("/api/v1/portfolio/history", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		userID := userIDFromRequest(r)
		if userID == "" {
			return httpx.Unauthorized("authentication required")
		}
		page := clampedQueryParam(r, "page", 1, 100000)
		pageSize := clampedQueryParam(r, "pageSize", 20, 200)
		payouts, total, err := svc.ListSettledPositions(r.Context(), userID, page, pageSize)
		if err != nil {
			return httpx.Internal("failed to fetch data", err)
		}
		if payouts == nil {
			payouts = []prediction.Payout{}
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]interface{}{
			"data": portfolioHistoryItems(payouts),
			"meta": prediction.PageMeta{
				Page:     page,
				PageSize: pageSize,
				Total:    total,
				HasNext:  page*pageSize < total,
			},
		})
	}))

	slog.Info("portfolio routes registered")
}

func portfolioHistoryItems(payouts []prediction.Payout) []portfolioHistoryItem {
	if payouts == nil {
		return []portfolioHistoryItem{}
	}
	items := make([]portfolioHistoryItem, 0, len(payouts))
	for _, payout := range payouts {
		items = append(items, portfolioHistoryItem{
			ID:               payout.ID,
			SettlementID:     payout.SettlementID,
			PositionID:       payout.PositionID,
			UserID:           payout.UserID,
			MarketID:         payout.MarketID,
			Side:             payout.Side,
			Quantity:         payout.Quantity,
			EntryPricePoints: payout.EntryPricePoints,
			ExitPricePoints:  payout.ExitPricePoints,
			RealizedPoints:   payout.PnlPoints,
			SettlementPoints: payout.PayoutPoints,
			PaidAt:           payout.PaidAt,
			Unit:             "PTS",
		})
	}
	return items
}

func settlementOperationPayload(settlement *prediction.Settlement, payouts []prediction.Payout) settlementOperationResponse {
	disbursements := settlementPointDisbursements(payouts)
	settlementPayload := settlementRecordPayload(settlement)
	return settlementOperationResponse{
		Settlement:            settlementPayload,
		PointDisbursements:    disbursements,
		TotalSettlementPoints: settlementPayload.TotalSettlementPoints,
		Unit:                  "PTS",
		TapTradeLifecycle:     prediction.DescribeTapTradeMarketLifecycle(prediction.MarketStatusSettled),
	}
}

func settlementRecordPayload(settlement *prediction.Settlement) settlementRecordResponse {
	if settlement == nil {
		return settlementRecordResponse{Unit: "PTS"}
	}
	overrideReason := settlement.OverrideReason
	if overrideReason != nil {
		redacted := redactLaunchProhibitedUserText(*overrideReason)
		overrideReason = &redacted
	}
	return settlementRecordResponse{
		ID:                    settlement.ID,
		MarketID:              settlement.MarketID,
		Result:                settlement.Result,
		AttestationSource:     settlement.AttestationSource,
		AttestationID:         settlement.AttestationID,
		AttestationDigest:     settlement.AttestationDigest,
		AttestationData:       settlement.AttestationData,
		SettledBy:             settlement.SettledBy,
		SettledAt:             settlement.SettledAt,
		PositionsSettled:      settlement.PositionsSettled,
		OverrideReason:        overrideReason,
		OverriddenByUserID:    settlement.OverriddenByUserID,
		OverriddenAt:          settlement.OverriddenAt,
		TotalSettlementPoints: settlement.TotalPayoutPoints,
		Unit:                  "PTS",
	}
}

func settlementPointDisbursements(payouts []prediction.Payout) []settlementPointDisbursement {
	if payouts == nil {
		return []settlementPointDisbursement{}
	}
	disbursements := make([]settlementPointDisbursement, 0, len(payouts))
	for _, payout := range payouts {
		disbursements = append(disbursements, settlementPointDisbursement{
			ID:               payout.ID,
			SettlementID:     payout.SettlementID,
			PositionID:       payout.PositionID,
			UserID:           payout.UserID,
			MarketID:         payout.MarketID,
			Side:             payout.Side,
			Quantity:         payout.Quantity,
			EntryPricePoints: payout.EntryPricePoints,
			ExitPricePoints:  payout.ExitPricePoints,
			RealizedPoints:   payout.PnlPoints,
			SettlementPoints: payout.PayoutPoints,
			PaidAt:           payout.PaidAt,
			Unit:             "PTS",
		})
	}
	return disbursements
}

func totalSettlementPoints(payouts []prediction.Payout) int64 {
	var total int64
	for _, payout := range payouts {
		total += payout.PayoutPoints
	}
	return total
}

func registerSettlementRoutes(mux *stdhttp.ServeMux, svc *prediction.Service) {
	// Admin: list markets (GET — includes unopened drafts) + create market (POST)
	mux.Handle("/api/v1/admin/markets", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if err := requireAdminPermission(r, "markets:edit"); err != nil {
			return err
		}

		// GET: admin market list. Unlike the public /api/v1/markets, this includes
		// pre-launch `unopened` drafts so the backoffice can review and open them,
		// and launch-scrubbed markets so ops can audit what the public list hides.
		if r.Method == stdhttp.MethodGet {
			filter := prediction.MarketFilter{
				Page:                  clampedQueryParam(r, "page", 1, 100000),
				PageSize:              clampedQueryParam(r, "pageSize", 20, 500),
				IncludeUnopened:       true,
				IncludeLaunchScrubbed: true,
			}
			if eid := r.URL.Query().Get("eventId"); eid != "" {
				filter.EventID = &eid
			}
			if cid := r.URL.Query().Get("categoryId"); cid != "" {
				filter.CategoryID = &cid
			}
			if status := r.URL.Query().Get("status"); status != "" {
				s := prediction.MarketStatus(status)
				filter.Status = &s
			}
			if ticker := r.URL.Query().Get("ticker"); ticker != "" {
				filter.Ticker = &ticker
			}
			markets, total, err := svc.ListMarkets(r.Context(), filter)
			if err != nil {
				return httpx.Internal("failed to fetch data", err)
			}
			if strings.EqualFold(r.URL.Query().Get("format"), "csv") {
				return writeAdminMarketsCSV(w, markets)
			}
			return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]interface{}{
				"data": predictionMarketPayloads(markets),
				"meta": prediction.PageMeta{
					Page:     filter.Page,
					PageSize: filter.PageSize,
					Total:    total,
					HasNext:  filter.Page*filter.PageSize < total,
				},
			})
		}

		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet, stdhttp.MethodPost)
		}

		req, err := decodeCreateMarketRequest(r)
		if err != nil {
			return err
		}
		req.CreatedBy = actorIDPointer(userIDFromRequest(r))
		market, err := svc.CreateMarket(r.Context(), req)
		if err != nil {
			return serviceBadRequestError(err, nil)
		}
		return httpx.WriteJSON(w, stdhttp.StatusCreated, market)
	}))

	// Admin: persist AI-drafting provenance — the source article (deduped on a
	// SHA-256 of the article text) plus the generation-log entries that produced
	// the draft. Returns the article source id, which the caller then passes as
	// CreateMarketRequest.ArticleSourceID when creating the market.
	mux.Handle("/api/v1/admin/market-sources", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if err := requireAdminRole(r); err != nil {
			return err
		}
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}

		var req prediction.CreateMarketSourceRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return httpx.BadRequest("invalid request body", nil)
		}

		// Attribute provenance to the acting admin; never trust client-sent ids.
		actor := actorIDPointer(userIDFromRequest(r))
		req.Source.CreatedBy = actor

		src, err := svc.CreateArticleSource(r.Context(), &req.Source)
		if err != nil {
			return serviceBadRequestError(err, nil)
		}

		logIDs := make([]string, 0, len(req.GenerationLogs))
		for i := range req.GenerationLogs {
			entry := req.GenerationLogs[i]
			entry.ArticleSourceID = &src.ID
			entry.CreatedBy = actor
			if err := svc.LogAIGeneration(r.Context(), &entry); err != nil {
				return httpx.Internal("failed to record ai generation log", err)
			}
			if entry.ID != "" {
				logIDs = append(logIDs, entry.ID)
			}
		}

		return httpx.WriteJSON(w, stdhttp.StatusCreated, prediction.CreateMarketSourceResponse{
			ArticleSourceID:    src.ID,
			AIGenerationLogIDs: logIDs,
		})
	}))

	// Admin: reserve AI budget before invoking the LLM. This records a
	// draft_request attempt so rate limits are DB-backed and cross-instance.
	mux.Handle("/api/v1/admin/ai-budget/reserve", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if err := requireAdminRole(r); err != nil {
			return err
		}
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}
		var req prediction.ReserveAIBudgetRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return httpx.BadRequest("invalid request body", nil)
		}
		status, err := svc.ReserveAIBudget(r.Context(), userIDFromRequest(r), req.EstimatedInputTokens)
		if err != nil {
			return httpx.Internal("failed to reserve ai budget", err)
		}
		if !status.Allowed {
			return httpx.WriteJSON(w, stdhttp.StatusTooManyRequests, status)
		}
		return httpx.WriteJSON(w, stdhttp.StatusCreated, status)
	}))

	// Admin: Create event (the parent an AI-drafted or hand-made market attaches to).
	mux.Handle("/api/v1/admin/events", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if err := requireAdminPermission(r, "markets:edit"); err != nil {
			return err
		}
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}
		var req prediction.CreateEventRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return httpx.BadRequest("invalid request body", nil)
		}
		if err := validateAdminEventLaunchCopy(req); err != nil {
			return err
		}
		req.CreatedBy = actorIDPointer(userIDFromRequest(r))
		event, err := svc.CreateEvent(r.Context(), req)
		if err != nil {
			return serviceBadRequestError(err, nil)
		}
		return httpx.WriteJSON(w, stdhttp.StatusCreated, event)
	}))

	// Admin: curate an event's home-page presentation — the featured flag
	// that puts it in the "This week" rail and its cover photo. Metadata
	// only: it never moves points or changes lifecycle/settlement state.
	mux.Handle("/api/v1/admin/events/", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if err := requireAdminPermission(r, "markets:edit"); err != nil {
			return err
		}
		if r.Method != stdhttp.MethodPatch {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPatch)
		}
		id := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/admin/events/"), "/")
		if id == "" || strings.Contains(id, "/") {
			return httpx.NotFound("route not found")
		}
		var req prediction.UpdateEventPresentationRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return httpx.BadRequest("invalid request body", nil)
		}
		event, err := svc.UpdateEventPresentation(r.Context(), id, req)
		if err != nil {
			if errors.Is(err, prediction.ErrEventNotFound) {
				return httpx.NotFound("event not found")
			}
			return serviceBadRequestError(err, nil)
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, predictionEventPayload(*event))
	}))

	// Admin: AI-drafting budget pre-flight (per-admin rate + daily token cap).
	mux.Handle("/api/v1/admin/ai-budget", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if err := requireAdminRole(r); err != nil {
			return err
		}
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		status, err := svc.CheckAIBudget(r.Context(), userIDFromRequest(r))
		if err != nil {
			return httpx.Internal("failed to check ai budget", err)
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, status)
	}))

	// Admin: discovery taxonomy. Categories, series, and their tags are
	// metadata-only discovery controls: they never move points or change market
	// settlement state.
	mux.Handle("/api/v1/admin/categories", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if err := requireAdminPermission(r, "markets:edit"); err != nil {
			return err
		}
		switch r.Method {
		case stdhttp.MethodGet:
			categories, err := svc.ListCategories(r.Context(), false)
			if err != nil {
				return httpx.Internal("failed to fetch categories", err)
			}
			if categories == nil {
				categories = []prediction.Category{}
			}
			return httpx.WriteJSON(w, stdhttp.StatusOK, predictionCategoryPayloads(categories))
		case stdhttp.MethodPost:
			var req adminCategoryRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				return httpx.BadRequest("invalid request body", nil)
			}
			name := strings.TrimSpace(req.Name)
			slug := normalizeTaxonomySlug(req.Slug)
			if name == "" {
				return httpx.BadRequest("category name required", map[string]any{"field": "name"})
			}
			if slug == "" {
				slug = normalizeTaxonomySlug(name)
			}
			if slug == "" {
				return httpx.BadRequest("category slug required", map[string]any{"field": "slug"})
			}
			if err := validateLaunchFacingReason("name", name); err != nil {
				return err
			}
			category := &prediction.Category{
				Slug:      slug,
				Name:      name,
				Icon:      strings.TrimSpace(req.Icon),
				SortOrder: req.SortOrder,
				Active:    boolDefault(req.Active, true),
			}
			if err := svc.CreateCategory(r.Context(), category); err != nil {
				return serviceBadRequestError(err, nil)
			}
			recordProviderOpsAuditAction(userIDFromRequest(r), "taxonomy.category_created", category.ID, map[string]any{
				"slug":   category.Slug,
				"active": category.Active,
			})
			return httpx.WriteJSON(w, stdhttp.StatusCreated, predictionCategoryPayload(*category))
		default:
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet, stdhttp.MethodPost)
		}
	}))

	mux.Handle("/api/v1/admin/series", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if err := requireAdminPermission(r, "markets:edit"); err != nil {
			return err
		}
		var categoryID *string
		if cid := strings.TrimSpace(r.URL.Query().Get("categoryId")); cid != "" {
			categoryID = &cid
		}
		switch r.Method {
		case stdhttp.MethodGet:
			series, err := svc.ListSeries(r.Context(), categoryID)
			if err != nil {
				return httpx.Internal("failed to fetch series", err)
			}
			if series == nil {
				series = []prediction.Series{}
			}
			return httpx.WriteJSON(w, stdhttp.StatusOK, predictionSeriesPayloads(series))
		case stdhttp.MethodPost:
			var req adminSeriesRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				return httpx.BadRequest("invalid request body", nil)
			}
			title := strings.TrimSpace(req.Title)
			slug := normalizeTaxonomySlug(req.Slug)
			if title == "" {
				return httpx.BadRequest("series title required", map[string]any{"field": "title"})
			}
			if slug == "" {
				slug = normalizeTaxonomySlug(title)
			}
			if slug == "" {
				return httpx.BadRequest("series slug required", map[string]any{"field": "slug"})
			}
			categoryID := strings.TrimSpace(req.CategoryID)
			if categoryID == "" {
				return httpx.BadRequest("category id required", map[string]any{"field": "categoryId"})
			}
			if err := validateAdminSeriesLaunchCopy(title, req.Description, req.Tags); err != nil {
				return err
			}
			series := &prediction.Series{
				Slug:        slug,
				Title:       title,
				Description: strings.TrimSpace(req.Description),
				CategoryID:  categoryID,
				Frequency:   strings.TrimSpace(req.Frequency),
				Tags:        normalizeTags(req.Tags),
				Active:      boolDefault(req.Active, true),
			}
			if err := svc.CreateSeries(r.Context(), series); err != nil {
				return serviceBadRequestError(err, nil)
			}
			recordProviderOpsAuditAction(userIDFromRequest(r), "taxonomy.series_created", series.ID, map[string]any{
				"slug":       series.Slug,
				"categoryId": series.CategoryID,
				"tags":       series.Tags,
				"active":     series.Active,
			})
			return httpx.WriteJSON(w, stdhttp.StatusCreated, predictionSeriesPayload(*series))
		default:
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet, stdhttp.MethodPost)
		}
	}))

	mux.Handle("/api/v1/admin/tags", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if err := requireAdminPermission(r, "markets:edit"); err != nil {
			return err
		}
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		var categoryID *string
		if cid := strings.TrimSpace(r.URL.Query().Get("categoryId")); cid != "" {
			categoryID = &cid
		}
		tags, err := svc.ListTags(r.Context(), categoryID)
		if err != nil {
			return httpx.Internal("failed to fetch tags", err)
		}
		// Prohibited tags are dropped, not redacted, even for admins: the
		// sentinel is not the stored tag value, so emitting it here would
		// offer a filter chip that can never match anything.
		tags = launchListableStrings(tags)
		if tags == nil {
			tags = []string{}
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{"tags": tags})
	}))

	// Admin: Market lifecycle transitions
	mux.Handle("/api/v1/admin/markets/", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if err := requireAdminPermission(r, "markets:edit"); err != nil {
			return err
		}
		path := strings.TrimPrefix(r.URL.Path, "/api/v1/admin/markets/")
		parts := strings.Split(path, "/")
		if len(parts) == 0 || parts[0] == "" {
			return httpx.NotFound("route not found")
		}

		// P3-07: read-only GET of the per-market jurisdiction overlay so the
		// back-office form can pre-fill its control. Handled before the
		// POST-only gate and the dual-control identity guard below — reading an
		// overlay is neither a write nor a dual-control action. Every other
		// verb/route on this handler stays POST-only.
		if len(parts) == 2 &&
			strings.EqualFold(strings.TrimSpace(parts[1]), "jurisdiction") &&
			r.Method == stdhttp.MethodGet {
			policy, err := svc.GetMarketJurisdictionPolicy(r.Context(), parts[0])
			if err != nil {
				return httpx.Internal("failed to read jurisdiction policy", err)
			}
			return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{"marketId": parts[0], "policy": policy})
		}
		if len(parts) == 2 &&
			strings.EqualFold(strings.TrimSpace(parts[1]), "lifecycle") &&
			r.Method == stdhttp.MethodGet {
			events, err := svc.ListLifecycleEvents(r.Context(), parts[0])
			if err != nil {
				return httpx.Internal("failed to read lifecycle audit", err)
			}
			rows := lifecycleAuditEventResponses(events)
			if strings.EqualFold(r.URL.Query().Get("format"), "csv") {
				return writeLifecycleAuditCSV(w, parts[0], rows)
			}
			return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
				"marketId": parts[0],
				"data":     rows,
			})
		}

		adminID := userIDFromRequest(r)
		actorID := actorIDPointer(adminID)

		if len(parts) == 1 {
			switch r.Method {
			case stdhttp.MethodGet:
				market, err := svc.GetMarket(r.Context(), parts[0])
				if err != nil {
					return httpx.NotFound("market not found")
				}
				return httpx.WriteJSON(w, stdhttp.StatusOK, predictionMarketPayload(*market))
			case stdhttp.MethodPut:
				req, err := decodeCreateMarketRequest(r)
				if err != nil {
					return err
				}
				req.CreatedBy = actorID
				market, err := svc.UpdateMarket(r.Context(), parts[0], req)
				if err != nil {
					return serviceBadRequestError(err, nil)
				}
				recordProviderOpsAuditAction(adminID, "market.edited", parts[0], map[string]any{
					"ticker": market.Ticker,
					"title":  market.Title,
				})
				return httpx.WriteJSON(w, stdhttp.StatusOK, predictionMarketPayload(*market))
			default:
				return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet, stdhttp.MethodPut)
			}
		}

		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}

		// ADR-0003/0004 windowed resolution (two-part {id}/{action}). Dual-
		// control is enforced in the engine: the finalizing admin must differ
		// from the proposer of the resolution.
		if len(parts) == 2 {
			// Dual-control needs an identifiable actor. An admin with the role
			// but no session uid would store proposed_by=NULL, which the
			// AutoSettler treats as system-proposed and auto-finalizes —
			// bypassing the second-admin requirement. Refuse instead.
			if adminID == "" {
				return httpx.Forbidden("an identified admin is required for resolution actions (dual-control)")
			}
			switch strings.ToLower(strings.TrimSpace(parts[1])) {
			case "propose":
				var req prediction.ResolveMarketRequest
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
					return httpx.BadRequest("invalid request body", nil)
				}
				if err := sanitizeResolveMarketRequest(&req); err != nil {
					return err
				}
				window := prediction.DefaultChallengeWindow
				if raw, ok := r.URL.Query()["windowHours"]; ok {
					h, err := strconv.Atoi(strings.TrimSpace(raw[0]))
					if err != nil || h < 0 {
						return httpx.BadRequest("windowHours must be a non-negative integer", map[string]any{"field": "windowHours"})
					}
					window = time.Duration(h) * time.Hour
				}
				proposal, err := svc.ProposeResolution(r.Context(), parts[0], req, actorID, window)
				if err != nil {
					return serviceBadRequestError(err, nil)
				}
				recordProviderOpsAuditAction(adminID, "market.resolution_proposed", parts[0], map[string]any{
					"result":          proposal.Result,
					"challengeEndsAt": proposal.ChallengeEndsAt,
				})
				return httpx.WriteJSON(w, stdhttp.StatusOK, proposal)
			case "finalize":
				settlement, payouts, err := svc.FinalizeResolution(r.Context(), parts[0], actorID)
				if err != nil {
					if errors.Is(err, prediction.ErrStaleMarketStatus) {
						return httpx.Conflict("market was settled or voided by a concurrent operation", nil)
					}
					return serviceBadRequestError(err, nil)
				}
				recordProviderOpsAuditAction(adminID, "market.finalized", parts[0], map[string]any{
					"settlementId":           settlement.ID,
					"totalSettlementPoints":  settlement.TotalPayoutPoints,
					"pointDisbursementCount": len(payouts),
					"unit":                   "PTS",
				})
				return httpx.WriteJSON(w, stdhttp.StatusOK, settlementOperationPayload(settlement, payouts))
			case "jurisdiction":
				// Set or clear the per-market jurisdiction overlay (P3-07).
				// Strict validation here (unlike the lenient read-path parser):
				// a malformed body is rejected, not silently treated as "clear".
				var in prediction.MarketJurisdictionPolicy
				if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
					return httpx.BadRequest("invalid request body", nil)
				}
				in.Mode = prediction.JurisdictionMode(strings.ToLower(strings.TrimSpace(string(in.Mode))))
				var policy *prediction.MarketJurisdictionPolicy
				if in.Mode != "" || len(in.Countries) > 0 { // empty body = clear
					if in.Mode != prediction.JurisdictionAllow && in.Mode != prediction.JurisdictionDeny {
						return httpx.BadRequest(`jurisdiction mode must be "allow" or "deny"`, map[string]any{"field": "mode"})
					}
					if len(in.Countries) == 0 {
						return httpx.BadRequest("jurisdiction policy requires a non-empty countries list", map[string]any{"field": "countries"})
					}
					policy = &in
				}
				if err := svc.SetMarketJurisdictionPolicy(r.Context(), parts[0], policy); err != nil {
					if errors.Is(err, prediction.ErrJurisdictionUnsupported) {
						return httpx.BadRequest("per-market jurisdiction is not supported by this deployment", nil)
					}
					return serviceBadRequestError(err, nil)
				}
				recordProviderOpsAuditAction(adminID, "market.jurisdiction_set", parts[0], map[string]any{
					"cleared": policy == nil,
				})
				return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{"marketId": parts[0], "policy": policy})
			default:
				return httpx.NotFound("route not found")
			}
		}

		if len(parts) != 3 || parts[1] != "lifecycle" || parts[2] == "" {
			return httpx.NotFound("route not found")
		}
		reason, err := decodeLifecycleReason(r)
		if err != nil {
			return err
		}

		switch strings.ToLower(strings.TrimSpace(parts[2])) {
		case "open":
			if reason == "" {
				reason = "market opened by admin"
			}
			if err := svc.TransitionMarketStatus(r.Context(), parts[0], prediction.MarketStatusOpen, reason, actorID); err != nil {
				return serviceBadRequestError(err, nil)
			}
			return httpx.WriteJSON(w, stdhttp.StatusOK, marketLifecycleResponse(parts[0], prediction.MarketStatusOpen, reason))
		case "halt", "halted":
			if reason == "" {
				reason = "market halted by admin"
			}
			if err := svc.TransitionMarketStatus(r.Context(), parts[0], prediction.MarketStatusHalted, reason, actorID); err != nil {
				return serviceBadRequestError(err, nil)
			}
			return httpx.WriteJSON(w, stdhttp.StatusOK, marketLifecycleResponse(parts[0], prediction.MarketStatusHalted, reason))
		case "close", "closed":
			if reason == "" {
				reason = "market closed by admin"
			}
			if err := svc.TransitionMarketStatus(r.Context(), parts[0], prediction.MarketStatusClosed, reason, actorID); err != nil {
				return serviceBadRequestError(err, nil)
			}
			return httpx.WriteJSON(w, stdhttp.StatusOK, marketLifecycleResponse(parts[0], prediction.MarketStatusClosed, reason))
		case "void", "voided":
			if reason == "" {
				reason = "market voided by admin"
			}
			payouts, err := svc.VoidMarket(r.Context(), parts[0], reason, actorID)
			if err != nil {
				if errors.Is(err, prediction.ErrStaleMarketStatus) {
					return httpx.Conflict("market was settled or voided by a concurrent operation", nil)
				}
				return serviceBadRequestError(err, nil)
			}
			recordProviderOpsAuditAction(adminID, "market.voided", parts[0], map[string]any{
				"reason":                 reason,
				"pointDisbursementCount": len(payouts),
				"unit":                   "PTS",
			})
			payload := marketLifecycleResponse(parts[0], prediction.MarketStatusVoided, reason)
			disbursements := settlementPointDisbursements(payouts)
			payload["pointDisbursements"] = disbursements
			payload["totalSettlementPoints"] = totalSettlementPoints(payouts)
			payload["unit"] = "PTS"
			return httpx.WriteJSON(w, stdhttp.StatusOK, payload)
		default:
			return httpx.BadRequest("unsupported lifecycle action", map[string]any{"action": parts[2]})
		}
	}))

	// Admin: Settle market
	mux.Handle("/api/v1/admin/settlements/", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if err := requireAdminPermission(r, "settlements:resolve"); err != nil {
			return err
		}
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}
		marketID := r.URL.Path[len("/api/v1/admin/settlements/"):]
		if marketID == "" {
			return httpx.BadRequest("market id required", nil)
		}
		adminID := userIDFromRequest(r)
		if strings.EqualFold(strings.TrimSpace(marketID), "replay") {
			completed, err := svc.ResumeIncompleteSettlements(r.Context())
			if err != nil {
				return httpx.Internal("failed to replay settlement disbursements", err)
			}
			recordProviderOpsAuditAction(adminID, "settlements.replay", "settlements", map[string]any{
				"completedSettlements": completed,
			})
			return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
				"completedSettlements": completed,
				"summary":              "Replayed incomplete settlement point disbursements",
			})
		}
		var req prediction.ResolveMarketRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return httpx.BadRequest("invalid request body", nil)
		}
		if err := sanitizeResolveMarketRequest(&req); err != nil {
			return err
		}
		settlement, payouts, err := svc.ResolveMarket(r.Context(), marketID, req, actorIDPointer(adminID))
		if err != nil {
			if errors.Is(err, prediction.ErrStaleMarketStatus) {
				return httpx.Conflict("market was settled or voided by a concurrent operation", nil)
			}
			return serviceBadRequestError(err, nil)
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, settlementOperationPayload(settlement, payouts))
	}))

	slog.Info("settlement routes registered")
}

// registerDashboardRoutes mounts admin dashboard aggregate endpoints. These are
// summary/aggregate signals computed on demand from raw prediction tables —
// not stored materializations.
func registerDashboardRoutes(mux *stdhttp.ServeMux, svc *prediction.Service) {
	// Admin: Volume + top movers over a recent window.
	// Query params:
	//   since   — Go duration, e.g. "24h", "7d" (default "24h"). Capped at 30d.
	//   topN    — number of top movers to return (default 5, max 50).
	mux.Handle("/api/v1/admin/dashboard/volume", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if err := requireAdminRole(r); err != nil {
			return err
		}
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}

		sinceParam := strings.TrimSpace(r.URL.Query().Get("since"))
		if sinceParam == "" {
			sinceParam = "24h"
		}
		// Allow "7d" / "30d" by translating to hours; Go's time.ParseDuration
		// doesn't accept "d" units.
		if strings.HasSuffix(sinceParam, "d") {
			n, err := strconv.Atoi(strings.TrimSuffix(sinceParam, "d"))
			if err != nil || n <= 0 {
				return httpx.BadRequest("invalid since parameter", map[string]any{"since": sinceParam})
			}
			sinceParam = strconv.Itoa(n*24) + "h"
		}
		dur, err := time.ParseDuration(sinceParam)
		if err != nil || dur <= 0 {
			return httpx.BadRequest("invalid since parameter", map[string]any{"since": sinceParam})
		}
		const maxWindow = 30 * 24 * time.Hour
		if dur > maxWindow {
			dur = maxWindow
		}

		topN := intQueryParam(r, "topN", 5)
		if topN < 1 {
			topN = 1
		}
		if topN > 50 {
			topN = 50
		}

		stats, err := svc.DashboardVolumeStats(r.Context(), time.Now().Add(-dur), topN)
		if err != nil {
			return httpx.Internal("failed to load dashboard volume", err)
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, stats)
	}))

	// Admin: Recent collateral drift alerts. One row per market with
	// adjustment ledger entries since `since`. Default 24h, capped at 30d.
	// Backoffice ops page consumes this to badge markets needing
	// investigation.
	mux.Handle("/api/v1/admin/prediction/drift-alerts", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if err := requireAdminRole(r); err != nil {
			return err
		}
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		sinceParam := strings.TrimSpace(r.URL.Query().Get("since"))
		if sinceParam == "" {
			sinceParam = "24h"
		}
		if strings.HasSuffix(sinceParam, "d") {
			n, err := strconv.Atoi(strings.TrimSuffix(sinceParam, "d"))
			if err != nil || n <= 0 {
				return httpx.BadRequest("invalid since parameter", map[string]any{"since": sinceParam})
			}
			sinceParam = strconv.Itoa(n*24) + "h"
		}
		dur, err := time.ParseDuration(sinceParam)
		if err != nil || dur <= 0 {
			return httpx.BadRequest("invalid since parameter", map[string]any{"since": sinceParam})
		}
		if dur > 30*24*time.Hour {
			dur = 30 * 24 * time.Hour
		}
		alerts, err := svc.ListRecentDriftAlerts(r.Context(), dur)
		if err != nil {
			return httpx.Internal("failed to load drift alerts", err)
		}
		if alerts == nil {
			alerts = []prediction.CollateralDriftAlert{}
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]interface{}{
			"data":      alerts,
			"sinceText": sinceParam,
		})
	}))

	slog.Info("dashboard routes registered")
}

func decodeLifecycleReason(r *stdhttp.Request) (string, error) {
	if r.Body == nil {
		return "", nil
	}
	defer r.Body.Close()

	var req marketLifecycleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		if err == io.EOF {
			return "", nil
		}
		return "", httpx.BadRequest("invalid request body", nil)
	}
	reason := strings.TrimSpace(req.Reason)
	if err := validateLaunchFacingReason("reason", reason); err != nil {
		return "", err
	}
	return reason, nil
}

func sanitizeResolveMarketRequest(req *prediction.ResolveMarketRequest) error {
	req.Reason = trimStringPointer(req.Reason)
	if req.Reason != nil {
		if err := validateLaunchFacingReason("reason", *req.Reason); err != nil {
			return err
		}
	}
	req.OverrideReason = trimStringPointer(req.OverrideReason)
	if req.OverrideReason != nil {
		if err := validateLaunchFacingReason("overrideReason", *req.OverrideReason); err != nil {
			return err
		}
	}
	return nil
}

func boolDefault(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}

func validateAdminEventLaunchCopy(req prediction.CreateEventRequest) error {
	if err := validateLaunchFacingReason("title", strings.TrimSpace(req.Title)); err != nil {
		return err
	}
	if err := validateLaunchFacingReason("description", strings.TrimSpace(req.Description)); err != nil {
		return err
	}
	return nil
}

func validateAdminSeriesLaunchCopy(title string, description string, tags []string) error {
	if err := validateLaunchFacingReason("title", strings.TrimSpace(title)); err != nil {
		return err
	}
	if err := validateLaunchFacingReason("description", strings.TrimSpace(description)); err != nil {
		return err
	}
	for _, tag := range tags {
		if err := validateLaunchFacingReason("tags", strings.TrimSpace(tag)); err != nil {
			return err
		}
	}
	return nil
}

func normalizeTaxonomySlug(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return ""
	}
	var b strings.Builder
	lastDash := false
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash {
			b.WriteByte('-')
			lastDash = true
		}
	}
	return strings.Trim(b.String(), "-")
}

func normalizeTags(tags []string) []string {
	out := make([]string, 0, len(tags))
	seen := map[string]struct{}{}
	for _, tag := range tags {
		trimmed := strings.TrimSpace(tag)
		if trimmed == "" {
			continue
		}
		key := strings.ToLower(trimmed)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, trimmed)
	}
	return out
}

func marketLifecycleResponse(marketID string, status prediction.MarketStatus, reason string) map[string]any {
	return map[string]any{
		"marketId":          marketID,
		"status":            status,
		"reason":            reason,
		"taptradeLifecycle": prediction.DescribeTapTradeMarketLifecycle(status),
	}
}

func lifecycleAuditEventResponses(events []prediction.LifecycleEvent) []marketLifecycleEventResponse {
	if events == nil {
		return []marketLifecycleEventResponse{}
	}
	out := make([]marketLifecycleEventResponse, 0, len(events))
	for _, event := range events {
		event = redactLifecycleEventResponse(event)
		out = append(out, marketLifecycleEventResponse{
			LifecycleEvent:    event,
			TapTradeLifecycle: prediction.DescribeTapTradeMarketLifecycle(prediction.MarketStatus(event.EventType)),
		})
	}
	return out
}

func redactLifecycleEventResponse(event prediction.LifecycleEvent) prediction.LifecycleEvent {
	if event.Reason != nil {
		reason := redactLaunchProhibitedUserText(*event.Reason)
		event.Reason = &reason
	}
	event.Metadata = redactPredictionRawJSONStrings(event.Metadata)
	return event
}

func writeAdminMarketsCSV(w stdhttp.ResponseWriter, markets []prediction.Market) error {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="prediction-markets.csv"`)

	writer := csv.NewWriter(w)
	if err := writer.Write([]string{
		"market_id",
		"event_id",
		"ticker",
		"title",
		"status",
		"taptrade_stage",
		"result",
		"execution_mode",
		"yes_price_points",
		"no_price_points",
		"volume_points",
		"open_interest_points",
		"liquidity_points",
		"settlement_source",
		"settlement_rule",
		"close_at",
		"created_at",
		"updated_at",
	}); err != nil {
		return httpx.Internal("failed to write admin markets csv", err)
	}
	for _, market := range markets {
		market = predictionMarketPayload(market)
		result := ""
		if market.Result != nil {
			result = string(*market.Result)
		}
		lifecycle := prediction.DescribeTapTradeMarketLifecycle(market.Status)
		if err := writer.Write([]string{
			csvSafeCell(market.ID),
			csvSafeCell(market.EventID),
			csvSafeCell(market.Ticker),
			csvSafeCell(market.Title),
			csvSafeCell(string(market.Status)),
			csvSafeCell(string(lifecycle.Stage)),
			csvSafeCell(result),
			csvSafeCell(string(market.ExecutionMode)),
			strconv.Itoa(market.YesPricePoints),
			strconv.Itoa(market.NoPricePoints),
			strconv.FormatInt(market.VolumePoints, 10),
			strconv.FormatInt(market.OpenInterestPoints, 10),
			strconv.FormatInt(market.LiquidityPoints, 10),
			csvSafeCell(market.SettlementSourceKey),
			csvSafeCell(market.SettlementRule),
			csvSafeCell(market.CloseAt.UTC().Format(time.RFC3339)),
			csvSafeCell(market.CreatedAt.UTC().Format(time.RFC3339)),
			csvSafeCell(market.UpdatedAt.UTC().Format(time.RFC3339)),
		}); err != nil {
			return httpx.Internal("failed to write admin markets csv", err)
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return httpx.Internal("failed to flush admin markets csv", err)
	}
	return nil
}

func writeLifecycleAuditCSV(w stdhttp.ResponseWriter, marketID string, events []marketLifecycleEventResponse) error {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="market-lifecycle-`+csvSafeFilename(marketID)+`.csv"`)

	writer := csv.NewWriter(w)
	if err := writer.Write([]string{
		"id",
		"market_id",
		"event_type",
		"taptrade_stage",
		"taptrade_label",
		"actor_id",
		"actor_type",
		"reason",
		"metadata",
		"occurred_at",
	}); err != nil {
		return httpx.Internal("failed to write lifecycle audit csv", err)
	}
	for _, event := range events {
		if err := writer.Write([]string{
			csvSafeCell(event.ID),
			csvSafeCell(event.MarketID),
			csvSafeCell(event.EventType),
			csvSafeCell(string(event.TapTradeLifecycle.Stage)),
			csvSafeCell(event.TapTradeLifecycle.Label),
			csvSafeCell(stringPtrValue(event.ActorID)),
			csvSafeCell(event.ActorType),
			csvSafeCell(stringPtrValue(event.Reason)),
			csvSafeCell(string(event.Metadata)),
			event.OccurredAt.UTC().Format(time.RFC3339Nano),
		}); err != nil {
			return httpx.Internal("failed to write lifecycle audit csv", err)
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return httpx.Internal("failed to flush lifecycle audit csv", err)
	}
	return nil
}

func stringPtrValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func csvSafeCell(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	switch value[0] {
	case '=', '+', '-', '@':
		return "'" + value
	default:
		return value
	}
}

func csvSafeFilename(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "audit"
	}
	var b strings.Builder
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			b.WriteRune(r)
		}
	}
	if b.Len() == 0 {
		return "audit"
	}
	return b.String()
}

func actorIDPointer(actorID string) *string {
	if actorID == "" {
		return nil
	}
	return &actorID
}

func intQueryParam(r *stdhttp.Request, key string, defaultVal int) int {
	val := r.URL.Query().Get(key)
	if val == "" {
		return defaultVal
	}
	n, err := strconv.Atoi(val)
	if err != nil || n < 1 {
		return defaultVal
	}
	return n
}

// clampedQueryParam is intQueryParam with an upper bound. Every list/pagination
// endpoint MUST use this: the unclamped variant let a caller pass
// ?pageSize=1000000 on a public, unauthenticated route, turning one request
// into a full-table scan (audit PERF-01). max is an inclusive ceiling.
func clampedQueryParam(r *stdhttp.Request, key string, defaultVal, max int) int {
	n := intQueryParam(r, key, defaultVal)
	if n > max {
		return max
	}
	return n
}

// userIDFromRequest returns the authenticated user ID for the request.
//
// Cookie auth (httpx.Auth middleware) puts the user ID in the request context.
// Bot auth (prediction.BotAuthMiddleware) puts it in the X-User-ID header.
// We check context first, then fall back to the header so the same handler
// works for both auth styles.
func userIDFromRequest(r *stdhttp.Request) string {
	if uid := httpx.UserIDFromContext(r.Context()); uid != "" {
		return uid
	}
	return r.Header.Get("X-User-ID")
}
