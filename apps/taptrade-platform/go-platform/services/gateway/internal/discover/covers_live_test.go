package discover

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// TestCoverResolver_Live runs the resolver against the real Wikidata,
// Commons and App Store for a list of market titles and writes what it
// picked, for review before shipping a change to the resolver. Opt-in:
//
//	COVER_LIVE_TEST=/path/titles.json COVER_LIVE_OUT=/path/out go test ./internal/discover -run Live -v
//
// titles.json is [{"title": "...", "eventTitle": "...", "category": "..."}].
func TestCoverResolver_Live(t *testing.T) {
	in := os.Getenv("COVER_LIVE_TEST")
	if in == "" {
		t.Skip("set COVER_LIVE_TEST to a titles.json to resolve covers against the real repositories")
	}
	out := os.Getenv("COVER_LIVE_OUT")
	if out == "" {
		out = t.TempDir()
	}
	raw, err := os.ReadFile(in)
	if err != nil {
		t.Fatalf("read titles: %v", err)
	}
	var titles []struct {
		Title      string `json:"title"`
		EventTitle string `json:"eventTitle"`
		Category   string `json:"category"`
	}
	if err := json.Unmarshal(raw, &titles); err != nil {
		t.Fatalf("parse titles: %v", err)
	}
	res := NewCoverResolver(NewImageRehoster(out), nil)
	res.entityBudget = 1000
	res.ResetBudget()
	res.StartBackfill()
	type pick struct {
		Title    string   `json:"title"`
		Origin   string   `json:"origin"`
		Path     string   `json:"path"`
		Credit   string   `json:"credit"`
		Source   string   `json:"source"`
		Subjects []string `json:"subjects"`
	}
	var picks []pick
	found := 0
	for i, tt := range titles {
		m := Market{Title: tt.Title, EventTitle: tt.EventTitle}
		meta, ok, _ := res.ResolveChecked(context.Background(), fmt.Sprintf("live-%03d", i), m, tt.Category)
		if ok {
			found++
		}
		picks = append(picks, pick{Title: tt.Title, Origin: meta.Origin, Path: meta.Path, Credit: meta.Credit, Source: meta.SourceURL, Subjects: subjectCandidates(tt.Title)})
	}
	data, _ := json.MarshalIndent(picks, "", "  ")
	_ = os.WriteFile(filepath.Join(out, "picks.json"), data, 0o644)
	t.Logf("resolved %d of %d; picks in %s", found, len(titles), filepath.Join(out, "picks.json"))
}
