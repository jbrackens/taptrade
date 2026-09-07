package prediction

// Accounting holds pure-function helpers used by the exchange engine. No DB,
// no time, no IO — easy to test and verify.
//
// Math conventions:
//   - prices are integer cents in [1, 99]
//   - quantities are integer share counts
//   - fees and balances are int64 cents
//   - integer division is intentional (rounds toward zero); the rounding rules
//     are documented per function. Where rounding matters we round the way
//     the user expects: down for fees (favor user), down for average cost,
//     exact for collateral.

// MinTickPricePoints and MaxTickPricePoints are the inclusive bounds of a
// prediction-market price. Outside this range orders are rejected at the API
// boundary with FailurePriceBandViolation.
const (
	MinTickPricePoints = 1
	MaxTickPricePoints = 99
	ParPricePoints     = 100 // YES + NO must always sum to par
)

// DefaultTakerFeeBps is the v1 flat-rate taker fee applied to every new
// market created via Service.CreateMarket when the caller doesn't set
// fee_rate_bps explicitly. The 2026-04-24 fee-model design call settled
// on a minimal flat 100 bps + instrument retention-vs-fees metrics
// rather than committing to a Kalshi-style price curve or Polymarket-
// style category tiers before the growth mechanic was understood. The
// Week-6 decision gate revisits this with sample-size data; until
// then, 100 bps is the policy.
//
// Existing markets keep whatever fee_rate_bps they were created with.
// The migration that backfills the default for already-zero markets is
// captured separately so the demo-state numbers stay predictable.
const DefaultTakerFeeBps = 100

// PriceWithinBounds returns true when pricePoints is in [1, 99].
func PriceWithinBounds(pricePoints int) bool {
	return pricePoints >= MinTickPricePoints && pricePoints <= MaxTickPricePoints
}

// CalculateTakerFeePoints returns the v1 taker fee for a single fill:
//
//	floor(takerFeeBps × pricePoints × (100 - pricePoints) × quantity / 1_000_000)
//
// Bps are basis points (1bp = 0.01%). Default in Tap Trade is DefaultTakerFeeBps
// (100 = 1%), applied per the 2026-04-24 fee-model decision and peaking at
// 0.25¢/contract at p=50, tapering toward 0 at the price extremes. Maker
// fees are always 0 in v1.
//
// Returns 0 for non-positive inputs and for prices at the par extremes.
func CalculateTakerFeePoints(takerFeeBps, pricePoints, quantity int) int64 {
	if takerFeeBps <= 0 || quantity <= 0 || !PriceWithinBounds(pricePoints) {
		return 0
	}
	complement := ParPricePoints - pricePoints
	num := int64(takerFeeBps) * int64(pricePoints) * int64(complement) * int64(quantity)
	return num / 1_000_000
}

// AverageCostAfterBuy returns the new average cost after adding `addQty`
// shares at `addPricePoints` to a position with `existingQty` at
// `existingAvgPoints`. Integer arithmetic; rounds toward zero.
//
// Empty positions: when existingQty <= 0, returns addPricePoints.
// Zero-add: when addQty <= 0, returns existingAvgPoints unchanged.
func AverageCostAfterBuy(existingQty, existingAvgPoints, addQty, addPricePoints int) int {
	if addQty <= 0 {
		return existingAvgPoints
	}
	if existingQty <= 0 {
		return addPricePoints
	}
	totalCost := existingQty*existingAvgPoints + addQty*addPricePoints
	totalQty := existingQty + addQty
	return totalCost / totalQty
}

// RealizedPnLOnSell returns the realized PnL (in cents) when selling `qty`
// shares from a position with `existingAvgPoints` at `salePricePoints`.
// Negative when the sale is a loss.
func RealizedPnLOnSell(qty, existingAvgPoints, salePricePoints int) int64 {
	if qty <= 0 {
		return 0
	}
	return int64(qty) * (int64(salePricePoints) - int64(existingAvgPoints))
}

// IssuanceFillFeasible reports whether two same-direction Buy orders on
// opposite sides (one Buy YES, one Buy NO) can mint a complementary pair.
// Condition: takerLimit + makerLimit >= 100.
//
// When feasible, the maker pays makerLimit and the taker pays
// (100 - makerLimit), with the taker reserving against takerLimit and any
// surplus released at commit. See ComplementaryTakerPricePoints.
func IssuanceFillFeasible(takerLimit, makerLimit int) bool {
	if !PriceWithinBounds(takerLimit) || !PriceWithinBounds(makerLimit) {
		return false
	}
	return takerLimit+makerLimit >= ParPricePoints
}

// ComplementaryTakerPricePoints returns the price the taker actually pays in
// a complementary issuance fill: 100 - makerLimit. The taker may have set a
// higher limit; the surplus is released from their point reservation at
// commit (no separate refund).
func ComplementaryTakerPricePoints(makerLimit int) int {
	return ParPricePoints - makerLimit
}

// SecondaryTransferCanCross reports whether a secondary same-side transfer
// can fill: a Buy crosses a Sell when buy.limit >= sell.limit (i.e., the
// buyer is willing to pay at least what the seller is asking).
func SecondaryTransferCanCross(buyLimit, sellLimit int) bool {
	return buyLimit >= sellLimit
}

