package alphacashier

import (
	"encoding/json"
	"errors"
	stdhttp "net/http"
	"regexp"
	"strings"

	"taptrade/gateway/internal/compliance"
	"taptrade/gateway/internal/wallet"
	"taptrade/platform/transport/httpx"
)

// ComplianceGate gates money movement (deposit/withdraw surfaces) behind the
// jurisdiction/KYC checks owned by the HTTP layer. Wired in
// internal/http/handlers.go; nil (e.g. in package tests) is a no-op. Mirrors
// the payments.KYCGate injection pattern.
var ComplianceGate compliance.GateFunc

var (
	alphaLaunchCopyProhibited       = regexp.MustCompile(`(?i)(\$|\b(cash|cashier|cashout|deposit|withdraw|withdrawal|crypto|fiat|freebets?|bets?|prizes?|payout|sportsbook|stakes?|wagers?|wagering|usdc|usd|dollars?|money|redeem)\b)`)
	alphaLaunchRedeemableProhibited = regexp.MustCompile(`(?i)\bredeemable\b`)
	alphaLaunchNonRedeemableAllowed = regexp.MustCompile(`(?i)\bnon-redeemable\b`)
)

const alphaLaunchRedactedUserText = "Removed by points-only safety boundary."

func checkComplianceGate(r *stdhttp.Request, userID string, surface compliance.Surface) error {
	if ComplianceGate == nil {
		return nil
	}
	return ComplianceGate(r, userID, surface)
}

