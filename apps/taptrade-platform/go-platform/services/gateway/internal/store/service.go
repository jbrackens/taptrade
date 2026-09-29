package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"log/slog"
	"strings"
	"time"
)

// WalletAdapter is the narrow wallet seam the store depends on (mirrors the
// prediction.WalletAdapter pattern — the store package never imports
// internal/wallet). The concrete bridge lives in
// internal/http/store_wallet_adapter.go. tx is nil when the repository has
// no SQL transaction (in-memory mode); the bridge falls back to a standalone
// credit there.
type WalletAdapter interface {
	CreditWithTx(ctx context.Context, tx *sql.Tx, userID string, amountPoints int64, idempotencyKey, reason string) error
}

// Service owns checkout creation and fulfillment for the point store.
type Service struct {
	cfg      Config
	repo     Repository
	wallet   WalletAdapter
	provider PaymentProvider
	now      func() time.Time
}

// NewService wires the store service. All config is bound here — nothing is
// re-read from the environment per request.
func NewService(cfg Config, repo Repository, walletAdapter WalletAdapter, provider PaymentProvider) *Service {
	return &Service{
		cfg:      cfg,
		repo:     repo,
		wallet:   walletAdapter,
		provider: provider,
		now:      time.Now,
	}
}

// SetClock injects a deterministic clock for tests.
func (s *Service) SetClock(now func() time.Time) {
	if now != nil {
		s.now = now
	}
}

// Config returns the bound configuration (handlers use it for the
// demo-provider-only confirm gate and webhook verifier construction).
func (s *Service) Config() Config {
	return s.cfg
}

// Catalogue returns the packs the user may currently buy plus their
// first-purchase eligibility. Inactive packs are never served; promo-window
// packs only inside their window; intro_only packs only before the first
// completed purchase.
func (s *Service) Catalogue(ctx context.Context, userID string) ([]PointPack, bool, error) {
	hasCompleted, err := s.repo.HasCompletedPurchase(ctx, userID)
	if err != nil {
		return nil, false, err
	}
	firstPurchase := !hasCompleted

	all, err := s.repo.ListPacks(ctx)
	if err != nil {
		return nil, false, err
	}
	packs := make([]PointPack, 0, len(all))
	for _, pack := range all {
		if s.packEligible(pack, firstPurchase) {
			packs = append(packs, pack)
		}
	}
	return packs, firstPurchase, nil
}

func (s *Service) packEligible(pack PointPack, firstPurchase bool) bool {
	if !pack.Active {
		return false
	}
	now := s.now()
	if pack.PromoStartsAt != nil && now.Before(*pack.PromoStartsAt) {
		return false
	}
	if pack.PromoEndsAt != nil && now.After(*pack.PromoEndsAt) {
		return false
	}
	if pack.IntroOnly && !firstPurchase {
		return false
	}
	return true
}

