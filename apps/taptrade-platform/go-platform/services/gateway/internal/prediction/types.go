package prediction

import (
	"encoding/json"
	"time"
)

var maxJSONTime = time.Date(9999, time.December, 31, 23, 59, 59, 0, time.UTC)

func publicJSONTime(t time.Time) time.Time {
	if t.Year() > 9999 {
		return maxJSONTime
	}
	return t
}

func publicJSONTimePtr(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	safe := publicJSONTime(*t)
	return &safe
}

// Category represents a prediction market category (politics, sports, entertainment, etc.)
type Category struct {
	ID        string    `json:"id" db:"id"`
	Slug      string    `json:"slug" db:"slug"`
	Name      string    `json:"name" db:"name"`
	Icon      string    `json:"icon,omitempty" db:"icon"`
	SortOrder int       `json:"sortOrder" db:"sort_order"`
	Active    bool      `json:"active" db:"active"`
	CreatedAt time.Time `json:"createdAt" db:"created_at"`
	UpdatedAt time.Time `json:"updatedAt" db:"updated_at"`
}

// Series represents a recurring event template (e.g., "Fed Rate Decisions")
type Series struct {
	ID          string    `json:"id" db:"id"`
	Slug        string    `json:"slug" db:"slug"`
	Title       string    `json:"title" db:"title"`
	Description string    `json:"description,omitempty" db:"description"`
	CategoryID  string    `json:"categoryId" db:"category_id"`
	Frequency   string    `json:"frequency,omitempty" db:"frequency"`
	Tags        []string  `json:"tags" db:"tags"`
	Active      bool      `json:"active" db:"active"`
	CreatedAt   time.Time `json:"createdAt" db:"created_at"`
	UpdatedAt   time.Time `json:"updatedAt" db:"updated_at"`
}

// EventStatus represents the lifecycle state of a prediction event.
type EventStatus string

const (
	EventStatusDraft       EventStatus = "draft"
	EventStatusOpen        EventStatus = "open"
	EventStatusTradingHalt EventStatus = "trading_halt"
	EventStatusClosed      EventStatus = "closed"
	EventStatusSettling    EventStatus = "settling"
	EventStatusSettled     EventStatus = "settled"
	EventStatusVoided      EventStatus = "voided"
)

// Event represents a specific occurrence within a series.
type Event struct {
	ID          string          `json:"id" db:"id"`
	SeriesID    *string         `json:"seriesId,omitempty" db:"series_id"`
	Title       string          `json:"title" db:"title"`
	Description string          `json:"description,omitempty" db:"description"`
	CategoryID  string          `json:"categoryId" db:"category_id"`
	Status      EventStatus     `json:"status" db:"status"`
	Featured    bool            `json:"featured" db:"featured"`
	OpenAt      *time.Time      `json:"openAt,omitempty" db:"open_at"`
	CloseAt     time.Time       `json:"closeAt" db:"close_at"`
	SettleAt    *time.Time      `json:"settleAt,omitempty" db:"settle_at"`
	SettledAt   *time.Time      `json:"settledAt,omitempty" db:"settled_at"`
	Metadata    json.RawMessage `json:"metadata,omitempty" db:"metadata"`
	CreatedBy   *string         `json:"createdBy,omitempty" db:"created_by"`
	CreatedAt   time.Time       `json:"createdAt" db:"created_at"`
	UpdatedAt   time.Time       `json:"updatedAt" db:"updated_at"`

	// CoverImageURL is the moment's cover photo for the home rail: a
	// site-relative /images/ path or an https URL (migration 057).
	CoverImageURL *string `json:"coverImageUrl,omitempty" db:"cover_image_url"`

	// Joined data
	Markets []Market `json:"markets,omitempty" db:"-"`
}

// MarketStatus represents the lifecycle state of a prediction market.
type MarketStatus string

const (
	MarketStatusUnopened           MarketStatus = "unopened"
	MarketStatusOpen               MarketStatus = "open"
	MarketStatusHalted             MarketStatus = "halted"
	MarketStatusClosed             MarketStatus = "closed"
	MarketStatusProposedResolution MarketStatus = "proposed_resolution"
	MarketStatusDisputed           MarketStatus = "disputed"
	MarketStatusSettled            MarketStatus = "settled"
	MarketStatusVoided             MarketStatus = "voided"
)

// MarketResult is the resolved outcome of a market.
type MarketResult string

const (
	MarketResultYes MarketResult = "yes"
	MarketResultNo  MarketResult = "no"
)

// ExecutionMode determines whether a market matches via the AMM or the
// real order book exchange engine.
type ExecutionMode string

const (
	ExecutionModeOrderBook ExecutionMode = "order_book"
	ExecutionModeAMM       ExecutionMode = "amm"
)

// Market represents an individual binary contract within an event.
type Market struct {
	ID                   string          `json:"id" db:"id"`
	EventID              string          `json:"eventId" db:"event_id"`
	// EventTitle is the parent event's (editorial) title, read-joined for
	// display surfaces — the Moments feed labels clusters with it.
	EventTitle           *string         `json:"eventTitle,omitempty" db:"event_title"`
	CategoryID           string          `json:"categoryId,omitempty" db:"-"`
	CategorySlug         string          `json:"categorySlug,omitempty" db:"-"`
	CategoryName         string          `json:"categoryName,omitempty" db:"-"`
	// CommentCount is the market's discussion size, stitched onto
	// user-facing ListMarkets responses only (§3-09: the feed card's
	// activity signal). Worker sweeps (Sort:"id") skip it, and
	// GetMarket never carries it — the detail page loads the
	// discussion itself. omitempty keeps it off every other payload.
	CommentCount int `json:"commentCount,omitempty" db:"-"`
	Ticker               string          `json:"ticker" db:"ticker"`
	Title                string          `json:"title" db:"title"`
	Description          string          `json:"description,omitempty" db:"description"`
	Translations         json.RawMessage `json:"translations,omitempty" db:"translations"`
	Status               MarketStatus    `json:"status" db:"status"`
	Result               *MarketResult   `json:"result,omitempty" db:"result"`
	YesPricePoints       int             `json:"yesPricePoints" db:"yes_price_points"`
	NoPricePoints        int             `json:"noPricePoints" db:"no_price_points"`
	LastTradePricePoints *int            `json:"lastTradePricePoints,omitempty" db:"last_trade_price_points"`
	VolumePoints         int64           `json:"volumePoints" db:"volume_points"`
	OpenInterestPoints   int64           `json:"openInterestPoints" db:"open_interest_points"`
	LiquidityPoints      int64           `json:"liquidityPoints" db:"liquidity_points"`
	AMMYesShares         float64         `json:"ammYesShares" db:"amm_yes_shares"`
	AMMNoShares          float64         `json:"ammNoShares" db:"amm_no_shares"`
	AMMLiquidityParam    float64         `json:"ammLiquidityParam" db:"amm_liquidity_param"`
	AMMSubsidyPoints     int64           `json:"ammSubsidyPoints" db:"amm_subsidy_points"`
	SettlementSourceKey  string          `json:"settlementSourceKey" db:"settlement_source_key"`
	SettlementCutoffAt   *time.Time      `json:"settlementCutoffAt,omitempty" db:"settlement_cutoff_at"`
	SettlementRule       string          `json:"settlementRule" db:"settlement_rule"`
	SettlementParams     json.RawMessage `json:"settlementParams,omitempty" db:"settlement_params"`
	FallbackSourceKey    *string         `json:"fallbackSourceKey,omitempty" db:"fallback_source_key"`
	FeeRateBps           int             `json:"feeRateBps" db:"fee_rate_bps"`
	MakerRebateBps       int             `json:"makerRebateBps" db:"maker_rebate_bps"`
	OpenAt               *time.Time      `json:"openAt,omitempty" db:"open_at"`
	CloseAt              time.Time       `json:"closeAt" db:"close_at"`
	CreatedAt            time.Time       `json:"createdAt" db:"created_at"`
	UpdatedAt            time.Time       `json:"updatedAt" db:"updated_at"`
	ImagePath            string          `json:"imagePath,omitempty" db:"image_path"`

	// ArticleSourceID links an AI-drafted market to its source article
	// (migration 024). Nil for markets created by hand.
	ArticleSourceID *string `json:"articleSourceId,omitempty" db:"article_source_id"`

	// Exchange engine fields (migration 019).
	ExecutionMode           ExecutionMode `json:"executionMode" db:"execution_mode"`
	CollateralPoolPoints    int64         `json:"collateralPoolPoints" db:"collateral_pool_points"`
	SettledPayoutPoolPoints int64         `json:"settledPayoutPoolPoints" db:"settled_payout_pool_points"`
	BestYesBidPoints        *int          `json:"bestYesBidPoints,omitempty" db:"best_yes_bid_points"`
	BestYesAskPoints        *int          `json:"bestYesAskPoints,omitempty" db:"best_yes_ask_points"`
	BestNoBidPoints         *int          `json:"bestNoBidPoints,omitempty" db:"best_no_bid_points"`
	BestNoAskPoints         *int          `json:"bestNoAskPoints,omitempty" db:"best_no_ask_points"`
	LastQuoteAt             *time.Time    `json:"lastQuoteAt,omitempty" db:"last_quote_at"`
}

