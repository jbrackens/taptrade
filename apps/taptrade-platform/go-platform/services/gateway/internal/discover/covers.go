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

// Cover resolver (2026-09-27, reworked 2026-09-28). An import whose source
// ships no image — every Kalshi and Manifold market, and Polymarket markets
// whose image turned out to be venue branding — gets a cover from an open
// repository, in this order:
//
//  1. a matchup tile for "A vs B" sports and esports markets: two team
//     colours with the teams' abbreviations, generated here (team crests are
//     trademarked and non-free, so they are never fetched);
//  2. the market's named subjects ("Bad Bunny", "France", "Fed" → "Federal
//     Reserve", "Tesla Roadster", "Sara Duterte"), each resolved through
//     Wikidata: the top search result whose label or alias is exactly that
//     name, of a class the resolver knows, fitting the market's category —
//     then that class's image on Wikimedia Commons under a free licence: a
//     country's flag, an organisation's logo or seal, a person's or thing's
//     photo. Free-text Wikipedia and Commons search were tried and dropped:
//     they matched namesakes and words (a cave for "France", a police car for
//     the Fed, a papyrus for the film "The Odyssey"). A company, brand or app
//     is shown by a mark that reads at 40px: its small icon (P8972/P2910),
//     else its logo or seal when roughly square. A wide wordmark is never
//     used — shrunk into a square tile it was an unreadable grey line
//     (Anthropic's, 2026-09-28);
//  3. an Openverse topic photo, only when OPENVERSE_API_TOKEN is set (the
//     anonymous API refuses the server with 403);
//  4. the last resort, only when every step above found nothing for every
//     subject: the icon of a named company's own most-rated App Store app
//     (Claude for Anthropic, ChatGPT for OpenAI). App icons are trademarks,
//     not openly licensed, so any free image — a logo, a seal, even a photo
//     of a subject named later in the title — wins over them;
//  5. nothing — the card keeps its category tile.
//
// Every sync also backfills: open imports the board shows without an image,
// likeliest-to-be-seen first, not only the rows the sources returned that
// run, with half of each run's lookups held back for it. A row is tried once
// per 30 days (cover_checked_at, migration 062); a resolver cover whose
// cover_checked_at is cleared (migration 063) is looked up again under the
// current rules and replaced, or removed if nothing fits any more.
// Every lookup, hit or miss, is cached in cover_lookups; each run spends at
// most COVER_ENTITY_LOOKUPS_PER_RUN Wikidata lookups. Credits are stored
// with the image and shown on the market page and /attributions, which is
// what CC BY requires.

var (
	wikidataAPIBase  = "https://www.wikidata.org/w/api.php"
	commonsAPIBase   = "https://commons.wikimedia.org/w/api.php"
	openverseAPIBase = "https://api.openverse.org/v1/images/"
	appStoreAPIBase  = "https://itunes.apple.com/search"
)

// coverUserAgent identifies the catalog to the repositories, as Wikimedia's
// API policy asks. No upstream venue name appears anywhere in the resolver.
const coverUserAgent = "TapTradeCatalog/1.0 (https://demo.99rtp.io; support@taptrade.com)"

const (
	coverMissRetryAfter        = 30 * 24 * time.Hour
	defaultEntityLookupsPerRun = 60
	defaultTopicLookupsPerRun  = 2
	defaultBackfillRowsPerRun  = 60
	maxSubjectsPerMarket       = 4
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
	// AppName marks a miss on a company, brand or app: the name to look up
	// in the App Store if every other source fails (the last resort).
	AppName   string
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
	openverseKey string
	// shortOfBudget records that a lookup this run was skipped for budget,
	// so the caller does not mark the row as checked.
	shortOfBudget bool
	// reserved entity lookups are held back from the rows a sync fetched
	// until StartBackfill: fetched rows once spent the whole budget and the
	// board-first backfill never ran (2026-09-28).
	reserved int
	// replace writes covers under a fresh file name (ReplaceChecked).
	replace bool
}

