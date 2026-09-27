package discover

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// kalshiPage builds one /events page with `n` single-market events whose
// 24h volume descends from `topVolume`; every market is quoted and closes
// in three days unless overridden by the caller.
func kalshiPage(prefix string, n int, topVolume float64, cursor string) map[string]any {
	events := make([]any, 0, n)
	for i := 0; i < n; i++ {
		id := fmt.Sprintf("%s-%03d", prefix, i)
		events = append(events, map[string]any{
			"event_ticker": "KX" + id,
			"title":        "Event " + id,
			"category":     "Sports",
			"markets": []any{map[string]any{
				"ticker":          "KX" + id + "-YES",
				"event_ticker":    "KX" + id,
				"status":          "active",
				"title":           "Market " + id,
				"yes_bid_dollars": "0.4500",
				"no_bid_dollars":  "0.5300",
				"volume_fp":       "10",
				"volume_24h_fp":   fmt.Sprintf("%.1f", topVolume-float64(i)),
				"close_time":      time.Now().UTC().Add(72 * time.Hour).Format(time.RFC3339),
			}},
		})
	}
	return map[string]any{"events": events, "cursor": cursor}
}

// TestFetchKalshiFrom_RotatesAndKeepsBusiest is the regression lock for the
// 2026-09-27 stale-catalog finding: the open listing is thousands of events
// deep in an order that buries the busy ones, so a run must continue from
// the saved cursor, read several pages, keep the busiest markets of the
// slice rather than the first rows, and hand back where it stopped.
func TestFetchKalshiFrom_RotatesAndKeepsBusiest(t *testing.T) {
	resetBudget()

	var requests []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		requests = append(requests, q.Get("status")+"@"+q.Get("cursor"))
		var page map[string]any
		switch q.Get("status") + "@" + q.Get("cursor") {
		case "open@":
			page = kalshiPage("open-a", 5, 100, "c1") // quiet page first
		case "open@c1":
			page = kalshiPage("open-b", 5, 900, "c2") // the busy page is deeper in
		case "open@c2":
			page = kalshiPage("open-c", 5, 500, "") // end of the listing
		case "settled@":
			page = map[string]any{"events": []any{map[string]any{
				"event_ticker": "KXDONE-1", "title": "Done", "category": "Politics",
				"markets": []any{map[string]any{
					"ticker": "KXDONE-1-A", "event_ticker": "KXDONE-1", "status": "finalized",
					"title": "Resolved market", "result": "yes", "close_time": "2026-09-01T00:00:00Z",
				}},
			}}, "cursor": "s1"}
		case "settled@s1":
			page = map[string]any{"events": []any{}, "cursor": ""}
		default:
			t.Errorf("unexpected request %s", r.URL.RawQuery)
			page = map[string]any{"events": []any{}, "cursor": ""}
		}
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(page)
	}))
	defer srv.Close()

	old := kalshiAPIBase
	kalshiAPIBase = srv.URL
	defer func() { kalshiAPIBase = old }()

	// limit 10 → 6 open (three pages, 15 candidates) + 4 settled (one).
	ms, next, err := FetchKalshiFrom(10, KalshiScan{})
	if err != nil {
		t.Fatalf("FetchKalshiFrom: %v", err)
	}
	if len(ms) != 7 {
		t.Fatalf("got %d markets, want 6 open + 1 settled: %v", len(ms), tickersOf(ms))
	}
	// The busiest six come from pages b (900..896) and c (500), not page a.
	for _, m := range ms[:6] {
		if strings.HasPrefix(m.ExternalID, "KXopen-a") {
			t.Errorf("a quiet first-page market made the cut over busier deeper ones: %v", tickersOf(ms))
			break
		}
	}
	if ms[0].ExternalID != "KXopen-b-000-YES" || ms[5].ExternalID != "KXopen-c-000-YES" {
		t.Errorf("open markets must be ranked by 24h volume: %v", tickersOf(ms))
	}
	if ms[6].Resolution == nil || ms[6].Resolution.Outcome != "yes" {
		t.Errorf("settled pass must carry the resolution: %+v", ms[6])
	}
	// Both listings were read to their end, so the next run starts over.
	if next.Open != "" || next.Settled != "" {
		t.Errorf("cursors must reset at the end of a listing, got %+v", next)
	}
	want := []string{"open@", "open@c1", "open@c2", "settled@", "settled@s1"}
	if strings.Join(requests, " ") != strings.Join(want, " ") {
		t.Errorf("requests %v, want %v", requests, want)
	}
}

