package prediction

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
	"time"
)

// fakeWallet is a test-only WalletAdapter that records calls and tracks balances.
type fakeWallet struct {
	balances    map[string]int64
	debitCalls  []walletCall
	creditCalls []walletCall
	debitErr    error
}

type walletCall struct {
	userID       string
	amountPoints int64
	idempKey     string
	reason       string
}

func newFakeWallet(initialBalance int64) *fakeWallet {
	return &fakeWallet{balances: map[string]int64{"user1": initialBalance}}
}

func (f *fakeWallet) Debit(_ context.Context, userID string, amountPoints int64, idempotencyKey, reason string) error {
	if f.debitErr != nil {
		return f.debitErr
	}
	if f.balances[userID] < amountPoints {
		return fmt.Errorf("insufficient balance")
	}
	f.balances[userID] -= amountPoints
	f.debitCalls = append(f.debitCalls, walletCall{userID, amountPoints, idempotencyKey, reason})
	return nil
}

func (f *fakeWallet) Credit(_ context.Context, userID string, amountPoints int64, idempotencyKey, reason string) error {
	f.balances[userID] += amountPoints
	f.creditCalls = append(f.creditCalls, walletCall{userID, amountPoints, idempotencyKey, reason})
	return nil
}

func (f *fakeWallet) Balance(_ context.Context, userID string) int64 { return f.balances[userID] }

// memRepo is a minimal in-memory Repository for wiring tests. It only supports
// the subset of methods exercised by the tests below.
type memRepo struct {
	markets           map[string]*Market
	orders            map[string]*Order
	positions         map[string]*Position
	trades            []Trade
	persistCalls      int
	createOrderErr    error
	createTradeErr    error
	upsertPositionErr error
	updateMarketErr   error
	settlement        map[string]*Settlement
	payouts           []Payout
	lifecycle         []LifecycleEvent
}

func newMemRepo() *memRepo {
	return &memRepo{
		markets:    make(map[string]*Market),
		orders:     make(map[string]*Order),
		positions:  make(map[string]*Position),
		settlement: make(map[string]*Settlement),
	}
}

// Repository methods — only the ones PlaceOrder + ResolveMarket actually use.
func (r *memRepo) GetMarket(ctx context.Context, id string) (*Market, error) {
	m, ok := r.markets[id]
	if !ok {
		return nil, fmt.Errorf("market not found")
	}
	return cloneMarket(m), nil
}
func (r *memRepo) GetOrderByIdempotencyKey(ctx context.Context, k string) (*Order, error) {
	for _, o := range r.orders {
		if o.IdempotencyKey != nil && *o.IdempotencyKey == k {
			return o, nil
		}
	}
	return nil, fmt.Errorf("not found")
}
func (r *memRepo) CreateOrder(ctx context.Context, o *Order) error {
	if r.createOrderErr != nil {
		return r.createOrderErr
	}
	o.ID = fmt.Sprintf("ord-%d", len(r.orders)+1)
	r.orders[o.ID] = cloneOrder(o)
	return nil
}
func (r *memRepo) CreateTrade(ctx context.Context, t *Trade) error {
	if r.createTradeErr != nil {
		return r.createTradeErr
	}
	t.ID = fmt.Sprintf("trd-%d", len(r.trades)+1)
	r.trades = append(r.trades, *cloneTrade(t))
	return nil
}
func (r *memRepo) GetPosition(ctx context.Context, userID, marketID string, side OrderSide) (*Position, error) {
	key := userID + ":" + marketID + ":" + string(side)
	if p, ok := r.positions[key]; ok {
		return clonePosition(p), nil
	}
	return nil, ErrPositionNotFound
}
func (r *memRepo) UpsertPosition(ctx context.Context, p *Position) error {
	if r.upsertPositionErr != nil {
		return r.upsertPositionErr
	}
	key := p.UserID + ":" + p.MarketID + ":" + string(p.Side)
	if p.ID == "" {
		p.ID = fmt.Sprintf("pos-%d", len(r.positions)+1)
	}
	r.positions[key] = clonePosition(p)
	return nil
}
func (r *memRepo) UpdateMarket(ctx context.Context, m *Market) error {
	if r.updateMarketErr != nil {
		return r.updateMarketErr
	}
	r.markets[m.ID] = cloneMarket(m)
	return nil
}
func (r *memRepo) PersistFilledOrder(ctx context.Context, o *Order, t *Trade, p *Position, m *Market) error {
	r.persistCalls++
	orders := make(map[string]*Order, len(r.orders))
	for key, value := range r.orders {
		orders[key] = cloneOrder(value)
	}
	positions := make(map[string]*Position, len(r.positions))
	for key, value := range r.positions {
		positions[key] = clonePosition(value)
	}
	markets := make(map[string]*Market, len(r.markets))
	for key, value := range r.markets {
		markets[key] = cloneMarket(value)
	}
	trades := append([]Trade(nil), r.trades...)

	if r.createOrderErr != nil {
		return r.createOrderErr
	}
	order := cloneOrder(o)
	order.ID = fmt.Sprintf("ord-%d", len(r.orders)+1)
	orders[order.ID] = order

	if r.createTradeErr != nil {
		return r.createTradeErr
	}
	trade := cloneTrade(t)
	trade.ID = fmt.Sprintf("trd-%d", len(r.trades)+1)
	trades = append(trades, *trade)

	if r.upsertPositionErr != nil {
		return r.upsertPositionErr
	}
	position := clonePosition(p)
	if position.ID == "" {
		position.ID = fmt.Sprintf("pos-%d", len(r.positions)+1)
	}
	positions[position.UserID+":"+position.MarketID+":"+string(position.Side)] = position

	if r.updateMarketErr != nil {
		return r.updateMarketErr
	}
	markets[m.ID] = cloneMarket(m)

	r.orders = orders
	r.positions = positions
	r.trades = trades
	r.markets = markets

	*o = *cloneOrder(order)
	*t = *cloneTrade(trade)
	*p = *clonePosition(position)
	return nil
}

type atomicMemRepo struct {
	*memRepo
	atomicOrderCalls      int
	atomicSettlementCalls int
	atomicVoidCalls       int
	atomicAccrualCalls    int
	atomicErr             error
}

func (r *atomicMemRepo) PersistFilledOrderAtomic(
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
	r.atomicOrderCalls++
	if r.atomicErr != nil {
		return r.atomicErr
	}
	if err := wallet.Debit(context.Background(), userID, totalCost, debitKey, debitReason); err != nil {
		return err
	}
	return r.memRepo.PersistFilledOrder(ctx, order, trade, position, market)
}