// NewCoverResolver builds a resolver that writes covers through the given
// rehoster and caches lookups in store (nil disables the cache).
func NewCoverResolver(rehoster *ImageRehoster, store CoverStore) *CoverResolver {
	if rehoster != nil && rehoster.UserAgent == "" {
		rehoster.UserAgent = coverUserAgent
	}
	entityBudget := intEnvOr("COVER_ENTITY_LOOKUPS_PER_RUN", defaultEntityLookupsPerRun)
	return &CoverResolver{
		rehoster:     rehoster,
		store:        store,
		client:       &http.Client{Timeout: 12 * time.Second},
		entityBudget: entityBudget,
		topicBudget:  intEnvOr("COVER_TOPIC_LOOKUPS_PER_RUN", defaultTopicLookupsPerRun),
		openverseKey: strings.TrimSpace(os.Getenv("OPENVERSE_API_TOKEN")),
		reserved:     entityBudget / 2,
	}
}

// ResetBudget starts a new run's lookup allowance, half of it held back
// for the backfill.
func (c *CoverResolver) ResetBudget() {
	c.entityUsed, c.topicUsed = 0, 0
	c.reserved = c.entityBudget / 2
}

// StartBackfill releases the lookups held back from the fetched rows.
func (c *CoverResolver) StartBackfill() {
	if c != nil {
		c.reserved = 0
	}
}

// Exhausted reports whether this run has no lookups left at all.
func (c *CoverResolver) Exhausted() bool {
	return c.entityUsed >= c.entityBudget
}

// Resolve finds a cover for an imported market that has none. ok is false
// when nothing suitable was found; complete is false when a lookup was
// skipped for this run's budget, so the row should be tried again.
func (c *CoverResolver) Resolve(ctx context.Context, rowID string, m Market, category string) (CoverMeta, bool) {
	meta, ok, _ := c.ResolveChecked(ctx, rowID, m, category)
	return meta, ok
}

// ReplaceChecked re-resolves a row that already has a resolver cover. A
// found cover is written under a fresh file name, so the CDN's cached copy
// of the old one is never served in its place.
func (c *CoverResolver) ReplaceChecked(ctx context.Context, rowID string, m Market, category string) (CoverMeta, bool, bool) {
	if c == nil {
		return CoverMeta{}, false, false
	}
	c.replace = true
	defer func() { c.replace = false }()
	return c.ResolveChecked(ctx, rowID, m, category)
}

// ResolveChecked is Resolve plus whether every step ran (see Resolve).
func (c *CoverResolver) ResolveChecked(ctx context.Context, rowID string, m Market, category string) (meta CoverMeta, ok bool, complete bool) {
	if c == nil || c.rehoster == nil || rowID == "" {
		return CoverMeta{}, false, false
	}
	c.shortOfBudget = false
	meta, ok = c.resolve(ctx, rowID, m, category)
	return meta, ok, !c.shortOfBudget
}

func (c *CoverResolver) resolve(ctx context.Context, rowID string, m Market, category string) (CoverMeta, bool) {
	if category == "sports" || category == "esports" {
		if home, away, ok := matchupTeams(firstNonEmpty(m.EventTitle, m.Title)); ok {
			if path, err := c.rehoster.WriteLocal(rowID, ".svg", matchupTileSVG(home, away)); err == nil {
				return CoverMeta{Path: path, Origin: "tile"}, true
			}
		}
	}
	subjects := subjectCandidates(m.Title)
	if name := entityFromTitle(m.Title); name != "" {
		subjects = append([]string{name}, subjects...)
	}
	seen := map[string]bool{}
	tried := 0
	var appNames []string
	for _, subject := range subjects {
		key := strings.ToLower(subject)
		if seen[key] || tried >= maxSubjectsPerMarket+1 {
			continue
		}
		seen[key] = true
		tried++
		subject := subject
		cat := normaliseCategory(category)
		// "wd2": lookups made before square marks were required (migration 063).
		meta, ok, appName := c.cachedOrLookup(ctx, rowID, "wd2:"+cat+":"+key, &c.entityUsed, c.entityBudget, func(ctx context.Context) (CoverLookup, error) {
			return c.lookupWikidata(ctx, subject, cat)
		})
		if ok {
			return meta, true
		}
		if appName != "" {
			appNames = append(appNames, appName)
		}
	}
	if c.openverseKey != "" {
		if query := topicQuery(m.Title); query != "" {
			if meta, ok, _ := c.cachedOrLookup(ctx, rowID, "topic:"+query, &c.topicUsed, c.topicBudget, func(ctx context.Context) (CoverLookup, error) {
				return c.lookupTopic(ctx, query)
			}); ok {
				return meta, true
			}
		}
	}
	// Last resort: nothing free was found for any subject, so a named
	// company's own app icon.
	for _, name := range appNames {
		name := name
		if meta, ok, _ := c.cachedOrLookup(ctx, rowID, "app:"+strings.ToLower(name), &c.entityUsed, c.entityBudget, func(ctx context.Context) (CoverLookup, error) {
			return c.lookupAppStoreIcon(ctx, name)
		}); ok {
			return meta, true
		}
	}
	return CoverMeta{}, false
}

