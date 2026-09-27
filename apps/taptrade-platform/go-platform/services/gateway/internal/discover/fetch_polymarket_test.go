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

// polymarketRow builds one Gamma /markets row the way the API ships it:
// outcomes and prices as JSON-encoded strings, the event nested under
// events[], and no groupSlug/eventSlug on the row.
func polymarketRow(id int, yes float64, closed bool, endsIn time.Duration) map[string]any {
	return map[string]any{
		"id":            fmt.Sprintf("%d", id),
		"question":      fmt.Sprintf("Question %d?", id),
		"slug":          fmt.Sprintf("question-%d", id),
		"outcomes":      `["Yes", "No"]`,
		"outcomePrices": fmt.Sprintf(`["%.2f", "%.2f"]`, yes, 1-yes),
		"closed":        closed,
		"active":        !closed,
		"endDate":       time.Now().UTC().Add(endsIn).Format(time.RFC3339),
		"volume":        "1234.5",
		"volume24hr":    987.6,
		"liquidity":     "555.5",
		"image":         fmt.Sprintf("https://img.example/%d.png", id),
		"events":        []any{map[string]any{"slug": fmt.Sprintf("event-%d", id/10)}},
	}
}

func polymarketRows(from, n int, closed bool) []map[string]any {
	rows := make([]map[string]any, 0, n)
	for i := 0; i < n; i++ {
		rows = append(rows, polymarketRow(from+i, 0.42, closed, 72*time.Hour))
	}
	return rows
}

// TestFetchPolymarket_PagesByActivity is the regression lock for the
// 2026-09-27 stale-catalog finding: Gamma caps pages at 100 rows and its
// default listing is unordered, so the fetcher must ask for 100 at a
// time, order by 24h volume, keep paging while pages come back full, and
// split its budget between the open and closed sets.
func TestFetchPolymarket_PagesByActivity(t *testing.T) {
	resetBudget()

	var queries []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/markets" {
			t.Errorf("fetcher hit %s, want /markets", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		q := r.URL.Query()
		queries = append(queries, r.URL.RawQuery)
		if q.Get("limit") != "100" || q.Get("order") != "volume24hr" || q.Get("ascending") != "false" {
			t.Errorf("query must page 100 rows by 24h volume descending, got %s", r.URL.RawQuery)
		}
		var rows []map[string]any
		switch q.Get("closed") + "/" + q.Get("offset") {
		case "false/0":
			rows = polymarketRows(1000, 100, false) // a full page: keep paging
		case "false/100":
			rows = polymarketRows(2000, 30, false) // short page: the end of the open set
		case "true/0":
			rows = polymarketRows(3000, 5, true)
		default:
			t.Errorf("unexpected page request %s", r.URL.RawQuery)
		}
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(rows)
	}))
	defer srv.Close()

	old := polymarketAPIBase
	polymarketAPIBase = srv.URL
	defer func() { polymarketAPIBase = old }()

	ms, err := FetchPolymarket(200)
	if err != nil {
		t.Fatalf("FetchPolymarket: %v", err)
	}
	// 60% of 200 = 120 open (100 from page one, 20 from page two), then
	// every closed row on offer (5 of a 80 budget).
	if len(ms) != 125 {
		t.Fatalf("got %d markets, want 125 (120 open + 5 closed)", len(ms))
	}
	if len(queries) != 3 {
		t.Fatalf("got %d requests, want 3 (open p1, open p2, closed p1): %v", len(queries), queries)
	}
	if !strings.Contains(queries[0], "closed=false") || !strings.Contains(queries[2], "closed=true") {
		t.Errorf("open pass must run before the closed pass: %v", queries)
	}

	open, closed := 0, 0
	for _, m := range ms {
		switch m.Status {
		case "open":
			open++
		case "closed":
			closed++
		}
	}
	if open != 120 || closed != 5 {
		t.Errorf("status split open=%d closed=%d, want 120/5", open, closed)
	}

	first := ms[0]
	if first.ExternalID != "1000" || first.Title != "Question 1000?" {
		t.Errorf("first market misparsed: %+v", first)
	}
	if len(first.Prices) != 2 || first.Prices[0] != 0.42 || first.Prices[1] != 0.58 {
		t.Errorf("string-encoded prices misparsed: %v, want [0.42 0.58]", first.Prices)
	}
	if first.EventGroup != "event-100" || first.SourceURL != "https://polymarket.com/event/event-100" {
		t.Errorf("event must come from events[0].slug: group=%q url=%q", first.EventGroup, first.SourceURL)
	}
	if first.Volume != 1234.5 || first.Volume24h != 987.6 || first.Liquidity != 555.5 {
		t.Errorf("volume/liquidity misparsed: %+v", first)
	}
	if first.ImageURL == "" {
		t.Errorf("image URL dropped")
	}
}

