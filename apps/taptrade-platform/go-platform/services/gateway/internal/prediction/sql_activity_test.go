package prediction

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"
)

// The activity rail reads real fills only: recent trades newest first, and
// 24h movers from first-to-last traded Yes price (No fills mapped to Yes).
// Skipped unless GATEWAY_DB_DSN is set, like the other SQL-backed tests.
func TestSQLRecentActivityAndMovers(t *testing.T) {
	dsn := os.Getenv("GATEWAY_DB_DSN")
	if dsn == "" {
		t.Skip("set GATEWAY_DB_DSN to run the activity integration test")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	ctx := context.Background()
	suffix := fmt.Sprintf("act-%d", time.Now().UnixNano())
	punter := "punter-" + suffix
	t.Cleanup(func() {
		_, _ = db.ExecContext(ctx, `DELETE FROM prediction_trades WHERE buyer_id = $1`, punter)
		_, _ = db.ExecContext(ctx, `DELETE FROM prediction_markets WHERE ticker LIKE 'ACTT-%'`)
		_, _ = db.ExecContext(ctx, `DELETE FROM prediction_events WHERE title LIKE 'activity test event %'`)
		_, _ = db.ExecContext(ctx, `DELETE FROM punters WHERE id = $1`, punter)
		db.Close()
	})
	if err := db.PingContext(ctx); err != nil {
		t.Skipf("GATEWAY_DB_DSN set but db not reachable: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO punters (id, email) VALUES ($1, $2)`, punter, punter+"@example.test"); err != nil {
		t.Fatalf("seed punter: %v", err)
	}
	var eventID string
	if err := db.QueryRowContext(ctx,
		`INSERT INTO prediction_events (title, status, close_at) VALUES ($1, 'open', now() + interval '30 days') RETURNING id`,
		"activity test event "+suffix).Scan(&eventID); err != nil {
		t.Fatalf("seed event: %v", err)
	}
	market := func(name string) string {
		var id string
		if err := db.QueryRowContext(ctx,
			`INSERT INTO prediction_markets (event_id, ticker, title, status, settlement_source_key, settlement_rule, close_at)
			 VALUES ($1, $2, $3, 'open', 'manual', 'manual-attestation', now() + interval '30 days') RETURNING id`,
			eventID, "ACTT-"+name+"-"+suffix, "Activity test "+name+" "+suffix).Scan(&id); err != nil {
			t.Fatalf("seed market %s: %v", name, err)
		}
		return id
	}
	mover, flat := market("MOVER"), market("FLAT")
	trade := func(marketID, side string, price, qty int, ago time.Duration) {
		if _, err := db.ExecContext(ctx,
			`INSERT INTO prediction_trades (market_id, buyer_id, side, price_points, quantity, traded_at, match_id, trade_kind, engine_kind)
			 VALUES ($1, $2, $3, $4, $5, now() - $6::interval, gen_random_uuid(), 'secondary', 'order_book')`,
			marketID, punter, side, price, qty, fmt.Sprintf("%d seconds", int(ago.Seconds()))); err != nil {
			t.Fatalf("seed trade: %v", err)
		}
	}
	trade(mover, "yes", 40, 5, 20*time.Hour) // Yes 40 first
	trade(mover, "no", 45, 3, 2*time.Hour)   // No at 45 = Yes 55 last
	trade(flat, "yes", 60, 1, 3*time.Hour)   // one fill: no movement
	trade(flat, "yes", 60, 2, 30*time.Hour)  // outside the window

	repo := NewSQLRepository(db)
	recent, err := repo.ListRecentActivity(ctx, 50)
	if err != nil {
		t.Fatalf("recent: %v", err)
	}
	seen := 0
	var newestAt time.Time
	for i, a := range recent {
		if a.Title == "Activity test MOVER "+suffix || a.Title == "Activity test FLAT "+suffix {
			seen++
			if i == 0 {
				newestAt = a.TradedAt
			}
		}
		if i > 0 && a.TradedAt.After(recent[i-1].TradedAt) {
			t.Fatalf("recent activity must be newest first")
		}
	}
	if seen != 4 || newestAt.IsZero() {
		t.Fatalf("expected the four seeded fills in recent activity, saw %d", seen)
	}

	movers, err := repo.ListMovers24h(ctx, 50)
	if err != nil {
		t.Fatalf("movers: %v", err)
	}
	var got *Mover
	for i := range movers {
		if movers[i].Ticker == "ACTT-MOVER-"+suffix {
			got = &movers[i]
		}
		if movers[i].Ticker == "ACTT-FLAT-"+suffix {
			t.Fatalf("a market with one fill in the window cannot be a mover")
		}
	}
	if got == nil || got.YesFrom != 40 || got.YesTo != 55 || got.ChangePoints != 15 || got.Trades24h != 2 {
		t.Fatalf("mover = %+v, want Yes 40 → 55 over 2 fills", got)
	}
}
