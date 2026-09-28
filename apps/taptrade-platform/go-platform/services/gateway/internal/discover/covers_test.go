package discover

import (
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestEntityFromTitle(t *testing.T) {
	cases := map[string]string{
		"Will Sara Duterte run for president in 2028?":      "Sara Duterte",
		"Will the Fed cut rates in October?":                "",
		"Will Manny Pacquiao fight again before 2027?":      "Manny Pacquiao",
		"Taylor Swift to announce a Manila date?":           "Taylor Swift",
		"Will Bitcoin hit $150k?":                           "", // one word is too ambiguous to look up
		"Will US GDP growth exceed 3%?":                     "",
		"Chiefs vs. Dolphins":                               "",
		"Will Alexandria Ocasio-Cortez win the nomination?": "Alexandria Ocasio-Cortez",
	}
	for title, want := range cases {
		if got := entityFromTitle(title); got != want {
			t.Errorf("entityFromTitle(%q) = %q, want %q", title, got, want)
		}
	}
}

func TestTopicQuery(t *testing.T) {
	cases := map[string]string{
		"Will the Fed cut rates in October 2026?":          "fed cut rates october",
		"Will it rain in Manila on Sunday?":                "rain manila sunday",
		"Will X?":                                          "",
		"New Bad Bunny album on Spotify before Valentines": "new bad bunny album",
	}
	for title, want := range cases {
		if got := topicQuery(title); got != want {
			t.Errorf("topicQuery(%q) = %q, want %q", title, got, want)
		}
	}
}

func TestLicenseAllowsReuse(t *testing.T) {
	yes := []string{"CC BY-SA 4.0", "CC BY 2.0", "CC0", "Public domain", "PD-USGov", "cc-by-sa-3.0", "MIT", "Apache License 2.0"}
	no := []string{"CC BY-NC 2.0", "CC BY-ND 4.0", "CC BY-NC-SA 3.0", "", "All rights reserved", "Fair use"}
	for _, l := range yes {
		if !licenseAllowsReuse(l) {
			t.Errorf("%q should be allowed", l)
		}
	}
	for _, l := range no {
		if licenseAllowsReuse(l) {
			t.Errorf("%q must be refused", l)
		}
	}
}

func TestMatchupTeamsAndTile(t *testing.T) {
	cases := map[string][2]string{
		"Chiefs vs. Dolphins":                        {"Chiefs", "Dolphins"},
		"NFL: Ravens vs Colts":                       {"Ravens", "Colts"},
		"LoL: T1 vs Gen.G (BO5) - Worlds":            {"T1", "Gen.G"},
		"Cardinals vs. 49ers: O/U 48.5":              {"Cardinals", "49ers"},
		"Golden State Warriors v Los Angeles Lakers": {"Golden State Warriors", "Los Angeles Lakers"},
	}
	for title, want := range cases {
		home, away, ok := matchupTeams(title)
		if !ok || home != want[0] || away != want[1] {
			t.Errorf("matchupTeams(%q) = %q, %q, %v; want %v", title, home, away, ok, want)
		}
	}
	for _, title := range []string{"Will the Fed cut rates?", "Spread: Chiefs (-10.5)", "Chiefs vs. Chiefs"} {
		if _, _, ok := matchupTeams(title); ok {
			t.Errorf("matchupTeams(%q) must not match", title)
		}
	}
	if got := teamAbbreviation("Golden State Warriors"); got != "WAR" {
		t.Errorf("abbreviation = %q, want WAR", got)
	}
	if got := teamAbbreviation("49ers"); got != "49E" {
		t.Errorf("abbreviation = %q, want 49E", got)
	}
	if got := teamAbbreviation("T1"); got != "T1" {
		t.Errorf("abbreviation = %q, want T1", got)
	}
	for name, want := range map[string]string{"G2 Esports": "G2", "Team Liquid": "LIQ", "FC Barcelona": "BAR", "Esports": "ESP"} {
		if got := teamAbbreviation(name); got != want {
			t.Errorf("teamAbbreviation(%q) = %q, want %q", name, got, want)
		}
	}
	svg := string(matchupTileSVG("Chiefs", "Dolphins"))
	if !strings.Contains(svg, ">CHI<") || !strings.Contains(svg, ">DOL<") || !strings.HasPrefix(svg, "<svg") {
		t.Errorf("tile svg malformed: %s", svg)
	}
	if teamColour("Chiefs") == teamColour("Dolphins") || teamColour("Chiefs") != teamColour("chiefs ") {
		t.Errorf("team colours must differ per team and be stable: %s %s", teamColour("Chiefs"), teamColour("Dolphins"))
	}
}

// offlineWikimedia points Wikidata, Commons and the App Store at a server
// that knows no items, files or apps, so a test never reaches the real
// network. Tests that fake one themselves override its base afterwards.
func offlineWikimedia(t *testing.T) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Query().Get("action") {
		case "":
			_ = json.NewEncoder(w).Encode(map[string]any{"results": []any{}})
		case "wbsearchentities":
			_ = json.NewEncoder(w).Encode(map[string]any{"search": []any{}})
		case "wbgetentities":
			_ = json.NewEncoder(w).Encode(map[string]any{"entities": map[string]any{}})
		default:
			_ = json.NewEncoder(w).Encode(map[string]any{"query": map[string]any{"pages": map[string]any{"-1": map[string]any{"missing": ""}}}})
		}
	}))
	t.Cleanup(srv.Close)
	oldWD, oldC, oldAS := wikidataAPIBase, commonsAPIBase, appStoreAPIBase
	wikidataAPIBase, commonsAPIBase, appStoreAPIBase = srv.URL, srv.URL, srv.URL
	t.Cleanup(func() { wikidataAPIBase, commonsAPIBase, appStoreAPIBase = oldWD, oldC, oldAS })
}

