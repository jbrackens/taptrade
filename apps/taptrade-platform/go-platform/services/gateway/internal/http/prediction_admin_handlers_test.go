package http

import (
	"context"
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"taptrade/gateway/internal/prediction"
	"taptrade/platform/transport/httpx"
)

type predictionAdminRepo struct {
	markets                   map[string]*prediction.Market
	positions                 map[string][]prediction.Position
	lifecycle                 []prediction.LifecycleEvent
	aiLogs                    []prediction.AIGenerationLog
	categories                []prediction.Category
	series                    []prediction.Series
	events                    []prediction.Event
	incompleteSettlements     []prediction.Settlement
	unpaidSettlementPositions map[string][]prediction.Position
	replayBatches             int
	settlements               []prediction.Settlement
	payouts                   []prediction.Payout
	marketSeq                 int
	createMarketErr           error
	// apiKey, when set, is returned by GetAPIKeyByPrefix so tests can
	// exercise the bot-auth-wrapped routes end to end.
	apiKey  *prediction.APIKey
	apiKeys []prediction.APIKey
	// apiKeyCreates lets route tests prove key validation stops before
	// persistence.
	apiKeyCreates int
	// orderCreates lets route tests prove safety gates stop before persistence.
	orderCreates int
}

func newPredictionAdminRepo() *predictionAdminRepo {
	return &predictionAdminRepo{
		markets:                   make(map[string]*prediction.Market),
		positions:                 make(map[string][]prediction.Position),
		unpaidSettlementPositions: make(map[string][]prediction.Position),
	}
}

func (r *predictionAdminRepo) ListCategories(_ context.Context, activeOnly bool) ([]prediction.Category, error) {
	out := make([]prediction.Category, 0, len(r.categories))
	for _, category := range r.categories {
		if activeOnly && !category.Active {
			continue
		}
		out = append(out, category)
	}
	return out, nil
}

func (r *predictionAdminRepo) GetCategory(_ context.Context, slug string) (*prediction.Category, error) {
	for _, category := range r.categories {
		if category.Slug == slug {
			clone := category
			return &clone, nil
		}
	}
	return nil, errors.New("not found")
}

func (r *predictionAdminRepo) CreateCategory(_ context.Context, category *prediction.Category) error {
	if category.ID == "" {
		category.ID = "cat-admin-test-" + string(rune('a'+len(r.categories)))
	}
	if category.CreatedAt.IsZero() {
		category.CreatedAt = time.Now().UTC()
	}
	category.UpdatedAt = category.CreatedAt
	r.categories = append(r.categories, *category)
	return nil
}

func (r *predictionAdminRepo) ListSeries(_ context.Context, categoryID *string) ([]prediction.Series, error) {
	out := make([]prediction.Series, 0, len(r.series))
	for _, series := range r.series {
		if !series.Active {
			continue
		}
		if categoryID != nil && series.CategoryID != *categoryID {
			continue
		}
		out = append(out, series)
	}
	return out, nil
}

func (r *predictionAdminRepo) GetSeries(_ context.Context, id string) (*prediction.Series, error) {
	for _, series := range r.series {
		if series.ID == id || series.Slug == id {
			clone := series
			return &clone, nil
		}
	}
	return nil, errors.New("not found")
}

func (r *predictionAdminRepo) CreateSeries(_ context.Context, series *prediction.Series) error {
	if series.ID == "" {
		series.ID = "ser-admin-test-" + string(rune('a'+len(r.series)))
	}
	if series.CreatedAt.IsZero() {
		series.CreatedAt = time.Now().UTC()
	}
	series.UpdatedAt = series.CreatedAt
	r.series = append(r.series, *series)
	return nil
}

func (r *predictionAdminRepo) ListEvents(context.Context, prediction.EventFilter) ([]prediction.Event, int, error) {
	return nil, 0, nil
}

func (r *predictionAdminRepo) GetEvent(_ context.Context, id string) (*prediction.Event, error) {
	for i := range r.events {
		if r.events[i].ID == id {
			event := r.events[i]
			return &event, nil
		}
	}
	return nil, errors.New("not found")
}

func (r *predictionAdminRepo) CreateEvent(_ context.Context, e *prediction.Event) error {
	if e.ID == "" {
		e.ID = "evt-admin-test-1"
	}
	r.events = append(r.events, *e)
	return nil
}

func (r *predictionAdminRepo) UpdateEventStatus(context.Context, string, prediction.EventStatus) error {
	return nil
}

func (r *predictionAdminRepo) UpdateEventPresentation(_ context.Context, id string, featured *bool, cover *string) error {
	for i := range r.events {
		if r.events[i].ID != id {
			continue
		}
		if featured != nil {
			r.events[i].Featured = *featured
		}
		if cover != nil {
			if *cover == "" {
				r.events[i].CoverImageURL = nil
			} else {
				value := *cover
				r.events[i].CoverImageURL = &value
			}
		}
		return nil
	}
	return sql.ErrNoRows
}

func (r *predictionAdminRepo) ListMarkets(_ context.Context, filter prediction.MarketFilter) ([]prediction.Market, int, error) {
	out := make([]prediction.Market, 0, len(r.markets))
	for _, market := range r.markets {
		if filter.Status != nil && market.Status != *filter.Status {
			continue
		}
		if filter.Ticker != nil && market.Ticker != *filter.Ticker {
			continue
		}
		if filter.EventID != nil && market.EventID != *filter.EventID {
			continue
		}
		if filter.CategoryID != nil {
			continue
		}
		out = append(out, *market)
	}
	return out, len(out), nil
}

func (r *predictionAdminRepo) GetMarket(_ context.Context, id string) (*prediction.Market, error) {
	market, ok := r.markets[id]
	if !ok {
		return nil, errors.New("not found")
	}
	clone := *market
	return &clone, nil
}

func (r *predictionAdminRepo) GetMarketByTicker(_ context.Context, ticker string) (*prediction.Market, error) {
	for _, market := range r.markets {
		if market.Ticker == ticker {
			clone := *market
			return &clone, nil
		}
	}
	return nil, errors.New("not found")
}

func (r *predictionAdminRepo) CreateMarket(_ context.Context, market *prediction.Market) error {
	if r.createMarketErr != nil {
		return r.createMarketErr
	}
	r.marketSeq++
	if market.ID == "" {
		market.ID = "mkt-admin-test-" + time.Now().UTC().Format("150405") + "-" + string(rune('a'+r.marketSeq))
	}
	clone := *market
	r.markets[market.ID] = &clone
	return nil
}

func (r *predictionAdminRepo) UpdateMarket(_ context.Context, market *prediction.Market) error {
	clone := *market
	r.markets[market.ID] = &clone
	return nil
}

func (r *predictionAdminRepo) UpdateMarketStatus(_ context.Context, id string, status, _ prediction.MarketStatus) error {
	market, ok := r.markets[id]
	if !ok {
		return errors.New("not found")
	}
	market.Status = status
	market.UpdatedAt = time.Now().UTC()
	return nil
}

func (r *predictionAdminRepo) ListMarketsToClose(context.Context) ([]prediction.Market, error) {
	return nil, nil
}
func (r *predictionAdminRepo) ListRestingOrdersOnInactiveMarkets(context.Context, int) ([]prediction.Order, error) {
	return nil, nil
}

func (r *predictionAdminRepo) ListMarketsToSettle(context.Context) ([]prediction.Market, error) {
	return nil, nil
}

func (r *predictionAdminRepo) ListOrders(context.Context, prediction.OrderFilter) ([]prediction.Order, int, error) {
	return nil, 0, nil
}

func (r *predictionAdminRepo) GetOrder(context.Context, string) (*prediction.Order, error) {
	return nil, errors.New("not found")
}

func (r *predictionAdminRepo) GetOrderByIdempotencyKey(context.Context, string) (*prediction.Order, error) {
	return nil, errors.New("not found")
}

func (r *predictionAdminRepo) CreateOrder(context.Context, *prediction.Order) error {
	r.orderCreates++
	return nil
}

func (r *predictionAdminRepo) UpdateOrder(context.Context, *prediction.Order) error { return nil }

func (r *predictionAdminRepo) PersistFilledOrder(context.Context, *prediction.Order, *prediction.Trade, *prediction.Position, *prediction.Market) error {
	return nil
}

func (r *predictionAdminRepo) ListPositions(_ context.Context, userID string) ([]prediction.Position, error) {
	var out []prediction.Position
	for _, positions := range r.positions {
		for _, position := range positions {
			if position.UserID == userID {
				out = append(out, position)
			}
		}
	}
	return out, nil
}

func (r *predictionAdminRepo) GetPosition(context.Context, string, string, prediction.OrderSide) (*prediction.Position, error) {
	return nil, errors.New("not found")
}

func (r *predictionAdminRepo) UpsertPosition(context.Context, *prediction.Position) error { return nil }

func (r *predictionAdminRepo) ListPositionsByMarket(_ context.Context, marketID string) ([]prediction.Position, error) {
	positions := r.positions[marketID]
	out := make([]prediction.Position, len(positions))
	copy(out, positions)
	return out, nil
}

func (r *predictionAdminRepo) ListTrades(context.Context, string, int) ([]prediction.Trade, error) {
	return nil, nil
}

func (r *predictionAdminRepo) CreateTrade(context.Context, *prediction.Trade) error { return nil }

func (r *predictionAdminRepo) GetSettlement(context.Context, string) (*prediction.Settlement, error) {
	return nil, errors.New("not found")
}

func (r *predictionAdminRepo) CreateSettlement(_ context.Context, settlement *prediction.Settlement) error {
	if settlement.ID == "" {
		settlement.ID = "st-admin-test-" + string(rune('a'+len(r.settlements)))
	}
	clone := *settlement
	r.settlements = append(r.settlements, clone)
	return nil
}

func (r *predictionAdminRepo) CreatePayout(_ context.Context, payout *prediction.Payout) error {
	if payout.ID == "" {
		payout.ID = "po-admin-test-" + string(rune('a'+len(r.payouts)))
	}
	clone := *payout
	r.payouts = append(r.payouts, clone)
	return nil
}

func (r *predictionAdminRepo) PersistSettlementHeader(context.Context, *prediction.Market, prediction.MarketStatus, *prediction.Settlement, *prediction.LifecycleEvent) error {
	return nil
}

func (r *predictionAdminRepo) CommitPayoutBatch(_ context.Context, _ prediction.WalletAdapter, settlementID string, payouts []prediction.Payout, _ []*prediction.WalletCreditRequest, _ prediction.LoyaltyAdapter, _ []*prediction.LoyaltyAccrualRequest) ([]prediction.LoyaltyAccrualResult, error) {
	r.replayBatches++
	remaining := r.unpaidSettlementPositions[settlementID]
	if len(payouts) >= len(remaining) {
		r.unpaidSettlementPositions[settlementID] = nil
	} else {
		r.unpaidSettlementPositions[settlementID] = remaining[len(payouts):]
	}
	return nil, nil
}

func (r *predictionAdminRepo) ListUnpaidSettlementPositions(_ context.Context, settlementID, _ string, limit int) ([]prediction.Position, error) {
	positions := r.unpaidSettlementPositions[settlementID]
	if limit > 0 && len(positions) > limit {
		positions = positions[:limit]
	}
	out := make([]prediction.Position, len(positions))
	copy(out, positions)
	return out, nil
}

func (r *predictionAdminRepo) ListIncompleteSettlements(_ context.Context, limit int) ([]prediction.Settlement, error) {
	out := make([]prediction.Settlement, 0, len(r.incompleteSettlements))
	for _, settlement := range r.incompleteSettlements {
		if len(r.unpaidSettlementPositions[settlement.ID]) == 0 {
			continue
		}
		out = append(out, settlement)
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out, nil
}

func (r *predictionAdminRepo) ListLifecycleEvents(_ context.Context, marketID string) ([]prediction.LifecycleEvent, error) {
	filtered := make([]prediction.LifecycleEvent, 0)
	for _, event := range r.lifecycle {
		if event.MarketID == marketID {
			filtered = append(filtered, event)
		}
	}
	return filtered, nil
}

func (r *predictionAdminRepo) CreateLifecycleEvent(_ context.Context, event *prediction.LifecycleEvent) error {
	if event == nil {
		return nil
	}
	clone := *event
	r.lifecycle = append(r.lifecycle, clone)
	return nil
}

func (r *predictionAdminRepo) CreateArticleSource(_ context.Context, src *prediction.ArticleSource) error {
	if src.ID == "" {
		src.ID = "src-admin-test-1"
	}
	return nil
}

func (r *predictionAdminRepo) LogAIGeneration(_ context.Context, entry *prediction.AIGenerationLog) error {
	if entry.ID == "" {
		entry.ID = "ailog-admin-test-" + string(rune('a'+len(r.aiLogs)))
	}
	clone := *entry
	clone.CreatedAt = time.Now().UTC()
	r.aiLogs = append(r.aiLogs, clone)
	return nil
}

func (r *predictionAdminRepo) LinkAIGenerationLogsToMarket(_ context.Context, marketID string, logIDs []string, _ *string) error {
	for _, id := range logIDs {
		for i := range r.aiLogs {
			if r.aiLogs[i].ID == id {
				r.aiLogs[i].MarketID = &marketID
			}
		}
	}
	return nil
}

func (r *predictionAdminRepo) AIUsage(_ context.Context, createdBy string, since time.Time) (int, int64, error) {
	var requests int
	var tokens int64
	for _, log := range r.aiLogs {
		if log.CreatedBy == nil || *log.CreatedBy != createdBy || log.CreatedAt.Before(since) {
			continue
		}
		if log.Stage == "draft_request" {
			requests++
		}
		if log.InputTokens != nil {
			tokens += int64(*log.InputTokens)
		}
		if log.OutputTokens != nil {
			tokens += int64(*log.OutputTokens)
		}
	}
	return requests, tokens, nil
}

func (r *predictionAdminRepo) ReserveAIUsage(_ context.Context, createdBy string, estimatedInputTokens int, ratePerMin int, dailyTokenCap int64, now time.Time) (prediction.AIBudgetStatus, error) {
	recent, tokens, _ := r.AIUsage(context.Background(), createdBy, now.Add(-time.Minute))
	_, tokensToday, _ := r.AIUsage(context.Background(), createdBy, time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC))
	if tokensToday > tokens {
		tokens = tokensToday
	}
	status := prediction.AIBudgetStatus{
		Allowed:            true,
		RequestsLastMinute: recent,
		RatePerMinute:      ratePerMin,
		TokensToday:        tokens,
		DailyTokenCap:      dailyTokenCap,
	}
	if recent+1 > ratePerMin {
		status.Allowed = false
		status.Reason = "rate limit exceeded — too many drafts in the last minute"
		return status, nil
	}
	if tokens+int64(estimatedInputTokens) > dailyTokenCap {
		status.Allowed = false
		status.Reason = "daily AI token budget exhausted"
		return status, nil
	}
	input := estimatedInputTokens
	createdByPtr := createdBy
	if err := r.LogAIGeneration(context.Background(), &prediction.AIGenerationLog{
		Stage:       "draft_request",
		InputTokens: &input,
		CreatedBy:   &createdByPtr,
		CreatedAt:   now,
	}); err != nil {
		return prediction.AIBudgetStatus{}, err
	}
	status.RequestsLastMinute++
	status.TokensToday += int64(estimatedInputTokens)
	return status, nil
}

