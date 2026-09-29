package alphacashier

import (
	"context"
	"errors"
	"math/big"
	"sync"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/ethereum/go-ethereum/accounts"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"

	"taptrade/gateway/internal/wallet"
)

func TestServiceWalletConnectAndDepositIntent(t *testing.T) {
	key, err := crypto.HexToECDSA("4c0883a69102937d6231471b5dbb6204fe51296170827944e48f8b7f95b35c5f")
	if err != nil {
		t.Fatalf("private key fixture: %v", err)
	}
	address := crypto.PubkeyToAddress(key.PublicKey).Hex()
	svc := NewService(testConfig(), NewMemoryRepository())
	fixedNow := time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return fixedNow }

	challenge, err := svc.CreateWalletChallenge(context.Background(), "u-1", address)
	if err != nil {
		t.Fatalf("CreateWalletChallenge: %v", err)
	}
	sig, err := crypto.Sign(accounts.TextHash([]byte(challenge.Message)), key)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	conn, err := svc.ConnectWallet(context.Background(), "u-1", challenge.Nonce, hexutil.Encode(sig))
	if err != nil {
		t.Fatalf("ConnectWallet: %v", err)
	}
	if conn.NormalizedAddress == "" {
		t.Fatalf("expected normalized address")
	}

	intent, err := svc.CreateDepositIntent(context.Background(), "u-1", address, 2500, "idem-1")
	if err != nil {
		t.Fatalf("CreateDepositIntent: %v", err)
	}
	if intent.AmountUnits != "25000000" {
		t.Fatalf("amount units: got %s, want 25000000", intent.AmountUnits)
	}
	if intent.Status != "created" {
		t.Fatalf("status: got %s", intent.Status)
	}

	replay, err := svc.CreateDepositIntent(context.Background(), "u-1", address, 2500, "idem-1")
	if err != nil {
		t.Fatalf("CreateDepositIntent replay: %v", err)
	}
	if replay.ID != intent.ID {
		t.Fatalf("idempotent replay returned different intent: %s vs %s", replay.ID, intent.ID)
	}
}

func TestServiceCreateDepositIntentRequiresConnectedWallet(t *testing.T) {
	svc := NewService(testConfig(), NewMemoryRepository())
	_, err := svc.CreateDepositIntent(context.Background(), "u-1", "0x0000000000000000000000000000000000000009", 2500, "idem-1")
	if err == nil {
		t.Fatalf("expected unconnected wallet to fail")
	}
}

func TestServiceDisabledFailsClosed(t *testing.T) {
	svc := NewService(Config{Enabled: false}, NewMemoryRepository())
	_, err := svc.CreateWalletChallenge(context.Background(), "u-1", "0x0000000000000000000000000000000000000009")
	if err == nil {
		t.Fatalf("expected disabled service to fail")
	}
}

func TestServiceCreateWithdrawalRequestHoldsFunds(t *testing.T) {
	svc := NewService(testConfig(), NewMemoryRepository())
	ledger := &fakeLedger{}
	svc.SetWalletLedger(ledger)
	req, err := svc.CreateWithdrawalRequest(context.Background(), "u-1", "0x0000000000000000000000000000000000000009", 2500, "wd-1")
	if err != nil {
		t.Fatalf("CreateWithdrawalRequest: %v", err)
	}
	if req.Status != "requested" || req.AmountUnits != "25000000" || req.WalletReservationID == "" {
		t.Fatalf("unexpected withdrawal request: %+v", req)
	}
	if got := ledger.holds[req.ID]; got.ReferenceType != withdrawalReferenceType || got.AmountPoints != 2500 {
		t.Fatalf("hold not recorded correctly: %+v", got)
	}

	replay, err := svc.CreateWithdrawalRequest(context.Background(), "u-1", "0x0000000000000000000000000000000000000009", 2500, "wd-1")
	if err != nil {
		t.Fatalf("CreateWithdrawalRequest replay: %v", err)
	}
	if replay.ID != req.ID {
		t.Fatalf("idempotent replay returned different request: %s vs %s", replay.ID, req.ID)
	}
}