// cachedOrLookup answers from the cache when it can, otherwise spends one
// unit of budget on the repository and caches the answer either way. On a
// miss it passes on the answer's AppName (see CoverLookup).
func (c *CoverResolver) cachedOrLookup(ctx context.Context, rowID, key string, used *int, budget int,
	lookup func(context.Context) (CoverLookup, error)) (CoverMeta, bool, string) {

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
			return CoverMeta{}, false, cached.AppName
		}
		meta, ok := c.rehostLookup(rowID, *cached)
		return meta, ok, ""
	}
	limit := budget
	if used == &c.entityUsed {
		limit -= c.reserved
	}
	if *used >= limit {
		c.shortOfBudget = true
		return CoverMeta{}, false, ""
	}
	*used++
	result, err := lookup(ctx)
	if err != nil {
		slog.Warn("cover: lookup failed", "key", key, "err", err)
		return CoverMeta{}, false, ""
	}
	result.Key = key
	result.CheckedAt = time.Now().UTC()
	if c.store != nil {
		if err := c.store.SaveCoverLookup(ctx, result); err != nil {
			slog.Warn("cover: cache write failed", "key", key, "err", err)
		}
	}
	if !result.Found {
		return CoverMeta{}, false, result.AppName
	}
	meta, ok := c.rehostLookup(rowID, result)
	return meta, ok, ""
}

func (c *CoverResolver) rehostLookup(rowID string, l CoverLookup) (CoverMeta, bool) {
	rehost := c.rehoster.RehostFitted
	if c.replace {
		rehost = c.rehoster.ReplaceFitted
	}
	path, err := rehost(rowID, l.ImageURL)
	if err != nil || path == "" {
		slog.Warn("cover: rehost failed", "key", l.Key, "err", err)
		return CoverMeta{}, false
	}
	return CoverMeta{Path: path, Credit: l.Credit, License: l.License, SourceURL: l.SourceURL, Origin: l.Origin}, true
}

// ── Entity photos: Wikidata → Wikimedia Commons ─────────────────────────

// Wikidata is the precision layer: it knows what a name refers to. Each
// accepted class says which image stands for it — a country's flag (P41),
// an organisation's logo or seal (P154), a person's or thing's photo (P18) —
// and where in the catalog it may appear, so a band cannot illustrate a
// tech market named after it ("Muse", "Opus 5.5", 2026-09-28).
type wikidataGroup struct {
	name       string
	properties []string        // image properties, in order of preference
	categories map[string]bool // nil = any category
	// appIcon: with no free image, the entity's own App Store app icon may
	// stand in, as the resolver's last resort (companies, brands, software).
	appIcon bool
}

// Image sources a group can use. P8972 "small logo or icon" and P2910
// "icon" are made for small sizes; P154 logo, P158 seal and P1543 monogram
// count only when roughly square (logoProperties).
var (
	groupPerson   = &wikidataGroup{name: "person", properties: []string{"P18"}}
	groupCountry  = &wikidataGroup{name: "country", properties: []string{"P41", "P18"}}
	groupPlace    = &wikidataGroup{name: "place", properties: []string{"P18", "P41"}}
	groupOrg      = &wikidataGroup{name: "organisation", properties: []string{"P8972", "P2910", "P154", "P158", "P1543", "P18"}, appIcon: true}
	groupTeam     = &wikidataGroup{name: "team", properties: []string{"P8972", "P154", "P18"}}
	groupProduct  = &wikidataGroup{name: "product", properties: []string{"P18", "P8972", "P2910", "P154"}}
	groupSoftware = &wikidataGroup{name: "software", properties: []string{"P8972", "P2910", "P154", "P18"}, appIcon: true}
	groupCurrency = &wikidataGroup{name: "cryptocurrency", properties: []string{"P8972", "P154", "P18"}}
	groupCreative = &wikidataGroup{name: "creative work", properties: []string{"P18", "P154"},
		categories: map[string]bool{"entertainment": true, "esports": true, "general": true}}
	groupAnimal = &wikidataGroup{name: "animal", properties: []string{"P18"},
		categories: map[string]bool{"general": true, "entertainment": true}}
	groupBrand = &wikidataGroup{name: "brand", properties: []string{"P8972", "P2910", "P154"}, appIcon: true}
)

