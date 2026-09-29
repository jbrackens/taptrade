package payments

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"taptrade/gateway/internal/compliance"
	"taptrade/gateway/internal/webhookauth"
	"taptrade/platform/transport/httpx"
)

type stubPaymentService struct {
	depositCalls        int
	lastDepositUserID   string
	webhookCalls        int
	lastWebhook         WebhookPayload
	cumulativeWithdrawn int64
	withdrawalCalls     int
	methodCalls         int
	lastMethodsUserID   string
	statusCalls         int
	lastStatusTxnID     string
	transactionStatus   *TransactionStatus
}

func (s *stubPaymentService) InitiateDeposit(ctx context.Context, userID string, amountCents int64, paymentMethod string) (*DepositResult, error) {
	s.depositCalls++
	s.lastDepositUserID = userID
	return &DepositResult{
		TransactionID: "dep:test",
		UserID:        userID,
		Amount:        amountCents,
		Status:        "approved",
		PaymentMethod: paymentMethod,
	}, nil
}

func (s *stubPaymentService) InitiateWithdrawal(_ context.Context, userID string, amountCents int64, _ string) (*WithdrawalResult, error) {
	s.withdrawalCalls++
	return &WithdrawalResult{UserID: userID, Amount: amountCents, Status: "pending"}, nil
}

func (s *stubPaymentService) CumulativeWithdrawnCents(context.Context, string) (int64, error) {
	return s.cumulativeWithdrawn, nil
}

func (s *stubPaymentService) InitiateGatedWithdrawal(_ context.Context, userID string, amountCents int64, _ string, gate func(int64) error) (*WithdrawalResult, error) {
	if gate != nil {
		if err := gate(s.cumulativeWithdrawn); err != nil {
			return nil, err
		}
	}
	s.withdrawalCalls++
	return &WithdrawalResult{UserID: userID, Amount: amountCents, Status: "pending"}, nil
}

func (s *stubPaymentService) GetPaymentMethods(_ context.Context, userID string) ([]PaymentMethod, error) {
	s.methodCalls++
	s.lastMethodsUserID = userID
	return []PaymentMethod{{ID: "card:test", Type: "credit_card", Label: "Test card", IsActive: true, IsDefault: true}}, nil
}

func (s *stubPaymentService) GetTransactionStatus(_ context.Context, txnID string) (*TransactionStatus, error) {
	s.statusCalls++
	s.lastStatusTxnID = txnID
	return s.transactionStatus, nil
}

func (s *stubPaymentService) HandleWebhook(_ context.Context, payload WebhookPayload) error {
	s.webhookCalls++
	s.lastWebhook = payload
	return nil
}

func TestRegisterPaymentRoutes_DepositBindsToAuthenticatedSession(t *testing.T) {
	service := &stubPaymentService{}
	mux := http.NewServeMux()
	RegisterPaymentRoutes(mux, service)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/deposit", strings.NewReader(`{"amountCents":1000,"paymentMethod":"card"}`))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(httpx.WithTestUser(req.Context(), "u-session", "u-session", "player"))
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 for session-bound deposit, got %d body=%s", rec.Code, rec.Body.String())
	}
	if service.depositCalls != 1 {
		t.Fatalf("expected one deposit call, got %d", service.depositCalls)
	}
	if service.lastDepositUserID != "u-session" {
		t.Fatalf("expected deposit to use session user, got %q", service.lastDepositUserID)
	}
}

func TestRegisterPaymentRoutes_DepositRejectsCrossUserBody(t *testing.T) {
	service := &stubPaymentService{}
	mux := http.NewServeMux()
	RegisterPaymentRoutes(mux, service)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/deposit", strings.NewReader(`{"userId":"u-victim","amountCents":1000,"paymentMethod":"card"}`))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(httpx.WithTestUser(req.Context(), "u-attacker", "u-attacker", "player"))
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for cross-user deposit body, got %d body=%s", rec.Code, rec.Body.String())
	}
	if service.depositCalls != 0 {
		t.Fatalf("expected no deposit call for cross-user request, got %d", service.depositCalls)
	}
}

func TestRegisterPaymentRoutes_MethodsDefaultToSessionUser(t *testing.T) {
	service := &stubPaymentService{}
	mux := http.NewServeMux()
	RegisterPaymentRoutes(mux, service)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/payments/methods", nil)
	req = req.WithContext(httpx.WithTestUser(req.Context(), "u-session", "u-session", "player"))
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for session payment methods, got %d body=%s", rec.Code, rec.Body.String())
	}
	if service.methodCalls != 1 || service.lastMethodsUserID != "u-session" {
		t.Fatalf("expected methods lookup for session user, calls=%d user=%q", service.methodCalls, service.lastMethodsUserID)
	}
}

func TestRegisterPaymentRoutes_MethodsRejectCrossUserForPlayer(t *testing.T) {
	service := &stubPaymentService{}
	mux := http.NewServeMux()
	RegisterPaymentRoutes(mux, service)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/payments/methods?userId=u-victim", nil)
	req = req.WithContext(httpx.WithTestUser(req.Context(), "u-attacker", "u-attacker", "player"))
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for cross-user payment methods, got %d body=%s", rec.Code, rec.Body.String())
	}
	if service.methodCalls != 0 {
		t.Fatalf("expected no methods lookup for cross-user request, got %d", service.methodCalls)
	}
}

