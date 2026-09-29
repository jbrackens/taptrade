package payments

import (
	"context"
	"errors"
	"strings"
)

var (
	ErrInvalidUserID        = errors.New("invalid user id")
	ErrInvalidAmount        = errors.New("invalid amount")
	ErrInvalidPaymentMethod = errors.New("invalid payment method")
	ErrTransactionNotFound  = errors.New("transaction not found")
	ErrInsufficientFunds    = errors.New("insufficient funds")
	ErrWithdrawalFailed     = errors.New("withdrawal failed")
	ErrDepositFailed        = errors.New("deposit failed")
	// ErrWebhookMismatch is returned when a webhook's asserted amount/user does
	// not match the locked payment row before any money is moved (MEDIUM #17).
	ErrWebhookMismatch = errors.New("webhook amount/user does not match transaction record")
)

// PaymentService defines the interface for payment operations
type PaymentService interface {
	// InitiateDeposit initiates a deposit transaction
	InitiateDeposit(ctx context.Context, userID string, amountCents int64, paymentMethod string) (*DepositResult, error)

	// InitiateWithdrawal initiates a withdrawal transaction
	InitiateWithdrawal(ctx context.Context, userID string, amountCents int64, paymentMethod string) (*WithdrawalResult, error)

	// CumulativeWithdrawnCents returns the user's total withdrawn amount
	// (pending + completed, excluding failed/cancelled) across all time.
	// Used by the KYC just-in-time gate to decide when cumulative cash-out
	// crosses the verification threshold.
	CumulativeWithdrawnCents(ctx context.Context, userID string) (int64, error)

	// InitiateGatedWithdrawal performs the cumulative-cash-out gate decision
	// and the withdrawal record atomically under a per-user lock, closing
	// the D-9 TOCTOU: without serialization, N concurrent withdrawals could
	// each read the same prior cumulative, each pass a threshold check, and
	// then all insert — crossing the KYC threshold unverified. gate is
	// invoked with the user's current cumulative non-failed/cancelled
	// withdrawal total *while the per-user lock is held*; a non-nil return
	// aborts the withdrawal with exactly that error (no record, no hold).
	InitiateGatedWithdrawal(ctx context.Context, userID string, amountCents int64, paymentMethod string, gate func(cumulativeWithdrawnCents int64) error) (*WithdrawalResult, error)

	// GetPaymentMethods returns available payment methods for a user
	GetPaymentMethods(ctx context.Context, userID string) ([]PaymentMethod, error)

	// GetTransactionStatus returns the status of a specific transaction
	GetTransactionStatus(ctx context.Context, txnID string) (*TransactionStatus, error)

	// HandleWebhook processes a webhook from the payment gateway
	HandleWebhook(ctx context.Context, payload WebhookPayload) error
}

type idempotencyKeyCtxKey struct{}

// WithIdempotencyKey attaches a client-supplied Idempotency-Key (the HTTP
// header) to a deposit request's context.
func WithIdempotencyKey(ctx context.Context, key string) context.Context {
	return context.WithValue(ctx, idempotencyKeyCtxKey{}, strings.TrimSpace(key))
}

func idempotencyKeyFrom(ctx context.Context) string {
	key, _ := ctx.Value(idempotencyKeyCtxKey{}).(string)
	return key
}
