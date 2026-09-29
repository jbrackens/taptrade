package alphacashier

import (
	"context"
	"math/big"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"

	"taptrade/gateway/internal/wallet"
)

// reorgTestReceipt builds a successful receipt at a given block/hash for the
// matching tx hash, for the not-reorged (finalized) path.
func reorgTestReceipt(block int64, blockHashSeed, txHash string) *types.Receipt {
	return &types.Receipt{
		TxHash:      common.HexToHash(txHash),
		Status:      types.ReceiptStatusSuccessful,
		BlockNumber: big.NewInt(block),
		BlockHash:   common.HexToHash(blockHashSeed),
	}
}

// Audit A2-03: the reorg watcher must walk credited deposits, detect the ones
// whose backing tx vanished from the canonical chain, and freeze the (now
// unbacked) balance. Uses the memory repo + a fake EVM client returning a
// NotFound receipt (the orphaned-by-reorg case).
func TestReorgWatcherFreezesReorgedDeposit(t *testing.T) {
	ctx := context.Background()
	repo := NewMemoryRepository()
	svc := NewService(testConfig(), repo)
	ledger := &fakeLedger{}
	svc.SetWalletLedger(ledger)
	// fakeEVMClient with receipt==nil → TransactionReceipt returns NotFound →
	// CheckDepositFinality reports FinalityReorged.
	svc.SetEVMClient(fakeEVMClient{receipt: nil, latest: 1000})

	now := time.Now().UTC()
	// Seed a credited deposit with recorded chain evidence so the finality
	// join (ListCreditedDepositsForFinality) returns it.
	intent, err := repo.SaveDepositIntent(ctx, DepositIntent{
		UserID:      "u-1",
		ChainID:     8453,
		AmountCents: 2500,
		Status:      "created",
		CreatedAt:   now,
		UpdatedAt:   now,
	})
	if err != nil {
		t.Fatalf("SaveDepositIntent: %v", err)
	}
	if err := repo.RecordChainTransaction(ctx, ChainTransaction{
		DepositIntentID: intent.ID,
		ChainID:         8453,
		TxHash:          "0x00000000000000000000000000000000000000000000000000000000000000aa",
		BlockNumber:     100,
		BlockHash:       common.HexToHash("0xabc123").Hex(),
		AmountUnits:     "25000000",
		Confirmations:   12,
		ReceiptStatus:   "success",
		CreatedAt:       now,
	}); err != nil {
		t.Fatalf("RecordChainTransaction: %v", err)
	}
	if _, err := repo.MarkDepositCredited(ctx, intent.ID, "le:test", now, now); err != nil {
		t.Fatalf("MarkDepositCredited: %v", err)
	}

	watcher := NewReorgWatcher(svc, time.Minute)
	watcher.tick(ctx)

	if len(ledger.holds) != 1 {
		t.Fatalf("expected exactly one freeze hold after reorg detection, got %d", len(ledger.holds))
	}
	for _, h := range ledger.holds {
		if h.AmountPoints != 2500 || h.ReferenceType != "alpha_cashier_reorg_freeze" {
			t.Fatalf("unexpected freeze hold: %+v", h)
		}
	}

	// A still-canonical, finalized deposit must NOT be frozen: swap in a client
	// whose receipt matches the credited block/hash at finality depth.
	repo2 := NewMemoryRepository()
	svc2 := NewService(testConfig(), repo2)
	ledger2 := &fakeLedger{}
	svc2.SetWalletLedger(ledger2)
	svc2.SetEVMClient(fakeEVMClient{receipt: reorgTestReceipt(100, "0xabc123", "0x00000000000000000000000000000000000000000000000000000000000000bb"), latest: 1000})
	seedCreditedWithEvidence(t, ctx, repo2, "u-2", 4200, "0xabc123")
	NewReorgWatcher(svc2, time.Minute).tick(ctx)
	if len(ledger2.holds) != 0 {
		t.Fatalf("finalized deposit must not be frozen, got %d holds", len(ledger2.holds))
	}
}

// TestReorgWatcherTickGuards verifies the tick is a no-op when the EVM client
// or ledger is missing (fail-closed: skip, don't panic).
func TestReorgWatcherTickGuards(t *testing.T) {
	ctx := context.Background()
	repo := NewMemoryRepository()
	svc := NewService(testConfig(), repo)
	// No EVM client, no ledger set.
	NewReorgWatcher(svc, time.Minute).tick(ctx) // must not panic

	ledger := &fakeLedger{}
	svc.SetWalletLedger(ledger)
	// Ledger set but still no EVM client → still a no-op.
	NewReorgWatcher(svc, time.Minute).tick(ctx)
	if len(ledger.holds) != 0 {
		t.Fatalf("guarded tick must place no holds, got %d", len(ledger.holds))
	}
}