func (r *atomicMemRepo) PersistResolvedMarketAtomic(
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
	r.atomicSettlementCalls++
	if r.atomicErr != nil {
		return nil, r.atomicErr
	}
	// Mirror the SQL persister's status guard (COR-01): the stored market
	// must still be in the status the engine validated.
	if stored, err := r.memRepo.GetMarket(ctx, market.ID); err == nil && stored.Status != prevStatus {
		return nil, ErrStaleMarketStatus
	}
	if err := r.memRepo.CreateSettlement(ctx, settlement); err != nil {
		return nil, err
	}
	for i := range payouts {
		payouts[i].SettlementID = settlement.ID
		if err := r.memRepo.CreatePayout(ctx, &payouts[i]); err != nil {
			return nil, err
		}
		for _, pos := range r.memRepo.positions {
			if pos.ID == payouts[i].PositionID {
				pos.Quantity = 0
				pos.RealizedPnlPoints += payouts[i].PnlPoints
				break
			}
		}
	}
	for _, credit := range credits {
		if err := wallet.Credit(context.Background(), credit.UserID, credit.AmountPoints, credit.IdempotencyKey, credit.Reason); err != nil {
			return nil, err
		}
	}
	// In-memory fake doesn't share a tx; the real loyalty path is exercised by
	// SQLRepository integration tests. Record the accruals count so callers can
	// assert they were forwarded.
	if loyalty != nil {
		r.atomicAccrualCalls += len(accruals)
	}
	if err := r.memRepo.UpdateMarket(ctx, market); err != nil {
		return nil, err
	}
	if lifecycle != nil {
		if err := r.memRepo.CreateLifecycleEvent(ctx, lifecycle); err != nil {
			return nil, err
		}
	}
	return nil, nil
}

func (r *atomicMemRepo) PersistVoidedMarketAtomic(
	ctx context.Context,
	wallet WalletAdapter,
	market *Market,
	prevStatus MarketStatus,
	payouts []Payout,
	credits []WalletCreditRequest,
	lifecycle *LifecycleEvent,
) error {
	r.atomicVoidCalls++
	if r.atomicErr != nil {
		return r.atomicErr
	}
	// Mirror the SQL persister's status guard (COR-01).
	if stored, err := r.memRepo.GetMarket(ctx, market.ID); err == nil && stored.Status != prevStatus {
		return ErrStaleMarketStatus
	}
	if err := r.memRepo.UpdateMarket(ctx, market); err != nil {
		return err
	}
	for _, credit := range credits {
		if err := wallet.Credit(context.Background(), credit.UserID, credit.AmountPoints, credit.IdempotencyKey, credit.Reason); err != nil {
			return err
		}
	}
	if lifecycle != nil {
		if err := r.memRepo.CreateLifecycleEvent(ctx, lifecycle); err != nil {
			return err
		}
	}
	return nil
}
func (r *memRepo) ListPositionsByMarket(ctx context.Context, marketID string) ([]Position, error) {
	var out []Position
	for _, p := range r.positions {
		if p.MarketID == marketID {
			out = append(out, *p)
		}
	}
	return out, nil
}
func (r *memRepo) CreateSettlement(ctx context.Context, s *Settlement) error {
	s.ID = fmt.Sprintf("stl-%d", len(r.settlement)+1)
	r.settlement[s.MarketID] = s
	return nil
}
func (r *memRepo) CreatePayout(ctx context.Context, p *Payout) error {
	p.ID = fmt.Sprintf("pay-%d", len(r.payouts)+1)
	r.payouts = append(r.payouts, *p)
	return nil
}
func (r *memRepo) CreateLifecycleEvent(ctx context.Context, e *LifecycleEvent) error {
	r.lifecycle = append(r.lifecycle, *e)
	return nil
}

// Unused but required to satisfy Repository interface — return empty/nil.
func (r *memRepo) ListCategories(context.Context, bool) ([]Category, error)      { return nil, nil }
func (r *memRepo) GetCategory(context.Context, string) (*Category, error)        { return nil, nil }
func (r *memRepo) CreateCategory(context.Context, *Category) error               { return nil }
func (r *memRepo) ListSeries(context.Context, *string) ([]Series, error)         { return nil, nil }
func (r *memRepo) GetSeries(context.Context, string) (*Series, error)            { return nil, nil }
func (r *memRepo) CreateSeries(context.Context, *Series) error                   { return nil }
func (r *memRepo) ListEvents(context.Context, EventFilter) ([]Event, int, error) { return nil, 0, nil }
func (r *memRepo) GetEvent(context.Context, string) (*Event, error)              { return nil, nil }
func (r *memRepo) CreateEvent(context.Context, *Event) error                     { return nil }
func (r *memRepo) UpdateEventPresentation(context.Context, string, *bool, *string) error {
	return nil
}
func (r *memRepo) UpdateEventStatus(context.Context, string, EventStatus) error { return nil }
func (r *memRepo) ListMarkets(context.Context, MarketFilter) ([]Market, int, error) {
	return nil, 0, nil
}
func (r *memRepo) AIUsage(context.Context, string, time.Time) (int, int64, error) {
	return 0, 0, nil
}
func (r *memRepo) ReserveAIUsage(context.Context, string, int, int, int64, time.Time) (AIBudgetStatus, error) {
	return AIBudgetStatus{Allowed: true}, nil
}
func (r *memRepo) CreateArticleSource(context.Context, *ArticleSource) error { return nil }
func (r *memRepo) LogAIGeneration(context.Context, *AIGenerationLog) error   { return nil }
func (r *memRepo) LinkAIGenerationLogsToMarket(context.Context, string, []string, *string) error {
	return nil
}
func (r *memRepo) GetMarketByTicker(context.Context, string) (*Market, error) { return nil, nil }
func (r *memRepo) CreateMarket(context.Context, *Market) error                { return nil }
func (r *memRepo) UpdateMarketStatus(context.Context, string, MarketStatus, MarketStatus) error {
	return nil
}
func (r *memRepo) ListMarketsToClose(context.Context) ([]Market, error)  { return nil, nil }
func (r *memRepo) ListMarketsToSettle(context.Context) ([]Market, error) { return nil, nil }
func (r *memRepo) ListRestingOrdersOnInactiveMarkets(context.Context, int) ([]Order, error) {
	return nil, nil
}
func (r *memRepo) ListOrders(context.Context, OrderFilter) ([]Order, int, error) { return nil, 0, nil }
func (r *memRepo) GetOrder(context.Context, string) (*Order, error)              { return nil, nil }
func (r *memRepo) UpdateOrder(context.Context, *Order) error                     { return nil }
func (r *memRepo) ListPositions(context.Context, string) ([]Position, error)     { return nil, nil }
func (r *memRepo) ListTrades(context.Context, string, int) ([]Trade, error)      { return nil, nil }
func (r *memRepo) GetSettlement(context.Context, string) (*Settlement, error)    { return nil, nil }
func (r *memRepo) ListLifecycleEvents(context.Context, string) ([]LifecycleEvent, error) {
	return nil, nil
}
func (r *memRepo) ListAPIKeys(context.Context, string) ([]APIKey, error)      { return nil, nil }
func (r *memRepo) GetAPIKeyByPrefix(context.Context, string) (*APIKey, error) { return nil, nil }
func (r *memRepo) CreateAPIKey(context.Context, *APIKey) error                { return nil }
func (r *memRepo) DeactivateAPIKey(context.Context, string) error             { return nil }
func (r *memRepo) TouchAPIKeyLastUsed(context.Context, string) error          { return nil }
func (r *memRepo) GetPortfolioSummary(context.Context, string) (*PortfolioSummary, error) {
	return nil, nil
}
func (r *memRepo) ListSettledPositions(context.Context, string, int, int) ([]Payout, int, error) {
	return nil, 0, nil
}
func (r *memRepo) GetDiscovery(context.Context) (*DiscoveryResponse, error) { return nil, nil }
func (r *memRepo) DashboardVolumeStatsSince(context.Context, time.Time, int) (*DashboardVolumeStats, error) {
	return nil, nil
}

