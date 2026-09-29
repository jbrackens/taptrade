package alphacashier

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/ethereum/go-ethereum/common"
)

type Config struct {
	Enabled                bool   `json:"enabled"`
	ChainID                int64  `json:"chainId"`
	ChainName              string `json:"chainName"`
	RPCURL                 string `json:"-"`
	TokenSymbol            string `json:"tokenSymbol"`
	TokenAddress           string `json:"tokenAddress"`
	TokenDecimals          int    `json:"tokenDecimals"`
	TreasuryAddress        string `json:"treasuryAddress"`
	Confirmations          int64  `json:"confirmations"`
	MinDepositCents        int64  `json:"minDepositCents"`
	MaxDepositCents        int64  `json:"maxDepositCents"`
	DailyDepositLimitCents int64  `json:"dailyDepositLimitCents"`
	WithdrawalsEnabled     bool   `json:"withdrawalsEnabled"`
	WithdrawalReviewNeeded bool   `json:"withdrawalReviewRequired"`
	// ScreeningEnforced makes non-clear address-screening verdicts block the
	// money movement (audit CMP-01). When false, screening runs observe-only
	// (logs, never blocks) except a sanctions hit, which always blocks.
	ScreeningEnforced bool `json:"screeningEnforced"`
	// TwoPersonWithdrawal requires the operator who broadcasts a withdrawal to
	// be different from the one who approved it (audit A2-04). Two-eyes control
	// on the custodial payout: one approves, a different person broadcasts.
	TwoPersonWithdrawal bool `json:"twoPersonWithdrawal"`
	// FinalityConfirmationsValue is the block depth at which a credited deposit
	// is considered final by the reorg watcher (audit A2-03). 0 = default (64).
	FinalityConfirmationsValue int64 `json:"finalityConfirmations"`
	// ChallengeDomainValue is the origin/domain bound into the wallet-connect
	// challenge message (audit #19). Empty = default ("hula-na").
	ChallengeDomainValue string `json:"challengeDomain"`
	// PayoutAddressValue is the wallet withdrawals are paid from, checked
	// on-chain before a withdrawal is completed (2026-09-29 audit). Empty =
	// the treasury address. Stage 1 pays out manually, so ops may use a
	// separate payout wallet.
	PayoutAddressValue string `json:"-"`
	// DepositScannerEnabled turns on proactive deposit detection (ported from
	// feat/hula-na-cashier, 2026-09-29): a watcher that finds treasury
	// transfers from connected wallets and submits the matching intent
	// through the verified SubmitDepositTx path. Off by default.
	DepositScannerEnabled bool `json:"depositScannerEnabled"`
}

// PayoutAddress is the wallet withdrawals are expected to be paid from.
func (c Config) PayoutAddress() string {
	if a := strings.TrimSpace(c.PayoutAddressValue); a != "" {
		return a
	}
	return c.TreasuryAddress
}

// ChallengeDomain returns the origin/domain to bind into the wallet challenge
// message (audit #19), defaulting to "hula-na" when unset.
func (c Config) ChallengeDomain() string {
	if d := strings.TrimSpace(c.ChallengeDomainValue); d != "" {
		return d
	}
	return defaultChallengeDomain
}

