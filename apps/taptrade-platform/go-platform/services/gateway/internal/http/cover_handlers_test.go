package http

import (
	"database/sql"
	stdhttp "net/http"
	"testing"

	_ "github.com/lib/pq"
)

// The cover routes must coexist with every other registration on the
// gateway mux. net/http panics at boot on a duplicate pattern, which is how
// the 2026-09-27 stage-4 deploy took the gateway down: this reproduces the
// lifecycle handler's "/api/v1/admin/markets/" prefix and registers the
// cover routes beside it.
func TestRegisterCoverRoutesDoesNotCollideWithAdminMarketsPrefix(t *testing.T) {
	mux := stdhttp.NewServeMux()
	mux.Handle("/api/v1/admin/markets/", stdhttp.NotFoundHandler())
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("registering cover routes panicked: %v", r)
		}
	}()
	registerCoverRoutes(mux, openTestDBOrNil())
}

// openTestDBOrNil hands registerCoverRoutes a *sql.DB it will only use
// lazily per request; a nil makes it register nothing, so the collision
// test needs a real handle. sql.Open does not connect.
func openTestDBOrNil() *sql.DB {
	db, err := sql.Open("postgres", "postgres://unused/unused?sslmode=disable")
	if err != nil {
		return nil
	}
	return db
}
