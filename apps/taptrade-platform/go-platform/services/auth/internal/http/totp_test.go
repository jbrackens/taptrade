package http

import (
	"crypto/rand"
	"strings"
	"testing"
	"time"
)

// RFC 6238 Appendix B, SHA-1, eight digits, 30-second steps.
func TestHOTPMatchesRFC6238Vectors(t *testing.T) {
	key := []byte("12345678901234567890")
	vectors := []struct {
		unix int64
		code string
	}{
		{59, "94287082"},
		{1111111109, "07081804"},
		{1111111111, "14050471"},
		{1234567890, "89005924"},
		{2000000000, "69279037"},
		{20000000000, "65353130"},
	}
	for _, v := range vectors {
		if got := hotp(key, uint64(v.unix/totpPeriod), 8); got != v.code {
			t.Errorf("T=%d: got %s, want %s", v.unix, got, v.code)
		}
	}
}

func TestTOTPMatchAcceptsOneStepOfDriftOnly(t *testing.T) {
	secret, err := newTOTPSecret()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_800_000_000, 0)
	for _, tc := range []struct {
		offset time.Duration
		ok     bool
	}{
		{0, true},
		{-totpPeriod * time.Second, true},
		{totpPeriod * time.Second, true},
		{-2 * totpPeriod * time.Second, false},
		{2 * totpPeriod * time.Second, false},
	} {
		code, err := totpCode(secret, now.Add(tc.offset))
		if err != nil {
			t.Fatal(err)
		}
		step, ok := totpMatch(secret, code, now)
		if ok != tc.ok {
			t.Errorf("offset %v: match=%v, want %v", tc.offset, ok, tc.ok)
		}
		if ok && step != totpStep(now.Add(tc.offset)) {
			t.Errorf("offset %v: matched step %d, want %d", tc.offset, step, totpStep(now.Add(tc.offset)))
		}
	}
	for _, bad := range []string{"", "12345", "1234567", "abcdef"} {
		if _, ok := totpMatch(secret, bad, now); ok {
			t.Errorf("code %q should not match", bad)
		}
	}
	code, _ := totpCode(secret, now)
	if _, ok := totpMatch(secret, code[:3]+" "+code[3:], now); !ok {
		t.Errorf("a code typed with a space should still match")
	}
}

func TestOtpauthURLCarriesIssuerAndSecret(t *testing.T) {
	got := otpauthURL("TapTrade", "ops@taptrade.local", "JBSWY3DPEHPK3PXP")
	for _, want := range []string{
		"otpauth://totp/TapTrade:ops@taptrade.local?",
		"secret=JBSWY3DPEHPK3PXP",
		"issuer=TapTrade",
		"digits=6",
		"period=30",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("%s is missing %q", got, want)
		}
	}
}

func TestMFACipherRoundTripsAndBindsToTheAccount(t *testing.T) {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	c, err := newMFACipher(key)
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := c.seal("JBSWY3DPEHPK3PXP", "admin_users:42")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(sealed, "JBSWY3DPEHPK3PXP") {
		t.Fatalf("ciphertext contains the secret: %s", sealed)
	}
	if got, err := c.open(sealed, "admin_users:42"); err != nil || got != "JBSWY3DPEHPK3PXP" {
		t.Fatalf("open = %q, %v", got, err)
	}
	if _, err := c.open(sealed, "auth_users:42"); err == nil {
		t.Fatalf("a ciphertext moved to another account must not open")
	}
	otherKey := make([]byte, 32)
	if _, err := rand.Read(otherKey); err != nil {
		t.Fatal(err)
	}
	other, _ := newMFACipher(otherKey)
	if _, err := other.open(sealed, "admin_users:42"); err == nil {
		t.Fatalf("a different key must not open the secret")
	}
	if _, err := c.open("JBSWY3DPEHPK3PXP", "admin_users:42"); err == nil {
		t.Fatalf("a plaintext value must be refused")
	}
}

func TestParseMFAKeyNeeds32Base64Bytes(t *testing.T) {
	if _, err := parseMFAKey("not base64!"); err == nil {
		t.Errorf("expected an error for non-base64")
	}
	if _, err := parseMFAKey("c2hvcnQ="); err == nil {
		t.Errorf("expected an error for a short key")
	}
	if _, err := parseMFAKey(testMFAKey); err != nil {
		t.Errorf("valid key refused: %v", err)
	}
}
