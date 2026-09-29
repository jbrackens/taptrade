package http

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	_ "github.com/lib/pq"

	"taptrade/gateway/internal/compliance"
)

// A KYC store that fails to start must never leave the gateway on the
// auto-approving mock (TD-006).
func TestSelectKYCServiceFailsClosed(t *testing.T) {
	// sql.Open does not connect, so this is a non-nil handle with no server.
	db, err := sql.Open("postgres", "postgres://unused@127.0.0.1:1/none?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	failing := func(*sql.DB) (*compliance.PostgresKYCService, error) {
		return nil, errors.New("schema bootstrap failed")
	}
	mustNotCall := func(*sql.DB) (*compliance.PostgresKYCService, error) {
		t.Fatal("the Postgres constructor must not run without a database")
		return nil, nil
	}

	cases := []struct {
		name     string
		db       *sql.DB
		newPG    func(*sql.DB) (*compliance.PostgresKYCService, error)
		realEnv  bool
		wantMock bool
	}{
		{"store fails to start in production", db, failing, true, false},
		{"store fails to start in development", db, failing, false, false},
		{"no database in production", nil, mustNotCall, true, false},
		{"no database in development", nil, mustNotCall, false, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc, pg := selectKYCService(tc.db, tc.newPG, tc.realEnv)
			if pg != nil {
				t.Fatalf("no Postgres service expected, got one")
			}
			_, isMock := svc.(*compliance.MockKYCService)
			if isMock != tc.wantMock {
				t.Fatalf("mock selected = %v, want %v (%T)", isMock, tc.wantMock, svc)
			}
			if !tc.wantMock {
				status, err := svc.GetVerificationStatus(context.Background(), "u-1")
				if err != nil || status.Status != "pending" {
					t.Fatalf("fail-closed status = %+v, %v; want pending", status, err)
				}
			}
		})
	}
}