func (m Market) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		ID                   string          `json:"id"`
		EventID              string          `json:"eventId"`
		EventTitle           *string         `json:"eventTitle,omitempty"`
		CategoryID           string          `json:"categoryId,omitempty"`
		CategorySlug         string          `json:"categorySlug,omitempty"`
		CategoryName         string          `json:"categoryName,omitempty"`
		Ticker               string          `json:"ticker"`
		Title                string          `json:"title"`
		Description          string          `json:"description,omitempty"`
		Translations         json.RawMessage `json:"translations,omitempty"`
		Status               MarketStatus    `json:"status"`
		Result               *MarketResult   `json:"result,omitempty"`
		YesPricePoints       int             `json:"yesPricePoints"`
		NoPricePoints        int             `json:"noPricePoints"`
		LastTradePricePoints *int            `json:"lastTradePricePoints,omitempty"`
		VolumePoints         int64           `json:"volumePoints"`
		OpenInterestPoints   int64           `json:"openInterestPoints"`
		LiquidityPoints      int64           `json:"liquidityPoints"`
		AMMYesShares         float64         `json:"ammYesShares"`
		AMMNoShares          float64         `json:"ammNoShares"`
		AMMLiquidityParam    float64         `json:"ammLiquidityParam"`
		AMMSubsidyPoints     int64           `json:"ammSubsidyPoints"`
		SettlementSourceKey  string          `json:"settlementSourceKey"`
		SettlementCutoffAt   *time.Time      `json:"settlementCutoffAt,omitempty"`
		SettlementRule       string          `json:"settlementRule"`
		SettlementParams     json.RawMessage `json:"settlementParams,omitempty"`
		FallbackSourceKey    *string         `json:"fallbackSourceKey,omitempty"`
		FeeRateBps           int             `json:"feeRateBps"`
		MakerRebateBps       int             `json:"makerRebateBps"`
		OpenAt               *time.Time      `json:"openAt,omitempty"`
		CloseAt              time.Time       `json:"closeAt"`
		CreatedAt            time.Time       `json:"createdAt"`
		UpdatedAt            time.Time       `json:"updatedAt"`
		ImagePath            string          `json:"imagePath,omitempty"`
		ArticleSourceID      *string         `json:"articleSourceId,omitempty"`
		ExecutionMode        ExecutionMode   `json:"executionMode"`
		CollateralPoolPoints int64           `json:"collateralPoolPoints"`
		SettlementPoolPoints int64           `json:"settlementPoolPoints"`
		BestYesBidPoints     *int            `json:"bestYesBidPoints,omitempty"`
		BestYesAskPoints     *int            `json:"bestYesAskPoints,omitempty"`
		BestNoBidPoints      *int            `json:"bestNoBidPoints,omitempty"`
		BestNoAskPoints      *int            `json:"bestNoAskPoints,omitempty"`
		LastQuoteAt          *time.Time      `json:"lastQuoteAt,omitempty"`
		// §3-09: present only when the list path stitched it (>0);
		// this marshaller is a WHITELIST — new wire fields land here,
		// not just on the struct tag.
		CommentCount int    `json:"commentCount,omitempty"`
		Unit         string `json:"unit"`
	}{
		ID:                   m.ID,
		EventID:              m.EventID,
		EventTitle:           m.EventTitle,
		CategoryID:           m.CategoryID,
		CategorySlug:         m.CategorySlug,
		CategoryName:         m.CategoryName,
		Ticker:               m.Ticker,
		Title:                m.Title,
		Description:          m.Description,
		Translations:         m.Translations,
		Status:               m.Status,
		Result:               m.Result,
		YesPricePoints:       m.YesPricePoints,
		NoPricePoints:        m.NoPricePoints,
		LastTradePricePoints: m.LastTradePricePoints,
		VolumePoints:         m.VolumePoints,
		OpenInterestPoints:   m.OpenInterestPoints,
		LiquidityPoints:      m.LiquidityPoints,
		AMMYesShares:         m.AMMYesShares,
		AMMNoShares:          m.AMMNoShares,
		AMMLiquidityParam:    m.AMMLiquidityParam,
		AMMSubsidyPoints:     m.AMMSubsidyPoints,
		SettlementSourceKey:  m.SettlementSourceKey,
		SettlementCutoffAt:   publicJSONTimePtr(m.SettlementCutoffAt),
		SettlementRule:       m.SettlementRule,
		SettlementParams:     m.SettlementParams,
		FallbackSourceKey:    m.FallbackSourceKey,
		FeeRateBps:           m.FeeRateBps,
		MakerRebateBps:       m.MakerRebateBps,
		OpenAt:               publicJSONTimePtr(m.OpenAt),
		CloseAt:              publicJSONTime(m.CloseAt),
		CreatedAt:            publicJSONTime(m.CreatedAt),
		UpdatedAt:            publicJSONTime(m.UpdatedAt),
		ImagePath:            m.ImagePath,
		ArticleSourceID:      m.ArticleSourceID,
		ExecutionMode:        m.ExecutionMode,
		CollateralPoolPoints: m.CollateralPoolPoints,
		SettlementPoolPoints: m.SettledPayoutPoolPoints,
		BestYesBidPoints:     m.BestYesBidPoints,
		BestYesAskPoints:     m.BestYesAskPoints,
		BestNoBidPoints:      m.BestNoBidPoints,
		BestNoAskPoints:      m.BestNoAskPoints,
		LastQuoteAt:          publicJSONTimePtr(m.LastQuoteAt),
		CommentCount:         m.CommentCount,
		Unit:                 "PTS",
	})
}

