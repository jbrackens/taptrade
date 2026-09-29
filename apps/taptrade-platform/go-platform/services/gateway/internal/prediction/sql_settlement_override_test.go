package prediction

import (
	"context"
	"database/sql"
	"testing"
)

// An override reason sent with a settlement must be stored with who and
// when (the table's all-or-none CHECK); it used to be accepted and dropped.
//
// Run with: GATEWAY_DB_DSN=... go test ./internal/prediction/ -run TestSettlementStoresOverride -v
func TestSettlementStoresOverride(t *testing.T) {
	db := raceTestDB(t)
	repo := NewSQLRepository(db)
	engine := NewSettlementEngine(repo, &txWalletStub{db: db})
	ctx := context.Background()

	read := func(marketID string) (reason, by sql.NullString, at sql.NullTime) {
		t.Helper()
		if err := db.QueryRow(
			`SELECT override_reason, overridden_by_user_id, overridden_at
			 FROM prediction_settlements WHERE market_id=$1`, marketID,
		).Scan(&reason, &by, &at); err != nil {
			t.Fatalf("read settlement override: %v", err)
		}
		return reason, by, at
	}

	t.Run("with a reason", func(t *testing.T) {
		marketID := seedClosedMarketWithNPositions(t, db, "override", 2)
		admin := "admin-override-test"
		why := "  drift reconciled, ticket OPS-42  "
		if _, _, err := engine.ResolveMarket(ctx, ResolveMarketRequest{
			Result:            MarketResultYes,
			AttestationSource: "admin-manual",
			OverrideReason:    &why,
		}, marketID, &admin); err != nil {
			t.Fatalf("ResolveMarket with override: %v", err)
		}
		reason, by, at := read(marketID)
		if reason.String != "drift reconciled, ticket OPS-42" || by.String != admin || !at.Valid {
			t.Fatalf("stored override = %q by %q at %v; want the trimmed reason, %q, and a time", reason.String, by.String, at, admin)
		}
	})

	t.Run("without a reason", func(t *testing.T) {
		marketID := seedClosedMarketWithNPositions(t, db, "no-override", 2)
		blank := "   "
		if _, _, err := engine.ResolveMarket(ctx, ResolveMarketRequest{
			Result:            MarketResultNo,
			AttestationSource: "admin-manual",
			OverrideReason:    &blank,
		}, marketID, nil); err != nil {
			t.Fatalf("ResolveMarket without override: %v", err)
		}
		reason, by, at := read(marketID)
		if reason.Valid || by.Valid || at.Valid {
			t.Fatalf("no override expected, got %q / %q / %v", reason.String, by.String, at)
		}
	})
}
