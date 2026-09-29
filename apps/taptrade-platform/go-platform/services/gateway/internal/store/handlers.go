package store

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	stdhttp "net/http"
	"strconv"
	"strings"
	"time"

	"taptrade/gateway/internal/compliance"
	"taptrade/gateway/internal/webhookauth"
	"taptrade/platform/transport/httpx"
)

// WebhookSignatureHeader carries the webhookauth signature (`sha256=<hex>`
// of the HMAC-SHA256 over the raw body). Stripe later: swap the verifier for
// Stripe's `Stripe-Signature: t=...,v1=...` scheme; nothing else changes.
const WebhookSignatureHeader = "X-Store-Signature"

// RegisterRoutes mounts the point store tree under /api/v1/store/*
// (STORE_AND_PAYMENTS.md §7). The caller registers this ONLY when
// STORE_ENABLED=true. Every route is session-authenticated except the
// webhook, which performs its own HMAC verification.
func RegisterRoutes(mux *stdhttp.ServeMux, svc *Service) {
	verifier := webhookauth.NewVerifier(svc.Config().WebhookSecret)

	mux.Handle("/api/v1/store/packs", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		userID := httpx.UserIDFromContext(r.Context())
		if userID == "" {
			return httpx.Forbidden("authentication required")
		}
		packs, firstPurchase, err := svc.Catalogue(r.Context(), userID)
		if err != nil {
			return mapStoreError(err)
		}
		payloads := make([]map[string]any, 0, len(packs))
		for _, pack := range packs {
			payloads = append(payloads, packPayload(pack))
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"packs":         payloads,
			"firstPurchase": firstPurchase,
			"unit":          "PTS",
		})
	}))

	mux.Handle("/api/v1/store/checkout", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}
		userID := httpx.UserIDFromContext(r.Context())
		if userID == "" {
			return httpx.Forbidden("authentication required")
		}
		var body struct {
			PackID         string `json:"packId"`
			IdempotencyKey string `json:"idempotencyKey"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			return httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
		}
		if strings.TrimSpace(body.PackID) == "" {
			return httpx.BadRequest("packId is required", map[string]any{"field": "packId"})
		}
		if ComplianceGate != nil {
			// Purchases are value-in: guarded by the same jurisdiction gate
			// as the legacy deposit surface (owner decision 2026-07-12).
			if err := ComplianceGate(r, userID, compliance.SurfaceDeposit); err != nil {
				return httpx.Forbidden("point pack checkout is not available in this region")
			}
		}
		purchase, session, created, err := svc.CreateCheckout(r.Context(), userID, body.PackID, body.IdempotencyKey)
		if err != nil {
			return mapStoreError(err)
		}
		status := stdhttp.StatusCreated
		if !created {
			status = stdhttp.StatusOK
		}
		payload := map[string]any{
			"purchase": purchasePayload(purchase),
		}
		if session != nil {
			payload["checkout"] = map[string]any{
				"providerSessionId": session.ProviderSessionID,
				"checkoutToken":     session.CheckoutToken,
			}
		}
		return httpx.WriteJSON(w, status, payload)
	}))

	mux.Handle("/api/v1/store/purchases", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		userID := httpx.UserIDFromContext(r.Context())
		if userID == "" {
			return httpx.Forbidden("authentication required")
		}
		limit := 50
		if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
			parsed, err := strconv.Atoi(raw)
			if err != nil || parsed <= 0 {
				return httpx.BadRequest("limit must be a positive integer", map[string]any{"field": "limit", "value": raw})
			}
			if parsed > 200 {
				parsed = 200
			}
			limit = parsed
		}
		purchases, err := svc.PurchasesForUser(r.Context(), userID, limit)
		if err != nil {
			return mapStoreError(err)
		}
		items := make([]map[string]any, 0, len(purchases))
		for i := range purchases {
			items = append(items, purchasePayload(&purchases[i]))
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"items": items,
			"total": len(items),
		})
	}))

	mux.Handle("/api/v1/store/purchases/", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		userID := httpx.UserIDFromContext(r.Context())
		if userID == "" {
			return httpx.Forbidden("authentication required")
		}
		rest := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/store/purchases/"), "/")
		if rest == "" {
			return httpx.NotFound("purchase not found")
		}
		parts := strings.Split(rest, "/")
		purchaseID := parts[0]

		purchase, err := svc.Purchase(r.Context(), purchaseID)
		if err != nil {
			return mapStoreError(err)
		}
		if purchase == nil {
			return httpx.NotFound("purchase not found")
		}

		if len(parts) == 1 {
			if r.Method != stdhttp.MethodGet {
				return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
			}
			// Owner-or-admin status read.
			if purchase.UserID != userID && httpx.RoleFromContext(r.Context()) != "admin" {
				return httpx.Forbidden("cannot access another user's purchase")
			}
			// A pending purchase re-checks the provider (delayed demo
			// checkouts complete here once the delay elapses). Fulfillment
			// stays server-side and idempotent.
			refreshed, err := svc.RefreshPurchase(r.Context(), purchase)
			if err != nil {
				return mapStoreError(err)
			}
			return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
				"purchase": purchasePayload(refreshed),
			})
		}

		if len(parts) == 2 && parts[1] == "confirm" {
			if r.Method != stdhttp.MethodPost {
				return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
			}
			// Demo provider only: a real provider confirms via its verified
			// webhook, never via a client call.
			if svc.Config().Provider != ProviderDemo {
				return mapStoreError(ErrConfirmNotSupported)
			}
			// Owner-only (stricter than the status read: admins do not
			// confirm on behalf of users).
			if purchase.UserID != userID {
				return httpx.Forbidden("only the purchase owner may confirm a demo checkout")
			}
			var body struct {
				Outcome string `json:"outcome"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				return httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
			}
			updated, alreadyFulfilled, err := svc.Confirm(r.Context(), purchase, body.Outcome)
			if err != nil {
				return mapStoreError(err)
			}
			return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
				"purchase":         purchasePayload(updated),
				"alreadyFulfilled": alreadyFulfilled,
			})
		}

		return httpx.NotFound("purchase resource not found")
	}))

	mux.Handle("/api/v1/store/webhook", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			return httpx.BadRequest("invalid request body", map[string]any{"field": "body"})
		}
		var payload struct {
			EventID    string `json:"eventId"`
			EventType  string `json:"eventType"`
			PurchaseID string `json:"purchaseId"`
			Status     string `json:"status"`
			Timestamp  string `json:"timestamp"`
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			return httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
		}

		signature := r.Header.Get(WebhookSignatureHeader)
		if err := verifier.Verify(body, signature, payload.Timestamp); err != nil {
			slog.Warn("store webhook rejected", "purchase_id", payload.PurchaseID, "event", payload.EventType, "error", err)
			// Append-only audit for replay/probe attempts against a known
			// purchase; the unverified payload is otherwise untrusted.
			svc.RecordRejectedWebhook(r.Context(), payload.PurchaseID, string(body))
			return mapWebhookVerificationError(err)
		}

		purchase, alreadyFulfilled, err := svc.HandleWebhookEvent(r.Context(), WebhookEvent{
			EventID:    payload.EventID,
			EventType:  payload.EventType,
			PurchaseID: payload.PurchaseID,
			Status:     payload.Status,
			RawPayload: string(body),
		})
		if err != nil {
			return mapStoreError(err)
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"purchaseId":       purchase.ID,
			"status":           string(purchase.Status),
			"alreadyFulfilled": alreadyFulfilled,
		})
	}))
}