// logoProperties are drawn marks; one wider than maxLogoAspect (or taller
// than its inverse) is a wordmark and is skipped.
var logoProperties = map[string]bool{"P8972": true, "P2910": true, "P154": true, "P158": true, "P1543": true}

const maxLogoAspect = 1.6

// wikidataClasses maps "instance of" (P31) values to a group. Anything not
// listed — concepts, poems, disambiguations, abstract topics — gets no
// cover rather than a guess.
var wikidataClasses = map[string]*wikidataGroup{
	"Q5":    groupPerson,
	"Q6256": groupCountry, "Q3624078": groupCountry, "Q7275": groupCountry,
	"Q35657": groupCountry, // US state: flag first, like a country
	"Q515":   groupPlace, "Q1549591": groupPlace, "Q5119": groupPlace, "Q1093829": groupPlace,
	"Q4830453": groupOrg, "Q783794": groupOrg, "Q6881511": groupOrg, "Q43229": groupOrg, "Q891723": groupOrg,
	"Q163740": groupOrg, "Q66344": groupOrg, "Q18388277": groupOrg, "Q1058914": groupOrg, "Q7278": groupOrg,
	"Q31855": groupOrg, "Q484652": groupOrg, "Q327333": groupOrg, "Q7210356": groupOrg, "Q3918": groupOrg,
	"Q12973014": groupTeam, "Q847017": groupTeam, "Q13393265": groupTeam, "Q17156793": groupTeam,
	"Q476028": groupTeam, "Q6979593": groupTeam, "Q1194951": groupTeam, "Q4498974": groupTeam,
	"Q3231690": groupProduct, "Q2424752": groupProduct, "Q1668024": groupProduct, "Q40218": groupProduct,
	// Software, apps, websites and operating systems show their icon, not a
	// screenshot.
	"Q7397": groupSoftware, "Q166142": groupSoftware, "Q35127": groupSoftware, "Q9135": groupSoftware,
	"Q13479982": groupCurrency,
	"Q11424":    groupCreative, "Q5398426": groupCreative, "Q482994": groupCreative, "Q7889": groupCreative,
	"Q215380": groupCreative, "Q134556": groupCreative,
	"Q26401003": groupAnimal, "Q16521": groupAnimal,
}

// minPersonSitelinks keeps obscure namesakes out: the subject of a market
// is someone with a presence across Wikipedias.
const minPersonSitelinks = 3

