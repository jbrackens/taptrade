package payments

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	stdhttp "net/http"
	"os"
	"strconv"
	"strings"

	"taptrade/platform/transport/httpx"
)

// ErrRailNotConfigured is returned by every CryptoRail operation until the
// on-chain integration is configured (RPC endpoint, asset contract, and a
// deposit-address source). It fails CLOSED on purpose: an unconfigured rail
// must never hand out an address or broadcast a withdrawal, and must never mint
// a placeholder that looks real.
var ErrRailNotConfigured = errors.New("crypto rail not configured")

// Prototype-only after the 2026-05-25 cashier pivot: this is the legacy custodial
// BSC rail seam. It remains fail-closed for local/reference use and must not be
// configured for production funds. See docs/archive/cashier/README.md (workstream dormant since 2026-09-06).
//
// CryptoRail abstracts a legacy on-chain deposit/withdrawal rail (e.g. USDC on
// an EVM chain). Tap Trade launch mode keeps this surface unregistered unless
// legacy money routes are explicitly enabled. Until ops supply the chain inputs,
// every operation fails closed with ErrRailNotConfigured — wired, not faked.
// The two integration points a real deployment must provide:
//
//  1. Deposit-address derivation (an HD-wallet xpub / KMS keyring / custody
//     provider) — used by DepositAddress to assign a stable per-user address.
//  2. A signer + RPC client — used by PrepareWithdrawal to broadcast payouts.
//
// On-chain deposit detection then drives the existing payment webhook
// (DBPaymentService.HandleWebhook) to credit the wallet after N confirmations.
type CryptoRail interface {
	Name() string
	Network() string // e.g. "ethereum", "polygon", "base"
	Asset() string   // e.g. "USDC"
	Confirmations() int
	// Configured reports whether the rail has the inputs to operate.
	Configured() bool
	// DepositAddress returns the user's stable on-chain deposit address,
	// assigning one on first call. ErrRailNotConfigured until configured.
	DepositAddress(ctx context.Context, userID string) (string, error)
	// PrepareWithdrawal records intent to send `amountCents` of the asset to
	// `toAddress`. ErrRailNotConfigured until configured.
	PrepareWithdrawal(ctx context.Context, userID, toAddress string, amountCents int64) (txRef string, err error)
}

// evmUSDCRail is the reference EVM/USDC adapter. It reads configuration from env
// and persists assigned deposit addresses, but fails closed until the chain
// client is supplied — it never fabricates an address or a tx.
type evmUSDCRail struct {
	db            *sql.DB
	network       string
	asset         string
	rpcURL        string
	assetContract string
	addrSource    string // HD xpub / KMS keyring / custody provider id — opaque here
	confirmations int
}

func (r *evmUSDCRail) Name() string       { return "evm-usdc" }
func (r *evmUSDCRail) Network() string    { return r.network }
func (r *evmUSDCRail) Asset() string      { return r.asset }
func (r *evmUSDCRail) Confirmations() int { return r.confirmations }

// Configured requires all chain inputs: an RPC endpoint, the asset contract,
// and a deposit-address source.
func (r *evmUSDCRail) Configured() bool {
	return r.rpcURL != "" && r.assetContract != "" && r.addrSource != ""
}

