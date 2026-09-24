package prediction

import (
	"context"
	"errors"
	"time"
)

// ErrPositionNotFound is the domain sentinel for "no position row" so callers
// can distinguish a legitimate absence from a real read failure regardless of
// the backing store (SQL returns it in place of sql.ErrNoRows; fakes return it
// directly). Critical on the AMM write path, which upserts absolute values
// (audit COR-03).
var ErrPositionNotFound = errors.New("position not found")

// Repository defines the data access interface for the prediction platform.
// Implementations: sql_repository.go (PostgreSQL), inmemory_repository.go (testing).
type Repository interface {
	// Categories
	ListCategories(ctx context.Context, activeOnly bool) ([]Category, error)
	GetCategory(ctx context.Context, slug string) (*Category, error)
	CreateCategory(ctx context.Context, cat *Category) error

	// Series
	ListSeries(ctx context.Context, categoryID *string) ([]Series, error)
	GetSeries(ctx context.Context, id string) (*Series, error)
	CreateSeries(ctx context.Context, s *Series) error

	// Events
	ListEvents(ctx context.Context, filter EventFilter) ([]Event, int, error)
	GetEvent(ctx context.Context, id string) (*Event, error)
	CreateEvent(ctx context.Context, e *Event) error
	// UpdateEventPresentation sets featured and/or the cover photo. A nil
	// argument leaves that column unchanged; an empty cover clears it.
	UpdateEventPresentation(ctx context.Context, id string, featured *bool, coverImageURL *string) error
	UpdateEventStatus(ctx context.Context, id string, status EventStatus) error

	// Markets
	ListMarkets(ctx context.Context, filter MarketFilter) ([]Market, int, error)
	GetMarket(ctx context.Context, id string) (*Market, error)
	GetMarketByTicker(ctx context.Context, ticker string) (*Market, error)
	CreateMarket(ctx context.Context, m *Market) error
	UpdateMarket(ctx context.Context, m *Market) error
	UpdateMarketStatus(ctx context.Context, id string, status, expectedPrev MarketStatus) error
	ListMarketsToClose(ctx context.Context) ([]Market, error)
	ListMarketsToSettle(ctx context.Context) ([]Market, error)

	// Orders
	ListOrders(ctx context.Context, filter OrderFilter) ([]Order, int, error)
	// ListRestingOrdersOnInactiveMarkets returns up to limit open/partial
	// orders whose market is no longer tradeable (closed/settled/voided).
	// No market-transition path finalizes resting orders, so their RG
	// committed stake + wallet reservation stay counted forever; the
	// expiry sweep uses this to reconcile them (expired-order residual).
	ListRestingOrdersOnInactiveMarkets(ctx context.Context, limit int) ([]Order, error)
	GetOrder(ctx context.Context, id string) (*Order, error)
	GetOrderByIdempotencyKey(ctx context.Context, key string) (*Order, error)
	CreateOrder(ctx context.Context, o *Order) error
	UpdateOrder(ctx context.Context, o *Order) error
	PersistFilledOrder(ctx context.Context, order *Order, trade *Trade, position *Position, market *Market) error

	// Positions
	ListPositions(ctx context.Context, userID string) ([]Position, error)
	GetPosition(ctx context.Context, userID, marketID string, side OrderSide) (*Position, error)
	UpsertPosition(ctx context.Context, p *Position) error
	ListPositionsByMarket(ctx context.Context, marketID string) ([]Position, error)

	// Trades
	ListTrades(ctx context.Context, marketID string, limit int) ([]Trade, error)
	CreateTrade(ctx context.Context, t *Trade) error

	// Settlements
	GetSettlement(ctx context.Context, marketID string) (*Settlement, error)
	CreateSettlement(ctx context.Context, s *Settlement) error
	CreatePayout(ctx context.Context, p *Payout) error

	// Lifecycle events
	ListLifecycleEvents(ctx context.Context, marketID string) ([]LifecycleEvent, error)
	CreateLifecycleEvent(ctx context.Context, e *LifecycleEvent) error

	// AI market drafting (migration 024)
	CreateArticleSource(ctx context.Context, src *ArticleSource) error
	LogAIGeneration(ctx context.Context, entry *AIGenerationLog) error
	LinkAIGenerationLogsToMarket(ctx context.Context, marketID string, logIDs []string, createdBy *string) error
	// AIUsage returns, for one admin since `since`: the number of 'draft'-stage
	// generations (for rate limiting) and the total tokens (for the spend cap).
	AIUsage(ctx context.Context, createdBy string, since time.Time) (draftCount int, totalTokens int64, err error)
	ReserveAIUsage(ctx context.Context, createdBy string, estimatedInputTokens int, ratePerMin int, dailyTokenCap int64, now time.Time) (AIBudgetStatus, error)

	// API Keys
	ListAPIKeys(ctx context.Context, userID string) ([]APIKey, error)
	GetAPIKeyByPrefix(ctx context.Context, prefix string) (*APIKey, error)
	CreateAPIKey(ctx context.Context, k *APIKey) error
	DeactivateAPIKey(ctx context.Context, id string) error
	TouchAPIKeyLastUsed(ctx context.Context, id string) error

	// Portfolio
	GetPortfolioSummary(ctx context.Context, userID string) (*PortfolioSummary, error)
	ListSettledPositions(ctx context.Context, userID string, page, pageSize int) ([]Payout, int, error)

	// Discovery
	GetDiscovery(ctx context.Context) (*DiscoveryResponse, error)

	// Dashboard
	DashboardVolumeStatsSince(ctx context.Context, since time.Time, topMovers int) (*DashboardVolumeStats, error)
}

