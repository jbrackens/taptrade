package http

// TOTP (RFC 6238 over RFC 4226 HOTP) and at-rest encryption for the shared
// secrets. Standard library only; totp_test.go checks the RFC 6238 Appendix B
// vectors.

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"
)

const (
	totpPeriod      = 30 // seconds per step (RFC 6238 default)
	totpDigits      = 6
	totpSkewSteps   = 1  // accept one step either side for clock drift
	totpSecretBytes = 20 // 160 bits, the RFC 4226 recommendation
)

// totpEncoding is the unpadded upper-case base32 authenticator apps expect.
var totpEncoding = base32.StdEncoding.WithPadding(base32.NoPadding)

func newTOTPSecret() (string, error) {
	buf := make([]byte, totpSecretBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return totpEncoding.EncodeToString(buf), nil
}

func decodeTOTPSecret(secret string) ([]byte, error) {
	secret = strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(secret), " ", ""))
	return totpEncoding.DecodeString(secret)
}

func hotp(key []byte, counter uint64, digits int) string {
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], counter)
	mac := hmac.New(sha1.New, key)
	mac.Write(msg[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	value := (uint32(sum[offset]&0x7f) << 24) |
		(uint32(sum[offset+1]) << 16) |
		(uint32(sum[offset+2]) << 8) |
		uint32(sum[offset+3])
	mod := uint32(1)
	for i := 0; i < digits; i++ {
		mod *= 10
	}
	return fmt.Sprintf("%0*d", digits, value%mod)
}

func totpStep(t time.Time) int64 { return t.Unix() / totpPeriod }

// totpCode returns the code for secret at time t. Tests use it; login
// verifies with totpMatch.
func totpCode(secret string, t time.Time) (string, error) {
	key, err := decodeTOTPSecret(secret)
	if err != nil {
		return "", err
	}
	return hotp(key, uint64(totpStep(t)), totpDigits), nil
}

// totpMatch reports the step a code matches at time t, checking the current
// step and one either side, in constant time per comparison. Callers enforce
// single use by rejecting a step at or below the last one accepted.
func totpMatch(secret, code string, t time.Time) (int64, bool) {
	code = strings.ReplaceAll(strings.TrimSpace(code), " ", "")
	if len(code) != totpDigits {
		return 0, false
	}
	key, err := decodeTOTPSecret(secret)
	if err != nil || len(key) == 0 {
		return 0, false
	}
	now := totpStep(t)
	for d := int64(-totpSkewSteps); d <= totpSkewSteps; d++ {
		step := now + d
		if subtle.ConstantTimeCompare([]byte(hotp(key, uint64(step), totpDigits)), []byte(code)) == 1 {
			return step, true
		}
	}
	return 0, false
}

// otpauthURL is the provisioning URI authenticator apps accept (as a QR code
// or a tapped link).
func otpauthURL(issuer, account, secret string) string {
	v := url.Values{}
	v.Set("secret", secret)
	v.Set("issuer", issuer)
	v.Set("algorithm", "SHA1")
	v.Set("digits", fmt.Sprint(totpDigits))
	v.Set("period", fmt.Sprint(totpPeriod))
	return "otpauth://totp/" + url.PathEscape(issuer+":"+account) + "?" + v.Encode()
}

// mfaCipher encrypts TOTP secrets with AES-256-GCM. The row's identity is the
// additional data, so a ciphertext copied onto another account fails to open.
type mfaCipher struct{ aead cipher.AEAD }

const mfaCiphertextPrefix = "v1:"

// parseMFAKey decodes AUTH_MFA_ENCRYPTION_KEY: standard base64 of 32 bytes.
func parseMFAKey(raw string) ([]byte, error) {
	key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return nil, fmt.Errorf("AUTH_MFA_ENCRYPTION_KEY must be base64: %w", err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("AUTH_MFA_ENCRYPTION_KEY must decode to 32 bytes, got %d", len(key))
	}
	return key, nil
}

func newMFACipher(key []byte) (*mfaCipher, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &mfaCipher{aead: aead}, nil
}

func (c *mfaCipher) seal(secret, boundTo string) (string, error) {
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := c.aead.Seal(nonce, nonce, []byte(secret), []byte(boundTo))
	return mfaCiphertextPrefix + base64.StdEncoding.EncodeToString(sealed), nil
}

func (c *mfaCipher) open(stored, boundTo string) (string, error) {
	if !strings.HasPrefix(stored, mfaCiphertextPrefix) {
		return "", errors.New("mfa secret is not in the v1 ciphertext format")
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(stored, mfaCiphertextPrefix))
	if err != nil {
		return "", err
	}
	if len(raw) < c.aead.NonceSize() {
		return "", errors.New("mfa secret ciphertext is too short")
	}
	nonce, body := raw[:c.aead.NonceSize()], raw[c.aead.NonceSize():]
	plain, err := c.aead.Open(nil, nonce, body, []byte(boundTo))
	if err != nil {
		return "", fmt.Errorf("mfa secret did not decrypt (wrong AUTH_MFA_ENCRYPTION_KEY?): %w", err)
	}
	return string(plain), nil
}