func (r *predictionAdminRepo) ListAPIKeys(_ context.Context, userID string) ([]prediction.APIKey, error) {
	if len(r.apiKeys) == 0 {
		return nil, nil
	}
	out := make([]prediction.APIKey, 0, len(r.apiKeys))
	for _, key := range r.apiKeys {
		if key.UserID == userID {
			out = append(out, key)
		}
	}
	return out, nil
}

func (r *predictionAdminRepo) GetAPIKeyByPrefix(context.Context, string) (*prediction.APIKey, error) {
	if r.apiKey != nil {
		return r.apiKey, nil
	}
	return nil, errors.New("not found")
}

func (r *predictionAdminRepo) CreateAPIKey(context.Context, *prediction.APIKey) error {
	r.apiKeyCreates++
	return nil
}

func (r *predictionAdminRepo) DeactivateAPIKey(context.Context, string) error { return nil }

func (r *predictionAdminRepo) TouchAPIKeyLastUsed(context.Context, string) error { return nil }

func (r *predictionAdminRepo) GetPortfolioSummary(context.Context, string) (*prediction.PortfolioSummary, error) {
	return nil, errors.New("not found")
}

func (r *predictionAdminRepo) ListSettledPositions(context.Context, string, int, int) ([]prediction.Payout, int, error) {
	return nil, 0, nil
}

func (r *predictionAdminRepo) GetDiscovery(context.Context) (*prediction.DiscoveryResponse, error) {
	return nil, errors.New("not found")
}
func (r *predictionAdminRepo) DashboardVolumeStatsSince(context.Context, time.Time, int) (*prediction.DashboardVolumeStats, error) {
	return nil, nil
}

type predictionAdminWallet struct{}

func (predictionAdminWallet) Debit(context.Context, string, int64, string, string) error {
	return nil
}
func (predictionAdminWallet) Credit(context.Context, string, int64, string, string) error {
	return nil
}
func (predictionAdminWallet) Balance(context.Context, string) int64 { return 1_000_000 }

type predictionAdminResolutionStore struct {
	proposals map[string]*prediction.ResolutionProposal
	disputes  map[string]*prediction.Dispute
	seq       int
}

func newPredictionAdminResolutionStore() *predictionAdminResolutionStore {
	return &predictionAdminResolutionStore{
		proposals: map[string]*prediction.ResolutionProposal{},
		disputes:  map[string]*prediction.Dispute{},
	}
}

func (s *predictionAdminResolutionStore) CreateProposal(_ context.Context, proposal *prediction.ResolutionProposal) error {
	clone := *proposal
	s.proposals[proposal.MarketID] = &clone
	return nil
}

func (s *predictionAdminResolutionStore) GetActiveProposal(_ context.Context, marketID string) (*prediction.ResolutionProposal, error) {
	proposal := s.proposals[marketID]
	if proposal == nil || proposal.Status != "proposed" {
		return nil, nil
	}
	clone := *proposal
	return &clone, nil
}

func (s *predictionAdminResolutionStore) MarkProposalFinalized(_ context.Context, marketID string) (bool, error) {
	proposal := s.proposals[marketID]
	if proposal == nil || proposal.Status != "proposed" {
		return false, nil
	}
	proposal.Status = "finalized"
	now := time.Now().UTC()
	proposal.FinalizedAt = &now
	return true, nil
}

func (s *predictionAdminResolutionStore) ReopenProposal(_ context.Context, marketID string) error {
	if proposal := s.proposals[marketID]; proposal != nil && proposal.Status == "finalized" {
		proposal.Status = "proposed"
		proposal.FinalizedAt = nil
	}
	return nil
}

func (s *predictionAdminResolutionStore) MarkProposalVoided(_ context.Context, marketID string) error {
	if proposal := s.proposals[marketID]; proposal != nil {
		proposal.Status = "voided"
	}
	return nil
}

func (s *predictionAdminResolutionStore) ListFinalizableProposals(_ context.Context, asOf time.Time) ([]prediction.ResolutionProposal, error) {
	var out []prediction.ResolutionProposal
	for _, proposal := range s.proposals {
		if proposal.Status == "proposed" && proposal.ProposedBy == nil && !proposal.ChallengeEndsAt.After(asOf) {
			out = append(out, *proposal)
		}
	}
	return out, nil
}

func (s *predictionAdminResolutionStore) CountOpenDisputes(_ context.Context, marketID string) (int, error) {
	var count int
	for _, dispute := range s.disputes {
		if dispute.MarketID == marketID && dispute.Status == "open" {
			count++
		}
	}
	return count, nil
}

func (s *predictionAdminResolutionStore) CreateDispute(_ context.Context, dispute *prediction.Dispute) error {
	s.seq++
	if dispute.ID == "" {
		dispute.ID = "disp-admin-test-" + string(rune('a'+s.seq))
	}
	if dispute.Status == "" {
		dispute.Status = "open"
	}
	if dispute.CreatedAt.IsZero() {
		dispute.CreatedAt = time.Now().UTC()
	}
	clone := *dispute
	s.disputes[dispute.ID] = &clone
	return nil
}

func (s *predictionAdminResolutionStore) ListDisputes(_ context.Context, marketID string) ([]prediction.Dispute, error) {
	var out []prediction.Dispute
	for _, dispute := range s.disputes {
		if dispute.MarketID == marketID {
			out = append(out, *dispute)
		}
	}
	return out, nil
}

func (s *predictionAdminResolutionStore) ListOpenDisputes(_ context.Context) ([]prediction.Dispute, error) {
	var out []prediction.Dispute
	for _, dispute := range s.disputes {
		if dispute.Status == "open" {
			out = append(out, *dispute)
		}
	}
	return out, nil
}

func (s *predictionAdminResolutionStore) GetDispute(_ context.Context, id string) (*prediction.Dispute, error) {
	dispute := s.disputes[id]
	if dispute == nil {
		return nil, nil
	}
	clone := *dispute
	return &clone, nil
}

func (s *predictionAdminResolutionStore) ResolveDispute(_ context.Context, id, status, note string, resolvedBy *string) error {
	dispute := s.disputes[id]
	if dispute == nil || dispute.Status != "open" {
		return nil
	}
	dispute.Status = status
	if note != "" {
		noteCopy := note
		dispute.ResolutionNote = &noteCopy
	}
	dispute.ResolvedBy = resolvedBy
	now := time.Now().UTC()
	dispute.ResolvedAt = &now
	return nil
}

func (s *predictionAdminResolutionStore) WithMarketLock(_ context.Context, _ string, fn func() error) error {
	return fn()
}