// OrderSide is the side of a prediction (YES or NO).
type OrderSide string

const (
	OrderSideYes OrderSide = "yes"
	OrderSideNo  OrderSide = "no"
)

// OrderAction is the action taken (BUY or SELL).
type OrderAction string

const (
	OrderActionBuy  OrderAction = "buy"
	OrderActionSell OrderAction = "sell"
)

// OrderType distinguishes market orders from limit orders.
type OrderType string

const (
	OrderTypeMarket OrderType = "market"
	OrderTypeLimit  OrderType = "limit"
)

// OrderStatus tracks the lifecycle of an order.
type OrderStatus string

const (
	OrderStatusPending   OrderStatus = "pending"
	OrderStatusOpen      OrderStatus = "open"
	OrderStatusPartial   OrderStatus = "partial"
	OrderStatusFilled    OrderStatus = "filled"
	OrderStatusCancelled OrderStatus = "cancelled"
	OrderStatusExpired   OrderStatus = "expired"
	OrderStatusRejected  OrderStatus = "rejected"
)

// TimeInForce specifies the lifetime of a limit order.
type TimeInForce string

const (
	TIFGTC TimeInForce = "gtc"
	TIFIOC TimeInForce = "ioc"
	TIFFOK TimeInForce = "fok"
)

// SelfMatchAction tells the exchange how to handle same-user crossings.
type SelfMatchAction string

const (
	SelfMatchCancelTaker SelfMatchAction = "cancel_taker"
	SelfMatchCancelMaker SelfMatchAction = "cancel_maker"
	SelfMatchCancelBoth  SelfMatchAction = "cancel_both"
)

// Failure-reason constants populated on rejected/cancelled orders.
const (
	FailurePriceBandViolation   = "price_band_violation"
	FailurePostOnlyWouldTake    = "post_only_would_take"
	FailureSelfMatchRejected    = "self_match_rejected"
	FailureClosedMarket         = "closed_market"
	FailureInsufficientBalance  = "insufficient_balance"
	FailureInsufficientPosition = "insufficient_position"
	FailureNotionalCapMissing   = "notional_cap_missing"
	FailureNotionalCapExceeded  = "notional_cap_exceeded"
	FailureFOKUnavailable       = "fok_unavailable"
)

// Order represents a user's order to buy or sell contracts.
type Order struct {
	ID                  string      `json:"id" db:"id"`
	UserID              string      `json:"userId" db:"user_id"`
	MarketID            string      `json:"marketId" db:"market_id"`
	Side                OrderSide   `json:"side" db:"side"`
	Action              OrderAction `json:"action" db:"action"`
	OrderType           OrderType   `json:"orderType" db:"order_type"`
	PricePoints         *int        `json:"-" db:"price_points"`
	Quantity            int         `json:"quantity" db:"quantity"`
	FilledQuantity      int         `json:"filledQuantity" db:"filled_quantity"`
	RemainingQuantity   int         `json:"remainingQuantity" db:"remaining_quantity"`
	TotalCostPoints     int64       `json:"totalCostPoints" db:"total_cost_points"`
	Status              OrderStatus `json:"status" db:"status"`
	WalletReservationID *string     `json:"-" db:"wallet_reservation_id"`
	IdempotencyKey      *string     `json:"idempotencyKey,omitempty" db:"idempotency_key"`
	ExpiresAt           *time.Time  `json:"expiresAt,omitempty" db:"expires_at"`
	FilledAt            *time.Time  `json:"filledAt,omitempty" db:"filled_at"`
	CancelledAt         *time.Time  `json:"cancelledAt,omitempty" db:"cancelled_at"`
	CreatedAt           time.Time   `json:"createdAt" db:"created_at"`
	UpdatedAt           time.Time   `json:"updatedAt" db:"updated_at"`

	// Exchange engine fields (migration 019).
	TimeInForce            TimeInForce     `json:"timeInForce" db:"time_in_force"`
	ReservedCashPoints     int64           `json:"-" db:"reserved_points"`
	CapturedCashPoints     int64           `json:"-" db:"captured_points"`
	ReleasedCashPoints     int64           `json:"-" db:"released_points"`
	ReservedQuantity       int             `json:"reservedQuantity" db:"reserved_quantity"`
	AverageFillPricePoints *int            `json:"-" db:"average_fill_price_points"`
	FilledCostPoints       int64           `json:"filledCostPoints" db:"filled_cost_points"`
	FailureReason          *string         `json:"failureReason,omitempty" db:"failure_reason"`
	PostOnly               bool            `json:"postOnly" db:"post_only"`
	ClientOrderID          *string         `json:"clientOrderId,omitempty" db:"client_order_id"`
	SelfMatchAction        SelfMatchAction `json:"selfMatchAction" db:"self_match_action"`
	NotionalCapPoints      *int64          `json:"notionalCapPoints,omitempty" db:"notional_cap_points"`
}

func (o Order) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		ID                     string          `json:"id"`
		UserID                 string          `json:"userId"`
		MarketID               string          `json:"marketId"`
		Side                   OrderSide       `json:"side"`
		Action                 OrderAction     `json:"action"`
		OrderType              OrderType       `json:"orderType"`
		PricePoints            *int            `json:"pricePoints,omitempty"`
		Quantity               int             `json:"quantity"`
		FilledQuantity         int             `json:"filledQuantity"`
		RemainingQuantity      int             `json:"remainingQuantity"`
		Status                 OrderStatus     `json:"status"`
		IdempotencyKey         *string         `json:"idempotencyKey,omitempty"`
		ExpiresAt              *time.Time      `json:"expiresAt,omitempty"`
		FilledAt               *time.Time      `json:"filledAt,omitempty"`
		CancelledAt            *time.Time      `json:"cancelledAt,omitempty"`
		CreatedAt              time.Time       `json:"createdAt"`
		UpdatedAt              time.Time       `json:"updatedAt"`
		TimeInForce            TimeInForce     `json:"timeInForce"`
		ReservedQuantity       int             `json:"reservedQuantity"`
		AverageFillPricePoints *int            `json:"averageFillPricePoints,omitempty"`
		FailureReason          *string         `json:"failureReason,omitempty"`
		PostOnly               bool            `json:"postOnly"`
		ClientOrderID          *string         `json:"clientOrderId,omitempty"`
		SelfMatchAction        SelfMatchAction `json:"selfMatchAction"`
		TotalCostPoints        int64           `json:"totalCostPoints"`
		ReservedPoints         int64           `json:"reservedPoints"`
		CapturedPoints         int64           `json:"capturedPoints"`
		ReleasedPoints         int64           `json:"releasedPoints"`
		FilledCostPoints       int64           `json:"filledCostPoints"`
		NotionalCapPoints      *int64          `json:"notionalCapPoints,omitempty"`
		Unit                   string          `json:"unit"`
	}{
		ID:                     o.ID,
		UserID:                 o.UserID,
		MarketID:               o.MarketID,
		Side:                   o.Side,
		Action:                 o.Action,
		OrderType:              o.OrderType,
		PricePoints:            o.PricePoints,
		Quantity:               o.Quantity,
		FilledQuantity:         o.FilledQuantity,
		RemainingQuantity:      o.RemainingQuantity,
		Status:                 o.Status,
		IdempotencyKey:         o.IdempotencyKey,
		ExpiresAt:              o.ExpiresAt,
		FilledAt:               o.FilledAt,
		CancelledAt:            o.CancelledAt,
		CreatedAt:              o.CreatedAt,
		UpdatedAt:              o.UpdatedAt,
		TimeInForce:            o.TimeInForce,
		ReservedQuantity:       o.ReservedQuantity,
		AverageFillPricePoints: o.AverageFillPricePoints,
		FailureReason:          o.FailureReason,
		PostOnly:               o.PostOnly,
		ClientOrderID:          o.ClientOrderID,
		SelfMatchAction:        o.SelfMatchAction,
		TotalCostPoints:        o.TotalCostPoints,
		ReservedPoints:         o.ReservedCashPoints,
		CapturedPoints:         o.CapturedCashPoints,
		ReleasedPoints:         o.ReleasedCashPoints,
		FilledCostPoints:       o.FilledCostPoints,
		NotionalCapPoints:      o.NotionalCapPoints,
		Unit:                   "PTS",
	})
}