func seedCreditedWithEvidence(t *testing.T, ctx context.Context, repo *MemoryRepository, userID string, amountCents int64, blockHashSeed string) {
	t.Helper()
	now := time.Now().UTC()
	intent, err := repo.SaveDepositIntent(ctx, DepositIntent{
		UserID:      userID,
		ChainID:     8453,
		AmountCents: amountCents,
		Status:      "created",
		CreatedAt:   now,
		UpdatedAt:   now,
	})
	if err != nil {
		t.Fatalf("SaveDepositIntent: %v", err)
	}
	if err := repo.RecordChainTransaction(ctx, ChainTransaction{
		DepositIntentID: intent.ID,
		ChainID:         8453,
		TxHash:          "0x00000000000000000000000000000000000000000000000000000000000000bb",
		BlockNumber:     100,
		BlockHash:       common.HexToHash(blockHashSeed).Hex(),
		AmountUnits:     "42000000",
		Confirmations:   12,
		ReceiptStatus:   "success",
		CreatedAt:       now,
	}); err != nil {
		t.Fatalf("RecordChainTransaction: %v", err)
	}
	if _, err := repo.MarkDepositCredited(ctx, intent.ID, "le:test", now, now); err != nil {
		t.Fatalf("MarkDepositCredited: %v", err)
	}
}

// 2026-09-29 audit: a finality-deep deposit is retired from the watch list,
// so the watcher's LIMIT walks the whole backlog instead of re-checking the
// same rows forever.
func TestReorgWatcherRetiresFinalizedDeposits(t *testing.T) {
	ctx := context.Background()
	repo := NewMemoryRepository()
	svc := NewService(testConfig(), repo)
	svc.SetWalletLedger(&fakeLedger{})
	svc.SetEVMClient(fakeEVMClient{receipt: reorgTestReceipt(100, "0xabc123", "0x00000000000000000000000000000000000000000000000000000000000000bb"), latest: 1000})
	seedCreditedWithEvidence(t, ctx, repo, "u-3", 1000, "0xabc123")

	before, _ := repo.ListCreditedDepositsForFinality(ctx, 10)
	if len(before) != 1 {
		t.Fatalf("seeded deposit should be on the watch list, got %d", len(before))
	}
	NewReorgWatcher(svc, time.Minute).tick(ctx)
	after, _ := repo.ListCreditedDepositsForFinality(ctx, 10)
	if len(after) != 0 {
		t.Fatalf("a finalized deposit must leave the watch list, got %d", len(after))
	}
}

// failingHoldLedger cannot place holds (the credited points were spent).
type failingHoldLedger struct{ fakeLedger }

func (l *failingHoldLedger) Hold(context.Context, wallet.HoldRequest) (wallet.Reservation, error) {
	return wallet.Reservation{}, wallet.ErrInsufficientFunds
}

// A reorg whose freeze cannot be placed is escalated once (audit event), not
// on every tick; the watcher keeps retrying the freeze.
func TestReorgWatcherEscalatesUnrecoverableReorgOnce(t *testing.T) {
	ctx := context.Background()
	repo := NewMemoryRepository()
	svc := NewService(testConfig(), repo)
	svc.SetWalletLedger(&failingHoldLedger{})
	svc.SetEVMClient(fakeEVMClient{receipt: nil, latest: 1000}) // orphaned
	seedCreditedWithEvidence(t, ctx, repo, "u-4", 1500, "0xabc123")

	w := NewReorgWatcher(svc, time.Minute)
	w.tick(ctx)
	w.tick(ctx)
	w.tick(ctx)
	events, err := repo.ListAuditEvents(ctx, AuditEventFilter{})
	if err != nil {
		t.Fatalf("ListAuditEvents: %v", err)
	}
	escalations := 0
	for _, e := range events {
		if e.EventType == "alpha_cashier.deposit.reorg_unrecovered" {
			escalations++
		}
	}
	if escalations != 1 {
		t.Fatalf("want exactly one reorg_unrecovered escalation over three ticks, got %d", escalations)
	}
}
