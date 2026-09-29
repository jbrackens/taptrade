// Package webhookauth verifies signed inbound webhooks: an HMAC-SHA256 over
// the raw request body, sent as `sha256=<hex>` (or bare hex), plus a
// timestamp that must fall within five minutes of now.
//
// The timestamp is replay protection only because the signature covers it:
// callers must take it from inside the signed body, as the store and payments
// webhooks do, never from a separate unsigned header.
//
// One implementation for every inbound webhook (2026-09-29); the store and
// payments packages each carried a copy, and the orphaned internal/cashier a
// third without the timestamp window. Outbound partner deliveries are signed
// by internal/webhooks, a separate published contract.
package webhookauth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// MaxAge is how far a webhook's timestamp may be from now, either way.
const MaxAge = 5 * time.Minute

var (
	// ErrSecretMissing means no secret is configured: the endpoint is down,
	// not the sender wrong.
	ErrSecretMissing = errors.New("webhook secret not configured")

	// ErrRejected wraps every reason a request fails verification, so a
	// handler can answer them all with one 401.
	ErrRejected         = errors.New("webhook rejected")
	ErrSignatureMissing = fmt.Errorf("%w: signature missing", ErrRejected)
	ErrSignatureInvalid = fmt.Errorf("%w: signature invalid", ErrRejected)
	ErrTimestampMissing = fmt.Errorf("%w: timestamp missing", ErrRejected)
	ErrTimestampInvalid = fmt.Errorf("%w: timestamp invalid", ErrRejected)
	ErrTimestampExpired = fmt.Errorf("%w: timestamp outside allowed window", ErrRejected)
)

// Verifier checks webhooks against one shared secret, bound at construction.
type Verifier struct {
	secret []byte
	now    func() time.Time
}

// NewVerifier binds the secret. An empty secret yields a verifier that fails
// every request with ErrSecretMissing (fail closed).
func NewVerifier(secret string) *Verifier {
	return &Verifier{
		secret: []byte(strings.TrimSpace(secret)),
		now:    func() time.Time { return time.Now().UTC() },
	}
}

// Verify checks signature against the raw body and that timestamp (Unix
// seconds or RFC3339, read from the signed body) is within MaxAge of now.
func (v *Verifier) Verify(body []byte, signature, timestamp string) error {
	if len(v.secret) == 0 {
		return ErrSecretMissing
	}
	if strings.TrimSpace(signature) == "" {
		return ErrSignatureMissing
	}
	if strings.TrimSpace(timestamp) == "" {
		return ErrTimestampMissing
	}

	signedAt, err := parseTimestamp(timestamp)
	if err != nil {
		return ErrTimestampInvalid
	}
	if age := v.now().Sub(signedAt); age > MaxAge || age < -MaxAge {
		return ErrTimestampExpired
	}

	provided, err := decodeSignature(signature)
	if err != nil {
		return ErrSignatureInvalid
	}
	mac := hmac.New(sha256.New, v.secret)
	_, _ = mac.Write(body)
	if !hmac.Equal(mac.Sum(nil), provided) {
		return ErrSignatureInvalid
	}
	return nil
}

// Sign returns the `sha256=<hex>` signature Verify accepts for body; senders
// and tests use it.
func Sign(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(strings.TrimSpace(secret)))
	_, _ = mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func decodeSignature(signature string) ([]byte, error) {
	normalized := strings.TrimSpace(signature)
	if strings.HasPrefix(strings.ToLower(normalized), "sha256=") {
		normalized = normalized[len("sha256="):]
	}
	return hex.DecodeString(normalized)
}

func parseTimestamp(raw string) (time.Time, error) {
	raw = strings.TrimSpace(raw)
	if unix, err := strconv.ParseInt(raw, 10, 64); err == nil {
		return time.Unix(unix, 0).UTC(), nil
	}
	return time.Parse(time.RFC3339, raw)
}