func cloneOrder(o *Order) *Order {
	if o == nil {
		return nil
	}
	copy := *o
	if o.PricePoints != nil {
		value := *o.PricePoints
		copy.PricePoints = &value
	}
	if o.WalletReservationID != nil {
		value := *o.WalletReservationID
		copy.WalletReservationID = &value
	}
	if o.IdempotencyKey != nil {
		value := *o.IdempotencyKey
		copy.IdempotencyKey = &value
	}
	if o.ExpiresAt != nil {
		value := *o.ExpiresAt
		copy.ExpiresAt = &value
	}
	if o.FilledAt != nil {
		value := *o.FilledAt
		copy.FilledAt = &value
	}
	if o.CancelledAt != nil {
		value := *o.CancelledAt
		copy.CancelledAt = &value
	}
	return &copy
}

func cloneTrade(t *Trade) *Trade {
	if t == nil {
		return nil
	}
	copy := *t
	if t.BuyOrderID != nil {
		value := *t.BuyOrderID
		copy.BuyOrderID = &value
	}
	if t.SellOrderID != nil {
		value := *t.SellOrderID
		copy.SellOrderID = &value
	}
	if t.SellerID != nil {
		value := *t.SellerID
		copy.SellerID = &value
	}
	return &copy
}

func clonePosition(p *Position) *Position {
	if p == nil {
		return nil
	}
	copy := *p
	return &copy
}

func cloneMarket(m *Market) *Market {
	if m == nil {
		return nil
	}
	copy := *m
	if m.Result != nil {
		value := *m.Result
		copy.Result = &value
	}
	if m.LastTradePricePoints != nil {
		value := *m.LastTradePricePoints
		copy.LastTradePricePoints = &value
	}
	if m.SettlementCutoffAt != nil {
		value := *m.SettlementCutoffAt
		copy.SettlementCutoffAt = &value
	}
	if m.FallbackSourceKey != nil {
		value := *m.FallbackSourceKey
		copy.FallbackSourceKey = &value
	}
	if m.OpenAt != nil {
		value := *m.OpenAt
		copy.OpenAt = &value
	}
	return &copy
}

// --- Tests ---

func seedMarket(t *testing.T, repo *memRepo) *Market {
	t.Helper()
	m := &Market{
		ID:                "mkt-1",
		Ticker:            "TEST-YES",
		Status:            MarketStatusOpen,
		YesPricePoints:    50,
		NoPricePoints:     50,
		AMMYesShares:      0,
		AMMNoShares:       0,
		AMMLiquidityParam: 100,
		FeeRateBps:        0,
		CloseAt:           time.Now().Add(24 * time.Hour),
	}
	repo.markets[m.ID] = m
	return m
}

type fakeTxWallet struct {
	*fakeWallet
}

func (f *fakeTxWallet) BeginTx(context.Context) (*sql.Tx, error) { return nil, nil }
func (f *fakeTxWallet) DebitWithTx(ctx context.Context, tx *sql.Tx, userID string, amountPoints int64, idempotencyKey, reason string) error {
	return f.Debit(ctx, userID, amountPoints, idempotencyKey, reason)
}
func (f *fakeTxWallet) CreditWithTx(ctx context.Context, tx *sql.Tx, userID string, amountPoints int64, idempotencyKey, reason string) error {
	return f.Credit(ctx, userID, amountPoints, idempotencyKey, reason)
}

// TestPlaceOrder_ZeroBalance_Rejected guards against a regression where the
// balance check was skipped when balance == 0, letting users with empty
// wallets place orders that would only fail later at debit time.
// TestPlaceOrder_NoopWallet_AllowsAnyBalance ensures the NoopWallet sentinel
// (math.MaxInt64 from Balance) short-circuits the pre-check, so tests that
// don't care about wallet behavior can still exercise trading paths.
func TestResolveMarket_CreditsWinnersOnly(t *testing.T) {
	repo := newMemRepo()
	m := seedMarket(t, repo)
	m.Status = MarketStatusClosed // must be closed to settle

	// Two users: alice bet YES (winner), bob bet NO (loser)
	repo.positions["alice:mkt-1:yes"] = &Position{
		ID: "pos-alice", UserID: "alice", MarketID: "mkt-1", Side: OrderSideYes,
		Quantity: 20, AvgPricePoints: 50, TotalCostPoints: 1000,
	}
	repo.positions["bob:mkt-1:no"] = &Position{
		ID: "pos-bob", UserID: "bob", MarketID: "mkt-1", Side: OrderSideNo,
		Quantity: 15, AvgPricePoints: 50, TotalCostPoints: 750,
	}

	wallet := &fakeWallet{balances: map[string]int64{"alice": 0, "bob": 0}}
	svc := NewService(repo, wallet)

	_, payouts, err := svc.ResolveMarket(context.Background(), "mkt-1", ResolveMarketRequest{
		Result:            MarketResultYes,
		AttestationSource: "admin",
	}, nil)
	if err != nil {
		t.Fatalf("ResolveMarket failed: %v", err)
	}
	if len(payouts) != 2 {
		t.Fatalf("expected 2 payouts, got %d", len(payouts))
	}

	// Only the winner (alice) should get a credit
	if len(wallet.creditCalls) != 1 {
		t.Fatalf("expected 1 credit (winner only), got %d", len(wallet.creditCalls))
	}
	if wallet.creditCalls[0].userID != "alice" {
		t.Errorf("expected alice to be credited, got %s", wallet.creditCalls[0].userID)
	}
	// Alice had 20 YES contracts, each pays 100¢ = 2000 cents
	if wallet.creditCalls[0].amountPoints != 2000 {
		t.Errorf("expected 2000¢ payout, got %d", wallet.creditCalls[0].amountPoints)
	}
	if wallet.balances["alice"] != 2000 {
		t.Errorf("alice balance: expected 2000, got %d", wallet.balances["alice"])
	}
	if wallet.balances["bob"] != 0 {
		t.Errorf("bob (loser) balance should be 0, got %d", wallet.balances["bob"])
	}
}

