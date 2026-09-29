package http

import (
	"encoding/json"
	"errors"
	"io"
	stdhttp "net/http"
	"strconv"
	"strings"

	"taptrade/gateway/internal/alphacashier"
	"taptrade/gateway/internal/rbac"
	"taptrade/gateway/internal/wallet"
	"taptrade/platform/transport/httpx"
)

const (
	alphaCashierReadPermission      = "cashier:read"
	alphaCashierWritePermission     = "cashier:write"
	alphaCashierBroadcastPermission = "cashier:broadcast"
)

func registerAlphaCashierAdminRoutes(mux *stdhttp.ServeMux, svc *alphacashier.Service, rbacSvc *rbac.Service) {
	mux.Handle("/api/v1/admin/cashier/alpha/preflight", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		if err := requireAlphaCashierPermission(r, rbacSvc, alphaCashierReadPermission); err != nil {
			return err
		}
		preflight := alphacashier.LaunchSafePreflightReport(svc.Preflight(r.Context()))
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{"preflight": preflight})
	}))

	mux.Handle("/api/v1/admin/cashier/alpha/deposits", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		if err := requireAlphaCashierPermission(r, rbacSvc, alphaCashierReadPermission); err != nil {
			return err
		}
		deposits, err := svc.ListAdminDepositIntents(r.Context(), alphacashier.DepositIntentFilter{
			Status: r.URL.Query().Get("status"),
			UserID: r.URL.Query().Get("userId"),
			TxHash: r.URL.Query().Get("txHash"),
			Limit:  parseAlphaCashierLimit(r),
		})
		if err != nil {
			return mapAlphaCashierAdminError(err)
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{"depositIntents": alphaCashierDepositIntentPayloads(deposits)})
	}))

	mux.Handle("/api/v1/admin/cashier/alpha/reconciliation", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		if err := requireAlphaCashierPermission(r, rbacSvc, alphaCashierReadPermission); err != nil {
			return err
		}
		summary, err := svc.ReconciliationSummary(r.Context())
		if err != nil {
			return mapAlphaCashierAdminError(err)
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{"reconciliation": alphaCashierReconciliationPayload(summary)})
	}))

	mux.Handle("/api/v1/admin/cashier/alpha/withdrawals", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		if err := requireAlphaCashierPermission(r, rbacSvc, alphaCashierReadPermission); err != nil {
			return err
		}
		requests, err := svc.ListAdminWithdrawalRequests(r.Context(), r.URL.Query().Get("status"))
		if err != nil {
			return mapAlphaCashierAdminError(err)
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{"withdrawalRequests": alphaCashierWithdrawalRequestPayloads(requests)})
	}))

	mux.Handle("/api/v1/admin/cashier/alpha/audit-events", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		if err := requireAlphaCashierPermission(r, rbacSvc, alphaCashierReadPermission); err != nil {
			return err
		}
		events, err := svc.ListAuditEvents(r.Context(), alphacashier.AuditEventFilter{
			SubjectType: r.URL.Query().Get("subjectType"),
			SubjectID:   r.URL.Query().Get("subjectId"),
			EventType:   r.URL.Query().Get("eventType"),
			ActorType:   r.URL.Query().Get("actorType"),
			ActorID:     r.URL.Query().Get("actorId"),
			Limit:       parseAlphaCashierLimit(r),
		})
		if err != nil {
			return mapAlphaCashierAdminError(err)
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{"auditEvents": alphaCashierAuditEventPayloads(events)})
	}))

	mux.Handle("/api/v1/admin/cashier/alpha/withdrawals/", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}
		rest := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/admin/cashier/alpha/withdrawals/"), "/")
		parts := strings.Split(rest, "/")
		if len(parts) != 2 || parts[0] == "" {
			return httpx.NotFound("legacy release request not found")
		}
		var body struct {
			ReviewNote string `json:"reviewNote"`
			TxHash     string `json:"txHash"`
		}
		if r.Body != nil {
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
				return httpx.BadRequest("invalid request body", nil)
			}
		}
		actorID := adminActorFromRequest(r)
		var (
			req *alphacashier.WithdrawalRequest
			err error
		)
		switch parts[1] {
		case "approve":
			if err := requireAlphaCashierPermission(r, rbacSvc, alphaCashierWritePermission); err != nil {
				return err
			}
			reviewNote := strings.TrimSpace(body.ReviewNote)
			if err := validateLaunchFacingReason("reviewNote", reviewNote); err != nil {
				return err
			}
			req, err = svc.ApproveWithdrawal(r.Context(), parts[0], actorID, reviewNote)
		case "reject":
			if err := requireAlphaCashierPermission(r, rbacSvc, alphaCashierWritePermission); err != nil {
				return err
			}
			reviewNote := strings.TrimSpace(body.ReviewNote)
			if err := validateLaunchFacingReason("reviewNote", reviewNote); err != nil {
				return err
			}
			req, err = svc.RejectWithdrawal(r.Context(), parts[0], actorID, reviewNote)
		case "mark-broadcasted":
			// Separation of duties: broadcasting (on-chain release) requires a
			// permission distinct from approval, so RBAC enforces two-person
			// control at the permission layer, not just by actor identity
			// (SECURITY-REVIEW #8).
			if err := requireAlphaCashierPermission(r, rbacSvc, alphaCashierBroadcastPermission); err != nil {
				return err
			}
			req, err = svc.MarkWithdrawalBroadcasted(r.Context(), parts[0], actorID, body.TxHash)
		case "mark-completed":
			if err := requireAlphaCashierPermission(r, rbacSvc, alphaCashierBroadcastPermission); err != nil {
				return err
			}
			req, err = svc.MarkWithdrawalCompleted(r.Context(), parts[0], actorID)
		default:
			return httpx.NotFound("legacy release action not found")
		}
		if err != nil {
			return mapAlphaCashierAdminError(err)
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{"withdrawalRequest": alphaCashierWithdrawalRequestPayload(req)})
	}))
}