// CreateCheckout resolves the pack server-side (the client supplies only
// packId + an idempotency key), snapshots price/points onto a new
// pending_payment purchase, and registers a provider checkout session.
// A replayed clientKey returns the existing purchase (created=false).
func (s *Service) CreateCheckout(ctx context.Context, userID, packID, clientKey string) (*Purchase, *CheckoutSession, bool, error) {
	clientKey = strings.TrimSpace(clientKey)
	if clientKey == "" {
		return nil, nil, false, ErrIdempotencyKeyRequired
	}

	if existing, err := s.repo.PurchaseByClientKey(ctx, userID, clientKey); err != nil {
		return nil, nil, false, err
	} else if existing != nil {
		return existing, &CheckoutSession{ProviderSessionID: existing.ProviderSessionID}, false, nil
	}

	hasCompleted, err := s.repo.HasCompletedPurchase(ctx, userID)
	if err != nil {
		return nil, nil, false, err
	}
	firstPurchase := !hasCompleted

	pack, err := s.repo.GetPack(ctx, strings.TrimSpace(packID))
	if err != nil {
		return nil, nil, false, err
	}
	if pack == nil {
		return nil, nil, false, ErrPackNotFound
	}
	if !s.packEligible(*pack, firstPurchase) {
		return nil, nil, false, ErrPackUnavailable
	}

	bonusPoints := pack.BonusPoints
	if firstPurchase && s.cfg.FirstPurchaseBonusBps > 0 {
		bonusPoints += pack.BasePoints * s.cfg.FirstPurchaseBonusBps / 10000
	}

	purchase := &Purchase{
		ID:                   newPurchaseID(),
		UserID:               userID,
		PackID:               pack.ID,
		PriceUsdCents:        pack.PriceUsdCents,
		BasePoints:           pack.BasePoints,
		BonusPoints:          bonusPoints,
		Status:               StatusPendingPayment,
		Provider:             s.cfg.Provider,
		ClientIdempotencyKey: clientKey,
	}
	if err := s.repo.InsertPurchase(ctx, purchase); err != nil {
		if err == ErrDuplicateClientKey {
			// Concurrent double-POST lost the insert race: return the winner.
			existing, lookupErr := s.repo.PurchaseByClientKey(ctx, userID, clientKey)
			if lookupErr != nil {
				return nil, nil, false, lookupErr
			}
			if existing != nil {
				return existing, &CheckoutSession{ProviderSessionID: existing.ProviderSessionID}, false, nil
			}
		}
		return nil, nil, false, err
	}

	session, err := s.provider.CreateCheckoutSession(ctx, CheckoutSessionRequest{
		PurchaseID:    purchase.ID,
		UserID:        userID,
		PackID:        pack.ID,
		PriceUsdCents: purchase.PriceUsdCents,
		TotalPoints:   purchase.TotalPoints(),
	})
	if err != nil {
		return nil, nil, false, fmt.Errorf("store: create checkout session: %w", err)
	}
	if err := s.repo.SetProviderSession(ctx, purchase.ID, session.ProviderSessionID); err != nil {
		return nil, nil, false, err
	}
	purchase.ProviderSessionID = session.ProviderSessionID
	return purchase, &session, true, nil
}

// Purchase returns one purchase by id (nil when absent).
func (s *Service) Purchase(ctx context.Context, id string) (*Purchase, error) {
	return s.repo.Purchase(ctx, id)
}

// PurchasesForUser lists the session user's purchase history.
func (s *Service) PurchasesForUser(ctx context.Context, userID string, limit int) ([]Purchase, error) {
	return s.repo.PurchasesByUser(ctx, userID, limit)
}

// Confirm maps a demo confirmation outcome onto the purchase through the
// provider, then applies it. alreadyFulfilled reports an idempotent replay
// of a completed purchase (no wallet ops ran).
func (s *Service) Confirm(ctx context.Context, purchase *Purchase, outcome string) (*Purchase, bool, error) {
	result, err := s.provider.HandlePaymentConfirmation(ctx, ConfirmationInput{
		PurchaseID:        purchase.ID,
		ProviderSessionID: purchase.ProviderSessionID,
		Outcome:           outcome,
	})
	if err != nil {
		return nil, false, err
	}
	return s.applyOutcome(ctx, purchase.ID, result, true)
}

