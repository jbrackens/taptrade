package discover

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"

	_ "github.com/lib/pq"
)

// Cover storage (migration 060): resolved covers and their credits land on
// the imported row, a hand-set image is never overwritten, and credited
// covers surface on the attributions list. Skipped unless GATEWAY_DB_DSN is
// set, like the other SQL-backed tests.
func TestSQLCoverStorage(t *testing.T) {
	dsn := os.Getenv("GATEWAY_DB_DSN")
	if dsn == "" {
		t.Skip("set GATEWAY_DB_DSN to run the cover storage integration test")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	hash := "covertest" + suffix
	t.Cleanup(func() {
		_, _ = db.ExecContext(ctx, `DELETE FROM prediction_markets WHERE ticker = $1`, "IMP-"+hashPrefix(hash))
		_, _ = db.ExecContext(ctx, `DELETE FROM prediction_events WHERE title = $1`, "cover test event "+suffix)
		_, _ = db.ExecContext(ctx, `DELETE FROM imported_markets WHERE external_hash = $1`, hash)
		_, _ = db.ExecContext(ctx, `DELETE FROM cover_lookups WHERE lookup_key LIKE 'covertest:%'`)
		db.Close()
	})
	if err := db.PingContext(ctx); err != nil {
		t.Skipf("GATEWAY_DB_DSN set but db not reachable: %v", err)
	}

	repo := NewRepository(db)
	ur, err := repo.Reserve(ctx, hash)
	if err != nil {
		t.Fatalf("reserve: %v", err)
	}
	if err := repo.Update(ctx, ur.ID, Row{ID: ur.ID, ExternalHash: hash, Title: "Cover test " + suffix}); err != nil {
		t.Fatalf("update: %v", err)
	}
	needs, err := repo.NeedsCover(ctx, ur.ID)
	if err != nil || !needs {
		t.Fatalf("a bare row needs a cover: %v %v", needs, err)
	}

	// Promoted counterpart so the attribution list can join it.
	var eventID string
	if err := db.QueryRowContext(ctx,
		`INSERT INTO prediction_events (title, status, close_at) VALUES ($1, 'open', now() + interval '30 days') RETURNING id`,
		"cover test event "+suffix).Scan(&eventID); err != nil {
		t.Fatalf("seed event: %v", err)
	}
	var marketID string
	if err := db.QueryRowContext(ctx,
		`INSERT INTO prediction_markets (event_id, ticker, title, status, settlement_source_key, settlement_rule, close_at)
		 VALUES ($1, $2, $3, 'open', 'manual', 'manual-attestation', now() + interval '30 days') RETURNING id`,
		eventID, "IMP-"+hashPrefix(hash), "Cover test "+suffix).Scan(&marketID); err != nil {
		t.Fatalf("seed market: %v", err)
	}

	meta := CoverMeta{Path: "/images/markets/" + ur.ID + ".jpg", Credit: "Someone / Wikimedia Commons (CC BY 4.0)", License: "CC BY 4.0", SourceURL: "https://commons.wikimedia.org/wiki/File:X.jpg", Origin: "entity"}
	if err := repo.SetImage(ctx, ur.ID, meta); err != nil {
		t.Fatalf("set image: %v", err)
	}
	if needs, _ := repo.NeedsCover(ctx, ur.ID); needs {
		t.Fatalf("a resolved row no longer needs a cover")
	}
	if _, err := repo.AlignPromotedMarketImages(ctx); err != nil {
		t.Fatalf("align: %v", err)
	}
	attributions, err := repo.ListAttributions(ctx, 1000)
	if err != nil {
		t.Fatalf("attributions: %v", err)
	}
	found := false
	for _, a := range attributions {
		if a.Ticker == "IMP-"+hashPrefix(hash) && a.Credit == meta.Credit && a.ImagePath == meta.Path {
			found = true
		}
	}
	if !found {
		t.Fatalf("credited cover missing from attributions")
	}

	// Hand-set image: sticks through a later sync update and a resolver write.
	if ok, err := repo.SetManualImage(ctx, marketID, "/images/markets/hand.jpg"); err != nil || !ok {
		t.Fatalf("manual image: %v %v", ok, err)
	}
	if err := repo.Update(ctx, ur.ID, Row{ID: ur.ID, ExternalHash: hash, Title: "Cover test " + suffix, ImagePath: ptr("/images/markets/upstream.jpg")}); err != nil {
		t.Fatalf("update after manual: %v", err)
	}
	if err := repo.SetImage(ctx, ur.ID, meta); err != nil {
		t.Fatalf("set image after manual: %v", err)
	}
	var path, origin string
	if err := db.QueryRowContext(ctx, `SELECT image_path, image_origin FROM imported_markets WHERE id = $1`, ur.ID).Scan(&path, &origin); err != nil {
		t.Fatalf("read row: %v", err)
	}
	if path != "/images/markets/hand.jpg" || origin != "manual" {
		t.Fatalf("manual cover overwritten: %s %s", path, origin)
	}
	if n, err := repo.ClearImagePaths(ctx, []string{ur.ID}); err != nil || n != 0 {
		t.Fatalf("sweep must skip manual covers, cleared %d (%v)", n, err)
	}

	// Lookup cache round-trip.
	if err := repo.SaveCoverLookup(ctx, CoverLookup{Key: "covertest:" + suffix, Found: true, ImageURL: "https://img/x.jpg", Credit: "c", License: "CC0", Origin: "topic"}); err != nil {
		t.Fatalf("save lookup: %v", err)
	}
	l, err := repo.LoadCoverLookup(ctx, "covertest:"+suffix)
	if err != nil || l == nil || !l.Found || l.ImageURL != "https://img/x.jpg" || l.License != "CC0" {
		t.Fatalf("load lookup = %+v, %v", l, err)
	}
	// A miss on a company keeps the name for the App Store last resort.
	if err := repo.SaveCoverLookup(ctx, CoverLookup{Key: "covertest-app:" + suffix, Found: false, Origin: "entity", AppName: "Anthropic"}); err != nil {
		t.Fatalf("save miss: %v", err)
	}
	if l, err := repo.LoadCoverLookup(ctx, "covertest-app:"+suffix); err != nil || l == nil || l.Found || l.AppName != "Anthropic" {
		t.Fatalf("a miss must keep its app name: %+v, %v", l, err)
	}
	if l, err := repo.LoadCoverLookup(ctx, "covertest:missing"); err != nil || l != nil {
		t.Fatalf("unknown key must load as nil: %+v %v", l, err)
	}
}

func hashPrefix(hash string) string {
	if len(hash) > 8 {
		hash = hash[:8]
	}
	return upper(hash)
}

func upper(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'a' && c <= 'z' {
			b[i] = c - 32
		}
	}
	return string(b)
}

func ptr(s string) *string { return &s }
