package alphacashier

import (
	"context"
	"database/sql"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Repository interface {
	// LockUser serializes one user's money operations (deposit intents,
	// withdrawal requests) and returns the release func. SQL: a session
	// advisory lock on hashtext(userID), the same key the payments rail's
	// withdrawal lock uses, so the two rails serialize against each other.
	LockUser(ctx context.Context, userID string) (func(), error)
	SaveWalletChallenge(ctx context.Context, challenge WalletChallenge) error
	GetWalletChallenge(ctx context.Context, nonce string) (*WalletChallenge, error)
	ConsumeWalletChallenge(ctx context.Context, nonce string, consumedAt time.Time) error
	UpsertWalletConnection(ctx context.Context, connection WalletConnection) (*WalletConnection, error)
	FindWalletConnection(ctx context.Context, userID string, chainID int64, normalizedAddress string) (*WalletConnection, error)
	ListWalletConnections(ctx context.Context, userID string) ([]WalletConnection, error)
	FindDepositIntentByIdempotencyKey(ctx context.Context, userID string, idempotencyKey string) (*DepositIntent, error)
	SaveDepositIntent(ctx context.Context, intent DepositIntent) (*DepositIntent, error)
	MarkDepositSubmitted(ctx context.Context, id string, txHash string, submittedAt time.Time) (*DepositIntent, error)
	MarkDepositCredited(ctx context.Context, id string, walletEntryID string, confirmedAt time.Time, creditedAt time.Time) (*DepositIntent, error)
	// MarkDepositCreditedTx is the tx-aware variant of MarkDepositCredited; it
	// participates in the caller's *sql.Tx so the wallet credit and the intent
	// status update commit atomically (audit A2/HIGH #9).
	MarkDepositCreditedTx(ctx context.Context, tx *sql.Tx, id string, walletEntryID string, confirmedAt time.Time, creditedAt time.Time) (*DepositIntent, error)
	RecordChainTransaction(ctx context.Context, tx ChainTransaction) error
	GetDepositIntent(ctx context.Context, id string) (*DepositIntent, error)
	ListDepositIntents(ctx context.Context, userID string) ([]DepositIntent, error)
	ListAdminDepositIntents(ctx context.Context, filter DepositIntentFilter) ([]DepositIntent, error)
	// ListCreditedDepositsForFinality returns credited deposits paired with the
	// on-chain evidence they were credited from, for the reorg watcher (A2-03).
	ListCreditedDepositsForFinality(ctx context.Context, limit int) ([]CreditedDeposit, error)
	// MarkDepositFinalized retires a credited deposit from the reorg
	// watcher once it is finality-deep (migration 065).
	MarkDepositFinalized(ctx context.Context, id string, at time.Time) error
	// MarkDepositReorgDetected records the first detection of a reorg on a
	// credited deposit; first reports whether this call set it.
	MarkDepositReorgDetected(ctx context.Context, id string, at time.Time) (first bool, err error)
	// FindOpenDepositIntentForTransfer returns the oldest unexpired intent
	// awaiting a transaction that a treasury transfer of amountUnits from
	// fromAddress would satisfy (the deposit scanner), or nil.
	FindOpenDepositIntentForTransfer(ctx context.Context, chainID int64, fromAddress string, amountUnits string, now time.Time) (*DepositIntent, error)
	// GetScanCursor / SetScanCursor persist where a deposit scanner resumes.
	GetScanCursor(ctx context.Context, name string) (next uint64, ok bool, err error)
	SetScanCursor(ctx context.Context, name string, next uint64) error
	// TryLockScanner makes one scanner run at a time across replicas; ok is
	// false (and unlock nil) when another instance holds it.
	TryLockScanner(ctx context.Context, name string) (unlock func(), ok bool, err error)
	SumUserDepositIntentCentsSince(ctx context.Context, userID string, since time.Time) (int64, error)
	FindWithdrawalRequestByIdempotencyKey(ctx context.Context, userID string, idempotencyKey string) (*WithdrawalRequest, error)
	SaveWithdrawalRequest(ctx context.Context, request WithdrawalRequest) (*WithdrawalRequest, error)
	GetWithdrawalRequest(ctx context.Context, id string) (*WithdrawalRequest, error)
	ListWithdrawalRequests(ctx context.Context, userID string) ([]WithdrawalRequest, error)
	ListAdminWithdrawalRequests(ctx context.Context, status string) ([]WithdrawalRequest, error)
	MarkWithdrawalReviewed(ctx context.Context, id string, status string, reviewedBy string, reviewNote string, reviewedAt time.Time) (*WithdrawalRequest, error)
	MarkWithdrawalBroadcasted(ctx context.Context, id string, txHash string, updatedAt time.Time) (*WithdrawalRequest, error)
	MarkWithdrawalCompleted(ctx context.Context, id string, completedAt time.Time) (*WithdrawalRequest, error)
	ReconciliationSnapshot(ctx context.Context) (ReconciliationLedgerSnapshot, error)
	RecordAudit(ctx context.Context, event AuditEvent) error
	ListAuditEvents(ctx context.Context, filter AuditEventFilter) ([]AuditEvent, error)
}

type MemoryRepository struct {
	userLocksMu sync.Mutex
	userLocks   map[string]*sync.Mutex
	finalized   map[string]time.Time
	reorgSeen   map[string]time.Time
	cursors     map[string]uint64
	scannerBusy map[string]bool
	mu          sync.Mutex
	challenges  map[string]WalletChallenge
	wallets     map[string]WalletConnection
	deposits    map[string]DepositIntent
	withdrawals map[string]WithdrawalRequest
	chainTxs    map[string]ChainTransaction
	audits      []AuditEvent
	seq         int64
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{
		challenges:  map[string]WalletChallenge{},
		wallets:     map[string]WalletConnection{},
		deposits:    map[string]DepositIntent{},
		withdrawals: map[string]WithdrawalRequest{},
		chainTxs:    map[string]ChainTransaction{},
	}
}

func (r *MemoryRepository) LockUser(_ context.Context, userID string) (func(), error) {
	r.userLocksMu.Lock()
	if r.userLocks == nil {
		r.userLocks = map[string]*sync.Mutex{}
	}
	m, ok := r.userLocks[userID]
	if !ok {
		m = &sync.Mutex{}
		r.userLocks[userID] = m
	}
	r.userLocksMu.Unlock()
	m.Lock()
	return m.Unlock, nil
}

func (r *MemoryRepository) SaveWalletChallenge(_ context.Context, challenge WalletChallenge) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.challenges[challenge.Nonce] = challenge
	return nil
}

