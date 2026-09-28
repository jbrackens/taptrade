package discover

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// polymarketAPIBase is the Gamma API root. Tests point it at an httptest
// server, the same way fetch_kalshi.go exposes kalshiAPIBase.
var polymarketAPIBase = "https://gamma-api.polymarket.com"

// polymarketPageSize is the most rows Gamma returns per request. It caps
// `limit` at 100 silently — ask for 500 and 100 come back — which the old
// "short page means last page" check read as the end of the listing. That,
// on top of the unordered default listing, meant every hourly sync re-read
// the same 100 long-dated markets. Observed on the demo on 2026-09-27: 29
// open Polymarket imports, 22 priced at the extremes, none newer than
// August, while the catalog's Manifold side kept moving.
const polymarketPageSize = 100

// polymarketMinTimeLeft skips open markets that end before the next hourly
// sync could refresh them (Gamma's 24h-volume leaders include intraday
// "Up or Down" markets that close within the hour).
const polymarketMinTimeLeft = time.Hour

// polymarketResolvedThreshold: Polymarket's UMA-style resolutions
// occasionally leave dust on the loser side, so a strict ==1.0 check would
// miss real resolutions.
const polymarketResolvedThreshold = 0.95

// FetchPolymarket pulls the most active markets from the Gamma API: 60% of
// `limit` from the open set and 40% from the closed set, both ordered by
// 24-hour volume — the same open/settled split FetchKalshi uses. The closed
// pass is what lets a market we imported while it was busy resolve with a
// real result once it settles, instead of being voided as expired.
//
// Resolution detection: when a closed market's `outcomePrices` collapses
// to approximately [1, 0] or [0, 1] we treat it as resolved upstream.
//
// Quirks worth flagging (re-derivation from upstream docs gets these wrong):
//   - `outcomes` and `outcomePrices` ship as JSON-encoded *strings*, not
//     arrays — they need a second json.Unmarshal.
//   - A market row carries no `groupSlug`/`eventSlug`; its event lives at
//     `events[0].slug`. Reading the wrong keys left every import without an
//     event group and linked to /market/<slug> instead of the event page.
func FetchPolymarket(limit int) ([]Market, error) {
	if limit <= 0 {
		return []Market{}, nil
	}
	openBudget := (limit * 60) / 100
	if openBudget == 0 {
		openBudget = limit
	}
	passes := []struct {
		closed string
		budget int
	}{
		{closed: "false", budget: openBudget},
		{closed: "true", budget: limit - openBudget},
	}

	out := []Market{}
	seen := map[string]bool{}
	pages := 0
	now := time.Now().UTC()
	for _, pass := range passes {
		got := 0
		for offset := 0; got < pass.budget && pages < maxPagePerSource; offset += polymarketPageSize {
			url := fmt.Sprintf(
				"%s/markets?limit=%d&offset=%d&order=volume24hr&ascending=false&closed=%s",
				polymarketAPIBase, polymarketPageSize, offset, pass.closed,
			)
			var data []map[string]any
			if err := fetchWithBudget("polymarket", url, &data); err != nil {
				return out, fmt.Errorf("polymarket closed=%s offset=%d: %w", pass.closed, offset, err)
			}
			pages++
			for _, raw := range data {
				if got >= pass.budget {
					break
				}
				m, ok := polymarketMarket(raw, now)
				if !ok || seen[m.ExternalID] {
					continue
				}
				seen[m.ExternalID] = true
				out = append(out, m)
				got++
			}
			if len(data) < polymarketPageSize {
				break
			}
		}
	}
	return out, nil
}