// RefreshPurchase polls the provider for a pending purchase and fulfills it
// when the provider reports completion (the delayed-outcome path). Non-
// pending purchases and provider errors return the purchase unchanged.
func (s *Service) RefreshPurchase(ctx context.Context, purchase *Purchase) (*Purchase, error) {
	if purchase.Status != StatusPendingPayment || strings.TrimSpace(purchase.ProviderSessionID) == "" {
		return purchase, nil
	}
	status, err := s.provider.GetCheckoutStatus(ctx, purchase.ProviderSessionID)
	if err != nil {
		slog.Warn("store: provider status poll failed", "purchase_id", purchase.ID, "error", err)
		return purchase, nil
	}

	var result ConfirmationResult
	switch status.State {
	case CheckoutStateCompleted:
		result = ConfirmationResult{
			Outcome:         OutcomeCompleted,
			EventType:       "checkout.completed",
			ProviderEventID: "poll_evt_" + purchase.ID + ":completed",
		}
	case CheckoutStateFailed:
		result = ConfirmationResult{
			Outcome:         OutcomeFailed,
			FailureReason:   "checkout reported failed by provider",
			EventType:       "checkout.failed",
			ProviderEventID: "poll_evt_" + purchase.ID + ":failed",
		}
	case CheckoutStateCanceled:
		result = ConfirmationResult{
			Outcome:         OutcomeCanceled,
			FailureReason:   "checkout reported canceled by provider",
			EventType:       "checkout.canceled",
			ProviderEventID: "poll_evt_" + purchase.ID + ":canceled",
		}
	default:
		return purchase, nil
	}
	updated, _, err := s.applyOutcome(ctx, purchase.ID, result, true)
	return updated, err
}

// WebhookEvent is a signature-verified provider event addressed to a
// purchase. Amounts never ride the webhook — the server-side purchase
// snapshot is the only source of credited points.
type WebhookEvent struct {
	EventID    string
	EventType  string
	PurchaseID string
	Status     string
	RawPayload string
}

// HandleWebhookEvent applies a verified provider event to its purchase.
func (s *Service) HandleWebhookEvent(ctx context.Context, event WebhookEvent) (*Purchase, bool, error) {
	purchase, err := s.repo.Purchase(ctx, strings.TrimSpace(event.PurchaseID))
	if err != nil {
		return nil, false, err
	}
	if purchase == nil {
		return nil, false, ErrPurchaseNotFound
	}

	result := ConfirmationResult{
		EventType:       strings.TrimSpace(event.EventType),
		ProviderEventID: strings.TrimSpace(event.EventID),
	}
	switch strings.ToLower(strings.TrimSpace(event.Status)) {
	case "completed", "succeeded", "success":
		result.Outcome = OutcomeCompleted
	case "failed", "declined", "failure":
		result.Outcome = OutcomeFailed
		result.FailureReason = "provider reported checkout failed"
	case "canceled", "cancelled", "cancel":
		result.Outcome = OutcomeCanceled
		result.FailureReason = "provider reported checkout canceled"
	case "pending", "processing", "delayed":
		result.Outcome = OutcomePending
	default:
		return nil, false, fmt.Errorf("%w: webhook status %q", ErrOutcomeInvalid, event.Status)
	}
	if result.EventType == "" {
		result.EventType = "webhook." + string(result.Outcome)
	}
	return s.applyOutcomeWithPayload(ctx, purchase.ID, result, true, event.RawPayload)
}

// RecordRejectedWebhook appends a signature_valid=false evidence row for a
// known purchase so replay/probe attempts leave an audit trail. Best-effort:
// unknown purchases are skipped (an unverified payload cannot be trusted to
// address a purchase).
func (s *Service) RecordRejectedWebhook(ctx context.Context, purchaseID, payload string) {
	purchaseID = strings.TrimSpace(purchaseID)
	if purchaseID == "" {
		return
	}
	purchase, err := s.repo.Purchase(ctx, purchaseID)
	if err != nil || purchase == nil {
		return
	}
	if err := s.repo.InsertPaymentEvent(ctx, &PaymentEvent{
		PurchaseID:     purchase.ID,
		EventType:      "webhook.rejected",
		SignatureValid: false,
		Payload:        payload,
	}); err != nil {
		slog.Warn("store: failed to record rejected webhook event", "purchase_id", purchaseID, "error", err)
	}
}

func (s *Service) applyOutcome(ctx context.Context, purchaseID string, result ConfirmationResult, signatureValid bool) (*Purchase, bool, error) {
	return s.applyOutcomeWithPayload(ctx, purchaseID, result, signatureValid, "")
}