func TestResolveMarket_UsesAtomicSettlementWhenAvailable(t *testing.T) {
	repo := &atomicMemRepo{memRepo: newMemRepo()}
	m := seedMarket(t, repo.memRepo)
	m.Status = MarketStatusClosed

	repo.positions["alice:mkt-1:yes"] = &Position{
		ID: "pos-alice", UserID: "alice", MarketID: "mkt-1", Side: OrderSideYes,
		Quantity: 20, AvgPricePoints: 50, TotalCostPoints: 1000,
	}
	repo.positions["bob:mkt-1:no"] = &Position{
		ID: "pos-bob", UserID: "bob", MarketID: "mkt-1", Side: OrderSideNo,
		Quantity: 15, AvgPricePoints: 50, TotalCostPoints: 750,
	}

	wallet := &fakeTxWallet{fakeWallet: &fakeWallet{balances: map[string]int64{"alice": 0, "bob": 0}}}
	svc := NewService(repo, wallet)

	settlement, payouts, err := svc.ResolveMarket(context.Background(), "mkt-1", ResolveMarketRequest{
		Result:            MarketResultYes,
		AttestationSource: "admin",
	}, nil)
	if err != nil {
		t.Fatalf("ResolveMarket failed: %v", err)
	}
	if settlement == nil || len(payouts) != 2 {
		t.Fatalf("expected settlement and 2 payouts, got settlement=%v payouts=%d", settlement != nil, len(payouts))
	}
	if repo.atomicSettlementCalls != 1 {
		t.Fatalf("expected one atomic settlement call, got %d", repo.atomicSettlementCalls)
	}
	if len(wallet.creditCalls) != 1 || wallet.creditCalls[0].userID != "alice" {
		t.Fatalf("expected one winner credit for alice, got %+v", wallet.creditCalls)
	}
}

// Regression: atomic settlement must zero out position quantity and credit
// the realized pnl onto the position row. Without this the portfolio summary
// keeps alice's already-settled holdings in "open positions" / "invested".
func TestResolveMarket_AtomicSettlement_ZerosPositions(t *testing.T) {
	repo := &atomicMemRepo{memRepo: newMemRepo()}
	m := seedMarket(t, repo.memRepo)
	m.Status = MarketStatusClosed

	repo.positions["alice:mkt-1:yes"] = &Position{
		ID: "pos-alice", UserID: "alice", MarketID: "mkt-1", Side: OrderSideYes,
		Quantity: 20, AvgPricePoints: 50, TotalCostPoints: 1000,
	}
	repo.positions["bob:mkt-1:no"] = &Position{
		ID: "pos-bob", UserID: "bob", MarketID: "mkt-1", Side: OrderSideNo,
		Quantity: 15, AvgPricePoints: 50, TotalCostPoints: 750,
	}

	wallet := &fakeTxWallet{fakeWallet: &fakeWallet{balances: map[string]int64{"alice": 0, "bob": 0}}}
	svc := NewService(repo, wallet)

	if _, _, err := svc.ResolveMarket(context.Background(), "mkt-1", ResolveMarketRequest{
		Result:            MarketResultYes,
		AttestationSource: "admin",
	}, nil); err != nil {
		t.Fatalf("ResolveMarket failed: %v", err)
	}

	alice := repo.positions["alice:mkt-1:yes"]
	if alice.Quantity != 0 {
		t.Errorf("winner alice: expected quantity=0 after settle, got %d", alice.Quantity)
	}
	// alice bought 20 @ 50¢ = 1000¢ cost, YES won → payout 2000¢, pnl 1000¢.
	if alice.RealizedPnlPoints != 1000 {
		t.Errorf("winner alice: expected realized_pnl=1000, got %d", alice.RealizedPnlPoints)
	}

	bob := repo.positions["bob:mkt-1:no"]
	if bob.Quantity != 0 {
		t.Errorf("loser bob: expected quantity=0 after settle, got %d", bob.Quantity)
	}
	// bob bought 15 @ 50¢ = 750¢ cost, NO lost → payout 0, pnl -750¢.
	if bob.RealizedPnlPoints != -750 {
		t.Errorf("loser bob: expected realized_pnl=-750, got %d", bob.RealizedPnlPoints)
	}
}

func TestVoidMarket_RefundsAllPositions(t *testing.T) {
	repo := newMemRepo()
	m := seedMarket(t, repo)
	m.Status = MarketStatusOpen

	repo.positions["alice:mkt-1:yes"] = &Position{
		ID: "pos-alice", UserID: "alice", MarketID: "mkt-1", Side: OrderSideYes,
		Quantity: 20, AvgPricePoints: 50, TotalCostPoints: 1000,
	}
	repo.positions["bob:mkt-1:no"] = &Position{
		ID: "pos-bob", UserID: "bob", MarketID: "mkt-1", Side: OrderSideNo,
		Quantity: 15, AvgPricePoints: 50, TotalCostPoints: 750,
	}

	wallet := &fakeWallet{balances: map[string]int64{"alice": 0, "bob": 0}}
	svc := NewService(repo, wallet)

	payouts, err := svc.VoidMarket(context.Background(), "mkt-1", "source unavailable", nil)
	if err != nil {
		t.Fatalf("VoidMarket failed: %v", err)
	}
	if len(payouts) != 2 {
		t.Fatalf("expected 2 refund payouts, got %d", len(payouts))
	}
	if len(wallet.creditCalls) != 2 {
		t.Fatalf("expected 2 refund credits (both users), got %d", len(wallet.creditCalls))
	}
	if wallet.balances["alice"] != 1000 {
		t.Errorf("alice refund: expected 1000, got %d", wallet.balances["alice"])
	}
	if wallet.balances["bob"] != 750 {
		t.Errorf("bob refund: expected 750, got %d", wallet.balances["bob"])
	}
}

