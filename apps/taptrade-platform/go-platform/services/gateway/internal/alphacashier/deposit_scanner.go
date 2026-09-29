package alphacashier

import (
	"context"
	"log/slog"
	"strconv"
	"time"

	"github.com/ethereum/go-ethereum/common"
)

// DepositScanner is proactive deposit detection, ported from the
// feat/hula-na-cashier deposit watcher (2026-09-29) onto this rail.
//
// The branch prototype credited deposits itself, off a log scan: its reorg
// check could never fire (it trusted the `removed` flag of polled logs), it
// ran unconditionally at boot, created its tables on every start, scanned
// from block 0 on a fresh start, let every replica race on one cursor and
// retried nothing. This version only PROPOSES: for each Transfer of the token
// into the treasury from a wallet with a matching open intent, it calls
// SubmitDepositTx — the same path a user's own submission takes, which
// re-reads the receipt, checks confirmations and the exact transfer, re-screens
// the wallet and credits exactly once. The reorg watcher then re-verifies the
// credit until it is final. Transfers that match no intent are audited for
// operations and never credited.
//
// It runs only when ALPHA_CASHIER_ENABLED and
// ALPHA_CASHIER_DEPOSIT_SCANNER_ENABLED are both on (neither is set on the
// demo), scans only confirmation-deep blocks, starts at the chain head on a
// fresh start, holds a per-scanner advisory lock so one replica scans at a
// time, persists its cursor (migration 065) and retries RPC calls with
// backoff.
type DepositScanner struct {
	svc      *Service
	interval time.Duration
	maxRange uint64
	retries  int
	backoff  time.Duration
}

const (
	depositScannerName    = "treasury-deposits"
	defaultScanBlockRange = 2000
	defaultScanRPCRetries = 3
	defaultScanRPCBackoff = 500 * time.Millisecond
)

// NewDepositScanner creates a scanner over the given service.
func NewDepositScanner(svc *Service, interval time.Duration) *DepositScanner {
	return &DepositScanner{
		svc:      svc,
		interval: interval,
		maxRange: defaultScanBlockRange,
		retries:  defaultScanRPCRetries,
		backoff:  defaultScanRPCBackoff,
	}
}

// Run scans on every interval until ctx is cancelled.
func (d *DepositScanner) Run(ctx context.Context) {
	slog.Info("alpha cashier deposit scanner started", "interval", d.interval, "maxRange", d.maxRange)
	ticker := time.NewTicker(d.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			slog.Info("alpha cashier deposit scanner stopped")
			return
		case <-ticker.C:
			d.tick(ctx)
		}
	}
}

