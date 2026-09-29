package alphacashier

import (
	"errors"
	"time"
)

var (
	ErrDisabled              = errors.New("alpha cashier disabled")
	ErrInvalidAddress        = errors.New("invalid evm address")
	ErrInvalidAmount         = errors.New("invalid amount")
	ErrInvalidIdempotencyKey = errors.New("invalid idempotency key")
	ErrChallengeNotFound     = errors.New("wallet challenge not found")
	ErrChallengeExpired      = errors.New("wallet challenge expired")
	ErrChallengeConsumed     = errors.New("wallet challenge already consumed")
	ErrSignatureInvalid      = errors.New("wallet signature invalid")
	ErrWalletNotConnected    = errors.New("wallet not connected")
	ErrTxVerificationMissing = errors.New("transaction verifier unavailable")
	ErrWalletLedgerMissing   = errors.New("wallet ledger unavailable")
	ErrTxHashInvalid         = errors.New("invalid transaction hash")
	ErrTxNotFound            = errors.New("transaction not found")
	ErrTxFailed              = errors.New("transaction failed")
	ErrTxConfirming          = errors.New("transaction awaiting confirmations")
	ErrTransferMismatch      = errors.New("transaction does not match deposit intent")
	ErrDepositExpired        = errors.New("deposit intent expired")
	ErrWithdrawalsDisabled   = errors.New("alpha withdrawals disabled")
	ErrWithdrawalNotFound    = errors.New("withdrawal request not found")
	ErrInvalidStatus         = errors.New("invalid status transition")
	ErrReviewNoteRequired    = errors.New("review note required")
	// ErrSecondApproverRequired is returned when two-person withdrawal control
	// is on and the broadcaster is the same operator who approved (A2-04).
	ErrSecondApproverRequired = errors.New("withdrawal broadcast requires a different operator than the approver")
	// ErrIdentityVerificationRequired / Unavailable are the KYC just-in-time
	// gate's refusals, shared with the legacy payments rail so a withdrawal
	// threshold cannot be split across rails (2026-09-29 audit).
	ErrIdentityVerificationRequired    = errors.New("identity verification required to withdraw above this amount")
	ErrIdentityVerificationUnavailable = errors.New("identity verification unavailable; withdrawal blocked")
)

type WalletChallenge struct {
	Nonce         string     `json:"nonce"`
	UserID        string     `json:"userId"`
	ChainID       int64      `json:"chainId"`
	WalletAddress string     `json:"walletAddress"`
	Message       string     `json:"message"`
	ExpiresAt     time.Time  `json:"expiresAt"`
	ConsumedAt    *time.Time `json:"consumedAt,omitempty"`
	CreatedAt     time.Time  `json:"createdAt"`
}

type WalletConnection struct {
	ID                string    `json:"id"`
	UserID            string    `json:"userId"`
	ChainType         string    `json:"chainType"`
	ChainID           int64     `json:"chainId"`
	WalletAddress     string    `json:"walletAddress"`
	NormalizedAddress string    `json:"normalizedAddress"`
	Signature         string    `json:"-"`
	Message           string    `json:"-"`
	Nonce             string    `json:"nonce"`
	VerifiedAt        time.Time `json:"verifiedAt"`
	LastSeenAt        time.Time `json:"lastSeenAt"`
	CreatedAt         time.Time `json:"createdAt"`
}

type DepositIntent struct {
	ID                    string     `json:"id"`
	UserID                string     `json:"userId"`
	WalletConnectionID    string     `json:"walletConnectionId"`
	ChainID               int64      `json:"chainId"`
	ChainName             string     `json:"chainName"`
	TokenSymbol           string     `json:"tokenSymbol"`
	TokenAddress          string     `json:"tokenAddress"`
	TokenDecimals         int        `json:"tokenDecimals"`
	TreasuryAddress       string     `json:"treasuryAddress"`
	FromAddress           string     `json:"fromAddress"`
	AmountCents           int64      `json:"amountCents"`
	AmountUnits           string     `json:"amountUnits"`
	Status                string     `json:"status"`
	TxHash                string     `json:"txHash,omitempty"`
	CreditedWalletEntryID string     `json:"creditedWalletEntryId,omitempty"`
	FailureReason         string     `json:"failureReason,omitempty"`
	IdempotencyKey        string     `json:"-"`
	ExpiresAt             time.Time  `json:"expiresAt"`
	SubmittedAt           *time.Time `json:"submittedAt,omitempty"`
	ConfirmedAt           *time.Time `json:"confirmedAt,omitempty"`
	CreditedAt            *time.Time `json:"creditedAt,omitempty"`
	CreatedAt             time.Time  `json:"createdAt"`
	UpdatedAt             time.Time  `json:"updatedAt"`
}

type DepositIntentFilter struct {
	Status string
	UserID string
	TxHash string
	Limit  int
}