// AtomicFilledOrderPersister is an optional repository capability for commits
// that can join the wallet debit and prediction fill in one shared SQL
// transaction. SQLRepository implements this in DB mode.
type AtomicFilledOrderPersister interface {
	PersistFilledOrderAtomic(
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
	) error
}

// WalletCreditRequest describes a single wallet credit to apply while
// persisting a settlement or void transition.
type WalletCreditRequest struct {
	UserID         string
	AmountPoints   int64
	IdempotencyKey string
	Reason         string
}

// ExchangeRepository is the optional repository capability surface for the
// binary exchange engine. SQLRepository implements it; in-memory fakes for
// tests may opt in by implementing the same methods. Callers should type-
// assert and degrade gracefully when not present (the AMM-only path doesn't
// need the order book API).
type ExchangeRepository interface {
	// GetOrderBook returns the L2 book for a market — yes/no bids and asks
	// with running totals, depth-capped at MaxOrderBookDepth.
	GetOrderBook(ctx context.Context, marketID string, depth int) (*OrderBook, error)

	// PersistMatchAtomic applies a match plan to the database in a single
	// transaction held under a per-market advisory lock. Trades, order
	// updates, position mutations, ledger entries, and market quote updates
	// all commit together or not at all.
	PersistMatchAtomic(ctx context.Context, walletAdapter ExchangeWalletAdapter, plan *MatchPlan) error

	// LoadMakersForSecondary returns resting opposite-action orders on the
	// same side, ordered by price-time priority. Used by the match engine
	// to find candidates for secondary same-side transfer.
	LoadMakersForSecondary(ctx context.Context, marketID string, takerSide OrderSide, takerAction OrderAction, takerLimit *int, limit int) ([]Order, error)

	// LoadMakersForIssuance returns resting Buy orders on the opposite side
	// whose price plus the taker's limit can mint a complementary pair
	// (sum >= 100). Used by the match engine for issuance.
	LoadMakersForIssuance(ctx context.Context, marketID string, otherSide OrderSide, takerLimit int, limit int) ([]Order, error)

	// RefreshMarketBestQuotes recomputes the market's top-of-book columns
	// from the current open-order partial indexes. Called after a match
	// commits so `market:<id>` subscribers see updated bid/ask without
	// re-aggregating client-side.
	RefreshMarketBestQuotes(ctx context.Context, marketID string) error

	// ReconcileMarket runs a two-phase collateral invariant check for a
	// market. Phase 1 reads without a lock; Phase 2 only runs if Phase 1
	// suspects drift, takes the per-market advisory lock briefly, and
	// writes a forensic ledger entry. See reconciliation.go for details.
	ReconcileMarket(ctx context.Context, marketID string) (*CollateralDriftReport, error)

	// ListRecentDriftAlerts returns markets that had collateral
	// `adjustment` ledger entries written since `since`. One row per
	// market; aggregates count, max drift, total drift, and most recent
	// adjustment timestamp. Used by the backoffice ops page to surface
	// markets needing investigation.
	ListRecentDriftAlerts(ctx context.Context, since time.Time) ([]CollateralDriftAlert, error)
}