// CollateralPoolDelta returns the per-fill change to a market's collateral
// pool. Issuance increases the pool by 100¢ × quantity; secondary transfers
// leave it unchanged.
func CollateralPoolDelta(kind TradeKind, quantity int) int64 {
	if kind != TradeKindIssuance || quantity <= 0 {
		return 0
	}
	return int64(quantity) * int64(ParPricePoints)
}

// AvailableQuantity returns the count of shares a user can currently sell
// from a position: total quantity minus shares locked by resting sell orders.
func AvailableQuantity(p *Position) int {
	if p == nil {
		return 0
	}
	avail := p.Quantity - p.ReservedQuantity
	if avail < 0 {
		return 0
	}
	return avail
}

// SellExceedsOwned reports whether selling soldQty shares would exceed what
// the owner can actually deliver (owned minus shares already locked by
// resting sell orders). Pure so the money-safety decision is deterministically
// testable. Pre-trade validation (ValidatePlaceOrderRequest) reads a snapshot
// that can go stale before the match commits; PersistMatchAtomic re-checks
// this under the per-market advisory lock + row lock so two concurrent sells
// of the same position cannot both be credited (UAT D-1 / codex [P1]).
func SellExceedsOwned(soldQty, ownedQty, reservedQty int) bool {
	avail := ownedQty - reservedQty
	if avail < 0 {
		avail = 0
	}
	return soldQty > avail
}

// SellerPositionKey identifies one user's position on one side that a match
// reduces via sell fills.
type SellerPositionKey struct {
	UserID string
	Side   OrderSide
}

// AggregateSoldQty sums the share quantity each (user, side) is selling
// across a match plan's position mutations (every sell fill — taker AND
// resting makers). PersistMatchAtomic uses this to authoritatively re-check
// every seller against owned shares under the per-market advisory lock.
// The original D-1 guard only re-checked plan.Taker, so two resting maker
// sells by one user that together exceed their position both filled and
// both credited proceeds while ApplyPositionMutation silently clamped the
// phantom shares to zero — the same double-payout class D-1 fixed, via the
// maker leg it didn't cover (UAT 2026-05-17 LC-31).
func AggregateSoldQty(muts []PositionMutation) map[SellerPositionKey]int {
	out := make(map[SellerPositionKey]int)
	for _, m := range muts {
		if !m.IsSell || m.DeltaQty >= 0 {
			continue
		}
		out[SellerPositionKey{UserID: m.UserID, Side: m.Side}] += -m.DeltaQty
	}
	return out
}

// PositionMutation describes a single fill's effect on one user's position
// on one side. The exchange engine emits one mutation per fill; the
// persistence layer aggregates them by (user_id, market_id, side), applies
// each in order to the loaded existing position via ApplyPositionMutation,
// and upserts the final state.
type PositionMutation struct {
	UserID          string
	MarketID        string
	Side            OrderSide
	DeltaQty        int  // positive on buy, negative on sell
	FillPricePoints int  // the per-share price for this fill
	IsSell          bool // explicit; redundant with sign(DeltaQty) but clearer
}

// ApplyPositionMutation merges a single mutation into a Position struct.
// On buy: adds qty and increments TotalCostPoints by addQty × fillPx; AvgPricePoints
// is then derived as TotalCostPoints / Quantity. Computing avg from the cumulative
// cost (rather than via running-average against the previous AvgPricePoints) avoids
// truncation drift across partial fills: a 1000-share order that gets sliced into
// 10 partial fills now produces the same avg-cost as the same order as one fill,
// within the same 1¢ rounding that a single division would have. Caught by
// TestProp_ApplyPositionMutation_FillFragmentationStable: the prior running-avg
// path drifted by up to ~5¢ for users whose orders crossed many makers.
//
// On sell: realises PnL against existing avg-cost, leaves avg-cost unchanged,
// reduces qty (clamped at zero), reduces TotalCostPoints proportionally to the
// shares removed.
//
// The Position struct is mutated in place. Caller is responsible for
// persisting the result.
func ApplyPositionMutation(p *Position, m PositionMutation) {
	if p == nil || m.DeltaQty == 0 {
		return
	}
	if m.IsSell {
		soldQty := -m.DeltaQty
		if soldQty < 0 {
			soldQty = -soldQty
		}
		p.RealizedPnlPoints += RealizedPnLOnSell(soldQty, p.AvgPricePoints, m.FillPricePoints)
		p.Quantity -= soldQty
		if p.Quantity < 0 {
			p.Quantity = 0
		}
		// Recompute TotalCost from quantity × avg. Sells don't change avg, so
		// this preserves the per-share basis and shrinks the dollar basis
		// proportionally to the shares removed.
		p.TotalCostPoints = int64(p.Quantity) * int64(p.AvgPricePoints)
		return
	}
	addQty := m.DeltaQty
	if addQty < 0 {
		addQty = -addQty
	}
	p.TotalCostPoints += int64(addQty) * int64(m.FillPricePoints)
	p.Quantity += addQty
	if p.Quantity > 0 {
		p.AvgPricePoints = int(p.TotalCostPoints / int64(p.Quantity))
	}
}
