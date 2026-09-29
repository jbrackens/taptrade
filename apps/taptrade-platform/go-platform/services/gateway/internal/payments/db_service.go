package payments

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"taptrade/gateway/internal/wallet"
)

const paymentDBTimeout = 5 * time.Second

// depositAutoApprove controls whether deposits are auto-approved without an
// external payment gateway. In production/staging this MUST be false — deposits
// remain "pending" until a webhook confirms them. In development it defaults to
// true so the platform works out-of-the-box without Stripe/Adyen integration.
var depositAutoApprove bool

func init() {
	env := strings.ToLower(strings.TrimSpace(os.Getenv("ENVIRONMENT")))
	if env == "production" || env == "staging" {
		depositAutoApprove = false
	} else {
		depositAutoApprove = strings.ToLower(strings.TrimSpace(os.Getenv("DEPOSIT_AUTO_APPROVE"))) != "false"
	}
}

// DBPaymentService is a production-grade payment service backed by PostgreSQL.
// It implements a proper payment state machine:
//   - Deposits: pending → processing → approved | failed
//   - Withdrawals: pending → processing → processed | failed
//
// Wallet credits/debits happen only on terminal state transitions, not on initiation.
// This prevents money movement before payment confirmation.
type DBPaymentService struct {
	db            *sql.DB
	walletService *wallet.Service
}

// NewDBPaymentService creates a production payment service.
func NewDBPaymentService(db *sql.DB, walletService *wallet.Service) (*DBPaymentService, error) {
	svc := &DBPaymentService{db: db, walletService: walletService}
	if err := svc.ensureSchema(); err != nil {
		return nil, fmt.Errorf("payment schema init: %w", err)
	}
	return svc, nil
}

func (s *DBPaymentService) ensureSchema() error {
	ctx, cancel := context.WithTimeout(context.Background(), paymentDBTimeout)
	defer cancel()

	statements := []string{
		`CREATE TABLE IF NOT EXISTS payment_transactions (
  id BIGSERIAL PRIMARY KEY,
  txn_id TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL,
  txn_type TEXT NOT NULL CHECK (txn_type IN ('deposit','withdrawal')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  payment_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  confirmation_code TEXT,
  error_message TEXT,
  wallet_ledger_entry_id TEXT,
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
)`,
		`CREATE INDEX IF NOT EXISTS idx_payment_txn_user ON payment_transactions (user_id, txn_type, created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_payment_txn_status ON payment_transactions (status)`,
	}

	for _, stmt := range statements {
		if _, err := s.db.ExecContext(ctx, stmt); err != nil {
			return err
		}
	}
	return nil
}