func (r *MemoryRepository) GetWalletChallenge(_ context.Context, nonce string) (*WalletChallenge, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	ch, ok := r.challenges[nonce]
	if !ok {
		return nil, ErrChallengeNotFound
	}
	return &ch, nil
}

func (r *MemoryRepository) ConsumeWalletChallenge(_ context.Context, nonce string, consumedAt time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	ch, ok := r.challenges[nonce]
	if !ok {
		return ErrChallengeNotFound
	}
	if ch.ConsumedAt != nil {
		return ErrChallengeConsumed
	}
	ch.ConsumedAt = &consumedAt
	r.challenges[nonce] = ch
	return nil
}

func (r *MemoryRepository) UpsertWalletConnection(_ context.Context, connection WalletConnection) (*WalletConnection, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := walletKey(connection.UserID, connection.ChainID, connection.NormalizedAddress)
	if existing, ok := r.wallets[key]; ok {
		connection.ID = existing.ID
		connection.CreatedAt = existing.CreatedAt
	} else {
		r.seq++
		connection.ID = "awc:mem:" + strconv64(r.seq)
	}
	r.wallets[key] = connection
	out := r.wallets[key]
	return &out, nil
}

func (r *MemoryRepository) FindWalletConnection(_ context.Context, userID string, chainID int64, normalizedAddress string) (*WalletConnection, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if conn, ok := r.wallets[walletKey(userID, chainID, normalizedAddress)]; ok {
		return &conn, nil
	}
	return nil, ErrWalletNotConnected
}

