package alphacashier

import (
	"context"
	"errors"
	"math/big"
	"sync"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

// scanEVM is a fake chain for the deposit scanner: a head, receipts by hash,
// and treasury transfers by block, recording every range it was asked for.
type scanEVM struct {
	mu        sync.Mutex
	head      uint64
	receipts  map[common.Hash]*types.Receipt
	transfers []TransferLog
	failLogs  bool
	ranges    [][2]uint64
}

func (c *scanEVM) TransactionReceipt(_ context.Context, h common.Hash) (*types.Receipt, error) {
	if r, ok := c.receipts[h]; ok {
		return r, nil
	}
	return nil, errors.New("not found")
}
func (c *scanEVM) BlockNumber(context.Context) (uint64, error) { return c.head, nil }
func (c *scanEVM) TokenBalance(context.Context, common.Address, common.Address) (*big.Int, error) {
	return big.NewInt(0), nil
}
func (c *scanEVM) FilterTransfers(_ context.Context, _ common.Address, to common.Address, from, until uint64) ([]TransferLog, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.ranges = append(c.ranges, [2]uint64{from, until})
	if c.failLogs {
		return nil, errors.New("rpc 503")
	}
	out := []TransferLog{}
	for _, t := range c.transfers {
		if t.BlockNumber >= from && t.BlockNumber <= until && common.HexToAddress(t.To) == to {
			out = append(out, t)
		}
	}
	return out, nil
}

func scannerConfig() Config {
	cfg := testConfig()
	cfg.DepositScannerEnabled = true
	return cfg
}

func newTestScanner(svc *Service) *DepositScanner {
	d := NewDepositScanner(svc, time.Minute)
	d.backoff = time.Millisecond
	return d
}

// seedOpenIntent stores an unexpired intent awaiting a transfer of units
// from `from` into the treasury.
func seedOpenIntent(t *testing.T, repo *MemoryRepository, userID string, from common.Address, units string) *DepositIntent {
	t.Helper()
	cfg := testConfig()
	now := time.Now().UTC()
	intent, err := repo.SaveDepositIntent(context.Background(), DepositIntent{
		UserID:          userID,
		ChainID:         cfg.ChainID,
		ChainName:       cfg.ChainName,
		TokenSymbol:     cfg.TokenSymbol,
		TokenAddress:    common.HexToAddress(cfg.TokenAddress).Hex(),
		TokenDecimals:   cfg.TokenDecimals,
		TreasuryAddress: common.HexToAddress(cfg.TreasuryAddress).Hex(),
		FromAddress:     from.Hex(),
		AmountCents:     2500,
		AmountUnits:     units,
		Status:          "created",
		IdempotencyKey:  "scan-" + userID,
		ExpiresAt:       now.Add(time.Hour),
		CreatedAt:       now,
		UpdatedAt:       now,
	})
	if err != nil {
		t.Fatalf("SaveDepositIntent: %v", err)
	}
	return intent
}

func TestDepositScannerFreshStartBeginsAtConfirmedHead(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewService(scannerConfig(), repo)
	svc.SetWalletLedger(&fakeLedger{})
	chain := &scanEVM{head: 5000}
	svc.SetEVMClient(chain)
	newTestScanner(svc).tick(context.Background())
	// 12 confirmations: the highest scannable block is 5000+1-12 = 4989.
	if len(chain.ranges) != 1 || chain.ranges[0] != [2]uint64{4989, 4989} {
		t.Fatalf("fresh start must scan only the confirmed head, got %v", chain.ranges)
	}
	next, ok, _ := repo.GetScanCursor(context.Background(), depositScannerName)
	if !ok || next != 4990 {
		t.Fatalf("cursor after first scan: got %d ok=%v, want 4990", next, ok)
	}
}

func TestDepositScannerCreditsAMatchingTransferOnce(t *testing.T) {
	ctx := context.Background()
	repo := NewMemoryRepository()
	svc := NewService(scannerConfig(), repo)
	ledger := &fakeLedger{}
	svc.SetWalletLedger(ledger)
	cfg := testConfig()
	token := common.HexToAddress(cfg.TokenAddress)
	treasury := common.HexToAddress(cfg.TreasuryAddress)
	user := common.HexToAddress("0x00000000000000000000000000000000000000aa")
	intent := seedOpenIntent(t, repo, "u-scan", user, "25000000")
	txHash := "0x3333333333333333333333333333333333333333333333333333333333333333"
	chain := &scanEVM{
		head:     1100,
		receipts: map[common.Hash]*types.Receipt{common.HexToHash(txHash): transferReceipt(txHash, token, user, treasury, 25000000, 1050)},
		transfers: []TransferLog{{
			TxHash: txHash, BlockNumber: 1050, From: user.Hex(), To: treasury.Hex(), AmountUnits: "25000000",
		}},
	}
	svc.SetEVMClient(chain)
	if err := repo.SetScanCursor(ctx, depositScannerName, 1000); err != nil {
		t.Fatal(err)
	}
	scanner := newTestScanner(svc)
	scanner.tick(ctx)
	got, _ := repo.GetDepositIntent(ctx, intent.ID)
	if got.Status != "credited" || ledger.calls != 1 {
		t.Fatalf("matching transfer must credit once: status=%s calls=%d", got.Status, ledger.calls)
	}
	// A rescan of the same range (cursor reset) does not credit again.
	_ = repo.SetScanCursor(ctx, depositScannerName, 1000)
	scanner.tick(ctx)
	if ledger.calls != 1 {
		t.Fatalf("rescan must not credit again, calls=%d", ledger.calls)
	}
}

func TestDepositScannerAuditsUnmatchedTransfers(t *testing.T) {
	ctx := context.Background()
	repo := NewMemoryRepository()
	svc := NewService(scannerConfig(), repo)
	ledger := &fakeLedger{}
	svc.SetWalletLedger(ledger)
	treasury := common.HexToAddress(testConfig().TreasuryAddress)
	chain := &scanEVM{head: 1100, transfers: []TransferLog{{
		TxHash: "0x4444444444444444444444444444444444444444444444444444444444444444", BlockNumber: 1050,
		From: "0x00000000000000000000000000000000000000bb", To: treasury.Hex(), AmountUnits: "1",
	}}}
	svc.SetEVMClient(chain)
	_ = repo.SetScanCursor(ctx, depositScannerName, 1000)
	newTestScanner(svc).tick(ctx)
	if ledger.calls != 0 {
		t.Fatalf("an unmatched transfer must never be credited, calls=%d", ledger.calls)
	}
	events, _ := repo.ListAuditEvents(ctx, AuditEventFilter{EventType: "alpha_cashier.deposit.unmatched_transfer"})
	if len(events) != 1 {
		t.Fatalf("want one unmatched_transfer audit, got %d", len(events))
	}
}

func TestDepositScannerKeepsCursorOnRPCFailure(t *testing.T) {
	ctx := context.Background()
	repo := NewMemoryRepository()
	svc := NewService(scannerConfig(), repo)
	svc.SetWalletLedger(&fakeLedger{})
	chain := &scanEVM{head: 1100, failLogs: true}
	svc.SetEVMClient(chain)
	_ = repo.SetScanCursor(ctx, depositScannerName, 1000)
	newTestScanner(svc).tick(ctx)
	next, _, _ := repo.GetScanCursor(ctx, depositScannerName)
	if next != 1000 {
		t.Fatalf("a failed range must be retried next tick, cursor moved to %d", next)
	}
	if len(chain.ranges) != defaultScanRPCRetries {
		t.Fatalf("want %d attempts with backoff, got %d", defaultScanRPCRetries, len(chain.ranges))
	}
}

func TestDepositScannerStandsDownWhenLockedOrDisabled(t *testing.T) {
	ctx := context.Background()
	repo := NewMemoryRepository()
	svc := NewService(scannerConfig(), repo)
	svc.SetWalletLedger(&fakeLedger{})
	chain := &scanEVM{head: 1100}
	svc.SetEVMClient(chain)
	unlock, ok, _ := repo.TryLockScanner(ctx, depositScannerName)
	if !ok {
		t.Fatal("lock")
	}
	newTestScanner(svc).tick(ctx)
	unlock()
	if len(chain.ranges) != 0 {
		t.Fatalf("a scanner held by another replica must not scan, got %v", chain.ranges)
	}

	off := NewService(testConfig(), NewMemoryRepository()) // scanner flag off
	off.SetWalletLedger(&fakeLedger{})
	offChain := &scanEVM{head: 1100}
	off.SetEVMClient(offChain)
	newTestScanner(off).tick(ctx)
	if len(offChain.ranges) != 0 {
		t.Fatalf("the scanner must not run with its flag off, got %v", offChain.ranges)
	}
}
