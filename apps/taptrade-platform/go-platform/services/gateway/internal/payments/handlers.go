package payments

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	stdhttp "net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"taptrade/gateway/internal/compliance"
	"taptrade/platform/transport/httpx"
)

// DepositComplianceChecker is an optional interface for deposit limit checks.
// If set, deposits are validated against responsible gaming limits before processing.
var DepositComplianceChecker compliance.ResponsibleGamblingService

// KYCGate is the optional KYC just-in-time gate for withdrawals (LC-22/D-8).
// If set AND KYC_ENFORCEMENT is enabled, a withdrawal that would push the
// user's cumulative cash-out past KYC_WITHDRAWAL_THRESHOLD_CENTS requires a
// verified (or in-flight: pending) identity. Mirrors the DepositCompliance
// Checker injection pattern; wired in internal/http/handlers.go.
var KYCGate compliance.KYCService

// ComplianceGate gates money movement behind the jurisdiction/KYC checks
// owned by the HTTP layer (geo gate on deposit/withdraw surfaces). Wired in
// internal/http/handlers.go; nil (e.g. in package tests) is a no-op. Same
// injection pattern as KYCGate above.
var ComplianceGate compliance.GateFunc

func checkComplianceGate(r *stdhttp.Request, userID string, surface compliance.Surface) error {
	if ComplianceGate == nil {
		return nil
	}
	return ComplianceGate(r, userID, surface)
}

const defaultKYCWithdrawalThresholdCents int64 = 250000 // $2,500 cumulative

// kycEnforcementEnabled reports whether the KYC JIT gate is active. Off by
// default so non-KYC jurisdictions / local dev are unaffected.
func kycEnforcementEnabled() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("KYC_ENFORCEMENT")))
	return v == "true" || v == "1" || v == "yes"
}

// kycWithdrawalThresholdCents is the cumulative cash-out above which KYC is
// required. 0 (or unset-to-0) means every withdrawal requires KYC. A negative
// or unparseable value falls back to the default.
func kycWithdrawalThresholdCents() int64 {
	raw := strings.TrimSpace(os.Getenv("KYC_WITHDRAWAL_THRESHOLD_CENTS"))
	if raw == "" {
		return defaultKYCWithdrawalThresholdCents
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n < 0 {
		return defaultKYCWithdrawalThresholdCents
	}
	return n
}

// kycStatusPasses returns true when the KYC status permits a gated
// withdrawal. Per the LC-22 design decision, an in-flight (pending)
// verification passes alongside a completed (approved) one; unverified /
// declined / blocked / unknown all fail.
func kycStatusPasses(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "approved", "pending":
		return true
	default:
		return false
	}
}

// ErrKYCRequired / ErrKYCUnavailable are the KYC just-in-time gate's
// refusals (LC-22/D-8).
var (
	ErrKYCRequired    = errors.New("identity verification required to withdraw above this amount")
	ErrKYCUnavailable = errors.New("identity verification unavailable; withdrawal blocked")
)

// WithdrawalKYCCheck applies the KYC just-in-time rule to a withdrawal of
// amountCents on top of cumulativeCents the user has already cashed out
// across every rail (CrossRailWithdrawnCents). The payments rail and the
// alpha cashier both call it, and both count each other's withdrawals, so a
// threshold cannot be split between them (2026-09-29 audit). nil = allowed.
func WithdrawalKYCCheck(ctx context.Context, userID string, cumulativeCents, amountCents int64) error {
	if KYCGate == nil || !kycEnforcementEnabled() {
		return nil
	}
	threshold := kycWithdrawalThresholdCents()
	if cumulativeCents+amountCents <= threshold {
		return nil
	}
	gctx, gcancel := context.WithTimeout(ctx, 3*time.Second)
	defer gcancel()
	st, kerr := KYCGate.GetVerificationStatus(gctx, userID)
	if kerr != nil {
		env := strings.ToLower(strings.TrimSpace(os.Getenv("ENVIRONMENT")))
		if env == "production" || env == "staging" {
			slog.Error("kyc gate check failed", "user_id", userID, "env", env, "error", kerr)
			return ErrKYCUnavailable
		}
		slog.Warn("kyc gate check failed, allowing withdrawal in dev mode", "user_id", userID, "error", kerr)
		return nil
	}
	if st == nil || !kycStatusPasses(st.Status) {
		slog.Info("withdrawal blocked: KYC required above threshold",
			"user_id", userID, "cumulative_cents", cumulativeCents, "amount_cents", amountCents, "threshold_cents", threshold)
		return ErrKYCRequired
	}
	return nil
}

func paymentRouteUserID(r *stdhttp.Request, requestedUserID string, allowAdmin bool) (string, error) {
	sessionUserID := httpx.UserIDFromContext(r.Context())
	if sessionUserID == "" {
		return "", httpx.Forbidden("authentication required")
	}

	requestedUserID = strings.TrimSpace(requestedUserID)
	if requestedUserID == "" || requestedUserID == sessionUserID {
		return sessionUserID, nil
	}
	if allowAdmin && strings.EqualFold(httpx.RoleFromContext(r.Context()), "admin") {
		return requestedUserID, nil
	}
	return "", httpx.Forbidden("cannot access another user's payment account")
}

