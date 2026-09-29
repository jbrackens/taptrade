package alphacashier

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"math/big"
	"strings"
	"sync/atomic"
	"time"

	"taptrade/gateway/internal/wallet"

	"github.com/ethereum/go-ethereum/common"
	"github.com/google/uuid"
)

// auditWriteFailures counts alpha-cashier audit-log persistence failures
// (audit CMP-02/03 / LOW #22). A nonzero value means a money-path audit entry
// failed to durably persist — the money op still succeeded (audit is never on
// the critical path), but the compliance trail silently degraded to a log line,
// so this is surfaced on /metrics to drive an alert.
var auditWriteFailures atomic.Int64

// AuditWriteFailures returns the cumulative count of dropped audit writes.
func AuditWriteFailures() int64 { return auditWriteFailures.Load() }

const (
	defaultChallengeTTL      = 10 * time.Minute
	defaultIntentTTL         = 30 * time.Minute
	defaultAdminListLimit    = 100
	maxAdminListLimit        = 500
	withdrawalReservationTTL = 7 * 24 * time.Hour
	withdrawalReferenceType  = "alpha_withdrawal"
	// reorgFreezeTTL is long: a reorg-frozen balance stays held until a human
	// resolves it (audit A2-03). Re-asserted idempotently by the watcher, so a
	// still-unresolved freeze is renewed well before this elapses.
	reorgFreezeTTL = 30 * 24 * time.Hour
)

type Service struct {
	cfg          Config
	repo         Repository
	ledger       WalletLedger
	evmClient    EVMClient
	screener     AddressScreener
	now          func() time.Time
	challengeTTL time.Duration
	intentTTL    time.Duration
	// withdrawalGate is the KYC just-in-time check across every cash-out
	// rail (set by the HTTP layer; nil = no gate, e.g. memory mode).
	withdrawalGate func(ctx context.Context, userID string, amountCents int64) error
}

type WalletLedger interface {
	Credit(ctx context.Context, request wallet.MutationRequest) (wallet.LedgerEntry, error)
	// CreditWithTx applies a credit inside the caller's transaction so the
	// deposit credit + intent status update commit atomically (HIGH #9).
	CreditWithTx(ctx context.Context, tx *sql.Tx, request wallet.MutationRequest) (wallet.LedgerEntry, error)
	Hold(ctx context.Context, request wallet.HoldRequest) (wallet.Reservation, error)
	Release(ctx context.Context, referenceType, referenceID string) error
	Capture(ctx context.Context, referenceType, referenceID string) (wallet.LedgerEntry, error)
	// DB exposes the underlying *sql.DB for atomic multi-step operations, or
	// nil in memory mode (callers must fall back to the non-tx path).
	DB() *sql.DB
}

func NewService(cfg Config, repo Repository) *Service {
	return &Service{
		cfg:          cfg,
		repo:         repo,
		now:          time.Now,
		challengeTTL: defaultChallengeTTL,
		intentTTL:    defaultIntentTTL,
	}
}

func (s *Service) SetWalletLedger(ledger WalletLedger) {
	s.ledger = ledger
}

// SetWithdrawalGate installs the cross-rail KYC just-in-time check a new
// withdrawal must pass (2026-09-29 audit: the legacy payments rail had one,
// this rail had none, so a threshold could be split between them).
func (s *Service) SetWithdrawalGate(gate func(ctx context.Context, userID string, amountCents int64) error) {
	s.withdrawalGate = gate
}

func (s *Service) SetEVMClient(client EVMClient) {
	s.evmClient = client
}

func (s *Service) Config() Config {
	return s.cfg
}

