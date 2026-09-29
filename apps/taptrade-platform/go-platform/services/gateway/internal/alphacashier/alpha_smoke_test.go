package alphacashier

import (
	"context"
	"math/big"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/accounts"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
)

func TestAlphaCashierFakeChainSmoke(t *testing.T) {
	ctx := context.Background()
	key, err := crypto.HexToECDSA("4c0883a69102937d6231471b5dbb6204fe51296170827944e48f8b7f95b35c5f")
	if err != nil {
		t.Fatalf("private key fixture: %v", err)
	}
	userWallet := crypto.PubkeyToAddress(key.PublicKey)
	token := common.HexToAddress(testConfig().TokenAddress)
	treasury := common.HexToAddress(testConfig().TreasuryAddress)
	txHash := testTxHash()
	repo := NewMemoryRepository()
	svc := NewService(testConfig(), repo)
	svc.now = func() time.Time { return time.Date(2026, 5, 28, 10, 30, 0, 0, time.UTC) }
	ledger := &fakeLedger{}
	svc.SetWalletLedger(ledger)
	payoutHash := "0x2222222222222222222222222222222222222222222222222222222222222222"
	svc.SetEVMClient(fakeEVMClient{
		latest:  120,
		balance: big.NewInt(20000000),
		// The payout the operators broadcast for the withdrawal below.
		receipts: map[common.Hash]*types.Receipt{
			common.HexToHash(payoutHash): transferReceipt(payoutHash, token, treasury,
				common.HexToAddress("0x0000000000000000000000000000000000000009"), 5000000, 101),
		},
		receipt: &types.Receipt{
			TxHash:      common.HexToHash(txHash),
			Status:      types.ReceiptStatusSuccessful,
			BlockNumber: big.NewInt(100),
			BlockHash:   common.HexToHash("0xbeef"),
			Logs: []*types.Log{{
				Address: token,
				Topics: []common.Hash{
					transferTopic,
					common.BytesToHash(userWallet.Bytes()),
					common.BytesToHash(treasury.Bytes()),
				},
				Data:  common.LeftPadBytes(big.NewInt(25000000).Bytes(), 32),
				Index: 2,
			}},
		},
	})

	challenge, err := svc.CreateWalletChallenge(ctx, "u-alpha", userWallet.Hex())
	if err != nil {
		t.Fatalf("CreateWalletChallenge: %v", err)
	}
	sig, err := crypto.Sign(accounts.TextHash([]byte(challenge.Message)), key)
	if err != nil {
		t.Fatalf("sign challenge: %v", err)
	}
	if _, err := svc.ConnectWallet(ctx, "u-alpha", challenge.Nonce, hexutil.Encode(sig)); err != nil {
		t.Fatalf("ConnectWallet: %v", err)
	}
	intent, err := svc.CreateDepositIntent(ctx, "u-alpha", userWallet.Hex(), 2500, "deposit-1")
	if err != nil {
		t.Fatalf("CreateDepositIntent: %v", err)
	}
	credited, err := svc.SubmitDepositTx(ctx, "u-alpha", intent.ID, txHash)
	if err != nil {
		t.Fatalf("SubmitDepositTx: %v", err)
	}
	if credited.Status != "credited" || ledger.calls != 1 {
		t.Fatalf("deposit not credited once: status=%s ledgerCalls=%d", credited.Status, ledger.calls)
	}
	replay, err := svc.SubmitDepositTx(ctx, "u-alpha", intent.ID, strings.ToUpper(txHash))
	if err != nil {
		t.Fatalf("SubmitDepositTx replay: %v", err)
	}
	if replay.ID != credited.ID || ledger.calls != 1 {
		t.Fatalf("deposit replay changed state: replay=%+v calls=%d", replay, ledger.calls)
	}

	withdrawal, err := svc.CreateWithdrawalRequest(ctx, "u-alpha", "0x0000000000000000000000000000000000000009", 500, "withdrawal-1")
	if err != nil {
		t.Fatalf("CreateWithdrawalRequest: %v", err)
	}
	if _, err := svc.ApproveWithdrawal(ctx, withdrawal.ID, "ops-1", "alpha smoke approval"); err != nil {
		t.Fatalf("ApproveWithdrawal: %v", err)
	}
	if _, err := svc.MarkWithdrawalBroadcasted(ctx, withdrawal.ID, "ops-1", payoutHash); err != nil {
		t.Fatalf("MarkWithdrawalBroadcasted: %v", err)
	}
	completed, err := svc.MarkWithdrawalCompleted(ctx, withdrawal.ID, "ops-1")
	if err != nil {
		t.Fatalf("MarkWithdrawalCompleted: %v", err)
	}
	if completed.Status != "completed" || len(ledger.captured) != 1 {
		t.Fatalf("withdrawal not completed once: status=%s captured=%d", completed.Status, len(ledger.captured))
	}

	summary, err := svc.ReconciliationSummary(ctx)
	if err != nil {
		t.Fatalf("ReconciliationSummary: %v", err)
	}
	if summary.CreditedDepositCents != 2500 || summary.CompletedWithdrawalCents != 500 || summary.CashierExpectedReserveCents != 2000 || summary.CashierDriftCents != 0 {
		t.Fatalf("unexpected reconciliation summary: %+v", summary)
	}
	events, err := svc.ListAuditEvents(ctx, AuditEventFilter{Limit: 20})
	if err != nil {
		t.Fatalf("ListAuditEvents: %v", err)
	}
	if len(events) < 6 {
		t.Fatalf("expected audit trail for smoke flow, got %d events", len(events))
	}
}
