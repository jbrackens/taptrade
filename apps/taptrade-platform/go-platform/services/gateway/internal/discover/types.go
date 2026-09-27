// Package discover ports prediction_markets.py — fetches active markets from
// three free public APIs, normalizes them into one shape, dedupes by fuzzy
// title similarity, and persists them under our own UUIDs and image paths.
//
// Source identity (Polymarket / Kalshi / Manifold) stays inside this package.
// Nothing user-visible — DB columns, API responses, image paths, log lines
// reachable by clients — should mention an upstream by name. Server-side logs
// (stderr, slog) are fine; client-reachable strings are not.
package discover

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Market is the in-memory unified shape produced by the fetchers and consumed
// by dedupe + persistence. Source and ExternalID are used to compute the
// stable hash and pick a winner during dedupe; they are never written to disk
// or returned over the wire.
type Market struct {
	Source      string // "polymarket" | "kalshi" | "manifold"
	ExternalID  string
	Title       string
	Description string
	SourceURL   string
	ImageURL    string // upstream URL — used at ingest only, never persisted
	EndTime     *time.Time
	UpdatedAt   *time.Time
	Volume      float64
	Volume24h   float64
	Liquidity   float64
	Outcomes    []string
	Prices      []float64
	Category    string // upstream-provided when available; classifier fills otherwise
	Status      string
	RulesText   string
	EventGroup  string
	EventTitle  string // the upstream event's own title, when the source has one
	Tags        []string
	Resolution  *Resolution
}

// Resolution represents an upstream market that has resolved YES or NO.
// Set on rows where the upstream signaled `closed/settled/isResolved`.
// nil = market is still open upstream.
type Resolution struct {
	Outcome    string // "yes" | "no" | "ambiguous" — ambiguous routes to manual settlement
	ResolvedAt time.Time
}

func marketExpired(t *time.Time) bool {
	return t != nil && !t.After(time.Now().UTC())
}

var scheduledForDatePattern = regexp.MustCompile(`(?i)\b(?:originally\s+scheduled\s+for|scheduled\s+for|scheduled\s+on)\s+([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})\b`)

func marketEventDatePassed(m Market, now time.Time) bool {
	return textHasPastScheduledDate(m.Description, now) || textHasPastScheduledDate(m.RulesText, now)
}

func marketImpossibleOutcomePassed(m Market, now time.Time) bool {
	return outrightWinnerNoLongerActive(m.Title, now)
}

func textHasPastScheduledDate(text string, now time.Time) bool {
	matches := scheduledForDatePattern.FindAllStringSubmatch(text, -1)
	if len(matches) == 0 {
		return false
	}
	for _, match := range matches {
		t, ok := parseScheduledDate(match[1], match[2], match[3], now.Location())
		if ok && t.Before(startOfDay(now)) {
			return true
		}
	}
	return false
}

func parseScheduledDate(monthName, dayText, yearText string, loc *time.Location) (time.Time, bool) {
	month, ok := monthNumber(monthName)
	if !ok {
		return time.Time{}, false
	}
	day, err := strconv.Atoi(dayText)
	if err != nil {
		return time.Time{}, false
	}
	year, err := strconv.Atoi(yearText)
	if err != nil {
		return time.Time{}, false
	}
	t := time.Date(year, month, day, 0, 0, 0, 0, loc)
	if t.Month() != month || t.Day() != day || t.Year() != year {
		return time.Time{}, false
	}
	return t, true
}

func monthNumber(name string) (time.Month, bool) {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "january":
		return time.January, true
	case "february":
		return time.February, true
	case "march":
		return time.March, true
	case "april":
		return time.April, true
	case "may":
		return time.May, true
	case "june":
		return time.June, true
	case "july":
		return time.July, true
	case "august":
		return time.August, true
	case "september":
		return time.September, true
	case "october":
		return time.October, true
	case "november":
		return time.November, true
	case "december":
		return time.December, true
	default:
		return 0, false
	}
}

func startOfDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
}

var outrightWinnerPattern = regexp.MustCompile(`(?i)^will\s+(.+?)\s+win\s+the\s+(\d{4})\s+(NBA Finals|NHL Stanley Cup)\??$`)

type activeOutrightField struct {
	startAt    time.Time
	activeTeam map[string]struct{}
}

var activeOutrightFields = map[string]activeOutrightField{
	"nba finals:2026": {
		startAt: time.Date(2026, time.June, 3, 0, 0, 0, 0, time.UTC),
		activeTeam: map[string]struct{}{
			normalizeTeamName("New York Knicks"):   {},
			normalizeTeamName("San Antonio Spurs"): {},
		},
	},
	"nhl stanley cup:2026": {
		startAt: time.Date(2026, time.June, 2, 0, 0, 0, 0, time.UTC),
		activeTeam: map[string]struct{}{
			normalizeTeamName("Carolina Hurricanes"):  {},
			normalizeTeamName("Vegas Golden Knights"): {},
		},
	},
}

func outrightWinnerNoLongerActive(title string, now time.Time) bool {
	match := outrightWinnerPattern.FindStringSubmatch(strings.TrimSpace(title))
	if len(match) != 4 {
		return false
	}
	team := normalizeTeamName(match[1])
	key := strings.ToLower(strings.TrimSpace(match[3])) + ":" + strings.TrimSpace(match[2])
	field, ok := activeOutrightFields[key]
	if !ok || now.UTC().Before(field.startAt) {
		return false
	}
	_, active := field.activeTeam[team]
	return !active
}

func normalizeTeamName(s string) string {
	normalized := strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(s))), " ")
	return strings.TrimPrefix(normalized, "the ")
}