// lookupWikidata resolves a named subject through Wikidata: the first
// search result whose label or alias is exactly the subject (never a less
// prominent namesake further down), an accepted class that fits the
// market's category, then that class's image on Commons under a free
// licence.
func (c *CoverResolver) lookupWikidata(ctx context.Context, subject, category string) (CoverLookup, error) {
	miss := CoverLookup{Found: false, Origin: "entity"}
	var search struct {
		Search []struct {
			ID    string `json:"id"`
			Label string `json:"label"`
			Match struct {
				Text string `json:"text"`
			} `json:"match"`
		} `json:"search"`
	}
	if err := c.getJSON(ctx, wikidataAPIBase+"?"+url.Values{
		"action": {"wbsearchentities"}, "search": {subject}, "language": {"en"}, "type": {"item"}, "limit": {"5"}, "format": {"json"},
	}.Encode(), &search); err != nil {
		return CoverLookup{}, err
	}
	id, label := "", ""
	for _, r := range search.Search {
		if sameName(r.Label, subject) {
			id, label = r.ID, r.Label
			break
		}
		// An alias match only counts for a real name: "Inc" is an alias of
		// the Indian National Congress, which put its flag on a Goldman
		// Sachs earnings market (2026-09-28).
		if len([]rune(subject)) > 4 && sameName(r.Match.Text, subject) {
			id, label = r.ID, r.Label
			break
		}
	}
	if id == "" {
		return miss, nil
	}
	var entities struct {
		Entities map[string]struct {
			Sitelinks map[string]json.RawMessage `json:"sitelinks"`
			Claims    map[string][]wikidataClaim `json:"claims"`
		} `json:"entities"`
	}
	if err := c.getJSON(ctx, wikidataAPIBase+"?"+url.Values{
		"action": {"wbgetentities"}, "ids": {id}, "props": {"claims|sitelinks"}, "format": {"json"},
	}.Encode(), &entities); err != nil {
		return CoverLookup{}, err
	}
	e, ok := entities.Entities[id]
	if !ok {
		return miss, nil
	}
	var group *wikidataGroup
	for _, claim := range e.Claims["P31"] {
		var v struct {
			ID string `json:"id"`
		}
		if json.Unmarshal(claim.Mainsnak.Datavalue.Value, &v) == nil {
			if g, ok := wikidataClasses[v.ID]; ok {
				group = g
				break
			}
		}
	}
	// A class we don't list but a logo on file is still a brand or an
	// organisation ("Goldman Sachs" is an "investment bank"): its marks only.
	// A small icon alone is not enough — concepts carry them too ("album"
	// has a Material Design icon, which put it on a Grammy market).
	if group == nil && len(e.Claims["P154"]) > 0 {
		group = groupBrand
	}
	if group == nil || (group.categories != nil && !group.categories[normaliseCategory(category)]) {
		return miss, nil
	}
	if group == groupPerson && len(e.Sitelinks) < minPersonSitelinks {
		return miss, nil
	}
	for _, prop := range group.properties {
		for _, claim := range byRank(e.Claims[prop]) {
			var file string
			if json.Unmarshal(claim.Mainsnak.Datavalue.Value, &file) != nil || file == "" {
				continue
			}
			lookup, aspect, err := c.commonsImage(ctx, file)
			if err != nil {
				return CoverLookup{}, err
			}
			if !lookup.Found {
				continue
			}
			if logoProperties[prop] && (aspect <= 0 || aspect > maxLogoAspect || aspect < 1/maxLogoAspect) {
				continue
			}
			lookup.Origin = "entity"
			return lookup, nil
		}
	}
	if group.appIcon {
		miss.AppName = firstNonEmpty(label, subject)
	}
	return miss, nil
}

// minAppRatings keeps side apps out: a company is shown by its flagship
// app ("NVIDIA SHIELD TV", 931 ratings, is not Nvidia's face).
const minAppRatings = 5000

// lookupAppStoreIcon finds the icon of the most-rated App Store app whose
// developer is the named company ("Anthropic" → "Anthropic PBC" → Claude).
// It is the resolver's last resort, asked only when no free image was found
// for any subject of the market. App icons are square by design and read at
// small sizes, but they are the company's trademark rather than openly
// licensed: the credit names the app and its developer and links to its
// store page.
func (c *CoverResolver) lookupAppStoreIcon(ctx context.Context, name string) (CoverLookup, error) {
	miss := CoverLookup{Found: false, Origin: "entity"}
	if strings.TrimSpace(name) == "" {
		return miss, nil
	}
	var res struct {
		Results []struct {
			TrackName       string `json:"trackName"`
			SellerName      string `json:"sellerName"`
			ArtistName      string `json:"artistName"`
			ArtworkURL512   string `json:"artworkUrl512"`
			TrackViewURL    string `json:"trackViewUrl"`
			UserRatingCount int    `json:"userRatingCount"`
		} `json:"results"`
	}
	if err := c.getJSON(ctx, appStoreAPIBase+"?"+url.Values{
		"term": {name}, "entity": {"software"}, "country": {"us"}, "limit": {"15"},
	}.Encode(), &res); err != nil {
		return CoverLookup{}, err
	}
	best := -1
	for i, app := range res.Results {
		if app.ArtworkURL512 == "" || app.UserRatingCount < minAppRatings {
			continue
		}
		if !namesDeveloper(app.SellerName, name) && !namesDeveloper(app.ArtistName, name) {
			continue
		}
		if best < 0 || app.UserRatingCount > res.Results[best].UserRatingCount {
			best = i
		}
	}
	if best < 0 {
		return miss, nil
	}
	app := res.Results[best]
	source := app.TrackViewURL
	if u, err := url.Parse(source); err == nil {
		u.RawQuery = ""
		source = u.String()
	}
	developer := firstNonEmpty(app.SellerName, app.ArtistName)
	return CoverLookup{
		Found:     true,
		ImageURL:  app.ArtworkURL512,
		Credit:    app.TrackName + " app icon · " + developer + " (App Store)",
		License:   "App Store icon, trademark of " + developer,
		SourceURL: source,
		Origin:    "entity",
	}, nil
}