func TestServiceWithdrawalReviewLifecycle(t *testing.T) {
	svc := NewService(testConfig(), NewMemoryRepository())
	ledger := &fakeLedger{}
	svc.SetWalletLedger(ledger)
	svc.SetEVMClient(payoutClient(testTxHash(), 25000000))
	req, err := svc.CreateWithdrawalRequest(context.Background(), "u-1", "0x0000000000000000000000000000000000000009", 2500, "wd-1")
	if err != nil {
		t.Fatalf("CreateWithdrawalRequest: %v", err)
	}
	approved, err := svc.ApproveWithdrawal(context.Background(), req.ID, "admin-1", "manual alpha approval")
	if err != nil {
		t.Fatalf("ApproveWithdrawal: %v", err)
	}
	if approved.Status != "approved" {
		t.Fatalf("approved status: got %s", approved.Status)
	}
	broadcasted, err := svc.MarkWithdrawalBroadcasted(context.Background(), req.ID, "admin-1", testTxHash())
	if err != nil {
		t.Fatalf("MarkWithdrawalBroadcasted: %v", err)
	}
	if broadcasted.Status != "broadcasted" || broadcasted.BroadcastTxHash == "" {
		t.Fatalf("broadcasted request: %+v", broadcasted)
	}
	completed, err := svc.MarkWithdrawalCompleted(context.Background(), req.ID, "admin-1")
	if err != nil {
		t.Fatalf("MarkWithdrawalCompleted: %v", err)
	}
	if completed.Status != "completed" {
		t.Fatalf("completed status: got %s", completed.Status)
	}
	if len(ledger.captured) != 1 {
		t.Fatalf("capture calls: got %d, want 1", len(ledger.captured))
	}
}

func TestServiceApproveWithdrawalRequiresReviewNote(t *testing.T) {
	svc := NewService(testConfig(), NewMemoryRepository())
	svc.SetWalletLedger(&fakeLedger{})
	req, err := svc.CreateWithdrawalRequest(context.Background(), "u-1", "0x0000000000000000000000000000000000000009", 2500, "wd-1")
	if err != nil {
		t.Fatalf("CreateWithdrawalRequest: %v", err)
	}
	if _, err := svc.ApproveWithdrawal(context.Background(), req.ID, "admin-1", " "); err != ErrReviewNoteRequired {
		t.Fatalf("ApproveWithdrawal got %v, want ErrReviewNoteRequired", err)
	}
}

func TestServiceRejectWithdrawalReleasesFunds(t *testing.T) {
	svc := NewService(testConfig(), NewMemoryRepository())
	ledger := &fakeLedger{}
	svc.SetWalletLedger(ledger)
	req, err := svc.CreateWithdrawalRequest(context.Background(), "u-1", "0x0000000000000000000000000000000000000009", 2500, "wd-1")
	if err != nil {
		t.Fatalf("CreateWithdrawalRequest: %v", err)
	}
	rejected, err := svc.RejectWithdrawal(context.Background(), req.ID, "admin-1", "destination mismatch")
	if err != nil {
		t.Fatalf("RejectWithdrawal: %v", err)
	}
	if rejected.Status != "rejected" {
		t.Fatalf("rejected status: got %s", rejected.Status)
	}
	if len(ledger.released) != 1 {
		t.Fatalf("release calls: got %d, want 1", len(ledger.released))
	}
}

func TestServicePreflightDisabledWarnsWithoutFailing(t *testing.T) {
	svc := NewService(Config{Enabled: false}, NewMemoryRepository())
	report := svc.Preflight(context.Background())
	if report.Overall != "warn" {
		t.Fatalf("overall got %s, want warn", report.Overall)
	}
	if report.Enabled {
		t.Fatalf("expected disabled report")
	}
}

func TestServicePreflightEnabledPassesWithRPCAndLedger(t *testing.T) {
	svc := NewService(testConfig(), NewMemoryRepository())
	svc.SetWalletLedger(&fakeLedger{})
	svc.SetEVMClient(fakeEVMClient{latest: 1234, balance: bigInt(25000000)})
	report := svc.Preflight(context.Background())
	if report.Overall != "warn" {
		t.Fatalf("overall got %s, want warn because withdrawal queue is enabled in test config", report.Overall)
	}
	foundRPC := false
	foundBalance := false
	for _, check := range report.Checks {
		if check.Key == "evm_rpc.block_number" && check.Status == "pass" {
			foundRPC = true
		}
		if check.Key == "treasury.balance" && check.Status == "pass" {
			foundBalance = true
		}
		if check.IsFailure() {
			t.Fatalf("unexpected failure check: %+v", check)
		}
	}
	if !foundRPC || !foundBalance {
		t.Fatalf("expected RPC and balance preflight checks, got %+v", report.Checks)
	}
}

