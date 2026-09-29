package http

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	stdhttp "net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"taptrade/gateway/internal/bonus"
	"taptrade/gateway/internal/events"
	"taptrade/gateway/internal/wallet"
	"taptrade/platform/transport/httpx"
)

func TestClaimBonusPersistsPointWalletLedgerThroughHTTP(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("GATEWAY_DB_DSN"))
	if dsn == "" {
		t.Skip("set GATEWAY_DB_DSN to run the persisted bonus/ledger proof")
	}

	ctx := context.Background()
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatalf("open gateway db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.PingContext(ctx); err != nil {
		t.Skipf("GATEWAY_DB_DSN set but db not reachable: %v", err)
	}

	walletSvc, err := wallet.NewServiceWithDB("postgres", dsn)
	if err != nil {
		t.Fatalf("open wallet db service: %v", err)
	}
	t.Cleanup(func() { _ = walletSvc.DB().Close() })

	bonusSvc := bonus.NewService(bonus.NewRepository(db), walletSvc, events.NewBus())
	suffix := fmt.Sprintf("bonus-ledger-%d", time.Now().UnixNano())
	userID := "u-" + suffix
	spoofedUserID := "u-spoof-" + suffix
	grantPoints := int64(1500)
	budgetPoints := int64(10000)
	maxClaims := 3

	campaign, err := bonusSvc.CreateCampaign(ctx, bonus.CreateCampaignRequest{
		Name:         "Loop 308 Point Bonus Proof " + suffix,
		Description:  "Non-redeemable point-play proof.",
		CampaignType: "custom",
		StartAt:      time.Now().UTC().Add(-time.Hour),
		EndAt:        time.Now().UTC().Add(time.Hour),
		BudgetPoints: &budgetPoints,
		MaxClaims:    &maxClaims,
		CreatedBy:    "loop-308-proof",
		Rules: []bonus.RuleInput{
			{
				RuleType: "reward",
				PointRuleConfig: mustJSONRaw(t, map[string]any{
					"type":                "point_grant",
					"fixed_amount_points": grantPoints,
					"expiry_days":         7,
				}),
			},
		},
	})
	if err != nil {
		t.Fatalf("create campaign: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM wallet_ledger WHERE user_id IN ($1, $2)`, userID, spoofedUserID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM wallet_balances WHERE user_id IN ($1, $2)`, userID, spoofedUserID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM player_bonuses WHERE user_id IN ($1, $2)`, userID, spoofedUserID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM campaigns WHERE id = $1`, campaign.ID)
	})
	if err := bonusSvc.ActivateCampaign(ctx, campaign.ID); err != nil {
		t.Fatalf("activate campaign: %v", err)
	}

	mux := stdhttp.NewServeMux()
	registerBonusRoutes(mux, bonusSvc)

	body := fmt.Sprintf(`{"campaign_id":%d,"trigger_reference":"loop-308-live-bonus-proof","user_id":%q}`, campaign.ID, spoofedUserID)
	req := httptest.NewRequest(stdhttp.MethodPost, "/api/v1/bonuses/claim", bytes.NewBufferString(body))
	req = req.WithContext(httpx.WithTestUser(req.Context(), userID, "loop308@taptrade.local", "player"))
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)
	if rec.Code != stdhttp.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode claim response: %v; body=%s", err, rec.Body.String())
	}
	assertJSONValue(t, payload, "unit", "PTS")
	assertJSONNumber(t, payload, "grantedPoints", grantPoints)
	assertJSONNumber(t, payload, "remainingPoints", grantPoints)
	for _, retired := range []string{
		"grantedAmountPoints",
		"remainingAmountPoints",
		"wageringRequiredPoints",
		"wageringCompletedPoints",
		"wageringProgressPct",
		"progressPct",
		"playRequiredPoints",
		"playCompletedPoints",
		"playProgressPct",
	} {
		if _, ok := payload[retired]; ok {
			t.Fatalf("retired bonus response field %q leaked in %s", retired, rec.Body.String())
		}
	}

	bonusID := int64(jsonNumber(t, payload, "bonusId"))
	assertPersistedBonusAndWalletLedger(t, db, userID, campaign.ID, bonusID, grantPoints)
	assertNoBonusWalletLedgerForUser(t, db, spoofedUserID)

	duplicate := httptest.NewRequest(stdhttp.MethodPost, "/api/v1/bonuses/claim", bytes.NewBufferString(body))
	duplicate = duplicate.WithContext(httpx.WithTestUser(duplicate.Context(), userID, "loop308@taptrade.local", "player"))
	dupRec := httptest.NewRecorder()
	mux.ServeHTTP(dupRec, duplicate)
	if dupRec.Code != stdhttp.StatusConflict {
		t.Fatalf("expected duplicate claim 409, got %d: %s", dupRec.Code, dupRec.Body.String())
	}
	assertSingleBonusWalletLedgerCredit(t, db, userID, bonusID)
}