// namesDeveloper reports whether a developer name contains the company
// name as whole words: "Anthropic PBC" and "Hangzhou DeepSeek Artificial
// Intelligence Co., Ltd" name Anthropic and DeepSeek; "Openchat" does not
// name OpenAI.
func namesDeveloper(developer, name string) bool {
	norm := func(s string) string {
		return " " + strings.Join(strings.Fields(strings.ToLower(nonWord.ReplaceAllString(s, " "))), " ") + " "
	}
	n := strings.TrimSpace(norm(name))
	return n != "" && strings.Contains(norm(developer), " "+n+" ")
}

// urlPath is a URL without its query string (Commons thumbnail URLs carry
// tracking parameters, which hid the ".png" of every SVG rendition).
func urlPath(raw string) string {
	if u, err := url.Parse(raw); err == nil {
		return u.Path
	}
	return raw
}

type wikidataClaim struct {
	Rank     string `json:"rank"`
	Mainsnak struct {
		Datavalue struct {
			Value json.RawMessage `json:"value"`
		} `json:"datavalue"`
	} `json:"mainsnak"`
}

// byRank orders claims preferred-first and drops deprecated ones: France's
// first flag claim is a 12th-century banner; the current flag is the
// preferred one.
func byRank(claims []wikidataClaim) []wikidataClaim {
	out := make([]wikidataClaim, 0, len(claims))
	for _, rank := range []string{"preferred", "normal"} {
		for _, c := range claims {
			if c.Rank == rank || (rank == "normal" && c.Rank == "") {
				out = append(out, c)
			}
		}
	}
	return out
}

func sameName(a, b string) bool {
	norm := func(s string) string {
		return strings.Join(strings.Fields(strings.ToLower(nonWord.ReplaceAllString(s, " "))), " ")
	}
	return a != "" && norm(a) == norm(b)
}

func normaliseCategory(category string) string {
	c := strings.ToLower(strings.TrimSpace(category))
	if c == "technology" {
		return "tech"
	}
	if c == "" {
		return "general"
	}
	return c
}

// commonsImage fetches a Commons file's 640px rendition, licence and
// aspect ratio (width ÷ height, 0 when unknown). Only free licences that
// allow commercial use come back as found.
func (c *CoverResolver) commonsImage(ctx context.Context, file string) (CoverLookup, float64, error) {
	var info struct {
		Query struct {
			Pages map[string]struct {
				ImageInfo []struct {
					Width          int    `json:"width"`
					Height         int    `json:"height"`
					ThumbURL       string `json:"thumburl"`
					URL            string `json:"url"`
					DescriptionURL string `json:"descriptionurl"`
					Mime           string `json:"mime"`
					ExtMetadata    map[string]struct {
						Value json.RawMessage `json:"value"`
					} `json:"extmetadata"`
				} `json:"imageinfo"`
			} `json:"pages"`
		} `json:"query"`
	}
	if err := c.getJSON(ctx, commonsAPIBase+"?"+url.Values{
		"action": {"query"}, "titles": {"File:" + file}, "prop": {"imageinfo"},
		"iiprop": {"url|extmetadata|mime|size"}, "iiurlwidth": {"640"}, "format": {"json"},
	}.Encode(), &info); err != nil {
		return CoverLookup{}, 0, err
	}
	for _, page := range info.Query.Pages {
		for _, ii := range page.ImageInfo {
			license := rawString(ii.ExtMetadata["LicenseShortName"].Value)
			if !licenseAllowsReuse(license) || !strings.HasPrefix(ii.Mime, "image/") {
				continue
			}
			imageURL := ii.ThumbURL
			if imageURL == "" {
				imageURL = ii.URL
			}
			// Flags, seals and emblems live on Commons as SVG; use the PNG
			// rendition Commons makes for the thumbnail, never the SVG.
			if ii.Mime == "image/svg+xml" && !strings.HasSuffix(strings.ToLower(urlPath(ii.ThumbURL)), ".png") {
				continue
			}
			artist := stripTags(rawString(ii.ExtMetadata["Artist"].Value))
			credit := "Wikimedia Commons"
			if artist != "" {
				credit = artist + " / Wikimedia Commons"
			}
			aspect := 0.0
			if ii.Width > 0 && ii.Height > 0 {
				aspect = float64(ii.Width) / float64(ii.Height)
			}
			return CoverLookup{
				Found: true, ImageURL: imageURL, Credit: credit + " (" + license + ")",
				License: license, SourceURL: ii.DescriptionURL, Origin: "entity",
			}, aspect, nil
		}
	}
	return CoverLookup{Found: false, Origin: "entity"}, 0, nil
}

