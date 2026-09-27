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

// The rotating Kalshi scan resumes from discover_cursors (migration 058).
// Skipped unless GATEWAY_DB_DSN is set, like the other SQL-backed tests.
func TestSQLCursorRoundTrip(t *testing.T) {
	dsn := os.Getenv("GATEWAY_DB_DSN")
	if dsn == "" {
		t.Skip("set GATEWAY_DB_DSN to run the discover_cursors integration test")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	ctx := context.Background()
	source := fmt.Sprintf("cursor-test-%d", time.Now().UnixNano())
	t.Cleanup(func() {
		if _, err := db.ExecContext(ctx, `DELETE FROM discover_cursors WHERE source = $1`, source); err != nil {
			t.Logf("cleanup: %v", err)
		}
		db.Close()
	})
	if err := db.PingContext(ctx); err != nil {
		t.Skipf("GATEWAY_DB_DSN set but db not reachable: %v", err)
	}

	repo := NewRepository(db)
	got, err := repo.LoadCursor(ctx, source, "events:open")
	if err != nil || got != "" {
		t.Fatalf("unsaved cursor should load as empty, got %q, %v", got, err)
	}
	if err := repo.SaveCursor(ctx, source, "events:open", "p7"); err != nil {
		t.Fatalf("SaveCursor: %v", err)
	}
	if err := repo.SaveCursor(ctx, source, "events:open", "p8"); err != nil {
		t.Fatalf("SaveCursor (update): %v", err)
	}
	if got, err = repo.LoadCursor(ctx, source, "events:open"); err != nil || got != "p8" {
		t.Fatalf("LoadCursor after two saves = %q, %v; want p8", got, err)
	}
	if got, err = repo.LoadCursor(ctx, source, "events:settled"); err != nil || got != "" {
		t.Fatalf("another listing must not share the cursor, got %q, %v", got, err)
	}
}
