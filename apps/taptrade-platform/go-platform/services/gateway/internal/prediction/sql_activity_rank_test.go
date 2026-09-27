package prediction

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"
)

// The activity sort must not let a near-settled market lead the board just
// because it is large. Skipped unless GATEWAY_DB_DSN is set (and reachable),
// like the other SQL-backed tests in this package:
//
//	GATEWAY_DB_DSN="postgres://predict:localdev@localhost:5434/predict?sslmode=disable" \
//	  go test ./internal/prediction/ -run TestSQLActivitySortKeepsNearSettledMarketsDown -v
//
// Regression lock for 2026-09-27: imported markets priced at 1% with
// lifetime volumes in the tens of millions filled the first eight slots of
// /predict, ahead of contested markets closing this week.
func TestSQLActivitySortKeepsNearSettledMarketsDown(t *testing.T) {
	dsn := os.Getenv("GATEWAY_DB_DSN")
	if dsn == "" {
		t.Skip("set GATEWAY_DB_DSN to run the activity-sort integration test")
	}

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	ctx := context.Background()
	t.Cleanup(func() {
		if _, err := db.ExecContext(ctx,
			`DELETE FROM prediction_markets WHERE ticker LIKE 'RANKT-%'`); err != nil {
			t.Logf("cleanup markets: %v", err)
		}
		if _, err := db.ExecContext(ctx,
			`DELETE FROM prediction_events WHERE title LIKE 'activity rank test event %'`); err != nil {
			t.Logf("cleanup events: %v", err)
		}
		db.Close()
	})
	if err := db.PingContext(ctx); err != nil {
		t.Skipf("GATEWAY_DB_DSN set but db not reachable: %v", err)
	}

	suffix := fmt.Sprintf("rank-%d", time.Now().UnixNano())

	var eventID string
	if err := db.QueryRowContext(ctx,
		`INSERT INTO prediction_events (title, status, featured, open_at, close_at)
		 VALUES ($1, 'open', false, NOW() - INTERVAL '1 day', NOW() + INTERVAL '3 years')
		 RETURNING id`, "activity rank test event "+suffix,
	).Scan(&eventID); err != nil {
		t.Fatalf("seed event: %v", err)
	}

	seed := func(name string, yes int, volume, liquidity int64, closesIn, updatedAgo string, image bool) string {
		t.Helper()
		ticker := "RANKT-" + name + "-" + suffix
		var imagePath any
		if image {
			imagePath = "/images/markets/" + ticker + ".jpg"
		}
		if _, err := db.ExecContext(ctx,
			`INSERT INTO prediction_markets
			 (event_id, ticker, title, status, settlement_source_key, settlement_rule,
			  close_at, yes_price_points, no_price_points, volume_points, liquidity_points, image_path)
			 VALUES ($1, $2, $3, 'open', 'manual', 'manual-attestation',
			         NOW() + $4::interval, $5, $6, $7, $8, $9)`,
			eventID, ticker, "Activity rank test "+name+" "+suffix, closesIn, yes, 100-yes, volume, liquidity, imagePath,
		); err != nil {
			t.Fatalf("seed market %s: %v", ticker, err)
		}
		if _, err := db.ExecContext(ctx,
			`UPDATE prediction_markets SET updated_at = NOW() - $1::interval WHERE ticker = $2`,
			updatedAgo, ticker,
		); err != nil {
			t.Fatalf("age market %s: %v", ticker, err)
		}
		return ticker
	}

	// The shape of the 2026-09-27 board: a stale 1% import with the largest
	// volume and liquidity in the set, next to small, fresh, contested
	// markets closing this week, and one busy market that is all but decided.
	whale := seed("WHALE", 1, 50_000_000, 3_000_000, "2 years", "60 days", true)
	contested := seed("CONTESTED", 48, 800, 0, "3 days", "1 hour", true)
	sure := seed("SURE", 97, 5_000_000, 200_000, "1 day", "1 hour", true)
	plain := seed("PLAIN", 50, 100, 0, "5 days", "1 hour", false)

	repo := NewSQLRepository(db)
	markets, _, err := repo.ListMarkets(ctx, MarketFilter{
		EventID: &eventID, Sort: "activity", Page: 1, PageSize: 50,
	})
	if err != nil {
		t.Fatalf("ListMarkets activity: %v", err)
	}
	if len(markets) != 4 {
		t.Fatalf("got %d markets, want the 4 seeded", len(markets))
	}
	order := make([]string, len(markets))
	pos := map[string]int{}
	for i, m := range markets {
		order[i] = m.Ticker
		pos[m.Ticker] = i
	}

	if order[0] != contested {
		t.Errorf("a fresh contested market closing this week must lead, got order %v", order)
	}
	if order[len(order)-1] != whale {
		t.Errorf("the stale 1%% whale must rank last, got order %v", order)
	}
	if pos[sure] < pos[contested] || pos[sure] < pos[plain] {
		t.Errorf("a 97%% market must rank below contested ones even when busier, got order %v", order)
	}
}
