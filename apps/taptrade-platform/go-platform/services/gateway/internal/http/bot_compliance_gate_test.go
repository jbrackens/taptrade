package http

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"taptrade/gateway/internal/compliance"
	"taptrade/gateway/internal/prediction"
	"taptrade/platform/transport/httpx"
)

func TestBotOrderPathIsGeoGated(t *testing.T) {
	// Mint a real API key so botAuth.Wrap (bcrypt verify) passes.
	fullKey, prefix, hash, err := prediction.GenerateAPIKey()
	if err != nil {
		t.Fatalf("generate api key: %v", err)
	}
	repo := newPredictionAdminRepo()
	repo.apiKey = &prediction.APIKey{
		ID:        "key-1",
		UserID:    "bot-user-1",
		Name:      "test",
		KeyHash:   hash,
		KeyPrefix: prefix,
		Scopes:    []string{"read", "trade"},
		Active:    true,
	}

	svc := prediction.NewService(repo, nil)
	mux := http.NewServeMux()
	registerBotRoutes(mux, svc, repo, nil)
	handler := httpx.Chain(mux, httpx.RequestID(), httpx.Recovery(nil))

	// Geo gate ON with an allowlist that excludes the request's country.
	t.Setenv("GEO_GATE_ENABLED", "true")
	t.Setenv("GEO_ALLOWED_COUNTRIES", "PH")
	t.Setenv("BETA_COMPLIANCE_MODE", "")
	prevGeo := tradeGeoGate
	tradeGeoGate = compliance.NewGeoGateFromEnv()
	t.Cleanup(func() { tradeGeoGate = prevGeo })

	body, _ := json.Marshal(prediction.PlaceOrderRequest{
		MarketID: "mkt-1",
		Side:     prediction.OrderSideYes,
		Action:   prediction.OrderActionBuy,
		Quantity: 1,
	})

	// Blocked country → 403, and PlaceOrder is never reached.
	blocked := httptest.NewRequest(http.MethodPost, "/api/v1/bot/orders", bytes.NewReader(body))
	blocked.Header.Set("Authorization", "Bearer "+fullKey)
	blocked.Header.Set("CF-IPCountry", "US")
	blockedRec := httptest.NewRecorder()
	handler.ServeHTTP(blockedRec, blocked)
	if blockedRec.Code != http.StatusForbidden {
		t.Fatalf("blocked-country bot order: expected 403, got %d body=%s", blockedRec.Code, blockedRec.Body.String())
	}

	// Allowed country → passes the gate (then fails downstream because the
	// fake has no tradeable market; the point is it is NOT a 403 geo block).
	allowed := httptest.NewRequest(http.MethodPost, "/api/v1/bot/orders", bytes.NewReader(body))
	allowed.Header.Set("Authorization", "Bearer "+fullKey)
	allowed.Header.Set("CF-IPCountry", "PH")
	allowedRec := httptest.NewRecorder()
	handler.ServeHTTP(allowedRec, allowed)
	if allowedRec.Code == http.StatusForbidden {
		t.Fatalf("allowed-country bot order was geo-blocked (403); gate should have passed. body=%s", allowedRec.Body.String())
	}
}

