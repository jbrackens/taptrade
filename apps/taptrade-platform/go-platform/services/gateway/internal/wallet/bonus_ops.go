package wallet

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

var (
	ErrInsufficientBonusFunds = errors.New("insufficient bonus funds")
	ErrBonusNotActive         = errors.New("player bonus is not active")
)

// DebitBonus deducts from the user's bonus balance. Symmetric to CreditBonus.
// Used by: bonus forfeiture and bonus expiry.
func (s *Service) DebitBonus(ctx context.Context, request MutationRequest) (LedgerEntry, error) {
	if s.db == nil {
		// In memory mode, bonus funds live in regular balance
		return s.applyMutationMemory("debit", request)
	}
	return s.applyBonusDebitDB(ctx, request)
}

func (s *Service) applyBonusDebitDB(ctx context.Context, request MutationRequest) (LedgerEntry, error) {
	if request.UserID == "" || request.AmountPoints <= 0 || request.IdempotencyKey == "" {
		return LedgerEntry{}, ErrInvalidMutationRequest
	}

	ctx, cancel := context.WithTimeout(ctx, walletDBTimeout)
	defer cancel()

	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return LedgerEntry{}, err
	}
	defer func() { _ = tx.Rollback() }()

	// Idempotency check
	existing, found, err := findExistingMutation(ctx, tx, "debit:bonus", request.UserID, request.IdempotencyKey)
	if err != nil {
		return LedgerEntry{}, err
	}
	if found {
		if existing.AmountPoints != request.AmountPoints {
			return LedgerEntry{}, ErrIdempotencyConflict
		}
		return existing, nil
	}

	var bonusBalance int64
	if err := tx.QueryRowContext(ctx, `
SELECT bonus_balance_points FROM wallet_balances WHERE user_id = $1 FOR UPDATE`,
		request.UserID).Scan(&bonusBalance); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return LedgerEntry{}, ErrInsufficientBonusFunds
		}
		return LedgerEntry{}, err
	}

	if bonusBalance < request.AmountPoints {
		return LedgerEntry{}, ErrInsufficientBonusFunds
	}

	bonusBalance -= request.AmountPoints

	if _, err := tx.ExecContext(ctx, `
UPDATE wallet_balances SET bonus_balance_points = $2, updated_at = NOW() WHERE user_id = $1`,
		request.UserID, bonusBalance); err != nil {
		return LedgerEntry{}, err
	}

	var id int64
	var transactionTime string
	err = tx.QueryRowContext(ctx, `
INSERT INTO wallet_ledger (user_id, entry_type, fund_type, amount_points, balance_points, idempotency_key, reason, transaction_time)
VALUES ($1, 'debit', 'bonus', $2, $3, $4, $5, NOW())
RETURNING id, CAST(transaction_time AS TEXT)`,
		request.UserID, request.AmountPoints, bonusBalance,
		request.IdempotencyKey, normalizeReason(request.Reason)).Scan(&id, &transactionTime)
	if err != nil {
		return LedgerEntry{}, err
	}

	if err := tx.Commit(); err != nil {
		return LedgerEntry{}, err
	}

	return LedgerEntry{
		EntryID:         fmt.Sprintf("le:%d", id),
		UserID:          request.UserID,
		Type:            "debit",
		AmountPoints:    request.AmountPoints,
		BalancePoints:   bonusBalance,
		IdempotencyKey:  request.IdempotencyKey,
		Reason:          request.Reason,
		TransactionTime: transactionTime,
	}, nil
}

// ForfeitBonus zeroes the bonus-attributable amount for a user. Called on
// bonus expiry or admin forfeiture. The amount forfeited is capped at the
// current bonus balance to handle partial consumption.
func (s *Service) ForfeitBonus(ctx context.Context, userID string, amountPoints int64, reason string, idempotencyKey string) (LedgerEntry, error) {
	if s.db == nil {
		return LedgerEntry{}, nil
	}
	if userID == "" || amountPoints <= 0 || idempotencyKey == "" {
		return LedgerEntry{}, ErrInvalidMutationRequest
	}

	// Cap at actual bonus balance
	breakdown := s.BalanceWithBreakdown(ctx, userID)
	forfeitAmount := amountPoints
	if forfeitAmount > breakdown.BonusFundPoints {
		forfeitAmount = breakdown.BonusFundPoints
	}
	if forfeitAmount <= 0 {
		return LedgerEntry{}, nil
	}

	return s.DebitBonus(ctx, MutationRequest{
		UserID:         userID,
		AmountPoints:   forfeitAmount,
		IdempotencyKey: idempotencyKey,
		Reason:         reason,
	})
}

func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}
