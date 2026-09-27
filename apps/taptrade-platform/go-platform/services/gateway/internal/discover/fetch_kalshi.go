package discover

import (
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"
)

// kalshiAPIBase is a package var so tests can point the fetcher at a local
// httptest server. Production value is the public unauthenticated read API.
var kalshiAPIBase = "https://api.elections.kalshi.com/trade-api/v2"

// KalshiScan is the rotating position in Kalshi's event listings, one
// cursor per status. The zero value starts both listings from the top.
//
// Why rotate (2026-09-27): the open listing is 8,000+ events deep, ordered
// farthest close date first, and ignores date filters, while the flat
// /markets listing is wall-to-wall auto-generated parlays. Reading page one
// every run imported the same hundred no-bid, long-dated candidate markets
// ("Elon on Mars by 2099", "next Pope") for months — nothing new since
// 2026-09-12, 762 of 874 imports voided. Each run now continues from where
// the last one stopped, keeps the busiest markets of its slice, and wraps,
// so every event is seen about once an hour at the 15-minute cadence.
type KalshiScan struct {
	Open    string
	Settled string
}

const (
	kalshiEventsPageSize     = 200 // events endpoint max page size
	kalshiOpenPagesPerRun    = 6
	kalshiSettledPagesPerRun = 3 // 9 of the 10-request budget per run
	kalshiMinTimeLeft        = time.Hour
)

// FetchKalshi reads from the top of both listings. The sync worker uses
// FetchKalshiFrom so each run continues where the previous one stopped.
func FetchKalshi(limit int) ([]Market, error) {
	ms, _, err := FetchKalshiFrom(limit, KalshiScan{})
	return ms, err
}

// FetchKalshiFrom pulls open AND settled markets from the Kalshi public read
// API, starting each listing at the given cursor, and returns the cursors
// the next run should start from (empty once a listing has been read to its
// end, so the run after starts over).
//
// It pages /events?with_nested_markets=true, NOT the flat /markets listing.
// Since ~mid-2026 /markets is unusable for discovery: auto-generated
// multivariate-event (MVE) parlays dominate it so completely that the first
// 10+ pages (10,000+ rows, for both status=open and status=settled) contain
// zero standalone markets (verified 2026-07-07, still true 2026-09-27). The
// events listing carries no MVE parlay collections, and each event also
// provides the `category` field that market rows stopped carrying.
//
// Per run: up to six open pages and three settled pages (1,200 and 600
// events). Within each pass the nested markets are ranked by 24h volume and
// the busiest `limit` share (60% open / 40% settled) is kept, so a slice of
// quiet long-dated events yields its few busy markets rather than its first
// hundred rows.
//
// Field-name potholes worth flagging (re-derivation from upstream docs gets
// these wrong):
//   - prices live in `yes_bid_dollars` / `no_bid_dollars` as strings already
//     in 0..1 (e.g. "0.4500") — NOT cents, no /100 needed
//   - volume lives in `volume_fp` (with `volume_24h_fp` as fallback)
//   - liquidity lives in `liquidity_dollars`
//   - category lives on the EVENT, not the market row
//   - open markets report status "active"; resolved ones "settled"/"finalized"
//   - description fallback chain: rules_primary → yes_sub_title → no_sub_title
//   - resolution: status "settled"/"finalized" + `result` ("yes" | "no" | "")
//   - settled EVENTS can still nest active markets (multi-market events
//     settle per-market) and some nest no markets at all (`markets: null`)
//
// MVE guard stays as belt-and-braces on top of the events pivot: skip events
// and rows whose ticker starts with "KXMVE" or that carry mve_selected_legs.
func FetchKalshiFrom(limit int, scan KalshiScan) ([]Market, KalshiScan, error) {
	next := scan
	out := []Market{}
	if limit <= 0 {
		return out, next, nil
	}
	pages := 0
	now := time.Now().UTC()

	// Split the budget between open and settled so resolved markets aren't
	// starved when the open list is large enough to fill `limit` on its own.
	// Roughly 60% open / 40% settled — open dominates day-to-day, but we
	// still need a steady drip of resolutions to settle prior markets.
	openBudget := (limit * 60) / 100
	if openBudget < 1 {
		openBudget = 1
	}
	settledBudget := limit - openBudget
	if settledBudget < 1 {
		settledBudget = 1
	}

	passes := []struct {
		status string
		keep   int
		pages  int
		cursor *string
	}{
		{status: "open", keep: openBudget, pages: kalshiOpenPagesPerRun, cursor: &next.Open},
		{status: "settled", keep: settledBudget, pages: kalshiSettledPagesPerRun, cursor: &next.Settled},
	}
	var pageErr error
	for _, pass := range passes {
		candidates := []Market{}
		cursor := *pass.cursor
		for p := 0; p < pass.pages && pages < maxPagePerSource; p++ {
			params := url.Values{}
			params.Set("status", pass.status)
			params.Set("limit", fmt.Sprintf("%d", kalshiEventsPageSize))
			params.Set("with_nested_markets", "true")
			if cursor != "" {
				params.Set("cursor", cursor)
			}
			endpoint := kalshiAPIBase + "/events?" + params.Encode()

			var data struct {
				Events []kalshiEvent `json:"events"`
				Cursor string        `json:"cursor"`
			}
			if err := fetchWithBudget("kalshi", endpoint, &data); err != nil {
				// A bad page (truncated body, upstream hiccup) must not pin
				// the scan to itself: this listing restarts from the top
				// next run, and what this run already gathered still counts.
				pageErr = fmt.Errorf("kalshi status=%s cursor=%q: %w", pass.status, cursor, err)
				cursor = ""
				break
			}
			pages++
			candidates = append(candidates, kalshiEventMarkets(data.Events, pass.status, now)...)
			cursor = data.Cursor
			if len(data.Events) == 0 || cursor == "" {
				// End of the listing: the next run starts over.
				cursor = ""
				break
			}
		}
		*pass.cursor = cursor

		sort.SliceStable(candidates, func(i, j int) bool {
			if candidates[i].Volume24h != candidates[j].Volume24h {
				return candidates[i].Volume24h > candidates[j].Volume24h
			}
			return candidates[i].Volume > candidates[j].Volume
		})
		if len(candidates) > pass.keep {
			candidates = candidates[:pass.keep]
		}
		out = append(out, candidates...)
	}

	// Zero usable rows means upstream drifted again (the 2026-07-07 failure
	// mode was exactly this, silent). Fail loudly so the run lands in
	// FetchErrors and the marketSync status block instead of reporting a
	// healthy sync that imported nothing. The cursors still advance so a
	// single junk slice cannot stall the scan.
	if len(out) == 0 {
		if pageErr != nil {
			return out, next, pageErr
		}
		return out, next, fmt.Errorf("kalshi: 0 usable markets after %d page(s) — listing schema or content drifted?", pages)
	}
	return out, next, pageErr
}