func (r *MemoryRepository) ListWalletConnections(_ context.Context, userID string) ([]WalletConnection, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []WalletConnection{}
	for _, conn := range r.wallets {
		if conn.UserID == userID {
			out = append(out, conn)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].LastSeenAt.After(out[j].LastSeenAt) })
	return out, nil
}

func (r *MemoryRepository) FindDepositIntentByIdempotencyKey(_ context.Context, userID string, idempotencyKey string) (*DepositIntent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, intent := range r.deposits {
		if intent.UserID == userID && intent.IdempotencyKey == idempotencyKey {
			return &intent, nil
		}
	}
	return nil, nil
}

func (r *MemoryRepository) SaveDepositIntent(_ context.Context, intent DepositIntent) (*DepositIntent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.seq++
	intent.ID = "adi:mem:" + strconv64(r.seq)
	r.deposits[intent.ID] = intent
	return &intent, nil
}

func (r *MemoryRepository) MarkDepositSubmitted(_ context.Context, id string, txHash string, submittedAt time.Time) (*DepositIntent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	intent, ok := r.deposits[id]
	if !ok {
		return nil, nil
	}
	intent.Status = "submitted"
	intent.TxHash = txHash
	intent.SubmittedAt = &submittedAt
	intent.UpdatedAt = submittedAt
	r.deposits[id] = intent
	return &intent, nil
}

func (r *MemoryRepository) MarkDepositCredited(_ context.Context, id string, walletEntryID string, confirmedAt time.Time, creditedAt time.Time) (*DepositIntent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	intent, ok := r.deposits[id]
	if !ok {
		return nil, nil
	}
	intent.Status = "credited"
	intent.CreditedWalletEntryID = walletEntryID
	intent.ConfirmedAt = &confirmedAt
	intent.CreditedAt = &creditedAt
	intent.UpdatedAt = creditedAt
	r.deposits[id] = intent
	return &intent, nil
}

// MarkDepositCreditedTx mirrors MarkDepositCredited for the memory repo. The
// memory ledger has no real transaction, so the *sql.Tx is ignored and the
// passthrough simply delegates to the non-tx path.
func (r *MemoryRepository) MarkDepositCreditedTx(ctx context.Context, _ *sql.Tx, id string, walletEntryID string, confirmedAt time.Time, creditedAt time.Time) (*DepositIntent, error) {
	return r.MarkDepositCredited(ctx, id, walletEntryID, confirmedAt, creditedAt)
}

func (r *MemoryRepository) RecordChainTransaction(_ context.Context, tx ChainTransaction) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if tx.DepositIntentID != "" {
		r.chainTxs[tx.DepositIntentID] = tx
	}
	return nil
}

func (r *MemoryRepository) ListCreditedDepositsForFinality(_ context.Context, limit int) ([]CreditedDeposit, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	type row struct {
		dep        CreditedDeposit
		creditedAt time.Time
	}
	rows := []row{}
	for _, intent := range r.deposits {
		if intent.Status != "credited" {
			continue
		}
		if _, done := r.finalized[intent.ID]; done {
			continue
		}
		tx, ok := r.chainTxs[intent.ID]
		if !ok {
			continue
		}
		at := time.Time{}
		if intent.CreditedAt != nil {
			at = *intent.CreditedAt
		}
		rows = append(rows, row{CreditedDeposit{
			DepositID:   intent.ID,
			UserID:      intent.UserID,
			AmountCents: intent.AmountCents,
			Tx:          tx,
		}, at})
	}
	// Oldest unfinalized credit first, like the SQL listing.
	sort.Slice(rows, func(i, j int) bool {
		if !rows[i].creditedAt.Equal(rows[j].creditedAt) {
			return rows[i].creditedAt.Before(rows[j].creditedAt)
		}
		return rows[i].dep.DepositID < rows[j].dep.DepositID
	})
	out := []CreditedDeposit{}
	for _, r := range rows {
		out = append(out, r.dep)
	}
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (r *MemoryRepository) MarkDepositFinalized(_ context.Context, id string, at time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.finalized == nil {
		r.finalized = map[string]time.Time{}
	}
	if _, ok := r.finalized[id]; !ok {
		r.finalized[id] = at
	}
	return nil
}

func (r *MemoryRepository) MarkDepositReorgDetected(_ context.Context, id string, at time.Time) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.reorgSeen == nil {
		r.reorgSeen = map[string]time.Time{}
	}
	if _, ok := r.reorgSeen[id]; ok {
		return false, nil
	}
	r.reorgSeen[id] = at
	return true, nil
}