// RestingOrderFinalizer is the repository capability for atomically moving a
// resting exchange order to a terminal state while releasing its wallet point
// reservation and any sell-side share reservation in the same transaction.
type RestingOrderFinalizer interface {
	FinalizeRestingOrderAtomic(
		ctx context.Context,
		walletAdapter ExchangeWalletAdapter,
		order *Order,
		terminal OrderStatus,
	) (reservedPoints int64, capturedPoints int64, placedAt time.Time, err error)
}

// AtomicMarketSettlementPersister is an optional repository capability for
// market settlement/void flows that need wallet credits and prediction writes
// to commit together.
//
// loyalty + accruals are optional — passing nil/empty disables loyalty
// accrual in the settlement flow (test fakes + legacy callers stay unchanged).
// The persister returns per-accrual results so the caller can fire
// post-commit WebSocket events (e.g. TierPromoted) after a successful tx.
type AtomicMarketSettlementPersister interface {
	// prevStatus is the market status the engine validated before computing
	// payouts/refunds. Implementations MUST re-assert it atomically inside
	// the transaction (status-guarded UPDATE) and return ErrStaleMarketStatus
	// — rolling back everything — when it no longer holds, so concurrent
	// settle/void flows can never both commit (audit COR-01).
	PersistResolvedMarketAtomic(
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
	) ([]LoyaltyAccrualResult, error)
	PersistVoidedMarketAtomic(
		ctx context.Context,
		wallet WalletAdapter,
		market *Market,
		prevStatus MarketStatus,
		payouts []Payout,
		credits []WalletCreditRequest,
		lifecycle *LifecycleEvent,
	) error
}

// BatchedMarketSettlementPersister is an optional repository capability that
// settles a market WITHOUT holding every wallet row lock in one transaction
// (audit COR-05). Settlement is split into a fast header commit plus N
// idempotent payout batches, tracked by a resume cursor (migration 034), so a
// crash or error mid-settlement is finished by ResumeIncompleteSettlements
// rather than leaving winners unpaid or the whole settlement rolled back.
//
// Every batch is idempotent — uq_payout_settlement_position + ON CONFLICT, the
// `quantity > 0` close guard, and the wallet/loyalty idempotency keys — so a
// re-applied batch can never double-pay. A repository that does not implement
// this interface falls back to the single-transaction atomic persister.
type BatchedMarketSettlementPersister interface {
	// PersistSettlementHeader commits the status-guarded transition (COR-01),
	// the settlement row (with the payouts_total snapshot), and the lifecycle
	// event in one fast transaction. prevStatus is re-asserted atomically; a
	// stale value returns ErrStaleMarketStatus and writes nothing. After it
	// returns the market is `settled`.
	PersistSettlementHeader(ctx context.Context, market *Market, prevStatus MarketStatus, settlement *Settlement, lifecycle *LifecycleEvent) error

	// CommitPayoutBatch writes one chunk of positions' payouts, position
	// closes, wallet credits, and loyalty accruals, then advances
	// payouts_completed by len(payouts) — all in one transaction.
	// payouts[i]/credits[i]/accruals[i] describe the same position; credits[i]
	// is nil for losers and accruals[i] is nil when loyalty is disabled.
	CommitPayoutBatch(ctx context.Context, wallet WalletAdapter, settlementID string, payouts []Payout, credits []*WalletCreditRequest, loyalty LoyaltyAdapter, accruals []*LoyaltyAccrualRequest) ([]LoyaltyAccrualResult, error)

	// ListUnpaidSettlementPositions returns up to `limit` positions for the
	// market that still have no payout row for this settlement and a positive
	// quantity, in a stable id order. Drives the resume scanner.
	ListUnpaidSettlementPositions(ctx context.Context, settlementID, marketID string, limit int) ([]Position, error)

	// ListIncompleteSettlements returns up to `limit` settlements whose
	// disbursement did not finish (payouts_completed < payouts_total), oldest
	// first, for the resume scanner.
	ListIncompleteSettlements(ctx context.Context, limit int) ([]Settlement, error)
}