// Position represents a user's net holding in a market on one side.
type Position struct {
	ID                string    `json:"id" db:"id"`
	UserID            string    `json:"userId" db:"user_id"`
	MarketID          string    `json:"marketId" db:"market_id"`
	Side              OrderSide `json:"side" db:"side"`
	Quantity          int       `json:"quantity" db:"quantity"`
	AvgPricePoints    int       `json:"avgPricePoints" db:"avg_price_points"`
	TotalCostPoints   int64     `json:"totalCostPoints" db:"total_cost_points"`
	RealizedPnlPoints int64     `json:"realizedPnlPoints" db:"realized_pnl_points"`
	CreatedAt         time.Time `json:"createdAt" db:"created_at"`
	UpdatedAt         time.Time `json:"updatedAt" db:"updated_at"`

	// Exchange engine fields (migration 019). reserved_quantity is the count
	// of shares locked by resting sell orders. available = quantity - reserved.
	ReservedQuantity int `json:"reservedQuantity" db:"reserved_quantity"`
}

func (p Position) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		TotalCostPoints  int64     `json:"totalCostPoints"`
		RealizedPoints   int64     `json:"realizedPoints"`
		ID               string    `json:"id"`
		UserID           string    `json:"userId"`
		MarketID         string    `json:"marketId"`
		Side             OrderSide `json:"side"`
		Quantity         int       `json:"quantity"`
		AvgPricePoints   int       `json:"avgPricePoints"`
		CreatedAt        time.Time `json:"createdAt"`
		UpdatedAt        time.Time `json:"updatedAt"`
		ReservedQuantity int       `json:"reservedQuantity"`
		Unit             string    `json:"unit"`
	}{
		TotalCostPoints:  p.TotalCostPoints,
		RealizedPoints:   p.RealizedPnlPoints,
		ID:               p.ID,
		UserID:           p.UserID,
		MarketID:         p.MarketID,
		Side:             p.Side,
		Quantity:         p.Quantity,
		AvgPricePoints:   p.AvgPricePoints,
		CreatedAt:        p.CreatedAt,
		UpdatedAt:        p.UpdatedAt,
		ReservedQuantity: p.ReservedQuantity,
		Unit:             "PTS",
	})
}

// TradeKind distinguishes secondary transfers from complementary issuance.
type TradeKind string

const (
	TradeKindSecondary TradeKind = "secondary"
	TradeKindIssuance  TradeKind = "issuance"
)

// EngineKind tags trade rows with the engine that produced them.
type EngineKind string

const (
	EngineKindOrderBook EngineKind = "order_book"
	EngineKindAMM       EngineKind = "amm"
)

// Trade is an immutable fill record.
type Trade struct {
	ID          string    `json:"id" db:"id"`
	MarketID    string    `json:"marketId" db:"market_id"`
	BuyOrderID  *string   `json:"buyOrderId,omitempty" db:"buy_order_id"`
	SellOrderID *string   `json:"sellOrderId,omitempty" db:"sell_order_id"`
	BuyerID     string    `json:"buyerId" db:"buyer_id"`
	SellerID    *string   `json:"sellerId,omitempty" db:"seller_id"`
	Side        OrderSide `json:"side" db:"side"`
	PricePoints int       `json:"pricePoints" db:"price_points"`
	Quantity    int       `json:"quantity" db:"quantity"`
	FeePoints   int       `json:"feePoints" db:"fee_points"`
	IsAMMTrade  bool      `json:"isAmmTrade" db:"is_amm_trade"`
	TradedAt    time.Time `json:"tradedAt" db:"traded_at"`

	// Exchange engine fields (migration 019). MatchID links the two rows of a
	// complementary issuance fill; equals trade ID for secondary transfers.
	MatchID    string     `json:"matchId" db:"match_id"`
	TradeKind  TradeKind  `json:"tradeKind" db:"trade_kind"`
	EngineKind EngineKind `json:"engineKind" db:"engine_kind"`
}

func (t Trade) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		PricePoints    int        `json:"pricePoints"`
		FeePoints      int        `json:"feePoints"`
		NotionalPoints int64      `json:"notionalPoints"`
		Unit           string     `json:"unit"`
		ID             string     `json:"id"`
		MarketID       string     `json:"marketId"`
		BuyOrderID     *string    `json:"buyOrderId,omitempty"`
		SellOrderID    *string    `json:"sellOrderId,omitempty"`
		BuyerID        string     `json:"buyerId"`
		SellerID       *string    `json:"sellerId,omitempty"`
		Side           OrderSide  `json:"side"`
		Quantity       int        `json:"quantity"`
		IsAMMTrade     bool       `json:"isAmmTrade"`
		TradedAt       time.Time  `json:"tradedAt"`
		MatchID        string     `json:"matchId"`
		TradeKind      TradeKind  `json:"tradeKind"`
		EngineKind     EngineKind `json:"engineKind"`
	}{
		PricePoints:    t.PricePoints,
		FeePoints:      t.FeePoints,
		NotionalPoints: int64(t.PricePoints) * int64(t.Quantity),
		Unit:           "PTS",
		ID:             t.ID,
		MarketID:       t.MarketID,
		BuyOrderID:     t.BuyOrderID,
		SellOrderID:    t.SellOrderID,
		BuyerID:        t.BuyerID,
		SellerID:       t.SellerID,
		Side:           t.Side,
		Quantity:       t.Quantity,
		IsAMMTrade:     t.IsAMMTrade,
		TradedAt:       t.TradedAt,
		MatchID:        t.MatchID,
		TradeKind:      t.TradeKind,
		EngineKind:     t.EngineKind,
	})
}

// CollateralEntryType identifies a row in prediction_collateral_ledger.
type CollateralEntryType string