// licenseAllowsReuse accepts CC0, CC BY, CC BY-SA and public-domain marks;
// NonCommercial and NoDerivatives variants are refused.
func licenseAllowsReuse(license string) bool {
	l := strings.ToUpper(strings.TrimSpace(license))
	if l == "" || strings.Contains(l, "NC") || strings.Contains(l, "ND") {
		return false
	}
	if strings.HasPrefix(l, "CC0") || strings.HasPrefix(l, "CC BY") || strings.HasPrefix(l, "CC-BY") ||
		strings.Contains(l, "PUBLIC DOMAIN") || strings.HasPrefix(l, "PD") {
		return true
	}
	// Permissive software licences some logos are published under
	// (DeepSeek's is MIT): free to reuse commercially with attribution.
	for _, permissive := range []string{"MIT", "APACHE", "BSD", "ISC", "ZLIB"} {
		if strings.HasPrefix(l, permissive) {
			return true
		}
	}
	return false
}

// ── Topic photos: Openverse ─────────────────────────────────────────────

var openverseAcceptedLicenses = map[string]bool{"cc0": true, "by": true, "by-sa": true, "pdm": true}

// subjectAliases expands the abbreviations market titles use into the
// names their Wikipedia pages carry.
var subjectAliases = map[string]string{
	"fed": "Federal Reserve System", "ecb": "European Central Bank", "boe": "Bank of England", "boj": "Bank of Japan",
	"scotus": "Supreme Court of the United States", "gop": "Republican Party (United States)",
	"uk": "United Kingdom", "eu": "European Union", "un": "United Nations", "btc": "Bitcoin", "eth": "Ethereum",
}

var (
	subjectLeadingStops = map[string]bool{
		"will": true, "who": true, "what": true, "which": true, "when": true, "how": true, "is": true, "are": true,
		"does": true, "do": true, "can": true, "should": true, "new": true, "next": true, "top": true, "most": true,
		"first": true, "last": true, "the": true, "a": true, "an": true, "any": true, "daily": true, "weekly": true,
	}
	subjectStops = map[string]bool{
		"i": true, "a": true, "yes": true, "no": true, "o/u": true, "spread": true, "vs": true, "vs.": true, "v": true,
		"january": true, "february": true, "march": true, "april": true, "may": true, "june": true, "july": true,
		"august": true, "september": true, "october": true, "november": true, "december": true,
		"inc": true, "inc.": true, "ltd": true, "llc": true, "plc": true, "corp": true, "co": true, "group": true, "holdings": true,
		"monday": true, "tuesday": true, "wednesday": true, "thursday": true, "friday": true, "saturday": true, "sunday": true,
		"jan": true, "feb": true, "mar": true, "apr": true, "jun": true, "jul": true, "aug": true, "sep": true, "sept": true, "oct": true, "nov": true, "dec": true,
	}
	subjectConnectors = map[string]bool{"of": true, "the": true, "de": true, "da": true, "del": true, "la": true, "le": true, "van": true, "von": true, "and": true, "&": true}
)