type AuditEvent struct {
	ID           string    `json:"id,omitempty"`
	SubjectType  string    `json:"subjectType"`
	SubjectID    string    `json:"subjectId"`
	EventType    string    `json:"eventType"`
	ActorType    string    `json:"actorType"`
	ActorID      string    `json:"actorId,omitempty"`
	EventPayload string    `json:"eventPayload"`
	CreatedAt    time.Time `json:"createdAt"`
}

type AuditEventFilter struct {
	SubjectType string
	SubjectID   string
	EventType   string
	ActorType   string
	ActorID     string
	Limit       int
}

type ChainTransaction struct {
	DepositIntentID string
	ChainID         int64
	TxHash          string
	LogIndex        uint
	BlockNumber     uint64
	BlockHash       string
	TokenAddress    string
	FromAddress     string
	ToAddress       string
	AmountUnits     string
	Confirmations   int64
	ReceiptStatus   string
	RawLog          string
	CreatedAt       time.Time
}

// CreditedDeposit pairs a credited deposit intent with the on-chain evidence it
// was credited from, so the reorg watcher (audit A2-03) can re-verify finality
// of the exact transaction/block that backed the credit.
type CreditedDeposit struct {
	DepositID   string
	UserID      string
	AmountCents int64
	Tx          ChainTransaction
}

type WithdrawalRequest struct {
	ID                  string     `json:"id"`
	UserID              string     `json:"userId"`
	ChainID             int64      `json:"chainId"`
	TokenSymbol         string     `json:"tokenSymbol"`
	TokenAddress        string     `json:"tokenAddress"`
	DestinationAddress  string     `json:"destinationAddress"`
	AmountCents         int64      `json:"amountCents"`
	AmountUnits         string     `json:"amountUnits"`
	Status              string     `json:"status"`
	WalletReservationID string     `json:"walletReservationId,omitempty"`
	RequestedAt         time.Time  `json:"requestedAt"`
	ReviewedAt          *time.Time `json:"reviewedAt,omitempty"`
	ReviewedBy          string     `json:"reviewedBy,omitempty"`
	ReviewNote          string     `json:"reviewNote,omitempty"`
	BroadcastTxHash     string     `json:"broadcastTxHash,omitempty"`
	CompletedAt         *time.Time `json:"completedAt,omitempty"`
	FailureReason       string     `json:"failureReason,omitempty"`
	IdempotencyKey      string     `json:"-"`
	CreatedAt           time.Time  `json:"createdAt"`
	UpdatedAt           time.Time  `json:"updatedAt"`
}

type ReconciliationSummary struct {
	ChainID                     int64  `json:"chainId"`
	TokenSymbol                 string `json:"tokenSymbol"`
	TreasuryAddress             string `json:"treasuryAddress"`
	TreasuryBalanceUnits        string `json:"treasuryBalanceUnits,omitempty"`
	TreasuryBalanceCents        int64  `json:"treasuryBalanceCents,omitempty"`
	CreditedDepositCents        int64  `json:"creditedDepositCents"`
	CompletedWithdrawalCents    int64  `json:"completedWithdrawalCents"`
	PendingWithdrawalCents      int64  `json:"pendingWithdrawalCents"`
	WalletBalanceCents          int64  `json:"walletBalanceCents"`
	ActiveReservationCents      int64  `json:"activeReservationCents"`
	CashierExpectedReserveCents int64  `json:"cashierExpectedReserveCents"`
	CashierDriftCents           int64  `json:"cashierDriftCents,omitempty"`
	// TreasuryDustUnits is the sub-cent remainder of the treasury balance
	// (base units) that TreasuryBalanceCents truncates away, so a drift can
	// be attributed to dust rather than a missing deposit.
	TreasuryDustUnits string    `json:"treasuryDustUnits,omitempty"`
	GeneratedAt       time.Time `json:"generatedAt"`
}

type ReconciliationLedgerSnapshot struct {
	CreditedDepositCents     int64
	CompletedWithdrawalCents int64
	PendingWithdrawalCents   int64
	WalletBalanceCents       int64
	ActiveReservationCents   int64
}

type PreflightCheck struct {
	Key      string         `json:"key"`
	Status   string         `json:"status"`
	Message  string         `json:"message"`
	Metadata map[string]any `json:"metadata,omitempty"`
}

type PreflightReport struct {
	Overall            string           `json:"overall"`
	Enabled            bool             `json:"enabled"`
	ChainID            int64            `json:"chainId"`
	ChainName          string           `json:"chainName"`
	TokenSymbol        string           `json:"tokenSymbol"`
	TokenAddress       string           `json:"tokenAddress,omitempty"`
	TreasuryAddress    string           `json:"treasuryAddress,omitempty"`
	WithdrawalsEnabled bool             `json:"withdrawalsEnabled"`
	GeneratedAt        time.Time        `json:"generatedAt"`
	Checks             []PreflightCheck `json:"checks"`
}