// applyOutcomeWithPayload is the single fulfillment/terminal entrypoint
// (contract §5). One repository transaction: lock -> idempotency check ->
// wallet credits (completed only) -> status flip -> evidence event -> commit.
func (s *Service) applyOutcomeWithPayload(ctx context.Context, purchaseID string, result ConfirmationResult, signatureValid bool, rawPayload string) (*Purchase, bool, error) {
	event := &PaymentEvent{
		PurchaseID:      purchaseID,
		EventType:       result.EventType,
		ProviderEventID: result.ProviderEventID,
		SignatureValid:  signatureValid,
		Payload:         rawPayload,
	}

	if result.Outcome == OutcomePending {
		// Delayed: the purchase stays pending_payment and holds zero
		// spendable points; only the evidence row is recorded.
		if err := s.repo.InsertPaymentEvent(ctx, event); err != nil {
			return nil, false, err
		}
		purchase, err := s.repo.Purchase(ctx, purchaseID)
		if err != nil {
			return nil, false, err
		}
		if purchase == nil {
			return nil, false, ErrPurchaseNotFound
		}
		return purchase, false, nil
	}

	alreadyFulfilled := false
	updated, err := s.repo.ResolvePurchase(ctx, purchaseID, func(ctx context.Context, tx *sql.Tx, current Purchase) (ResolveOutcome, error) {
		switch result.Outcome {
		case OutcomeCompleted:
			if current.Status == StatusCompleted {
				// Idempotent success: duplicate confirmations / webhook
				// replays are 200-OK no-ops with NO wallet operations.
				alreadyFulfilled = true
				return ResolveOutcome{AlreadyFinal: true, Event: event}, nil
			}
			if current.Status != StatusPendingPayment {
				return ResolveOutcome{}, fmt.Errorf("%w: %s -> %s", ErrInvalidTransition, current.Status, StatusCompleted)
			}
			// Base credit, then bonus credit, inside the SAME transaction as
			// the status flip. The wallet UNIQUE (entry_type, user_id,
			// idempotency_key) is the second, independent double-credit
			// backstop under the same tx.
			if err := s.wallet.CreditWithTx(ctx, tx, current.UserID, current.BasePoints, PurchaseCreditKey(current.ID), ReasonPointPackPurchase); err != nil {
				return ResolveOutcome{}, fmt.Errorf("store: base point credit failed: %w", err)
			}
			if current.BonusPoints > 0 {
				if err := s.wallet.CreditWithTx(ctx, tx, current.UserID, current.BonusPoints, PurchaseBonusCreditKey(current.ID), ReasonPromoBonus); err != nil {
					return ResolveOutcome{}, fmt.Errorf("store: bonus point credit failed: %w", err)
				}
			}
			return ResolveOutcome{Status: StatusCompleted, Event: event}, nil

		case OutcomeFailed, OutcomeCanceled:
			target := StatusFailed
			if result.Outcome == OutcomeCanceled {
				target = StatusCanceled
			}
			if current.Status == target {
				// Idempotent replay of the same terminal outcome.
				return ResolveOutcome{AlreadyFinal: true, Event: event}, nil
			}
			if current.Status != StatusPendingPayment {
				return ResolveOutcome{}, fmt.Errorf("%w: %s -> %s", ErrInvalidTransition, current.Status, target)
			}
			// Status flip + event only — no wallet operations of any kind.
			return ResolveOutcome{Status: target, FailureReason: result.FailureReason, Event: event}, nil

		default:
			return ResolveOutcome{}, fmt.Errorf("%w: %q", ErrOutcomeInvalid, result.Outcome)
		}
	})
	if err != nil {
		return nil, false, err
	}
	return updated, alreadyFulfilled, nil
}

// newPurchaseID mints a crypto-random purchase id with the sp_ prefix
// (contract §4).
func newPurchaseID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		// crypto/rand failure is unrecoverable for id minting.
		panic(fmt.Sprintf("store: crypto/rand unavailable: %v", err))
	}
	return "sp_" + hex.EncodeToString(buf)
}
