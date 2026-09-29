package alphacashier

import (
	"context"
	"database/sql"
	"math/big"
	"strings"
	"testing"

	"taptrade/gateway/internal/wallet"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

func TestVerifyERC20Transfer(t *testing.T) {
	txHash := testTxHash()
	from := common.HexToAddress("0x0000000000000000000000000000000000000003")
	to := common.HexToAddress("0x0000000000000000000000000000000000000002")
	token := common.HexToAddress("0x0000000000000000000000000000000000000001")
	client := fakeEVMClient{
		latest: 120,
		receipt: &types.Receipt{
			TxHash:      common.HexToHash(txHash),
			Status:      types.ReceiptStatusSuccessful,
			BlockNumber: big.NewInt(100),
			BlockHash:   common.HexToHash("0x1234"),
			Logs: []*types.Log{{
				Address: token,
				Topics: []common.Hash{
					transferTopic,
					common.BytesToHash(from.Bytes()),
					common.BytesToHash(to.Bytes()),
				},
				Data:  common.LeftPadBytes(big.NewInt(25000000).Bytes(), 32),
				Index: 7,
			}},
		},
	}
	got, err := VerifyERC20Transfer(context.Background(), client, TransferExpectation{
		ChainID:               8453,
		TxHash:                txHash,
		TokenAddress:          token.Hex(),
		FromAddress:           from.Hex(),
		ToAddress:             to.Hex(),
		AmountUnits:           "25000000",
		RequiredConfirmations: 12,
	})
	if err != nil {
		t.Fatalf("VerifyERC20Transfer: %v", err)
	}
	if got.LogIndex != 7 || got.AmountUnits != "25000000" {
		t.Fatalf("unexpected evidence: %+v", got)
	}
}

func TestVerifyERC20TransferConfirming(t *testing.T) {
	txHash := testTxHash()
	client := fakeEVMClient{
		latest: 105,
		receipt: &types.Receipt{
			TxHash:      common.HexToHash(txHash),
			Status:      types.ReceiptStatusSuccessful,
			BlockNumber: big.NewInt(100),
		},
	}
	_, err := VerifyERC20Transfer(context.Background(), client, TransferExpectation{
		ChainID:               8453,
		TxHash:                txHash,
		TokenAddress:          "0x0000000000000000000000000000000000000001",
		FromAddress:           "0x0000000000000000000000000000000000000003",
		ToAddress:             "0x0000000000000000000000000000000000000002",
		AmountUnits:           "25000000",
		RequiredConfirmations: 12,
	})
	if err != ErrTxConfirming {
		t.Fatalf("got %v, want ErrTxConfirming", err)
	}
}

func TestServiceSubmitDepositTxCreditsOnce(t *testing.T) {
	txHash := testTxHash()
	from := common.HexToAddress("0x0000000000000000000000000000000000000003")
	to := common.HexToAddress("0x0000000000000000000000000000000000000002")
	token := common.HexToAddress("0x0000000000000000000000000000000000000001")
	repo := NewMemoryRepository()
	svc := NewService(testConfig(), repo)
	ledger := &fakeLedger{}
	svc.SetWalletLedger(ledger)
	svc.SetEVMClient(fakeEVMClient{
		latest: 120,
		receipt: &types.Receipt{
			TxHash:      common.HexToHash(txHash),
			Status:      types.ReceiptStatusSuccessful,
			BlockNumber: big.NewInt(100),
			BlockHash:   common.HexToHash("0x1234"),
			Logs: []*types.Log{{
				Address: token,
				Topics: []common.Hash{
					transferTopic,
					common.BytesToHash(from.Bytes()),
					common.BytesToHash(to.Bytes()),
				},
				Data:  common.LeftPadBytes(big.NewInt(25000000).Bytes(), 32),
				Index: 2,
			}},
		},
	})
	now := svc.now().UTC()
	conn, err := repo.UpsertWalletConnection(context.Background(), WalletConnection{
		UserID:            "u-1",
		ChainType:         "evm",
		ChainID:           8453,
		WalletAddress:     from.Hex(),
		NormalizedAddress: strings.ToLower(from.Hex()),
		Nonce:             "nonce",
		VerifiedAt:        now,
		LastSeenAt:        now,
		CreatedAt:         now,
	})
	if err != nil {
		t.Fatalf("UpsertWalletConnection: %v", err)
	}
	intent, err := svc.CreateDepositIntent(context.Background(), "u-1", conn.WalletAddress, 2500, "idem-1")
	if err != nil {
		t.Fatalf("CreateDepositIntent: %v", err)
	}
	credited, err := svc.SubmitDepositTx(context.Background(), "u-1", intent.ID, txHash)
	if err != nil {
		t.Fatalf("SubmitDepositTx: %v", err)
	}
	if credited.Status != "credited" {
		t.Fatalf("status: got %s", credited.Status)
	}
	if ledger.calls != 1 {
		t.Fatalf("ledger calls: got %d, want 1", ledger.calls)
	}
	credited, err = svc.SubmitDepositTx(context.Background(), "u-1", intent.ID, txHash)
	if err != nil {
		t.Fatalf("SubmitDepositTx replay: %v", err)
	}
	if credited.Status != "credited" || ledger.calls != 1 {
		t.Fatalf("replay should not credit again: status=%s calls=%d", credited.Status, ledger.calls)
	}
}

type fakeEVMClient struct {
	receipt *types.Receipt
	// receipts, when set, answers by tx hash (a deposit and a payout in one
	// test); receipt is the fallback for single-tx tests.
	receipts map[common.Hash]*types.Receipt
	balance  *big.Int
	latest   uint64
	err      error
}

func (c fakeEVMClient) TransactionReceipt(_ context.Context, hash common.Hash) (*types.Receipt, error) {
	if c.err != nil {
		return nil, c.err
	}
	if r, ok := c.receipts[hash]; ok {
		return r, nil
	}
	if c.receipt == nil {
		return nil, ethereum.NotFound
	}
	return c.receipt, nil
}

// transferReceipt builds a successful receipt carrying one ERC-20 Transfer.
func transferReceipt(txHash string, token, from, to common.Address, amount int64, block int64) *types.Receipt {
	return &types.Receipt{
		TxHash:      common.HexToHash(txHash),
		Status:      types.ReceiptStatusSuccessful,
		BlockNumber: big.NewInt(block),
		BlockHash:   common.HexToHash("0xb10c"),
		Logs: []*types.Log{{
			Address: token,
			Topics: []common.Hash{
				transferTopic,
				common.BytesToHash(from.Bytes()),
				common.BytesToHash(to.Bytes()),
			},
			Data:  common.LeftPadBytes(big.NewInt(amount).Bytes(), 32),
			Index: 0,
		}},
	}
}

func (c fakeEVMClient) BlockNumber(_ context.Context) (uint64, error) {
	return c.latest, nil
}

func (c fakeEVMClient) FilterTransfers(_ context.Context, _ common.Address, _ common.Address, _, _ uint64) ([]TransferLog, error) {
	return nil, c.err
}

func (c fakeEVMClient) TokenBalance(_ context.Context, _ common.Address, _ common.Address) (*big.Int, error) {
	if c.err != nil {
		return nil, c.err
	}
	if c.balance == nil {
		return big.NewInt(0), nil
	}
	return new(big.Int).Set(c.balance), nil
}

type fakeLedger struct {
	calls    int
	holds    map[string]wallet.Reservation
	released []string
	captured []string
}

func (l *fakeLedger) Credit(_ context.Context, req wallet.MutationRequest) (wallet.LedgerEntry, error) {
	l.calls++
	return wallet.LedgerEntry{
		EntryID:        "le:test",
		UserID:         req.UserID,
		AmountPoints:   req.AmountPoints,
		IdempotencyKey: req.IdempotencyKey,
	}, nil
}

// CreditWithTx delegates to Credit in the fake: the memory-mode path never
// reaches it (DB() returns nil), but it satisfies the WalletLedger interface.
func (l *fakeLedger) CreditWithTx(ctx context.Context, _ *sql.Tx, req wallet.MutationRequest) (wallet.LedgerEntry, error) {
	return l.Credit(ctx, req)
}

// DB returns nil so SubmitDepositTx takes the non-tx (memory-mode) path.
func (l *fakeLedger) DB() *sql.DB { return nil }

func (l *fakeLedger) Hold(_ context.Context, req wallet.HoldRequest) (wallet.Reservation, error) {
	if l.holds == nil {
		l.holds = map[string]wallet.Reservation{}
	}
	reservation := wallet.Reservation{
		ID:            "rsv:test:" + req.ReferenceID,
		UserID:        req.UserID,
		AmountPoints:  req.AmountPoints,
		ReferenceType: req.ReferenceType,
		ReferenceID:   req.ReferenceID,
		Status:        "held",
	}
	l.holds[req.ReferenceID] = reservation
	return reservation, nil
}

func (l *fakeLedger) Release(_ context.Context, referenceType, referenceID string) error {
	l.released = append(l.released, referenceType+":"+referenceID)
	return nil
}

func (l *fakeLedger) Capture(_ context.Context, referenceType, referenceID string) (wallet.LedgerEntry, error) {
	l.captured = append(l.captured, referenceType+":"+referenceID)
	return wallet.LedgerEntry{
		EntryID:      "le:capture:" + referenceID,
		Type:         "debit",
		AmountPoints: 0,
		Reason:       referenceType,
	}, nil
}

func testTxHash() string {
	return "0x1111111111111111111111111111111111111111111111111111111111111111"
}
