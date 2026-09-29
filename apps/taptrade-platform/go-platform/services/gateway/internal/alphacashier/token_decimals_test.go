package alphacashier

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
)

type stubDecimals struct {
	value int
	err   error
	asked common.Address
}

func (s *stubDecimals) TokenDecimals(_ context.Context, token common.Address) (int, error) {
	s.asked = token
	return s.value, s.err
}

func TestVerifyTokenDecimals(t *testing.T) {
	cfg := Config{TokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", TokenDecimals: 6}

	t.Run("matching decimals pass", func(t *testing.T) {
		reader := &stubDecimals{value: 6}
		if err := VerifyTokenDecimals(context.Background(), reader, cfg); err != nil {
			t.Fatalf("VerifyTokenDecimals() error = %v", err)
		}
		if reader.asked != common.HexToAddress(cfg.TokenAddress) {
			t.Fatalf("asked %s, want the configured token", reader.asked.Hex())
		}
	})

	t.Run("an 18-decimal token configured as 6 is refused", func(t *testing.T) {
		err := VerifyTokenDecimals(context.Background(), &stubDecimals{value: 18}, cfg)
		if err == nil || !strings.Contains(err.Error(), "decimals()=18") {
			t.Fatalf("VerifyTokenDecimals() error = %v, want a decimals mismatch", err)
		}
	})

	t.Run("an unreadable token is refused", func(t *testing.T) {
		rpcErr := errors.New("execution reverted")
		if err := VerifyTokenDecimals(context.Background(), &stubDecimals{err: rpcErr}, cfg); !errors.Is(err, rpcErr) {
			t.Fatalf("VerifyTokenDecimals() error = %v, want the RPC error", err)
		}
	})

	t.Run("no reader or no token address is refused", func(t *testing.T) {
		if err := VerifyTokenDecimals(context.Background(), nil, cfg); !errors.Is(err, ErrTxVerificationMissing) {
			t.Fatalf("nil reader error = %v", err)
		}
		bad := cfg
		bad.TokenAddress = "usdc"
		if err := VerifyTokenDecimals(context.Background(), &stubDecimals{value: 6}, bad); err == nil {
			t.Fatal("bad token address passed")
		}
	})
}