func TestVoidMarket_UsesAtomicVoidWhenAvailable(t *testing.T) {
	repo := &atomicMemRepo{memRepo: newMemRepo()}
	m := seedMarket(t, repo.memRepo)
	m.Status = MarketStatusOpen

	repo.positions["alice:mkt-1:yes"] = &Position{
		ID: "pos-alice", UserID: "alice", MarketID: "mkt-1", Side: OrderSideYes,
		Quantity: 20, AvgPricePoints: 50, TotalCostPoints: 1000,
	}
	repo.positions["bob:mkt-1:no"] = &Position{
		ID: "pos-bob", UserID: "bob", MarketID: "mkt-1", Side: OrderSideNo,
		Quantity: 15, AvgPricePoints: 50, TotalCostPoints: 750,
	}

	wallet := &fakeTxWallet{fakeWallet: &fakeWallet{balances: map[string]int64{"alice": 0, "bob": 0}}}
	svc := NewService(repo, wallet)

	payouts, err := svc.VoidMarket(context.Background(), "mkt-1", "source unavailable", nil)
	if err != nil {
		t.Fatalf("VoidMarket failed: %v", err)
	}
	if len(payouts) != 2 {
		t.Fatalf("expected 2 payouts, got %d", len(payouts))
	}
	if repo.atomicVoidCalls != 1 {
		t.Fatalf("expected one atomic void call, got %d", repo.atomicVoidCalls)
	}
	if len(wallet.creditCalls) != 2 {
		t.Fatalf("expected 2 refund credits from atomic void path, got %d", len(wallet.creditCalls))
	}
}

// TestPlaceOrder_AMMMarketRetired_Rejected guards the P2-09 AMM retirement: a
// non-order_book market refuses new orders with no wallet debit. Read-only
// previews remain available for honest liquidity/impact display.
func TestPlaceOrder_AMMMarketRetired_Rejected(t *testing.T) {
	repo := newMemRepo()
	seedMarket(t, repo) // ExecutionMode defaults to "" (not order_book)
	wallet := newFakeWallet(10000)
	svc := NewService(repo, wallet)

	_, _, err := svc.PlaceOrder(context.Background(), PlaceOrderRequest{
		MarketID:  "mkt-1",
		Side:      OrderSideYes,
		Action:    OrderActionBuy,
		OrderType: OrderTypeMarket,
		Quantity:  10,
	}, "user1")
	if err == nil {
		t.Fatal("expected a retired AMM market to reject new orders")
	}
	if len(wallet.debitCalls) != 0 {
		t.Fatalf("no wallet debit should occur on a retired AMM market, got %d", len(wallet.debitCalls))
	}

	preview, perr := svc.PreviewOrder(context.Background(), PlaceOrderRequest{
		MarketID:  "mkt-1",
		Side:      OrderSideYes,
		Action:    OrderActionBuy,
		OrderType: OrderTypeMarket,
		Quantity:  10,
	})
	if perr != nil {
		t.Fatalf("expected retired AMM preview to stay read-only, got %v", perr)
	}
	if preview.ExecutionMode != ExecutionModeAMM || preview.FilledQuantity != 10 {
		t.Fatalf("preview = mode %q filled %d, want AMM filled 10", preview.ExecutionMode, preview.FilledQuantity)
	}
}

type exchangeMemRepo struct {
	*memRepo
	secondaryMakers []Order
	issuanceMakers  []Order
	persistPlans    []*MatchPlan
	refreshCalls    int
}

func newExchangeMemRepo() *exchangeMemRepo {
	return &exchangeMemRepo{memRepo: newMemRepo()}
}

func (r *exchangeMemRepo) GetOrder(_ context.Context, id string) (*Order, error) {
	order := r.orders[id]
	if order == nil {
		return nil, fmt.Errorf("order not found")
	}
	return cloneOrder(order), nil
}

func (r *exchangeMemRepo) GetOrderBook(context.Context, string, int) (*OrderBook, error) {
	return &OrderBook{}, nil
}

func (r *exchangeMemRepo) PersistMatchAtomic(ctx context.Context, wallet ExchangeWalletAdapter, plan *MatchPlan) error {
	if plan.HoldReservation != nil {
		h := plan.HoldReservation
		if err := wallet.HoldWithTx(ctx, nil, h.UserID, h.AmountPoints, h.Type, h.ID, h.ExpiresIn); err != nil {
			return err
		}
	}
	for _, capture := range plan.CaptureReservations {
		if err := wallet.CaptureReservationWithTx(ctx, nil, capture.Type, capture.ID, capture.AmountPoints, capture.CaptureKey); err != nil {
			return err
		}
	}
	for _, release := range plan.ReleaseReservations {
		if err := wallet.ReleaseReservationWithTx(ctx, nil, release.Type, release.ID); err != nil {
			return err
		}
	}
	for _, credit := range plan.SellerCredits {
		if err := wallet.CreditWithTx(ctx, nil, credit.UserID, credit.AmountPoints, credit.CreditKey, "secondary fill proceeds"); err != nil {
			return err
		}
	}

	r.persistPlans = append(r.persistPlans, plan)
	r.orders[plan.Taker.ID] = cloneOrder(&plan.Taker)
	for i := range plan.MakerUpdates {
		r.orders[plan.MakerUpdates[i].ID] = cloneOrder(&plan.MakerUpdates[i])
	}
	for i := range plan.Trades {
		r.trades = append(r.trades, *cloneTrade(&plan.Trades[i]))
	}
	for _, mutation := range plan.PositionMutations {
		key := mutation.UserID + ":" + mutation.MarketID + ":" + string(mutation.Side)
		position := r.positions[key]
		if position == nil {
			position = &Position{
				ID:       fmt.Sprintf("pos-%d", len(r.positions)+1),
				UserID:   mutation.UserID,
				MarketID: mutation.MarketID,
				Side:     mutation.Side,
			}
			r.positions[key] = position
		}
		ApplyPositionMutation(position, mutation)
	}
	for _, delta := range plan.PositionReservationDeltas {
		key := delta.UserID + ":" + delta.MarketID + ":" + string(delta.Side)
		position := r.positions[key]
		if position == nil {
			position = &Position{
				ID:       fmt.Sprintf("pos-%d", len(r.positions)+1),
				UserID:   delta.UserID,
				MarketID: delta.MarketID,
				Side:     delta.Side,
			}
			r.positions[key] = position
		}
		position.ReservedQuantity += delta.Delta
		if position.ReservedQuantity < 0 {
			position.ReservedQuantity = 0
		}
	}
	r.markets[plan.Market.ID] = cloneMarket(&plan.Market)
	return nil
}