// polymarketMarket maps one Gamma row onto Market. ok is false for rows we
// never want: no id or question, or an open market ending within
// polymarketMinTimeLeft.
func polymarketMarket(m map[string]any, now time.Time) (Market, bool) {
	id, question := strs(m["id"]), strs(m["question"])
	if id == "" || question == "" {
		return Market{}, false
	}
	outcomes, prices := decodePolymarketOutcomes(m)
	image := strs(m["image"])
	if image == "" {
		image = strs(m["icon"])
	}
	endTime := parseISO(m["endDate"])
	slug := strs(m["slug"])
	eventSlug := polymarketEventSlug(m)
	eventTitle := polymarketEventField(m, "title")
	sourceURL := ""
	if eventSlug != "" {
		sourceURL = "https://polymarket.com/event/" + eventSlug
	} else if slug != "" {
		sourceURL = "https://polymarket.com/market/" + slug
	}
	closed, _ := m["closed"].(bool)
	status := "open"
	if closed {
		status = "closed"
	} else if active, ok := m["active"].(bool); ok && !active {
		status = "inactive"
	}

	market := Market{
		Source:       "polymarket",
		ExternalID:   id,
		Title:        question,
		Description:  strs(m["description"]),
		SourceURL:    sourceURL,
		ImageURL:     image,
		EndTime:      endTime,
		UpdatedAt:    firstTime(m["updatedAt"], m["updated_at"], m["lastUpdated"]),
		Volume:       toFloat(m["volume"]),
		Volume24h:    firstFloat(m["volume24hr"], m["volume24h"], m["volume24hrClob"]),
		Liquidity:    toFloat(m["liquidity"]),
		Outcomes:     outcomes,
		Prices:       prices,
		Category:     strs(m["category"]),
		Status:       status,
		RulesText:    firstString(m["rules"], m["resolutionSource"], m["description"]),
		EventGroup:   eventSlug,
		EventTitle:   eventTitle,
		OutcomeLabel: strings.TrimSpace(strs(m["groupItemTitle"])),
		Tags:         stringSlice(m["tags"]),
	}

	if marketExpired(market.EndTime) {
		market.Status = "expired"
	}

	// Resolution: Polymarket sets `closed=true` and the winning side's
	// price collapses to ≥0.95 once UMA settles.
	if closed && len(prices) >= 2 {
		if outcome := pickWinningOutcome(prices, polymarketResolvedThreshold); outcome != "" {
			resolvedAt := now
			if endTime != nil {
				resolvedAt = *endTime
			}
			market.Resolution = &Resolution{
				Outcome:    outcome,
				ResolvedAt: resolvedAt,
			}
		}
	}

	if market.Status == "open" && endTime != nil && endTime.Before(now.Add(polymarketMinTimeLeft)) {
		return Market{}, false
	}
	return market, true
}

// polymarketEventSlug finds the event a market belongs to. Gamma nests it
// under events[]; the flat keys are kept for older payload shapes.
func polymarketEventSlug(m map[string]any) string {
	for _, key := range []string{"groupSlug", "eventSlug"} {
		if s := strs(m[key]); s != "" {
			return s
		}
	}
	return polymarketEventField(m, "slug")
}

// polymarketEventField reads a string field of the market's first nested
// event ("slug", "title").
func polymarketEventField(m map[string]any, field string) string {
	events, _ := m["events"].([]any)
	for _, e := range events {
		if em, ok := e.(map[string]any); ok {
			if s := strs(em[field]); s != "" {
				return s
			}
		}
	}
	return ""
}

func decodePolymarketOutcomes(m map[string]any) ([]string, []float64) {
	outcomesStr := strs(m["outcomes"])
	pricesStr := strs(m["outcomePrices"])
	if outcomesStr == "" {
		outcomesStr = "[]"
	}
	if pricesStr == "" {
		pricesStr = "[]"
	}
	var outcomes []string
	var pricesRaw []string
	if err := json.Unmarshal([]byte(outcomesStr), &outcomes); err != nil {
		return nil, nil
	}
	if err := json.Unmarshal([]byte(pricesStr), &pricesRaw); err != nil {
		var pricesNum []float64
		if err2 := json.Unmarshal([]byte(pricesStr), &pricesNum); err2 != nil {
			return outcomes, nil
		}
		return outcomes, pricesNum
	}
	prices := make([]float64, 0, len(pricesRaw))
	for _, p := range pricesRaw {
		var f float64
		if _, err := fmt.Sscanf(strings.TrimSpace(p), "%f", &f); err == nil {
			prices = append(prices, f)
		}
	}
	return outcomes, prices
}

// pickWinningOutcome returns "yes" if prices[0] ≥ threshold, "no" if
// prices[1] ≥ threshold, "" if neither (still ambiguous, treat as open).
// Assumes outcomes are ordered Yes/No (Polymarket convention).
func pickWinningOutcome(prices []float64, threshold float64) string {
	if len(prices) < 2 {
		return ""
	}
	if prices[0] >= threshold {
		return "yes"
	}
	if prices[1] >= threshold {
		return "no"
	}
	return ""
}

func strs(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