func (r *MemoryRepository) FindOpenDepositIntentForTransfer(_ context.Context, chainID int64, fromAddress string, amountUnits string, now time.Time) (*DepositIntent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var best *DepositIntent
	for _, intent := range r.deposits {
		if intent.ChainID != chainID || intent.Status != "created" || intent.TxHash != "" {
			continue
		}
		if !strings.EqualFold(intent.FromAddress, fromAddress) || intent.AmountUnits != amountUnits {
			continue
		}
		if !now.Before(intent.ExpiresAt) {
			continue
		}
		if best == nil || intent.CreatedAt.Before(best.CreatedAt) {
			copy := intent
			best = &copy
		}
	}
	return best, nil
}

func (r *MemoryRepository) GetScanCursor(_ context.Context, name string) (uint64, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	next, ok := r.cursors[name]
	return next, ok, nil
}

func (r *MemoryRepository) SetScanCursor(_ context.Context, name string, next uint64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cursors == nil {
		r.cursors = map[string]uint64{}
	}
	r.cursors[name] = next
	return nil
}

func (r *MemoryRepository) TryLockScanner(_ context.Context, name string) (func(), bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.scannerBusy == nil {
		r.scannerBusy = map[string]bool{}
	}
	if r.scannerBusy[name] {
		return nil, false, nil
	}
	r.scannerBusy[name] = true
	return func() {
		r.mu.Lock()
		defer r.mu.Unlock()
		delete(r.scannerBusy, name)
	}, true, nil
}

func (r *MemoryRepository) GetDepositIntent(_ context.Context, id string) (*DepositIntent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	intent, ok := r.deposits[id]
	if !ok {
		return nil, nil
	}
	return &intent, nil
}