const (
	CollateralIssue            CollateralEntryType = "issue_collateral"
	CollateralSettlementPayout CollateralEntryType = "settlement_payout"
	CollateralFee              CollateralEntryType = "fee"
	CollateralRefund           CollateralEntryType = "refund"
	CollateralAdjustment       CollateralEntryType = "adjustment"
	CollateralRebate           CollateralEntryType = "rebate"
)

// CollateralDriftAlert summarises recent adjustment ledger rows on a market.
// Surfaced to backoffice ops so the risk page can highlight markets with
// unresolved drift detected by the reconciliation cron.
type CollateralDriftAlert struct {
	MarketID         string    `json:"marketId"`
	Ticker           string    `json:"ticker"`
	AdjustmentCount  int       `json:"adjustmentCount"`
	MaxDriftPoints   int64     `json:"maxDriftPoints"`
	TotalDriftPoints int64     `json:"totalDriftPoints"`
	LatestAdjustedAt time.Time `json:"latestAdjustedAt"`
	LatestReason     string    `json:"latestReason"`
}

func (a CollateralDriftAlert) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		MarketID         string    `json:"marketId"`
		Ticker           string    `json:"ticker"`
		AdjustmentCount  int       `json:"adjustmentCount"`
		MaxDriftPoints   int64     `json:"maxDriftPoints"`
		TotalDriftPoints int64     `json:"totalDriftPoints"`
		LatestAdjustedAt time.Time `json:"latestAdjustedAt"`
		LatestReason     string    `json:"latestReason"`
		Unit             string    `json:"unit"`
	}{
		MarketID:         a.MarketID,
		Ticker:           a.Ticker,
		AdjustmentCount:  a.AdjustmentCount,
		MaxDriftPoints:   a.MaxDriftPoints,
		TotalDriftPoints: a.TotalDriftPoints,
		LatestAdjustedAt: a.LatestAdjustedAt,
		LatestReason:     a.LatestReason,
		Unit:             "PTS",
	})
}

// CollateralLedgerEntry is an append-only collateral movement on a market.
type CollateralLedgerEntry struct {
	ID                 string              `json:"id" db:"id"`
	MarketID           string              `json:"marketId" db:"market_id"`
	TradeID            *string             `json:"tradeId,omitempty" db:"trade_id"`
	OrderID            *string             `json:"orderId,omitempty" db:"order_id"`
	UserID             *string             `json:"userId,omitempty" db:"user_id"`
	EntryType          CollateralEntryType `json:"entryType" db:"entry_type"`
	AmountPoints       int64               `json:"amountPoints" db:"amount_points"`
	BalanceAfterPoints int64               `json:"balanceAfterPoints" db:"balance_after_points"`
	Reason             string              `json:"reason" db:"reason"`
	CreatedAt          time.Time           `json:"createdAt" db:"created_at"`
}

// OrderBookLevel is one price level in the order book.
type OrderBookLevel struct {
	PricePoints int `json:"pricePoints"`
	Quantity    int `json:"quantity"`
	Total       int `json:"total"`
}

func (l OrderBookLevel) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		PricePoints         int    `json:"pricePoints"`
		Shares              int    `json:"shares"`
		CumulativeShares    int    `json:"cumulativeShares"`
		NotionalPoints      int64  `json:"notionalPoints"`
		TotalNotionalPoints int64  `json:"totalNotionalPoints"`
		Unit                string `json:"unit"`
	}{
		PricePoints:         l.PricePoints,
		Shares:              l.Quantity,
		CumulativeShares:    l.Total,
		NotionalPoints:      int64(l.PricePoints) * int64(l.Quantity),
		TotalNotionalPoints: int64(l.PricePoints) * int64(l.Total),
		Unit:                "PTS",
	})
}

// OrderBookSide is one side (yes or no) with bids and asks.
type OrderBookSide struct {
	Bids []OrderBookLevel `json:"bids"`
	Asks []OrderBookLevel `json:"asks"`
}

// OrderBook is the full L2 book for a market, returned by GET /orderbook.
type OrderBook struct {
	MarketID string        `json:"marketId"`
	Yes      OrderBookSide `json:"yes"`
	No       OrderBookSide `json:"no"`
}

// Settlement records a market resolution.
type Settlement struct {
	ID                string          `json:"id" db:"id"`
	MarketID          string          `json:"marketId" db:"market_id"`
	Result            MarketResult    `json:"result" db:"result"`
	AttestationSource string          `json:"attestationSource" db:"attestation_source"`
	AttestationID     *string         `json:"attestationId,omitempty" db:"attestation_id"`
	AttestationDigest *string         `json:"attestationDigest,omitempty" db:"attestation_digest"`
	AttestationData   json.RawMessage `json:"attestationData,omitempty" db:"attestation_data"`
	SettledBy         *string         `json:"settledBy,omitempty" db:"settled_by"`
	SettledAt         time.Time       `json:"settledAt" db:"settled_at"`
	TotalPayoutPoints int64           `json:"totalPayoutPoints" db:"total_payout_points"`
	PositionsSettled  int             `json:"positionsSettled" db:"positions_settled"`

	// Disbursement progress (migration 034, P3-12). PayoutsTotal is the number
	// of positions to pay, snapshotted when the header commits; PayoutsCompleted
	// advances as each payout batch commits. Completed < Total means a resume
	// pass must finish disbursing this settlement.
	PayoutsTotal     int `json:"payoutsTotal" db:"payouts_total"`
	PayoutsCompleted int `json:"payoutsCompleted" db:"payouts_completed"`

	// Admin override audit (migration 019). Either all three are null or all
	// three are set together; enforced by a CHECK constraint.
	OverrideReason     *string    `json:"overrideReason,omitempty" db:"override_reason"`
	OverriddenByUserID *string    `json:"overriddenByUserId,omitempty" db:"overridden_by_user_id"`
	OverriddenAt       *time.Time `json:"overriddenAt,omitempty" db:"overridden_at"`
}

// Payout records a per-position settlement credit.
type Payout struct {
	ID               string    `json:"id" db:"id"`
	SettlementID     string    `json:"settlementId" db:"settlement_id"`
	PositionID       string    `json:"positionId" db:"position_id"`
	UserID           string    `json:"userId" db:"user_id"`
	MarketID         string    `json:"marketId" db:"market_id"`
	Side             OrderSide `json:"side" db:"side"`
	Quantity         int       `json:"quantity" db:"quantity"`
	EntryPricePoints int       `json:"entryPricePoints" db:"entry_price_points"`
	ExitPricePoints  int       `json:"exitPricePoints" db:"exit_price_points"`
	PnlPoints        int64     `json:"pnlPoints" db:"pnl_points"`
	PayoutPoints     int64     `json:"payoutPoints" db:"payout_points"`
	PaidAt           time.Time `json:"paidAt" db:"paid_at"`
}

// LifecycleEvent records a market state transition.
type LifecycleEvent struct {
	ID         string          `json:"id" db:"id"`
	MarketID   string          `json:"marketId" db:"market_id"`
	EventType  string          `json:"eventType" db:"event_type"`
	ActorID    *string         `json:"actorId,omitempty" db:"actor_id"`
	ActorType  string          `json:"actorType" db:"actor_type"`
	Reason     *string         `json:"reason,omitempty" db:"reason"`
	Metadata   json.RawMessage `json:"metadata,omitempty" db:"metadata"`
	OccurredAt time.Time       `json:"occurredAt" db:"occurred_at"`
}