func (s *DBPaymentService) InitiateDeposit(ctx context.Context, userID string, amountCents int64, paymentMethod string) (*DepositResult, error) {
	if userID == "" {
		return nil, ErrInvalidUserID
	}
	if amountCents <= 0 {
		return nil, ErrInvalidAmount
	}
	if paymentMethod == "" {
		return nil, ErrInvalidPaymentMethod
	}

	ctx, cancel := context.WithTimeout(ctx, paymentDBTimeout)
	defer cancel()

	now := time.Now().UTC()
	txnID := fmt.Sprintf("dep:db:%d", now.UnixNano())
	// A client Idempotency-Key makes a retry or double-click return the first
	// deposit (2026-09-29 audit: the key used to embed the current time, so
	// the UNIQUE column never deduplicated anything). Without one, each call
	// is its own deposit, as before.
	idempotencyKey := fmt.Sprintf("deposit:%s:%d:%d", userID, amountCents, now.UnixNano())
	if clientKey := idempotencyKeyFrom(ctx); clientKey != "" {
		idempotencyKey = "deposit:" + userID + ":" + clientKey
	}

	// Create pending deposit transaction
	res, err := s.db.ExecContext(ctx, `
INSERT INTO payment_transactions (txn_id, user_id, txn_type, amount_cents, payment_method, status, idempotency_key)
VALUES ($1, $2, 'deposit', $3, $4, 'pending', $5)
ON CONFLICT (idempotency_key) DO NOTHING`,
		txnID, userID, amountCents, paymentMethod, idempotencyKey)
	if err != nil {
		return nil, fmt.Errorf("create deposit record: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		// Replay of an earlier request: return that deposit as it stands.
		var existing DepositResult
		if err := s.db.QueryRowContext(ctx, `
SELECT txn_id, status, amount_cents, payment_method FROM payment_transactions
 WHERE idempotency_key = $1 AND user_id = $2 AND txn_type = 'deposit'`, idempotencyKey, userID).
			Scan(&existing.TransactionID, &existing.Status, &existing.Amount, &existing.PaymentMethod); err != nil {
			return nil, fmt.Errorf("load replayed deposit: %w", err)
		}
		return &existing, nil
	}

	if !depositAutoApprove {
		// Production: deposit stays pending until external webhook confirms it.
		// The gateway integration calls HandleWebhook() when the provider confirms.
		slog.Info("deposit pending — awaiting external confirmation", "txn_id", txnID, "user_id", userID, "amount_cents", amountCents)
		return &DepositResult{
			TransactionID: txnID,
			Status:        "pending",
			Amount:        amountCents,
			PaymentMethod: paymentMethod,
		}, nil
	}

	// Development only: auto-approve for local testing without payment provider.
	slog.Warn("deposit auto-approved (dev mode)", "txn_id", txnID, "user_id", userID, "amount_cents", amountCents)
	result, err := s.processDepositApproval(ctx, txnID, userID, amountCents, paymentMethod)
	if err != nil {
		_, _ = s.db.ExecContext(ctx, `
UPDATE payment_transactions SET status = 'failed', error_message = $2, updated_at = NOW()
WHERE txn_id = $1`, txnID, err.Error())
		return nil, err
	}

	return result, nil
}

func (s *DBPaymentService) processDepositApproval(ctx context.Context, txnID, userID string, amountCents int64, paymentMethod string) (*DepositResult, error) {
	// Credit wallet with idempotency
	entry, err := s.walletService.Credit(ctx, wallet.MutationRequest{
		UserID:         userID,
		AmountPoints:   amountCents,
		IdempotencyKey: "payment:" + txnID,
		Reason:         fmt.Sprintf("deposit via %s", paymentMethod),
	})
	if err != nil {
		return nil, fmt.Errorf("wallet credit failed: %w", err)
	}

	now := time.Now().UTC()
	confirmCode := fmt.Sprintf("CONF-%s", txnID[4:]) // strip "dep:" prefix

	// Update transaction to approved
	_, err = s.db.ExecContext(ctx, `
UPDATE payment_transactions
SET status = 'approved', confirmation_code = $2, wallet_ledger_entry_id = $3, processed_at = NOW(), updated_at = NOW()
WHERE txn_id = $1`, txnID, confirmCode, entry.EntryID)
	if err != nil {
		slog.Error("deposit approved but failed to update transaction record", "txn_id", txnID, "error", err)
	}

	return &DepositResult{
		TransactionID:    txnID,
		UserID:           userID,
		Amount:           amountCents,
		Status:           "approved",
		PaymentMethod:    paymentMethod,
		CreatedAt:        now.Format(time.RFC3339),
		ProcessedAt:      now.Format(time.RFC3339),
		ConfirmationCode: confirmCode,
	}, nil
}

func (s *DBPaymentService) InitiateWithdrawal(ctx context.Context, userID string, amountCents int64, paymentMethod string) (*WithdrawalResult, error) {
	if userID == "" {
		return nil, ErrInvalidUserID
	}
	if amountCents <= 0 {
		return nil, ErrInvalidAmount
	}
	if paymentMethod == "" {
		return nil, ErrInvalidPaymentMethod
	}

	ctx, cancel := context.WithTimeout(ctx, paymentDBTimeout)
	defer cancel()

	now := time.Now().UTC()
	txnID := fmt.Sprintf("wdr:db:%d", now.UnixNano())

	// Use wallet reservation to hold funds (instead of direct debit)
	reservation, err := s.walletService.Hold(ctx, wallet.HoldRequest{
		UserID:        userID,
		AmountPoints:  amountCents,
		ReferenceType: "withdrawal",
		ReferenceID:   txnID,
		ExpiresIn:     24 * time.Hour, // withdrawal holds last 24h
	})
	if err != nil {
		if errors.Is(err, wallet.ErrInsufficientFunds) {
			return nil, ErrInsufficientFunds
		}
		return nil, fmt.Errorf("failed to hold funds: %w", err)
	}

	_, err = s.db.ExecContext(ctx, `
INSERT INTO payment_transactions (txn_id, user_id, txn_type, amount_cents, payment_method, status, idempotency_key)
VALUES ($1, $2, 'withdrawal', $3, $4, 'pending', $5)`,
		txnID, userID, amountCents, paymentMethod, reservation.ID)
	if err != nil {
		// Release the hold if we can't record the transaction
		_ = s.walletService.Release(ctx, reservation.ReferenceType, reservation.ReferenceID)
		return nil, fmt.Errorf("create withdrawal record: %w", err)
	}

	slog.Info("withdrawal initiated", "txn_id", txnID, "user_id", userID, "amount_cents", amountCents, "reservation", reservation.ID)

	return &WithdrawalResult{
		TransactionID: txnID,
		UserID:        userID,
		Amount:        amountCents,
		Status:        "pending",
		PaymentMethod: paymentMethod,
		CreatedAt:     now.Format(time.RFC3339),
		EstimatedAt:   now.Add(2 * time.Hour).Format(time.RFC3339),
	}, nil
}

// CumulativeWithdrawnCents sums the user's committed withdrawals on every
// rail (CrossRailWithdrawnCents) for the KYC just-in-time threshold. A
// pending withdrawal still counts — it represents committed cash-out intent
// for AML purposes.
func (s *DBPaymentService) CumulativeWithdrawnCents(ctx context.Context, userID string) (int64, error) {
	if userID == "" {
		return 0, ErrInvalidUserID
	}
	ctx, cancel := context.WithTimeout(ctx, paymentDBTimeout)
	defer cancel()

	return CrossRailWithdrawnCents(ctx, s.db, userID)
}

// InitiateGatedWithdrawal serializes (cumulative-sum → gate decision →
// withdrawal record) per user via a Postgres transaction-scoped advisory
// lock, so concurrent withdrawals cannot each pass a threshold check and
// then all insert (D-9 TOCTOU). Correct across multiple gateway instances —
// pg_advisory_xact_lock is cluster-wide and auto-releases on commit/rollback.
func (s *DBPaymentService) InitiateGatedWithdrawal(ctx context.Context, userID string, amountCents int64, paymentMethod string, gate func(cumulativeWithdrawnCents int64) error) (*WithdrawalResult, error) {
	if userID == "" {
		return nil, ErrInvalidUserID
	}
	if amountCents <= 0 {
		return nil, ErrInvalidAmount
	}
	if paymentMethod == "" {
		return nil, ErrInvalidPaymentMethod
	}

	ctx, cancel := context.WithTimeout(ctx, paymentDBTimeout)
	defer cancel()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin gated withdrawal tx: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	// Per-user lock for the tx duration: serializes the sum→decide→insert
	// critical section against other concurrent withdrawals for this user.
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, userID); err != nil {
		return nil, fmt.Errorf("acquire withdrawal lock: %w", err)
	}

	cumulative, err := CrossRailWithdrawnCents(ctx, tx, userID)
	if err != nil {
		return nil, err
	}

	// Gate decision under the lock. A non-nil error aborts with exactly
	// that error — no wallet hold, no record.
	if gate != nil {
		if gerr := gate(cumulative); gerr != nil {
			return nil, gerr
		}
	}

	now := time.Now().UTC()
	txnID := fmt.Sprintf("wdr:db:%d", now.UnixNano())

	// Hold funds, then record the pending withdrawal on the tx so the row
	// is covered by the advisory lock and visible to the next serialized
	// caller once committed.
	reservation, err := s.walletService.Hold(ctx, wallet.HoldRequest{
		UserID:        userID,
		AmountPoints:  amountCents,
		ReferenceType: "withdrawal",
		ReferenceID:   txnID,
		ExpiresIn:     24 * time.Hour,
	})
	if err != nil {
		if errors.Is(err, wallet.ErrInsufficientFunds) {
			return nil, ErrInsufficientFunds
		}
		return nil, fmt.Errorf("failed to hold funds: %w", err)
	}

	if _, err = tx.ExecContext(ctx, `
INSERT INTO payment_transactions (txn_id, user_id, txn_type, amount_cents, payment_method, status, idempotency_key)
VALUES ($1, $2, 'withdrawal', $3, $4, 'pending', $5)`,
		txnID, userID, amountCents, paymentMethod, reservation.ID); err != nil {
		_ = s.walletService.Release(ctx, reservation.ReferenceType, reservation.ReferenceID)
		return nil, fmt.Errorf("create withdrawal record: %w", err)
	}

	if err = tx.Commit(); err != nil {
		_ = s.walletService.Release(ctx, reservation.ReferenceType, reservation.ReferenceID)
		return nil, fmt.Errorf("commit gated withdrawal: %w", err)
	}
	committed = true

	slog.Info("gated withdrawal initiated", "txn_id", txnID, "user_id", userID, "amount_cents", amountCents, "reservation", reservation.ID)
	return &WithdrawalResult{
		TransactionID: txnID,
		UserID:        userID,
		Amount:        amountCents,
		Status:        "pending",
		PaymentMethod: paymentMethod,
		CreatedAt:     now.Format(time.RFC3339),
		EstimatedAt:   now.Add(2 * time.Hour).Format(time.RFC3339),
	}, nil
}

