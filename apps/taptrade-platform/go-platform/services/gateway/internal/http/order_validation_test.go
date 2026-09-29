package http

import (
	"bytes"
	"encoding/json"
	"errors"
	stdhttp "net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"taptrade/gateway/internal/prediction"
	"taptrade/platform/transport/httpx"
)

// stubMarketBroadcaster is a no-op marketUpdateBroadcaster for tests
// that don't care about WS notifications.
type stubMarketBroadcaster struct{}

func (stubMarketBroadcaster) NotifyPredictionMarketUpdate(string, interface{})    {}
func (stubMarketBroadcaster) NotifyPredictionTrade(string, interface{})           {}
func (stubMarketBroadcaster) NotifyPredictionOrderBookUpdate(string, interface{}) {}
func (stubMarketBroadcaster) NotifyPortfolioUpdate(string, interface{})           {}
func (stubMarketBroadcaster) NotifyWalletUpdate(string, interface{})              {}

const orderTestUserID = "u-test"

// postOrder sends a POST /api/v1/orders with the given body and the
// X-User-ID fallback header (which userIDFromRequest reads when no
// context user is present). registerOrderRoutes is wired against a
// service with nil repo — these tests should reject at the validation
// gate, well before any repo call.
func postOrder(t *testing.T, body interface{}) *httptest.ResponseRecorder {
	t.Helper()
	buf, _ := json.Marshal(body)
	req := httptest.NewRequest(stdhttp.MethodPost, "/api/v1/orders", bytes.NewReader(buf))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-ID", orderTestUserID)
	rec := httptest.NewRecorder()

	mux := stdhttp.NewServeMux()
	registerOrderRoutes(mux, prediction.NewService(nil, nil), stubMarketBroadcaster{}, nil)
	mux.ServeHTTP(rec, req)
	return rec
}

func postOrderPreview(t *testing.T, body interface{}) *httptest.ResponseRecorder {
	t.Helper()
	buf, _ := json.Marshal(body)
	req := httptest.NewRequest(stdhttp.MethodPost, "/api/v1/orders/preview", bytes.NewReader(buf))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-ID", orderTestUserID)
	rec := httptest.NewRecorder()

	mux := stdhttp.NewServeMux()
	registerOrderRoutes(mux, prediction.NewService(nil, nil), stubMarketBroadcaster{}, nil)
	mux.ServeHTTP(rec, req)
	return rec
}

func TestPortfolioUpdatePayloadExposesPointAliases(t *testing.T) {
	payload := buildPortfolioUpdatePayload(&prediction.Order{
		ID:       "order-1",
		UserID:   "user-1",
		MarketID: "market-1",
		Side:     prediction.OrderSideYes,
		Action:   prediction.OrderActionBuy,
	}, &prediction.Trade{
		ID:          "trade-1",
		PricePoints: 64,
		Quantity:    12,
	})

	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal portfolio update payload: %v", err)
	}
	body := string(data)

	for _, want := range []string{
		`"userId":"user-1"`,
		`"marketId":"market-1"`,
		`"orderId":"order-1"`,
		`"tradeId":"trade-1"`,
		`"filledQuantity":12`,
		`"filledPricePoints":64`,
		`"unit":"PTS"`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("portfolio update payload missing %s in %s", want, body)
		}
	}
	for _, retired := range []string{`"filledPricePointsCents"`} {
		if strings.Contains(body, retired) {
			t.Fatalf("portfolio update payload should not emit retired alias %s in %s", retired, body)
		}
	}
}

func TestWalletUpdatePayloadExposesPointAliases(t *testing.T) {
	payload := buildWalletUpdatePayload("user-1", 9876, "order-1")

	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal wallet update payload: %v", err)
	}
	body := string(data)

	for _, want := range []string{
		`"userId":"user-1"`,
		`"balancePoints":9876`,
		`"unit":"PTS"`,
		`"reason":"order_fill"`,
		`"orderId":"order-1"`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("wallet update payload missing %s in %s", want, body)
		}
	}
	for _, retired := range []string{`"balancePointsCents"`} {
		if strings.Contains(body, retired) {
			t.Fatalf("wallet update payload should not emit retired alias %s in %s", retired, body)
		}
	}
}

