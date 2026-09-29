package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"taptrade/gateway/internal/prediction"
	"taptrade/gateway/internal/prediction/feed"
	"taptrade/platform/transport/httpx"
)

func TestLegacyMoneyRoutesAreAbsentByDefault(t *testing.T) {
	t.Setenv(legacyMoneyRoutesEnv, "")
	mux := http.NewServeMux()
	RegisterRoutes(mux, "gateway")
	handler := httpx.Chain(mux, httpx.RequestID(), httpx.Recovery(nil))

	cases := []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodGet, "/api/v1/cashier/alpha/config", ""},
		{http.MethodGet, "/api/v1/cashier/alpha/wallet/challenge", ""},
		{http.MethodPost, "/api/v1/cashier/alpha/wallet/connect", `{}`},
		{http.MethodGet, "/api/v1/cashier/alpha/wallets", ""},
		{http.MethodPost, "/api/v1/cashier/alpha/deposit-intents", `{"amountPoints":100}`},
		{http.MethodPost, "/api/v1/cashier/alpha/deposit-intents/intent-1/submit-tx", `{"txHash":"0xabc"}`},
		{http.MethodPost, "/api/v1/cashier/alpha/withdrawal-requests", `{"destinationAddress":"0xabc","amountPoints":100}`},
		{http.MethodPost, "/api/v1/cashier/alpha/withdrawal-requests/request-1/cancel", `{}`},
		{http.MethodGet, "/api/v1/admin/cashier/alpha/preflight", ""},
		{http.MethodGet, "/api/v1/admin/cashier/alpha/deposits", ""},
		{http.MethodGet, "/api/v1/admin/cashier/alpha/reconciliation", ""},
		{http.MethodGet, "/api/v1/admin/cashier/alpha/withdrawals", ""},
		{http.MethodGet, "/api/v1/admin/cashier/alpha/audit-events", ""},
		{http.MethodPost, "/api/v1/admin/cashier/alpha/withdrawals/request-1/approve", `{}`},
		{http.MethodPost, "/api/v1/payments/deposit", `{"amountPoints":100,"paymentMethod":"card"}`},
		{http.MethodPost, "/api/v1/payments/withdraw", `{"userId":"u-1","amountPoints":100,"paymentMethod":"card"}`},
		{http.MethodGet, "/api/v1/payments/methods", ""},
		{http.MethodGet, "/api/v1/payments/status?transactionId=dep-1", ""},
		{http.MethodPost, "/api/v1/payments/webhook", `{}`},
		{http.MethodGet, "/api/v1/payments/crypto/config", ""},
		{http.MethodGet, "/api/v1/payments/crypto/deposit-address", ""},
	}

	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != http.StatusNotFound {
			t.Fatalf("%s %s: legacy money route must be absent by default, got %d body=%s", tc.method, tc.path, res.Code, res.Body.String())
		}
	}

	healthReq := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	healthRes := httptest.NewRecorder()
	handler.ServeHTTP(healthRes, healthReq)
	if healthRes.Code != http.StatusOK {
		t.Fatalf("health route should remain registered, got %d", healthRes.Code)
	}
}

func TestLaunchRouteDomainSummaryExcludesLegacyMoneyDomains(t *testing.T) {
	domains := gatewayRouteDomains(false)
	for _, domain := range []string{"alpha_cashier", "payments", "crypto_payments"} {
		if slices.Contains(domains, domain) {
			t.Fatalf("launch route summary must not advertise %s: %v", domain, domains)
		}
	}
	for _, domain := range []string{"prediction", "orders", "wallet", "compliance", "loyalty", "leaderboards", "auth"} {
		if !slices.Contains(domains, domain) {
			t.Fatalf("launch route summary missing active domain %s: %v", domain, domains)
		}
	}
}