func (r *evmUSDCRail) DepositAddress(ctx context.Context, userID string) (string, error) {
	if userID == "" {
		return "", ErrInvalidUserID
	}
	if !r.Configured() {
		return "", ErrRailNotConfigured
	}
	// Return a previously-assigned address if one exists (addresses are stable
	// per user/network/asset).
	ctx, cancel := context.WithTimeout(ctx, paymentDBTimeout)
	defer cancel()
	var addr string
	err := r.db.QueryRowContext(ctx,
		`SELECT address FROM crypto_deposit_addresses WHERE user_id = $1 AND network = $2 AND asset = $3`,
		userID, r.network, r.asset).Scan(&addr)
	if err == nil {
		return addr, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	// First request: a real address must be derived from the configured source
	// (HD derivation or a custody-provider call). That client is the
	// integration point — fail closed rather than returning a placeholder.
	return "", fmt.Errorf("%w: deposit-address derivation client not implemented for source %q", ErrRailNotConfigured, r.addrSource)
}

func (r *evmUSDCRail) PrepareWithdrawal(_ context.Context, _, _ string, _ int64) (string, error) {
	if !r.Configured() {
		return "", ErrRailNotConfigured
	}
	// Signing + broadcast via the configured signer/RPC is the integration
	// point. Fail closed until implemented.
	return "", fmt.Errorf("%w: withdrawal signer/broadcast client not implemented", ErrRailNotConfigured)
}

// NewCryptoRailFromEnv builds the rail from env. Always returns a non-nil rail
// so callers can introspect Network()/Asset()/Configured(); the rail fails
// closed until CRYPTO_RPC_URL, CRYPTO_ASSET_CONTRACT and
// CRYPTO_DEPOSIT_ADDRESS_SOURCE are all set.
func NewCryptoRailFromEnv(db *sql.DB) CryptoRail {
	confs := 12
	if v := strings.TrimSpace(os.Getenv("CRYPTO_CONFIRMATIONS")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			confs = n
		}
	}
	return &evmUSDCRail{
		db:            db,
		network:       cryptoEnvOr("CRYPTO_NETWORK", "base"),
		asset:         cryptoEnvOr("CRYPTO_ASSET", "USDC"),
		rpcURL:        strings.TrimSpace(os.Getenv("CRYPTO_RPC_URL")),
		assetContract: strings.TrimSpace(os.Getenv("CRYPTO_ASSET_CONTRACT")),
		addrSource:    strings.TrimSpace(os.Getenv("CRYPTO_DEPOSIT_ADDRESS_SOURCE")),
		confirmations: confs,
	}
}

func cryptoEnvOr(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

// EnsureCryptoSchema creates the deposit-address table. Safe to call on startup.
func EnsureCryptoSchema(db *sql.DB) error {
	ctx, cancel := context.WithTimeout(context.Background(), paymentDBTimeout)
	defer cancel()
	_, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS crypto_deposit_addresses (
  user_id    TEXT NOT NULL,
  network    TEXT NOT NULL,
  asset      TEXT NOT NULL,
  address    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, network, asset)
)`)
	return err
}

// RegisterCryptoRoutes exposes the crypto rail to the player app:
//
//	GET /api/v1/payments/crypto/config          -> {name, network, asset, confirmations, configured}
//	GET /api/v1/payments/crypto/deposit-address -> {address} | 503 when unconfigured
//
// Session-protected by the gateway auth middleware (the /api/v1/payments/
// prefix is not public). deposit-address binds to the session user.
func RegisterCryptoRoutes(mux *stdhttp.ServeMux, rail CryptoRail) {
	mux.Handle("/api/v1/payments/crypto/config", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"name":          rail.Name(),
			"network":       rail.Network(),
			"asset":         rail.Asset(),
			"confirmations": rail.Confirmations(),
			"configured":    rail.Configured(),
		})
	}))

	mux.Handle("/api/v1/payments/crypto/deposit-address", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		userID := httpx.UserIDFromContext(r.Context())
		if userID == "" {
			return httpx.Forbidden("authentication required")
		}
		addr, err := rail.DepositAddress(r.Context(), userID)
		if err != nil {
			if errors.Is(err, ErrRailNotConfigured) {
				// 503: the rail exists but the operator hasn't supplied chain
				// inputs yet. Distinct from a 4xx so the client can show
				// "crypto deposits coming soon" rather than a hard error.
				w.WriteHeader(stdhttp.StatusServiceUnavailable)
				return httpx.WriteJSON(w, stdhttp.StatusServiceUnavailable, map[string]any{
					"error":      "crypto_rail_unconfigured",
					"message":    "on-chain deposits are not yet enabled",
					"network":    rail.Network(),
					"asset":      rail.Asset(),
					"configured": false,
				})
			}
			return httpx.Internal("failed to get deposit address", err)
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"address": addr,
			"network": rail.Network(),
			"asset":   rail.Asset(),
		})
	}))
}