func (s *DBPaymentService) GetPaymentMethods(ctx context.Context, userID string) ([]PaymentMethod, error) {
	if userID == "" {
		return nil, ErrInvalidUserID
	}

	// Default payment methods (in production, these would come from a payment vault)
	return []PaymentMethod{
		{
			ID:        "cc:default",
			Type:      "credit_card",
			Label:     "Credit/Debit Card",
			IsActive:  true,
			IsDefault: true,
			CreatedAt: time.Now().UTC().Format(time.RFC3339),
		},
		{
			ID:        "bank:default",
			Type:      "bank_transfer",
			Label:     "Bank Transfer",
			IsActive:  true,
			CreatedAt: time.Now().UTC().Format(time.RFC3339),
		},
	}, nil
}

func (s *DBPaymentService) GetTransactionStatus(ctx context.Context, txnID string) (*TransactionStatus, error) {
	if txnID == "" {
		return nil, ErrTransactionNotFound
	}

	ctx, cancel := context.WithTimeout(ctx, paymentDBTimeout)
	defer cancel()

	var txn TransactionStatus
	var processedAt sql.NullString
	var confirmCode sql.NullString
	var errorMsg sql.NullString

	err := s.db.QueryRowContext(ctx, `
SELECT txn_id, user_id, txn_type, amount_cents, status, payment_method,
       CAST(created_at AS TEXT), CAST(updated_at AS TEXT),
       CAST(processed_at AS TEXT), confirmation_code, error_message
FROM payment_transactions
WHERE txn_id = $1`, txnID).Scan(
		&txn.TransactionID, &txn.UserID, &txn.Type, &txn.Amount,
		&txn.Status, &txn.PaymentMethod, &txn.CreatedAt, &txn.UpdatedAt,
		&processedAt, &confirmCode, &errorMsg)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrTransactionNotFound
		}
		return nil, err
	}
	if processedAt.Valid {
		txn.ProcessedAt = processedAt.String
	}
	if confirmCode.Valid {
		txn.ConfirmationCode = confirmCode.String
	}
	if errorMsg.Valid {
		txn.ErrorMessage = errorMsg.String
	}
	return &txn, nil
}

