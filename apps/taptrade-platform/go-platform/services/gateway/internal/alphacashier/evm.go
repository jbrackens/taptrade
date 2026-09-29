package alphacashier

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
)

var transferTopic = crypto.Keccak256Hash([]byte("Transfer(address,address,uint256)"))

type EVMClient interface {
	TransactionReceipt(ctx context.Context, txHash common.Hash) (*types.Receipt, error)
	BlockNumber(ctx context.Context) (uint64, error)
	TokenBalance(ctx context.Context, token common.Address, owner common.Address) (*big.Int, error)
	// FilterTransfers returns the token's ERC-20 Transfer events to `to` in
	// [fromBlock, toBlock] (the deposit scanner's eth_getLogs query).
	FilterTransfers(ctx context.Context, token common.Address, to common.Address, fromBlock, toBlock uint64) ([]TransferLog, error)
}

// TransferLog is one ERC-20 Transfer event found by FilterTransfers.
type TransferLog struct {
	TxHash      string
	LogIndex    uint
	BlockNumber uint64
	BlockHash   string
	From        string
	To          string
	AmountUnits string
}

type JSONRPCEVMClient struct {
	client *ethclient.Client
}

func NewJSONRPCEVMClient(ctx context.Context, rpcURL string) (*JSONRPCEVMClient, error) {
	client, err := ethclient.DialContext(ctx, rpcURL)
	if err != nil {
		return nil, err
	}
	return &JSONRPCEVMClient{client: client}, nil
}

func (c *JSONRPCEVMClient) TransactionReceipt(ctx context.Context, txHash common.Hash) (*types.Receipt, error) {
	return c.client.TransactionReceipt(ctx, txHash)
}

func (c *JSONRPCEVMClient) BlockNumber(ctx context.Context) (uint64, error) {
	return c.client.BlockNumber(ctx)
}

func (c *JSONRPCEVMClient) FilterTransfers(ctx context.Context, token common.Address, to common.Address, fromBlock, toBlock uint64) ([]TransferLog, error) {
	logs, err := c.client.FilterLogs(ctx, ethereum.FilterQuery{
		FromBlock: new(big.Int).SetUint64(fromBlock),
		ToBlock:   new(big.Int).SetUint64(toBlock),
		Addresses: []common.Address{token},
		Topics:    [][]common.Hash{{transferTopic}, nil, {common.BytesToHash(to.Bytes())}},
	})
	if err != nil {
		return nil, err
	}
	out := make([]TransferLog, 0, len(logs))
	for _, l := range logs {
		// A removed log belongs to a reorged-out block; a standard Transfer
		// has exactly three topics (event, from, to) and the amount as data.
		if l.Removed || len(l.Topics) != 3 || l.Topics[0] != transferTopic || l.Address != token {
			continue
		}
		out = append(out, TransferLog{
			TxHash:      l.TxHash.Hex(),
			LogIndex:    l.Index,
			BlockNumber: l.BlockNumber,
			BlockHash:   l.BlockHash.Hex(),
			From:        common.BytesToAddress(l.Topics[1].Bytes()[12:]).Hex(),
			To:          common.BytesToAddress(l.Topics[2].Bytes()[12:]).Hex(),
			AmountUnits: new(big.Int).SetBytes(l.Data).String(),
		})
	}
	return out, nil
}

func (c *JSONRPCEVMClient) TokenBalance(ctx context.Context, token common.Address, owner common.Address) (*big.Int, error) {
	selector := crypto.Keccak256([]byte("balanceOf(address)"))[:4]
	data := append([]byte{}, selector...)
	data = append(data, common.LeftPadBytes(owner.Bytes(), 32)...)
	out, err := c.client.CallContract(ctx, ethereum.CallMsg{To: &token, Data: data}, nil)
	if err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, ErrTxVerificationMissing
	}
	return new(big.Int).SetBytes(out), nil
}

type TransferExpectation struct {
	ChainID               int64
	TxHash                string
	TokenAddress          string
	FromAddress           string
	ToAddress             string
	AmountUnits           string
	RequiredConfirmations int64
}

func VerifyERC20Transfer(ctx context.Context, client EVMClient, expected TransferExpectation) (*ChainTransaction, error) {
	if client == nil {
		return nil, ErrTxVerificationMissing
	}
	txHash := strings.TrimSpace(expected.TxHash)
	if !common.IsHexAddress(expected.TokenAddress) || !common.IsHexAddress(expected.FromAddress) || !common.IsHexAddress(expected.ToAddress) {
		return nil, ErrInvalidAddress
	}
	if len(txHash) != 66 || !strings.HasPrefix(txHash, "0x") {
		return nil, ErrTxHashInvalid
	}
	amount, ok := new(big.Int).SetString(expected.AmountUnits, 10)
	if !ok || amount.Sign() <= 0 {
		return nil, ErrInvalidAmount
	}
	receipt, err := client.TransactionReceipt(ctx, common.HexToHash(txHash))
	if err != nil {
		if errors.Is(err, ethereum.NotFound) {
			return nil, ErrTxNotFound
		}
		return nil, err
	}
	if receipt.Status != types.ReceiptStatusSuccessful {
		return nil, ErrTxFailed
	}
	latest, err := client.BlockNumber(ctx)
	if err != nil {
		return nil, err
	}
	confirmations := int64(0)
	if latest >= receipt.BlockNumber.Uint64() {
		confirmations = int64(latest-receipt.BlockNumber.Uint64()) + 1
	}
	if confirmations < expected.RequiredConfirmations {
		return nil, ErrTxConfirming
	}

	token := common.HexToAddress(expected.TokenAddress)
	from := common.HexToAddress(expected.FromAddress)
	to := common.HexToAddress(expected.ToAddress)
	matches := []ChainTransaction{}
	for _, log := range receipt.Logs {
		if len(log.Topics) != 3 || log.Topics[0] != transferTopic {
			continue
		}
		if log.Address != token {
			continue
		}
		logFrom := common.BytesToAddress(log.Topics[1].Bytes()[12:])
		logTo := common.BytesToAddress(log.Topics[2].Bytes()[12:])
		logAmount := new(big.Int).SetBytes(log.Data)
		if logFrom != from || logTo != to || logAmount.Cmp(amount) != 0 {
			continue
		}
		raw, _ := json.Marshal(log)
		matches = append(matches, ChainTransaction{
			ChainID:       expected.ChainID,
			TxHash:        receipt.TxHash.Hex(),
			LogIndex:      log.Index,
			BlockNumber:   receipt.BlockNumber.Uint64(),
			BlockHash:     receipt.BlockHash.Hex(),
			TokenAddress:  log.Address.Hex(),
			FromAddress:   logFrom.Hex(),
			ToAddress:     logTo.Hex(),
			AmountUnits:   logAmount.String(),
			Confirmations: confirmations,
			ReceiptStatus: "success",
			RawLog:        string(raw),
		})
	}
	if len(matches) != 1 {
		return nil, ErrTransferMismatch
	}
	return &matches[0], nil
}