// MarketJurisdictionStore is an optional repository capability for the
// per-market jurisdiction overlay (P3-07). Repositories that don't implement it
// (in-memory fakes) simply have no overlay — the global geo gate still applies.
type MarketJurisdictionStore interface {
	// GetMarketJurisdictionPolicy returns the market's parsed overlay, or
	// (nil, nil) when the market has no policy or does not exist (the caller's
	// downstream market load produces the canonical not-found error).
	GetMarketJurisdictionPolicy(ctx context.Context, marketID string) (*MarketJurisdictionPolicy, error)
	// SetMarketJurisdictionPolicy writes (or clears, when policy is nil) the
	// overlay for a market.
	SetMarketJurisdictionPolicy(ctx context.Context, marketID string, policy *MarketJurisdictionPolicy) error
}

// AtomicProposalPersister is an optional repository capability (ADR-0003/0004)
// that records a resolution proposal AND the closed -> proposed_resolution
// market transition (plus the lifecycle event) in ONE transaction. Without it a
// crash between the proposal insert and the market update strands a proposal on
// a still-closed market — and the proposals' UNIQUE(market_id) makes that
// orphan unrecoverable (no re-propose), so the windowed flow could later settle
// a market that never visibly entered the challenge window. The guarded market
// UPDATE (status='closed') also serializes a double-propose. Callers without
// this capability (in-memory test repos) fall back to the non-atomic path.
type AtomicProposalPersister interface {
	PersistProposalAtomic(ctx context.Context, proposal *ResolutionProposal, lifecycle *LifecycleEvent) error
}

// EventFilter provides filtering options for listing events.
type EventFilter struct {
	CategoryID *string
	Status     *EventStatus
	Featured   *bool
	SeriesID   *string
	Page       int
	PageSize   int
}

// MarketFilter provides filtering options for listing markets.
type MarketFilter struct {
	EventID     *string
	SeriesID    *string
	CategoryID  *string
	Status      *MarketStatus
	Ticker      *string
	Search      *string
	Tag         *string
	CloseBefore *time.Time
	// IDs restricts results to an explicit market-id set (batched hydration:
	// e.g. the portfolio page resolving position/order market ids in one
	// query instead of N GetMarket round-trips). Empty means no restriction.
	// Composes WITH the safe-by-default gates below — an ids lookup still
	// excludes `unopened` and launch-scrubbed markets unless opted in.
	IDs      []string
	Sort     string
	Page     int
	PageSize int
	// IncludeUnopened opts IN to returning markets in the pre-publication
	// `unopened` state. Default false: list queries exclude `unopened` so a
	// not-yet-approved market (e.g. an AI draft awaiting admin review) is never
	// exposed on player-facing endpoints. Only admin-authenticated callers set
	// this true. Safe-by-default — a caller that forgets it cannot leak drafts.
	IncludeUnopened bool
	// IncludeLaunchScrubbed opts IN to returning markets whose title trips the
	// launch-safety scrub (the payload layer would replace it with the
	// "Removed by points-only safety boundary." sentinel). Default false:
	// public list queries exclude them — a market with no usable title is not
	// listable content. Admin/back-office views, workers, and ops tooling set
	// this true; scrubbed markets also stay fetchable by direct id/ticker for
	// audit, which never goes through this filter.
	IncludeLaunchScrubbed bool
}

// OrderFilter provides filtering options for listing orders.
type OrderFilter struct {
	UserID   string
	MarketID *string
	Status   *OrderStatus
	Page     int
	PageSize int
}
