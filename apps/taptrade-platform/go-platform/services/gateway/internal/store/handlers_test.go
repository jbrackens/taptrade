package store

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"taptrade/gateway/internal/webhookauth"
	"taptrade/platform/transport/httpx"
)

type handlerFixture struct {
	mux    *http.ServeMux
	fx     *serviceFixture
	secret string
}

func newHandlerFixture(t *testing.T, cfg Config) *handlerFixture {
	t.Helper()
	if cfg.WebhookSecret == "" {
		cfg.WebhookSecret = "whsec_handler_test"
	}
	fx := newFixture(t, cfg)
	// newFixture forces Enabled + demo provider; rebuild the service config
	// used by RegisterRoutes with the same repo/wallet/provider.
	mux := http.NewServeMux()
	RegisterRoutes(mux, fx.svc)
	return &handlerFixture{mux: mux, fx: fx, secret: fx.svc.Config().WebhookSecret}
}

func (h *handlerFixture) do(t *testing.T, method, path, body, userID, role string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if userID != "" {
		req = req.WithContext(httpx.WithTestUser(req.Context(), userID, userID+"@test.local", role))
	}
	res := httptest.NewRecorder()
	h.mux.ServeHTTP(res, req)
	return res
}

func decodeJSON(t *testing.T, res *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response %q: %v", res.Body.String(), err)
	}
	return payload
}

func (h *handlerFixture) checkout(t *testing.T, userID, packID, key string) string {
	t.Helper()
	res := h.do(t, http.MethodPost, "/api/v1/store/checkout", fmt.Sprintf(`{"packId":%q,"idempotencyKey":%q}`, packID, key), userID, "player")
	if res.Code != http.StatusCreated {
		t.Fatalf("checkout returned %d: %s", res.Code, res.Body.String())
	}
	payload := decodeJSON(t, res)
	purchase, ok := payload["purchase"].(map[string]any)
	if !ok {
		t.Fatalf("checkout response missing purchase: %v", payload)
	}
	id, _ := purchase["id"].(string)
	if id == "" {
		t.Fatalf("checkout response missing purchase id: %v", payload)
	}
	return id
}

func TestStoreRoutesRequireSession(t *testing.T) {
	h := newHandlerFixture(t, Config{})
	cases := []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodGet, "/api/v1/store/packs", ""},
		{http.MethodPost, "/api/v1/store/checkout", `{"packId":"starter","idempotencyKey":"k"}`},
		{http.MethodGet, "/api/v1/store/purchases", ""},
		{http.MethodGet, "/api/v1/store/purchases/sp_x", ""},
		{http.MethodPost, "/api/v1/store/purchases/sp_x/confirm", `{"outcome":"success"}`},
	}
	for _, tc := range cases {
		res := h.do(t, tc.method, tc.path, tc.body, "", "")
		if res.Code != http.StatusForbidden {
			t.Fatalf("%s %s without a session returned %d, want 403", tc.method, tc.path, res.Code)
		}
	}
}

func TestPacksEndpointServesCatalogueWithEligibility(t *testing.T) {
	h := newHandlerFixture(t, Config{})
	res := h.do(t, http.MethodGet, "/api/v1/store/packs", "", "u-1", "player")
	if res.Code != http.StatusOK {
		t.Fatalf("packs returned %d: %s", res.Code, res.Body.String())
	}
	payload := decodeJSON(t, res)
	packs, ok := payload["packs"].([]any)
	if !ok || len(packs) != 5 {
		t.Fatalf("expected the 5-pack catalogue, got %v", payload["packs"])
	}
	if payload["firstPurchase"] != true {
		t.Fatalf("fresh user must be firstPurchase=true: %v", payload)
	}
	if payload["unit"] != "PTS" {
		t.Fatalf("packs payload must carry unit PTS: %v", payload)
	}
	first, ok := packs[0].(map[string]any)
	if !ok {
		t.Fatalf("pack payload shape: %v", packs[0])
	}
	for _, field := range []string{"priceUsdCents", "basePoints", "bonusPoints", "totalPoints"} {
		if _, present := first[field]; !present {
			t.Fatalf("pack payload missing %s: %v", first, field)
		}
	}
}