// APIKey represents a bot API key for programmatic access.
type APIKey struct {
	ID         string     `json:"id" db:"id"`
	UserID     string     `json:"userId" db:"user_id"`
	Name       string     `json:"name" db:"name"`
	KeyHash    string     `json:"-" db:"key_hash"`
	KeyPrefix  string     `json:"keyPrefix" db:"key_prefix"`
	Scopes     []string   `json:"scopes" db:"scopes"`
	Active     bool       `json:"active" db:"active"`
	ExpiresAt  *time.Time `json:"expiresAt,omitempty" db:"expires_at"`
	LastUsedAt *time.Time `json:"lastUsedAt,omitempty" db:"last_used_at"`
	CreatedAt  time.Time  `json:"createdAt" db:"created_at"`
}

// --- Request / Response types ---

// PlaceOrderRequest is the API request to place a new order.
type PlaceOrderRequest struct {
	MarketID       string      `json:"marketId" validate:"required"`
	Side           OrderSide   `json:"side" validate:"required,oneof=yes no"`
	Action         OrderAction `json:"action" validate:"required,oneof=buy sell"`
	OrderType      OrderType   `json:"orderType" validate:"required,oneof=market limit"`
	PricePoints    *int        `json:"-"`
	Quantity       int         `json:"quantity" validate:"required,gt=0"`
	IdempotencyKey *string     `json:"idempotencyKey,omitempty"`

	// Exchange engine fields (ignored on AMM-mode markets).
	TimeInForce       TimeInForce     `json:"timeInForce,omitempty"`
	PostOnly          bool            `json:"postOnly,omitempty"`
	ClientOrderID     *string         `json:"clientOrderId,omitempty"`
	SelfMatchAction   SelfMatchAction `json:"selfMatchAction,omitempty"`
	NotionalCapPoints *int64          `json:"notionalCapPoints,omitempty"`
}

func (r *PlaceOrderRequest) UnmarshalJSON(data []byte) error {
	type alias PlaceOrderRequest
	aux := struct {
		alias
		PricePoints       *int   `json:"pricePoints,omitempty"`
		NotionalCapPoints *int64 `json:"notionalCapPoints,omitempty"`
	}{}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	*r = PlaceOrderRequest(aux.alias)
	if aux.PricePoints != nil {
		r.PricePoints = aux.PricePoints
	}
	if r.NotionalCapPoints == nil && aux.NotionalCapPoints != nil {
		r.NotionalCapPoints = aux.NotionalCapPoints
	}
	return nil
}

// OrderPreview is the response from previewing an order cost.
type OrderPreview struct {
	Side                    OrderSide     `json:"side"`
	Action                  OrderAction   `json:"action"`
	Quantity                int           `json:"quantity"`
	PricePoints             int           `json:"pricePoints"`
	TotalCost               int64         `json:"totalCostPoints"`
	FeePoints               int64         `json:"feePoints"`
	MaxProfit               int64         `json:"maxProfitPoints"`
	MaxLoss                 int64         `json:"maxLossPoints"`
	NewYesPrice             int           `json:"newYesPricePoints"`
	NewNoPrice              int           `json:"newNoPricePoints"`
	ExecutionMode           ExecutionMode `json:"executionMode,omitempty"`
	FilledQuantity          int           `json:"filledQuantity"`
	UnfilledQuantity        int           `json:"unfilledQuantity"`
	AverageFillPricePoints  int           `json:"averageFillPricePoints"`
	TotalCostWithFeesPoints int64         `json:"totalCostWithFeesPoints"`
	EstimatedSlippagePoints int           `json:"estimatedSlippagePoints"`
	QuoteStatus             OrderStatus   `json:"quoteStatus,omitempty"`
	QuoteStaleAfterMillis   int64         `json:"quoteStaleAfterMillis,omitempty"`
	QuoteGeneratedAtUnixSec int64         `json:"quoteGeneratedAtUnixSec,omitempty"`
}

func (p OrderPreview) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Side                    OrderSide     `json:"side"`
		Action                  OrderAction   `json:"action"`
		Quantity                int           `json:"quantity"`
		PricePoints             int           `json:"pricePoints"`
		TotalCostPoints         int64         `json:"totalCostPoints"`
		FeePoints               int64         `json:"feePoints"`
		MaxResultPoints         int64         `json:"maxResultPoints"`
		MaxLossPoints           int64         `json:"maxLossPoints"`
		NewYesPricePoints       int           `json:"newYesPricePoints"`
		NewNoPricePoints        int           `json:"newNoPricePoints"`
		ExecutionMode           ExecutionMode `json:"executionMode,omitempty"`
		FilledQuantity          int           `json:"filledQuantity"`
		UnfilledQuantity        int           `json:"unfilledQuantity"`
		AverageFillPricePoints  int           `json:"averageFillPricePoints"`
		TotalCostWithFeesPoints int64         `json:"totalCostWithFeesPoints"`
		EstimatedSlippagePoints int           `json:"estimatedSlippagePoints"`
		QuoteStatus             OrderStatus   `json:"quoteStatus,omitempty"`
		QuoteStaleAfterMillis   int64         `json:"quoteStaleAfterMillis,omitempty"`
		QuoteGeneratedAtUnixSec int64         `json:"quoteGeneratedAtUnixSec,omitempty"`
		Unit                    string        `json:"unit"`
	}{
		Side:                    p.Side,
		Action:                  p.Action,
		Quantity:                p.Quantity,
		PricePoints:             p.PricePoints,
		TotalCostPoints:         p.TotalCost,
		FeePoints:               p.FeePoints,
		MaxResultPoints:         p.MaxProfit,
		MaxLossPoints:           p.MaxLoss,
		NewYesPricePoints:       p.NewYesPrice,
		NewNoPricePoints:        p.NewNoPrice,
		ExecutionMode:           p.ExecutionMode,
		FilledQuantity:          p.FilledQuantity,
		UnfilledQuantity:        p.UnfilledQuantity,
		AverageFillPricePoints:  p.AverageFillPricePoints,
		TotalCostWithFeesPoints: p.TotalCostWithFeesPoints,
		EstimatedSlippagePoints: p.EstimatedSlippagePoints,
		QuoteStatus:             p.QuoteStatus,
		QuoteStaleAfterMillis:   p.QuoteStaleAfterMillis,
		QuoteGeneratedAtUnixSec: p.QuoteGeneratedAtUnixSec,
		Unit:                    "PTS",
	})
}

// PortfolioSummary provides a user's aggregate prediction stats.
type PortfolioSummary struct {
	TotalValuePoints    int64   `json:"totalValuePoints"`
	UnrealizedPnlPoints int64   `json:"unrealizedPnlPoints"`
	RealizedPnlPoints   int64   `json:"realizedPnlPoints"`
	OpenPositions       int     `json:"openPositions"`
	TotalPredictions    int     `json:"totalPredictions"`
	CorrectPredictions  int     `json:"correctPredictions"`
	AccuracyPct         float64 `json:"accuracyPct"`
}