// A listing deeper than the per-run page budget: the run stops after its
// pages and returns the cursor to resume from; the next run starts there.
func TestFetchKalshiFrom_ResumesFromSavedCursor(t *testing.T) {
	resetBudget()

	var requests []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		requests = append(requests, q.Get("status")+"@"+q.Get("cursor"))
		w.WriteHeader(http.StatusOK)
		if q.Get("status") == "settled" {
			_ = json.NewEncoder(w).Encode(map[string]any{"events": []any{}, "cursor": ""})
			return
		}
		// Endless open listing: every page points to the next.
		n := 0
		fmt.Sscanf(q.Get("cursor"), "p%d", &n)
		_ = json.NewEncoder(w).Encode(kalshiPage(fmt.Sprintf("pg%d", n), 3, 50, fmt.Sprintf("p%d", n+1)))
	}))
	defer srv.Close()

	old := kalshiAPIBase
	kalshiAPIBase = srv.URL
	defer func() { kalshiAPIBase = old }()

	_, next, err := FetchKalshiFrom(100, KalshiScan{Open: "p4"})
	if err != nil {
		t.Fatalf("FetchKalshiFrom: %v", err)
	}
	if requests[0] != "open@p4" {
		t.Fatalf("first request must resume from the saved cursor, got %v", requests)
	}
	openRequests := 0
	for _, r := range requests {
		if strings.HasPrefix(r, "open@") {
			openRequests++
		}
	}
	if openRequests != kalshiOpenPagesPerRun {
		t.Errorf("open pass must read %d pages per run, read %d: %v", kalshiOpenPagesPerRun, openRequests, requests)
	}
	if next.Open != fmt.Sprintf("p%d", 4+kalshiOpenPagesPerRun) {
		t.Errorf("next open cursor %q, want p%d", next.Open, 4+kalshiOpenPagesPerRun)
	}
	if next.Settled != "" {
		t.Errorf("settled listing ended, cursor must reset, got %q", next.Settled)
	}
}

// Open-pass row filters: unquoted markets and markets closing within the
// hour are never candidates; parlays stay excluded.
func TestKalshiEventMarkets_OpenPassFilters(t *testing.T) {
	now := time.Now().UTC()
	soon := now.Add(20 * time.Minute).Format(time.RFC3339)
	later := now.Add(48 * time.Hour).Format(time.RFC3339)
	events := []kalshiEvent{{
		EventTicker: "KXTEST-1", Title: "Test", Category: "Sports",
		Markets: []map[string]any{
			{"ticker": "KXTEST-1-QUOTED", "status": "active", "title": "quoted", "yes_bid_dollars": "0.40", "no_bid_dollars": "0.58", "close_time": later},
			{"ticker": "KXTEST-1-NOBID", "status": "active", "title": "no bid", "close_time": later},
			{"ticker": "KXTEST-1-SOON", "status": "active", "title": "closing soon", "yes_bid_dollars": "0.40", "close_time": soon},
			{"ticker": "KXMVE-PARLAY", "status": "active", "title": "parlay", "yes_bid_dollars": "0.40", "close_time": later, "mve_selected_legs": []any{"a", "b"}},
		},
	}}
	got := kalshiEventMarkets(events, "open", now)
	if len(got) != 1 || got[0].ExternalID != "KXTEST-1-QUOTED" {
		t.Fatalf("open pass must keep only the quoted, not-yet-closing market, got %v", tickersOf(got))
	}
}

func tickersOf(ms []Market) []string {
	out := make([]string, len(ms))
	for i, m := range ms {
		out[i] = m.ExternalID
	}
	return out
}

// A page that fails to parse (the 2026-09-27 "unexpected end of JSON input"
// on a deep open page) keeps what the run already gathered, reports the
// error, and restarts that listing from the top next run instead of
// retrying the same page forever.
func TestFetchKalshiFrom_BadPageKeepsPartialAndResetsCursor(t *testing.T) {
	resetBudget()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		w.WriteHeader(http.StatusOK)
		switch q.Get("status") + "@" + q.Get("cursor") {
		case "open@":
			_ = json.NewEncoder(w).Encode(kalshiPage("ok", 3, 100, "c1"))
		case "open@c1":
			_, _ = w.Write([]byte(`{"events": [{"event_ticker": "KXBROKEN"`)) // truncated body
		default:
			_ = json.NewEncoder(w).Encode(map[string]any{"events": []any{}, "cursor": ""})
		}
	}))
	defer srv.Close()
	old := kalshiAPIBase
	kalshiAPIBase = srv.URL
	defer func() { kalshiAPIBase = old }()

	ms, next, err := FetchKalshiFrom(10, KalshiScan{})
	if err == nil || !strings.Contains(err.Error(), "cursor=\"c1\"") {
		t.Fatalf("the bad page must be reported, got err=%v", err)
	}
	if len(ms) != 3 {
		t.Fatalf("markets gathered before the bad page must be kept, got %d", len(ms))
	}
	if next.Open != "" {
		t.Fatalf("the open listing must restart from the top after a bad page, got cursor %q", next.Open)
	}
}