func TestPredictionAdminCreateMarketWorksWithNormalizedTrailingSlash(t *testing.T) {
	repo := newPredictionAdminRepo()
	svc := prediction.NewService(repo, predictionAdminWallet{})

	mux := http.NewServeMux()
	registerSettlementRoutes(mux, svc)

	handler := httpx.Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mux.ServeHTTP(w, r)
		}),
		httpx.RequestID(),
		httpx.NormalizeTrailingSlash("/api/", "/admin/", "/auth/"),
	)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/markets/", strings.NewReader(`{
		"eventId":"evt-admin-test-1",
		"ticker":"QA-CREATE-NORMALIZED",
		"title":"QA Create Normalized",
		"settlementSourceKey":"manual",
		"settlementRule":"binary",
		"closeAt":"2026-04-30T12:00:00Z",
		"ammLiquidityParam":100,
		"ammSubsidyPoints":1234
	}`))
	req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-1", "admin@taptrade.local", "admin"))
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusCreated {
		t.Fatalf("expected create market status 201, got %d body=%s", res.Code, res.Body.String())
	}

	var market prediction.Market
	if err := json.Unmarshal(res.Body.Bytes(), &market); err != nil {
		t.Fatalf("decode create market response: %v", err)
	}
	if market.ID == "" {
		t.Fatalf("expected created market id")
	}
	if market.Status != prediction.MarketStatusUnopened {
		t.Fatalf("expected new market to start unopened, got %s", market.Status)
	}
	if !strings.Contains(res.Body.String(), `"ammSubsidyPoints":1234`) {
		t.Fatalf("expected point-native AMM subsidy response field, got %s", res.Body.String())
	}
	// Points unit-model (2026-07-07): ammSubsidyPoints is canonical; the
	// retired spelling is the cents-era ammSubsidyPointsCents.
	if strings.Contains(res.Body.String(), `"ammSubsidyPointsCents"`) {
		t.Fatalf("create market response should not emit retired ammSubsidyPointsCents alias: %s", res.Body.String())
	}

	// Points unit-model (2026-07-07): the retired request key is the
	// cents-era ammSubsidyCents; the guard must keep rejecting it.
	retiredReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/markets", strings.NewReader(`{
		"eventId":"evt-admin-test-1",
		"ticker":"QA-CREATE-RETIRED-AMM",
		"title":"QA Create Retired AMM Alias",
		"settlementSourceKey":"manual",
		"settlementRule":"binary",
		"closeAt":"2026-04-30T12:00:00Z",
		"ammLiquidityParam":100,
		"ammSubsidyCents":1234
	}`))
	retiredReq = retiredReq.WithContext(httpx.WithTestUser(retiredReq.Context(), "admin-1", "admin@taptrade.local", "admin"))
	retiredRes := httptest.NewRecorder()
	handler.ServeHTTP(retiredRes, retiredReq)
	if retiredRes.Code != http.StatusBadRequest {
		t.Fatalf("retired ammSubsidyCents request should be rejected: status=%d body=%s", retiredRes.Code, retiredRes.Body.String())
	}
	if !strings.Contains(retiredRes.Body.String(), "ammSubsidyPoints") {
		t.Fatalf("retired AMM subsidy error should point to ammSubsidyPoints, got %s", retiredRes.Body.String())
	}
}

func TestPredictionAdminCreateMarketRejectsLaunchProhibitedSettlementSource(t *testing.T) {
	repo := newPredictionAdminRepo()
	svc := prediction.NewService(repo, predictionAdminWallet{})

	mux := http.NewServeMux()
	registerSettlementRoutes(mux, svc)

	handler := httpx.Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mux.ServeHTTP(w, r)
		}),
		httpx.RequestID(),
		httpx.NormalizeTrailingSlash("/api/", "/admin/", "/auth/"),
	)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/markets", strings.NewReader(`{
		"eventId":"evt-admin-test-1",
		"ticker":"QA-BTC-BLOCKED",
		"title":"Will BTC clear a price threshold?",
		"settlementSourceKey":"api-feed-crypto",
		"settlementRule":"price_above",
		"settlementParams":{"asset":"bitcoin","threshold":100000},
		"closeAt":"2026-04-30T12:00:00Z",
		"ammLiquidityParam":100
	}`))
	req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-1", "admin@taptrade.local", "admin"))
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected launch-prohibited create market status 400, got %d body=%s", res.Code, res.Body.String())
	}
	if len(repo.markets) != 0 {
		t.Fatalf("launch-prohibited market should not be persisted: %+v", repo.markets)
	}
}

func TestPredictionAdminCreateMarketRedactsUnsafeServiceError(t *testing.T) {
	repo := newPredictionAdminRepo()
	repo.createMarketErr = errors.New("cash payout market insert failed")
	svc := prediction.NewService(repo, predictionAdminWallet{})

	mux := http.NewServeMux()
	registerSettlementRoutes(mux, svc)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/markets", strings.NewReader(`{
		"eventId":"evt-admin-safe-error",
		"ticker":"SAFE-ERROR",
		"title":"Safe error market",
		"settlementSourceKey":"manual",
		"settlementRule":"binary",
		"closeAt":"2026-04-30T12:00:00Z",
		"ammLiquidityParam":100
	}`))
	req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-error", "admin@taptrade.local", "admin"))
	res := httptest.NewRecorder()
	mux.ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected unsafe service error status 400, got %d body=%s", res.Code, res.Body.String())
	}
	var envelope httpx.ErrorEnvelope
	if err := json.Unmarshal(res.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode create market error: %v", err)
	}
	if envelope.Error.Message != launchRedactedUserText {
		t.Fatalf("expected redacted service error message, got %+v", envelope.Error)
	}
	if strings.Contains(res.Body.String(), "cash payout") {
		t.Fatalf("unsafe service error should not be echoed: %s", res.Body.String())
	}
	if len(repo.markets) != 0 {
		t.Fatalf("failed create should not persist market: %+v", repo.markets)
	}
}

func TestPredictionAdminUpdateMarketEditsMetadataAndAudits(t *testing.T) {
	t.Setenv("GATEWAY_ALLOW_ADMIN_ANON", "false")

	repo := newPredictionAdminRepo()
	svc := prediction.NewService(repo, predictionAdminWallet{})

	mux := http.NewServeMux()
	registerSettlementRoutes(mux, svc)
	handler := httpx.Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mux.ServeHTTP(w, r)
		}),
		httpx.RequestID(),
		httpx.NormalizeTrailingSlash("/api/", "/admin/", "/auth/"),
	)

	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/markets", strings.NewReader(`{
		"eventId":"evt-admin-edit-1",
		"ticker":"QA-EDIT-1",
		"title":"QA Edit Original",
		"description":"Original description",
		"settlementSourceKey":"admin-manual",
		"settlementRule":"binary_outcome",
		"settlementParams":{"resolutionCriteria":"original"},
		"closeAt":"2026-07-31T23:59:00Z",
		"ammLiquidityParam":100
	}`))
	createReq = createReq.WithContext(httpx.WithTestUser(createReq.Context(), "admin-edit", "edit@taptrade.local", "admin"))
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)
	if createRes.Code != http.StatusCreated {
		t.Fatalf("expected create status 201, got %d body=%s", createRes.Code, createRes.Body.String())
	}

	var created prediction.Market
	if err := json.Unmarshal(createRes.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode created market: %v", err)
	}

	updateReq := httptest.NewRequest(http.MethodPut, "/api/v1/admin/markets/"+created.ID, strings.NewReader(`{
		"eventId":"evt-admin-edit-1",
		"ticker":"QA-EDIT-1B",
		"title":"QA Edit Updated",
		"description":"Updated description",
		"settlementSourceKey":"admin-manual",
		"settlementRule":"binary_outcome",
		"settlementParams":{"resolutionCriteria":"updated"},
		"closeAt":"2026-08-31T23:59:00Z",
		"ammLiquidityParam":125
	}`))
	updateReq = updateReq.WithContext(httpx.WithTestUser(updateReq.Context(), "admin-edit", "edit@taptrade.local", "admin"))
	updateRes := httptest.NewRecorder()
	handler.ServeHTTP(updateRes, updateReq)
	if updateRes.Code != http.StatusOK {
		t.Fatalf("expected update status 200, got %d body=%s", updateRes.Code, updateRes.Body.String())
	}

	var updated prediction.Market
	if err := json.Unmarshal(updateRes.Body.Bytes(), &updated); err != nil {
		t.Fatalf("decode updated market: %v", err)
	}
	if updated.ID != created.ID || updated.Status != prediction.MarketStatusUnopened {
		t.Fatalf("update should preserve id/status, got %+v", updated)
	}
	if updated.Ticker != "QA-EDIT-1B" || updated.Title != "QA Edit Updated" || updated.Description != "Updated description" {
		t.Fatalf("expected edited metadata, got %+v", updated)
	}
	if updated.AMMLiquidityParam != 125 || updated.SettlementRule != "binary_outcome" {
		t.Fatalf("expected edited market controls, got %+v", updated)
	}

	auditReq := httptest.NewRequest(http.MethodGet, "/api/v1/admin/markets/"+created.ID+"/lifecycle", nil)
	auditReq = auditReq.WithContext(httpx.WithTestUser(auditReq.Context(), "admin-edit", "edit@taptrade.local", "admin"))
	auditRes := httptest.NewRecorder()
	handler.ServeHTTP(auditRes, auditReq)
	if auditRes.Code != http.StatusOK {
		t.Fatalf("expected lifecycle audit status 200, got %d body=%s", auditRes.Code, auditRes.Body.String())
	}
	var audit struct {
		Data []struct {
			EventType string  `json:"eventType"`
			ActorID   *string `json:"actorId"`
			Reason    *string `json:"reason"`
		} `json:"data"`
	}
	if err := json.Unmarshal(auditRes.Body.Bytes(), &audit); err != nil {
		t.Fatalf("decode lifecycle audit: %v", err)
	}
	if len(audit.Data) != 2 || audit.Data[1].EventType != "edited" {
		t.Fatalf("expected create and edit audit rows, got %+v", audit.Data)
	}
	if audit.Data[1].ActorID == nil || *audit.Data[1].ActorID != "admin-edit" {
		t.Fatalf("expected edit actor in audit row, got %+v", audit.Data[1].ActorID)
	}
	if audit.Data[1].Reason == nil || *audit.Data[1].Reason != "market edited by admin" {
		t.Fatalf("expected edit reason in audit row, got %+v", audit.Data[1].Reason)
	}
}

func TestPredictionAdminCreateMarketSource(t *testing.T) {
	// Force the dev anon-admin bypass off so the admin-gate assertion is
	// deterministic regardless of the ambient environment.
	t.Setenv("GATEWAY_ALLOW_ADMIN_ANON", "false")

	repo := newPredictionAdminRepo()
	svc := prediction.NewService(repo, predictionAdminWallet{})

	mux := http.NewServeMux()
	registerSettlementRoutes(mux, svc)
	handler := httpx.Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mux.ServeHTTP(w, r)
		}),
		httpx.RequestID(),
		httpx.NormalizeTrailingSlash("/api/", "/admin/", "/auth/"),
	)

	body := `{"source":{"textHash":"abc123","title":"News","summary":"sum"},"generationLogs":[{"stage":"draft","tier":"hard"}]}`

	// Admin happy path -> 201 with the (deduped) article source id.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/market-sources", strings.NewReader(body))
	req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-1", "admin@taptrade.local", "admin"))
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d body=%s", res.Code, res.Body.String())
	}
	var resp prediction.CreateMarketSourceResponse
	if err := json.Unmarshal(res.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.ArticleSourceID == "" {
		t.Fatalf("expected non-empty articleSourceId")
	}
	if len(resp.AIGenerationLogIDs) != 1 || resp.AIGenerationLogIDs[0] == "" {
		t.Fatalf("expected one generation log id, got %+v", resp.AIGenerationLogIDs)
	}

	createBody := `{
		"eventId":"evt-admin-test-1",
		"ticker":"QA-AI-LINK",
		"title":"QA AI Link",
		"settlementSourceKey":"admin-manual",
		"settlementRule":"binary_outcome",
		"closeAt":"2026-07-31T23:59:00Z",
		"articleSourceId":"` + resp.ArticleSourceID + `",
		"aiGenerationLogIds":["` + resp.AIGenerationLogIDs[0] + `"]
	}`
	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/markets", strings.NewReader(createBody))
	createReq = createReq.WithContext(httpx.WithTestUser(createReq.Context(), "admin-1", "admin@taptrade.local", "admin"))
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)
	if createRes.Code != http.StatusCreated {
		t.Fatalf("expected market create 201, got %d body=%s", createRes.Code, createRes.Body.String())
	}
	if repo.aiLogs[0].MarketID == nil || *repo.aiLogs[0].MarketID == "" {
		t.Fatalf("expected generation log to be linked to created market")
	}

	// Missing textHash -> 400 (service validation surfaces as bad request).
	bad := httptest.NewRequest(http.MethodPost, "/api/v1/admin/market-sources", strings.NewReader(`{"source":{"title":"x"}}`))
	bad = bad.WithContext(httpx.WithTestUser(bad.Context(), "admin-1", "admin@taptrade.local", "admin"))
	badRes := httptest.NewRecorder()
	handler.ServeHTTP(badRes, bad)
	if badRes.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing textHash, got %d", badRes.Code)
	}

	// No admin role -> must not create.
	anon := httptest.NewRequest(http.MethodPost, "/api/v1/admin/market-sources", strings.NewReader(body))
	anonRes := httptest.NewRecorder()
	handler.ServeHTTP(anonRes, anon)
	if anonRes.Code == http.StatusCreated {
		t.Fatalf("expected non-admin request to be rejected, got 201")
	}
}

func TestPredictionAdminCreateEvent(t *testing.T) {
	t.Setenv("GATEWAY_ALLOW_ADMIN_ANON", "false")
	repo := newPredictionAdminRepo()
	svc := prediction.NewService(repo, predictionAdminWallet{})

	mux := http.NewServeMux()
	registerSettlementRoutes(mux, svc)
	handler := httpx.Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mux.ServeHTTP(w, r)
		}),
		httpx.RequestID(),
		httpx.NormalizeTrailingSlash("/api/", "/admin/", "/auth/"),
	)

	body := `{"title":"May 2026 FOMC","categoryId":"cat-1","closeAt":"2026-07-31T23:59:00Z"}`

	// Admin happy path -> 201 with an event id and default draft status.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/events", strings.NewReader(body))
	req = req.WithContext(
		httpx.WithTestUser(req.Context(), "admin-1", "admin@taptrade.local", "admin"),
	)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d body=%s", res.Code, res.Body.String())
	}
	var event prediction.Event
	if err := json.Unmarshal(res.Body.Bytes(), &event); err != nil {
		t.Fatalf("decode event: %v", err)
	}
	if event.ID == "" {
		t.Fatalf("expected an event id")
	}
	if event.Status != prediction.EventStatusDraft {
		t.Fatalf("expected draft status, got %s", event.Status)
	}

	// Missing title -> 400.
	bad := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/admin/events",
		strings.NewReader(`{"categoryId":"cat-1","closeAt":"2026-07-31T23:59:00Z"}`),
	)
	bad = bad.WithContext(
		httpx.WithTestUser(bad.Context(), "admin-1", "admin@taptrade.local", "admin"),
	)
	badRes := httptest.NewRecorder()
	handler.ServeHTTP(badRes, bad)
	if badRes.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing title, got %d", badRes.Code)
	}

	// No admin role -> rejected.
	anon := httptest.NewRequest(http.MethodPost, "/api/v1/admin/events", strings.NewReader(body))
	anonRes := httptest.NewRecorder()
	handler.ServeHTTP(anonRes, anon)
	if anonRes.Code == http.StatusCreated {
		t.Fatalf("expected non-admin request to be rejected, got 201")
	}
}

func TestPredictionAdminCreateEventRejectsMoneyWordingBeforePersistence(t *testing.T) {
	for _, tc := range []struct {
		name       string
		body       string
		wantField  string
		unsafeText string
	}{
		{
			name:       "title",
			body:       `{"title":"Cash Prize Event","categoryId":"cat-1","closeAt":"2026-07-31T23:59:00Z"}`,
			wantField:  "title",
			unsafeText: "Cash Prize",
		},
		{
			name:       "description",
			body:       `{"title":"May 2026 FOMC","description":"crypto prize event copy","categoryId":"cat-1","closeAt":"2026-07-31T23:59:00Z"}`,
			wantField:  "description",
			unsafeText: "crypto prize",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := newPredictionAdminRepo()
			svc := prediction.NewService(repo, predictionAdminWallet{})

			mux := http.NewServeMux()
			registerSettlementRoutes(mux, svc)
			req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/events", strings.NewReader(tc.body))
			req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-1", "admin@taptrade.local", "admin"))
			res := httptest.NewRecorder()
			mux.ServeHTTP(res, req)

			if res.Code != http.StatusBadRequest {
				t.Fatalf("expected unsafe event status 400, got %d body=%s", res.Code, res.Body.String())
			}
			assertLaunchCopyErrorField(t, res, tc.wantField, tc.unsafeText)
			if len(repo.events) != 0 {
				t.Fatalf("unsafe event copy persisted: %+v", repo.events)
			}
		})
	}
}

func TestPredictionAdminTaxonomyRoutesCreateCategorySeriesAndTags(t *testing.T) {
	repo := newPredictionAdminRepo()
	svc := prediction.NewService(repo, predictionAdminWallet{})

	mux := http.NewServeMux()
	registerSettlementRoutes(mux, svc)
	handler := httpx.Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mux.ServeHTTP(w, r)
		}),
		httpx.RequestID(),
	)

	catReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/categories", strings.NewReader(`{
		"name":"World Politics",
		"icon":"globe",
		"sortOrder":7
	}`))
	catReq = catReq.WithContext(httpx.WithTestUser(catReq.Context(), "admin-taxonomy", "taxonomy@taptrade.local", "admin"))
	catRes := httptest.NewRecorder()
	handler.ServeHTTP(catRes, catReq)
	if catRes.Code != http.StatusCreated {
		t.Fatalf("create category failed: status=%d body=%s", catRes.Code, catRes.Body.String())
	}
	var category prediction.Category
	if err := json.Unmarshal(catRes.Body.Bytes(), &category); err != nil {
		t.Fatalf("decode category: %v", err)
	}
	if category.ID == "" || category.Slug != "world-politics" || !category.Active {
		t.Fatalf("expected normalized active category, got %+v", category)
	}

	seriesReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/series", strings.NewReader(`{
		"title":"2026 Election Watch",
		"categoryId":"`+category.ID+`",
		"frequency":"recurring",
		"tags":["Election","polls","election"," "]
	}`))
	seriesReq = seriesReq.WithContext(httpx.WithTestUser(seriesReq.Context(), "admin-taxonomy", "taxonomy@taptrade.local", "admin"))
	seriesRes := httptest.NewRecorder()
	handler.ServeHTTP(seriesRes, seriesReq)
	if seriesRes.Code != http.StatusCreated {
		t.Fatalf("create series failed: status=%d body=%s", seriesRes.Code, seriesRes.Body.String())
	}
	var series prediction.Series
	if err := json.Unmarshal(seriesRes.Body.Bytes(), &series); err != nil {
		t.Fatalf("decode series: %v", err)
	}
	if series.ID == "" || series.Slug != "2026-election-watch" || series.CategoryID != category.ID {
		t.Fatalf("expected normalized series under category, got %+v", series)
	}
	if len(series.Tags) != 2 || series.Tags[0] != "Election" || series.Tags[1] != "polls" {
		t.Fatalf("expected de-duped tags, got %+v", series.Tags)
	}

	// Inactive series should not contribute tags to discovery/admin tag lists.
	repo.series = append(repo.series, prediction.Series{
		ID:         "ser-inactive",
		Slug:       "inactive-topic",
		Title:      "Inactive Topic",
		CategoryID: category.ID,
		Tags:       []string{"hidden"},
		Active:     false,
	})

	tagsReq := httptest.NewRequest(http.MethodGet, "/api/v1/admin/tags?categoryId="+category.ID, nil)
	tagsReq = tagsReq.WithContext(httpx.WithTestUser(tagsReq.Context(), "admin-taxonomy", "taxonomy@taptrade.local", "admin"))
	tagsRes := httptest.NewRecorder()
	handler.ServeHTTP(tagsRes, tagsReq)
	if tagsRes.Code != http.StatusOK {
		t.Fatalf("list tags failed: status=%d body=%s", tagsRes.Code, tagsRes.Body.String())
	}
	var tagsPayload struct {
		Tags []string `json:"tags"`
	}
	if err := json.Unmarshal(tagsRes.Body.Bytes(), &tagsPayload); err != nil {
		t.Fatalf("decode tags: %v", err)
	}
	if strings.Join(tagsPayload.Tags, ",") != "Election,polls" {
		t.Fatalf("expected active sorted tags only, got %+v", tagsPayload.Tags)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/v1/admin/series?categoryId="+category.ID, nil)
	listReq = listReq.WithContext(httpx.WithTestUser(listReq.Context(), "admin-taxonomy", "taxonomy@taptrade.local", "admin"))
	listRes := httptest.NewRecorder()
	handler.ServeHTTP(listRes, listReq)
	if listRes.Code != http.StatusOK {
		t.Fatalf("list series failed: status=%d body=%s", listRes.Code, listRes.Body.String())
	}
	var listed []prediction.Series
	if err := json.Unmarshal(listRes.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode listed series: %v", err)
	}
	if len(listed) != 1 || listed[0].ID != series.ID {
		t.Fatalf("expected only active created series, got %+v", listed)
	}
}

func TestPredictionAdminTaxonomyReadsRedactUnsafeSeriesCopyWithoutMutatingSource(t *testing.T) {
	repo := newPredictionAdminRepo()
	repo.series = []prediction.Series{{
		ID:          "ser-admin-unsafe-read",
		Slug:        "unsafe-read",
		Title:       "Cash payout calendar",
		Description: "Crypto prize schedule",
		CategoryID:  "cat-admin-unsafe-read",
		Tags:        []string{"safe forecast", "USD payout"},
		Active:      true,
	}}
	svc := prediction.NewService(repo, predictionAdminWallet{})

	mux := http.NewServeMux()
	registerSettlementRoutes(mux, svc)
	handler := httpx.Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mux.ServeHTTP(w, r)
		}),
		httpx.RequestID(),
	)

	seriesReq := httptest.NewRequest(http.MethodGet, "/api/v1/admin/series?categoryId=cat-admin-unsafe-read", nil)
	seriesReq = seriesReq.WithContext(httpx.WithTestUser(seriesReq.Context(), "admin-taxonomy", "taxonomy@taptrade.local", "admin"))
	seriesRes := httptest.NewRecorder()
	handler.ServeHTTP(seriesRes, seriesReq)
	if seriesRes.Code != http.StatusOK {
		t.Fatalf("admin series list failed: status=%d body=%s", seriesRes.Code, seriesRes.Body.String())
	}

	tagsReq := httptest.NewRequest(http.MethodGet, "/api/v1/admin/tags?categoryId=cat-admin-unsafe-read", nil)
	tagsReq = tagsReq.WithContext(httpx.WithTestUser(tagsReq.Context(), "admin-taxonomy", "taxonomy@taptrade.local", "admin"))
	tagsRes := httptest.NewRecorder()
	handler.ServeHTTP(tagsRes, tagsReq)
	if tagsRes.Code != http.StatusOK {
		t.Fatalf("admin tags list failed: status=%d body=%s", tagsRes.Code, tagsRes.Body.String())
	}

	for _, body := range []string{seriesRes.Body.String(), tagsRes.Body.String()} {
		for _, unsafe := range []string{"Cash payout calendar", "Crypto prize schedule", "USD payout"} {
			if strings.Contains(body, unsafe) {
				t.Fatalf("admin taxonomy read leaked unsafe copy %q: %s", unsafe, body)
			}
		}
	}
	// Single fields (series title/description) keep the redaction sentinel…
	if !strings.Contains(seriesRes.Body.String(), launchRedactedUserText) {
		t.Fatalf("expected redaction marker in admin series read: %s", seriesRes.Body.String())
	}
	// …but tags are list content: unsafe entries are dropped, and the
	// sentinel never appears as a browsable tag (it isn't the stored value,
	// so a chip built from it could never match a market).
	if strings.Contains(tagsRes.Body.String(), launchRedactedUserText) {
		t.Fatalf("tags list must drop unsafe tags, not redact them: %s", tagsRes.Body.String())
	}
	if !strings.Contains(tagsRes.Body.String(), "safe forecast") {
		t.Fatalf("safe tag must survive the drop filter: %s", tagsRes.Body.String())
	}
	if repo.series[0].Title != "Cash payout calendar" ||
		repo.series[0].Description != "Crypto prize schedule" ||
		repo.series[0].Tags[1] != "USD payout" {
		t.Fatalf("raw series was mutated: %+v", repo.series[0])
	}
}

func TestPredictionAdminTaxonomyRejectsMoneyWordingBeforePersistence(t *testing.T) {
	t.Run("category name", func(t *testing.T) {
		repo := newPredictionAdminRepo()
		svc := prediction.NewService(repo, predictionAdminWallet{})
		mux := http.NewServeMux()
		registerSettlementRoutes(mux, svc)

		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/categories", strings.NewReader(`{
			"name":"Cash Prize Topics",
			"icon":"sparkles"
		}`))
		req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-taxonomy", "taxonomy@taptrade.local", "admin"))
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, req)
		if res.Code != http.StatusBadRequest {
			t.Fatalf("expected unsafe category status 400, got %d body=%s", res.Code, res.Body.String())
		}
		assertLaunchCopyErrorField(t, res, "name", "Cash Prize")
		for _, category := range repo.categories {
			if strings.Contains(category.Name, "Cash Prize") {
				t.Fatalf("unsafe category name persisted: %+v", repo.categories)
			}
		}
	})

	for _, tc := range []struct {
		name       string
		body       string
		wantField  string
		unsafeText string
	}{
		{
			name:       "series title",
			body:       `{"title":"Cash Prize Calendar","categoryId":"cat-safe","tags":["safe"]}`,
			wantField:  "title",
			unsafeText: "Cash Prize",
		},
		{
			name:       "series description",
			body:       `{"title":"Safe Calendar","description":"crypto prize schedule","categoryId":"cat-safe","tags":["safe"]}`,
			wantField:  "description",
			unsafeText: "crypto prize",
		},
		{
			name:       "series tag",
			body:       `{"title":"Safe Calendar","categoryId":"cat-safe","tags":["cashout"]}`,
			wantField:  "tags",
			unsafeText: "cashout",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := newPredictionAdminRepo()
			repo.categories = append(repo.categories, prediction.Category{
				ID: "cat-safe", Slug: "safe", Name: "Safe", Active: true,
			})
			svc := prediction.NewService(repo, predictionAdminWallet{})
			mux := http.NewServeMux()
			registerSettlementRoutes(mux, svc)

			req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/series", strings.NewReader(tc.body))
			req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-taxonomy", "taxonomy@taptrade.local", "admin"))
			res := httptest.NewRecorder()
			mux.ServeHTTP(res, req)
			if res.Code != http.StatusBadRequest {
				t.Fatalf("expected unsafe series status 400, got %d body=%s", res.Code, res.Body.String())
			}
			assertLaunchCopyErrorField(t, res, tc.wantField, tc.unsafeText)
			if len(repo.series) != 0 {
				t.Fatalf("unsafe series persisted: %+v", repo.series)
			}
		})
	}
}

func assertLaunchCopyErrorField(t *testing.T, res *httptest.ResponseRecorder, field string, unsafeText string) {
	t.Helper()
	var envelope httpx.ErrorEnvelope
	if err := json.Unmarshal(res.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode launch-copy error: %v", err)
	}
	details, ok := envelope.Error.Details.(map[string]any)
	if !ok || details["field"] != field {
		t.Fatalf("expected %s error field, got %+v", field, envelope.Error.Details)
	}
	if strings.Contains(res.Body.String(), unsafeText) {
		t.Fatalf("unsafe launch copy should not be echoed: %s", res.Body.String())
	}
}

func TestPredictionCategoryRoutesApplyLaunchTaxonomyBoundary(t *testing.T) {
	repo := newPredictionAdminRepo()
	repo.categories = []prediction.Category{
		{ID: "cat-crypto", Slug: "crypto", Name: "Crypto", Icon: "bitcoin", SortOrder: 2, Active: true},
		{ID: "cat-legacy-safe-slug", Slug: "legacy-points", Name: "Cash Prize Markets", Icon: "trophy", SortOrder: 2, Active: true},
		{ID: "cat-sports", Slug: "sports", Name: "Sports", Icon: "trophy", SortOrder: 3, Active: true},
		{ID: "cat-esports", Slug: "esports", Name: "Esports", Icon: "gamepad-2", SortOrder: 2, Active: true},
	}
	svc := prediction.NewService(repo, predictionAdminWallet{})

	mux := http.NewServeMux()
	registerPredictionRoutes(mux, svc)
	registerSettlementRoutes(mux, svc)
	handler := httpx.Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mux.ServeHTTP(w, r)
		}),
		httpx.RequestID(),
	)

	publicReq := httptest.NewRequest(http.MethodGet, "/api/v1/categories", nil)
	publicRes := httptest.NewRecorder()
	handler.ServeHTTP(publicRes, publicReq)
	if publicRes.Code != http.StatusOK {
		t.Fatalf("public category list failed: status=%d body=%s", publicRes.Code, publicRes.Body.String())
	}
	var publicCategories []prediction.Category
	if err := json.Unmarshal(publicRes.Body.Bytes(), &publicCategories); err != nil {
		t.Fatalf("decode public categories: %v", err)
	}
	for _, category := range publicCategories {
		if category.Slug == "crypto" {
			t.Fatalf("public categories exposed inherited crypto taxonomy: %+v", publicCategories)
		}
	}
	if len(publicCategories) != 2 {
		t.Fatalf("expected two launch-safe public categories, got %+v", publicCategories)
	}

	publicCryptoReq := httptest.NewRequest(http.MethodGet, "/api/v1/categories/crypto", nil)
	publicCryptoRes := httptest.NewRecorder()
	handler.ServeHTTP(publicCryptoRes, publicCryptoReq)
	if publicCryptoRes.Code != http.StatusNotFound {
		t.Fatalf("expected crypto category lookup to 404, got %d body=%s", publicCryptoRes.Code, publicCryptoRes.Body.String())
	}

	publicUnsafeNameReq := httptest.NewRequest(http.MethodGet, "/api/v1/categories/legacy-points", nil)
	publicUnsafeNameRes := httptest.NewRecorder()
	handler.ServeHTTP(publicUnsafeNameRes, publicUnsafeNameReq)
	if publicUnsafeNameRes.Code != http.StatusNotFound {
		t.Fatalf("expected unsafe category-name lookup to 404, got %d body=%s", publicUnsafeNameRes.Code, publicUnsafeNameRes.Body.String())
	}

	adminReq := httptest.NewRequest(http.MethodGet, "/api/v1/admin/categories", nil)
	adminReq = adminReq.WithContext(httpx.WithTestUser(adminReq.Context(), "admin-taxonomy", "taxonomy@taptrade.local", "admin"))
	adminRes := httptest.NewRecorder()
	handler.ServeHTTP(adminRes, adminReq)
	if adminRes.Code != http.StatusOK {
		t.Fatalf("admin category list failed: status=%d body=%s", adminRes.Code, adminRes.Body.String())
	}
	var adminCategories []prediction.Category
	if err := json.Unmarshal(adminRes.Body.Bytes(), &adminCategories); err != nil {
		t.Fatalf("decode admin categories: %v", err)
	}
	for _, category := range adminCategories {
		if category.Slug == "crypto" {
			t.Fatalf("admin categories exposed inherited crypto taxonomy: %+v", adminCategories)
		}
	}

	createCryptoReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/categories", strings.NewReader(`{
		"name":"Crypto Markets",
		"icon":"bitcoin"
	}`))
	createCryptoReq = createCryptoReq.WithContext(httpx.WithTestUser(createCryptoReq.Context(), "admin-taxonomy", "taxonomy@taptrade.local", "admin"))
	createCryptoRes := httptest.NewRecorder()
	handler.ServeHTTP(createCryptoRes, createCryptoReq)
	if createCryptoRes.Code != http.StatusBadRequest {
		t.Fatalf("expected launch-prohibited category create to fail, got %d body=%s", createCryptoRes.Code, createCryptoRes.Body.String())
	}
	for _, category := range repo.categories {
		if category.Slug == "crypto-markets" {
			t.Fatalf("launch-prohibited category was persisted: %+v", repo.categories)
		}
	}
}

func TestPredictionAdminAIBudget(t *testing.T) {
	t.Setenv("GATEWAY_ALLOW_ADMIN_ANON", "false")
	repo := newPredictionAdminRepo()
	svc := prediction.NewService(repo, predictionAdminWallet{})

	mux := http.NewServeMux()
	registerSettlementRoutes(mux, svc)
	handler := httpx.Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mux.ServeHTTP(w, r)
		}),
		httpx.RequestID(),
		httpx.NormalizeTrailingSlash("/api/", "/admin/", "/auth/"),
	)

	// Admin GET -> 200 with allowed=true at zero usage.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/ai-budget", nil)
	req = req.WithContext(
		httpx.WithTestUser(req.Context(), "admin-1", "admin@taptrade.local", "admin"),
	)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", res.Code, res.Body.String())
	}
	var status prediction.AIBudgetStatus
	if err := json.Unmarshal(res.Body.Bytes(), &status); err != nil {
		t.Fatalf("decode budget: %v", err)
	}
	if !status.Allowed {
		t.Fatalf("expected allowed with zero usage")
	}

	// No admin role -> rejected.
	anon := httptest.NewRequest(http.MethodGet, "/api/v1/admin/ai-budget", nil)
	anonRes := httptest.NewRecorder()
	handler.ServeHTTP(anonRes, anon)
	if anonRes.Code == http.StatusOK {
		t.Fatalf("expected non-admin request to be rejected")
	}
}

func TestPredictionAdminReserveAIBudgetRecordsAttempt(t *testing.T) {
	t.Setenv("GATEWAY_ALLOW_ADMIN_ANON", "false")
	t.Setenv("AI_DRAFT_RATE_PER_MIN", "2")
	repo := newPredictionAdminRepo()
	svc := prediction.NewService(repo, predictionAdminWallet{})

	mux := http.NewServeMux()
	registerSettlementRoutes(mux, svc)
	handler := httpx.Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mux.ServeHTTP(w, r)
		}),
		httpx.RequestID(),
		httpx.NormalizeTrailingSlash("/api/", "/admin/", "/auth/"),
	)

	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/ai-budget/reserve", strings.NewReader(`{"estimatedInputTokens":100}`))
		req = req.WithContext(
			httpx.WithTestUser(req.Context(), "admin-1", "admin@taptrade.local", "admin"),
		)
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != http.StatusCreated {
			t.Fatalf("reserve %d: expected 201, got %d body=%s", i, res.Code, res.Body.String())
		}
	}
	if len(repo.aiLogs) != 2 || repo.aiLogs[0].Stage != "draft_request" {
		t.Fatalf("expected two draft_request reservation logs, got %+v", repo.aiLogs)
	}

	third := httptest.NewRequest(http.MethodPost, "/api/v1/admin/ai-budget/reserve", strings.NewReader(`{"estimatedInputTokens":100}`))
	third = third.WithContext(
		httpx.WithTestUser(third.Context(), "admin-1", "admin@taptrade.local", "admin"),
	)
	thirdRes := httptest.NewRecorder()
	handler.ServeHTTP(thirdRes, third)
	if thirdRes.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 after rate budget exhausted, got %d", thirdRes.Code)
	}
}

func TestPredictionAdminLifecycleRoutesSupportOpenCloseAndVoid(t *testing.T) {
	repo := newPredictionAdminRepo()
	svc := prediction.NewService(repo, predictionAdminWallet{})

	mux := http.NewServeMux()
	registerSettlementRoutes(mux, svc)

	handler := httpx.Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mux.ServeHTTP(w, r)
		}),
		httpx.RequestID(),
	)

	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/markets", strings.NewReader(`{
		"eventId":"evt-admin-test-2",
		"ticker":"QA-LIFECYCLE-VOID",
		"title":"QA Lifecycle Void",
		"settlementSourceKey":"manual",
		"settlementRule":"binary",
		"closeAt":"2026-04-30T12:00:00Z",
		"ammLiquidityParam":100
	}`))
	createReq = createReq.WithContext(httpx.WithTestUser(createReq.Context(), "admin-1", "admin@taptrade.local", "admin"))
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)
	if createRes.Code != http.StatusCreated {
		t.Fatalf("create market failed: status=%d body=%s", createRes.Code, createRes.Body.String())
	}

	var market prediction.Market
	if err := json.Unmarshal(createRes.Body.Bytes(), &market); err != nil {
		t.Fatalf("decode create response: %v", err)
	}

	repo.positions[market.ID] = []prediction.Position{{
		ID:              "pos-admin-test-1",
		UserID:          "u-qa-1",
		MarketID:        market.ID,
		Side:            prediction.OrderSideYes,
		Quantity:        1,
		AvgPricePoints:  53,
		TotalCostPoints: 53,
	}}

	var closePayload struct {
		Status            prediction.MarketStatus            `json:"status"`
		TapTradeLifecycle prediction.TapTradeMarketLifecycle `json:"taptradeLifecycle"`
	}
	for _, action := range []string{"open", "close"} {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/markets/"+market.ID+"/lifecycle/"+action, strings.NewReader(`{"reason":"qa lifecycle smoke"}`))
		req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-1", "admin@taptrade.local", "admin"))
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != http.StatusOK {
			t.Fatalf("%s lifecycle failed: status=%d body=%s", action, res.Code, res.Body.String())
		}
		if action == "close" {
			if err := json.Unmarshal(res.Body.Bytes(), &closePayload); err != nil {
				t.Fatalf("decode close response: %v", err)
			}
			if closePayload.Status != prediction.MarketStatusClosed {
				t.Fatalf("expected close response status closed, got %s", closePayload.Status)
			}
			if closePayload.TapTradeLifecycle.Stage != "closed" {
				t.Fatalf("expected close response TapTrade stage closed, got %+v", closePayload.TapTradeLifecycle)
			}
			if len(closePayload.TapTradeLifecycle.AllowedActions) == 0 {
				t.Fatalf("expected close response to include launch-facing next actions")
			}
		}
	}

	voidReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/markets/"+market.ID+"/lifecycle/void", strings.NewReader(`{"reason":"qa void smoke"}`))
	voidReq = voidReq.WithContext(httpx.WithTestUser(voidReq.Context(), "admin-1", "admin@taptrade.local", "admin"))
	voidRes := httptest.NewRecorder()
	handler.ServeHTTP(voidRes, voidReq)
	if voidRes.Code != http.StatusOK {
		t.Fatalf("void lifecycle failed: status=%d body=%s", voidRes.Code, voidRes.Body.String())
	}

	stored, err := repo.GetMarket(context.Background(), market.ID)
	if err != nil {
		t.Fatalf("expected stored market after void: %v", err)
	}
	if stored.Status != prediction.MarketStatusVoided {
		t.Fatalf("expected market status voided, got %s", stored.Status)
	}

	var payload struct {
		Status                prediction.MarketStatus            `json:"status"`
		TapTradeLifecycle     prediction.TapTradeMarketLifecycle `json:"taptradeLifecycle"`
		PointDisbursements    []settlementPointDisbursement      `json:"pointDisbursements"`
		TotalSettlementPoints int64                              `json:"totalSettlementPoints"`
		Unit                  string                             `json:"unit"`
	}
	if err := json.Unmarshal(voidRes.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode void response: %v", err)
	}
	if payload.Status != prediction.MarketStatusVoided {
		t.Fatalf("expected void response status voided, got %s", payload.Status)
	}
	if payload.TapTradeLifecycle.Stage != "invalid" || !payload.TapTradeLifecycle.Terminal {
		t.Fatalf("expected void response TapTrade lifecycle invalid terminal, got %+v", payload.TapTradeLifecycle)
	}
	if len(payload.PointDisbursements) != 1 || payload.PointDisbursements[0].SettlementPoints != 53 {
		t.Fatalf("expected one point disbursement for 53 points cents, got %+v", payload.PointDisbursements)
	}
	if payload.TotalSettlementPoints != 53 || payload.Unit != "PTS" {
		t.Fatalf("expected PTS settlement point aliases, got total=%d unit=%q", payload.TotalSettlementPoints, payload.Unit)
	}
	for _, retired := range []string{`"payouts"`, `"payoutPoints"`, `"pnlPoints"`} {
		if strings.Contains(voidRes.Body.String(), retired) {
			t.Fatalf("void lifecycle response should not emit %s: %s", retired, voidRes.Body.String())
		}
	}
}

func TestPredictionAdminLifecycleReasonRejectsMoneyWording(t *testing.T) {
	repo := newPredictionAdminRepo()
	svc := prediction.NewService(repo, predictionAdminWallet{})

	mux := http.NewServeMux()
	registerSettlementRoutes(mux, svc)
	handler := httpx.Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mux.ServeHTTP(w, r)
		}),
		httpx.RequestID(),
	)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/markets/mkt-missing/lifecycle/open", strings.NewReader(`{"reason":"cash payout review"}`))
	req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-1", "admin@taptrade.local", "admin"))
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected unsafe lifecycle reason to return 400 before market lookup, got %d body=%s", res.Code, res.Body.String())
	}
	var envelope httpx.ErrorEnvelope
	if err := json.Unmarshal(res.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode lifecycle reason error: %v", err)
	}
	details, ok := envelope.Error.Details.(map[string]any)
	if !ok || details["field"] != "reason" {
		t.Fatalf("expected reason error field, got %+v", envelope.Error.Details)
	}
	if strings.Contains(res.Body.String(), "cash payout") {
		t.Fatalf("unsafe lifecycle reason should not be echoed: %s", res.Body.String())
	}
	if len(repo.lifecycle) != 0 {
		t.Fatalf("unsafe lifecycle reason should not persist lifecycle rows: %+v", repo.lifecycle)
	}
}

func TestPredictionAdminSettlementReasonsRejectMoneyWording(t *testing.T) {
	repo := newPredictionAdminRepo()
	svc := prediction.NewService(repo, predictionAdminWallet{})
	store := newPredictionAdminResolutionStore()
	svc.SetResolutionStore(store)

	mux := http.NewServeMux()
	registerSettlementRoutes(mux, svc)
	handler := httpx.Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mux.ServeHTTP(w, r)
		}),
		httpx.RequestID(),
	)

	for _, tc := range []struct {
		name    string
		path    string
		body    string
		field   string
		leaked  string
		adminID string
	}{
		{
			name:    "propose reason",
			path:    "/api/v1/admin/markets/mkt-missing/propose?windowHours=1",
			body:    `{"result":"yes","attestationSource":"admin-manual","reason":"redeemable prize review"}`,
			field:   "reason",
			leaked:  "redeemable prize",
			adminID: "admin-propose-unsafe",
		},
		{
			name:    "direct settlement override reason",
			path:    "/api/v1/admin/settlements/mkt-missing",
			body:    `{"result":"yes","attestationSource":"admin-manual","overrideReason":"USD payout override"}`,
			field:   "overrideReason",
			leaked:  "USD payout",
			adminID: "admin-settle-unsafe",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(tc.body))
			req = req.WithContext(httpx.WithTestUser(req.Context(), tc.adminID, tc.adminID+"@taptrade.local", "admin"))
			res := httptest.NewRecorder()
			handler.ServeHTTP(res, req)

			if res.Code != http.StatusBadRequest {
				t.Fatalf("expected unsafe settlement reason to return 400 before market lookup, got %d body=%s", res.Code, res.Body.String())
			}
			var envelope httpx.ErrorEnvelope
			if err := json.Unmarshal(res.Body.Bytes(), &envelope); err != nil {
				t.Fatalf("decode settlement reason error: %v", err)
			}
			details, ok := envelope.Error.Details.(map[string]any)
			if !ok || details["field"] != tc.field {
				t.Fatalf("expected %s error field, got %+v", tc.field, envelope.Error.Details)
			}
			if strings.Contains(res.Body.String(), tc.leaked) {
				t.Fatalf("unsafe settlement reason should not be echoed: %s", res.Body.String())
			}
		})
	}
	if len(repo.settlements) != 0 {
		t.Fatalf("unsafe settlement reasons should not persist settlement rows: %+v", repo.settlements)
	}
	if len(repo.lifecycle) != 0 {
		t.Fatalf("unsafe settlement reasons should not persist lifecycle rows: %+v", repo.lifecycle)
	}
}

func TestPredictionAdminDisputeResolutionNoteRejectsMoneyWording(t *testing.T) {
	repo := newPredictionAdminRepo()
	svc := prediction.NewService(repo, predictionAdminWallet{})
	store := newPredictionAdminResolutionStore()
	svc.SetResolutionStore(store)

	mux := http.NewServeMux()
	registerAdminDisputeRoutes(mux, svc, store)
	handler := httpx.Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mux.ServeHTTP(w, r)
		}),
		httpx.RequestID(),
	)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/disputes/missing/resolve", strings.NewReader(`{"decision":"reject","note":"cash payout dispute note"}`))
	req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-dispute-unsafe", "admin-dispute@taptrade.local", "admin"))
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected unsafe dispute note to return 400 before lookup, got %d body=%s", res.Code, res.Body.String())
	}
	var envelope httpx.ErrorEnvelope
	if err := json.Unmarshal(res.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode dispute note error: %v", err)
	}
	details, ok := envelope.Error.Details.(map[string]any)
	if !ok || details["field"] != "note" {
		t.Fatalf("expected note error field, got %+v", envelope.Error.Details)
	}
	if strings.Contains(res.Body.String(), "cash payout") {
		t.Fatalf("unsafe dispute note should not be echoed: %s", res.Body.String())
	}
	if len(store.disputes) != 0 {
		t.Fatalf("unsafe dispute note should not persist dispute changes: %+v", store.disputes)
	}
}

func TestPredictionAdminWindowedResolutionRoutesEnforceDualControlAndDisputeGate(t *testing.T) {
	t.Setenv("GATEWAY_ALLOW_ADMIN_ANON", "false")

	repo := newPredictionAdminRepo()
	market := &prediction.Market{
		ID:                  "mkt-windowed-admin-1",
		EventID:             "evt-windowed-admin-1",
		Ticker:              "QA-WINDOWED-1",
		Title:               "QA Windowed Admin Resolution",
		Status:              prediction.MarketStatusClosed,
		SettlementSourceKey: "admin-manual",
		SettlementRule:      "binary_outcome",
		CloseAt:             time.Now().UTC().Add(-time.Hour),
		CreatedAt:           time.Now().UTC().Add(-2 * time.Hour),
		UpdatedAt:           time.Now().UTC().Add(-time.Hour),
		ExecutionMode:       prediction.ExecutionModeOrderBook,
	}
	if err := repo.CreateMarket(context.Background(), market); err != nil {
		t.Fatalf("seed market: %v", err)
	}
	repo.positions[market.ID] = []prediction.Position{{
		ID:              "pos-windowed-holder-1",
		UserID:          "u-windowed-holder",
		MarketID:        market.ID,
		Side:            prediction.OrderSideYes,
		Quantity:        2,
		AvgPricePoints:  40,
		TotalCostPoints: 80,
	}}

	svc := prediction.NewService(repo, predictionAdminWallet{})
	store := newPredictionAdminResolutionStore()
	svc.SetResolutionStore(store)

	mux := http.NewServeMux()
	registerSettlementRoutes(mux, svc)
	registerDisputeRoutes(mux, svc, store, nil)
	registerAdminDisputeRoutes(mux, svc, store)
	handler := httpx.Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mux.ServeHTTP(w, r)
		}),
		httpx.RequestID(),
	)

	proposeReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/markets/"+market.ID+"/propose?windowHours=1", strings.NewReader(`{
		"result":"yes",
		"attestationSource":"admin-manual",
		"reason":"qa proposed resolution"
	}`))
	proposeReq = proposeReq.WithContext(httpx.WithTestUser(proposeReq.Context(), "admin-window-1", "admin1@taptrade.local", "admin"))
	proposeRes := httptest.NewRecorder()
	handler.ServeHTTP(proposeRes, proposeReq)
	if proposeRes.Code != http.StatusOK {
		t.Fatalf("propose failed: status=%d body=%s", proposeRes.Code, proposeRes.Body.String())
	}
	var proposal prediction.ResolutionProposal
	if err := json.Unmarshal(proposeRes.Body.Bytes(), &proposal); err != nil {
		t.Fatalf("decode proposal: %v", err)
	}
	if proposal.Status != "proposed" || proposal.ProposedBy == nil || *proposal.ProposedBy != "admin-window-1" {
		t.Fatalf("expected admin-1 proposed resolution, got %+v", proposal)
	}
	if proposal.ChallengeEndsAt.IsZero() || !proposal.ChallengeEndsAt.After(proposal.ProposedAt) {
		t.Fatalf("expected future challenge window on proposal, got %+v", proposal)
	}
	for _, retired := range []string{`"payouts"`, `"payoutPoints"`, `"pnlPoints"`, `"totalPayoutPoints"`, `"currency"`} {
		if strings.Contains(proposeRes.Body.String(), retired) {
			t.Fatalf("proposal response should not emit %s: %s", retired, proposeRes.Body.String())
		}
	}
	if stored, _ := repo.GetMarket(context.Background(), market.ID); stored.Status != prediction.MarketStatusProposedResolution {
		t.Fatalf("market should enter proposed_resolution, got %s", stored.Status)
	}

	directSettleReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/settlements/"+market.ID, strings.NewReader(`{
		"result":"yes",
		"attestationSource":"admin-manual"
	}`))
	directSettleReq = directSettleReq.WithContext(httpx.WithTestUser(directSettleReq.Context(), "admin-window-2", "admin2@taptrade.local", "admin"))
	directSettleRes := httptest.NewRecorder()
	handler.ServeHTTP(directSettleRes, directSettleReq)
	if directSettleRes.Code != http.StatusBadRequest {
		t.Fatalf("direct settle should not bypass proposed-resolution flow: status=%d body=%s", directSettleRes.Code, directSettleRes.Body.String())
	}

	store.proposals[market.ID].ChallengeEndsAt = time.Now().UTC().Add(-time.Minute)
	selfFinalizeReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/markets/"+market.ID+"/finalize", nil)
	selfFinalizeReq = selfFinalizeReq.WithContext(httpx.WithTestUser(selfFinalizeReq.Context(), "admin-window-1", "admin1@taptrade.local", "admin"))
	selfFinalizeRes := httptest.NewRecorder()
	handler.ServeHTTP(selfFinalizeRes, selfFinalizeReq)
	if selfFinalizeRes.Code != http.StatusBadRequest {
		t.Fatalf("same admin finalize should be blocked: status=%d body=%s", selfFinalizeRes.Code, selfFinalizeRes.Body.String())
	}

	disputeReq := httptest.NewRequest(http.MethodPost, "/api/v1/disputes", strings.NewReader(`{
		"marketId":"`+market.ID+`",
		"reason":"source did not match the posted criteria"
	}`))
	disputeReq = disputeReq.WithContext(httpx.WithTestUser(disputeReq.Context(), "u-windowed-holder", "holder@taptrade.local", "player"))
	disputeRes := httptest.NewRecorder()
	handler.ServeHTTP(disputeRes, disputeReq)
	if disputeRes.Code != http.StatusCreated {
		t.Fatalf("file dispute failed: status=%d body=%s", disputeRes.Code, disputeRes.Body.String())
	}
	if !strings.Contains(disputeRes.Body.String(), `"bondPoints"`) ||
		!strings.Contains(disputeRes.Body.String(), `"unit":"PTS"`) {
		t.Fatalf("dispute response should emit point-native bond fields, got %s", disputeRes.Body.String())
	}
	// Points unit-model (2026-07-07): bondPoints is canonical; the retired
	// spelling is the cents-era bondPointsCents.
	if strings.Contains(disputeRes.Body.String(), `"bondPointsCents"`) {
		t.Fatalf("dispute response should not emit retired bondPointsCents alias: %s", disputeRes.Body.String())
	}
	var dispute prediction.Dispute
	if err := json.Unmarshal(disputeRes.Body.Bytes(), &dispute); err != nil {
		t.Fatalf("decode dispute: %v", err)
	}
	if dispute.Status != "open" || dispute.UserID != "u-windowed-holder" {
		t.Fatalf("expected open holder dispute, got %+v", dispute)
	}
	if stored, _ := repo.GetMarket(context.Background(), market.ID); stored.Status != prediction.MarketStatusDisputed {
		t.Fatalf("market should become disputed after holder challenge, got %s", stored.Status)
	}

	queueReq := httptest.NewRequest(http.MethodGet, "/api/v1/admin/disputes?status=open", nil)
	queueReq = queueReq.WithContext(httpx.WithTestUser(queueReq.Context(), "admin-window-2", "admin2@taptrade.local", "admin"))
	queueRes := httptest.NewRecorder()
	handler.ServeHTTP(queueRes, queueReq)
	if queueRes.Code != http.StatusOK {
		t.Fatalf("admin dispute queue failed: status=%d body=%s", queueRes.Code, queueRes.Body.String())
	}
	if !strings.Contains(queueRes.Body.String(), `"bondPoints"`) ||
		!strings.Contains(queueRes.Body.String(), `"unit":"PTS"`) {
		t.Fatalf("admin dispute queue should emit point-native bond fields, got %s", queueRes.Body.String())
	}
	// Points unit-model (2026-07-07): bondPoints is canonical; the retired
	// spelling is the cents-era bondPointsCents.
	if strings.Contains(queueRes.Body.String(), `"bondPointsCents"`) {
		t.Fatalf("admin dispute queue should not emit retired bondPointsCents alias: %s", queueRes.Body.String())
	}
	var queue struct {
		Items []prediction.Dispute `json:"items"`
	}
	if err := json.Unmarshal(queueRes.Body.Bytes(), &queue); err != nil {
		t.Fatalf("decode dispute queue: %v", err)
	}
	if len(queue.Items) != 1 || queue.Items[0].ID != dispute.ID {
		t.Fatalf("expected queued dispute %s, got %+v", dispute.ID, queue.Items)
	}

	proposerResolveReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/disputes/"+dispute.ID+"/resolve", strings.NewReader(`{
		"decision":"reject",
		"note":"proposer must not review own proposed result"
	}`))
	proposerResolveReq = proposerResolveReq.WithContext(httpx.WithTestUser(proposerResolveReq.Context(), "admin-window-1", "admin1@taptrade.local", "admin"))
	proposerResolveRes := httptest.NewRecorder()
	handler.ServeHTTP(proposerResolveRes, proposerResolveReq)
	if proposerResolveRes.Code != http.StatusBadRequest {
		t.Fatalf("proposer dispute review should be blocked: status=%d body=%s", proposerResolveRes.Code, proposerResolveRes.Body.String())
	}
	if storedDispute, _ := store.GetDispute(context.Background(), dispute.ID); storedDispute.Status != "open" {
		t.Fatalf("blocked proposer review should leave dispute open, got %+v", storedDispute)
	}

	blockedFinalizeReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/markets/"+market.ID+"/finalize", nil)
	blockedFinalizeReq = blockedFinalizeReq.WithContext(httpx.WithTestUser(blockedFinalizeReq.Context(), "admin-window-2", "admin2@taptrade.local", "admin"))
	blockedFinalizeRes := httptest.NewRecorder()
	handler.ServeHTTP(blockedFinalizeRes, blockedFinalizeReq)
	if blockedFinalizeRes.Code != http.StatusBadRequest {
		t.Fatalf("open dispute should block finalize: status=%d body=%s", blockedFinalizeRes.Code, blockedFinalizeRes.Body.String())
	}

	resolveReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/disputes/"+dispute.ID+"/resolve", strings.NewReader(`{
		"decision":"reject",
		"note":"challenge reviewed by second admin"
	}`))
	resolveReq = resolveReq.WithContext(httpx.WithTestUser(resolveReq.Context(), "admin-window-2", "admin2@taptrade.local", "admin"))
	resolveRes := httptest.NewRecorder()
	handler.ServeHTTP(resolveRes, resolveReq)
	if resolveRes.Code != http.StatusOK {
		t.Fatalf("resolve dispute failed: status=%d body=%s", resolveRes.Code, resolveRes.Body.String())
	}
	if !strings.Contains(resolveRes.Body.String(), `"bondPoints"`) ||
		!strings.Contains(resolveRes.Body.String(), `"unit":"PTS"`) {
		t.Fatalf("resolved dispute response should emit point-native bond fields, got %s", resolveRes.Body.String())
	}
	// Points unit-model (2026-07-07): bondPoints is canonical; the retired
	// spelling is the cents-era bondPointsCents.
	if strings.Contains(resolveRes.Body.String(), `"bondPointsCents"`) {
		t.Fatalf("resolved dispute response should not emit retired bondPointsCents alias: %s", resolveRes.Body.String())
	}
	var resolved prediction.Dispute
	if err := json.Unmarshal(resolveRes.Body.Bytes(), &resolved); err != nil {
		t.Fatalf("decode resolved dispute: %v", err)
	}
	if resolved.Status != "rejected" || resolved.ResolvedBy == nil || *resolved.ResolvedBy != "admin-window-2" {
		t.Fatalf("expected second-admin rejected dispute, got %+v", resolved)
	}

	finalizeReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/markets/"+market.ID+"/finalize", nil)
	finalizeReq = finalizeReq.WithContext(httpx.WithTestUser(finalizeReq.Context(), "admin-window-2", "admin2@taptrade.local", "admin"))
	finalizeRes := httptest.NewRecorder()
	handler.ServeHTTP(finalizeRes, finalizeReq)
	if finalizeRes.Code != http.StatusOK {
		t.Fatalf("finalize failed: status=%d body=%s", finalizeRes.Code, finalizeRes.Body.String())
	}
	var settlementPayload settlementOperationResponse
	if err := json.Unmarshal(finalizeRes.Body.Bytes(), &settlementPayload); err != nil {
		t.Fatalf("decode finalize response: %v", err)
	}
	if settlementPayload.Unit != "PTS" || settlementPayload.TotalSettlementPoints != 200 {
		t.Fatalf("expected point settlement aliases, got total=%d unit=%q", settlementPayload.TotalSettlementPoints, settlementPayload.Unit)
	}
	if len(settlementPayload.PointDisbursements) != 1 || settlementPayload.PointDisbursements[0].SettlementPoints != 200 {
		t.Fatalf("expected one 200 point-cent disbursement, got %+v", settlementPayload.PointDisbursements)
	}
	if settlementPayload.TapTradeLifecycle.Stage != "settled" {
		t.Fatalf("expected settled lifecycle metadata, got %+v", settlementPayload.TapTradeLifecycle)
	}
	for _, retired := range []string{`"payouts"`, `"payoutPoints"`, `"pnlPoints"`, `"totalPayoutPoints"`, `"payoutsTotal"`, `"payoutsCompleted"`, `"currency"`} {
		if strings.Contains(finalizeRes.Body.String(), retired) {
			t.Fatalf("finalize response should not emit %s: %s", retired, finalizeRes.Body.String())
		}
	}
	if stored, _ := repo.GetMarket(context.Background(), market.ID); stored.Status != prediction.MarketStatusSettled {
		t.Fatalf("market should settle after second-admin finalize, got %s", stored.Status)
	}
	if store.proposals[market.ID].Status != "finalized" {
		t.Fatalf("proposal should be finalized, got %s", store.proposals[market.ID].Status)
	}
	var finalizedAudit *auditLogEntry
	for _, entry := range providerOpsAuditSnapshot() {
		if entry.Action == "market.finalized" && entry.TargetID == market.ID {
			copy := entry
			finalizedAudit = &copy
		}
	}
	if finalizedAudit == nil {
		t.Fatalf("expected market.finalized audit entry for %s", market.ID)
	}
	if !strings.Contains(finalizedAudit.Details, `"totalSettlementPoints"`) ||
		!strings.Contains(finalizedAudit.Details, `"pointDisbursementCount"`) ||
		!strings.Contains(finalizedAudit.Details, `"unit":"PTS"`) {
		t.Fatalf("finalize audit should use point-native details, got %s", finalizedAudit.Details)
	}
	for _, retired := range []string{`"totalPayoutPoints"`, `"payoutCount"`, `"currency"`} {
		if strings.Contains(finalizedAudit.Details, retired) {
			t.Fatalf("finalize audit should not emit retired %s: %s", retired, finalizedAudit.Details)
		}
	}
}

func TestPredictionAdminWindowedResolutionAllowsExplicitZeroHourWindow(t *testing.T) {
	t.Setenv("GATEWAY_ALLOW_ADMIN_ANON", "false")

	repo := newPredictionAdminRepo()
	market := &prediction.Market{
		ID:                  "mkt-windowed-zero",
		EventID:             "evt-windowed-zero",
		Ticker:              "QA-WINDOWED-ZERO",
		Title:               "QA Windowed Zero",
		Status:              prediction.MarketStatusClosed,
		YesPricePoints:      55,
		NoPricePoints:       45,
		ExecutionMode:       prediction.ExecutionModeOrderBook,
		SettlementSourceKey: "admin-manual",
		SettlementRule:      "binary_outcome",
		CloseAt:             time.Now().UTC().Add(-time.Hour),
		CreatedAt:           time.Now().UTC().Add(-2 * time.Hour),
		UpdatedAt:           time.Now().UTC().Add(-time.Hour),
	}
	if err := repo.CreateMarket(context.Background(), market); err != nil {
		t.Fatalf("seed market: %v", err)
	}
	repo.positions[market.ID] = []prediction.Position{{
		ID:              "pos-windowed-zero-holder",
		UserID:          "u-windowed-zero-holder",
		MarketID:        market.ID,
		Side:            prediction.OrderSideYes,
		Quantity:        1,
		AvgPricePoints:  55,
		TotalCostPoints: 55,
	}}

	svc := prediction.NewService(repo, predictionAdminWallet{})
	store := newPredictionAdminResolutionStore()
	svc.SetResolutionStore(store)

	mux := http.NewServeMux()
	registerSettlementRoutes(mux, svc)
	handler := httpx.Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mux.ServeHTTP(w, r)
		}),
		httpx.RequestID(),
	)

	proposeReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/markets/"+market.ID+"/propose?windowHours=0", strings.NewReader(`{
		"result":"yes",
		"attestationSource":"admin-manual",
		"reason":"qa immediate proposed resolution"
	}`))
	proposeReq = proposeReq.WithContext(httpx.WithTestUser(proposeReq.Context(), "admin-zero-1", "zero1@taptrade.local", "admin"))
	proposeRes := httptest.NewRecorder()
	handler.ServeHTTP(proposeRes, proposeReq)
	if proposeRes.Code != http.StatusOK {
		t.Fatalf("propose failed: status=%d body=%s", proposeRes.Code, proposeRes.Body.String())
	}
	var proposal prediction.ResolutionProposal
	if err := json.Unmarshal(proposeRes.Body.Bytes(), &proposal); err != nil {
		t.Fatalf("decode proposal: %v", err)
	}
	if proposal.Status != "proposed" || proposal.ProposedBy == nil || *proposal.ProposedBy != "admin-zero-1" {
		t.Fatalf("expected admin-zero-1 proposed resolution, got %+v", proposal)
	}
	if !proposal.ChallengeEndsAt.Equal(proposal.ProposedAt) {
		t.Fatalf("explicit windowHours=0 should end at proposedAt, got proposedAt=%s challengeEndsAt=%s", proposal.ProposedAt, proposal.ChallengeEndsAt)
	}

	selfFinalizeReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/markets/"+market.ID+"/finalize", nil)
	selfFinalizeReq = selfFinalizeReq.WithContext(httpx.WithTestUser(selfFinalizeReq.Context(), "admin-zero-1", "zero1@taptrade.local", "admin"))
	selfFinalizeRes := httptest.NewRecorder()
	handler.ServeHTTP(selfFinalizeRes, selfFinalizeReq)
	if selfFinalizeRes.Code != http.StatusBadRequest {
		t.Fatalf("same admin finalize should be blocked: status=%d body=%s", selfFinalizeRes.Code, selfFinalizeRes.Body.String())
	}

	finalizeReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/markets/"+market.ID+"/finalize", nil)
	finalizeReq = finalizeReq.WithContext(httpx.WithTestUser(finalizeReq.Context(), "admin-zero-2", "zero2@taptrade.local", "admin"))
	finalizeRes := httptest.NewRecorder()
	handler.ServeHTTP(finalizeRes, finalizeReq)
	if finalizeRes.Code != http.StatusOK {
		t.Fatalf("second-admin finalize failed: status=%d body=%s", finalizeRes.Code, finalizeRes.Body.String())
	}
	var settlementPayload settlementOperationResponse
	if err := json.Unmarshal(finalizeRes.Body.Bytes(), &settlementPayload); err != nil {
		t.Fatalf("decode finalize response: %v", err)
	}
	if settlementPayload.Unit != "PTS" || settlementPayload.TotalSettlementPoints != 100 {
		t.Fatalf("expected one winning share settled in PTS, got total=%d unit=%q", settlementPayload.TotalSettlementPoints, settlementPayload.Unit)
	}
	if settlementPayload.TapTradeLifecycle.Stage != "settled" {
		t.Fatalf("expected settled lifecycle metadata, got %+v", settlementPayload.TapTradeLifecycle)
	}
	for _, retired := range []string{`"payouts"`, `"payoutPoints"`, `"pnlPoints"`, `"totalPayoutPoints"`, `"currency"`} {
		if strings.Contains(finalizeRes.Body.String(), retired) {
			t.Fatalf("finalize response should not emit %s: %s", retired, finalizeRes.Body.String())
		}
	}
}

func TestPredictionAdminWindowedResolutionRequiresIdentifiedAdmin(t *testing.T) {
	t.Setenv("GATEWAY_ALLOW_ADMIN_ANON", "true")
	t.Setenv("ENVIRONMENT", "development")

	repo := newPredictionAdminRepo()
	market := &prediction.Market{
		ID:                  "mkt-windowed-admin-identity",
		EventID:             "evt-windowed-admin-identity",
		Ticker:              "QA-WINDOWED-IDENTITY",
		Title:               "QA Windowed Admin Identity",
		Status:              prediction.MarketStatusClosed,
		SettlementSourceKey: "admin-manual",
		SettlementRule:      "binary_outcome",
		CloseAt:             time.Now().UTC().Add(-time.Hour),
		CreatedAt:           time.Now().UTC().Add(-2 * time.Hour),
		UpdatedAt:           time.Now().UTC().Add(-time.Hour),
		ExecutionMode:       prediction.ExecutionModeOrderBook,
	}
	if err := repo.CreateMarket(context.Background(), market); err != nil {
		t.Fatalf("seed market: %v", err)
	}

	svc := prediction.NewService(repo, predictionAdminWallet{})
	store := newPredictionAdminResolutionStore()
	svc.SetResolutionStore(store)

	mux := http.NewServeMux()
	registerSettlementRoutes(mux, svc)
	handler := httpx.Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mux.ServeHTTP(w, r)
		}),
		httpx.RequestID(),
	)

	proposeReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/markets/"+market.ID+"/propose?windowHours=1", strings.NewReader(`{
		"result":"yes",
		"attestationSource":"admin-manual"
	}`))
	proposeRes := httptest.NewRecorder()
	handler.ServeHTTP(proposeRes, proposeReq)
	if proposeRes.Code != http.StatusForbidden {
		t.Fatalf("uid-less propose should be forbidden: status=%d body=%s", proposeRes.Code, proposeRes.Body.String())
	}
	if len(store.proposals) != 0 {
		t.Fatalf("uid-less propose should not create proposal, got %+v", store.proposals)
	}
	if stored, _ := repo.GetMarket(context.Background(), market.ID); stored.Status != prediction.MarketStatusClosed {
		t.Fatalf("uid-less propose should leave market closed, got %s", stored.Status)
	}

	finalizeReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/markets/"+market.ID+"/finalize", nil)
	finalizeRes := httptest.NewRecorder()
	handler.ServeHTTP(finalizeRes, finalizeReq)
	if finalizeRes.Code != http.StatusForbidden {
		t.Fatalf("uid-less finalize should be forbidden: status=%d body=%s", finalizeRes.Code, finalizeRes.Body.String())
	}
	if !strings.Contains(finalizeRes.Body.String(), "identified admin") {
		t.Fatalf("expected identified-admin error, got %s", finalizeRes.Body.String())
	}
}

func TestPredictionAdminLifecycleAuditRouteListsMappedEvents(t *testing.T) {
	repo := newPredictionAdminRepo()
	svc := prediction.NewService(repo, predictionAdminWallet{})

	mux := http.NewServeMux()
	registerSettlementRoutes(mux, svc)

	handler := httpx.Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mux.ServeHTTP(w, r)
		}),
		httpx.RequestID(),
	)

	market := &prediction.Market{
		ID:                  "mkt-admin-audit-1",
		EventID:             "evt-admin-audit-1",
		Ticker:              "QA-LIFECYCLE-AUDIT",
		Title:               "QA Lifecycle Audit",
		Status:              prediction.MarketStatusUnopened,
		SettlementSourceKey: "manual",
		SettlementRule:      "binary",
		CloseAt:             time.Now().UTC().Add(time.Hour),
		CreatedAt:           time.Now().UTC(),
		UpdatedAt:           time.Now().UTC(),
		ExecutionMode:       prediction.ExecutionModeOrderBook,
	}
	if err := repo.CreateMarket(context.Background(), market); err != nil {
		t.Fatalf("seed market: %v", err)
	}

	for _, action := range []string{"open", "halt"} {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/markets/"+market.ID+"/lifecycle/"+action, strings.NewReader(`{"reason":"audit smoke"}`))
		req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-audit", "audit@taptrade.local", "admin"))
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != http.StatusOK {
			t.Fatalf("%s lifecycle failed: status=%d body=%s", action, res.Code, res.Body.String())
		}
	}

	auditReq := httptest.NewRequest(http.MethodGet, "/api/v1/admin/markets/"+market.ID+"/lifecycle", nil)
	auditReq = auditReq.WithContext(httpx.WithTestUser(auditReq.Context(), "admin-audit", "audit@taptrade.local", "admin"))
	auditRes := httptest.NewRecorder()
	handler.ServeHTTP(auditRes, auditReq)
	if auditRes.Code != http.StatusOK {
		t.Fatalf("lifecycle audit failed: status=%d body=%s", auditRes.Code, auditRes.Body.String())
	}

	var payload struct {
		MarketID string `json:"marketId"`
		Data     []struct {
			EventType         string                             `json:"eventType"`
			ActorID           *string                            `json:"actorId"`
			Reason            *string                            `json:"reason"`
			TapTradeLifecycle prediction.TapTradeMarketLifecycle `json:"taptradeLifecycle"`
		} `json:"data"`
	}
	if err := json.Unmarshal(auditRes.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode lifecycle audit: %v", err)
	}
	if payload.MarketID != market.ID || len(payload.Data) != 2 {
		t.Fatalf("expected two lifecycle audit rows for %s, got %+v", market.ID, payload)
	}
	if payload.Data[0].EventType != string(prediction.MarketStatusOpen) || payload.Data[0].TapTradeLifecycle.Stage != "open" {
		t.Fatalf("expected first lifecycle audit row to map open, got %+v", payload.Data[0])
	}
	if payload.Data[1].EventType != string(prediction.MarketStatusHalted) || payload.Data[1].TapTradeLifecycle.Stage != "paused" {
		t.Fatalf("expected second lifecycle audit row to map paused, got %+v", payload.Data[1])
	}
	if payload.Data[1].ActorID == nil || *payload.Data[1].ActorID != "admin-audit" {
		t.Fatalf("expected acting admin id on lifecycle audit, got %+v", payload.Data[1].ActorID)
	}
	if payload.Data[1].Reason == nil || *payload.Data[1].Reason != "audit smoke" {
		t.Fatalf("expected lifecycle reason on audit row, got %+v", payload.Data[1].Reason)
	}
}

func TestPredictionAdminLifecycleAuditRouteRedactsLegacyUnsafeReason(t *testing.T) {
	repo := newPredictionAdminRepo()
	svc := prediction.NewService(repo, predictionAdminWallet{})

	mux := http.NewServeMux()
	registerSettlementRoutes(mux, svc)

	handler := httpx.Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mux.ServeHTTP(w, r)
		}),
		httpx.RequestID(),
	)

	unsafeReason := "cash payout lifecycle review"
	unsafeMetadata := `{"note":"cash payout lifecycle metadata","nested":{"summary":"crypto prize review"}}`
	repo.lifecycle = []prediction.LifecycleEvent{{
		ID:         "life-unsafe-reason-1",
		MarketID:   "mkt-admin-unsafe-lifecycle",
		EventType:  string(prediction.MarketStatusClosed),
		ActorType:  "admin",
		Reason:     &unsafeReason,
		Metadata:   json.RawMessage(unsafeMetadata),
		OccurredAt: time.Date(2026, 6, 30, 20, 40, 0, 0, time.UTC),
	}}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/markets/mkt-admin-unsafe-lifecycle/lifecycle", nil)
	req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-audit", "audit@taptrade.local", "admin"))
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("lifecycle audit failed: status=%d body=%s", res.Code, res.Body.String())
	}
	if strings.Contains(res.Body.String(), unsafeReason) {
		t.Fatalf("lifecycle audit leaked unsafe legacy reason: %s", res.Body.String())
	}
	if strings.Contains(res.Body.String(), "cash payout lifecycle metadata") || strings.Contains(res.Body.String(), "crypto prize review") {
		t.Fatalf("lifecycle audit leaked unsafe legacy metadata: %s", res.Body.String())
	}

	var payload struct {
		Data []struct {
			Reason   *string         `json:"reason"`
			Metadata json.RawMessage `json:"metadata"`
		} `json:"data"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode lifecycle audit: %v", err)
	}
	if len(payload.Data) != 1 || payload.Data[0].Reason == nil || *payload.Data[0].Reason != launchRedactedUserText {
		t.Fatalf("expected unsafe lifecycle reason redacted, got %+v", payload)
	}
	if !strings.Contains(string(payload.Data[0].Metadata), launchRedactedUserText) {
		t.Fatalf("expected unsafe lifecycle metadata redacted, got %s", string(payload.Data[0].Metadata))
	}
	if repo.lifecycle[0].Reason == nil || *repo.lifecycle[0].Reason != unsafeReason {
		t.Fatalf("redaction should not mutate stored lifecycle reason, got %+v", repo.lifecycle[0].Reason)
	}
	if string(repo.lifecycle[0].Metadata) != unsafeMetadata {
		t.Fatalf("redaction should not mutate stored lifecycle metadata, got %s", string(repo.lifecycle[0].Metadata))
	}
}