func alphaCashierDepositIntentPayloads(deposits []alphacashier.DepositIntent) []alphacashier.DepositIntent {
	out := make([]alphacashier.DepositIntent, len(deposits))
	for i := range deposits {
		out[i] = *alphaCashierDepositIntentPayload(&deposits[i])
	}
	return out
}

func alphaCashierDepositIntentPayload(deposit *alphacashier.DepositIntent) *alphacashier.DepositIntent {
	if deposit == nil {
		return nil
	}
	out := *deposit
	out.ChainName = redactLaunchProhibitedUserText(out.ChainName)
	out.TokenSymbol = redactLaunchProhibitedUserText(out.TokenSymbol)
	out.TokenAddress = redactLaunchProhibitedUserText(out.TokenAddress)
	out.TreasuryAddress = redactLaunchProhibitedUserText(out.TreasuryAddress)
	out.FailureReason = redactLaunchProhibitedUserText(out.FailureReason)
	return &out
}

func alphaCashierWithdrawalRequestPayloads(requests []alphacashier.WithdrawalRequest) []alphacashier.WithdrawalRequest {
	out := make([]alphacashier.WithdrawalRequest, len(requests))
	for i := range requests {
		out[i] = *alphaCashierWithdrawalRequestPayload(&requests[i])
	}
	return out
}

func alphaCashierWithdrawalRequestPayload(request *alphacashier.WithdrawalRequest) *alphacashier.WithdrawalRequest {
	if request == nil {
		return nil
	}
	out := *request
	out.TokenSymbol = redactLaunchProhibitedUserText(out.TokenSymbol)
	out.TokenAddress = redactLaunchProhibitedUserText(out.TokenAddress)
	out.ReviewNote = redactLaunchProhibitedUserText(out.ReviewNote)
	out.FailureReason = redactLaunchProhibitedUserText(out.FailureReason)
	return &out
}

func alphaCashierReconciliationPayload(summary *alphacashier.ReconciliationSummary) *alphacashier.ReconciliationSummary {
	if summary == nil {
		return nil
	}
	out := *summary
	out.TokenSymbol = redactLaunchProhibitedUserText(out.TokenSymbol)
	out.TreasuryAddress = redactLaunchProhibitedUserText(out.TreasuryAddress)
	out.TreasuryBalanceUnits = redactLaunchProhibitedUserText(out.TreasuryBalanceUnits)
	return &out
}