func (d *DepositScanner) tick(ctx context.Context) {
	svc := d.svc
	if svc == nil || svc.evmClient == nil || svc.ledger == nil || !svc.cfg.Enabled || !svc.cfg.DepositScannerEnabled {
		return
	}
	unlock, ok, err := svc.repo.TryLockScanner(ctx, depositScannerName)
	if err != nil {
		slog.WarnContext(ctx, "alpha cashier deposit scanner: lock failed", "error", err)
		return
	}
	if !ok {
		return // another replica is scanning
	}
	defer unlock()

	head, err := retryRPC(ctx, d.retries, d.backoff, func() (uint64, error) {
		return svc.evmClient.BlockNumber(ctx)
	})
	if err != nil {
		slog.WarnContext(ctx, "alpha cashier deposit scanner: head unavailable", "error", err)
		return
	}
	// A block b has head-b+1 confirmations; scan only blocks that already
	// meet the requirement, so SubmitDepositTx does not refuse them as
	// still confirming.
	confs := uint64(svc.cfg.Confirmations)
	if confs == 0 {
		confs = 1
	}
	if head+1 < confs {
		return
	}
	safeHead := head + 1 - confs

	next, found, err := svc.repo.GetScanCursor(ctx, depositScannerName)
	if err != nil {
		slog.WarnContext(ctx, "alpha cashier deposit scanner: cursor unavailable", "error", err)
		return
	}
	if !found {
		// Fresh start: begin at the confirmed head, never at genesis.
		next = safeHead
		if err := svc.repo.SetScanCursor(ctx, depositScannerName, next); err != nil {
			slog.WarnContext(ctx, "alpha cashier deposit scanner: cursor save failed", "error", err)
			return
		}
	}

	token := common.HexToAddress(svc.cfg.TokenAddress)
	treasury := common.HexToAddress(svc.cfg.TreasuryAddress)
	for next <= safeHead {
		if ctx.Err() != nil {
			return
		}
		to := next + d.maxRange - 1
		if to > safeHead {
			to = safeHead
		}
		from := next
		transfers, err := retryRPC(ctx, d.retries, d.backoff, func() ([]TransferLog, error) {
			return svc.evmClient.FilterTransfers(ctx, token, treasury, from, to)
		})
		if err != nil {
			// Cursor stays put: the same range is retried next tick.
			slog.WarnContext(ctx, "alpha cashier deposit scanner: log query failed",
				"from", from, "to", to, "error", err)
			return
		}
		for _, t := range transfers {
			d.handleTransfer(ctx, t)
		}
		next = to + 1
		if err := svc.repo.SetScanCursor(ctx, depositScannerName, next); err != nil {
			slog.WarnContext(ctx, "alpha cashier deposit scanner: cursor save failed", "error", err)
			return
		}
	}
}

// handleTransfer submits the one open intent a treasury transfer satisfies,
// through the verified SubmitDepositTx path, or audits an unmatched transfer.
func (d *DepositScanner) handleTransfer(ctx context.Context, t TransferLog) {
	svc := d.svc
	now := svc.now().UTC()
	transferID := t.TxHash + ":" + strconv.FormatUint(uint64(t.LogIndex), 10)
	intent, err := svc.repo.FindOpenDepositIntentForTransfer(ctx, svc.cfg.ChainID, t.From, t.AmountUnits, now)
	if err != nil {
		slog.WarnContext(ctx, "alpha cashier deposit scanner: intent lookup failed", "transfer", transferID, "error", err)
		return
	}
	payload := map[string]any{
		"txHash":      t.TxHash,
		"logIndex":    t.LogIndex,
		"blockNumber": t.BlockNumber,
		"fromAddress": t.From,
		"amountUnits": t.AmountUnits,
	}
	if intent == nil {
		svc.auditOrLog(ctx, "treasury_transfer", transferID, "alpha_cashier.deposit.unmatched_transfer", "system", "alpha-cashier-scanner", payload)
		return
	}
	payload["depositIntentId"] = intent.ID
	payload["userId"] = intent.UserID
	if _, err := svc.SubmitDepositTx(ctx, intent.UserID, intent.ID, t.TxHash); err != nil {
		payload["error"] = err.Error()
		svc.auditOrLog(ctx, "deposit_intent", intent.ID, "alpha_cashier.deposit.auto_submit_failed", "system", "alpha-cashier-scanner", payload)
		return
	}
	svc.auditOrLog(ctx, "deposit_intent", intent.ID, "alpha_cashier.deposit.auto_detected", "system", "alpha-cashier-scanner", payload)
}

// retryRPC retries an RPC call with exponential backoff (the branch
// prototype hit a failing provider once per tick, forever).
func retryRPC[T any](ctx context.Context, attempts int, backoff time.Duration, call func() (T, error)) (T, error) {
	var zero T
	var err error
	for i := 0; i < attempts; i++ {
		var v T
		if v, err = call(); err == nil {
			return v, nil
		}
		if i == attempts-1 {
			break
		}
		select {
		case <-ctx.Done():
			return zero, ctx.Err()
		case <-time.After(backoff << i):
		}
	}
	return zero, err
}