func mustJSONRaw(t *testing.T, value any) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal JSON: %v", err)
	}
	return b
}

func assertJSONValue(t *testing.T, payload map[string]any, key string, want any) {
	t.Helper()
	if got := payload[key]; got != want {
		t.Fatalf("expected %s=%v, got %v in %#v", key, want, got, payload)
	}
}

func assertJSONNumber(t *testing.T, payload map[string]any, key string, want int64) {
	t.Helper()
	got := int64(jsonNumber(t, payload, key))
	if got != want {
		t.Fatalf("expected %s=%d, got %d in %#v", key, want, got, payload)
	}
}

func jsonNumber(t *testing.T, payload map[string]any, key string) float64 {
	t.Helper()
	got, ok := payload[key].(float64)
	if !ok {
		t.Fatalf("expected numeric %s, got %#v in %#v", key, payload[key], payload)
	}
	return got
}

func assertPersistedBonusAndWalletLedger(t *testing.T, db *sql.DB, userID string, campaignID, bonusID, amount int64) {
	t.Helper()

	var bonusCount int
	if err := db.QueryRow(
		`SELECT COUNT(*)
		   FROM player_bonuses
		  WHERE id = $1
		    AND user_id = $2
		    AND campaign_id = $3
		    AND status = 'active'
		    AND granted_amount_points = $4
		    AND remaining_amount_points = $4`,
		bonusID, userID, campaignID, amount,
	).Scan(&bonusCount); err != nil {
		t.Fatalf("read persisted player bonus: %v", err)
	}
	if bonusCount != 1 {
		t.Fatalf("expected one active persisted player bonus, got %d", bonusCount)
	}

	var ledgerAmount, ledgerBalance int64
	var fundType, idempotencyKey, reason string
	if err := db.QueryRow(
		`SELECT amount_points, balance_points, fund_type, idempotency_key, reason
		   FROM wallet_ledger
		  WHERE user_id = $1
		    AND entry_type = 'credit'
		    AND idempotency_key = $2
		  ORDER BY id DESC
		  LIMIT 1`,
		userID, fmt.Sprintf("bonus-grant:%d", bonusID),
	).Scan(&ledgerAmount, &ledgerBalance, &fundType, &idempotencyKey, &reason); err != nil {
		t.Fatalf("read bonus wallet ledger credit: %v", err)
	}
	if ledgerAmount != amount || ledgerBalance != amount || fundType != "bonus" {
		t.Fatalf("unexpected ledger credit amount=%d balance=%d fundType=%q", ledgerAmount, ledgerBalance, fundType)
	}
	if idempotencyKey != fmt.Sprintf("bonus-grant:%d", bonusID) {
		t.Fatalf("unexpected idempotency key %q", idempotencyKey)
	}
	for _, retired := range []string{"cashier", "crypto", "deposit", "fiat", "freebet", "prize", "usd", "withdraw"} {
		if strings.Contains(strings.ToLower(reason), retired) {
			t.Fatalf("bonus ledger reason leaked retired vocabulary %q: %q", retired, reason)
		}
	}

	var balance int64
	if err := db.QueryRow(
		`SELECT bonus_balance_points FROM wallet_balances WHERE user_id = $1`,
		userID,
	).Scan(&balance); err != nil {
		t.Fatalf("read bonus wallet balance: %v", err)
	}
	if balance != amount {
		t.Fatalf("expected bonus wallet balance %d, got %d", amount, balance)
	}
}

func assertNoBonusWalletLedgerForUser(t *testing.T, db *sql.DB, userID string) {
	t.Helper()
	var count int
	if err := db.QueryRow(
		`SELECT COUNT(*) FROM wallet_ledger WHERE user_id = $1 AND idempotency_key LIKE 'bonus-grant:%'`,
		userID,
	).Scan(&count); err != nil {
		t.Fatalf("count spoofed user bonus ledger rows: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected no bonus ledger rows for spoofed body user, got %d", count)
	}
}

func assertSingleBonusWalletLedgerCredit(t *testing.T, db *sql.DB, userID string, bonusID int64) {
	t.Helper()
	var count int
	if err := db.QueryRow(
		`SELECT COUNT(*)
		   FROM wallet_ledger
		  WHERE user_id = $1
		    AND entry_type = 'credit'
		    AND idempotency_key = $2`,
		userID, fmt.Sprintf("bonus-grant:%d", bonusID),
	).Scan(&count); err != nil {
		t.Fatalf("count bonus ledger rows: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected exactly one bonus ledger credit after duplicate claim, got %d", count)
	}
}