// memoryCoverStore stands in for cover_lookups.
type memoryCoverStore struct {
	rows  map[string]CoverLookup
	saves int
}

func (m *memoryCoverStore) LoadCoverLookup(_ context.Context, key string) (*CoverLookup, error) {
	if l, ok := m.rows[key]; ok {
		return &l, nil
	}
	return nil, nil
}

func (m *memoryCoverStore) SaveCoverLookup(_ context.Context, l CoverLookup) error {
	if m.rows == nil {
		m.rows = map[string]CoverLookup{}
	}
	m.rows[l.Key] = l
	m.saves++
	return nil
}

// TestCoverResolver_EntityPhoto walks the whole entity path against fake
// Wikidata and Commons servers: exact-label match, accepted class, a free
// licence, rehost, credit — and the cache answering the second time.
func TestCoverResolver_EntityPhoto(t *testing.T) {
	offlineWikimedia(t)
	var wikidataHits, commonsHits, imageHits int
	imgSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		imageHits++
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write([]byte("\xff\xd8\xff\xe0 not really a jpeg"))
	}))
	defer imgSrv.Close()
	wd := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wikidataHits++
		switch r.URL.Query().Get("action") {
		case "wbsearchentities":
			_ = json.NewEncoder(w).Encode(map[string]any{"search": []any{
				map[string]any{"id": "Q1", "label": "Sara Duterte Foundation"}, // not an exact match
				map[string]any{"id": "Q2", "label": "Sara Duterte"},
			}})
		case "wbgetentities":
			if r.URL.Query().Get("ids") != "Q2" {
				t.Errorf("only exact-label candidates may be fetched, got ids=%s", r.URL.Query().Get("ids"))
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"entities": map[string]any{"Q2": map[string]any{
				"sitelinks": map[string]any{"enwiki": map[string]any{}, "tlwiki": map[string]any{}, "cebwiki": map[string]any{}},
				"claims": map[string]any{
					"P31": []any{map[string]any{"mainsnak": map[string]any{"datavalue": map[string]any{"value": map[string]any{"id": "Q5"}}}}},
					"P18": []any{map[string]any{"mainsnak": map[string]any{"datavalue": map[string]any{"value": "VPSD Official Photo.jpg"}}}},
				}}}})
		}
	}))
	defer wd.Close()
	commons := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		commonsHits++
		if !strings.Contains(r.URL.Query().Get("titles"), "File:VPSD Official Photo.jpg") {
			t.Errorf("commons asked for %q", r.URL.Query().Get("titles"))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"query": map[string]any{"pages": map[string]any{"1": map[string]any{"imageinfo": []any{map[string]any{
			"thumburl": imgSrv.URL + "/640px-photo.jpg", "url": imgSrv.URL + "/photo.jpg", "descriptionurl": "https://commons.wikimedia.org/wiki/File:VPSD_Official_Photo.jpg", "mime": "image/jpeg",
			"extmetadata": map[string]any{"LicenseShortName": map[string]any{"value": "CC BY 4.0"}, "Artist": map[string]any{"value": `<a href="x">Office of the Vice President</a>`}, "DateTime": map[string]any{"value": 20240101}},
		}}}}}})
	}))
	defer commons.Close()
	oldWD, oldC := wikidataAPIBase, commonsAPIBase
	wikidataAPIBase, commonsAPIBase = wd.URL, commons.URL
	defer func() { wikidataAPIBase, commonsAPIBase = oldWD, oldC }()

	root := t.TempDir()
	store := &memoryCoverStore{}
	res := NewCoverResolver(NewImageRehoster(root), store)
	res.ResetBudget()
	m := Market{Title: "Will Sara Duterte run for president in 2028?"}

	meta, ok := res.Resolve(context.Background(), "row-1", m, "politics")
	if !ok {
		t.Fatalf("expected an entity cover")
	}
	if meta.Origin != "entity" || meta.License != "CC BY 4.0" || !strings.Contains(meta.Credit, "Office of the Vice President") || strings.Contains(meta.Credit, "<a") {
		t.Errorf("meta = %+v", meta)
	}
	if meta.Path != "/images/markets/row-1.jpg" {
		t.Errorf("path = %q", meta.Path)
	}
	if _, err := os.Stat(filepath.Join(root, "images", "markets", "row-1.jpg")); err != nil {
		t.Errorf("cover not written: %v", err)
	}
	if wikidataHits != 2 || commonsHits != 1 || imageHits != 1 {
		t.Errorf("hits wikidata=%d commons=%d image=%d", wikidataHits, commonsHits, imageHits)
	}

	// A second market naming the same person: answered from the cache,
	// only the image is fetched (for the new row).
	meta2, ok := res.Resolve(context.Background(), "row-2", Market{Title: "Will Sara Duterte visit Davao in May?"}, "politics")
	if !ok || meta2.Path != "/images/markets/row-2.jpg" {
		t.Fatalf("second resolve = %+v, %v", meta2, ok)
	}
	if wikidataHits != 2 || store.saves != 1 {
		t.Errorf("cache must answer repeats: wikidata=%d saves=%d", wikidataHits, store.saves)
	}
}

