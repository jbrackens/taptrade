package discover

import (
	"context"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Cover resolver (2026-09-27). An import whose source ships no image — every
// Kalshi and Manifold market — gets a cover from an open repository, in this
// order:
//
//  1. a matchup tile for "A vs B" sports and esports markets: two team
//     colours with the teams' abbreviations, generated here (team crests are
//     trademarked and non-free, so they are never fetched);
//  2. an entity photo: the person, band, film, show, game, city or country
//     the title names, resolved through Wikidata to its Wikimedia Commons
//     image, accepted only under CC0, CC BY, CC BY-SA or the public domain,
//     and only when the label matches the name exactly and the entity is of
//     an expected kind — a namesake's photo is the failure that matters;
//  3. a topic photo from Openverse (commercial-use licences only);
//  4. nothing — the card falls back to the category tile it has today.
//
// Every lookup, hit or miss, is cached in cover_lookups so the sync never
// asks the same question twice within the retry window, and each run spends
// at most a small budget of lookups (Openverse allows 200 anonymous requests
// a day; Wikimedia asks for a descriptive User-Agent and a gentle rate).
// Credits are stored with the image and shown on the market page and the
// /attributions page, which is what CC BY requires.

var (
	wikidataAPIBase  = "https://www.wikidata.org/w/api.php"
	commonsAPIBase   = "https://commons.wikimedia.org/w/api.php"
	openverseAPIBase = "https://api.openverse.org/v1/images/"
)

// coverUserAgent identifies the catalog to the repositories, as Wikimedia's
// API policy asks. No upstream venue name appears anywhere in the resolver.
const coverUserAgent = "TapTradeCatalog/1.0 (https://demo.99rtp.io; support@taptrade.com)"

const (
	coverMissRetryAfter        = 30 * 24 * time.Hour
	defaultEntityLookupsPerRun = 25
	defaultTopicLookupsPerRun  = 2
)

// CoverMeta is a resolved cover: where the file is served from, the credit
// line the licence asks for, and where it came from.
type CoverMeta struct {
	Path      string
	Credit    string
	License   string
	SourceURL string
	Origin    string // "entity" | "topic" | "tile"
}

// CoverLookup is one cached repository answer.
type CoverLookup struct {
	Key       string
	Found     bool
	ImageURL  string
	Credit    string
	License   string
	SourceURL string
	Origin    string
	CheckedAt time.Time
}

// CoverStore is the persistence the resolver needs; *Repository implements it.
type CoverStore interface {
	LoadCoverLookup(ctx context.Context, key string) (*CoverLookup, error)
	SaveCoverLookup(ctx context.Context, lookup CoverLookup) error
}

type CoverResolver struct {
	rehoster     *ImageRehoster
	store        CoverStore
	client       *http.Client
	entityBudget int
	topicBudget  int
	entityUsed   int
	topicUsed    int
}

// NewCoverResolver builds a resolver that writes covers through the given
// rehoster and caches lookups in store (nil disables the cache).
func NewCoverResolver(rehoster *ImageRehoster, store CoverStore) *CoverResolver {
	if rehoster != nil && rehoster.UserAgent == "" {
		rehoster.UserAgent = coverUserAgent
	}
	return &CoverResolver{
		rehoster:     rehoster,
		store:        store,
		client:       &http.Client{Timeout: 12 * time.Second},
		entityBudget: intEnvOr("COVER_ENTITY_LOOKUPS_PER_RUN", defaultEntityLookupsPerRun),
		topicBudget:  intEnvOr("COVER_TOPIC_LOOKUPS_PER_RUN", defaultTopicLookupsPerRun),
	}
}

// ResetBudget starts a new run's lookup allowance.
func (c *CoverResolver) ResetBudget() {
	c.entityUsed, c.topicUsed = 0, 0
}

// Resolve finds a cover for an imported market that has none. ok is false
// when nothing suitable was found within this run's budget.
func (c *CoverResolver) Resolve(ctx context.Context, rowID string, m Market, category string) (CoverMeta, bool) {
	if c == nil || c.rehoster == nil || rowID == "" {
		return CoverMeta{}, false
	}
	if category == "sports" || category == "esports" {
		if home, away, ok := matchupTeams(firstNonEmpty(m.EventTitle, m.Title)); ok {
			if path, err := c.rehoster.WriteLocal(rowID, ".svg", matchupTileSVG(home, away)); err == nil {
				return CoverMeta{Path: path, Origin: "tile"}, true
			}
		}
	}
	if name := entityFromTitle(m.Title); name != "" {
		if meta, ok := c.cachedOrLookup(ctx, rowID, "entity:"+strings.ToLower(name), &c.entityUsed, c.entityBudget, func(ctx context.Context) (CoverLookup, error) {
			return c.lookupEntity(ctx, name)
		}); ok {
			return meta, true
		}
	}
	if query := topicQuery(m.Title); query != "" {
		if meta, ok := c.cachedOrLookup(ctx, rowID, "topic:"+query, &c.topicUsed, c.topicBudget, func(ctx context.Context) (CoverLookup, error) {
			return c.lookupTopic(ctx, query)
		}); ok {
			return meta, true
		}
	}
	return CoverMeta{}, false
}

// cachedOrLookup answers from the cache when it can, otherwise spends one
// unit of budget on the repository and caches the answer either way.
func (c *CoverResolver) cachedOrLookup(ctx context.Context, rowID, key string, used *int, budget int,
	lookup func(context.Context) (CoverLookup, error)) (CoverMeta, bool) {

	var cached *CoverLookup
	if c.store != nil {
		if l, err := c.store.LoadCoverLookup(ctx, key); err != nil {
			slog.Warn("cover: cache read failed", "key", key, "err", err)
		} else {
			cached = l
		}
	}
	if cached != nil && (cached.Found || time.Since(cached.CheckedAt) < coverMissRetryAfter) {
		if !cached.Found {
			return CoverMeta{}, false
		}
		return c.rehostLookup(rowID, *cached)
	}
	if *used >= budget {
		return CoverMeta{}, false
	}
	*used++
	result, err := lookup(ctx)
	if err != nil {
		slog.Warn("cover: lookup failed", "key", key, "err", err)
		return CoverMeta{}, false
	}
	result.Key = key
	result.CheckedAt = time.Now().UTC()
	if c.store != nil {
		if err := c.store.SaveCoverLookup(ctx, result); err != nil {
			slog.Warn("cover: cache write failed", "key", key, "err", err)
		}
	}
	if !result.Found {
		return CoverMeta{}, false
	}
	return c.rehostLookup(rowID, result)
}

func (c *CoverResolver) rehostLookup(rowID string, l CoverLookup) (CoverMeta, bool) {
	path, err := c.rehoster.Rehost(rowID, l.ImageURL)
	if err != nil || path == "" {
		slog.Warn("cover: rehost failed", "key", l.Key, "err", err)
		return CoverMeta{}, false
	}
	return CoverMeta{Path: path, Credit: l.Credit, License: l.License, SourceURL: l.SourceURL, Origin: l.Origin}, true
}

// ── Entity photos: Wikidata → Wikimedia Commons ─────────────────────────

// wikidataAcceptedClasses are the kinds of thing whose Wikidata image is a
// fair cover for a market about it. Teams, companies and currencies are left
// out on purpose: their P18/P154 images are logos.
var wikidataAcceptedClasses = map[string]string{
	"Q5":       "human",
	"Q215380":  "musical group",
	"Q11424":   "film",
	"Q5398426": "television series",
	"Q482994":  "album",
	"Q7889":    "video game",
	"Q515":     "city",
	"Q6256":    "country",
}

func (c *CoverResolver) lookupEntity(ctx context.Context, name string) (CoverLookup, error) {
	var search struct {
		Search []struct {
			ID    string `json:"id"`
			Label string `json:"label"`
		} `json:"search"`
	}
	if err := c.getJSON(ctx, wikidataAPIBase+"?"+url.Values{
		"action": {"wbsearchentities"}, "search": {name}, "language": {"en"}, "type": {"item"}, "limit": {"5"}, "format": {"json"},
	}.Encode(), &search); err != nil {
		return CoverLookup{}, err
	}
	ids := make([]string, 0, len(search.Search))
	for _, s := range search.Search {
		if strings.EqualFold(strings.TrimSpace(s.Label), name) {
			ids = append(ids, s.ID)
		}
	}
	if len(ids) == 0 {
		return CoverLookup{Found: false, Origin: "entity"}, nil
	}
	var entities struct {
		Entities map[string]struct {
			Claims map[string][]struct {
				Mainsnak struct {
					Datavalue struct {
						Value json.RawMessage `json:"value"`
					} `json:"datavalue"`
				} `json:"mainsnak"`
			} `json:"claims"`
		} `json:"entities"`
	}
	if err := c.getJSON(ctx, wikidataAPIBase+"?"+url.Values{
		"action": {"wbgetentities"}, "ids": {strings.Join(ids, "|")}, "props": {"claims"}, "format": {"json"},
	}.Encode(), &entities); err != nil {
		return CoverLookup{}, err
	}
	for _, id := range ids {
		e, ok := entities.Entities[id]
		if !ok {
			continue
		}
		accepted := false
		for _, claim := range e.Claims["P31"] {
			var v struct {
				ID string `json:"id"`
			}
			if json.Unmarshal(claim.Mainsnak.Datavalue.Value, &v) == nil {
				if _, ok := wikidataAcceptedClasses[v.ID]; ok {
					accepted = true
					break
				}
			}
		}
		if !accepted {
			continue
		}
		for _, claim := range e.Claims["P18"] {
			var file string
			if json.Unmarshal(claim.Mainsnak.Datavalue.Value, &file) != nil || file == "" {
				continue
			}
			lookup, err := c.commonsImage(ctx, file)
			if err != nil {
				return CoverLookup{}, err
			}
			if lookup.Found {
				return lookup, nil
			}
		}
	}
	return CoverLookup{Found: false, Origin: "entity"}, nil
}

// commonsImage fetches a Commons file's 640px rendition and licence. Only
// free licences that allow commercial use come back as found.
func (c *CoverResolver) commonsImage(ctx context.Context, file string) (CoverLookup, error) {
	var info struct {
		Query struct {
			Pages map[string]struct {
				ImageInfo []struct {
					ThumbURL       string `json:"thumburl"`
					URL            string `json:"url"`
					DescriptionURL string `json:"descriptionurl"`
					Mime           string `json:"mime"`
					ExtMetadata    map[string]struct {
						Value string `json:"value"`
					} `json:"extmetadata"`
				} `json:"imageinfo"`
			} `json:"pages"`
		} `json:"query"`
	}
	if err := c.getJSON(ctx, commonsAPIBase+"?"+url.Values{
		"action": {"query"}, "titles": {"File:" + file}, "prop": {"imageinfo"},
		"iiprop": {"url|extmetadata|mime"}, "iiurlwidth": {"640"}, "format": {"json"},
	}.Encode(), &info); err != nil {
		return CoverLookup{}, err
	}
	for _, page := range info.Query.Pages {
		for _, ii := range page.ImageInfo {
			license := ii.ExtMetadata["LicenseShortName"].Value
			if !licenseAllowsReuse(license) || !strings.HasPrefix(ii.Mime, "image/") || ii.Mime == "image/svg+xml" {
				continue
			}
			imageURL := ii.ThumbURL
			if imageURL == "" {
				imageURL = ii.URL
			}
			artist := stripTags(ii.ExtMetadata["Artist"].Value)
			credit := "Wikimedia Commons"
			if artist != "" {
				credit = artist + " / Wikimedia Commons"
			}
			return CoverLookup{
				Found: true, ImageURL: imageURL, Credit: credit + " (" + license + ")",
				License: license, SourceURL: ii.DescriptionURL, Origin: "entity",
			}, nil
		}
	}
	return CoverLookup{Found: false, Origin: "entity"}, nil
}

// licenseAllowsReuse accepts CC0, CC BY, CC BY-SA and public-domain marks;
// NonCommercial and NoDerivatives variants are refused.
func licenseAllowsReuse(license string) bool {
	l := strings.ToUpper(strings.TrimSpace(license))
	if l == "" || strings.Contains(l, "NC") || strings.Contains(l, "ND") {
		return false
	}
	return strings.HasPrefix(l, "CC0") || strings.HasPrefix(l, "CC BY") || strings.HasPrefix(l, "CC-BY") ||
		strings.Contains(l, "PUBLIC DOMAIN") || strings.HasPrefix(l, "PD")
}

// ── Topic photos: Openverse ─────────────────────────────────────────────

var openverseAcceptedLicenses = map[string]bool{"cc0": true, "by": true, "by-sa": true, "pdm": true}

func (c *CoverResolver) lookupTopic(ctx context.Context, query string) (CoverLookup, error) {
	var res struct {
		Results []struct {
			URL               string `json:"url"`
			Title             string `json:"title"`
			Creator           string `json:"creator"`
			License           string `json:"license"`
			LicenseVersion    string `json:"license_version"`
			Attribution       string `json:"attribution"`
			ForeignLandingURL string `json:"foreign_landing_url"`
			Width             int    `json:"width"`
			Height            int    `json:"height"`
		} `json:"results"`
	}
	if err := c.getJSON(ctx, openverseAPIBase+"?"+url.Values{
		"q": {query}, "license_type": {"commercial"}, "page_size": {"10"},
	}.Encode(), &res); err != nil {
		return CoverLookup{}, err
	}
	for _, r := range res.Results {
		if !openverseAcceptedLicenses[strings.ToLower(r.License)] || r.URL == "" {
			continue
		}
		if r.Width > 0 && r.Height > 0 && (r.Width < 320 || r.Height < 320) {
			continue
		}
		license := "CC " + strings.ToUpper(r.License)
		if strings.EqualFold(r.License, "pdm") {
			license = "Public Domain Mark"
		}
		if r.LicenseVersion != "" && !strings.EqualFold(r.License, "pdm") {
			license += " " + r.LicenseVersion
		}
		credit := strings.TrimSpace(r.Attribution)
		if credit == "" {
			credit = fmt.Sprintf("%q by %s (%s)", r.Title, r.Creator, license)
		}
		return CoverLookup{Found: true, ImageURL: r.URL, Credit: credit, License: license, SourceURL: r.ForeignLandingURL, Origin: "topic"}, nil
	}
	return CoverLookup{Found: false, Origin: "topic"}, nil
}

// ── Title parsing ───────────────────────────────────────────────────────

// entityPatterns pull a proper name (2–4 capitalised words) out of the
// question forms upstream markets use: "Will Sara Duterte run…",
// "Taylor Swift to announce…". Wikidata's class check decides whether the
// name is something we would put a photo of on a card.
var entityPatterns = []*regexp.Regexp{
	regexp.MustCompile(`^Will (?:the )?((?:[A-Z][\p{L}'.\-]+ ){1,3}[A-Z][\p{L}'.\-]+)\b`),
	regexp.MustCompile(`^((?:[A-Z][\p{L}'.\-]+ ){1,3}[A-Z][\p{L}'.\-]+) (?:to|wins?|out|resigns?|announces?|releases?|hits?|reaches?)\b`),
}

var entityStopStarts = map[string]bool{"the": true, "us": true, "u.s.": true, "uk": true, "eu": true, "will": true, "which": true, "who": true, "what": true, "how": true, "any": true, "new": true, "no": true}

func entityFromTitle(title string) string {
	title = strings.TrimSpace(title)
	for _, re := range entityPatterns {
		if m := re.FindStringSubmatch(title); m != nil {
			name := strings.TrimSpace(m[1])
			first := strings.ToLower(strings.Fields(name)[0])
			if entityStopStarts[first] {
				return ""
			}
			return name
		}
	}
	return ""
}

var topicStopwords = map[string]bool{
	"will": true, "the": true, "a": true, "an": true, "be": true, "by": true, "in": true, "on": true, "at": true, "of": true,
	"to": true, "for": true, "and": true, "or": true, "before": true, "after": true, "than": true, "more": true, "less": true,
	"win": true, "hit": true, "reach": true, "get": true, "make": true, "do": true, "does": true, "is": true, "are": true,
	"this": true, "that": true, "with": true, "from": true, "over": true, "under": true, "any": true, "its": true, "it": true,
	"who": true, "what": true, "which": true, "how": true, "many": true, "have": true, "has": true, "as": true, "vs": true,
}

var nonWord = regexp.MustCompile(`[^\p{L}\p{N} ]+`)

// topicQuery reduces a title to a few searchable words: "Will the Fed cut
// rates in October 2026?" → "fed cut rates october".
func topicQuery(title string) string {
	words := strings.Fields(nonWord.ReplaceAllString(strings.ToLower(title), " "))
	out := make([]string, 0, 4)
	for _, w := range words {
		if topicStopwords[w] || len(w) < 3 {
			continue
		}
		if _, err := strconv.Atoi(w); err == nil {
			continue
		}
		out = append(out, w)
		if len(out) == 4 {
			break
		}
	}
	if len(out) < 2 {
		return ""
	}
	return strings.Join(out, " ")
}

// ── Matchup tiles ───────────────────────────────────────────────────────

var matchupPattern = regexp.MustCompile(`^(?:[^:]{2,40}:\s*)?([\p{L}\p{N}.'&\- ]{2,40}?)\s+(?:vs\.?|v\.?|versus)\s+([\p{L}\p{N}.'&\- ]{2,40}?)(?:\s*[:(\-–—]|$)`)

// matchupTeams reads "Chiefs vs. Dolphins", "NFL: Ravens vs Colts",
// "LoL: T1 vs Gen.G (BO5)" into its two sides.
func matchupTeams(title string) (home, away string, ok bool) {
	m := matchupPattern.FindStringSubmatch(strings.TrimSpace(title))
	if m == nil {
		return "", "", false
	}
	home, away = strings.TrimSpace(m[1]), strings.TrimSpace(m[2])
	if home == "" || away == "" || strings.EqualFold(home, away) {
		return "", "", false
	}
	return home, away, true
}

// teamAbbreviation is the tile's label: the first three letters of the
// name's most distinctive word ("Golden State Warriors" → "WAR", "T1" →
// "T1", "49ers" → "49E").
func teamAbbreviation(name string) string {
	words := strings.Fields(name)
	if len(words) == 0 {
		return "?"
	}
	pick := words[len(words)-1]
	for i := len(words) - 1; i >= 0; i-- {
		w := strings.Trim(words[i], ".'&-")
		if len([]rune(w)) >= 3 {
			pick = w
			break
		}
	}
	r := []rune(strings.ToUpper(strings.Trim(pick, ".'&-")))
	if len(r) > 3 {
		r = r[:3]
	}
	return string(r)
}

// teamColour is a stable, saturated, dark-enough colour for a team name.
func teamColour(name string) string {
	h := fnv.New32a()
	_, _ = h.Write([]byte(strings.ToLower(strings.TrimSpace(name))))
	hue := float64(h.Sum32() % 360)
	return hslToHex(hue, 0.62, 0.38)
}

func hslToHex(h, s, l float64) string {
	c := (1 - abs(2*l-1)) * s
	x := c * (1 - abs(mod(h/60, 2)-1))
	m := l - c/2
	var r, g, b float64
	switch {
	case h < 60:
		r, g, b = c, x, 0
	case h < 120:
		r, g, b = x, c, 0
	case h < 180:
		r, g, b = 0, c, x
	case h < 240:
		r, g, b = 0, x, c
	case h < 300:
		r, g, b = x, 0, c
	default:
		r, g, b = c, 0, x
	}
	return fmt.Sprintf("#%02x%02x%02x", int((r+m)*255+0.5), int((g+m)*255+0.5), int((b+m)*255+0.5))
}

func abs(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}

func mod(a, b float64) float64 { return a - b*float64(int(a/b)) }

// matchupTileSVG draws the two sides' colours with their abbreviations.
func matchupTileSVG(home, away string) []byte {
	return []byte(fmt.Sprintf(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" role="img" aria-label="%s versus %s">`+
			`<rect width="100" height="200" fill="%s"/><rect x="100" width="100" height="200" fill="%s"/>`+
			`<text x="50" y="114" font-family="Inter, Helvetica, Arial, sans-serif" font-size="38" font-weight="700" fill="#ffffff" text-anchor="middle">%s</text>`+
			`<text x="150" y="114" font-family="Inter, Helvetica, Arial, sans-serif" font-size="38" font-weight="700" fill="#ffffff" text-anchor="middle">%s</text>`+
			`</svg>`,
		xmlEscape(home), xmlEscape(away), teamColour(home), teamColour(away), xmlEscape(teamAbbreviation(home)), xmlEscape(teamAbbreviation(away)),
	))
}

func xmlEscape(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;")
	return r.Replace(s)
}

// ── Helpers ─────────────────────────────────────────────────────────────

func (c *CoverResolver) getJSON(ctx context.Context, endpoint string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", coverUserAgent)
	req.Header.Set("Accept", "application/json")
	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return err
	}
	return json.Unmarshal(body, out)
}

var tagPattern = regexp.MustCompile(`<[^>]*>`)

func stripTags(s string) string {
	return strings.TrimSpace(strings.Join(strings.Fields(tagPattern.ReplaceAllString(s, " ")), " "))
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func intEnvOr(key string, fallback int) int {
	if raw := strings.TrimSpace(os.Getenv(key)); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n >= 0 {
			return n
		}
	}
	return fallback
}
