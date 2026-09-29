// Package store implements the Point Store: purchasable point packs behind
// STORE_ENABLED, fully separate from the retired legacy cashier/payments
// trees (STORE_AND_PAYMENTS.md). Purchases credit non-redeemable gameplay
// points one way; there is no cash-out, transfer, or redemption path.
package store

import (
	"fmt"
	"strconv"
	"strings"
)

const (
	enabledEnv               = "STORE_ENABLED"
	providerEnv              = "STORE_PROVIDER"
	webhookSecretEnv         = "STORE_WEBHOOK_SECRET"
	firstPurchaseBonusBpsEnv = "STORE_FIRST_PURCHASE_BONUS_BPS"

	// ProviderDemo is the deterministic simulated checkout provider.
	ProviderDemo = "demo"
	// ProviderStripe is recognized as a reserved seam but refused at boot
	// until the Stripe integration lands (STORE_AND_PAYMENTS.md §6/§9).
	ProviderStripe = "stripe"

	// placeholderWebhookSecret mirrors the PAYMENTS_WEBHOOK_SECRET dev
	// placeholder refused in deployed environments (cmd/gateway/main.go).
	placeholderWebhookSecret = "whsec_local"
)

// Config is the point store's runtime configuration, bound once at
// construction (never re-read from env per request).
type Config struct {
	Enabled       bool
	Provider      string
	WebhookSecret string
	// FirstPurchaseBonusBps optionally grants extra bonus points on a user's
	// first completed-eligible checkout: basePoints * bps / 10000. 0 = off.
	FirstPurchaseBonusBps int64
	// DeployedEnv is true when ENVIRONMENT is production or staging.
	DeployedEnv bool
}

// EnabledFromEnv reports whether the point store route tree is switched on.
// Mirrors the launch_boundary.go helper shape for the legacy flag.
func EnabledFromEnv(getenv func(string) string) bool {
	return strings.EqualFold(strings.TrimSpace(getenv(enabledEnv)), "true")
}

// LoadConfigFromEnv binds the store configuration from the environment. A
// disabled store always loads successfully; an enabled store with an
// unusable provider or bonus configuration is a hard error so boot
// validation can refuse it.
func LoadConfigFromEnv(getenv func(string) string) (Config, error) {
	cfg := Config{Enabled: EnabledFromEnv(getenv)}
	envName := strings.ToLower(strings.TrimSpace(getenv("ENVIRONMENT")))
	cfg.DeployedEnv = envName == "production" || envName == "staging"
	if !cfg.Enabled {
		return cfg, nil
	}

	provider := strings.ToLower(strings.TrimSpace(getenv(providerEnv)))
	if provider == "" {
		provider = ProviderDemo
	}
	switch provider {
	case ProviderDemo:
		// The only implemented provider.
	case ProviderStripe:
		return Config{}, fmt.Errorf("%s=stripe is reserved, not implemented; run %s=demo until the Stripe integration lands", providerEnv, providerEnv)
	default:
		return Config{}, fmt.Errorf("%s=%q is not a recognized point store provider (want %q)", providerEnv, provider, ProviderDemo)
	}
	cfg.Provider = provider
	cfg.WebhookSecret = strings.TrimSpace(getenv(webhookSecretEnv))

	if raw := strings.TrimSpace(getenv(firstPurchaseBonusBpsEnv)); raw != "" {
		bps, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || bps < 0 || bps > 10000 {
			return Config{}, fmt.Errorf("%s must be an integer between 0 and 10000, got %q", firstPurchaseBonusBpsEnv, raw)
		}
		cfg.FirstPurchaseBonusBps = bps
	}
	return cfg, nil
}

// ValidateRuntimeConfig is the boot-time gate called from
// validateGatewayRuntimeConfig (mirrors alphacashier.ValidateRuntimeConfig).
// An enabled store in a deployed environment must carry a real webhook
// secret; STORE_PROVIDER=stripe refuses to boot anywhere.
func ValidateRuntimeConfig(getenv func(string) string) error {
	cfg, err := LoadConfigFromEnv(getenv)
	if err != nil {
		return err
	}
	if !cfg.Enabled {
		return nil
	}
	env := strings.ToLower(strings.TrimSpace(getenv("ENVIRONMENT")))
	if env == "production" || env == "staging" {
		switch cfg.WebhookSecret {
		case "":
			return fmt.Errorf("%s must be set when %s=true and ENVIRONMENT=%s", webhookSecretEnv, enabledEnv, env)
		case placeholderWebhookSecret:
			return fmt.Errorf("%s is the dev placeholder %q; set a real secret when %s=true and ENVIRONMENT=%s", webhookSecretEnv, placeholderWebhookSecret, enabledEnv, env)
		}
	}
	return nil
}