// Non-free licences, wrong kinds of entity, and the run budget all stop a
// cover from being used; a miss is cached so the next run skips it.
func TestCoverResolver_RefusesAndBudgets(t *testing.T) {
	offlineWikimedia(t)
	wd := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Query().Get("action") {
		case "wbsearchentities":
			_ = json.NewEncoder(w).Encode(map[string]any{"search": []any{map[string]any{"id": "Q9", "label": "Bitcoin"}}})
		case "wbgetentities":
			_ = json.NewEncoder(w).Encode(map[string]any{"entities": map[string]any{"Q9": map[string]any{"claims": map[string]any{
				"P31": []any{map[string]any{"mainsnak": map[string]any{"datavalue": map[string]any{"value": map[string]any{"id": "Q13479982"}}}}}, // cryptocurrency: not accepted
				"P18": []any{map[string]any{"mainsnak": map[string]any{"datavalue": map[string]any{"value": "Bitcoin.svg"}}}},
			}}}})
		}
	}))
	defer wd.Close()
	var openverseHits int
	ov := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		openverseHits++
		if r.URL.Query().Get("license_type") != "commercial" {
			t.Errorf("openverse must be asked for commercial-use licences")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"results": []any{
			map[string]any{"url": "https://img.example/nc.jpg", "license": "by-nc", "license_version": "2.0", "width": 800, "height": 600},
			map[string]any{"url": "https://img.example/tiny.jpg", "license": "by", "license_version": "2.0", "width": 100, "height": 100},
		}})
	}))
	defer ov.Close()
	oldWD, oldOV := wikidataAPIBase, openverseAPIBase
	wikidataAPIBase, openverseAPIBase = wd.URL, ov.URL
	defer func() { wikidataAPIBase, openverseAPIBase = oldWD, oldOV }()

	store := &memoryCoverStore{}
	res := NewCoverResolver(NewImageRehoster(t.TempDir()), store)
	res.topicBudget = 1
	res.openverseKey = "test-token" // Openverse is only asked with a key
	res.ResetBudget()

	if _, ok := res.Resolve(context.Background(), "row-1", Market{Title: "Will Bitcoin hit $150k before 2027?"}, "economics"); ok {
		t.Fatalf("a logo-only entity and non-free/tiny topic results must yield no cover")
	}
	if openverseHits != 1 {
		t.Fatalf("openverse hits = %d, want 1", openverseHits)
	}
	if l, ok := store.rows["wd2:economics:bitcoin"]; !ok || l.Found {
		t.Errorf("entity miss must be cached as not found: %+v (cached=%v)", l, ok)
	}
	if l := store.rows["topic:bitcoin 150k"]; l.Found {
		t.Errorf("topic miss must be cached as not found: %+v", l)
	}
	// Budget spent: a different topic is not looked up this run.
	if _, ok := res.Resolve(context.Background(), "row-2", Market{Title: "Will Ethereum flip Solana this year?"}, "economics"); ok || openverseHits != 1 {
		t.Errorf("topic budget must cap lookups per run: hits=%d ok=%v", openverseHits, ok)
	}
	// Next run, the cached miss still short-circuits.
	res.ResetBudget()
	store.rows["topic:bitcoin 150k"] = CoverLookup{Key: "topic:bitcoin 150k", Found: false, CheckedAt: time.Now()}
	if _, ok := res.Resolve(context.Background(), "row-3", Market{Title: "Will Bitcoin hit $150k before 2027?"}, "economics"); ok || openverseHits != 1 {
		t.Errorf("cached miss must not be retried within the window: hits=%d", openverseHits)
	}
}