func (s *DBPaymentService) HandleWebhook(ctx context.Context, payload WebhookPayload) error {
	if payload.TransactionID == "" {
		return ErrTransactionNotFound
	}

	ctx, cancel := context.WithTimeout(ctx, paymentDBTimeout)
	defer cancel()

	// MEDIUM #17: the row lock, the amount/identity reconciliation, the wallet
	// move, and the status update all run in ONE transaction. Previously the
	// SELECT ... FOR UPDATE ran on the bare *sql.DB, so its row lock was
	// released the instant that statement returned — the subsequent wallet op
	// and status write were unprotected, allowing concurrent webhooks to race
	// (double-credit / double-capture). A single BeginTx keeps the lock held
	// across the whole critical section and makes the money move + status flip
	// commit or roll back together.
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin webhook tx: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	// Look up + lock the transaction for the duration of this tx.
	var txnType, currentStatus, userID string
	var amountCents int64
	var paymentMethod string
	if err := tx.QueryRowContext(ctx, `
SELECT txn_type, status, user_id, amount_cents, payment_method
FROM payment_transactions
WHERE txn_id = $1 FOR UPDATE`, payload.TransactionID).Scan(
		&txnType, &currentStatus, &userID, &amountCents, &paymentMethod); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrTransactionNotFound
		}
		return err
	}

	// Amount/identity reconciliation against the locked row before any money
	// moves (MEDIUM #17). WebhookPayload carries Amount (amountCents) and
	// UserID, so when the provider populates them they MUST match the recorded
	// transaction — a mismatch means the webhook references a different amount
	// or user than we booked, and we refuse rather than move funds. Zero/empty
	// values are treated as "not asserted" for backward compatibility with
	// providers that omit them (the webhook signature is verified upstream).
	if payload.Amount > 0 && payload.Amount != amountCents {
		slog.Error("webhook amount mismatch — refusing to move funds",
			"txn_id", payload.TransactionID, "webhook_amount", payload.Amount, "record_amount", amountCents)
		return fmt.Errorf("%w: amount webhook=%d record=%d", ErrWebhookMismatch, payload.Amount, amountCents)
	}
	if strings.TrimSpace(payload.UserID) != "" && payload.UserID != userID {
		slog.Error("webhook user mismatch — refusing to move funds",
			"txn_id", payload.TransactionID, "webhook_user", payload.UserID, "record_user", userID)
		return fmt.Errorf("%w: user webhook=%s record=%s", ErrWebhookMismatch, payload.UserID, userID)
	}

	// Process based on event type
	switch strings.ToLower(payload.Status) {
	case "approved", "completed", "processed":
		if !canApplyWebhookTransition(currentStatus) {
			slog.Info("ignoring duplicate or stale successful webhook", "txn_id", payload.TransactionID, "current_status", currentStatus, "incoming_status", payload.Status)
			return nil
		}
		if txnType == "deposit" && currentStatus == "pending" {
			// Credit the wallet inside the tx, then flip the row to approved in
			// the same tx (idempotent by key: a replay returns the same entry).
			entry, err := s.walletService.CreditWithTx(ctx, tx, wallet.MutationRequest{
				UserID:         userID,
				AmountPoints:   amountCents,
				IdempotencyKey: "payment:" + payload.TransactionID,
				Reason:         fmt.Sprintf("deposit via %s", paymentMethod),
			})
			if err != nil {
				return fmt.Errorf("wallet credit failed: %w", err)
			}
			confirmCode := fmt.Sprintf("CONF-%s", payload.TransactionID[4:]) // strip "dep:" prefix
			if _, err := tx.ExecContext(ctx, `
UPDATE payment_transactions
SET status = 'approved', confirmation_code = $2, wallet_ledger_entry_id = $3, processed_at = NOW(), updated_at = NOW()
WHERE txn_id = $1`, payload.TransactionID, confirmCode, entry.EntryID); err != nil {
				return fmt.Errorf("mark deposit approved: %w", err)
			}
		}
		if txnType == "withdrawal" && currentStatus == "pending" {
			// Capture the full held reservation inside the tx.
			if _, captureErr := s.walletService.CaptureReservationWithTx(ctx, tx, "withdrawal", payload.TransactionID, amountCents, "capture:withdrawal:"+payload.TransactionID); captureErr != nil {
				slog.Error("withdrawal capture failed", "txn_id", payload.TransactionID, "error", captureErr)
				return fmt.Errorf("capture withdrawal hold: %w", captureErr)
			}
			if _, err := tx.ExecContext(ctx, `
UPDATE payment_transactions SET status = 'processed', processed_at = NOW(), updated_at = NOW()
WHERE txn_id = $1`, payload.TransactionID); err != nil {
				return fmt.Errorf("mark withdrawal processed: %w", err)
			}
		}

	case "failed", "declined":
		if !canApplyWebhookTransition(currentStatus) {
			slog.Info("ignoring duplicate or stale failed webhook", "txn_id", payload.TransactionID, "current_status", currentStatus, "incoming_status", payload.Status)
			return nil
		}
		if txnType == "withdrawal" && currentStatus == "pending" {
			// Release the hold inside the tx.
			if err := s.walletService.ReleaseReservationWithTx(ctx, tx, "withdrawal", payload.TransactionID); err != nil {
				return fmt.Errorf("release withdrawal hold: %w", err)
			}
		}
		if _, err := tx.ExecContext(ctx, `
UPDATE payment_transactions SET status = $2, error_message = $3, updated_at = NOW()
WHERE txn_id = $1`, payload.TransactionID, payload.Status, payload.Data["error"]); err != nil {
			return fmt.Errorf("mark payment failed: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit webhook tx: %w", err)
	}
	committed = true

	slog.Info("webhook processed", "txn_id", payload.TransactionID, "event", payload.EventType, "status", payload.Status)
	return nil
}