func LoadConfigFromEnv(getenv func(string) string) (Config, error) {
	cfg := Config{
		Enabled:                    envBool(getenv, "ALPHA_CASHIER_ENABLED", false),
		ChainID:                    envInt64(getenv, "ALPHA_CASHIER_CHAIN_ID", 8453),
		ChainName:                  envString(getenv, "ALPHA_CASHIER_CHAIN_NAME", "base"),
		RPCURL:                     strings.TrimSpace(getenv("ALPHA_CASHIER_RPC_URL")),
		TokenSymbol:                envString(getenv, "ALPHA_CASHIER_TOKEN_SYMBOL", "USDC"),
		TokenAddress:               strings.TrimSpace(getenv("ALPHA_CASHIER_TOKEN_ADDRESS")),
		TokenDecimals:              int(envInt64(getenv, "ALPHA_CASHIER_TOKEN_DECIMALS", 6)),
		TreasuryAddress:            strings.TrimSpace(getenv("ALPHA_CASHIER_TREASURY_ADDRESS")),
		Confirmations:              envInt64(getenv, "ALPHA_CASHIER_CONFIRMATIONS", 12),
		MinDepositCents:            envInt64(getenv, "ALPHA_CASHIER_MIN_DEPOSIT_CENTS", 100),
		MaxDepositCents:            envInt64(getenv, "ALPHA_CASHIER_MAX_DEPOSIT_CENTS", 25000),
		DailyDepositLimitCents:     envInt64(getenv, "ALPHA_CASHIER_DAILY_DEPOSIT_LIMIT_CENTS", 100000),
		WithdrawalsEnabled:         envBool(getenv, "ALPHA_CASHIER_WITHDRAWALS_ENABLED", false),
		WithdrawalReviewNeeded:     envBool(getenv, "ALPHA_CASHIER_WITHDRAWAL_REVIEW_REQUIRED", true),
		ScreeningEnforced:          envBool(getenv, "ALPHA_CASHIER_SCREENING_ENFORCEMENT", false),
		TwoPersonWithdrawal:        envBool(getenv, "ALPHA_CASHIER_TWO_PERSON_WITHDRAWAL", true),
		FinalityConfirmationsValue: envInt64(getenv, "ALPHA_CASHIER_FINALITY_CONFIRMATIONS", 0),
		ChallengeDomainValue:       envString(getenv, "ALPHA_CASHIER_CHALLENGE_DOMAIN", defaultChallengeDomain),
		PayoutAddressValue:         strings.TrimSpace(getenv("ALPHA_CASHIER_PAYOUT_ADDRESS")),
		DepositScannerEnabled:      envBool(getenv, "ALPHA_CASHIER_DEPOSIT_SCANNER_ENABLED", false),
	}
	if !cfg.Enabled {
		return cfg, nil
	}
	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func ValidateRuntimeConfig(getenv func(string) string) error {
	cfg, err := LoadConfigFromEnv(getenv)
	if err != nil {
		return err
	}
	if !cfg.Enabled {
		return nil
	}
	env := strings.ToLower(strings.TrimSpace(getenv("ENVIRONMENT")))
	if (env == "production" || env == "staging") && !cfg.WithdrawalReviewNeeded {
		return fmt.Errorf("ALPHA_CASHIER_WITHDRAWAL_REVIEW_REQUIRED=false is not allowed when ENVIRONMENT=%s", env)
	}
	// Sanctions/AML screening enforcement must be ON, or explicitly acked off,
	// whenever the rail is enabled in prod/staging (audit CMP-01 / HIGH #9).
	// Mirrors the two-person ack pattern: running a live custodial rail with
	// observe-only screening is a deliberate, audited choice — not a default.
	if (env == "production" || env == "staging") &&
		!cfg.ScreeningEnforced &&
		!envBool(getenv, "ALPHA_CASHIER_SCREENING_ENFORCEMENT_ACK_DISABLED", false) {
		return fmt.Errorf("ALPHA_CASHIER_SCREENING_ENFORCEMENT must be true, or explicitly acked off via ALPHA_CASHIER_SCREENING_ENFORCEMENT_ACK_DISABLED=true, when the rail is enabled and ENVIRONMENT=%s", env)
	}
	if (env == "production" || env == "staging") && cfg.WithdrawalsEnabled {
		if !envBool(getenv, "ALPHA_CASHIER_WITHDRAWAL_BROADCAST_ACK", false) {
			return fmt.Errorf("ALPHA_CASHIER_WITHDRAWALS_ENABLED requires ALPHA_CASHIER_WITHDRAWAL_BROADCAST_ACK=true when ENVIRONMENT=%s", env)
		}
		// Two-person control must be ON or explicitly acknowledged off (A2-04).
		if !cfg.TwoPersonWithdrawal && !envBool(getenv, "ALPHA_CASHIER_TWO_PERSON_WITHDRAWAL_ACK_DISABLED", false) {
			return fmt.Errorf("ALPHA_CASHIER_TWO_PERSON_WITHDRAWAL must be true, or explicitly acked off via ALPHA_CASHIER_TWO_PERSON_WITHDRAWAL_ACK_DISABLED=true, when withdrawals are enabled and ENVIRONMENT=%s", env)
		}
	}
	return nil
}

func (cfg Config) Validate() error {
	if cfg.ChainID <= 0 {
		return fmt.Errorf("ALPHA_CASHIER_CHAIN_ID must be positive")
	}
	if strings.TrimSpace(cfg.ChainName) == "" {
		return fmt.Errorf("ALPHA_CASHIER_CHAIN_NAME is required")
	}
	if strings.TrimSpace(cfg.RPCURL) == "" {
		return fmt.Errorf("ALPHA_CASHIER_RPC_URL is required when ALPHA_CASHIER_ENABLED=true")
	}
	// Defense in depth for the endpoint the gateway POSTs to (2026-09-29
	// audit): an http(s) URL with a host, nothing else.
	if u, err := url.Parse(strings.TrimSpace(cfg.RPCURL)); err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return fmt.Errorf("ALPHA_CASHIER_RPC_URL must be an http(s) URL with a host")
	}
	if strings.TrimSpace(cfg.TokenSymbol) == "" {
		return fmt.Errorf("ALPHA_CASHIER_TOKEN_SYMBOL is required")
	}
	if !common.IsHexAddress(cfg.TokenAddress) {
		return fmt.Errorf("ALPHA_CASHIER_TOKEN_ADDRESS must be an EVM address")
	}
	if !common.IsHexAddress(cfg.TreasuryAddress) {
		return fmt.Errorf("ALPHA_CASHIER_TREASURY_ADDRESS must be an EVM address")
	}
	if cfg.TokenDecimals < 2 || cfg.TokenDecimals > 30 {
		return fmt.Errorf("ALPHA_CASHIER_TOKEN_DECIMALS must be between 2 and 30")
	}
	if cfg.Confirmations <= 0 {
		return fmt.Errorf("ALPHA_CASHIER_CONFIRMATIONS must be positive")
	}
	if cfg.MinDepositCents <= 0 {
		return fmt.Errorf("ALPHA_CASHIER_MIN_DEPOSIT_CENTS must be positive")
	}
	if cfg.MaxDepositCents < cfg.MinDepositCents {
		return fmt.Errorf("ALPHA_CASHIER_MAX_DEPOSIT_CENTS must be >= ALPHA_CASHIER_MIN_DEPOSIT_CENTS")
	}
	if cfg.DailyDepositLimitCents < cfg.MaxDepositCents {
		return fmt.Errorf("ALPHA_CASHIER_DAILY_DEPOSIT_LIMIT_CENTS must be >= ALPHA_CASHIER_MAX_DEPOSIT_CENTS")
	}
	if p := strings.TrimSpace(cfg.PayoutAddressValue); p != "" && !common.IsHexAddress(p) {
		return fmt.Errorf("ALPHA_CASHIER_PAYOUT_ADDRESS must be an EVM address")
	}
	return nil
}

func NormalizeAddress(address string) (string, error) {
	if !common.IsHexAddress(strings.TrimSpace(address)) {
		return "", ErrInvalidAddress
	}
	return strings.ToLower(common.HexToAddress(address).Hex()), nil
}

func envString(getenv func(string) string, key string, fallback string) string {
	if v := strings.TrimSpace(getenv(key)); v != "" {
		return v
	}
	return fallback
}

func envBool(getenv func(string) string, key string, fallback bool) bool {
	raw := strings.ToLower(strings.TrimSpace(getenv(key)))
	if raw == "" {
		return fallback
	}
	return raw == "1" || raw == "true" || raw == "yes"
}

func envInt64(getenv func(string) string, key string, fallback int64) int64 {
	raw := strings.TrimSpace(getenv(key))
	if raw == "" {
		return fallback
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return fallback
	}
	return n
}