func (r *exchangeMemRepo) FinalizeRestingOrderAtomic(
	ctx context.Context,
	wallet ExchangeWalletAdapter,
	order *Order,
	terminal OrderStatus,
) (int64, int64, time.Time, error) {
	if err := wallet.ReleaseReservationWithTx(ctx, nil, "prediction_order", order.ID); err != nil {
		return 0, 0, time.Time{}, err
	}
	if order.Action == OrderActionSell && order.RemainingQuantity > 0 {
		key := order.UserID + ":" + order.MarketID + ":" + string(order.Side)
		if position := r.positions[key]; position != nil {
			position.ReservedQuantity -= order.RemainingQuantity
			if position.ReservedQuantity < 0 {
				position.ReservedQuantity = 0
			}
		}
	}

	stored := r.orders[order.ID]
	if stored == nil {
		return 0, 0, time.Time{}, fmt.Errorf("order not found")
	}
	stored.Status = terminal
	stored.ReservedQuantity = 0
	now := time.Now().UTC()
	if terminal == OrderStatusCancelled {
		stored.CancelledAt = &now
	}
	stored.UpdatedAt = now
	r.orders[stored.ID] = cloneOrder(stored)
	return stored.ReservedCashPoints, stored.CapturedCashPoints, stored.CreatedAt, nil
}

func (r *exchangeMemRepo) LoadMakersForSecondary(context.Context, string, OrderSide, OrderAction, *int, int) ([]Order, error) {
	return append([]Order(nil), r.secondaryMakers...), nil
}

func (r *exchangeMemRepo) LoadMakersForIssuance(context.Context, string, OrderSide, int, int) ([]Order, error) {
	return append([]Order(nil), r.issuanceMakers...), nil
}

func (r *exchangeMemRepo) RefreshMarketBestQuotes(context.Context, string) error {
	r.refreshCalls++
	return nil
}

func (r *exchangeMemRepo) ReconcileMarket(context.Context, string) (*CollateralDriftReport, error) {
	return nil, nil
}

func (r *exchangeMemRepo) ListRecentDriftAlerts(context.Context, time.Time) ([]CollateralDriftAlert, error) {
	return nil, nil
}

type reservationCall struct {
	userID       string
	amountPoints int64
	refType      string
	refID        string
}

type captureCall struct {
	amountPoints int64
	refType      string
	refID        string
	captureKey   string
}

type exchangeFakeWallet struct {
	*fakeWallet
	holds        []reservationCall
	captures     []captureCall
	releases     []ReservationRef
	reservations map[string]int64
	captured     map[string]int64
}

func newExchangeFakeWallet(initialBalance int64) *exchangeFakeWallet {
	return &exchangeFakeWallet{
		fakeWallet:   newFakeWallet(initialBalance),
		reservations: make(map[string]int64),
		captured:     make(map[string]int64),
	}
}

func (f *exchangeFakeWallet) BeginTx(context.Context) (*sql.Tx, error)         { return nil, nil }
func (f *exchangeFakeWallet) BeginExchangeTx(context.Context) (*sql.Tx, error) { return nil, nil }

func (f *exchangeFakeWallet) DebitWithTx(ctx context.Context, _ *sql.Tx, userID string, amountPoints int64, idempotencyKey, reason string) error {
	return f.Debit(ctx, userID, amountPoints, idempotencyKey, reason)
}

func (f *exchangeFakeWallet) CreditWithTx(ctx context.Context, _ *sql.Tx, userID string, amountPoints int64, idempotencyKey, reason string) error {
	return f.Credit(ctx, userID, amountPoints, idempotencyKey, reason)
}

func (f *exchangeFakeWallet) HoldWithTx(_ context.Context, _ *sql.Tx, userID string, amountPoints int64, refType, refID string, _ time.Duration) error {
	if f.balances[userID] < amountPoints {
		return fmt.Errorf("insufficient balance")
	}
	f.holds = append(f.holds, reservationCall{userID: userID, amountPoints: amountPoints, refType: refType, refID: refID})
	f.reservations[refType+":"+refID] = amountPoints
	return nil
}

func (f *exchangeFakeWallet) CaptureReservationWithTx(_ context.Context, _ *sql.Tx, refType, refID string, amountPoints int64, captureKey string) error {
	key := refType + ":" + refID
	remaining := f.reservations[key] - f.captured[key]
	if amountPoints > remaining {
		return fmt.Errorf("capture %d exceeds remaining %d", amountPoints, remaining)
	}
	f.captured[key] += amountPoints
	f.captures = append(f.captures, captureCall{amountPoints: amountPoints, refType: refType, refID: refID, captureKey: captureKey})
	return nil
}

func (f *exchangeFakeWallet) ReleaseReservationWithTx(_ context.Context, _ *sql.Tx, refType, refID string) error {
	f.releases = append(f.releases, ReservationRef{Type: refType, ID: refID})
	return nil
}

func seedOrderBookMarket(t *testing.T, repo *exchangeMemRepo) *Market {
	t.Helper()
	m := seedMarket(t, repo.memRepo)
	m.ExecutionMode = ExecutionModeOrderBook
	m.FeeRateBps = 500
	repo.markets[m.ID] = m
	return m
}

func TestPlaceOrder_OrderBookBuyYes_WalletPlanCapturesAndCreditsSeller(t *testing.T) {
	repo := newExchangeMemRepo()
	seedOrderBookMarket(t, repo)
	maker := makeOrder("maker-sell-yes", "bob", OrderSideYes, OrderActionSell, OrderTypeLimit, intPtr(55), 10)
	maker.Status = OrderStatusOpen
	maker.ReservedQuantity = 10
	repo.secondaryMakers = []Order{maker}
	repo.orders[maker.ID] = cloneOrder(&maker)
	repo.positions["bob:mkt-1:yes"] = &Position{
		ID: "pos-bob", UserID: "bob", MarketID: "mkt-1", Side: OrderSideYes,
		Quantity: 10, ReservedQuantity: 10, AvgPricePoints: 40, TotalCostPoints: 400,
	}
	wallet := newExchangeFakeWallet(1000)
	svc := NewService(repo, wallet)

	order, trade, err := svc.PlaceOrder(context.Background(), PlaceOrderRequest{
		MarketID:    "mkt-1",
		Side:        OrderSideYes,
		Action:      OrderActionBuy,
		OrderType:   OrderTypeLimit,
		PricePoints: intPtr(60),
		Quantity:    10,
	}, "user1")
	if err != nil {
		t.Fatalf("PlaceOrder failed: %v", err)
	}
	if order.Status != OrderStatusFilled || trade == nil || trade.PricePoints != 55 {
		t.Fatalf("expected filled buy at 55, got order=%+v trade=%+v", order, trade)
	}
	if len(wallet.holds) != 1 || wallet.holds[0].amountPoints != 600 || wallet.holds[0].refID != order.ID {
		t.Fatalf("expected one 600-point hold for taker order, got %+v", wallet.holds)
	}
	if len(wallet.captures) != 1 || wallet.captures[0].amountPoints != 550 || wallet.captures[0].refID != order.ID {
		t.Fatalf("expected one 550-point capture from taker reservation, got %+v", wallet.captures)
	}
	if len(wallet.releases) != 1 || wallet.releases[0].ID != order.ID {
		t.Fatalf("expected taker reservation release, got %+v", wallet.releases)
	}
	if len(wallet.creditCalls) != 1 || wallet.creditCalls[0].userID != "bob" || wallet.creditCalls[0].amountPoints != 550 {
		t.Fatalf("expected seller bob credited 550 points, got %+v", wallet.creditCalls)
	}
	if got := repo.positions["user1:mkt-1:yes"]; got == nil || got.Quantity != 10 || got.TotalCostPoints != 550 {
		t.Fatalf("expected buyer YES position quantity=10 cost=550, got %+v", got)
	}
	if got := repo.positions["bob:mkt-1:yes"]; got == nil || got.Quantity != 0 || got.ReservedQuantity != 0 {
		t.Fatalf("expected seller position closed and reservation released, got %+v", got)
	}
	if len(repo.persistPlans) != 1 || len(repo.persistPlans[0].LedgerEntries) == 0 {
		t.Fatalf("expected persisted match plan with collateral ledger entries, got %+v", repo.persistPlans)
	}
}