func (s PortfolioSummary) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		TotalValuePoints     int64   `json:"totalValuePoints"`
		UnrealizedPoints     int64   `json:"unrealizedPoints"`
		RealizedPoints       int64   `json:"realizedPoints"`
		InvestedPoints       int64   `json:"investedPoints"`
		PortfolioValuePoints int64   `json:"portfolioValuePoints"`
		OpenPositions        int     `json:"openPositions"`
		TotalPredictions     int     `json:"totalPredictions"`
		CorrectPredictions   int     `json:"correctPredictions"`
		AccuracyPct          float64 `json:"accuracyPct"`
		Unit                 string  `json:"unit"`
	}{
		TotalValuePoints:     s.TotalValuePoints,
		UnrealizedPoints:     s.UnrealizedPnlPoints,
		RealizedPoints:       s.RealizedPnlPoints,
		InvestedPoints:       s.TotalValuePoints,
		PortfolioValuePoints: s.TotalValuePoints,
		OpenPositions:        s.OpenPositions,
		TotalPredictions:     s.TotalPredictions,
		CorrectPredictions:   s.CorrectPredictions,
		AccuracyPct:          s.AccuracyPct,
		Unit:                 "PTS",
	})
}

// DiscoveryResponse groups markets for the discovery page.
type DiscoveryResponse struct {
	Featured    []Market `json:"featured"`
	Trending    []Market `json:"trending"`
	ClosingSoon []Market `json:"closingSoon"`
	Recent      []Market `json:"recent"`
}

// CreateEventRequest is the admin request to create a new event. New events
// start in 'draft' status. CreatedBy is server-set from the session (json:"-").
type CreateEventRequest struct {
	SeriesID    *string         `json:"seriesId,omitempty"`
	Title       string          `json:"title" validate:"required"`
	Description string          `json:"description,omitempty"`
	CategoryID  string          `json:"categoryId" validate:"required"`
	Featured    bool            `json:"featured"`
	OpenAt      *time.Time      `json:"openAt,omitempty"`
	CloseAt     time.Time       `json:"closeAt" validate:"required"`
	Metadata    json.RawMessage `json:"metadata,omitempty"`
	CreatedBy   *string         `json:"-"`

	// CoverImageURL: optional home-rail cover (/images/ path or https URL).
	CoverImageURL *string `json:"coverImageUrl,omitempty"`
}

// UpdateEventPresentationRequest is the admin request that curates how an
// event appears on the home page: whether it is featured and its cover
// photo. Nil fields are left unchanged; an empty CoverImageURL clears it.
// It never touches lifecycle, pricing or settlement.
type UpdateEventPresentationRequest struct {
	Featured      *bool   `json:"featured,omitempty"`
	CoverImageURL *string `json:"coverImageUrl,omitempty"`
}

// CreateMarketRequest is the admin request to create a new market.
type CreateMarketRequest struct {
	EventID             string          `json:"eventId" validate:"required"`
	Ticker              string          `json:"ticker" validate:"required"`
	Title               string          `json:"title" validate:"required"`
	Description         string          `json:"description,omitempty"`
	Translations        json.RawMessage `json:"translations,omitempty"`
	SettlementSourceKey string          `json:"settlementSourceKey" validate:"required"`
	SettlementRule      string          `json:"settlementRule" validate:"required"`
	SettlementParams    json.RawMessage `json:"settlementParams,omitempty"`
	FallbackSourceKey   *string         `json:"fallbackSourceKey,omitempty"`
	CloseAt             time.Time       `json:"closeAt" validate:"required"`
	SettlementCutoffAt  *time.Time      `json:"settlementCutoffAt,omitempty"`
	FeeRateBps          int             `json:"feeRateBps"`
	AMMLiquidityParam   float64         `json:"ammLiquidityParam"`
	AMMSubsidyPoints    int64           `json:"ammSubsidyPoints"`
	ArticleSourceID     *string         `json:"articleSourceId,omitempty"`
	AIGenerationLogIDs  []string        `json:"aiGenerationLogIds,omitempty"`
	CreatedBy           *string         `json:"-"`
}

// ArticleSource is the provenance record for an AI-drafted market's source
// article (migration 024). Only an excerpt + AI summary + a SHA-256 of the
// article text are stored, never the full copyrighted body.
type ArticleSource struct {
	ID           string          `json:"id" db:"id"`
	SourceURL    *string         `json:"sourceUrl,omitempty" db:"source_url"`
	SourceName   *string         `json:"sourceName,omitempty" db:"source_name"`
	Title        *string         `json:"title,omitempty" db:"title"`
	Author       *string         `json:"author,omitempty" db:"author"`
	PublishedAt  *time.Time      `json:"publishedAt,omitempty" db:"published_at"`
	Language     string          `json:"language" db:"language"`
	Jurisdiction json.RawMessage `json:"jurisdiction,omitempty" db:"jurisdiction"`
	Excerpt      *string         `json:"excerpt,omitempty" db:"excerpt"`
	Summary      *string         `json:"summary,omitempty" db:"summary"`
	TextHash     string          `json:"textHash" db:"text_hash"`
	CreatedBy    *string         `json:"createdBy,omitempty" db:"created_by"`
	CreatedAt    time.Time       `json:"createdAt" db:"created_at"`
	UpdatedAt    time.Time       `json:"updatedAt" db:"updated_at"`
}

// AIGenerationLog is one model call in the market-drafting pipeline
// (migration 024), stored for audit, legal defensibility, and model
// evaluation. InputJSON is redacted/truncated upstream — it must never carry
// the full copyrighted article body.
type AIGenerationLog struct {
	ID                string          `json:"id" db:"id"`
	ArticleSourceID   *string         `json:"articleSourceId,omitempty" db:"article_source_id"`
	MarketID          *string         `json:"marketId,omitempty" db:"market_id"`
	Stage             string          `json:"stage" db:"stage"`
	Tier              *string         `json:"tier,omitempty" db:"tier"`
	ModelProvider     *string         `json:"modelProvider,omitempty" db:"model_provider"`
	ModelName         *string         `json:"modelName,omitempty" db:"model_name"`
	InferenceEndpoint *string         `json:"inferenceEndpoint,omitempty" db:"inference_endpoint"`
	PromptVersion     *string         `json:"promptVersion,omitempty" db:"prompt_version"`
	InputJSON         json.RawMessage `json:"inputJson,omitempty" db:"input_json"`
	OutputJSON        json.RawMessage `json:"outputJson,omitempty" db:"output_json"`
	RiskLevel         *string         `json:"riskLevel,omitempty" db:"risk_level"`
	ValidatorResult   json.RawMessage `json:"validatorResult,omitempty" db:"validator_result"`
	Blocked           bool            `json:"blocked" db:"blocked"`
	LatencyMs         *int            `json:"latencyMs,omitempty" db:"latency_ms"`
	InputTokens       *int            `json:"inputTokens,omitempty" db:"input_tokens"`
	OutputTokens      *int            `json:"outputTokens,omitempty" db:"output_tokens"`
	CostMicros        *int64          `json:"costMicros,omitempty" db:"cost_micros"`
	CreatedBy         *string         `json:"createdBy,omitempty" db:"created_by"`
	RequestID         *string         `json:"requestId,omitempty" db:"request_id"`
	ErrorMessage      *string         `json:"errorMessage,omitempty" db:"error_message"`
	CreatedAt         time.Time       `json:"createdAt" db:"created_at"`
}