func TestCoverResolver_MatchupTileForSports(t *testing.T) {
	offlineWikimedia(t)
	root := t.TempDir()
	res := NewCoverResolver(NewImageRehoster(root), &memoryCoverStore{})
	res.ResetBudget()
	meta, ok := res.Resolve(context.Background(), "row-9", Market{Title: "Spread: Chiefs (-10.5)", EventTitle: "Chiefs vs. Dolphins"}, "sports")
	if !ok || meta.Origin != "tile" || meta.Path != "/images/markets/row-9.svg" || meta.Credit != "" {
		t.Fatalf("meta = %+v, %v", meta, ok)
	}
	data, err := os.ReadFile(filepath.Join(root, "images", "markets", "row-9.svg"))
	if err != nil || !strings.Contains(string(data), ">CHI<") {
		t.Fatalf("tile not written: %v %s", err, data)
	}
	// Outside sports, "vs" titles are not tiles (budgets zeroed so no
	// repository is consulted here).
	res.entityBudget, res.topicBudget = 0, 0
	if _, ok := res.Resolve(context.Background(), "row-10", Market{Title: "Coke vs. Pepsi: which sells more?"}, "general"); ok {
		t.Fatalf("no tile outside sports/esports without a repository answer")
	}
}

func TestSubjectCandidates(t *testing.T) {
	cases := map[string][]string{
		"Will France win on 2026-09-28?":                                               {"France"},
		"Fed Decision in October?":                                                     {"Federal Reserve System", "Fed Decision", "Fed"},
		"New Bad Bunny album on Spotify before Valentines Day 2027?":                   {"Bad Bunny", "Bad", "Spotify", "Valentines Day"},
		"OpenAI ChatGPT Astra publicly available in September 2026?":                   {"OpenAI ChatGPT Astra", "OpenAI ChatGPT", "OpenAI"},
		"What will The Goldman Sachs Group, Inc. say during their next earnings call?": {"Goldman Sachs", "Goldman"},
		"Will I do chores for 15 minutes daily until October?":                         nil,
	}
	for title, want := range cases {
		got := subjectCandidates(title)
		if strings.Join(got, "|") != strings.Join(want, "|") {
			t.Errorf("subjectCandidates(%q) = %q, want %q", title, got, want)
		}
	}
}

