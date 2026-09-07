package prediction

// Microbenchmarks for the matching engine's hot path (BuildPlan).
//
// These exercise the pure-function side of the engine — no DB, no HTTP, no
// advisory lock. They answer "how fast can the matcher itself walk N makers
// and produce a plan." For end-to-end throughput including persistence and
// the advisory lock, see cmd/loadtest/.
//
// Run with:
//
//	go test ./internal/prediction/ -bench=. -run=^$ -benchmem
//
// Snapshot the numbers in a doc; re-run on every PR that touches the engine
// to catch regressions.

import (
	"fmt"
	"testing"
	"time"
)

// benchOrder builds a resting limit order at the given price+qty. The ID is
// derived from a counter so trades reference distinct makers.
func benchOrder(id string, action OrderAction, side OrderSide, pricePoints, qty int) Order {
	p := pricePoints
	return Order{
		ID:                id,
		UserID:            "maker-" + id,
		MarketID:          "market-x",
		Side:              side,
		Action:            action,
		OrderType:         OrderTypeLimit,
		PricePoints:       &p,
		Quantity:          qty,
		FilledQuantity:    0,
		RemainingQuantity: qty,
		Status:            OrderStatusOpen,
		TimeInForce:       TIFGTC,
		SelfMatchAction:   SelfMatchCancelTaker,
	}
}

// buildBook returns N resting Sell-YES makers at descending prices, each
// holding `perOrder` contracts. Suitable as MakersSecondary for a Buy-YES taker.
func buildBook(n, perOrder int) []Order {
	makers := make([]Order, 0, n)
	// Best ask first (lowest sell price). Walk down from 90 to 50, cycling.
	for i := 0; i < n; i++ {
		price := 50 + (i % 40) // 50..89
		makers = append(makers, benchOrder(
			fmt.Sprintf("m-%d", i),
			OrderActionSell, OrderSideYes,
			price, perOrder,
		))
	}
	return makers
}

// BenchmarkBuildPlan_FullCross sweeps depth: a Buy-YES taker that consumes
// the entire book in one shot. This is the hot path for a market order
// against a fully-stocked book.
func BenchmarkBuildPlan_FullCross(b *testing.B) {
	for _, depth := range []int{1, 10, 50, 100} {
		b.Run(fmt.Sprintf("makers=%d", depth), func(b *testing.B) {
			makers := buildBook(depth, 10)
			market := makeMarket()
			now := time.Date(2026, 5, 11, 0, 0, 0, 0, time.UTC)
			engine := NewExchangeEngine()
			ids := counterIDs()
			takerPrice := 99
			taker := Order{
				ID:                "taker-1",
				UserID:            "taker-user",
				MarketID:          "market-x",
				Side:              OrderSideYes,
				Action:            OrderActionBuy,
				OrderType:         OrderTypeLimit,
				PricePoints:       &takerPrice,
				Quantity:          depth * 10,
				RemainingQuantity: depth * 10,
				Status:            OrderStatusPending,
				TimeInForce:       TIFGTC,
				SelfMatchAction:   SelfMatchCancelTaker,
			}
			input := MatchInput{
				Market:          market,
				Taker:           taker,
				MakersSecondary: makers,
				Now:             now,
				IDFactory:       ids,
			}
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_, err := engine.BuildPlan(input)
				if err != nil {
					b.Fatalf("BuildPlan: %v", err)
				}
			}
		})
	}
}

// BenchmarkBuildPlan_NoMatch measures the fast-path cost: a limit order
// that crosses no makers and rests on the book. This is the most common
// case under thin liquidity (which is where Tap Trade launches).
func BenchmarkBuildPlan_NoMatch(b *testing.B) {
	market := makeMarket()
	now := time.Date(2026, 5, 11, 0, 0, 0, 0, time.UTC)
	engine := NewExchangeEngine()
	ids := counterIDs()
	// Taker bids 40¢; makers ask 50+. No cross.
	takerPrice := 40
	taker := Order{
		ID:                "taker-1",
		UserID:            "taker-user",
		MarketID:          "market-x",
		Side:              OrderSideYes,
		Action:            OrderActionBuy,
		OrderType:         OrderTypeLimit,
		PricePoints:       &takerPrice,
		Quantity:          100,
		RemainingQuantity: 100,
		Status:            OrderStatusPending,
		TimeInForce:       TIFGTC,
		SelfMatchAction:   SelfMatchCancelTaker,
	}
	makers := buildBook(20, 10)
	input := MatchInput{
		Market:          market,
		Taker:           taker,
		MakersSecondary: makers,
		Now:             now,
		IDFactory:       ids,
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := engine.BuildPlan(input)
		if err != nil {
			b.Fatalf("BuildPlan: %v", err)
		}
	}
}

// BenchmarkBuildPlan_Issuance measures complementary issuance: taker buys
// YES, no secondary makers, but a stack of Buy-NO makers at complementary
// prices. Each fill mints a YES+NO pair.
func BenchmarkBuildPlan_Issuance(b *testing.B) {
	for _, depth := range []int{1, 10, 50} {
		b.Run(fmt.Sprintf("makers=%d", depth), func(b *testing.B) {
			market := makeMarket()
			now := time.Date(2026, 5, 11, 0, 0, 0, 0, time.UTC)
			engine := NewExchangeEngine()
			ids := counterIDs()
			// Buy-NO makers at 50..89. Taker buys YES at 99.
			issuanceMakers := make([]Order, 0, depth)
			for i := 0; i < depth; i++ {
				price := 50 + (i % 40)
				issuanceMakers = append(issuanceMakers, benchOrder(
					fmt.Sprintf("im-%d", i),
					OrderActionBuy, OrderSideNo,
					price, 10,
				))
			}
			takerPrice := 99
			taker := Order{
				ID:                "taker-1",
				UserID:            "taker-user",
				MarketID:          "market-x",
				Side:              OrderSideYes,
				Action:            OrderActionBuy,
				OrderType:         OrderTypeLimit,
				PricePoints:       &takerPrice,
				Quantity:          depth * 10,
				RemainingQuantity: depth * 10,
				Status:            OrderStatusPending,
				TimeInForce:       TIFGTC,
				SelfMatchAction:   SelfMatchCancelTaker,
			}
			input := MatchInput{
				Market:         market,
				Taker:          taker,
				MakersIssuance: issuanceMakers,
				Now:            now,
				IDFactory:      ids,
			}
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_, err := engine.BuildPlan(input)
				if err != nil {
					b.Fatalf("BuildPlan: %v", err)
				}
			}
		})
	}
}