func (s *Service) CreateWalletChallenge(ctx context.Context, userID string, walletAddress string) (*WalletChallenge, error) {
	if err := s.requireEnabled(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(userID) == "" {
		return nil, ErrWalletNotConnected
	}
	normalized, err := NormalizeAddress(walletAddress)
	if err != nil {
		return nil, err
	}
	nonce, err := NewNonce()
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	expiresAt := now.Add(s.challengeTTL)
	challenge := WalletChallenge{
		Nonce:         nonce,
		UserID:        userID,
		ChainID:       s.cfg.ChainID,
		WalletAddress: common.HexToAddress(normalized).Hex(),
		ExpiresAt:     expiresAt,
		CreatedAt:     now,
	}
	challenge.Message = BuildWalletChallengeMessage(s.cfg.ChallengeDomain(), userID, challenge.WalletAddress, s.cfg.ChainID, nonce, now, expiresAt)
	if err := s.repo.SaveWalletChallenge(ctx, challenge); err != nil {
		return nil, err
	}
	s.auditOrLog(ctx, "wallet_challenge", nonce, "alpha_cashier.wallet.challenge_created", "user", userID, map[string]any{
		"userId":        userID,
		"chainId":       s.cfg.ChainID,
		"walletAddress": challenge.WalletAddress,
		"expiresAt":     expiresAt.Format(time.RFC3339),
	})
	return &challenge, nil
}

func (s *Service) ConnectWallet(ctx context.Context, userID string, nonce string, signature string) (*WalletConnection, error) {
	if err := s.requireEnabled(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(userID) == "" {
		return nil, ErrWalletNotConnected
	}
	challenge, err := s.repo.GetWalletChallenge(ctx, strings.TrimSpace(nonce))
	if err != nil {
		return nil, err
	}
	if challenge.UserID != userID {
		return nil, ErrChallengeNotFound
	}
	if challenge.ConsumedAt != nil {
		return nil, ErrChallengeConsumed
	}
	now := s.now().UTC()
	if !now.Before(challenge.ExpiresAt) {
		return nil, ErrChallengeExpired
	}
	if err := VerifyPersonalSignature(challenge.Message, signature, challenge.WalletAddress); err != nil {
		return nil, err
	}
	normalized, err := NormalizeAddress(challenge.WalletAddress)
	if err != nil {
		return nil, err
	}
	if err := s.repo.ConsumeWalletChallenge(ctx, challenge.Nonce, now); err != nil {
		return nil, err
	}
	conn := WalletConnection{
		UserID:            userID,
		ChainType:         "evm",
		ChainID:           challenge.ChainID,
		WalletAddress:     common.HexToAddress(challenge.WalletAddress).Hex(),
		NormalizedAddress: normalized,
		Signature:         signature,
		Message:           challenge.Message,
		Nonce:             challenge.Nonce,
		VerifiedAt:        now,
		LastSeenAt:        now,
		CreatedAt:         now,
	}
	saved, err := s.repo.UpsertWalletConnection(ctx, conn)
	if err != nil {
		return nil, err
	}
	s.auditOrLog(ctx, "wallet_connection", saved.ID, "alpha_cashier.wallet.connected", "user", userID, map[string]any{
		"userId":        userID,
		"chainId":       saved.ChainID,
		"walletAddress": saved.WalletAddress,
	})
	return saved, nil
}

func (s *Service) ListWalletConnections(ctx context.Context, userID string) ([]WalletConnection, error) {
	if err := s.requireEnabled(); err != nil {
		return nil, err
	}
	return s.repo.ListWalletConnections(ctx, userID)
}

func (s *Service) CreateDepositIntent(ctx context.Context, userID string, walletAddress string, amountCents int64, idempotencyKey string) (*DepositIntent, error) {
	if err := s.requireEnabled(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(userID) == "" {
		return nil, ErrWalletNotConnected
	}
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if idempotencyKey == "" {
		return nil, ErrInvalidIdempotencyKey
	}
	// One money operation per user at a time (2026-09-29 audit): the
	// idempotency lookup, the daily-limit sum and the insert must not
	// interleave with a concurrent request, or two requests both pass the
	// daily limit, or both miss each other's idempotency key.
	unlock, err := s.repo.LockUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	defer unlock()
	if existing, err := s.repo.FindDepositIntentByIdempotencyKey(ctx, userID, idempotencyKey); err != nil {
		return nil, err
	} else if existing != nil {
		return existing, nil
	}
	if amountCents < s.cfg.MinDepositCents || amountCents > s.cfg.MaxDepositCents {
		return nil, ErrInvalidAmount
	}
	normalized, err := NormalizeAddress(walletAddress)
	if err != nil {
		return nil, err
	}
	// Sanctions/AML screening on the depositing wallet before an intent is
	// created (audit CMP-01).
	if err := s.screenAddress(ctx, userID, normalized, "deposit_from"); err != nil {
		return nil, err
	}
	conn, err := s.repo.FindWalletConnection(ctx, userID, s.cfg.ChainID, normalized)
	if err != nil {
		return nil, err
	}
	since := s.now().UTC().Add(-24 * time.Hour)
	total, err := s.repo.SumUserDepositIntentCentsSince(ctx, userID, since)
	if err != nil {
		return nil, err
	}
	if total+amountCents > s.cfg.DailyDepositLimitCents {
		return nil, ErrInvalidAmount
	}
	units, err := CentsToTokenUnits(amountCents, s.cfg.TokenDecimals)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	intent := DepositIntent{
		UserID:             userID,
		WalletConnectionID: conn.ID,
		ChainID:            s.cfg.ChainID,
		ChainName:          s.cfg.ChainName,
		TokenSymbol:        s.cfg.TokenSymbol,
		TokenAddress:       common.HexToAddress(s.cfg.TokenAddress).Hex(),
		TokenDecimals:      s.cfg.TokenDecimals,
		TreasuryAddress:    common.HexToAddress(s.cfg.TreasuryAddress).Hex(),
		FromAddress:        conn.WalletAddress,
		AmountCents:        amountCents,
		AmountUnits:        units.String(),
		Status:             "created",
		IdempotencyKey:     idempotencyKey,
		ExpiresAt:          now.Add(s.intentTTL),
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	saved, err := s.repo.SaveDepositIntent(ctx, intent)
	if err != nil {
		return nil, err
	}
	s.auditOrLog(ctx, "deposit_intent", saved.ID, "alpha_cashier.deposit_intent.created", "user", userID, map[string]any{
		"userId":       userID,
		"chainId":      saved.ChainID,
		"amountCents":  saved.AmountCents,
		"amountUnits":  saved.AmountUnits,
		"fromAddress":  saved.FromAddress,
		"treasury":     saved.TreasuryAddress,
		"tokenAddress": saved.TokenAddress,
	})
	return saved, nil
}

func (s *Service) GetDepositIntent(ctx context.Context, userID string, id string) (*DepositIntent, error) {
	if err := s.requireEnabled(); err != nil {
		return nil, err
	}
	intent, err := s.repo.GetDepositIntent(ctx, id)
	if err != nil {
		return nil, err
	}
	if intent == nil || intent.UserID != userID {
		return nil, nil
	}
	return intent, nil
}

func (s *Service) ListDepositIntents(ctx context.Context, userID string) ([]DepositIntent, error) {
	if err := s.requireEnabled(); err != nil {
		return nil, err
	}
	return s.repo.ListDepositIntents(ctx, userID)
}

func (s *Service) ListAdminDepositIntents(ctx context.Context, filter DepositIntentFilter) ([]DepositIntent, error) {
	if err := s.requireEnabled(); err != nil {
		return nil, err
	}
	filter.Status = strings.TrimSpace(filter.Status)
	filter.UserID = strings.TrimSpace(filter.UserID)
	filter.TxHash = strings.TrimSpace(filter.TxHash)
	filter.Limit = normalizeAdminListLimit(filter.Limit)
	if filter.Status != "" && !validDepositStatus(filter.Status) {
		return nil, ErrInvalidStatus
	}
	return s.repo.ListAdminDepositIntents(ctx, filter)
}

func (s *Service) SubmitDepositTx(ctx context.Context, userID string, id string, txHash string) (*DepositIntent, error) {
	if err := s.requireEnabled(); err != nil {
		return nil, err
	}
	if s.evmClient == nil {
		return nil, ErrTxVerificationMissing
	}
	if s.ledger == nil {
		return nil, ErrWalletLedgerMissing
	}
	intent, err := s.repo.GetDepositIntent(ctx, id)
	if err != nil {
		return nil, err
	}
	if intent == nil || intent.UserID != userID {
		return nil, nil
	}
	if intent.Status == "credited" {
		return intent, nil
	}
	now := s.now().UTC()
	if now.After(intent.ExpiresAt) {
		return nil, ErrDepositExpired
	}
	txHash = strings.TrimSpace(txHash)
	if intent.TxHash != "" && !strings.EqualFold(intent.TxHash, txHash) {
		return nil, ErrTxHashInvalid
	}
	submitted, err := s.repo.MarkDepositSubmitted(ctx, intent.ID, txHash, now)
	if err != nil {
		return nil, err
	}
	if submitted == nil {
		return nil, nil
	}
	// Re-screen the depositing wallet at submit time (audit CMP-01): screening
	// only at intent creation is insufficient — a wallet can be listed between
	// intent and the on-chain transfer that actually moves funds. No-op when no
	// screener is configured.
	if err := s.screenAddress(ctx, submitted.UserID, submitted.FromAddress, "deposit_from_submit"); err != nil {
		return nil, err
	}
	evidence, err := VerifyERC20Transfer(ctx, s.evmClient, TransferExpectation{
		ChainID:               submitted.ChainID,
		TxHash:                txHash,
		TokenAddress:          submitted.TokenAddress,
		FromAddress:           submitted.FromAddress,
		ToAddress:             submitted.TreasuryAddress,
		AmountUnits:           submitted.AmountUnits,
		RequiredConfirmations: s.cfg.Confirmations,
	})
	if err != nil {
		return nil, err
	}
	evidence.DepositIntentID = submitted.ID
	evidence.CreatedAt = now
	if err := s.repo.RecordChainTransaction(ctx, *evidence); err != nil {
		return nil, err
	}
	mutation := wallet.MutationRequest{
		UserID:         submitted.UserID,
		AmountPoints:   submitted.AmountCents,
		IdempotencyKey: "alpha-cashier:deposit:" + strconv64(evidence.ChainID) + ":" + strings.ToLower(evidence.TxHash) + ":" + strconv64(int64(evidence.LogIndex)),
		Reason:         "alpha USDC deposit " + strconv64(evidence.ChainID) + "/" + strings.ToLower(evidence.TxHash),
	}
	// HIGH #9: credit the wallet and mark the intent credited in ONE DB tx so a
	// crash between them can never leave a credited balance with the intent
	// stuck on 'submitted' (or vice versa). The wallet credit is idempotent by
	// key, so a replay returns the same entry without double-crediting. In
	// memory mode (DB() == nil) there is no real tx, so fall back to the
	// sequential path the tests exercise.
	var entry wallet.LedgerEntry
	var credited *DepositIntent
	if db := s.ledger.DB(); db != nil {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return nil, err
		}
		committed := false
		defer func() {
			if !committed {
				_ = tx.Rollback()
			}
		}()
		entry, err = s.ledger.CreditWithTx(ctx, tx, mutation)
		if err != nil {
			return nil, err
		}
		credited, err = s.repo.MarkDepositCreditedTx(ctx, tx, submitted.ID, entry.EntryID, now, now)
		if err != nil {
			return nil, err
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		committed = true
	} else {
		entry, err = s.ledger.Credit(ctx, mutation)
		if err != nil {
			return nil, err
		}
		credited, err = s.repo.MarkDepositCredited(ctx, submitted.ID, entry.EntryID, now, now)
		if err != nil {
			return nil, err
		}
	}
	s.auditOrLog(ctx, "deposit_intent", submitted.ID, "alpha_cashier.deposit.credited", "system", "alpha-cashier", map[string]any{
		"userId":        submitted.UserID,
		"chainId":       evidence.ChainID,
		"txHash":        evidence.TxHash,
		"logIndex":      evidence.LogIndex,
		"amountCents":   submitted.AmountCents,
		"walletEntryId": entry.EntryID,
	})
	return credited, nil
}

func (s *Service) CreateWithdrawalRequest(ctx context.Context, userID string, destinationAddress string, amountCents int64, idempotencyKey string) (*WithdrawalRequest, error) {
	if err := s.requireWithdrawalsEnabled(); err != nil {
		return nil, err
	}
	if s.ledger == nil {
		return nil, ErrWalletLedgerMissing
	}
	if strings.TrimSpace(userID) == "" {
		return nil, ErrWalletNotConnected
	}
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if idempotencyKey == "" {
		return nil, ErrInvalidIdempotencyKey
	}
	// Same per-user lock as deposits, keyed like the payments rail's
	// withdrawal lock so the two rails serialize against each other: the
	// idempotency lookup, the KYC gate and the hold+insert cannot race
	// (two concurrent identical requests used to both hold funds).
	unlock, err := s.repo.LockUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	defer unlock()
	if existing, err := s.repo.FindWithdrawalRequestByIdempotencyKey(ctx, userID, idempotencyKey); err != nil {
		return nil, err
	} else if existing != nil {
		return existing, nil
	}
	if amountCents < s.cfg.MinDepositCents || amountCents > s.cfg.MaxDepositCents {
		return nil, ErrInvalidAmount
	}
	normalized, err := NormalizeAddress(destinationAddress)
	if err != nil {
		return nil, err
	}
	// Sanctions/AML screening on the withdrawal destination before any funds
	// are reserved (audit CMP-01).
	if err := s.screenAddress(ctx, userID, normalized, "withdrawal_destination"); err != nil {
		return nil, err
	}
	if s.withdrawalGate != nil {
		if err := s.withdrawalGate(ctx, userID, amountCents); err != nil {
			return nil, err
		}
	}
	units, err := CentsToTokenUnits(amountCents, s.cfg.TokenDecimals)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	id := uuid.NewString()
	reservation, err := s.ledger.Hold(ctx, wallet.HoldRequest{
		UserID:        userID,
		AmountPoints:  amountCents,
		ReferenceType: withdrawalReferenceType,
		ReferenceID:   id,
		ExpiresIn:     withdrawalReservationTTL,
	})
	if err != nil {
		return nil, err
	}
	req := WithdrawalRequest{
		ID:                  id,
		UserID:              userID,
		ChainID:             s.cfg.ChainID,
		TokenSymbol:         s.cfg.TokenSymbol,
		TokenAddress:        common.HexToAddress(s.cfg.TokenAddress).Hex(),
		DestinationAddress:  common.HexToAddress(normalized).Hex(),
		AmountCents:         amountCents,
		AmountUnits:         units.String(),
		Status:              "requested",
		WalletReservationID: reservation.ID,
		RequestedAt:         now,
		IdempotencyKey:      idempotencyKey,
		CreatedAt:           now,
		UpdatedAt:           now,
	}
	saved, err := s.repo.SaveWithdrawalRequest(ctx, req)
	if err != nil {
		_ = s.ledger.Release(ctx, withdrawalReferenceType, id)
		return nil, err
	}
	s.auditOrLog(ctx, "withdrawal_request", saved.ID, "alpha_cashier.withdrawal.requested", "user", userID, map[string]any{
		"userId":             userID,
		"chainId":            saved.ChainID,
		"amountCents":        saved.AmountCents,
		"amountUnits":        saved.AmountUnits,
		"destinationAddress": saved.DestinationAddress,
		"walletReservation":  saved.WalletReservationID,
	})
	return saved, nil
}

func (s *Service) GetWithdrawalRequest(ctx context.Context, userID string, id string) (*WithdrawalRequest, error) {
	if err := s.requireEnabled(); err != nil {
		return nil, err
	}
	req, err := s.repo.GetWithdrawalRequest(ctx, strings.TrimSpace(id))
	if errors.Is(err, ErrWithdrawalNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if req.UserID != userID {
		return nil, nil
	}
	return req, nil
}

func (s *Service) ListWithdrawalRequests(ctx context.Context, userID string) ([]WithdrawalRequest, error) {
	if err := s.requireEnabled(); err != nil {
		return nil, err
	}
	return s.repo.ListWithdrawalRequests(ctx, userID)
}

func (s *Service) ListAdminWithdrawalRequests(ctx context.Context, status string) ([]WithdrawalRequest, error) {
	if err := s.requireEnabled(); err != nil {
		return nil, err
	}
	status = strings.TrimSpace(status)
	if status != "" && !validWithdrawalStatus(status) {
		return nil, ErrInvalidStatus
	}
	return s.repo.ListAdminWithdrawalRequests(ctx, status)
}

func (s *Service) ApproveWithdrawal(ctx context.Context, id string, actorID string, note string) (*WithdrawalRequest, error) {
	if err := s.requireEnabled(); err != nil {
		return nil, err
	}
	note = strings.TrimSpace(note)
	req, err := s.repo.GetWithdrawalRequest(ctx, strings.TrimSpace(id))
	if err != nil {
		return nil, err
	}
	if note == "" {
		return nil, ErrReviewNoteRequired
	}
	if req.Status == "approved" {
		return req, nil
	}
	if req.Status != "requested" && req.Status != "under_review" {
		return nil, ErrInvalidStatus
	}
	// Two-person control (SECURITY-REVIEW #8): the approver must not be the
	// withdrawal's owning user — a user must never self-approve their cash-out.
	if s.cfg.TwoPersonWithdrawal && strings.EqualFold(strings.TrimSpace(actorID), strings.TrimSpace(req.UserID)) {
		return nil, ErrSecondApproverRequired
	}
	now := s.now().UTC()
	approved, err := s.repo.MarkWithdrawalReviewed(ctx, req.ID, "approved", strings.TrimSpace(actorID), note, now)
	if err != nil {
		return nil, err
	}
	s.auditOrLog(ctx, "withdrawal_request", req.ID, "alpha_cashier.withdrawal.approved", "admin", actorID, map[string]any{
		"userId":      req.UserID,
		"amountCents": req.AmountCents,
		"note":        note,
	})
	return approved, nil
}

func (s *Service) RejectWithdrawal(ctx context.Context, id string, actorID string, note string) (*WithdrawalRequest, error) {
	if err := s.requireEnabled(); err != nil {
		return nil, err
	}
	note = strings.TrimSpace(note)
	if note == "" {
		return nil, ErrReviewNoteRequired
	}
	req, err := s.repo.GetWithdrawalRequest(ctx, strings.TrimSpace(id))
	if err != nil {
		return nil, err
	}
	if req.Status == "rejected" {
		return req, nil
	}
	if req.Status != "requested" && req.Status != "under_review" && req.Status != "approved" {
		return nil, ErrInvalidStatus
	}
	if s.ledger == nil {
		return nil, ErrWalletLedgerMissing
	}
	if err := s.ledger.Release(ctx, withdrawalReferenceType, req.ID); err != nil {
		return nil, err
	}
	now := s.now().UTC()
	rejected, err := s.repo.MarkWithdrawalReviewed(ctx, req.ID, "rejected", strings.TrimSpace(actorID), note, now)
	if err != nil {
		return nil, err
	}
	s.auditOrLog(ctx, "withdrawal_request", req.ID, "alpha_cashier.withdrawal.rejected", "admin", actorID, map[string]any{
		"userId":      req.UserID,
		"amountCents": req.AmountCents,
		"note":        note,
	})
	return rejected, nil
}

func (s *Service) MarkWithdrawalBroadcasted(ctx context.Context, id string, actorID string, txHash string) (*WithdrawalRequest, error) {
	if err := s.requireEnabled(); err != nil {
		return nil, err
	}
	txHash = strings.TrimSpace(txHash)
	if len(txHash) != 66 || !strings.HasPrefix(txHash, "0x") {
		return nil, ErrTxHashInvalid
	}
	req, err := s.repo.GetWithdrawalRequest(ctx, strings.TrimSpace(id))
	if err != nil {
		return nil, err
	}
	if req.Status == "broadcasted" && strings.EqualFold(req.BroadcastTxHash, txHash) {
		return req, nil
	}
	if req.Status != "approved" {
		return nil, ErrInvalidStatus
	}
	// Two-person control (A2-04): the operator broadcasting the payout must be
	// different from the one who approved it. The approver is recorded in
	// reviewed_by; the broadcaster is this actor. Idempotent re-broadcast of
	// the same tx above is exempt (already returned).
	if s.cfg.TwoPersonWithdrawal {
		broadcaster := strings.TrimSpace(actorID)
		approver := strings.TrimSpace(req.ReviewedBy)
		if broadcaster == "" {
			return nil, ErrSecondApproverRequired
		}
		if approver == "" || strings.EqualFold(broadcaster, approver) {
			slog.WarnContext(ctx, "withdrawal broadcast blocked: two-person control",
				"withdrawal_id", req.ID, "approver", approver, "broadcaster", broadcaster)
			return nil, ErrSecondApproverRequired
		}
	}
	now := s.now().UTC()
	broadcasted, err := s.repo.MarkWithdrawalBroadcasted(ctx, req.ID, txHash, now)
	if err != nil {
		return nil, err
	}
	s.auditOrLog(ctx, "withdrawal_request", req.ID, "alpha_cashier.withdrawal.broadcasted", "admin", actorID, map[string]any{
		"userId":      req.UserID,
		"amountCents": req.AmountCents,
		"txHash":      txHash,
	})
	return broadcasted, nil
}

func (s *Service) MarkWithdrawalCompleted(ctx context.Context, id string, actorID string) (*WithdrawalRequest, error) {
	if err := s.requireEnabled(); err != nil {
		return nil, err
	}
	if s.ledger == nil {
		return nil, ErrWalletLedgerMissing
	}
	req, err := s.repo.GetWithdrawalRequest(ctx, strings.TrimSpace(id))
	if err != nil {
		return nil, err
	}
	if req.Status == "completed" {
		return req, nil
	}
	if req.Status != "broadcasted" {
		return nil, ErrInvalidStatus
	}
	// Completion captures the reserved points, so it must rest on chain
	// evidence, not the operator's word (2026-09-29 audit): the broadcast
	// tx must be mined, successful, confirmation-deep, and move exactly the
	// requested amount of the token from the payout wallet to the
	// destination. Deposits already verify this way (SubmitDepositTx).
	if s.evmClient == nil {
		return nil, ErrTxVerificationMissing
	}
	evidence, err := VerifyERC20Transfer(ctx, s.evmClient, TransferExpectation{
		ChainID:               req.ChainID,
		TxHash:                req.BroadcastTxHash,
		TokenAddress:          req.TokenAddress,
		FromAddress:           s.cfg.PayoutAddress(),
		ToAddress:             req.DestinationAddress,
		AmountUnits:           req.AmountUnits,
		RequiredConfirmations: s.cfg.Confirmations,
	})
	if err != nil {
		s.auditOrLog(ctx, "withdrawal_request", req.ID, "alpha_cashier.withdrawal.completion_unverified", "admin", actorID, map[string]any{
			"userId": req.UserID,
			"txHash": req.BroadcastTxHash,
			"error":  err.Error(),
		})
		return nil, err
	}
	entry, err := s.ledger.Capture(ctx, withdrawalReferenceType, req.ID)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	completed, err := s.repo.MarkWithdrawalCompleted(ctx, req.ID, now)
	if err != nil {
		return nil, err
	}
	s.auditOrLog(ctx, "withdrawal_request", req.ID, "alpha_cashier.withdrawal.completed", "admin", actorID, map[string]any{
		"userId":        req.UserID,
		"amountCents":   req.AmountCents,
		"walletEntryId": entry.EntryID,
		"txHash":        req.BroadcastTxHash,
		"blockNumber":   evidence.BlockNumber,
		"blockHash":     evidence.BlockHash,
		"confirmations": evidence.Confirmations,
	})
	return completed, nil
}

func (s *Service) ReconciliationSummary(ctx context.Context) (*ReconciliationSummary, error) {
	if err := s.requireEnabled(); err != nil {
		return nil, err
	}
	snap, err := s.repo.ReconciliationSnapshot(ctx)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	expected := snap.CreditedDepositCents - snap.CompletedWithdrawalCents
	summary := &ReconciliationSummary{
		ChainID:                     s.cfg.ChainID,
		TokenSymbol:                 s.cfg.TokenSymbol,
		TreasuryAddress:             common.HexToAddress(s.cfg.TreasuryAddress).Hex(),
		CreditedDepositCents:        snap.CreditedDepositCents,
		CompletedWithdrawalCents:    snap.CompletedWithdrawalCents,
		PendingWithdrawalCents:      snap.PendingWithdrawalCents,
		WalletBalanceCents:          snap.WalletBalanceCents,
		ActiveReservationCents:      snap.ActiveReservationCents,
		CashierExpectedReserveCents: expected,
		GeneratedAt:                 now,
	}
	if s.evmClient != nil {
		balance, err := s.evmClient.TokenBalance(ctx, common.HexToAddress(s.cfg.TokenAddress), common.HexToAddress(s.cfg.TreasuryAddress))
		if err != nil {
			return nil, err
		}
		if balance == nil {
			balance = big.NewInt(0)
		}
		cents, dust, err := TokenUnitsToCentsWithDust(balance, s.cfg.TokenDecimals)
		if err != nil {
			return nil, err
		}
		summary.TreasuryBalanceUnits = balance.String()
		summary.TreasuryBalanceCents = cents
		summary.TreasuryDustUnits = dust.String()
		summary.CashierDriftCents = cents - expected
	}
	return summary, nil
}

func (s *Service) ListAuditEvents(ctx context.Context, filter AuditEventFilter) ([]AuditEvent, error) {
	if err := s.requireEnabled(); err != nil {
		return nil, err
	}
	filter.SubjectType = strings.TrimSpace(filter.SubjectType)
	filter.SubjectID = strings.TrimSpace(filter.SubjectID)
	filter.EventType = strings.TrimSpace(filter.EventType)
	filter.ActorType = strings.TrimSpace(filter.ActorType)
	filter.ActorID = strings.TrimSpace(filter.ActorID)
	filter.Limit = normalizeAdminListLimit(filter.Limit)
	return s.repo.ListAuditEvents(ctx, filter)
}

func (s *Service) requireEnabled() error {
	if s == nil || !s.cfg.Enabled {
		return ErrDisabled
	}
	return nil
}

func (s *Service) requireWithdrawalsEnabled() error {
	if err := s.requireEnabled(); err != nil {
		return err
	}
	if !s.cfg.WithdrawalsEnabled {
		return ErrWithdrawalsDisabled
	}
	return nil
}

// auditOrLog records an audit event and, if the write fails, logs at ERROR and
// increments auditWriteFailures rather than dropping the error silently (LOW
// #22). The money operation is never failed on an audit write error — the audit
// trail is observability, not a transactional precondition.
func (s *Service) auditOrLog(ctx context.Context, subjectType string, subjectID string, eventType string, actorType string, actorID string, payload map[string]any) {
	if err := s.recordAudit(ctx, subjectType, subjectID, eventType, actorType, actorID, payload); err != nil {
		auditWriteFailures.Add(1)
		slog.ErrorContext(ctx, "alpha cashier: audit write failed — entry not durably persisted",
			"event_type", eventType, "subject_type", subjectType, "subject_id", subjectID, "error", err)
	}
}

func (s *Service) recordAudit(ctx context.Context, subjectType string, subjectID string, eventType string, actorType string, actorID string, payload map[string]any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return s.repo.RecordAudit(ctx, AuditEvent{
		SubjectType:  subjectType,
		SubjectID:    subjectID,
		EventType:    eventType,
		ActorType:    actorType,
		ActorID:      actorID,
		EventPayload: string(raw),
		CreatedAt:    s.now().UTC(),
	})
}

func IsNotFoundOrUnauthorized(err error) bool {
	return errors.Is(err, ErrChallengeNotFound) || errors.Is(err, ErrWalletNotConnected)
}

func validWithdrawalStatus(status string) bool {
	switch status {
	case "requested", "under_review", "approved", "rejected", "broadcasted", "completed", "failed", "cancelled":
		return true
	default:
		return false
	}
}

func validDepositStatus(status string) bool {
	switch status {
	case "created", "submitted", "confirmed", "credited", "expired", "failed", "quarantined":
		return true
	default:
		return false
	}
}

func normalizeAdminListLimit(limit int) int {
	if limit <= 0 {
		return defaultAdminListLimit
	}
	if limit > maxAdminListLimit {
		return maxAdminListLimit
	}
	return limit
}