func TestServiceReconciliationSummaryIncludesTreasuryBalance(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewService(testConfig(), repo)
	svc.SetEVMClient(fakeEVMClient{balance: bigInt(25000000)})
	now := svc.now().UTC()
	if _, err := repo.SaveDepositIntent(context.Background(), DepositIntent{
		UserID:         "u-1",
		AmountCents:    2500,
		AmountUnits:    "25000000",
		Status:         "created",
		IdempotencyKey: "dep-1",
		ExpiresAt:      now.Add(time.Hour),
		CreatedAt:      now,
		UpdatedAt:      now,
	}); err != nil {
		t.Fatalf("SaveDepositIntent: %v", err)
	}
	if _, err := repo.MarkDepositCredited(context.Background(), "adi:mem:1", "le-1", now, now); err != nil {
		t.Fatalf("MarkDepositCredited: %v", err)
	}
	summary, err := svc.ReconciliationSummary(context.Background())
	if err != nil {
		t.Fatalf("ReconciliationSummary: %v", err)
	}
	if summary.CreditedDepositCents != 2500 || summary.TreasuryBalanceCents != 2500 || summary.CashierDriftCents != 0 {
		t.Fatalf("unexpected summary: %+v", summary)
	}
}

func testConfig() Config {
	return Config{
		Enabled:                true,
		ChainID:                8453,
		ChainName:              "base",
		RPCURL:                 "https://rpc.example",
		TokenSymbol:            "USDC",
		TokenAddress:           "0x0000000000000000000000000000000000000001",
		TokenDecimals:          6,
		TreasuryAddress:        "0x0000000000000000000000000000000000000002",
		Confirmations:          12,
		MinDepositCents:        100,
		MaxDepositCents:        25000,
		DailyDepositLimitCents: 100000,
		WithdrawalsEnabled:     true,
		WithdrawalReviewNeeded: true,
	}
}

func bigInt(n int64) *big.Int {
	return big.NewInt(n)
}

// payoutClient answers with a confirmed payout of amountUnits of the test
// token from the treasury to the test destination (0x…09).
func payoutClient(txHash string, amountUnits int64) fakeEVMClient {
	cfg := testConfig()
	return fakeEVMClient{
		latest: 120,
		receipt: transferReceipt(txHash,
			common.HexToAddress(cfg.TokenAddress),
			common.HexToAddress(cfg.TreasuryAddress),
			common.HexToAddress("0x0000000000000000000000000000000000000009"),
			amountUnits, 100),
	}
}

// broadcastWithdrawal walks a 25.00 withdrawal to "broadcasted".
func broadcastWithdrawal(t *testing.T, svc *Service) *WithdrawalRequest {
	t.Helper()
	req, err := svc.CreateWithdrawalRequest(context.Background(), "u-1", "0x0000000000000000000000000000000000000009", 2500, "wd-verify")
	if err != nil {
		t.Fatalf("CreateWithdrawalRequest: %v", err)
	}
	if _, err := svc.ApproveWithdrawal(context.Background(), req.ID, "admin-1", "approved"); err != nil {
		t.Fatalf("ApproveWithdrawal: %v", err)
	}
	broadcasted, err := svc.MarkWithdrawalBroadcasted(context.Background(), req.ID, "admin-2", testTxHash())
	if err != nil {
		t.Fatalf("MarkWithdrawalBroadcasted: %v", err)
	}
	return broadcasted
}