func TestCheckoutDoublePostReturnsSamePurchase(t *testing.T) {
	h := newHandlerFixture(t, Config{})
	firstID := h.checkout(t, "u-1", "popular", "key-1")

	res := h.do(t, http.MethodPost, "/api/v1/store/checkout", `{"packId":"popular","idempotencyKey":"key-1"}`, "u-1", "player")
	if res.Code != http.StatusOK {
		t.Fatalf("replayed checkout returned %d, want 200", res.Code)
	}
	payload := decodeJSON(t, res)
	purchase := payload["purchase"].(map[string]any)
	if purchase["id"] != firstID {
		t.Fatalf("replayed checkout returned a different purchase: %v vs %s", purchase["id"], firstID)
	}
}

func TestPurchaseReadIsOwnerOrAdmin(t *testing.T) {
	h := newHandlerFixture(t, Config{})
	purchaseID := h.checkout(t, "u-1", "starter", "key-1")
	path := "/api/v1/store/purchases/" + purchaseID

	if res := h.do(t, http.MethodGet, path, "", "u-1", "player"); res.Code != http.StatusOK {
		t.Fatalf("owner read returned %d", res.Code)
	}
	if res := h.do(t, http.MethodGet, path, "", "u-2", "player"); res.Code != http.StatusForbidden {
		t.Fatalf("cross-user read returned %d, want 403", res.Code)
	}
	if res := h.do(t, http.MethodGet, path, "", "admin-1", "admin"); res.Code != http.StatusOK {
		t.Fatalf("admin read returned %d, want 200", res.Code)
	}
	if res := h.do(t, http.MethodGet, "/api/v1/store/purchases/sp_missing", "", "u-1", "player"); res.Code != http.StatusNotFound {
		t.Fatalf("missing purchase returned %d, want 404", res.Code)
	}
}

func TestConfirmIsOwnerOnlyAndIdempotent(t *testing.T) {
	h := newHandlerFixture(t, Config{})
	purchaseID := h.checkout(t, "u-1", "popular", "key-1")
	path := "/api/v1/store/purchases/" + purchaseID + "/confirm"

	// Admins may read but not confirm on the owner's behalf.
	if res := h.do(t, http.MethodPost, path, `{"outcome":"success"}`, "admin-1", "admin"); res.Code != http.StatusForbidden {
		t.Fatalf("admin confirm returned %d, want 403", res.Code)
	}
	if res := h.do(t, http.MethodPost, path, `{"outcome":"success"}`, "u-2", "player"); res.Code != http.StatusForbidden {
		t.Fatalf("cross-user confirm returned %d, want 403", res.Code)
	}

	res := h.do(t, http.MethodPost, path, `{"outcome":"success"}`, "u-1", "player")
	if res.Code != http.StatusOK {
		t.Fatalf("owner confirm returned %d: %s", res.Code, res.Body.String())
	}
	payload := decodeJSON(t, res)
	if payload["alreadyFulfilled"] != false {
		t.Fatalf("first confirm must not report alreadyFulfilled: %v", payload)
	}
	baseKey := PurchaseCreditKey(purchaseID)
	if h.fx.wallet.counts[baseKey] != 1 {
		t.Fatalf("confirm must credit exactly once, got %d", h.fx.wallet.counts[baseKey])
	}

	replay := h.do(t, http.MethodPost, path, `{"outcome":"success"}`, "u-1", "player")
	if replay.Code != http.StatusOK {
		t.Fatalf("replayed confirm returned %d, want 200", replay.Code)
	}
	replayPayload := decodeJSON(t, replay)
	if replayPayload["alreadyFulfilled"] != true {
		t.Fatalf("replayed confirm must report alreadyFulfilled: %v", replayPayload)
	}
	if h.fx.wallet.counts[baseKey] != 1 {
		t.Fatalf("replayed confirm must not credit again, got %d", h.fx.wallet.counts[baseKey])
	}

	if res := h.do(t, http.MethodPost, path, `{"outcome":"nonsense"}`, "u-1", "player"); res.Code != http.StatusBadRequest {
		t.Fatalf("unknown outcome returned %d, want 400", res.Code)
	}
}