// subjectCandidates pulls the named subjects out of a question, in title
// order: runs of capitalised words ("Bad Bunny", "Luiz Inácio Lula da
// Silva"), the first two joined when both are short ("Tesla Roadster"),
// and aliases ("Fed" → "Federal Reserve"). At most maxSubjectsPerMarket.
func subjectCandidates(title string) []string {
	tokens := strings.Fields(title)
	var phrases []string
	var cur []string
	afterColon := false
	flush := func() {
		for len(cur) > 0 && subjectConnectors[strings.ToLower(cur[len(cur)-1])] {
			cur = cur[:len(cur)-1]
		}
		if len(cur) > 0 {
			phrases = append(phrases, strings.Join(cur, " "))
		}
		cur = nil
	}
	for i, raw := range tokens {
		w := strings.TrimSuffix(strings.TrimSuffix(strings.Trim(raw, `?!.,:;"'“”‘’()[]`), "'s"), "’s")
		lower := strings.ToLower(w)
		next := ""
		if i+1 < len(tokens) {
			next = strings.Trim(tokens[i+1], `?!.,:;"'“”‘’()[]`)
		}
		switch {
		case w == "":
			flush()
		case i == 0 && subjectLeadingStops[lower]:
			flush()
		case subjectStops[lower]:
			flush()
		// After a colon a capital is just a new clause ("…: Actor cast as
		// James Bond"), so a lone capitalised word there is not a name.
		case afterColon && len(cur) == 0 && startsUpper(w) && !startsUpper(next):
			flush()
		case startsUpper(w) && !isNumberish(w):
			cur = append(cur, w)
		case len(cur) > 0 && subjectConnectors[lower] && i+1 < len(tokens) && startsUpper(strings.Trim(tokens[i+1], `?!.,:;"'“”‘’()[]`)):
			cur = append(cur, w)
		default:
			flush()
		}
		afterColon = strings.HasSuffix(raw, ":")
		if strings.ContainsAny(raw, "?!:;,") {
			flush()
		}
	}
	flush()

	var out []string
	seen := map[string]bool{}
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" || seen[strings.ToLower(s)] || len(out) >= maxSubjectsPerMarket {
			return
		}
		seen[strings.ToLower(s)] = true
		out = append(out, s)
	}
	for _, p := range phrases {
		if alias, ok := subjectAliases[strings.ToLower(p)]; ok {
			add(alias)
		}
		for _, w := range strings.Fields(p) {
			if alias, ok := subjectAliases[strings.ToLower(w)]; ok {
				add(alias)
			}
		}
	}
	if len(phrases) >= 2 && len(strings.Fields(phrases[0])) == 1 && len(strings.Fields(phrases[1])) == 1 {
		add(phrases[0] + " " + phrases[1])
	}
	for _, p := range phrases {
		if _, aliased := subjectAliases[strings.ToLower(p)]; aliased {
			continue
		}
		if rest, ok := strings.CutPrefix(p, "The "); ok {
			p = rest
		}
		add(p)
		// A run of product-style words ("OpenAI ChatGPT Astra", "Anthropic
		// IPO", "DeepSeek V4 Pro") is rarely a name itself; its leading
		// words are. Wikidata decides whether they name anything we'd show.
		words := strings.Fields(p)
		if len(words) >= 2 && !containsConnector(words) {
			if len(words) >= 3 {
				add(strings.Join(words[:2], " "))
			}
			add(words[0])
		}
	}
	return out
}

// brandLike is a word shaped like a product or organisation name rather
// than an ordinary word: an inner capital ("OpenAI", "ChatGPT") or all
// capitals ("FIBA"). A lone "Clay" or "Avenger" is not tried on its own.
func brandLike(w string) bool {
	runes := []rune(w)
	if len(runes) < 2 {
		return false
	}
	if strings.ToUpper(w) == w && strings.ToLower(w) != w {
		return true
	}
	for _, r := range runes[1:] {
		if r >= 'A' && r <= 'Z' {
			return true
		}
	}
	return false
}

func containsConnector(words []string) bool {
	for _, w := range words {
		if subjectConnectors[strings.ToLower(w)] {
			return true
		}
	}
	return false
}

func startsUpper(w string) bool {
	for _, r := range w {
		return r >= 'A' && r <= 'Z' || (r > 127 && strings.ToUpper(string(r)) == string(r) && strings.ToLower(string(r)) != string(r))
	}
	return false
}

func isNumberish(w string) bool {
	for _, r := range w {
		if r >= '0' && r <= '9' {
			return true
		}
	}
	return false
}

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
	if err := c.getJSONAuth(ctx, openverseAPIBase+"?"+url.Values{
		"q": {query}, "license_type": {"commercial"}, "page_size": {"10"},
	}.Encode(), c.openverseKey, &res); err != nil {
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
	return c.getJSONAuth(ctx, endpoint, "", out)
}

func (c *CoverResolver) getJSONAuth(ctx context.Context, endpoint, bearer string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
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

// rawString reads a Commons extmetadata value, which is a string for the
// fields we use but a number for others in the same map (a strict string
// field failed the whole lookup on 2026-09-27).
func rawString(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	return strings.Trim(string(raw), `"`)
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