func packPayload(pack PointPack) map[string]any {
	payload := map[string]any{
		"id":            pack.ID,
		"name":          pack.Name,
		"priceUsdCents": pack.PriceUsdCents,
		"basePoints":    pack.BasePoints,
		"bonusPoints":   pack.BonusPoints,
		"totalPoints":   pack.TotalPoints(),
		"displayOrder":  pack.DisplayOrder,
		"introOnly":     pack.IntroOnly,
		"unit":          "PTS",
	}
	if pack.Badge != "" {
		payload["badge"] = pack.Badge
	}
	if pack.PromoStartsAt != nil {
		payload["promoStartsAt"] = pack.PromoStartsAt.UTC().Format(time.RFC3339)
	}
	if pack.PromoEndsAt != nil {
		payload["promoEndsAt"] = pack.PromoEndsAt.UTC().Format(time.RFC3339)
	}
	return payload
}

func purchasePayload(purchase *Purchase) map[string]any {
	payload := map[string]any{
		"id":            purchase.ID,
		"userId":        purchase.UserID,
		"packId":        purchase.PackID,
		"status":        string(purchase.Status),
		"priceUsdCents": purchase.PriceUsdCents,
		"basePoints":    purchase.BasePoints,
		"bonusPoints":   purchase.BonusPoints,
		"totalPoints":   purchase.TotalPoints(),
		"provider":      purchase.Provider,
		"createdAt":     purchase.CreatedAt.UTC().Format(time.RFC3339),
		"unit":          "PTS",
	}
	if purchase.ProviderSessionID != "" {
		payload["providerSessionId"] = purchase.ProviderSessionID
	}
	if purchase.FailureReason != "" {
		payload["failureReason"] = purchase.FailureReason
	}
	if purchase.CompletedAt != nil {
		payload["completedAt"] = purchase.CompletedAt.UTC().Format(time.RFC3339)
	}
	return payload
}

func mapStoreError(err error) error {
	switch {
	case errors.Is(err, ErrPackNotFound):
		return httpx.NotFound("point pack not found")
	case errors.Is(err, ErrPackUnavailable):
		return httpx.Forbidden("point pack is not available for this account")
	case errors.Is(err, ErrPurchaseNotFound):
		return httpx.NotFound("purchase not found")
	case errors.Is(err, ErrIdempotencyKeyRequired):
		return httpx.BadRequest("idempotencyKey is required", map[string]any{"field": "idempotencyKey"})
	case errors.Is(err, ErrInvalidTransition):
		return httpx.Conflict("purchase is already in a terminal state", nil)
	case errors.Is(err, ErrOutcomeInvalid):
		return httpx.BadRequest("unknown checkout outcome", map[string]any{"field": "outcome"})
	case errors.Is(err, ErrConfirmNotSupported):
		return httpx.Forbidden("manual confirmation is only available for the demo provider")
	default:
		return httpx.Internal("point store operation failed", err)
	}
}

func mapWebhookVerificationError(err error) error {
	switch {
	case errors.Is(err, webhookauth.ErrSecretMissing):
		return httpx.NewError(stdhttp.StatusServiceUnavailable, "service_unavailable", "store webhook is not configured", nil, nil)
	case errors.Is(err, webhookauth.ErrRejected):
		return httpx.Unauthorized("invalid webhook signature")
	default:
		return httpx.Internal("webhook verification failed", err)
	}
}