// RegisterPaymentRoutes registers all payment-related HTTP handlers
func RegisterPaymentRoutes(mux *stdhttp.ServeMux, service PaymentService) {
	mux.Handle("/api/v1/payments/deposit", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}

		var req InitiateDepositRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
		}

		userID, err := paymentRouteUserID(r, req.UserID, false)
		if err != nil {
			return err
		}
		if err := checkComplianceGate(r, userID, compliance.SurfaceDeposit); err != nil {
			return err
		}
		if req.Amount <= 0 {
			return httpx.BadRequest("amountCents must be greater than zero", map[string]any{"field": "amountCents"})
		}
		if req.PaymentMethod == "" {
			return httpx.BadRequest("paymentMethod is required", map[string]any{"field": "paymentMethod"})
		}

		// Check deposit limits before processing
		if DepositComplianceChecker != nil {
			ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
			defer cancel()
			allowed, reason, err := DepositComplianceChecker.CheckDepositAllowed(ctx, userID, req.Amount)
			if err != nil {
				if errors.Is(err, compliance.ErrDepositLimitExceeded) || errors.Is(err, compliance.ErrUserExcluded) || errors.Is(err, compliance.ErrUserBlocked) {
					return httpx.Forbidden("deposit not allowed: " + reason)
				}
				env := strings.ToLower(strings.TrimSpace(os.Getenv("ENVIRONMENT")))
				if env == "production" || env == "staging" {
					slog.Error("deposit compliance check failed", "user_id", userID, "env", env, "error", err)
					return httpx.Forbidden("deposit compliance check unavailable")
				}
				slog.Warn("deposit compliance check failed, allowing deposit in dev mode", "user_id", userID, "error", err)
			} else if !allowed {
				return httpx.Forbidden("deposit not allowed: " + reason)
			}
		}

		ctx := r.Context()
		if key := r.Header.Get("Idempotency-Key"); strings.TrimSpace(key) != "" {
			if len(key) > 128 {
				return httpx.BadRequest("Idempotency-Key is too long", map[string]any{"field": "Idempotency-Key"})
			}
			ctx = WithIdempotencyKey(ctx, key)
		}
		result, err := service.InitiateDeposit(ctx, userID, req.Amount, req.PaymentMethod)
		if err != nil {
			return mapPaymentError(err)
		}

		// Record deposit for limit tracking
		if DepositComplianceChecker != nil {
			ctx2, cancel2 := context.WithTimeout(r.Context(), 2*time.Second)
			defer cancel2()
			if err := DepositComplianceChecker.RecordDeposit(ctx2, userID, req.Amount); err != nil {
				slog.Warn("failed to record deposit for compliance tracking", "user_id", userID, "error", err)
			}
		}

		return httpx.WriteJSON(w, stdhttp.StatusCreated, map[string]any{
			"transaction": result,
		})
	}))

	mux.Handle("/api/v1/payments/withdraw", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}

		var req InitiateWithdrawalRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
		}

		if req.UserID == "" {
			return httpx.BadRequest("userId is required", map[string]any{"field": "userId"})
		}
		if req.Amount <= 0 {
			return httpx.BadRequest("amountCents must be greater than zero", map[string]any{"field": "amountCents"})
		}
		if req.PaymentMethod == "" {
			return httpx.BadRequest("paymentMethod is required", map[string]any{"field": "paymentMethod"})
		}

		// Bind to the authenticated session. This route is not public, so a
		// session is always present in production; require it explicitly so
		// the KYC gate evaluates the real caller and the withdrawal target
		// is the caller — never an attacker-controlled body userId. A
		// non-empty body userId that disagrees with the session is rejected
		// (defense in depth, mirrors sessionBoundUserID). (codex LC-22 P2.)
		userID := httpx.UserIDFromContext(r.Context())
		if userID == "" {
			return httpx.Forbidden("authentication required")
		}
		if req.UserID != "" && req.UserID != userID {
			return httpx.Forbidden("cannot withdraw for another user")
		}
		if err := checkComplianceGate(r, userID, compliance.SurfaceWithdraw); err != nil {
			return err
		}

		// KYC just-in-time gate (LC-22/D-8), evaluated atomically with the
		// withdrawal record under a per-user lock to close the D-9 TOCTOU.
		// Only when enforcement is enabled (off by default). A withdrawal
		// that would push the user's cumulative cash-out past the threshold
		// requires a verified or in-flight (pending) identity. KYC-service
		// errors fail closed in production/staging, open in dev — mirrors
		// the deposit RG check. The gate decision runs while the per-user
		// lock is held; its error is captured and surfaced verbatim (it is
		// an httpx error), distinct from payment-domain errors.
		var gateErr error
		gate := func(cumulative int64) error {
			switch err := WithdrawalKYCCheck(r.Context(), userID, cumulative, req.Amount); {
			case errors.Is(err, ErrKYCUnavailable):
				gateErr = httpx.Forbidden("identity verification unavailable; withdrawal blocked")
				return gateErr
			case errors.Is(err, ErrKYCRequired):
				gateErr = httpx.Forbidden("identity verification required to withdraw above this amount — complete verification under Profile → Verification")
				return gateErr
			case err != nil:
				gateErr = httpx.Internal("identity verification check failed", err)
				return gateErr
			}
			return nil
		}

		result, err := service.InitiateGatedWithdrawal(r.Context(), userID, req.Amount, req.PaymentMethod, gate)
		if gateErr != nil {
			return gateErr // httpx error from the KYC gate — surface verbatim
		}
		if err != nil {
			return mapPaymentError(err)
		}

		return httpx.WriteJSON(w, stdhttp.StatusCreated, map[string]any{
			"transaction": result,
		})
	}))

	mux.Handle("/api/v1/payments/methods", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}

		userID, err := paymentRouteUserID(r, r.URL.Query().Get("userId"), true)
		if err != nil {
			return err
		}

		methods, err := service.GetPaymentMethods(r.Context(), userID)
		if err != nil {
			return mapPaymentError(err)
		}

		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"userId":  userID,
			"methods": methods,
			"total":   len(methods),
		})
	}))

	mux.Handle("/api/v1/payments/status", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}

		txnID := r.URL.Query().Get("transactionId")
		if txnID == "" {
			return httpx.BadRequest("transactionId query parameter is required", map[string]any{"field": "transactionId"})
		}

		sessionUserID := httpx.UserIDFromContext(r.Context())
		if sessionUserID == "" {
			return httpx.Forbidden("authentication required")
		}

		status, err := service.GetTransactionStatus(r.Context(), txnID)
		if err != nil {
			return mapPaymentError(err)
		}
		if status == nil {
			return httpx.NotFound("transaction not found")
		}
		if status.UserID != sessionUserID && !strings.EqualFold(httpx.RoleFromContext(r.Context()), "admin") {
			return httpx.Forbidden("cannot access another user's payment account")
		}

		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"transaction": status,
		})
	}))

	mux.Handle("/api/v1/payments/webhook", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}

		verifier, err := newWebhookVerifierFromEnv()
		if err != nil {
			slog.Error("payments webhook rejected: verifier unavailable", "error", err)
			return mapWebhookVerificationError(err)
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			return httpx.BadRequest("invalid request body", map[string]any{"field": "body"})
		}

		var payload WebhookPayload
		if err := json.Unmarshal(body, &payload); err != nil {
			return httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
		}

		signature := r.Header.Get(webhookSignatureHeader)
		if err := verifier.Verify(body, signature, payload.Timestamp); err != nil {
			slog.Warn("payments webhook rejected", "txn_id", payload.TransactionID, "event", payload.EventType, "error", err)
			return mapWebhookVerificationError(err)
		}
		payload.Signature = signature

		if err := service.HandleWebhook(r.Context(), payload); err != nil {
			return mapPaymentError(err)
		}

		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"transactionId": payload.TransactionID,
			"status":        "processed",
		})
	}))
}

