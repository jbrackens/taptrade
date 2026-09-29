package payments

import (
	"os"
	"strings"

	"taptrade/gateway/internal/webhookauth"
)

const (
	webhookSignatureHeader = "X-Payments-Signature"
	webhookSecretEnv       = "PAYMENTS_WEBHOOK_SECRET"
)

// newWebhookVerifierFromEnv reads PAYMENTS_WEBHOOK_SECRET on each request and
// fails with webhookauth.ErrSecretMissing, before the body is read, when it
// is unset. Verification itself is the shared webhookauth scheme.
func newWebhookVerifierFromEnv() (*webhookauth.Verifier, error) {
	secret := strings.TrimSpace(os.Getenv(webhookSecretEnv))
	if secret == "" {
		return nil, webhookauth.ErrSecretMissing
	}
	return webhookauth.NewVerifier(secret), nil
}
