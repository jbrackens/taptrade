package webhookauth

import (
	"errors"
	"fmt"
	"testing"
	"time"
)

func fixedVerifier(secret string, now time.Time) *Verifier {
	verifier := NewVerifier(secret)
	verifier.now = func() time.Time { return now }
	return verifier
}

func TestVerifierAcceptsValidSignature(t *testing.T) {
	now := time.Date(2026, 7, 12, 12, 0, 0, 0, time.UTC)
	body := []byte(fmt.Sprintf(`{"purchaseId":"sp_1","status":"completed","timestamp":%d}`, now.Unix()))
	verifier := fixedVerifier("whsec_test", now)

	signature := Sign("whsec_test", body)
	if err := verifier.Verify(body, signature, fmt.Sprintf("%d", now.Unix())); err != nil {
		t.Fatalf("expected sha256=<hex> signature to verify, got %v", err)
	}
	// Bare hex (no sha256= prefix) is also accepted.
	if err := verifier.Verify(body, signature[len("sha256="):], fmt.Sprintf("%d", now.Unix())); err != nil {
		t.Fatalf("expected bare hex signature to verify, got %v", err)
	}
	// RFC3339 timestamps are accepted alongside Unix seconds.
	if err := verifier.Verify(body, signature, now.Format(time.RFC3339)); err != nil {
		t.Fatalf("expected RFC3339 timestamp to verify, got %v", err)
	}
}

func TestVerifierRejectsBadSignatures(t *testing.T) {
	now := time.Date(2026, 7, 12, 12, 0, 0, 0, time.UTC)
	body := []byte(`{"purchaseId":"sp_1"}`)
	verifier := fixedVerifier("whsec_test", now)
	timestamp := fmt.Sprintf("%d", now.Unix())

	if err := verifier.Verify(body, "", timestamp); !errors.Is(err, ErrSignatureMissing) {
		t.Fatalf("missing signature: got %v", err)
	}
	if err := verifier.Verify(body, "sha256=not-hex", timestamp); !errors.Is(err, ErrSignatureInvalid) {
		t.Fatalf("undecodable signature: got %v", err)
	}
	if err := verifier.Verify(body, Sign("whsec_other", body), timestamp); !errors.Is(err, ErrSignatureInvalid) {
		t.Fatalf("wrong-secret signature: got %v", err)
	}
	tampered := Sign("whsec_test", []byte(`{"purchaseId":"sp_2"}`))
	if err := verifier.Verify(body, tampered, timestamp); !errors.Is(err, ErrSignatureInvalid) {
		t.Fatalf("tampered-body signature: got %v", err)
	}
}

func TestVerifierEnforcesTimestampWindow(t *testing.T) {
	now := time.Date(2026, 7, 12, 12, 0, 0, 0, time.UTC)
	body := []byte(`{"purchaseId":"sp_1"}`)
	verifier := fixedVerifier("whsec_test", now)
	signature := Sign("whsec_test", body)

	if err := verifier.Verify(body, signature, ""); !errors.Is(err, ErrTimestampMissing) {
		t.Fatalf("missing timestamp: got %v", err)
	}
	if err := verifier.Verify(body, signature, "not-a-time"); !errors.Is(err, ErrTimestampInvalid) {
		t.Fatalf("invalid timestamp: got %v", err)
	}
	for _, delta := range []time.Duration{-4 * time.Minute, 4 * time.Minute} {
		ts := fmt.Sprintf("%d", now.Add(delta).Unix())
		if err := verifier.Verify(body, signature, ts); err != nil {
			t.Fatalf("timestamp %v inside window rejected: %v", delta, err)
		}
	}
	for _, delta := range []time.Duration{-6 * time.Minute, 6 * time.Minute} {
		ts := fmt.Sprintf("%d", now.Add(delta).Unix())
		if err := verifier.Verify(body, signature, ts); !errors.Is(err, ErrTimestampExpired) {
			t.Fatalf("timestamp %v outside window: got %v", delta, err)
		}
	}
}

func TestVerifierFailsClosedWithoutSecret(t *testing.T) {
	now := time.Date(2026, 7, 12, 12, 0, 0, 0, time.UTC)
	body := []byte(`{}`)
	for _, secret := range []string{"", "   "} {
		err := fixedVerifier(secret, now).Verify(body, Sign(secret, body), fmt.Sprintf("%d", now.Unix()))
		if !errors.Is(err, ErrSecretMissing) {
			t.Fatalf("secret %q must fail closed, got %v", secret, err)
		}
		if errors.Is(err, ErrRejected) {
			t.Fatalf("a missing secret is an outage, not a rejected sender")
		}
	}
}

func TestEveryRejectionWrapsErrRejected(t *testing.T) {
	for _, err := range []error{ErrSignatureMissing, ErrSignatureInvalid, ErrTimestampMissing, ErrTimestampInvalid, ErrTimestampExpired} {
		if !errors.Is(err, ErrRejected) {
			t.Fatalf("%v does not wrap ErrRejected", err)
		}
	}
}
