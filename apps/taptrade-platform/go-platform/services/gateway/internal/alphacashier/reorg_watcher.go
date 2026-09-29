package alphacashier

import (
	"context"
	"log/slog"
	"time"
)

// reorgWatcherListLimit bounds how many credited deposits one tick re-checks.
const reorgWatcherListLimit = 500

// ReorgWatcher periodically re-verifies the finality of credited deposits and
// freezes any whose backing transaction was orphaned by a chain reorg (audit
// A2-03). It is the interim guard that wires the otherwise-uncalled
// CheckDepositFinality / FreezeReorgedDeposit together — same shape as the
// prediction MarketCloser worker: a Run loop driving a tick.
//
// This is a safety net for the live custodial rail until the production-grade
// services/bridge-watcher (P3-09) lands; it is started only when the rail is
// enabled.
type ReorgWatcher struct {
	svc      *Service
	interval time.Duration
}

// NewReorgWatcher creates a reorg finality watcher over the given service.
func NewReorgWatcher(svc *Service, interval time.Duration) *ReorgWatcher {
	return &ReorgWatcher{svc: svc, interval: interval}
}

// Run starts the watcher loop. Blocks until ctx is cancelled.
func (w *ReorgWatcher) Run(ctx context.Context) {
	slog.Info("alpha cashier reorg watcher started", "interval", w.interval)
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			slog.Info("alpha cashier reorg watcher stopped")
			return
		case <-ticker.C:
			w.tick(ctx)
		}
	}
}

func (w *ReorgWatcher) tick(ctx context.Context) {
	svc := w.svc
	// Fail-closed guard: without an EVM client we cannot re-verify finality, and
	// without a ledger we cannot freeze. Skip the tick rather than crash — the
	// rail may be enabled before the RPC client connects.
	if svc == nil || svc.evmClient == nil || svc.ledger == nil {
		return
	}

	deposits, err := svc.repo.ListCreditedDepositsForFinality(ctx, reorgWatcherListLimit)
	if err != nil {
		slog.WarnContext(ctx, "alpha cashier reorg watcher: failed to list credited deposits", "error", err)
		return
	}

	finalityConfs := svc.cfg.FinalityConfirmations()
	now := svc.now().UTC()
	reorged, finalized := 0, 0
	for _, dep := range deposits {
		status, err := CheckDepositFinality(ctx, svc.evmClient, dep.Tx, finalityConfs)
		if err != nil {
			slog.WarnContext(ctx, "alpha cashier reorg watcher: finality check failed",
				"deposit_id", dep.DepositID, "tx_hash", dep.Tx.TxHash, "error", err)
			continue
		}
		switch status {
		case FinalityFinalized:
			// Finality-deep: retire it from the watch list (migration 065).
			if err := svc.repo.MarkDepositFinalized(ctx, dep.DepositID, now); err != nil {
				slog.WarnContext(ctx, "alpha cashier reorg watcher: failed to mark deposit final",
					"deposit_id", dep.DepositID, "error", err)
				continue
			}
			finalized++
		case FinalityReorged:
			first, err := svc.repo.MarkDepositReorgDetected(ctx, dep.DepositID, now)
			if err != nil {
				slog.WarnContext(ctx, "alpha cashier reorg watcher: failed to record reorg",
					"deposit_id", dep.DepositID, "error", err)
			}
			if err := svc.FreezeReorgedDeposit(ctx, dep.DepositID, dep.UserID, dep.AmountCents); err != nil {
				// Typically the points were already spent, so the hold cannot
				// be placed. Escalate once (audit + error log); later ticks
				// keep retrying the freeze quietly.
				if first {
					slog.ErrorContext(ctx, "alpha cashier: REORG on credited deposit and the freeze failed — unbacked credit needs manual recovery",
						"deposit_id", dep.DepositID, "user_id", dep.UserID, "amount_cents", dep.AmountCents, "error", err)
					svc.auditOrLog(ctx, "deposit_intent", dep.DepositID, "alpha_cashier.deposit.reorg_unrecovered", "system", "alpha-cashier", map[string]any{
						"userId":      dep.UserID,
						"amountCents": dep.AmountCents,
						"error":       err.Error(),
					})
				} else {
					slog.WarnContext(ctx, "alpha cashier reorg watcher: freeze still failing",
						"deposit_id", dep.DepositID, "error", err)
				}
				continue
			}
			reorged++
		}
	}

	if reorged > 0 || finalized > 0 {
		slog.InfoContext(ctx, "alpha cashier reorg watcher tick", "reorged", reorged, "finalized", finalized, "scanned", len(deposits))
	}
}