func TestPlaceOrder_OrderBookBuyNo_IssuanceCapturesBothReservations(t *testing.T) {
	repo := newExchangeMemRepo()
	seedOrderBookMarket(t, repo)
	maker := makeOrder("maker-buy-yes", "bob", OrderSideYes, OrderActionBuy, OrderTypeLimit, intPtr(40), 10)
	maker.Status = OrderStatusOpen
	repo.issuanceMakers = []Order{maker}
	repo.orders[maker.ID] = cloneOrder(&maker)
	wallet := newExchangeFakeWallet(1000)
	wallet.balances["bob"] = 1000
	wallet.reservations["prediction_order:"+maker.ID] = 400
	svc := NewService(repo, wallet)

	order, trade, err := svc.PlaceOrder(context.Background(), PlaceOrderRequest{
		MarketID:    "mkt-1",
		Side:        OrderSideNo,
		Action:      OrderActionBuy,
		OrderType:   OrderTypeLimit,
		PricePoints: intPtr(65),
		Quantity:    10,
	}, "user1")
	if err != nil {
		t.Fatalf("PlaceOrder failed: %v", err)
	}
	if order.Status != OrderStatusFilled || trade == nil || trade.TradeKind != TradeKindIssuance {
		t.Fatalf("expected filled buy NO issuance, got order=%+v trade=%+v", order, trade)
	}
	if len(wallet.holds) != 1 || wallet.holds[0].amountPoints != 650 || wallet.holds[0].refID != order.ID {
		t.Fatalf("expected one 650-point taker hold, got %+v", wallet.holds)
	}
	if len(wallet.captures) != 2 {
		t.Fatalf("expected taker and maker captures, got %+v", wallet.captures)
	}
	if wallet.captures[0].refID != order.ID || wallet.captures[0].amountPoints != 600 {
		t.Fatalf("expected taker capture of 600 points, got %+v", wallet.captures[0])
	}
	if wallet.captures[1].refID != maker.ID || wallet.captures[1].amountPoints != 400 {
		t.Fatalf("expected maker capture of 400 points, got %+v", wallet.captures[1])
	}
	if len(wallet.releases) != 1 || wallet.releases[0].ID != order.ID {
		t.Fatalf("expected taker reservation release, got %+v", wallet.releases)
	}
	if len(wallet.creditCalls) != 0 {
		t.Fatalf("issuance should not credit a seller, got %+v", wallet.creditCalls)
	}
	if got := repo.positions["user1:mkt-1:no"]; got == nil || got.Quantity != 10 || got.TotalCostPoints != 600 {
		t.Fatalf("expected buyer NO position quantity=10 cost=600, got %+v", got)
	}
	if got := repo.positions["bob:mkt-1:yes"]; got == nil || got.Quantity != 10 || got.TotalCostPoints != 400 {
		t.Fatalf("expected maker YES position quantity=10 cost=400, got %+v", got)
	}
	if len(repo.persistPlans) != 1 {
		t.Fatalf("expected one persisted match plan, got %+v", repo.persistPlans)
	}
	if repo.persistPlans[0].Market.CollateralPoolPoints != 1000 {
		t.Fatalf("expected collateral pool to grow by 1000, got %d", repo.persistPlans[0].Market.CollateralPoolPoints)
	}
	if len(repo.persistPlans[0].LedgerEntries) == 0 {
		t.Fatalf("expected issuance collateral ledger entries, got %+v", repo.persistPlans[0].LedgerEntries)
	}
}

func TestPlaceOrder_OrderBookSellYes_CreditsSellerWithoutCashHold(t *testing.T) {
	repo := newExchangeMemRepo()
	seedOrderBookMarket(t, repo)
	maker := makeOrder("maker-buy-yes", "bob", OrderSideYes, OrderActionBuy, OrderTypeLimit, intPtr(55), 10)
	maker.Status = OrderStatusOpen
	repo.secondaryMakers = []Order{maker}
	repo.orders[maker.ID] = cloneOrder(&maker)
	repo.positions["user1:mkt-1:yes"] = &Position{
		ID: "pos-alice", UserID: "user1", MarketID: "mkt-1", Side: OrderSideYes,
		Quantity: 10, AvgPricePoints: 40, TotalCostPoints: 400,
	}
	wallet := newExchangeFakeWallet(0)
	wallet.balances["bob"] = 1000
	wallet.reservations["prediction_order:"+maker.ID] = 550
	svc := NewService(repo, wallet)

	order, trade, err := svc.PlaceOrder(context.Background(), PlaceOrderRequest{
		MarketID:  "mkt-1",
		Side:      OrderSideYes,
		Action:    OrderActionSell,
		OrderType: OrderTypeMarket,
		Quantity:  10,
	}, "user1")
	if err != nil {
		t.Fatalf("PlaceOrder failed: %v", err)
	}
	if order.Status != OrderStatusFilled || trade == nil || trade.PricePoints != 55 {
		t.Fatalf("expected filled sell at 55, got order=%+v trade=%+v", order, trade)
	}
	if len(wallet.holds) != 0 {
		t.Fatalf("sell taker should not create a cash hold, got %+v", wallet.holds)
	}
	if len(wallet.captures) != 1 || wallet.captures[0].refID != maker.ID || wallet.captures[0].amountPoints != 550 {
		t.Fatalf("expected capture from resting buyer reservation, got %+v", wallet.captures)
	}
	if len(wallet.creditCalls) != 1 || wallet.creditCalls[0].userID != "user1" || wallet.creditCalls[0].amountPoints != 550 {
		t.Fatalf("expected seller user1 credited 550 points, got %+v", wallet.creditCalls)
	}
	if got := repo.positions["user1:mkt-1:yes"]; got == nil || got.Quantity != 0 || got.RealizedPnlPoints != 150 {
		t.Fatalf("expected seller position closed with 150-point realized pnl, got %+v", got)
	}
}

