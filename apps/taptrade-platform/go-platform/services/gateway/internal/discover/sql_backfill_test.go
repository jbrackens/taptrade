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

// Cover backfill storage (migration 062): bare open imports are listed
// board-first and each is tried once per window; a cover the shared-image
// sweep dropped is not re-applied by later syncs; resolver covers are never
// judged by the sweep. Skipped unless GATEWAY_DB_DSN is set.
func TestSQLCoverBackfill(t *testing.T) {
	dsn := os.Getenv("GATEWAY_DB_DSN")
	if dsn == "" {
		t.Skip("set GATEWAY_DB_DSN to run the cover backfill integration test")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	var hashes []string
	t.Cleanup(func() {
		for _, h := range hashes {
			_, _ = db.ExecContext(ctx, `DELETE FROM prediction_markets WHERE ticker = $1`, "IMP-"+hashPrefix(h))
			_, _ = db.ExecContext(ctx, `DELETE FROM imported_markets WHERE external_hash = $1`, h)
		}
		_, _ = db.ExecContext(ctx, `DELETE FROM prediction_events WHERE title = $1`, "backfill test event "+suffix)
		db.Close()
	})
	if err := db.PingContext(ctx); err != nil {
		t.Skipf("GATEWAY_DB_DSN set but db not reachable: %v", err)
	}
	repo := NewRepository(db)
	var eventID string
	if err := db.QueryRowContext(ctx,
		`INSERT INTO prediction_events (title, status, close_at) VALUES ($1, 'open', now() + interval '30 days') RETURNING id`,
		"backfill test event "+suffix).Scan(&eventID); err != nil {
		t.Fatalf("seed event: %v", err)
	}
	seed := func(tag string, yes int, vol24h float64, image *string) string {
		t.Helper()
		// Hash prefixes must be unique per row (tickers use the first 8).
		h := fmt.Sprintf("%s%s", tag, suffix)
		hashes = append(hashes, h)
		ur, err := repo.Reserve(ctx, h)
		if err != nil {
			t.Fatalf("reserve: %v", err)
		}
		if err := repo.Update(ctx, ur.ID, Row{ID: ur.ID, ExternalHash: h, Title: "Backfill " + tag, Volume24h: vol24h, ImagePath: image}); err != nil {
			t.Fatalf("update: %v", err)
		}
		if _, err := db.ExecContext(ctx,
			`INSERT INTO prediction_markets (event_id, ticker, title, status, settlement_source_key, settlement_rule, close_at, yes_price_points, no_price_points)
			 VALUES ($1, $2, $3, 'open', 'manual', 'manual-attestation', now() + interval '30 days', $4, $5)`,
			eventID, "IMP-"+hashPrefix(h), "Backfill "+tag, yes, 100-yes); err != nil {
			t.Fatalf("seed market: %v", err)
		}
		return ur.ID
	}
	img := func(s string) *string { return &s }

	busy := seed("bfbusy01", 50, 900, nil)
	quiet := seed("bfquiet1", 50, 10, nil)
	settled := seed("bfsettl1", 1, 5000, nil)
	withImage := seed("bfimage1", 50, 800, img("/images/markets/x.jpg"))

	list, err := repo.ListBareOpenImports(ctx, 500)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	pos := map[string]int{}
	for i, b := range list {
		pos[b.ID] = i + 1
	}
	if pos[withImage] != 0 {
		t.Fatalf("a row with an image is not bare")
	}
	if pos[busy] == 0 || pos[quiet] == 0 || pos[settled] == 0 {
		t.Fatalf("bare open rows missing from the backfill list: %v", pos)
	}
	if !(pos[busy] < pos[quiet] && pos[quiet] < pos[settled]) {
		t.Fatalf("backfill order must be contested-first, then 24h volume: busy=%d quiet=%d settled=%d", pos[busy], pos[quiet], pos[settled])
	}

	// Tried and found nothing: off the list for the window.
	if err := repo.MarkCoverChecked(ctx, quiet); err != nil {
		t.Fatalf("mark checked: %v", err)
	}
	list, _ = repo.ListBareOpenImports(ctx, 500)
	for _, b := range list {
		if b.ID == quiet {
			t.Fatalf("a checked row must wait out the retry window")
		}
	}

	// The sweep drops an upstream image and marks the row swept; a later
	// sync bringing the same upstream image does not re-apply it, and the
	// row goes back on the backfill list.
	if _, err := repo.ClearImagePaths(ctx, []string{withImage}); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if err := repo.Update(ctx, withImage, Row{ID: withImage, ExternalHash: hashes[3], Title: "Backfill bfimage1", ImagePath: img("/images/markets/x.jpg")}); err != nil {
		t.Fatalf("resync: %v", err)
	}
	var path sql.NullString
	var origin string
	if err := db.QueryRowContext(ctx, `SELECT image_path, image_origin FROM imported_markets WHERE id = $1`, withImage).Scan(&path, &origin); err != nil {
		t.Fatalf("read: %v", err)
	}
	if path.Valid || origin != "swept" {
		t.Fatalf("a swept image must stay dropped across syncs: path=%v origin=%q", path, origin)
	}
	list, _ = repo.ListBareOpenImports(ctx, 500)
	found := false
	for _, b := range list {
		found = found || b.ID == withImage
	}
	if !found {
		t.Fatalf("a swept row must be back on the backfill list")
	}

	// A resolver cover is never judged by the sweep.
	if err := repo.SetImage(ctx, busy, CoverMeta{Path: "/images/markets/flag.png", Origin: "entity", Credit: "c"}); err != nil {
		t.Fatalf("set image: %v", err)
	}
	rows, err := repo.ListImageRows(ctx)
	if err != nil {
		t.Fatalf("image rows: %v", err)
	}
	for _, r := range rows {
		if r.ID == busy {
			t.Fatalf("the shared-image sweep must only see upstream images")
		}
	}
	if n, _ := repo.ClearImagePaths(ctx, []string{busy}); n != 0 {
		t.Fatalf("the sweep must not clear a resolver cover, cleared %d", n)
	}

	// A resolver cover is off the list once set; queued for another look
	// (migration 063 clears cover_checked_at) it comes back flagged HasCover.
	inList := func(id string) (BareImport, bool) {
		list, err := repo.ListBareOpenImports(ctx, 500)
		if err != nil {
			t.Fatalf("list: %v", err)
		}
		for _, b := range list {
			if b.ID == id {
				return b, true
			}
		}
		return BareImport{}, false
	}
	if _, ok := inList(busy); ok {
		t.Fatalf("a fresh resolver cover is not backfill work")
	}
	if _, err := db.ExecContext(ctx, `UPDATE imported_markets SET cover_checked_at = NULL WHERE image_origin = 'entity'`); err != nil {
		t.Fatalf("queue: %v", err)
	}
	if b, ok := inList(busy); !ok || !b.HasCover {
		t.Fatalf("a queued resolver cover must be listed with HasCover: %+v %v", b, ok)
	}
	if b, ok := inList(settled); !ok || b.HasCover {
		t.Fatalf("a bare row is listed without HasCover: %+v %v", b, ok)
	}

	// Nothing fits under the new rules: the cover goes, the row is checked.
	if err := repo.ClearResolverCover(ctx, busy); err != nil {
		t.Fatalf("clear: %v", err)
	}
	var credit sql.NullString
	var originAfter sql.NullString
	if err := db.QueryRowContext(ctx, `SELECT image_path, image_credit, image_origin FROM imported_markets WHERE id = $1`, busy).Scan(&path, &credit, &originAfter); err != nil {
		t.Fatalf("read: %v", err)
	}
	if path.Valid || credit.Valid || originAfter.Valid {
		t.Fatalf("a cleared resolver cover leaves the row bare: path=%v credit=%v origin=%v", path, credit, originAfter)
	}
	if _, ok := inList(busy); ok {
		t.Fatalf("a cleared row waits out the retry window")
	}
	if err := repo.ClearResolverCover(ctx, withImage); err != nil {
		t.Fatalf("clear swept: %v", err)
	}
	if err := db.QueryRowContext(ctx, `SELECT image_origin FROM imported_markets WHERE id = $1`, withImage).Scan(&origin); err != nil || origin != "swept" {
		t.Fatalf("only resolver covers are cleared, origin=%q err=%v", origin, err)
	}
}