// 2026-09-29 audit: completion captures the reserved points, so it must be
// backed by the payout on chain, not the operator's say-so.
func TestServiceWithdrawalCompletionRequiresChainEvidence(t *testing.T) {
	t.Run("no EVM client: refused, nothing captured", func(t *testing.T) {
		svc := NewService(testConfig(), NewMemoryRepository())
		ledger := &fakeLedger{}
		svc.SetWalletLedger(ledger)
		req := broadcastWithdrawal(t, svc)
		if _, err := svc.MarkWithdrawalCompleted(context.Background(), req.ID, "admin-2"); !errors.Is(err, ErrTxVerificationMissing) {
			t.Fatalf("want ErrTxVerificationMissing, got %v", err)
		}
		if len(ledger.captured) != 0 {
			t.Fatalf("nothing may be captured without evidence, got %v", ledger.captured)
		}
	})
	t.Run("wrong amount on chain: refused, nothing captured", func(t *testing.T) {
		svc := NewService(testConfig(), NewMemoryRepository())
		ledger := &fakeLedger{}
		svc.SetWalletLedger(ledger)
		svc.SetEVMClient(payoutClient(testTxHash(), 24000000))
		req := broadcastWithdrawal(t, svc)
		if _, err := svc.MarkWithdrawalCompleted(context.Background(), req.ID, "admin-2"); !errors.Is(err, ErrTransferMismatch) {
			t.Fatalf("want ErrTransferMismatch, got %v", err)
		}
		if len(ledger.captured) != 0 {
			t.Fatalf("nothing may be captured on a mismatch, got %v", ledger.captured)
		}
	})
	t.Run("payout from an unexpected wallet: refused", func(t *testing.T) {
		cfg := testConfig()
		cfg.PayoutAddressValue = "0x0000000000000000000000000000000000000077"
		svc := NewService(cfg, NewMemoryRepository())
		ledger := &fakeLedger{}
		svc.SetWalletLedger(ledger)
		svc.SetEVMClient(payoutClient(testTxHash(), 25000000)) // paid from the treasury
		req := broadcastWithdrawal(t, svc)
		if _, err := svc.MarkWithdrawalCompleted(context.Background(), req.ID, "admin-2"); !errors.Is(err, ErrTransferMismatch) {
			t.Fatalf("want ErrTransferMismatch, got %v", err)
		}
	})
	t.Run("matching payout: completed and captured once", func(t *testing.T) {
		svc := NewService(testConfig(), NewMemoryRepository())
		ledger := &fakeLedger{}
		svc.SetWalletLedger(ledger)
		svc.SetEVMClient(payoutClient(testTxHash(), 25000000))
		req := broadcastWithdrawal(t, svc)
		done, err := svc.MarkWithdrawalCompleted(context.Background(), req.ID, "admin-2")
		if err != nil || done.Status != "completed" || len(ledger.captured) != 1 {
			t.Fatalf("want completed once, got %+v err=%v captured=%v", done, err, ledger.captured)
		}
	})
}

// lockedHoldLedger counts holds under a mutex so concurrent requests can be
// checked for a double reservation.
type lockedHoldLedger struct {
	fakeLedger
	mu    sync.Mutex
	holds int
}

func (l *lockedHoldLedger) Hold(ctx context.Context, req wallet.HoldRequest) (wallet.Reservation, error) {
	l.mu.Lock()
	l.holds++
	l.mu.Unlock()
	time.Sleep(5 * time.Millisecond) // widen the race window
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.fakeLedger.Hold(ctx, req)
}

// 2026-09-29 audit: two identical withdrawal requests racing used to both
// reserve funds before the idempotency insert caught the second.
func TestServiceConcurrentWithdrawalRequestsHoldOnce(t *testing.T) {
	svc := NewService(testConfig(), NewMemoryRepository())
	ledger := &lockedHoldLedger{}
	svc.SetWalletLedger(ledger)
	var wg sync.WaitGroup
	ids := make([]string, 8)
	for i := range ids {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			req, err := svc.CreateWithdrawalRequest(context.Background(), "u-1", "0x0000000000000000000000000000000000000009", 2500, "wd-race")
			if err != nil {
				t.Errorf("CreateWithdrawalRequest: %v", err)
				return
			}
			ids[i] = req.ID
		}(i)
	}
	wg.Wait()
	if ledger.holds != 1 {
		t.Fatalf("want exactly one hold, got %d", ledger.holds)
	}
	for _, id := range ids {
		if id != ids[0] {
			t.Fatalf("all replays must return the same request, got %v", ids)
		}
	}
}

// The cross-rail KYC gate runs before any funds are reserved.
func TestServiceWithdrawalGateBlocksBeforeHold(t *testing.T) {
	svc := NewService(testConfig(), NewMemoryRepository())
	ledger := &fakeLedger{}
	svc.SetWalletLedger(ledger)
	var gotUser string
	var gotAmount int64
	svc.SetWithdrawalGate(func(_ context.Context, userID string, amountCents int64) error {
		gotUser, gotAmount = userID, amountCents
		return ErrIdentityVerificationRequired
	})
	_, err := svc.CreateWithdrawalRequest(context.Background(), "u-1", "0x0000000000000000000000000000000000000009", 2500, "wd-gated")
	if !errors.Is(err, ErrIdentityVerificationRequired) {
		t.Fatalf("want ErrIdentityVerificationRequired, got %v", err)
	}
	if gotUser != "u-1" || gotAmount != 2500 {
		t.Fatalf("gate saw user=%q amount=%d", gotUser, gotAmount)
	}
	if len(ledger.holds) != 0 {
		t.Fatalf("a gated withdrawal must not reserve funds, got %v", ledger.holds)
	}
}