// fakeWikimedia serves a small Wikidata, Commons and App Store: items by
// search label, their claims, Commons image info for any file (SVGs with a
// PNG rendition behind a query string, as Commons really serves them; a
// file named "…wordmark…" is 900×200, "…icon…" square, others 300×200), and
// App Store results by search term.
func fakeWikimedia(t *testing.T, items map[string]map[string]any, search map[string][]map[string]any, apps map[string][]map[string]any) {
	t.Helper()
	size := func(name string) (int, int) {
		switch {
		case strings.Contains(name, "wordmark"):
			return 900, 200
		case strings.Contains(name, "icon"):
			return 200, 200
		}
		return 300, 200
	}
	img := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		width, height := size(r.URL.Path)
		_ = writeTestPNG(w, width, height)
	}))
	t.Cleanup(img.Close)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		switch q.Get("action") {
		case "":
			results := apps[q.Get("term")]
			for _, app := range results {
				if art, ok := app["artworkUrl512"].(string); ok && !strings.HasPrefix(art, "http") {
					app["artworkUrl512"] = img.URL + "/" + art
				}
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"results": results})
		case "wbsearchentities":
			_ = json.NewEncoder(w).Encode(map[string]any{"search": search[q.Get("search")]})
		case "wbgetentities":
			_ = json.NewEncoder(w).Encode(map[string]any{"entities": map[string]any{q.Get("ids"): items[q.Get("ids")]}})
		default:
			file := strings.TrimPrefix(q.Get("titles"), "File:")
			mime, thumb := "image/jpeg", img.URL+"/"+file
			if strings.HasSuffix(file, ".svg") {
				mime, thumb = "image/svg+xml", img.URL+"/960px-"+file+".png?utm_source=commons"
			}
			width, height := size(file)
			_ = json.NewEncoder(w).Encode(map[string]any{"query": map[string]any{"pages": map[string]any{"1": map[string]any{"imageinfo": []any{map[string]any{
				"width": width, "height": height,
				"thumburl": thumb, "url": img.URL + "/" + file, "descriptionurl": "https://commons.wikimedia.org/wiki/File:" + file, "mime": mime,
				"extmetadata": map[string]any{"LicenseShortName": map[string]any{"value": "Public domain"}},
			}}}}}})
		}
	}))
	t.Cleanup(srv.Close)
	oldWD, oldC, oldAS := wikidataAPIBase, commonsAPIBase, appStoreAPIBase
	wikidataAPIBase, commonsAPIBase, appStoreAPIBase = srv.URL, srv.URL, srv.URL
	t.Cleanup(func() { wikidataAPIBase, commonsAPIBase, appStoreAPIBase = oldWD, oldC, oldAS })
}

func claim(value any, rank string) map[string]any {
	return map[string]any{"rank": rank, "mainsnak": map[string]any{"datavalue": map[string]any{"value": value}}}
}

func writeTestPNG(w io.Writer, width, height int) error {
	m := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.Draw(m, m.Bounds(), &image.Uniform{C: color.Black}, image.Point{}, draw.Src)
	return png.Encode(w, m)
}