// CreateMarketSourceRequest is the admin request to persist AI-drafting
// provenance: the source article (deduped on TextHash) plus the generation-log
// entries that produced the draft. Server-set fields on Source (ID, CreatedAt,
// UpdatedAt) are ignored.
type CreateMarketSourceRequest struct {
	Source         ArticleSource     `json:"source"`
	GenerationLogs []AIGenerationLog `json:"generationLogs,omitempty"`
}

// CreateMarketSourceResponse returns the (deduped) article source id.
type CreateMarketSourceResponse struct {
	ArticleSourceID    string   `json:"articleSourceId"`
	AIGenerationLogIDs []string `json:"aiGenerationLogIds,omitempty"`
}

// AIBudgetStatus is the per-admin AI-drafting budget check (plan §17c). Rate is
// requests/minute; the spend cap is token-based (a robust, price-drift-free
// proxy summed from the generation logs). Caps come from env
// (AI_DRAFT_RATE_PER_MIN, AI_DRAFT_DAILY_TOKEN_CAP).
type AIBudgetStatus struct {
	Allowed            bool   `json:"allowed"`
	Reason             string `json:"reason,omitempty"`
	RequestsLastMinute int    `json:"requestsLastMinute"`
	RatePerMinute      int    `json:"ratePerMinute"`
	TokensToday        int64  `json:"tokensToday"`
	DailyTokenCap      int64  `json:"dailyTokenCap"`
}

// ReserveAIBudgetRequest reserves one draft attempt before model spend. The
// token estimate is conservative and allows the daily cap to fail closed under
// concurrent requests before provider cost is incurred.
type ReserveAIBudgetRequest struct {
	EstimatedInputTokens int `json:"estimatedInputTokens"`
}

// ResolveMarketRequest is the admin request to settle a market.
type ResolveMarketRequest struct {
	Result            MarketResult    `json:"result" validate:"required,oneof=yes no"`
	AttestationSource string          `json:"attestationSource" validate:"required"`
	AttestationID     *string         `json:"attestationId,omitempty"`
	AttestationData   json.RawMessage `json:"attestationData,omitempty"`
	Reason            *string         `json:"reason,omitempty"`
	// OverrideReason is required when the gateway detects a collateral
	// imbalance (reconciliation drift on this market). Empty/nil means
	// the admin isn't asserting an override; the gateway will reject the
	// settle if the invariant doesn't hold. A non-empty value lands on
	// the persisted Settlement row and drives the metrics override flag.
	OverrideReason *string `json:"overrideReason,omitempty"`
}

// PageMeta provides pagination metadata in list responses.
type PageMeta struct {
	Page     int  `json:"page"`
	PageSize int  `json:"pageSize"`
	Total    int  `json:"total"`
	HasNext  bool `json:"hasNext"`
}

// DashboardMover is a single market in the "biggest YES price moves" list,
// computed as the difference between the first and last YES trade in the window.
type DashboardMover struct {
	MarketID            string `json:"marketId"`
	Ticker              string `json:"ticker"`
	Title               string `json:"title"`
	YesPricePointsStart int    `json:"yesPricePointsStart"`
	YesPricePointsNow   int    `json:"yesPricePointsNow"`
	VolumePoints        int64  `json:"volumePoints"`
}

func (m DashboardMover) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		MarketID            string `json:"marketId"`
		Ticker              string `json:"ticker"`
		Title               string `json:"title"`
		YesPricePointsStart int    `json:"yesPricePointsStart"`
		YesPricePointsNow   int    `json:"yesPricePointsNow"`
		VolumePoints        int64  `json:"volumePoints"`
		Unit                string `json:"unit"`
	}{
		MarketID:            m.MarketID,
		Ticker:              m.Ticker,
		Title:               m.Title,
		YesPricePointsStart: m.YesPricePointsStart,
		YesPricePointsNow:   m.YesPricePointsNow,
		VolumePoints:        m.VolumePoints,
		Unit:                "PTS",
	})
}

// DashboardVolumeStats aggregates trade activity over a time window for the
// admin dashboard. Computed from prediction_trades; window is open-bounded
// at Since (exclusive) and the present.
type DashboardVolumeStats struct {
	Since             time.Time        `json:"since"`
	WindowSeconds     int              `json:"windowSeconds"`
	TotalVolumePoints int64            `json:"totalVolumePoints"`
	TradeCount        int              `json:"tradeCount"`
	TopMovers         []DashboardMover `json:"topMovers"`
}

func (s DashboardVolumeStats) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Since             time.Time        `json:"since"`
		WindowSeconds     int              `json:"windowSeconds"`
		TotalVolumePoints int64            `json:"totalVolumePoints"`
		TradeCount        int              `json:"tradeCount"`
		TopMovers         []DashboardMover `json:"topMovers"`
		Unit              string           `json:"unit"`
	}{
		Since:             s.Since,
		WindowSeconds:     s.WindowSeconds,
		TotalVolumePoints: s.TotalVolumePoints,
		TradeCount:        s.TradeCount,
		TopMovers:         s.TopMovers,
		Unit:              "PTS",
	})
}

// PricePoint is a single bucket in a market's price-history series.
// YesPricePoints is the volume-weighted mean YES price across all trades
// in the bucket; bucket boundaries are aligned to the requested
// resolution. Buckets with zero trades are carried forward from the
// previous known price so charts render a continuous line.
type PricePoint struct {
	BucketStart    time.Time `json:"bucketStart"`
	YesPricePoints int       `json:"yesPricePoints"`
	TradeCount     int       `json:"tradeCount"`
	VolumePoints   int64     `json:"volumePoints"`
}

func (p PricePoint) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		BucketStart    time.Time `json:"bucketStart"`
		YesPricePoints int       `json:"yesPricePoints"`
		TradeCount     int       `json:"tradeCount"`
		VolumePoints   int64     `json:"volumePoints"`
		Unit           string    `json:"unit"`
	}{
		BucketStart:    p.BucketStart,
		YesPricePoints: p.YesPricePoints,
		TradeCount:     p.TradeCount,
		VolumePoints:   p.VolumePoints,
		Unit:           "PTS",
	})
}

// PriceHistoryRange is the set of time windows the
// /api/v1/markets/{id}/prices?range= query accepts. Each constant pairs
// the window with the bucket resolution we aggregate at — see
// PriceHistoryWindow for the (since, bucketSec) mapping.
type PriceHistoryRange string

const (
	PriceHistoryRange1H  PriceHistoryRange = "1h"
	PriceHistoryRange1D  PriceHistoryRange = "1d"
	PriceHistoryRange1W  PriceHistoryRange = "1w"
	PriceHistoryRange1M  PriceHistoryRange = "1m"
	PriceHistoryRangeAll PriceHistoryRange = "all"
)

// PriceHistoryResponse wraps the points + metadata so clients can render
// axes / labels without re-deriving the window.
type PriceHistoryResponse struct {
	MarketID  string       `json:"marketId"`
	Range     string       `json:"range"`
	Since     time.Time    `json:"since"`
	Until     time.Time    `json:"until"`
	BucketSec int          `json:"bucketSec"`
	Points    []PricePoint `json:"points"`
}