func alphaCashierAuditEventPayloads(events []alphacashier.AuditEvent) []alphacashier.AuditEvent {
	out := make([]alphacashier.AuditEvent, len(events))
	for i, event := range events {
		out[i] = event
		out[i].SubjectType = alphaCashierAuditIdentifierPayload(event.SubjectType)
		out[i].EventType = alphaCashierAuditIdentifierPayload(event.EventType)
		out[i].EventPayload = alphaCashierAuditEventPayload(event.EventPayload)
	}
	return out
}

func alphaCashierAuditIdentifierPayload(value string) string {
	lower := strings.ToLower(value)
	for _, unsafe := range []string{"alpha_cashier", "cashier", "deposit", "withdraw", "withdrawal", "crypto", "fiat", "payout", "wallet"} {
		if strings.Contains(lower, unsafe) {
			return launchRedactedUserText
		}
	}
	return redactLaunchProhibitedUserText(value)
}

func alphaCashierAuditEventPayload(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return raw
	}
	var parsed any
	if err := json.Unmarshal([]byte(trimmed), &parsed); err != nil {
		return redactLaunchProhibitedUserText(raw)
	}
	encoded, err := json.Marshal(redactAuditDetailValue(parsed))
	if err != nil {
		return redactLaunchProhibitedUserText(raw)
	}
	return string(encoded)
}

// alphaCashierRequireRBAC is set when the alpha cashier runs on the SQL
// repository (real custody). Then the cashier's admin actions refuse to run
// without RBAC instead of degrading to "any admin", which would collapse the
// cashier:write / cashier:broadcast split (2026-09-29 audit). Memory mode
// and tests keep the project-wide nil-RBAC fallback to the admin role.
var alphaCashierRequireRBAC bool

func requireAlphaCashierPermission(r *stdhttp.Request, rbacSvc *rbac.Service, permission string) error {
	if rbacSvc == nil {
		if alphaCashierRequireRBAC {
			if err := requireAdminRole(r); err != nil {
				return err
			}
			return httpx.Forbidden("cashier admin actions require RBAC; none is configured")
		}
		return requireAdminRole(r)
	}
	return requireRBACPermission(r, rbacSvc, permission)
}

func parseAlphaCashierLimit(r *stdhttp.Request) int {
	raw := strings.TrimSpace(r.URL.Query().Get("limit"))
	if raw == "" {
		return 0
	}
	limit, err := strconv.Atoi(raw)
	if err != nil {
		return 0
	}
	return limit
}

func mapAlphaCashierAdminError(err error) error {
	switch {
	case errors.Is(err, alphacashier.ErrDisabled):
		return httpx.Forbidden("legacy transfer rail is disabled")
	case errors.Is(err, alphacashier.ErrWithdrawalsDisabled):
		return httpx.Forbidden("legacy external releases are disabled")
	case errors.Is(err, alphacashier.ErrInvalidStatus):
		return httpx.Conflict("legacy release request is not in a valid status for this action", nil)
	case errors.Is(err, alphacashier.ErrReviewNoteRequired):
		return httpx.BadRequest("review note is required", map[string]any{"field": "reviewNote"})
	case errors.Is(err, alphacashier.ErrWithdrawalNotFound):
		return httpx.NotFound("legacy release request not found")
	case errors.Is(err, alphacashier.ErrTxHashInvalid):
		return httpx.BadRequest("txHash must be valid for this legacy route", map[string]any{"field": "txHash"})
	case errors.Is(err, wallet.ErrInsufficientFunds):
		return httpx.BadRequest("insufficient point account balance", map[string]any{"field": "amountPoints"})
	case errors.Is(err, wallet.ErrReservationNotFound), errors.Is(err, wallet.ErrReservationNotHeld), errors.Is(err, wallet.ErrReservationExpired):
		return httpx.Conflict("legacy point reservation cannot be resolved", nil)
	default:
		return httpx.Internal("legacy transfer admin operation failed", err)
	}
}