// The Wikidata path: a country gets its preferred flag (not a historical
// banner listed first) from an SVG's PNG rendition; a band cannot
// illustrate a tech market; a short alias ("INC") never matches. Companies
// get a mark that reads at 40px: a small icon before a wide wordmark, never
// the wordmark itself. A company's own app icon is the last resort: any free
// image — its photo, or another subject's — wins over it.
func TestCoverResolver_WikidataSubjects(t *testing.T) {
	items := map[string]map[string]any{
		"Q142": {"sitelinks": map[string]any{}, "claims": map[string]any{
			"P31": []any{claim(map[string]any{"id": "Q3624078"}, "normal")},
			"P41": []any{claim("Banner of France 1500.svg", "normal"), claim("Flag of France.svg", "preferred")},
		}},
		"Q22151": {"sitelinks": map[string]any{}, "claims": map[string]any{
			"P31": []any{claim(map[string]any{"id": "Q215380"}, "normal")}, // musical group
			"P18": []any{claim("Muse live.jpg", "normal")},
		}},
		"Q1": {"sitelinks": map[string]any{}, "claims": map[string]any{
			"P31": []any{claim(map[string]any{"id": "Q7278"}, "normal")},
			"P41": []any{claim("INC flag.svg", "normal")},
		}},
		"Q193326": {"sitelinks": map[string]any{}, "claims": map[string]any{
			"P31":  []any{claim(map[string]any{"id": "Q730038"}, "normal")}, // investment bank: not listed
			"P154": []any{claim("Goldman Sachs wordmark.svg", "normal")},
		}},
		"Q478214": {"sitelinks": map[string]any{}, "claims": map[string]any{
			"P31":   []any{claim(map[string]any{"id": "Q4830453"}, "normal")}, // business
			"P154":  []any{claim("Tesla wordmark.svg", "normal")},
			"P8972": []any{claim("Tesla T icon.svg", "normal")},
		}},
		"Q77": {"sitelinks": map[string]any{}, "claims": map[string]any{
			"P31":  []any{claim(map[string]any{"id": "Q4830453"}, "normal")},
			"P154": []any{claim("Acme wordmark.svg", "normal")},
		}},
		"Q55": {"sitelinks": map[string]any{}, "claims": map[string]any{
			"P31":  []any{claim(map[string]any{"id": "Q4830453"}, "normal")},
			"P154": []any{claim("Initech wordmark.svg", "normal")},
			"P18":  []any{claim("Initech HQ.jpg", "normal")},
		}},
		"Q56": {"sitelinks": map[string]any{}, "claims": map[string]any{
			"P31":  []any{claim(map[string]any{"id": "Q4830453"}, "normal")},
			"P154": []any{claim("Globex wordmark.svg", "normal")},
		}},
	}
	search := map[string][]map[string]any{
		"France":        {{"id": "Q142", "label": "France", "match": map[string]any{"text": "France", "type": "label"}}},
		"Muse":          {{"id": "Q22151", "label": "Muse", "match": map[string]any{"text": "Muse", "type": "label"}}},
		"Inc":           {{"id": "Q1", "label": "Indian National Congress", "match": map[string]any{"text": "INC", "type": "alias"}}},
		"Goldman Sachs": {{"id": "Q193326", "label": "Goldman Sachs", "match": map[string]any{"text": "Goldman Sachs", "type": "label"}}},
		"Tesla":         {{"id": "Q478214", "label": "Tesla", "match": map[string]any{"text": "Tesla", "type": "label"}}},
		"Acme":          {{"id": "Q77", "label": "Acme", "match": map[string]any{"text": "Acme", "type": "label"}}},
		"Initech":       {{"id": "Q55", "label": "Initech", "match": map[string]any{"text": "Initech", "type": "label"}}},
		"Globex":        {{"id": "Q56", "label": "Globex", "match": map[string]any{"text": "Globex", "type": "label"}}},
	}
	apps := map[string][]map[string]any{
		"Goldman Sachs": {
			{"trackName": "GS Side", "sellerName": "Goldman Sachs", "userRatingCount": 86, "artworkUrl512": "side-icon.png"},
			{"trackName": "Openchat", "sellerName": "JARVISY LTD", "userRatingCount": 9000000, "artworkUrl512": "other-icon.png"},
			{"trackName": "Marcus by Goldman Sachs", "sellerName": "Goldman Sachs", "userRatingCount": 270588,
				"artworkUrl512": "marcus-icon.png", "trackViewUrl": "https://apps.apple.com/us/app/marcus/id1?uo=4"},
		},
		"Acme":    {{"trackName": "Acme Fan App", "sellerName": "Someone Else LLC", "userRatingCount": 50000, "artworkUrl512": "fan-icon.png"}},
		"Initech": {{"trackName": "Initech", "sellerName": "Initech", "userRatingCount": 50000, "artworkUrl512": "initech-icon.png"}},
		"Globex":  {{"trackName": "Globex", "sellerName": "Globex Corporation", "userRatingCount": 50000, "artworkUrl512": "globex-icon.png"}},
	}
	fakeWikimedia(t, items, search, apps)

	root := t.TempDir()
	res := NewCoverResolver(NewImageRehoster(root), &memoryCoverStore{})
	res.ResetBudget()
	res.StartBackfill()
	ctx := context.Background()

	meta, ok := res.Resolve(ctx, "row-fr", Market{Title: "Will France win on 2026-09-28?"}, "sports")
	if !ok || !strings.Contains(meta.SourceURL, "Flag of France.svg") {
		t.Fatalf("France must get its preferred flag: %+v, %v", meta, ok)
	}
	if meta.Path != "/images/markets/row-fr.png" {
		t.Fatalf("the SVG's PNG rendition must be stored as .png, got %q", meta.Path)
	}

	if _, ok := res.Resolve(ctx, "row-muse", Market{Title: "Will Muse rank #1 in App Store?"}, "tech"); ok {
		t.Fatalf("a band must not illustrate a tech market named after it")
	}
	if l, err := res.lookupWikidata(ctx, "Inc", "economics"); err != nil || l.Found {
		t.Fatalf("a short alias must not match: %+v %v", l, err)
	}

	meta, ok = res.Resolve(ctx, "row-tsla", Market{Title: "Will Tesla deliver 500k cars this quarter?"}, "tech")
	if !ok || !strings.Contains(meta.SourceURL, "Tesla T icon.svg") {
		t.Fatalf("a small icon must win over a wide wordmark: %+v, %v", meta, ok)
	}

	meta, ok = res.Resolve(ctx, "row-gs", Market{Title: "What will The Goldman Sachs Group, Inc. say during their next earnings call?"}, "economics")
	if !ok || !strings.Contains(meta.Credit, "Marcus by Goldman Sachs app icon") {
		t.Fatalf("a company with only a wordmark must get its flagship app's icon: %+v, %v", meta, ok)
	}
	if meta.SourceURL != "https://apps.apple.com/us/app/marcus/id1" || !strings.Contains(meta.License, "trademark of Goldman Sachs") {
		t.Fatalf("the app icon must link its store page and name its owner: %+v", meta)
	}
	f, err := os.Open(filepath.Join(root, "images", "markets", "row-gs.png"))
	if err != nil {
		t.Fatalf("icon not written: %v", err)
	}
	defer f.Close()
	if cfg, err := png.DecodeConfig(f); err != nil || cfg.Width != 200 || cfg.Height != 200 {
		t.Fatalf("the app icon must be stored as served, got %dx%d (%v)", cfg.Width, cfg.Height, err)
	}

	if meta, ok := res.Resolve(ctx, "row-acme", Market{Title: "Will Acme beat earnings?"}, "economics"); ok {
		t.Fatalf("a wordmark alone, or someone else's app, must give no cover: %+v", meta)
	}

	// The app icon is the last resort: the company's own photo wins, and so
	// does a free image for another subject of the title.
	meta, ok = res.Resolve(ctx, "row-initech", Market{Title: "Will Initech beat earnings?"}, "economics")
	if !ok || !strings.Contains(meta.SourceURL, "Initech HQ.jpg") {
		t.Fatalf("a free photo must win over the company's app icon: %+v, %v", meta, ok)
	}
	meta, ok = res.Resolve(ctx, "row-globex", Market{Title: "Will Globex open an office in France?"}, "economics")
	if !ok || !strings.Contains(meta.SourceURL, "Flag of France.svg") {
		t.Fatalf("another subject's free image must win over an app icon: %+v, %v", meta, ok)
	}
	meta, ok = res.Resolve(ctx, "row-globex2", Market{Title: "Will Globex beat earnings?"}, "economics")
	if !ok || !strings.Contains(meta.Credit, "Globex app icon") {
		t.Fatalf("with nothing free anywhere, the company's app icon stands in: %+v, %v", meta, ok)
	}

	// Replacing: a fresh file name, so the CDN's cached copy of the old
	// cover is never served in its place.
	meta, ok, complete := res.ReplaceChecked(ctx, "row-fr", Market{Title: "Will France win on 2026-09-28?"}, "sports")
	if !ok || !complete || !strings.HasPrefix(meta.Path, "/images/markets/row-fr-") || !strings.HasSuffix(meta.Path, ".png") {
		t.Fatalf("a replaced cover must get a fresh name: %+v, %v, %v", meta, ok, complete)
	}
	res.rehoster.RemoveCoversExcept("row-fr", meta.Path)
	left, _ := filepath.Glob(filepath.Join(root, "images", "markets", "row-fr*"))
	if len(left) != 1 || filepath.Base(left[0]) != filepath.Base(meta.Path) {
		t.Fatalf("only the new cover may remain, got %v", left)
	}
}