func TestStatusEndpointReportsLaunchPointBoundary(t *testing.T) {
	t.Setenv(legacyMoneyRoutesEnv, "")
	mux := http.NewServeMux()
	RegisterRoutes(mux, "gateway")
	handler := httpx.Chain(mux, httpx.RequestID(), httpx.Recovery(nil))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/status", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", res.Code, res.Body.String())
	}

	var payload struct {
		Service            string   `json:"service"`
		Status             string   `json:"status"`
		PointMode          string   `json:"pointMode"`
		LegacyMoneyRoutes  string   `json:"legacyMoneyRoutes"`
		LaunchRouteDomains []string `json:"launchRouteDomains"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode status payload: %v", err)
	}

	if payload.Service != "gateway" || payload.Status != "up" {
		t.Fatalf("unexpected status payload: %+v", payload)
	}
	if payload.PointMode != "non_redeemable_points" {
		t.Fatalf("status must report non-redeemable point mode, got %+v", payload)
	}
	if payload.LegacyMoneyRoutes != "disabled" {
		t.Fatalf("legacy money routes must be disabled by default, got %+v", payload)
	}
	for _, domain := range []string{"alpha_cashier", "payments", "crypto_payments"} {
		if slices.Contains(payload.LaunchRouteDomains, domain) {
			t.Fatalf("status route domains must not advertise %s: %+v", domain, payload)
		}
	}
	for _, domain := range []string{"prediction", "orders", "point_wallet", "responsible_play", "loyalty", "leaderboards", "auth"} {
		if !slices.Contains(payload.LaunchRouteDomains, domain) {
			t.Fatalf("status route domains missing active domain %s: %+v", domain, payload)
		}
	}
}

func TestLegacyRouteDomainSummaryRequiresExplicitOptIn(t *testing.T) {
	domains := gatewayRouteDomains(true)
	for _, domain := range []string{"alpha_cashier", "payments"} {
		if !slices.Contains(domains, domain) {
			t.Fatalf("legacy opt-in route summary should include %s: %v", domain, domains)
		}
	}
	// The crypto rail was removed on 2026-09-29; no flag brings it back.
	if slices.Contains(domains, "crypto_payments") {
		t.Fatalf("route summary must not advertise the removed crypto rail: %v", domains)
	}
}

func TestLegacyMoneyRoutesRequireExplicitOptIn(t *testing.T) {
	t.Setenv(legacyMoneyRoutesEnv, "true")
	mux := http.NewServeMux()
	RegisterRoutes(mux, "gateway")
	handler := httpx.Chain(mux, httpx.RequestID(), httpx.Recovery(nil))

	alphaReq := httptest.NewRequest(http.MethodGet, "/api/v1/cashier/alpha/config", nil)
	alphaRes := httptest.NewRecorder()
	handler.ServeHTTP(alphaRes, alphaReq)
	if alphaRes.Code == http.StatusNotFound {
		t.Fatal("alpha cashier config route should register only when legacy money routes are explicitly enabled")
	}

	paymentReq := httptest.NewRequest(http.MethodPost, "/api/v1/payments/deposit", strings.NewReader(`{"amountPoints":100,"paymentMethod":"card"}`))
	paymentRes := httptest.NewRecorder()
	handler.ServeHTTP(paymentRes, paymentReq)
	if paymentRes.Code == http.StatusNotFound {
		t.Fatal("legacy payment route should register only when legacy money routes are explicitly enabled")
	}
}

func TestLegacyAssetPriceFeedIsAbsentByDefault(t *testing.T) {
	t.Setenv(legacyAssetPriceFeedsEnv, "")
	registry := feed.NewRegistry()
	registerPredictionFeedAdapters(registry)

	if registry.Get("admin-manual") == nil || registry.Get("manual") == nil {
		t.Fatalf("manual settlement adapters should always register")
	}
	if got := registry.Get("api-feed-crypto"); got != nil {
		t.Fatalf("asset-price settlement feed must be absent by default, got %T", got)
	}
}

func TestLegacyAssetPriceFeedRequiresExplicitOptIn(t *testing.T) {
	t.Setenv(legacyAssetPriceFeedsEnv, "true")
	registry := feed.NewRegistry()
	registerPredictionFeedAdapters(registry)

	if got := registry.Get("api-feed-crypto"); got == nil {
		t.Fatalf("asset-price settlement feed should register only with explicit legacy opt-in")
	}
}

func TestVoidedMarketNotificationUsesLockedPointCopy(t *testing.T) {
	subject, body := resolutionMessage(&prediction.Market{
		Ticker: "VOID-PTS",
		Title:  "Voided points market",
		Status: prediction.MarketStatusVoided,
	})

	if !strings.Contains(subject, "Market voided: VOID-PTS") {
		t.Fatalf("unexpected void subject: %q", subject)
	}
	if !strings.Contains(body, "Locked points are returned at entry cost") {
		t.Fatalf("void notification should use locked-point copy, got %q", body)
	}
	for _, banned := range []string{"stakes", "refunded", "refund"} {
		if strings.Contains(strings.ToLower(body), banned) {
			t.Fatalf("void notification must avoid %q wording, got %q", banned, body)
		}
	}
}