func TestPredictionAdminLifecycleAuditCSVExport(t *testing.T) {
	repo := newPredictionAdminRepo()
	svc := prediction.NewService(repo, predictionAdminWallet{})

	mux := http.NewServeMux()
	registerSettlementRoutes(mux, svc)

	handler := httpx.Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mux.ServeHTTP(w, r)
		}),
		httpx.RequestID(),
	)

	actorID := "admin-export"
	reason := `=HYPERLINK("https://example.invalid","audit")`
	unsafeReason := "cash payout lifecycle export"
	unsafeMetadata := `{"note":"cash payout lifecycle export metadata","nested":["crypto prize export"]}`
	repo.lifecycle = []prediction.LifecycleEvent{
		{
			ID:         "life-export-1",
			MarketID:   "mkt-admin-export-1",
			EventType:  string(prediction.MarketStatusHalted),
			ActorID:    &actorID,
			ActorType:  "admin",
			Reason:     &reason,
			OccurredAt: time.Date(2026, 6, 24, 10, 30, 0, 0, time.UTC),
		},
		{
			ID:         "life-export-2",
			MarketID:   "mkt-admin-export-1",
			EventType:  string(prediction.MarketStatusClosed),
			ActorID:    &actorID,
			ActorType:  "admin",
			Reason:     &unsafeReason,
			Metadata:   json.RawMessage(unsafeMetadata),
			OccurredAt: time.Date(2026, 6, 24, 11, 30, 0, 0, time.UTC),
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/markets/mkt-admin-export-1/lifecycle?format=csv", nil)
	req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-export", "export@taptrade.local", "admin"))
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("lifecycle audit csv failed: status=%d body=%s", res.Code, res.Body.String())
	}
	if ct := res.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/csv") {
		t.Fatalf("expected text/csv content type, got %q", ct)
	}
	if cd := res.Header().Get("Content-Disposition"); !strings.Contains(cd, `filename="market-lifecycle-mkt-admin-export-1.csv"`) {
		t.Fatalf("expected market-scoped csv filename, got %q", cd)
	}

	rows, err := csv.NewReader(strings.NewReader(res.Body.String())).ReadAll()
	if err != nil {
		t.Fatalf("read lifecycle csv: %v", err)
	}
	if len(rows) != 3 {
		t.Fatalf("expected header plus two rows, got %+v", rows)
	}
	if got := rows[0]; got[0] != "id" || got[3] != "taptrade_stage" || got[7] != "reason" {
		t.Fatalf("unexpected csv header: %+v", got)
	}
	if got := rows[1]; got[2] != string(prediction.MarketStatusHalted) || got[3] != "paused" || got[5] != actorID {
		t.Fatalf("unexpected lifecycle csv row: %+v", got)
	}
	if got := rows[1][7]; got != "'"+reason {
		t.Fatalf("expected formula-safe reason, got %q", got)
	}
	if strings.Contains(res.Body.String(), unsafeReason) {
		t.Fatalf("lifecycle csv leaked unsafe legacy reason: %s", res.Body.String())
	}
	if strings.Contains(res.Body.String(), "cash payout lifecycle export metadata") || strings.Contains(res.Body.String(), "crypto prize export") {
		t.Fatalf("lifecycle csv leaked unsafe legacy metadata: %s", res.Body.String())
	}
	if got := rows[2][7]; got != launchRedactedUserText {
		t.Fatalf("expected unsafe lifecycle reason redacted in csv, got %q", got)
	}
	if got := rows[2][8]; !strings.Contains(got, launchRedactedUserText) {
		t.Fatalf("expected unsafe lifecycle metadata redacted in csv, got %q", got)
	}
	if repo.lifecycle[1].Reason == nil || *repo.lifecycle[1].Reason != unsafeReason {
		t.Fatalf("csv redaction should not mutate stored lifecycle reason, got %+v", repo.lifecycle[1].Reason)
	}
	if string(repo.lifecycle[1].Metadata) != unsafeMetadata {
		t.Fatalf("csv redaction should not mutate stored lifecycle metadata, got %s", string(repo.lifecycle[1].Metadata))
	}
}