func TestWebhookVerifiesSignatureAndFulfills(t *testing.T) {
	h := newHandlerFixture(t, Config{})
	purchaseID := h.checkout(t, "u-1", "popular", "key-1")

	body := fmt.Sprintf(`{"eventId":"evt-1","eventType":"checkout.completed","purchaseId":%q,"status":"completed","timestamp":"%d"}`,
		purchaseID, time.Now().Unix())

	// Unsigned and mis-signed requests are rejected and move no points.
	if res := h.do(t, http.MethodPost, "/api/v1/store/webhook", body, "", ""); res.Code != http.StatusUnauthorized {
		t.Fatalf("unsigned webhook returned %d, want 401", res.Code)
	}
	badReq := httptest.NewRequest(http.MethodPost, "/api/v1/store/webhook", strings.NewReader(body))
	badReq.Header.Set(WebhookSignatureHeader, webhookauth.Sign("whsec_wrong", []byte(body)))
	badRes := httptest.NewRecorder()
	h.mux.ServeHTTP(badRes, badReq)
	if badRes.Code != http.StatusUnauthorized {
		t.Fatalf("mis-signed webhook returned %d, want 401", badRes.Code)
	}
	if h.fx.wallet.totalCredits() != 0 {
		t.Fatalf("rejected webhooks must not move points")
	}

	// A correctly signed webhook fulfills without any session.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/store/webhook", strings.NewReader(body))
	req.Header.Set(WebhookSignatureHeader, webhookauth.Sign(h.secret, []byte(body)))
	res := httptest.NewRecorder()
	h.mux.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("signed webhook returned %d: %s", res.Code, res.Body.String())
	}
	if h.fx.wallet.counts[PurchaseCreditKey(purchaseID)] != 1 {
		t.Fatalf("webhook fulfillment must credit exactly once")
	}

	// Replaying the same signed webhook is a 200-OK no-op.
	replay := httptest.NewRequest(http.MethodPost, "/api/v1/store/webhook", strings.NewReader(body))
	replay.Header.Set(WebhookSignatureHeader, webhookauth.Sign(h.secret, []byte(body)))
	replayRes := httptest.NewRecorder()
	h.mux.ServeHTTP(replayRes, replay)
	if replayRes.Code != http.StatusOK {
		t.Fatalf("replayed webhook returned %d, want 200", replayRes.Code)
	}
	replayPayload := decodeJSON(t, replayRes)
	if replayPayload["alreadyFulfilled"] != true {
		t.Fatalf("replayed webhook must report alreadyFulfilled: %v", replayPayload)
	}
	if h.fx.wallet.counts[PurchaseCreditKey(purchaseID)] != 1 {
		t.Fatalf("replayed webhook must not re-credit")
	}
}

func TestWebhookFailsClosedWithoutSecret(t *testing.T) {
	fx := newFixture(t, Config{})
	// Rebuild routes with an empty webhook secret.
	cfg := fx.svc.Config()
	cfg.WebhookSecret = ""
	svc := NewService(cfg, fx.repo, fx.wallet, NewDemoProvider(time.Second, fx.clock.Now))
	mux := http.NewServeMux()
	RegisterRoutes(mux, svc)

	body := fmt.Sprintf(`{"purchaseId":"sp_x","status":"completed","timestamp":"%d"}`, time.Now().Unix())
	req := httptest.NewRequest(http.MethodPost, "/api/v1/store/webhook", strings.NewReader(body))
	req.Header.Set(WebhookSignatureHeader, webhookauth.Sign("", []byte(body)))
	res := httptest.NewRecorder()
	mux.ServeHTTP(res, req)
	if res.Code != http.StatusServiceUnavailable {
		t.Fatalf("secretless webhook returned %d, want 503 fail-closed", res.Code)
	}
}