func TestPlaceOrder_OrderBookBuyYes_InsufficientPointsRejectsBeforeCapture(t *testing.T) {
	repo := newExchangeMemRepo()
	seedOrderBookMarket(t, repo)
	maker := makeOrder("maker-sell-yes", "bob", OrderSideYes, OrderActionSell, OrderTypeLimit, intPtr(55), 10)
	maker.Status = OrderStatusOpen
	maker.ReservedQuantity = 10
	repo.secondaryMakers = []Order{maker}
	repo.orders[maker.ID] = cloneOrder(&maker)
	repo.positions["bob:mkt-1:yes"] = &Position{
		ID: "pos-bob", UserID: "bob", MarketID: "mkt-1", Side: OrderSideYes,
		Quantity: 10, ReservedQuantity: 10, AvgPricePoints: 40, TotalCostPoints: 400,
	}
	wallet := newExchangeFakeWallet(599)
	svc := NewService(repo, wallet)

	order, trade, err := svc.PlaceOrder(context.Background(), PlaceOrderRequest{
		MarketID:    "mkt-1",
		Side:        OrderSideYes,
		Action:      OrderActionBuy,
		OrderType:   OrderTypeLimit,
		PricePoints: intPtr(60),
		Quantity:    10,
	}, "user1")
	if err == nil {
		t.Fatal("expected insufficient points error")
	}
	if trade != nil {
		t.Fatalf("expected no trade on rejected order, got %+v", trade)
	}
	if order == nil || order.Status != OrderStatusRejected {
		t.Fatalf("expected rejected order returned, got %+v", order)
	}
	if len(wallet.holds) != 0 || len(wallet.captures) != 0 || len(wallet.creditCalls) != 0 {
		t.Fatalf("insufficient points must not capture or credit, holds=%+v captures=%+v credits=%+v", wallet.holds, wallet.captures, wallet.creditCalls)
	}
	if len(repo.persistPlans) != 0 {
		t.Fatalf("failed wallet hold should roll back match persistence, got %+v", repo.persistPlans)
	}
}

func TestCancelOrder_OrderBookRestingBuy_ReleasesHeldPointsAndRGCommit(t *testing.T) {
	repo := newExchangeMemRepo()
	seedOrderBookMarket(t, repo)
	placedAt := time.Now().UTC().Add(-time.Minute)
	order := &Order{
		ID:                 "resting-buy-yes",
		UserID:             "user1",
		MarketID:           "mkt-1",
		Side:               OrderSideYes,
		Action:             OrderActionBuy,
		OrderType:          OrderTypeLimit,
		PricePoints:        intPtr(60),
		Quantity:           10,
		RemainingQuantity:  10,
		Status:             OrderStatusOpen,
		TimeInForce:        TIFGTC,
		ReservedCashPoints: 600,
		CapturedCashPoints: 0,
		CreatedAt:          placedAt,
		UpdatedAt:          placedAt,
	}
	repo.orders[order.ID] = cloneOrder(order)
	wallet := newExchangeFakeWallet(0)
	rg := &fakeCompliance{}
	svc := NewService(repo, wallet)
	svc.SetComplianceChecker(rg)

	if err := svc.CancelOrder(context.Background(), order.ID, "user1"); err != nil {
		t.Fatalf("CancelOrder failed: %v", err)
	}
	stored := repo.orders[order.ID]
	if stored.Status != OrderStatusCancelled || stored.CancelledAt == nil {
		t.Fatalf("expected cancelled resting order with cancelledAt, got %+v", stored)
	}
	if len(wallet.releases) != 1 || wallet.releases[0].ID != order.ID {
		t.Fatalf("expected wallet reservation release for cancelled order, got %+v", wallet.releases)
	}
	if len(rg.releaseCalls) != 1 || rg.releaseCalls[0] != 600 {
		t.Fatalf("expected responsible-play release of 600 points, got %+v", rg.releaseCalls)
	}
}

func TestCancelOrder_OrderBookRestingSell_ReleasesReservedShares(t *testing.T) {
	repo := newExchangeMemRepo()
	seedOrderBookMarket(t, repo)
	placedAt := time.Now().UTC().Add(-time.Minute)
	order := &Order{
		ID:                "resting-sell-yes",
		UserID:            "user1",
		MarketID:          "mkt-1",
		Side:              OrderSideYes,
		Action:            OrderActionSell,
		OrderType:         OrderTypeLimit,
		PricePoints:       intPtr(55),
		Quantity:          6,
		RemainingQuantity: 6,
		Status:            OrderStatusOpen,
		TimeInForce:       TIFGTC,
		ReservedQuantity:  6,
		CreatedAt:         placedAt,
		UpdatedAt:         placedAt,
	}
	repo.orders[order.ID] = cloneOrder(order)
	repo.positions["user1:mkt-1:yes"] = &Position{
		ID: "pos-user1", UserID: "user1", MarketID: "mkt-1", Side: OrderSideYes,
		Quantity: 10, ReservedQuantity: 6, AvgPricePoints: 40, TotalCostPoints: 400,
	}
	wallet := newExchangeFakeWallet(0)
	svc := NewService(repo, wallet)

	if err := svc.CancelOrder(context.Background(), order.ID, "user1"); err != nil {
		t.Fatalf("CancelOrder failed: %v", err)
	}
	stored := repo.orders[order.ID]
	if stored.Status != OrderStatusCancelled || stored.ReservedQuantity != 0 {
		t.Fatalf("expected cancelled sell order with released order reservation, got %+v", stored)
	}
	position := repo.positions["user1:mkt-1:yes"]
	if position.ReservedQuantity != 0 || position.Quantity != 10 {
		t.Fatalf("expected sell cancellation to release reserved shares without changing owned quantity, got %+v", position)
	}
	if len(wallet.releases) != 1 || wallet.releases[0].ID != order.ID {
		t.Fatalf("expected idempotent wallet reservation release call, got %+v", wallet.releases)
	}
}