func TestBotOrderPathUsesSessionOrderHTTPValidation(t *testing.T) {
	fullKey, prefix, hash, err := prediction.GenerateAPIKey()
	if err != nil {
		t.Fatalf("generate api key: %v", err)
	}
	repo := newPredictionAdminRepo()
	repo.apiKey = &prediction.APIKey{
		ID:        "key-1",
		UserID:    "bot-user-1",
		Name:      "test",
		KeyHash:   hash,
		KeyPrefix: prefix,
		Scopes:    []string{"read", "trade"},
		Active:    true,
	}

	svc := prediction.NewService(repo, nil)
	mux := http.NewServeMux()
	registerBotRoutes(mux, svc, repo, nil)
	handler := httpx.Chain(mux, httpx.RequestID(), httpx.Recovery(nil))

	tests := []struct {
		name      string
		req       map[string]any
		wantField string
		wantText  string
	}{
		{
			name: "capless market buy",
			req: map[string]any{
				"marketId":  "missing-market",
				"side":      prediction.OrderSideYes,
				"action":    prediction.OrderActionBuy,
				"orderType": prediction.OrderTypeMarket,
				"quantity":  1,
			},
			wantField: "notionalCapPoints",
			wantText:  "market buy orders require notionalCapPoints > 0",
		},
		{
			name: "invalid self match action",
			req: map[string]any{
				"marketId":        "missing-market",
				"side":            prediction.OrderSideYes,
				"action":          prediction.OrderActionBuy,
				"orderType":       prediction.OrderTypeLimit,
				"pricePoints":     50,
				"quantity":        1,
				"selfMatchAction": "take_both",
			},
			wantField: "selfMatchAction",
			wantText:  "selfMatchAction must be one of cancel_taker, cancel_maker, cancel_both",
		},
		{
			// Points unit-model (2026-07-07): the retired request key is the
			// cents-era priceCents; pricePoints is the accepted canonical key.
			name: "retired price alias",
			req: map[string]any{
				"marketId":   "missing-market",
				"side":       prediction.OrderSideYes,
				"action":     prediction.OrderActionBuy,
				"orderType":  prediction.OrderTypeLimit,
				"priceCents": 50,
				"quantity":   1,
			},
			wantField: "pricePoints",
			wantText:  "use pricePoints for limit order prices",
		},
		{
			// Points unit-model (2026-07-07): the retired request key is the
			// cents-era notionalCapCents; notionalCapPoints is canonical.
			name: "retired cap alias",
			req: map[string]any{
				"marketId":         "missing-market",
				"side":             prediction.OrderSideYes,
				"action":           prediction.OrderActionBuy,
				"orderType":        prediction.OrderTypeMarket,
				"notionalCapCents": 500,
				"quantity":         1,
			},
			wantField: "notionalCapPoints",
			wantText:  "use notionalCapPoints for market buy caps",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, _ := json.Marshal(tt.req)
			req := httptest.NewRequest(http.MethodPost, "/api/v1/bot/orders", bytes.NewReader(body))
			req.Header.Set("Authorization", "Bearer "+fullKey)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("expected validation 400, got %d body=%s", rec.Code, rec.Body.String())
			}
			if repo.orderCreates != 0 {
				t.Fatalf("invalid bot order must not persist, got %d created orders", repo.orderCreates)
			}
			var payload struct {
				Error struct {
					Message string         `json:"message"`
					Details map[string]any `json:"details"`
				} `json:"error"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
				t.Fatalf("decode validation payload: %v body=%s", err, rec.Body.String())
			}
			if payload.Error.Message != tt.wantText {
				t.Fatalf("expected message %q, got %+v", tt.wantText, payload.Error)
			}
			if payload.Error.Details["field"] != tt.wantField {
				t.Fatalf("expected field %q, got %+v", tt.wantField, payload.Error.Details)
			}
		})
	}
}

// TestBotKeySelfServeGate verifies the self-serve creation gate (audit SEC-02):
// off in production unless BOT_KEYS_SELF_SERVE=true.
func TestBotKeySelfServeGate(t *testing.T) {
	t.Run("production blocks self-serve by default", func(t *testing.T) {
		t.Setenv("ENVIRONMENT", "production")
		t.Setenv("BOT_KEYS_SELF_SERVE", "")
		if botKeySelfServeEnabled() {
			t.Fatal("self-serve must be off in production by default")
		}
	})
	t.Run("production opt-in enables it", func(t *testing.T) {
		t.Setenv("ENVIRONMENT", "production")
		t.Setenv("BOT_KEYS_SELF_SERVE", "true")
		if !botKeySelfServeEnabled() {
			t.Fatal("explicit opt-in must enable self-serve")
		}
	})
	t.Run("dev allows self-serve", func(t *testing.T) {
		t.Setenv("ENVIRONMENT", "")
		t.Setenv("BOT_KEYS_SELF_SERVE", "")
		if !botKeySelfServeEnabled() {
			t.Fatal("self-serve should be on in dev/demo by default")
		}
	})
}

func TestBotKeySelfServeRejectsPrivilegedOrUnknownScopes(t *testing.T) {
	t.Setenv("BOT_KEYS_SELF_SERVE", "true")
	repo := newPredictionAdminRepo()
	svc := prediction.NewService(repo, nil)
	mux := http.NewServeMux()
	registerBotRoutes(mux, svc, repo, nil)
	handler := httpx.Chain(mux, httpx.RequestID(), httpx.Recovery(nil))

	post := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/bot/keys", strings.NewReader(body))
		req.Header.Set("X-User-ID", "user-1")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}

	for _, tc := range []struct {
		name string
		body string
	}{
		{name: "wildcard admin", body: `{"name":"wild","scopes":["admin"]}`},
		{name: "unknown settle", body: `{"name":"unknown","scopes":["read","settle"]}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := post(tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("expected 400 for invalid scope, got %d body=%s", rec.Code, rec.Body.String())
			}
			var payload struct {
				Error struct {
					Details map[string]any `json:"details"`
				} `json:"error"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
				t.Fatalf("decode scope error: %v body=%s", err, rec.Body.String())
			}
			if payload.Error.Details["field"] != "scopes" {
				t.Fatalf("expected scopes field detail, got %+v", payload.Error.Details)
			}
		})
	}
	if repo.apiKeyCreates != 0 {
		t.Fatalf("invalid bot-key scopes must not persist, got %d creates", repo.apiKeyCreates)
	}

	rec := post(`{"name":"safe","scopes":[" READ ","trade","read"]}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected safe normalized scopes to create key, got %d body=%s", rec.Code, rec.Body.String())
	}
	if repo.apiKeyCreates != 1 {
		t.Fatalf("expected one persisted safe key, got %d creates", repo.apiKeyCreates)
	}
	var payload struct {
		Scopes []string `json:"scopes"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode key create response: %v body=%s", err, rec.Body.String())
	}
	if got, want := strings.Join(payload.Scopes, ","), "read,trade"; got != want {
		t.Fatalf("expected normalized scopes %q, got %q", want, got)
	}
}

func TestBotKeySelfServeRejectsMoneyWordingName(t *testing.T) {
	t.Setenv("BOT_KEYS_SELF_SERVE", "true")
	repo := newPredictionAdminRepo()
	svc := prediction.NewService(repo, nil)
	mux := http.NewServeMux()
	registerBotRoutes(mux, svc, repo, nil)
	handler := httpx.Chain(mux, httpx.RequestID(), httpx.Recovery(nil))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/bot/keys", strings.NewReader(
		`{"name":"cash payout automation","scopes":["read"]}`,
	))
	req.Header.Set("X-User-ID", "user-1")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected unsafe bot key name status 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	var envelope httpx.ErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode unsafe bot key name error: %v body=%s", err, rec.Body.String())
	}
	details, ok := envelope.Error.Details.(map[string]any)
	if !ok || details["field"] != "name" {
		t.Fatalf("expected name field detail, got %+v", envelope.Error.Details)
	}
	if strings.Contains(rec.Body.String(), "cash payout") {
		t.Fatalf("unsafe bot key name should not be echoed: %s", rec.Body.String())
	}
	if repo.apiKeyCreates != 0 {
		t.Fatalf("unsafe bot key name must not persist, got %d creates", repo.apiKeyCreates)
	}
}

func TestBotKeySelfServeListRedactsLegacyUnsafeNameOnRead(t *testing.T) {
	repo := newPredictionAdminRepo()
	repo.apiKeys = []prediction.APIKey{
		{ID: "key-1", UserID: "user-1", Name: "crypto payout automation", KeyPrefix: "tna_1234", Scopes: []string{"read"}, Active: true},
		{ID: "key-2", UserID: "other-user", Name: "cash payout foreign key", KeyPrefix: "tna_9999", Scopes: []string{"read"}, Active: true},
	}
	svc := prediction.NewService(repo, nil)
	mux := http.NewServeMux()
	registerBotRoutes(mux, svc, repo, nil)
	handler := httpx.Chain(mux, httpx.RequestID(), httpx.Recovery(nil))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/bot/keys", nil)
	req.Header.Set("X-User-ID", "user-1")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected bot key list status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if got := repo.apiKeys[0].Name; got != "crypto payout automation" {
		t.Fatalf("raw bot key name should remain unchanged, got %q", got)
	}
	var payload []prediction.APIKey
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode bot key list response: %v body=%s", err, rec.Body.String())
	}
	if len(payload) != 1 || payload[0].ID != "key-1" || payload[0].Name != launchRedactedUserText {
		t.Fatalf("expected owner-scoped redacted key response, got %+v", payload)
	}
	if strings.Contains(rec.Body.String(), "crypto payout automation") || strings.Contains(rec.Body.String(), "cash payout foreign key") {
		t.Fatalf("unsafe legacy key name leaked in response: %s", rec.Body.String())
	}
}
