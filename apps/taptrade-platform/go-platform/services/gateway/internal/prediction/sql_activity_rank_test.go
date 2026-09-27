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
// because it is large, and must not let one event or one category fill it.
// Skipped unless GATEWAY_DB_DSN is set (and reachable), like the other
// SQL-backed tests in this package:
//
//	GATEWAY_DB_DSN="postgres://predict:localdev@localhost:5434/predict?sslmode=disable" \
//	  go test ./internal/prediction/ -run TestSQLActivitySort -v
//
// Regression lock for 2026-09-27: imported markets priced at 1% with
// lifetime volumes in the tens of millions filled the first eight slots of
// /predict; once fixed, one NFL Sunday's spreads and totals filled all twelve.
func TestSQLActivitySortKeepsNearSettledMarketsDownAndMixesTheBoard(t *testing.T) {
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
		for _, stmt := range []string{
			`DELETE FROM prediction_markets WHERE ticker LIKE 'RANKT-%'`,
			`DELETE FROM prediction_events WHERE title LIKE 'activity rank test event %'`,
			`DELETE FROM prediction_categories WHERE slug LIKE 'ranktest-%'`,
		} {
			if _, err := db.ExecContext(ctx, stmt); err != nil {
				t.Logf("cleanup: %v", err)
			}
		}
		db.Close()
	})
	if err := db.PingContext(ctx); err != nil {
		t.Skipf("GATEWAY_DB_DSN set but db not reachable: %v", err)
	}

	suffix := fmt.Sprintf("rank-%d", time.Now().UnixNano())

	category := func(name string) string {
		t.Helper()
		var id string
		if err := db.QueryRowContext(ctx,
			`INSERT INTO prediction_categories (slug, name) VALUES ($1, $2) RETURNING id`,
			"ranktest-"+name+"-"+suffix, "Rank test "+name,
		).Scan(&id); err != nil {
			t.Fatalf("seed category %s: %v", name, err)
		}
		return id
	}
	event := func(name, categoryID string) string {
		t.Helper()
		var id string
		if err := db.QueryRowContext(ctx,
			`INSERT INTO prediction_events (title, category_id, status, featured, open_at, close_at)
			 VALUES ($1, $2, 'open', false, NOW() - INTERVAL '1 day', NOW() + INTERVAL '3 years')
			 RETURNING id`, "activity rank test event "+name+" "+suffix, categoryID,
		).Scan(&id); err != nil {
			t.Fatalf("seed event %s: %v", name, err)
		}
		return id
	}
	type spec struct {
		name       string
		eventID    string
		yes        int
		volume     int64
		liquidity  int64
		closesIn   string
		updatedAgo string
		image      bool
	}
	seed := func(sp spec) string {
		t.Helper()
		ticker := "RANKT-" + sp.name + "-" + suffix
		var imagePath any
		if sp.image {
			imagePath = "/images/markets/" + ticker + ".jpg"
		}
		if _, err := db.ExecContext(ctx,
			`INSERT INTO prediction_markets
			 (event_id, ticker, title, status, settlement_source_key, settlement_rule,
			  close_at, yes_price_points, no_price_points, volume_points, liquidity_points, image_path)
			 VALUES ($1, $2, $3, 'open', 'manual', 'manual-attestation',
			         NOW() + $4::interval, $5, $6, $7, $8, $9)`,
			sp.eventID, ticker, "Activity rank test "+sp.name+" "+suffix, sp.closesIn,
			sp.yes, 100-sp.yes, sp.volume, sp.liquidity, imagePath,
		); err != nil {
			t.Fatalf("seed market %s: %v", ticker, err)
		}
		if _, err := db.ExecContext(ctx,
			`UPDATE prediction_markets SET updated_at = NOW() - $1::interval WHERE ticker = $2`,
			sp.updatedAgo, ticker,
		); err != nil {
			t.Fatalf("age market %s: %v", ticker, err)
		}
		return ticker
	}

	// Scenario 1 — the shape of the 2026-09-27 board: a stale 1% import with
	// the largest volume and liquidity in the set, a fresh contested market
	// closing this week with a sibling in the same event, a busy market
	// that is all but decided, and a plain market in another category.
	catA, catB := category("a"), category("b")
	gameEvent := event("game", catA)
	whale := seed(spec{"WHALE", event("whale", catA), 1, 50_000_000, 3_000_000, "2 years", "60 days", true})
	contested := seed(spec{"CONTESTED", gameEvent, 48, 800, 0, "3 days", "1 hour", true})
	sibling := seed(spec{"SIBLING", gameEvent, 30, 200, 0, "4 days", "1 hour", true})
	sure := seed(spec{"SURE", event("sure", catA), 97, 5_000_000, 200_000, "1 day", "1 hour", true})
	plain := seed(spec{"PLAIN", event("plain", catB), 50, 100, 0, "5 days", "1 hour", false})

	// Scenario 2 — one sport's worth of equally busy games next to a single
	// weaker market from another category.
	catC, catD := category("c"), category("d")
	games := make([]string, 0, 6)
	for i := 0; i < 6; i++ {
		name := fmt.Sprintf("GAME%d", i)
		games = append(games, seed(spec{name, event(name, catC), 50, 900, 0, "2 days", "1 hour", true}))
	}
	other := seed(spec{"OTHER", event("other", catD), 60, 300, 0, "6 days", "1 hour", true})

	repo := NewSQLRepository(db)
	search := suffix
	markets, _, err := repo.ListMarkets(ctx, MarketFilter{
		Search: &search, Sort: "activity", Page: 1, PageSize: 50,
	})
	if err != nil {
		t.Fatalf("ListMarkets activity: %v", err)
	}
	if len(markets) != 12 {
		t.Fatalf("got %d markets, want the 12 seeded", len(markets))
	}
	order := make([]string, len(markets))
	pos := map[string]int{}
	for i, m := range markets {
		order[i] = m.Ticker
		pos[m.Ticker] = i
	}

	// Near-settled markets stay down.
	if order[len(order)-1] != whale {
		t.Errorf("the stale 1%% whale must rank last, got order %v", order)
	}
	if pos[sure] < pos[contested] || pos[sure] < pos[plain] {
		t.Errorf("a 97%% market must rank below contested ones even when busier, got order %v", order)
	}

	// Same-event siblings step aside for other events.
	if pos[sibling] < pos[contested] {
		t.Errorf("the weaker sibling must not outrank its event's lead, got order %v", order)
	}
	if pos[sibling] < pos[plain] {
		t.Errorf("a second market of the same event must drop below a plain market from elsewhere, got order %v", order)
	}

	// One category cannot fill the board: the other-category market lands
	// inside the run of equally busy games, not after all of them.
	first, last := len(order), -1
	for _, g := range games {
		if pos[g] < first {
			first = pos[g]
		}
		if pos[g] > last {
			last = pos[g]
		}
	}
	if pos[other] < first || pos[other] > last {
		t.Errorf("a weaker market from another category must break up a single-category run, got order %v", order)
	}
}