func TestNamesDeveloper(t *testing.T) {
	cases := []struct {
		developer, name string
		want            bool
	}{
		{"Anthropic PBC", "Anthropic", true},
		{"OpenAI OpCo, LLC", "OpenAI", true},
		{"Hangzhou DeepSeek Artificial Intelligence Co., Ltd", "DeepSeek", true},
		{"Space Exploration Technologies Corp.", "SpaceX", false},
		{"JARVISY LTD", "OpenAI", false},
		{"Openchat Inc", "OpenAI", false},
		{"Goldman Sachs Bank USA", "Goldman Sachs", true},
		{"Anything", "", false},
	}
	for _, c := range cases {
		if got := namesDeveloper(c.developer, c.name); got != c.want {
			t.Errorf("namesDeveloper(%q, %q) = %v, want %v", c.developer, c.name, got, c.want)
		}
	}
}

// The fetched rows of a sync may spend only half the entity budget; the
// board-first backfill gets the rest.
func TestCoverResolver_ReservesHalfForBackfill(t *testing.T) {
	offlineWikimedia(t)
	res := NewCoverResolver(NewImageRehoster(t.TempDir()), &memoryCoverStore{})
	res.entityBudget = 4
	res.ResetBudget()
	ctx := context.Background()
	names := []string{"Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"}
	short := false
	for i, name := range names[:4] {
		if _, _, complete := res.ResolveChecked(ctx, "row-"+name, Market{Title: "Will " + name + " win?"}, "economics"); !complete {
			short = true
			break
		} else if i == 3 {
			t.Fatalf("four subjects cannot fit in half of a budget of four")
		}
	}
	if !short || res.entityUsed != 2 {
		t.Fatalf("fetched rows must stop at half the budget: used=%d short=%v", res.entityUsed, short)
	}
	res.StartBackfill()
	if _, _, complete := res.ResolveChecked(ctx, "row-Echo", Market{Title: "Will Echo win?"}, "economics"); !complete || res.entityUsed != 3 {
		t.Fatalf("the backfill gets the held-back lookups: used=%d complete=%v", res.entityUsed, complete)
	}
}