func TestRegisterPaymentRoutes_StatusRejectsCrossUserForPlayer(t *testing.T) {
	service := &stubPaymentService{
		transactionStatus: &TransactionStatus{
			TransactionID: "dep:victim",
			UserID:        "u-victim",
			Status:        "approved",
		},
	}
	mux := http.NewServeMux()
	RegisterPaymentRoutes(mux, service)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/payments/status?transactionId=dep:victim", nil)
	req = req.WithContext(httpx.WithTestUser(req.Context(), "u-attacker", "u-attacker", "player"))
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for cross-user transaction status, got %d body=%s", rec.Code, rec.Body.String())
	}
	if service.statusCalls != 1 || service.lastStatusTxnID != "dep:victim" {
		t.Fatalf("expected status lookup before ownership check, calls=%d txn=%q", service.statusCalls, service.lastStatusTxnID)
	}
}

func TestRegisterPaymentRoutes_StatusAllowsAdminCrossUser(t *testing.T) {
	service := &stubPaymentService{
		transactionStatus: &TransactionStatus{
			TransactionID: "dep:victim",
			UserID:        "u-victim",
			Status:        "approved",
		},
	}
	mux := http.NewServeMux()
	RegisterPaymentRoutes(mux, service)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/payments/status?transactionId=dep:victim", nil)
	req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-1", "admin@example.test", "admin"))
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for admin transaction status, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestRegisterPaymentRoutes_WebhookRequiresSignature(t *testing.T) {
	t.Setenv(webhookSecretEnv, "whsec_test")

	service := &stubPaymentService{}
	mux := http.NewServeMux()
	RegisterPaymentRoutes(mux, service)

	body, err := json.Marshal(WebhookPayload{
		EventType:     "deposit.confirmed",
		TransactionID: "dep:test",
		UserID:        "u-1",
		Amount:        100,
		Status:        "approved",
		Timestamp:     time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("marshal webhook body: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 when webhook signature is missing, got %d body=%s", rec.Code, rec.Body.String())
	}
	if service.webhookCalls != 0 {
		t.Fatalf("expected webhook service not to run when signature is missing, got %d calls", service.webhookCalls)
	}
}

func TestRegisterPaymentRoutes_WebhookAcceptsValidSignature(t *testing.T) {
	t.Setenv(webhookSecretEnv, "whsec_test")

	service := &stubPaymentService{}
	mux := http.NewServeMux()
	RegisterPaymentRoutes(mux, service)

	body, err := json.Marshal(WebhookPayload{
		EventType:     "deposit.confirmed",
		TransactionID: "dep:test",
		UserID:        "u-1",
		Amount:        100,
		Status:        "approved",
		Timestamp:     time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("marshal webhook body: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(webhookSignatureHeader, webhookauth.Sign("whsec_test", body))
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for valid signed webhook, got %d body=%s", rec.Code, rec.Body.String())
	}
	if service.webhookCalls != 1 {
		t.Fatalf("expected webhook service to run once, got %d calls", service.webhookCalls)
	}
}

func TestRegisterPaymentRoutes_WebhookRejectsExpiredTimestamp(t *testing.T) {
	t.Setenv(webhookSecretEnv, "whsec_test")

	service := &stubPaymentService{}
	mux := http.NewServeMux()
	RegisterPaymentRoutes(mux, service)

	// A validly-signed message whose timestamp is older than the replay window
	// must be rejected — this is the captured-and-replayed webhook attack.
	body, err := json.Marshal(WebhookPayload{
		EventType:     "deposit.confirmed",
		TransactionID: "dep:test",
		UserID:        "u-1",
		Amount:        100,
		Status:        "approved",
		Timestamp:     time.Now().UTC().Add(-10 * time.Minute).Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("marshal webhook body: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(webhookSignatureHeader, webhookauth.Sign("whsec_test", body))
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for replayed (expired-timestamp) webhook, got %d body=%s", rec.Code, rec.Body.String())
	}
	if service.webhookCalls != 0 {
		t.Fatalf("expected webhook service not to run for expired timestamp, got %d calls", service.webhookCalls)
	}
}

// The jurisdiction compliance gate (geo) must run on the legacy deposit and
// withdraw routes before any payment service logic, mirroring the alpha
// cashier coverage. Wired via the ComplianceGate package var.
func TestRegisterPaymentRoutes_ComplianceGateDeniesMoneyMovement(t *testing.T) {
	var surfaces []compliance.Surface
	ComplianceGate = func(_ *http.Request, _ string, surface compliance.Surface) error {
		surfaces = append(surfaces, surface)
		return httpx.Forbidden("service not available in your jurisdiction")
	}
	t.Cleanup(func() { ComplianceGate = nil })

	service := &stubPaymentService{}
	mux := http.NewServeMux()
	RegisterPaymentRoutes(mux, service)

	cases := []struct {
		name    string
		path    string
		body    string
		surface compliance.Surface
	}{
		{"deposit", "/api/v1/payments/deposit", `{"amountCents":1000,"paymentMethod":"card"}`, compliance.SurfaceDeposit},
		{"withdraw", "/api/v1/payments/withdraw", `{"userId":"u-gate","amountCents":1000,"paymentMethod":"card"}`, compliance.SurfaceWithdraw},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			surfaces = nil
			req := httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			req = req.WithContext(httpx.WithTestUser(req.Context(), "u-gate", "u-gate", "player"))
			rec := httptest.NewRecorder()

			mux.ServeHTTP(rec, req)

			if rec.Code != http.StatusForbidden {
				t.Fatalf("expected 403 when the compliance gate denies, got %d body=%s", rec.Code, rec.Body.String())
			}
			if service.depositCalls != 0 || service.withdrawalCalls != 0 {
				t.Fatalf("expected payment service not to run when the gate denies")
			}
			if len(surfaces) != 1 || surfaces[0] != tc.surface {
				t.Fatalf("expected gate to see surface %q once, got %v", tc.surface, surfaces)
			}
		})
	}
}