type kalshiEvent struct {
	EventTicker string           `json:"event_ticker"`
	Title       string           `json:"title"`
	Category    string           `json:"category"`
	Markets     []map[string]any `json:"markets"`
}

// kalshiEventMarkets maps the nested markets of a page of events onto
// Market, keeping only rows worth importing for the pass: the open pass
// wants quoted markets with at least an hour left, the settled pass wants
// resolved ones.
func kalshiEventMarkets(events []kalshiEvent, status string, now time.Time) []Market {
	out := []Market{}
	for _, ev := range events {
		if strings.HasPrefix(ev.EventTicker, "KXMVE") {
			continue
		}
		// Settled events may nest zero markets (markets: null); ranging a
		// nil slice is a no-op, no guard needed.
		for _, m := range ev.Markets {
			if legs, ok := m["mve_selected_legs"]; ok {
				if legsArr, isArr := legs.([]any); isArr && len(legsArr) > 0 {
					continue
				}
				if _, isObj := legs.(map[string]any); isObj {
					continue
				}
			}
			eventTicker := strs(m["event_ticker"])
			if eventTicker == "" {
				eventTicker = ev.EventTicker
			}
			if strings.HasPrefix(eventTicker, "KXMVE") {
				continue
			}

			marketStatus := strs(m["status"])
			// The settled pass exists to drip resolutions into Promote;
			// settled events still nest active markets, and those rows
			// would eat the resolution budget.
			if status == "settled" && marketStatus != "settled" && marketStatus != "finalized" {
				continue
			}

			yesP := toFloat(m["yes_bid_dollars"])
			noP := toFloat(m["no_bid_dollars"])
			prices := []float64{}
			if yesP > 0 {
				prices = append(prices, yesP)
			}
			if noP > 0 {
				prices = append(prices, noP)
			}
			endTime := parseISO(m["close_time"])
			if status == "open" {
				// No bid means no price to show and nothing to trade
				// against; a market closing within the hour is gone
				// before the next sync could refresh it.
				if len(prices) == 0 {
					continue
				}
				if endTime != nil && endTime.Before(now.Add(kalshiMinTimeLeft)) {
					continue
				}
			}

			sub := strs(m["yes_sub_title"])
			if sub == "" {
				sub = strs(m["no_sub_title"])
			}
			description := strs(m["rules_primary"])
			if description == "" {
				description = sub
			}
			title := strs(m["title"])
			if title == "" {
				title = sub
			}
			if title == "" {
				title = ev.Title
			}

			volume := toFloat(m["volume_fp"])
			if volume == 0 {
				volume = toFloat(m["volume_24h_fp"])
			}
			ticker := strs(m["ticker"])

			category := strs(m["category"])
			if category == "" {
				category = ev.Category
			}

			market := Market{
				Source:      "kalshi",
				ExternalID:  ticker,
				Title:       title,
				Description: description,
				SourceURL:   fmt.Sprintf("https://kalshi.com/markets/%s/%s", eventTicker, ticker),
				ImageURL:    "",
				EndTime:     endTime,
				UpdatedAt:   firstTime(m["last_updated_ts"], m["updated_time"], m["updated_at"]),
				Volume:      volume,
				Volume24h:   toFloat(m["volume_24h_fp"]),
				Liquidity:   toFloat(m["liquidity_dollars"]),
				Outcomes:    []string{"Yes", "No"},
				Prices:      prices,
				Category:    category,
				Status:      marketStatus,
				RulesText:   strs(m["rules_primary"]),
				EventGroup:  eventTicker,
				EventTitle:  ev.Title,
				Tags:        compactStrings(category, strs(m["market_type"])),
			}

			if market.Resolution == nil && marketExpired(market.EndTime) {
				market.Status = "expired"
			}

			// Resolution: status "settled"/"finalized" + result field set.
			if marketStatus == "settled" || marketStatus == "finalized" {
				if result := strings.ToLower(strs(m["result"])); result == "yes" || result == "no" {
					resolvedAt := now
					if t := parseISO(m["expiration_time"]); t != nil {
						resolvedAt = *t
					} else if t := parseISO(m["close_time"]); t != nil {
						resolvedAt = *t
					}
					market.Resolution = &Resolution{
						Outcome:    result,
						ResolvedAt: resolvedAt,
					}
				}
			}

			out = append(out, market)
		}
	}
	return out
}