func RegisterRoutes(mux *stdhttp.ServeMux, svc *Service) {
	mux.Handle("/api/v1/cashier/alpha/config", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		cfg := svc.Config()
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{"alphaCashier": alphaCashierConfigPayload(cfg)})
	}))

	mux.Handle("/api/v1/cashier/alpha/wallet/challenge", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}
		userID := httpx.UserIDFromContext(r.Context())
		if userID == "" {
			return httpx.Forbidden("authentication required")
		}
		var body struct {
			WalletAddress string `json:"walletAddress"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			return httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
		}
		challenge, err := svc.CreateWalletChallenge(r.Context(), userID, body.WalletAddress)
		if err != nil {
			return mapAlphaError(err)
		}
		return httpx.WriteJSON(w, stdhttp.StatusCreated, map[string]any{"challenge": challenge})
	}))

	mux.Handle("/api/v1/cashier/alpha/wallet/connect", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}
		userID := httpx.UserIDFromContext(r.Context())
		if userID == "" {
			return httpx.Forbidden("authentication required")
		}
		var body struct {
			Nonce     string `json:"nonce"`
			Signature string `json:"signature"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			return httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
		}
		conn, err := svc.ConnectWallet(r.Context(), userID, body.Nonce, body.Signature)
		if err != nil {
			return mapAlphaError(err)
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{"wallet": conn})
	}))

	mux.Handle("/api/v1/cashier/alpha/wallets", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		userID := httpx.UserIDFromContext(r.Context())
		if userID == "" {
			return httpx.Forbidden("authentication required")
		}
		wallets, err := svc.ListWalletConnections(r.Context(), userID)
		if err != nil {
			return mapAlphaError(err)
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{"wallets": wallets})
	}))

	mux.Handle("/api/v1/cashier/alpha/deposit-intents", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		userID := httpx.UserIDFromContext(r.Context())
		if userID == "" {
			return httpx.Forbidden("authentication required")
		}
		switch r.Method {
		case stdhttp.MethodGet:
			intents, err := svc.ListDepositIntents(r.Context(), userID)
			if err != nil {
				return mapAlphaError(err)
			}
			return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{"depositIntents": depositIntentPayloads(intents)})
		case stdhttp.MethodPost:
			if err := checkComplianceGate(r, userID, compliance.SurfaceDeposit); err != nil {
				return err
			}
			idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
			var body struct {
				WalletAddress string `json:"walletAddress"`
				AmountCents   int64  `json:"amountCents"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				return httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
			}
			intent, err := svc.CreateDepositIntent(r.Context(), userID, body.WalletAddress, body.AmountCents, idempotencyKey)
			if err != nil {
				return mapAlphaError(err)
			}
			return httpx.WriteJSON(w, stdhttp.StatusCreated, map[string]any{"depositIntent": depositIntentPayload(intent)})
		default:
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet, stdhttp.MethodPost)
		}
	}))

	mux.Handle("/api/v1/cashier/alpha/deposit-intents/", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		userID := httpx.UserIDFromContext(r.Context())
		if userID == "" {
			return httpx.Forbidden("authentication required")
		}
		rest := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/cashier/alpha/deposit-intents/"), "/")
		if rest == "" {
			return httpx.NotFound("legacy point request not found")
		}
		parts := strings.Split(rest, "/")
		id := parts[0]
		if len(parts) == 1 {
			if r.Method != stdhttp.MethodGet {
				return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
			}
			intent, err := svc.GetDepositIntent(r.Context(), userID, id)
			if err != nil {
				return mapAlphaError(err)
			}
			if intent == nil {
				return httpx.NotFound("legacy point request not found")
			}
			return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{"depositIntent": depositIntentPayload(intent)})
		}
		if len(parts) == 2 && parts[1] == "submit-tx" {
			if r.Method != stdhttp.MethodPost {
				return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
			}
			if err := checkComplianceGate(r, userID, compliance.SurfaceDeposit); err != nil {
				return err
			}
			if strings.TrimSpace(r.Header.Get("Idempotency-Key")) == "" {
				return httpx.BadRequest("Idempotency-Key header is required", map[string]any{"field": "Idempotency-Key"})
			}
			var body struct {
				TxHash string `json:"txHash"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				return httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
			}
			intent, err := svc.SubmitDepositTx(r.Context(), userID, id, body.TxHash)
			if err != nil {
				if errors.Is(err, ErrTxConfirming) || errors.Is(err, ErrTxNotFound) {
					return httpx.WriteJSON(w, stdhttp.StatusAccepted, map[string]any{"status": "confirming"})
				}
				return mapAlphaError(err)
			}
			if intent == nil {
				return httpx.NotFound("legacy point request not found")
			}
			return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{"depositIntent": depositIntentPayload(intent)})
		}
		return httpx.NotFound("legacy point request not found")
	}))

	mux.Handle("/api/v1/cashier/alpha/withdrawal-requests", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		userID := httpx.UserIDFromContext(r.Context())
		if userID == "" {
			return httpx.Forbidden("authentication required")
		}
		switch r.Method {
		case stdhttp.MethodGet:
			requests, err := svc.ListWithdrawalRequests(r.Context(), userID)
			if err != nil {
				return mapAlphaError(err)
			}
			return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{"withdrawalRequests": withdrawalRequestPayloads(requests)})
		case stdhttp.MethodPost:
			if err := checkComplianceGate(r, userID, compliance.SurfaceWithdraw); err != nil {
				return err
			}
			idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
			var body struct {
				DestinationAddress string `json:"destinationAddress"`
				AmountCents        int64  `json:"amountCents"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				return httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
			}
			req, err := svc.CreateWithdrawalRequest(r.Context(), userID, body.DestinationAddress, body.AmountCents, idempotencyKey)
			if err != nil {
				return mapAlphaError(err)
			}
			return httpx.WriteJSON(w, stdhttp.StatusCreated, map[string]any{"withdrawalRequest": withdrawalRequestPayload(req)})
		default:
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet, stdhttp.MethodPost)
		}
	}))

	mux.Handle("/api/v1/cashier/alpha/withdrawal-requests/", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		userID := httpx.UserIDFromContext(r.Context())
		if userID == "" {
			return httpx.Forbidden("authentication required")
		}
		id := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/cashier/alpha/withdrawal-requests/"), "/")
		if id == "" || strings.Contains(id, "/") {
			return httpx.NotFound("legacy point request not found")
		}
		req, err := svc.GetWithdrawalRequest(r.Context(), userID, id)
		if err != nil {
			return mapAlphaError(err)
		}
		if req == nil {
			return httpx.NotFound("legacy point request not found")
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{"withdrawalRequest": withdrawalRequestPayload(req)})
	}))
}

func alphaCashierConfigPayload(cfg Config) Config {
	out := cfg
	out.ChainName = alphaRedactLaunchProhibitedUserText(out.ChainName)
	out.TokenSymbol = alphaRedactLaunchProhibitedUserText(out.TokenSymbol)
	out.TokenAddress = alphaRedactLaunchProhibitedUserText(out.TokenAddress)
	out.TreasuryAddress = alphaRedactLaunchProhibitedUserText(out.TreasuryAddress)
	return out
}

func depositIntentPayloads(intents []DepositIntent) []DepositIntent {
	out := make([]DepositIntent, len(intents))
	for i := range intents {
		out[i] = *depositIntentPayload(&intents[i])
	}
	return out
}

func depositIntentPayload(intent *DepositIntent) *DepositIntent {
	if intent == nil {
		return nil
	}
	out := *intent
	out.ChainName = alphaRedactLaunchProhibitedUserText(out.ChainName)
	out.TokenSymbol = alphaRedactLaunchProhibitedUserText(out.TokenSymbol)
	out.TokenAddress = alphaRedactLaunchProhibitedUserText(out.TokenAddress)
	out.TreasuryAddress = alphaRedactLaunchProhibitedUserText(out.TreasuryAddress)
	out.FailureReason = alphaRedactLaunchProhibitedUserText(out.FailureReason)
	return &out
}

func withdrawalRequestPayloads(requests []WithdrawalRequest) []WithdrawalRequest {
	out := make([]WithdrawalRequest, len(requests))
	for i := range requests {
		out[i] = *withdrawalRequestPayload(&requests[i])
	}
	return out
}

func withdrawalRequestPayload(request *WithdrawalRequest) *WithdrawalRequest {
	if request == nil {
		return nil
	}
	out := *request
	out.TokenSymbol = alphaRedactLaunchProhibitedUserText(out.TokenSymbol)
	out.TokenAddress = alphaRedactLaunchProhibitedUserText(out.TokenAddress)
	out.ReviewNote = alphaRedactLaunchProhibitedUserText(out.ReviewNote)
	out.FailureReason = alphaRedactLaunchProhibitedUserText(out.FailureReason)
	return &out
}

func alphaRedactLaunchProhibitedUserText(value string) string {
	if alphaLaunchHasProhibitedCopy(value) {
		return alphaLaunchRedactedUserText
	}
	return value
}

func alphaLaunchHasProhibitedCopy(value string) bool {
	if value == "" {
		return false
	}
	if alphaLaunchCopyProhibited.MatchString(value) {
		return true
	}
	redeemableCandidate := alphaLaunchNonRedeemableAllowed.ReplaceAllString(value, "")
	return alphaLaunchRedeemableProhibited.MatchString(redeemableCandidate)
}

func mapAlphaError(err error) error {
	switch {
	case errors.Is(err, ErrDisabled):
		return httpx.Forbidden("legacy point rail is disabled")
	case errors.Is(err, ErrWithdrawalsDisabled):
		return httpx.Forbidden("legacy external point requests are disabled")
	case errors.Is(err, ErrInvalidAddress):
		return httpx.BadRequest("address must be valid for this legacy route", map[string]any{"field": "walletAddress"})
	case errors.Is(err, ErrInvalidAmount):
		return httpx.BadRequest("amount is outside legacy point-route limits", map[string]any{"field": "amountCents"})
	case errors.Is(err, ErrInvalidIdempotencyKey):
		return httpx.BadRequest("Idempotency-Key header is required", map[string]any{"field": "Idempotency-Key"})
	case errors.Is(err, ErrChallengeNotFound), errors.Is(err, ErrWalletNotConnected):
		return httpx.NotFound("legacy route connection not found")
	case errors.Is(err, ErrChallengeExpired):
		return httpx.BadRequest("legacy route challenge expired", map[string]any{"field": "nonce"})
	case errors.Is(err, ErrChallengeConsumed):
		return httpx.Conflict("legacy route challenge already consumed", nil)
	case errors.Is(err, ErrSignatureInvalid):
		return httpx.Forbidden("legacy route signature invalid")
	case errors.Is(err, ErrTxVerificationMissing):
		return httpx.Internal("legacy route verifier unavailable", err)
	case errors.Is(err, ErrWalletLedgerMissing):
		return httpx.Internal("point ledger unavailable", err)
	case errors.Is(err, ErrTxHashInvalid):
		return httpx.BadRequest("txHash must be valid for this legacy route", map[string]any{"field": "txHash"})
	case errors.Is(err, ErrTxFailed):
		return httpx.BadRequest("legacy route verification failed", map[string]any{"field": "txHash"})
	case errors.Is(err, ErrTransferMismatch):
		return httpx.BadRequest("legacy route evidence does not match the point request", map[string]any{"field": "txHash"})
	case errors.Is(err, ErrDepositExpired):
		return httpx.BadRequest("legacy point request expired", nil)
	case errors.Is(err, ErrWithdrawalNotFound):
		return httpx.NotFound("legacy point request not found")
	case errors.Is(err, ErrInvalidStatus):
		return httpx.Conflict("legacy point request is not in a valid status for this action", nil)
	case errors.Is(err, ErrReviewNoteRequired):
		return httpx.BadRequest("review note is required", map[string]any{"field": "reviewNote"})
	case errors.Is(err, ErrIdentityVerificationRequired):
		return httpx.Forbidden("identity verification required to withdraw above this amount — complete verification under Profile → Verification")
	case errors.Is(err, ErrIdentityVerificationUnavailable):
		return httpx.Forbidden("identity verification unavailable; withdrawal blocked")
	case errors.Is(err, wallet.ErrInsufficientFunds):
		return httpx.BadRequest("insufficient point account balance", map[string]any{"field": "amountCents"})
	default:
		return httpx.Internal("legacy point-route operation failed", err)
	}
}
