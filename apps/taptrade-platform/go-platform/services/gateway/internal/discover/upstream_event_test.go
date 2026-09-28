package discover

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"

	_ "github.com/lib/pq"
)

func TestUpstreamEventIDIsStableAndCaseInsensitive(t *testing.T) {
	a := upstreamEventID("polymarket", "nfl-kc-mia-2026-09-27")
	b := upstreamEventID("Polymarket", " NFL-KC-MIA-2026-09-27 ")
	if a != b {
		t.Fatalf("same event must map to one key: %q vs %q", a, b)
	}
	if a == upstreamEventID("kalshi", "nfl-kc-mia-2026-09-27") {
		t.Fatalf("different sources must not share an event key")
	}
}

func TestPolymarketEventTitleComesFromNestedEvent(t *testing.T) {
	m, ok := polymarketMarket(map[string]any{
		"id": "1", "question": "Spread: Chiefs (-10.5)", "groupItemTitle": " Spread -10.5 ", "outcomes": `["Yes","No"]`, "outcomePrices": `["0.45","0.55"]`,
		"endDate": time.Now().UTC().Add(48 * time.Hour).Format(time.RFC3339),
		"events":  []any{map[string]any{"slug": "nfl-kc-mia-2026-09-27", "title": "Chiefs vs. Dolphins"}},
	}, time.Now().UTC())
	if !ok || m.EventTitle != "Chiefs vs. Dolphins" || m.EventGroup != "nfl-kc-mia-2026-09-27" {
		t.Fatalf("event title/group misread: ok=%v %+v", ok, m)
	}
	if m.OutcomeLabel != "Spread -10.5" {
		t.Fatalf("groupItemTitle must become the outcome label, got %q", m.OutcomeLabel)
	}
	k := kalshiEventMarkets([]kalshiEvent{{EventTicker: "KXPOPE", Title: "Who will the next Pope be?", Markets: []map[string]any{
		{"ticker": "KXPOPE-A", "status": "active", "title": "Who will the next Pope be?", "yes_sub_title": "Pietro Parolin", "yes_bid_dollars": "0.2", "close_time": time.Now().UTC().Add(72 * time.Hour).Format(time.RFC3339)},
	}}}, "open", time.Now().UTC())
	if len(k) != 1 || k[0].OutcomeLabel != "Pietro Parolin" {
		t.Fatalf("yes_sub_title must become the outcome label, got %+v", k)
	}
}

// ensureUpstreamEvent is idempotent per (source, event group) and folds later
// markets of the same event into the row: latest close date, first cover,
// title from the source's event. Skipped unless GATEWAY_DB_DSN is set.
func TestSQLEnsureUpstreamEvent(t *testing.T) {
	dsn := os.Getenv("GATEWAY_DB_DSN")
	if dsn == "" {
		t.Skip("set GATEWAY_DB_DSN to run the upstream-event integration test")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	ctx := context.Background()
	group := fmt.Sprintf("test-game-%d", time.Now().UnixNano())
	t.Cleanup(func() {
		if _, err := db.ExecContext(ctx, `DELETE FROM prediction_events WHERE metadata->>'eventGroup' = $1`, group); err != nil {
			t.Logf("cleanup: %v", err)
		}
		db.Close()
	})
	if err := db.PingContext(ctx); err != nil {
		t.Skipf("GATEWAY_DB_DSN set but db not reachable: %v", err)
	}

	var categoryID string
	if err := db.QueryRowContext(ctx, `SELECT id FROM prediction_categories ORDER BY sort_order, slug LIMIT 1`).Scan(&categoryID); err != nil {
		t.Skipf("no categories seeded: %v", err)
	}

	soon := time.Now().UTC().Add(24 * time.Hour)
	later := soon.Add(48 * time.Hour)
	first := Market{Source: "polymarket", EventGroup: group, EventTitle: "Chiefs vs. Dolphins", Title: "Spread: Chiefs (-10.5)", EndTime: &soon}
	id1, err := ensureUpstreamEvent(ctx, db, first, categoryID, "")
	if err != nil {
		t.Fatalf("first ensure: %v", err)
	}
	second := Market{Source: "polymarket", EventGroup: group, EventTitle: "Chiefs vs. Dolphins", Title: "Chiefs vs. Dolphins: O/U 48.5", EndTime: &later}
	id2, err := ensureUpstreamEvent(ctx, db, second, categoryID, "/images/markets/cover.jpg")
	if err != nil {
		t.Fatalf("second ensure: %v", err)
	}
	if id1 != id2 {
		t.Fatalf("same event group must reuse the event row: %s vs %s", id1, id2)
	}

	var title string
	var closeAt time.Time
	var cover sql.NullString
	var synthetic bool
	if err := db.QueryRowContext(ctx,
		`SELECT title, close_at, cover_image_url, is_synthetic FROM prediction_events WHERE id = $1`, id1,
	).Scan(&title, &closeAt, &cover, &synthetic); err != nil {
		t.Fatalf("read event: %v", err)
	}
	if title != "Chiefs vs. Dolphins" || synthetic {
		t.Errorf("event title/synthetic = %q/%v, want the source's event title on a real event", title, synthetic)
	}
	if closeAt.Before(later.Add(-time.Minute)) {
		t.Errorf("close_at must grow to the latest market close: %v < %v", closeAt, later)
	}
	if !cover.Valid || cover.String != "/images/markets/cover.jpg" {
		t.Errorf("cover must be set by the first market that brings one, got %v", cover)
	}

	// A third market with no title of its own falls back to the market title
	// only when the event has none — here the event keeps its title.
	third := Market{Source: "polymarket", EventGroup: group, Title: "1H Moneyline", EndTime: &soon}
	if _, err := ensureUpstreamEvent(ctx, db, third, categoryID, "/images/markets/other.jpg"); err != nil {
		t.Fatalf("third ensure: %v", err)
	}
	if err := db.QueryRowContext(ctx, `SELECT title, cover_image_url FROM prediction_events WHERE id = $1`, id1).Scan(&title, &cover); err != nil {
		t.Fatalf("re-read: %v", err)
	}
	if title != "Chiefs vs. Dolphins" || cover.String != "/images/markets/cover.jpg" {
		t.Errorf("later markets must not overwrite the event's title or cover: %q %q", title, cover.String)
	}
}