func (r *MemoryRepository) ListDepositIntents(_ context.Context, userID string) ([]DepositIntent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []DepositIntent{}
	for _, intent := range r.deposits {
		if intent.UserID == userID {
			out = append(out, intent)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}

func (r *MemoryRepository) ListAdminDepositIntents(_ context.Context, filter DepositIntentFilter) ([]DepositIntent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	status := strings.TrimSpace(filter.Status)
	userID := strings.TrimSpace(filter.UserID)
	txHash := strings.ToLower(strings.TrimSpace(filter.TxHash))
	out := []DepositIntent{}
	for _, intent := range r.deposits {
		if status != "" && intent.Status != status {
			continue
		}
		if userID != "" && intent.UserID != userID {
			continue
		}
		if txHash != "" && strings.ToLower(intent.TxHash) != txHash {
			continue
		}
		out = append(out, intent)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	if filter.Limit > 0 && len(out) > filter.Limit {
		out = out[:filter.Limit]
	}
	return out, nil
}

func (r *MemoryRepository) SumUserDepositIntentCentsSince(_ context.Context, userID string, since time.Time) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var total int64
	for _, intent := range r.deposits {
		if intent.UserID != userID || intent.CreatedAt.Before(since) {
			continue
		}
		switch intent.Status {
		case "failed", "expired", "quarantined":
			continue
		default:
			total += intent.AmountCents
		}
	}
	return total, nil
}

func (r *MemoryRepository) FindWithdrawalRequestByIdempotencyKey(_ context.Context, userID string, idempotencyKey string) (*WithdrawalRequest, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, req := range r.withdrawals {
		if req.UserID == userID && req.IdempotencyKey == idempotencyKey {
			return &req, nil
		}
	}
	return nil, nil
}

func (r *MemoryRepository) SaveWithdrawalRequest(_ context.Context, request WithdrawalRequest) (*WithdrawalRequest, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if request.ID == "" {
		r.seq++
		request.ID = "awr:mem:" + strconv64(r.seq)
	}
	r.withdrawals[request.ID] = request
	return &request, nil
}

func (r *MemoryRepository) GetWithdrawalRequest(_ context.Context, id string) (*WithdrawalRequest, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	req, ok := r.withdrawals[id]
	if !ok {
		return nil, ErrWithdrawalNotFound
	}
	return &req, nil
}

func (r *MemoryRepository) ListWithdrawalRequests(_ context.Context, userID string) ([]WithdrawalRequest, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []WithdrawalRequest{}
	for _, req := range r.withdrawals {
		if req.UserID == userID {
			out = append(out, req)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}

func (r *MemoryRepository) ListAdminWithdrawalRequests(_ context.Context, status string) ([]WithdrawalRequest, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	status = strings.TrimSpace(status)
	out := []WithdrawalRequest{}
	for _, req := range r.withdrawals {
		if status == "" || req.Status == status {
			out = append(out, req)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}

func (r *MemoryRepository) MarkWithdrawalReviewed(_ context.Context, id string, status string, reviewedBy string, reviewNote string, reviewedAt time.Time) (*WithdrawalRequest, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	req, ok := r.withdrawals[id]
	if !ok {
		return nil, ErrWithdrawalNotFound
	}
	req.Status = status
	req.ReviewedAt = &reviewedAt
	req.ReviewedBy = reviewedBy
	req.ReviewNote = reviewNote
	req.UpdatedAt = reviewedAt
	r.withdrawals[id] = req
	return &req, nil
}

func (r *MemoryRepository) MarkWithdrawalBroadcasted(_ context.Context, id string, txHash string, updatedAt time.Time) (*WithdrawalRequest, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	req, ok := r.withdrawals[id]
	if !ok {
		return nil, ErrWithdrawalNotFound
	}
	req.Status = "broadcasted"
	req.BroadcastTxHash = txHash
	req.UpdatedAt = updatedAt
	r.withdrawals[id] = req
	return &req, nil
}

func (r *MemoryRepository) MarkWithdrawalCompleted(_ context.Context, id string, completedAt time.Time) (*WithdrawalRequest, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	req, ok := r.withdrawals[id]
	if !ok {
		return nil, ErrWithdrawalNotFound
	}
	req.Status = "completed"
	req.CompletedAt = &completedAt
	req.UpdatedAt = completedAt
	r.withdrawals[id] = req
	return &req, nil
}

func (r *MemoryRepository) ReconciliationSnapshot(_ context.Context) (ReconciliationLedgerSnapshot, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var snap ReconciliationLedgerSnapshot
	for _, intent := range r.deposits {
		if intent.Status == "credited" {
			snap.CreditedDepositCents += intent.AmountCents
		}
	}
	for _, req := range r.withdrawals {
		switch req.Status {
		case "completed":
			snap.CompletedWithdrawalCents += req.AmountCents
		case "requested", "under_review", "approved", "broadcasted":
			snap.PendingWithdrawalCents += req.AmountCents
		}
	}
	return snap, nil
}

func (r *MemoryRepository) RecordAudit(_ context.Context, event AuditEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if event.ID == "" {
		r.seq++
		event.ID = "aae:mem:" + strconv64(r.seq)
	}
	r.audits = append(r.audits, event)
	return nil
}

func (r *MemoryRepository) ListAuditEvents(_ context.Context, filter AuditEventFilter) ([]AuditEvent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []AuditEvent{}
	for _, event := range r.audits {
		if filter.SubjectType != "" && event.SubjectType != filter.SubjectType {
			continue
		}
		if filter.SubjectID != "" && event.SubjectID != filter.SubjectID {
			continue
		}
		if filter.EventType != "" && event.EventType != filter.EventType {
			continue
		}
		if filter.ActorType != "" && event.ActorType != filter.ActorType {
			continue
		}
		if filter.ActorID != "" && event.ActorID != filter.ActorID {
			continue
		}
		out = append(out, event)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	if filter.Limit > 0 && len(out) > filter.Limit {
		out = out[:filter.Limit]
	}
	return out, nil
}

func walletKey(userID string, chainID int64, normalizedAddress string) string {
	return strings.Join([]string{userID, strconv64(chainID), strings.ToLower(normalizedAddress)}, "|")
}

func strconv64(n int64) string {
	return strconv.FormatInt(n, 10)
}
