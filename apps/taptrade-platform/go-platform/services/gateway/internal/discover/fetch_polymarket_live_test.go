package discover

import (
	"os"
	"testing"
	"time"
)

// TestFetchPolymarket_Live hits the real Gamma API. Opt-in only (network,
// upstream-dependent): POLYMARKET_LIVE_TEST=1 go test ./internal/discover -run Live
//
// Exists because the 2026-09-27 stale-catalog finding was invisible to
// offline tests: the fetcher was "correct" against a 500-row page size the
// API had stopped honouring, and every hourly sync quietly re-read the
// same 100 markets. When Polymarket imports look stale again, run this
// first — it answers "is it us or them" in one command.
func TestFetchPolymarket_Live(t *testing.T) {
	if os.Getenv("POLYMARKET_LIVE_TEST") == "" {
		t.Skip("set POLYMARKET_LIVE_TEST=1 to hit the real Gamma API")
	}
	resetBudget()

	ms, err := FetchPolymarket(50)
	if err != nil {
		t.Fatalf("FetchPolymarket: %v", err)
	}
	if len(ms) < 40 {
		t.Fatalf("got %d markets, want at least 40 of 50 (open + closed passes)", len(ms))
	}

	open, closed, withImage, withEvent, contested := 0, 0, 0, 0, 0
	cutoff := time.Now().UTC().Add(-30 * 24 * time.Hour)
	for _, m := range ms {
		switch m.Status {
		case "open":
			open++
			if m.EndTime != nil && m.EndTime.Before(time.Now().UTC().Add(polymarketMinTimeLeft)) {
				t.Errorf("open market ending within the hour slipped through: %s ends %v", m.Title, m.EndTime)
			}
		case "closed", "expired":
			closed++
		}
		if m.ImageURL != "" {
			withImage++
		}
		if m.EventGroup != "" {
			withEvent++
		}
		if len(m.Prices) == 2 && m.Prices[0] >= 0.10 && m.Prices[0] <= 0.90 {
			contested++
		}
		if m.UpdatedAt != nil && m.UpdatedAt.Before(cutoff) {
			t.Errorf("a 24h-volume leader should have been updated this month: %s at %v", m.Title, m.UpdatedAt)
		}
		t.Logf("%-7s yes=%.2f v24h=%10.0f ends=%s event=%q %s",
			m.Status, firstPrice(m.Prices), m.Volume24h, endLabel(m.EndTime), m.EventGroup, m.Title)
	}
	if open == 0 || closed == 0 {
		t.Errorf("both passes must contribute: open=%d closed=%d", open, closed)
	}
	if withImage < len(ms)/2 {
		t.Errorf("Polymarket rows carry images; only %d of %d had one", withImage, len(ms))
	}
	if withEvent < len(ms)/2 {
		t.Errorf("events[0].slug should resolve for most rows; got %d of %d", withEvent, len(ms))
	}
	if contested == 0 {
		t.Errorf("the 24h-volume leaders should include contested markets; none priced 10–90")
	}
}

func firstPrice(p []float64) float64 {
	if len(p) == 0 {
		return -1
	}
	return p[0]
}

func endLabel(t *time.Time) string {
	if t == nil {
		return "-"
	}
	return t.Format("01-02 15:04")
}