func TestPredictionAdminMarketsCSVExport(t *testing.T) {
	repo := newPredictionAdminRepo()
	svc := prediction.NewService(repo, predictionAdminWallet{})

	mux := http.NewServeMux()
	registerSettlementRoutes(mux, svc)

	handler := httpx.Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mux.ServeHTTP(w, r)
		}),
		httpx.RequestID(),
	)

	now := time.Date(2026, 6, 25, 12, 0, 0, 0, time.UTC)
	result := prediction.MarketResultYes
	repo.markets["mkt-admin-market-export-1"] = &prediction.Market{
		ID:                  "mkt-admin-market-export-1",
		EventID:             "evt-admin-market-export-1",
		Ticker:              "EXPORT-YES",
		Title:               "=Exportable market",
		Status:              prediction.MarketStatusSettled,
		Result:              &result,
		ExecutionMode:       prediction.ExecutionModeOrderBook,
		YesPricePoints:      63,
		NoPricePoints:       37,
		VolumePoints:        123400,
		OpenInterestPoints:  42000,
		LiquidityPoints:     99000,
		SettlementSourceKey: "admin-manual",
		SettlementRule:      "binary_outcome",
		CloseAt:             now.Add(24 * time.Hour),
		CreatedAt:           now,
		UpdatedAt:           now.Add(time.Hour),
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/markets?format=csv&pageSize=100", nil)
	req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-export", "export@taptrade.local", "admin"))
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("admin markets csv failed: status=%d body=%s", res.Code, res.Body.String())
	}
	if ct := res.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/csv") {
		t.Fatalf("expected text/csv content type, got %q", ct)
	}
	if cd := res.Header().Get("Content-Disposition"); !strings.Contains(cd, `filename="prediction-markets.csv"`) {
		t.Fatalf("expected admin markets csv filename, got %q", cd)
	}

	rows, err := csv.NewReader(strings.NewReader(res.Body.String())).ReadAll()
	if err != nil {
		t.Fatalf("read admin markets csv: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected header plus one row, got %+v", rows)
	}
	if got := rows[0]; got[0] != "market_id" || got[5] != "taptrade_stage" || got[10] != "volume_points" {
		t.Fatalf("unexpected csv header: %+v", got)
	}
	got := rows[1]
	if got[0] != "mkt-admin-market-export-1" || got[2] != "EXPORT-YES" || got[3] != "'=Exportable market" {
		t.Fatalf("unexpected identity/title fields: %+v", got)
	}
	if got[4] != string(prediction.MarketStatusSettled) || got[5] != "settled" || got[6] != string(prediction.MarketResultYes) {
		t.Fatalf("unexpected lifecycle fields: %+v", got)
	}
	if got[7] != string(prediction.ExecutionModeOrderBook) || got[10] != "123400" || got[13] != "admin-manual" {
		t.Fatalf("unexpected market metrics/source fields: %+v", got)
	}
}