// TestFetchPolymarket_RowFilters pins what never makes it into the catalog
// from a page: rows without an id or question, open markets ending inside
// the hour, and duplicates across pages — while closed rows carry their
// resolution through.
func TestFetchPolymarket_RowFilters(t *testing.T) {
	resetBudget()

	openRows := []map[string]any{
		polymarketRow(1, 0.42, false, 72*time.Hour),
		polymarketRow(2, 0.42, false, 20*time.Minute), // ends before the next sync
		{"id": "", "question": "no id"},
		{"id": "3", "question": ""},
		polymarketRow(1, 0.42, false, 72*time.Hour), // duplicate id
	}
	closedRows := []map[string]any{
		polymarketRow(4, 0.99, true, -2*time.Hour),
		polymarketRow(5, 0.01, true, -2*time.Hour),
		polymarketRow(6, 0.60, true, -2*time.Hour), // closed without a clear winner
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rows := openRows
		if r.URL.Query().Get("closed") == "true" {
			rows = closedRows
		}
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(rows)
	}))
	defer srv.Close()

	old := polymarketAPIBase
	polymarketAPIBase = srv.URL
	defer func() { polymarketAPIBase = old }()

	ms, err := FetchPolymarket(10)
	if err != nil {
		t.Fatalf("FetchPolymarket: %v", err)
	}
	byID := map[string]Market{}
	for _, m := range ms {
		byID[m.ExternalID] = m
	}
	if len(ms) != 4 {
		t.Fatalf("got %d markets, want 4 (1, 4, 5, 6): %v", len(ms), byID)
	}
	if _, ok := byID["2"]; ok {
		t.Errorf("a market ending in 20 minutes must be skipped")
	}
	if byID["4"].Resolution == nil || byID["4"].Resolution.Outcome != "yes" {
		t.Errorf("closed market at 0.99 must resolve yes: %+v", byID["4"].Resolution)
	}
	if byID["5"].Resolution == nil || byID["5"].Resolution.Outcome != "no" {
		t.Errorf("closed market at 0.01 must resolve no: %+v", byID["5"].Resolution)
	}
	// Closed without a winner: no resolution, and never open (its end date
	// has passed, so it reports as expired for the promote step to retire).
	if byID["6"].Resolution != nil || byID["6"].Status == "open" {
		t.Errorf("closed market at 0.60 must carry no resolution and not be open: %+v", byID["6"])
	}
}

func TestPolymarketEventSlug(t *testing.T) {
	cases := []struct {
		name string
		row  map[string]any
		want string
	}{
		{"nested events", map[string]any{"events": []any{map[string]any{"slug": "nfl-kc-mia"}}}, "nfl-kc-mia"},
		{"legacy groupSlug wins", map[string]any{"groupSlug": "g", "events": []any{map[string]any{"slug": "e"}}}, "g"},
		{"empty events", map[string]any{"events": []any{}}, ""},
		{"malformed events", map[string]any{"events": "not-a-list"}, ""},
	}
	for _, c := range cases {
		if got := polymarketEventSlug(c.row); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}