func canApplyWebhookTransition(currentStatus string) bool {
	return strings.EqualFold(strings.TrimSpace(currentStatus), "pending")
}

// rowQuerier is satisfied by *sql.DB and *sql.Tx.
type rowQuerier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// CrossRailWithdrawnCents is the user's committed cash-out across every rail:
// legacy payment withdrawals that did not fail or get cancelled, plus alpha
// cashier withdrawal requests that were not rejected, failed or cancelled.
// One definition, used by both rails' KYC gates (2026-09-29 audit: each rail
// used to count only its own withdrawals). A rail's table is summed only if
// it exists (payment_transactions is created lazily by this package,
// alpha_withdrawal_requests by migration 030); existence is checked first
// because Postgres resolves every table a statement names at plan time.
func CrossRailWithdrawnCents(ctx context.Context, q rowQuerier, userID string) (int64, error) {
	if userID == "" {
		return 0, ErrInvalidUserID
	}
	var hasPayments, hasAlpha bool
	if err := q.QueryRowContext(ctx, `
SELECT to_regclass('payment_transactions') IS NOT NULL,
       to_regclass('alpha_withdrawal_requests') IS NOT NULL`).Scan(&hasPayments, &hasAlpha); err != nil {
		return 0, fmt.Errorf("check withdrawal tables: %w", err)
	}
	var total int64
	if hasPayments {
		var n int64
		if err := q.QueryRowContext(ctx, `
SELECT COALESCE(SUM(amount_cents), 0) FROM payment_transactions
 WHERE user_id = $1 AND txn_type = 'withdrawal' AND status NOT IN ('failed','cancelled')`, userID).Scan(&n); err != nil {
			return 0, fmt.Errorf("sum payment withdrawals: %w", err)
		}
		total += n
	}
	if hasAlpha {
		var n int64
		if err := q.QueryRowContext(ctx, `
SELECT COALESCE(SUM(amount_cents), 0) FROM alpha_withdrawal_requests
 WHERE user_id = $1 AND status NOT IN ('rejected','failed','cancelled')`, userID).Scan(&n); err != nil {
			return 0, fmt.Errorf("sum alpha withdrawals: %w", err)
		}
		total += n
	}
	return total, nil
}