func TestPredictionAdminMarketsReadRedactsUnsafeCopyWithoutMutatingMarket(t *testing.T) {
	repo := newPredictionAdminRepo()
	svc := prediction.NewService(repo, predictionAdminWallet{})

	mux := http.NewServeMux()
	registerSettlementRoutes(mux, svc)

	handler := httpx.Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mux.ServeHTTP(w, r)
		}),
		httpx.RequestID(),
	)

	rawFallback := "crypto fallback"
	repo.markets["mkt-admin-unsafe-read"] = &prediction.Market{
		ID:                  "mkt-admin-unsafe-read",
		EventID:             "evt-admin-unsafe-read",
		Ticker:              "ADMIN-UNSAFE",
		Title:               "Cash payout market",
		Description:         "Crypto prize details",
		CategoryName:        "USD payout category",
		Translations:        json.RawMessage(`{"en":{"title":"USDC payout market"}}`),
		Status:              prediction.MarketStatusOpen,
		ExecutionMode:       prediction.ExecutionModeOrderBook,
		SettlementSourceKey: "crypto-feed",
		SettlementRule:      "cash payout rule",
		SettlementParams:    json.RawMessage(`{"source":"fiat payout"}`),
		FallbackSourceKey:   &rawFallback,
		CloseAt:             time.Date(2026, 6, 25, 12, 0, 0, 0, time.UTC),
	}

	jsonReq := httptest.NewRequest(http.MethodGet, "/api/v1/admin/markets?pageSize=100", nil)
	jsonReq = jsonReq.WithContext(httpx.WithTestUser(jsonReq.Context(), "admin-unsafe-read", "unsafe-read@taptrade.local", "admin"))
	jsonRes := httptest.NewRecorder()
	handler.ServeHTTP(jsonRes, jsonReq)
	if jsonRes.Code != http.StatusOK {
		t.Fatalf("admin markets json failed: status=%d body=%s", jsonRes.Code, jsonRes.Body.String())
	}

	csvReq := httptest.NewRequest(http.MethodGet, "/api/v1/admin/markets?format=csv&pageSize=100", nil)
	csvReq = csvReq.WithContext(httpx.WithTestUser(csvReq.Context(), "admin-unsafe-read", "unsafe-read@taptrade.local", "admin"))
	csvRes := httptest.NewRecorder()
	handler.ServeHTTP(csvRes, csvReq)
	if csvRes.Code != http.StatusOK {
		t.Fatalf("admin markets csv failed: status=%d body=%s", csvRes.Code, csvRes.Body.String())
	}

	detailReq := httptest.NewRequest(http.MethodGet, "/api/v1/admin/markets/mkt-admin-unsafe-read", nil)
	detailReq = detailReq.WithContext(httpx.WithTestUser(detailReq.Context(), "admin-unsafe-read", "unsafe-read@taptrade.local", "admin"))
	detailRes := httptest.NewRecorder()
	handler.ServeHTTP(detailRes, detailReq)
	if detailRes.Code != http.StatusOK {
		t.Fatalf("admin market detail failed: status=%d body=%s", detailRes.Code, detailRes.Body.String())
	}

	for _, body := range []string{jsonRes.Body.String(), csvRes.Body.String(), detailRes.Body.String()} {
		for _, unsafe := range []string{
			"Cash payout market",
			"Crypto prize details",
			"USD payout category",
			"USDC payout market",
			"crypto-feed",
			"cash payout rule",
			"fiat payout",
			"crypto fallback",
		} {
			if strings.Contains(body, unsafe) {
				t.Fatalf("admin markets read leaked unsafe copy %q: %s", unsafe, body)
			}
		}
		if !strings.Contains(body, launchRedactedUserText) {
			t.Fatalf("expected redaction marker in admin market read: %s", body)
		}
	}

	raw := repo.markets["mkt-admin-unsafe-read"]
	if raw.Title != "Cash payout market" ||
		raw.Description != "Crypto prize details" ||
		raw.CategoryName != "USD payout category" ||
		string(raw.Translations) != `{"en":{"title":"USDC payout market"}}` ||
		raw.SettlementSourceKey != "crypto-feed" ||
		raw.SettlementRule != "cash payout rule" ||
		string(raw.SettlementParams) != `{"source":"fiat payout"}` ||
		raw.FallbackSourceKey == nil ||
		*raw.FallbackSourceKey != "crypto fallback" {
		t.Fatalf("raw admin market was mutated: %+v", raw)
	}
}