func TestPlaceOrderRejectsMissingMarketID(t *testing.T) {
	rec := postOrder(t, map[string]any{
		"side":      "yes",
		"action":    "buy",
		"orderType": "market",
		"quantity":  1,
	})
	if rec.Code != stdhttp.StatusBadRequest {
		t.Fatalf("want 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "marketId") {
		t.Fatalf("error should mention marketId; got %s", rec.Body.String())
	}
}

func TestPlaceOrderRejectsMissingAction(t *testing.T) {
	// Regression for ISSUE-009: missing `action` used to surface as a
	// PostgreSQL CHECK constraint error
	//   "violates check constraint prediction_orders_action_check"
	// rather than a clean validation 400. This test guards the gate.
	rec := postOrder(t, map[string]any{
		"marketId":  "00000000-0000-0000-0000-000000000001",
		"side":      "yes",
		"orderType": "market",
		"quantity":  1,
	})
	if rec.Code != stdhttp.StatusBadRequest {
		t.Fatalf("want 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "action") {
		t.Fatalf("error should mention action; got %s", rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "check constraint") {
		t.Fatalf("validation should reject before DB CHECK; got %s", rec.Body.String())
	}
}

func TestPlaceOrderRejectsBadAction(t *testing.T) {
	rec := postOrder(t, map[string]any{
		"marketId":  "00000000-0000-0000-0000-000000000001",
		"side":      "yes",
		"action":    "hodl",
		"orderType": "market",
		"quantity":  1,
	})
	if rec.Code != stdhttp.StatusBadRequest {
		t.Fatalf("want 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "action") {
		t.Fatalf("error should mention action; got %s", rec.Body.String())
	}
}

func TestPlaceOrderRejectsBadSide(t *testing.T) {
	rec := postOrder(t, map[string]any{
		"marketId":  "00000000-0000-0000-0000-000000000001",
		"side":      "maybe",
		"action":    "buy",
		"orderType": "market",
		"quantity":  1,
	})
	if rec.Code != stdhttp.StatusBadRequest {
		t.Fatalf("want 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "side") {
		t.Fatalf("error should mention side; got %s", rec.Body.String())
	}
}

func TestPlaceOrderRejectsBadOrderType(t *testing.T) {
	rec := postOrder(t, map[string]any{
		"marketId":  "00000000-0000-0000-0000-000000000001",
		"side":      "yes",
		"action":    "buy",
		"orderType": "stop-loss",
		"quantity":  1,
	})
	if rec.Code != stdhttp.StatusBadRequest {
		t.Fatalf("want 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "orderType") {
		t.Fatalf("error should mention orderType; got %s", rec.Body.String())
	}
}

func TestPlaceOrderRejectsZeroQuantity(t *testing.T) {
	rec := postOrder(t, map[string]any{
		"marketId":  "00000000-0000-0000-0000-000000000001",
		"side":      "yes",
		"action":    "buy",
		"orderType": "market",
		"quantity":  0,
	})
	if rec.Code != stdhttp.StatusBadRequest {
		t.Fatalf("want 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "quantity") {
		t.Fatalf("error should mention quantity; got %s", rec.Body.String())
	}
}

func TestPlaceOrderLimitRequiresPricePoints(t *testing.T) {
	rec := postOrder(t, map[string]any{
		"marketId":  "00000000-0000-0000-0000-000000000001",
		"side":      "yes",
		"action":    "buy",
		"orderType": "limit",
		"quantity":  1,
	})
	if rec.Code != stdhttp.StatusBadRequest {
		t.Fatalf("want 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "pricePoints") {
		t.Fatalf("error should mention pricePoints; got %s", rec.Body.String())
	}
}

func TestPlaceOrderLimitRejectsOutOfRangePricePoints(t *testing.T) {
	for _, p := range []int{0, 100, -1, 200} {
		body := map[string]any{
			"marketId":    "00000000-0000-0000-0000-000000000001",
			"side":        "yes",
			"action":      "buy",
			"orderType":   "limit",
			"quantity":    1,
			"pricePoints": p,
		}
		rec := postOrder(t, body)
		if rec.Code != stdhttp.StatusBadRequest {
			t.Fatalf("pricePoints=%d: want 400, got %d body=%s", p, rec.Code, rec.Body.String())
		}
	}
}

func TestPlaceOrderRejectsRetiredRequestAliasesAtHTTPBoundary(t *testing.T) {
	tests := []struct {
		name      string
		body      map[string]any
		wantField string
		wantText  string
	}{
		{
			// Points unit-model (2026-07-07): the retired request key is the
			// cents-era priceCents; pricePoints is the accepted canonical key.
			name: "limit price",
			body: map[string]any{
				"marketId":   "00000000-0000-0000-0000-000000000001",
				"side":       "yes",
				"action":     "buy",
				"orderType":  "limit",
				"quantity":   1,
				"priceCents": 50,
			},
			wantField: "pricePoints",
			wantText:  "use pricePoints for limit order prices",
		},
		{
			// Points unit-model (2026-07-07): the retired request key is the
			// cents-era notionalCapCents; notionalCapPoints is canonical.
			name: "market buy cap",
			body: map[string]any{
				"marketId":         "00000000-0000-0000-0000-000000000001",
				"side":             "yes",
				"action":           "buy",
				"orderType":        "market",
				"quantity":         1,
				"notionalCapCents": 500,
			},
			wantField: "notionalCapPoints",
			wantText:  "use notionalCapPoints for market buy caps",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := postOrder(t, tt.body)
			if rec.Code != stdhttp.StatusBadRequest {
				t.Fatalf("want 400, got %d body=%s", rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), tt.wantText) {
				t.Fatalf("error should mention %q; got %s", tt.wantText, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), tt.wantField) {
				t.Fatalf("error should point at %s; got %s", tt.wantField, rec.Body.String())
			}
		})
	}
}

func TestOrderPreviewRejectsRetiredRequestAliasesAtHTTPBoundary(t *testing.T) {
	// Points unit-model (2026-07-07): the retired request key is the
	// cents-era notionalCapCents; notionalCapPoints is canonical.
	rec := postOrderPreview(t, map[string]any{
		"marketId":         "00000000-0000-0000-0000-000000000001",
		"side":             "yes",
		"action":           "buy",
		"orderType":        "market",
		"quantity":         1,
		"notionalCapCents": 500,
	})
	if rec.Code != stdhttp.StatusBadRequest {
		t.Fatalf("want 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "notionalCapPoints") {
		t.Fatalf("error should point at notionalCapPoints; got %s", rec.Body.String())
	}
}

func TestOrderPlacementError_GenericDetailsRemainEmpty(t *testing.T) {
	err := orderPlacementError(errors.New("market is closed"))
	appErr := httpx.FromError(err)
	if appErr == nil {
		t.Fatal("expected app error")
	}
	if appErr.Message != "market is closed" {
		t.Fatalf("message = %q", appErr.Message)
	}
	if appErr.Details != nil {
		t.Fatalf("generic order error should not grow details, got %#v", appErr.Details)
	}
}

func TestOrderPlacementError_RedactsUnsafeServiceMessage(t *testing.T) {
	err := orderPlacementError(errors.New("market BTC cash payout is not open for trading"))
	appErr := httpx.FromError(err)
	if appErr == nil {
		t.Fatal("expected app error")
	}
	if appErr.Message != launchRedactedUserText {
		t.Fatalf("message = %q", appErr.Message)
	}
	if strings.Contains(appErr.Message, "BTC cash payout") {
		t.Fatalf("unsafe market ticker leaked in message: %q", appErr.Message)
	}
	if appErr.Details != nil {
		t.Fatalf("generic order error should not grow details, got %#v", appErr.Details)
	}
}

func TestServiceBadRequestError_RedactsUnsafePreviewMessage(t *testing.T) {
	err := serviceBadRequestError(errors.New("market USDC payout preview is unavailable"), nil)
	appErr := httpx.FromError(err)
	if appErr == nil {
		t.Fatal("expected app error")
	}
	if appErr.Message != launchRedactedUserText {
		t.Fatalf("message = %q", appErr.Message)
	}
}