func mapPaymentError(err error) error {
	if errors.Is(err, ErrInvalidUserID) {
		return httpx.BadRequest("invalid user id", map[string]any{"field": "userId"})
	}
	if errors.Is(err, ErrInvalidAmount) {
		return httpx.BadRequest("invalid amount", map[string]any{"field": "amountCents"})
	}
	if errors.Is(err, ErrInvalidPaymentMethod) {
		return httpx.BadRequest("invalid payment method", map[string]any{"field": "paymentMethod"})
	}
	if errors.Is(err, ErrTransactionNotFound) {
		return httpx.NotFound("transaction not found")
	}
	if errors.Is(err, ErrInsufficientFunds) {
		return httpx.Forbidden("insufficient funds for withdrawal")
	}
	if errors.Is(err, ErrWithdrawalFailed) {
		return httpx.Internal("withdrawal failed", err)
	}
	if errors.Is(err, ErrDepositFailed) {
		return httpx.Internal("deposit failed", err)
	}
	return httpx.Internal("payment operation failed", err)
}

func mapWebhookVerificationError(err error) error {
	switch {
	case errors.Is(err, ErrWebhookSecretMissing):
		return httpx.NewError(stdhttp.StatusServiceUnavailable, "service_unavailable", "payments webhook is not configured", nil, nil)
	case errors.Is(err, ErrWebhookSignatureMissing),
		errors.Is(err, ErrWebhookSignatureInvalid),
		errors.Is(err, ErrWebhookTimestampMissing),
		errors.Is(err, ErrWebhookTimestampInvalid),
		errors.Is(err, ErrWebhookTimestampExpired):
		return httpx.Unauthorized("invalid webhook signature")
	default:
		return httpx.Internal("webhook verification failed", err)
	}
}