func TestPredictionAdminSettlementReplayResumesIncompleteDisbursements(t *testing.T) {
	repo := newPredictionAdminRepo()
	repo.incompleteSettlements = []prediction.Settlement{{
		ID:               "settlement-replay-1",
		MarketID:         "mkt-replay-1",
		Result:           prediction.MarketResultYes,
		PayoutsTotal:     2,
		PayoutsCompleted: 0,
	}}
	repo.unpaidSettlementPositions["settlement-replay-1"] = []prediction.Position{
		{
			ID:              "pos-replay-1",
			UserID:          "user-replay-1",
			MarketID:        "mkt-replay-1",
			Side:            prediction.OrderSideYes,
			Quantity:        1,
			AvgPricePoints:  55,
			TotalCostPoints: 55,
		},
		{
			ID:              "pos-replay-2",
			UserID:          "user-replay-2",
			MarketID:        "mkt-replay-1",
			Side:            prediction.OrderSideNo,
			Quantity:        1,
			AvgPricePoints:  45,
			TotalCostPoints: 45,
		},
	}
	svc := prediction.NewService(repo, predictionAdminWallet{})

	mux := http.NewServeMux()
	registerSettlementRoutes(mux, svc)

	handler := httpx.Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mux.ServeHTTP(w, r)
		}),
		httpx.RequestID(),
	)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/settlements/replay", nil)
	req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-replay", "replay@taptrade.local", "admin"))
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("settlement replay failed: status=%d body=%s", res.Code, res.Body.String())
	}

	var payload struct {
		CompletedSettlements int    `json:"completedSettlements"`
		Summary              string `json:"summary"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode settlement replay response: %v", err)
	}
	if payload.CompletedSettlements != 1 {
		t.Fatalf("expected one completed settlement, got %+v", payload)
	}
	if !strings.Contains(payload.Summary, "Replayed incomplete settlement point disbursements") {
		t.Fatalf("expected launch-facing replay summary, got %q", payload.Summary)
	}
	if repo.replayBatches != 1 {
		t.Fatalf("expected one replay batch, got %d", repo.replayBatches)
	}
	if unpaid := repo.unpaidSettlementPositions["settlement-replay-1"]; len(unpaid) != 0 {
		t.Fatalf("expected replay to clear unpaid positions, got %+v", unpaid)
	}

	second := httptest.NewRequest(http.MethodPost, "/api/v1/admin/settlements/replay", nil)
	second = second.WithContext(httpx.WithTestUser(second.Context(), "admin-replay", "replay@taptrade.local", "admin"))
	secondRes := httptest.NewRecorder()
	handler.ServeHTTP(secondRes, second)
	if secondRes.Code != http.StatusOK {
		t.Fatalf("second settlement replay failed: status=%d body=%s", secondRes.Code, secondRes.Body.String())
	}
	var secondPayload struct {
		CompletedSettlements int `json:"completedSettlements"`
	}
	if err := json.Unmarshal(secondRes.Body.Bytes(), &secondPayload); err != nil {
		t.Fatalf("decode second settlement replay response: %v", err)
	}
	if secondPayload.CompletedSettlements != 0 {
		t.Fatalf("expected idempotent second replay to find no incomplete settlements, got %+v", secondPayload)
	}
}

func TestPredictionAdminUpdateEventPresentation(t *testing.T) {
	// TestMain turns on the dev admin bypass; this test checks that a
	// non-admin is rejected, so switch it off.
	t.Setenv("GATEWAY_ALLOW_ADMIN_ANON", "")
	repo := newPredictionAdminRepo()
	svc := prediction.NewService(repo, predictionAdminWallet{})
	mux := http.NewServeMux()
	registerSettlementRoutes(mux, svc)

	admin := func(req *http.Request) *http.Request {
		return req.WithContext(httpx.WithTestUser(req.Context(), "admin-1", "admin@taptrade.local", "admin"))
	}
	serve := func(req *http.Request) *httptest.ResponseRecorder {
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, req)
		return res
	}

	create := serve(admin(httptest.NewRequest(http.MethodPost, "/api/v1/admin/events",
		strings.NewReader(`{"title":"PBA Philippine Cup Finals","categoryId":"cat-1","closeAt":"2026-12-31T23:59:00Z"}`))))
	if create.Code != http.StatusCreated {
		t.Fatalf("create event: %d %s", create.Code, create.Body.String())
	}
	id := repo.events[0].ID

	// Feature it and give it a cover.
	res := serve(admin(httptest.NewRequest(http.MethodPatch, "/api/v1/admin/events/"+id,
		strings.NewReader(`{"featured":true,"coverImageUrl":"/images/covers/basketball.jpg"}`))))
	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", res.Code, res.Body.String())
	}
	var event prediction.Event
	if err := json.Unmarshal(res.Body.Bytes(), &event); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !event.Featured || event.CoverImageURL == nil || *event.CoverImageURL != "/images/covers/basketball.jpg" {
		t.Fatalf("presentation not applied: %+v", event)
	}

	// An empty cover clears it and leaves featured alone.
	res = serve(admin(httptest.NewRequest(http.MethodPatch, "/api/v1/admin/events/"+id,
		strings.NewReader(`{"coverImageUrl":""}`))))
	if res.Code != http.StatusOK || repo.events[0].CoverImageURL != nil || !repo.events[0].Featured {
		t.Fatalf("clearing the cover failed: %d %+v", res.Code, repo.events[0])
	}

	// Unsafe cover URLs never persist.
	for _, cover := range []string{"javascript:alert(1)", "http://example.com/a.jpg", "/images/../auth"} {
		res = serve(admin(httptest.NewRequest(http.MethodPatch, "/api/v1/admin/events/"+id,
			strings.NewReader(`{"coverImageUrl":"`+cover+`"}`))))
		if res.Code != http.StatusBadRequest {
			t.Fatalf("cover %q: expected 400, got %d", cover, res.Code)
		}
	}
	if repo.events[0].CoverImageURL != nil {
		t.Fatalf("unsafe cover persisted: %v", *repo.events[0].CoverImageURL)
	}

	// Unknown event -> 404; empty body -> 400; wrong verb -> 405.
	if res = serve(admin(httptest.NewRequest(http.MethodPatch, "/api/v1/admin/events/nope",
		strings.NewReader(`{"featured":true}`)))); res.Code != http.StatusNotFound {
		t.Fatalf("unknown event: expected 404, got %d", res.Code)
	}
	if res = serve(admin(httptest.NewRequest(http.MethodPatch, "/api/v1/admin/events/"+id,
		strings.NewReader(`{}`)))); res.Code != http.StatusBadRequest {
		t.Fatalf("empty patch: expected 400, got %d", res.Code)
	}
	if res = serve(admin(httptest.NewRequest(http.MethodGet, "/api/v1/admin/events/"+id, nil))); res.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET: expected 405, got %d", res.Code)
	}

	// Non-admins cannot curate.
	anon := serve(httptest.NewRequest(http.MethodPatch, "/api/v1/admin/events/"+id, strings.NewReader(`{"featured":false}`)))
	if anon.Code == http.StatusOK || !repo.events[0].Featured {
		t.Fatalf("non-admin patch was applied: %d", anon.Code)
	}
}
