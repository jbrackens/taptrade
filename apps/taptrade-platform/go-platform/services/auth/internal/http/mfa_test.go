package http

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	_ "github.com/lib/pq"
	"taptrade/platform/transport/httpx"
)

// testMFAKey is base64 of 32 fixed bytes; it protects nothing outside tests.
const testMFAKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="

var mfaTestClock = time.Unix(1_800_000_000, 0)

func newMFATestServer(t *testing.T, adminRequired bool) (*AuthService, http.Handler) {
	t.Helper()
	t.Setenv("AUTH_MFA_ENCRYPTION_KEY", testMFAKey)
	t.Setenv("AUTH_ADMIN_MFA_REQUIRED", fmt.Sprint(adminRequired))
	t.Setenv("AUTH_DEMO_USERNAME", "player@test.dev")
	t.Setenv("AUTH_DEMO_PASSWORD", "PlayerPass1!")
	t.Setenv("AUTH_ADMIN_USERNAME", "staff@test.dev")
	t.Setenv("AUTH_ADMIN_PASSWORD", "StaffPass1!")
	auth := NewAuthService()
	auth.mfa.now = func() time.Time { return mfaTestClock }
	mux := http.NewServeMux()
	RegisterRoutes(mux, "auth", auth)
	return auth, httpx.Chain(mux, httpx.NormalizeTrailingSlash("/api/", "/auth/"), httpx.RequestID(), httpx.Recovery(nil))
}

func mfaPost(t *testing.T, h http.Handler, path string, body any, mods ...func(*http.Request)) *httptest.ResponseRecorder {
	t.Helper()
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(raw))
	for _, m := range mods {
		m(req)
	}
	res := httptest.NewRecorder()
	h.ServeHTTP(res, req)
	return res
}

func bearer(token string) func(*http.Request) {
	return func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+token) }
}

func withCookie(c *http.Cookie) func(*http.Request) {
	return func(r *http.Request) { r.AddCookie(c) }
}

func responseCookie(res *httptest.ResponseRecorder, name string) *http.Cookie {
	for _, c := range res.Result().Cookies() {
		if c.Name == name && c.MaxAge >= 0 {
			return c
		}
	}
	return nil
}

func decodeInto[T any](t *testing.T, res *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(res.Body.Bytes(), &v); err != nil {
		t.Fatalf("decode %s: %v", res.Body.String(), err)
	}
	return v
}

// codeAt is the code for secret the given number of steps from the test clock.
func codeAt(t *testing.T, secret string, steps int) string {
	t.Helper()
	code, err := totpCode(secret, mfaTestClock.Add(time.Duration(steps*totpPeriod)*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	return code
}

func loginCredentials(username, password string) map[string]string {
	return map[string]string{"username": username, "password": password}
}

func TestStaffSignInEnrollsThenAlwaysNeedsACode(t *testing.T) {
	_, h := newMFATestServer(t, true)

	// First sign-in: the password returns a secret to enroll, not a session.
	res := mfaPost(t, h, "/api/v1/auth/login", loginCredentials("staff@test.dev", "StaffPass1!"))
	if res.Code != http.StatusOK {
		t.Fatalf("login: %d %s", res.Code, res.Body.String())
	}
	if responseCookie(res, "access_token") != nil {
		t.Fatalf("no session may be issued before the code")
	}
	first := decodeInto[mfaChallengeResponse](t, res)
	if !first.MFARequired || first.MFAToken == "" || first.Enrollment == nil || first.Enrollment.Secret == "" {
		t.Fatalf("expected an enrollment challenge, got %+v", first)
	}
	if !strings.HasPrefix(first.Enrollment.OtpauthURL, "otpauth://totp/TapTrade:staff@test.dev?") {
		t.Fatalf("unexpected provisioning URL %s", first.Enrollment.OtpauthURL)
	}
	secret := first.Enrollment.Secret

	wrong := mfaPost(t, h, mfaChallengePath, map[string]string{"mfaToken": first.MFAToken, "code": codeAt(t, secret, 20)})
	if wrong.Code != http.StatusUnauthorized {
		t.Fatalf("wrong code: %d %s", wrong.Code, wrong.Body.String())
	}
	ok := mfaPost(t, h, mfaChallengePath, map[string]string{"mfaToken": first.MFAToken, "code": codeAt(t, secret, 0)})
	if ok.Code != http.StatusOK || responseCookie(ok, "access_token") == nil {
		t.Fatalf("enrolling code: %d %s", ok.Code, ok.Body.String())
	}
	if tokens := decodeInto[tokenResponse](t, ok); tokens.AccessToken == "" {
		t.Fatalf("expected tokens, got %s", ok.Body.String())
	}
	if again := mfaPost(t, h, mfaChallengePath, map[string]string{"mfaToken": first.MFAToken, "code": codeAt(t, secret, 1)}); again.Code != http.StatusUnauthorized {
		t.Fatalf("a used challenge must not sign in again: %d", again.Code)
	}

	// Later sign-ins: a challenge without enrollment, and codes are single use.
	second := decodeInto[mfaChallengeResponse](t, mfaPost(t, h, "/api/v1/auth/login", loginCredentials("staff@test.dev", "StaffPass1!")))
	if !second.MFARequired || second.Enrollment != nil {
		t.Fatalf("expected a plain challenge, got %+v", second)
	}
	if replay := mfaPost(t, h, mfaChallengePath, map[string]string{"mfaToken": second.MFAToken, "code": codeAt(t, secret, 0)}); replay.Code != http.StatusUnauthorized {
		t.Fatalf("a code already used must be refused: %d", replay.Code)
	}
	next := mfaPost(t, h, mfaChallengePath, map[string]string{"mfaToken": second.MFAToken, "code": codeAt(t, secret, 1)})
	if next.Code != http.StatusOK {
		t.Fatalf("next code: %d %s", next.Code, next.Body.String())
	}
	tokens := decodeInto[tokenResponse](t, next)

	// Staff can't switch it off while it's required.
	if off := mfaPost(t, h, "/api/v1/auth/mfa/disable", mfaCodeRequest{Code: codeAt(t, secret, -1)}, bearer(tokens.AccessToken)); off.Code != http.StatusForbidden {
		t.Fatalf("staff disable: %d %s", off.Code, off.Body.String())
	}
}

func TestWrongCodesEndTheChallengeAndLockTheAccount(t *testing.T) {
	_, h := newMFATestServer(t, true)
	ch := decodeInto[mfaChallengeResponse](t, mfaPost(t, h, "/api/v1/auth/login", loginCredentials("staff@test.dev", "StaffPass1!")))
	secret := ch.Enrollment.Secret
	for i := 0; i < mfaMaxAttempts; i++ {
		if res := mfaPost(t, h, mfaChallengePath, map[string]string{"mfaToken": ch.MFAToken, "code": codeAt(t, secret, 50+i)}); res.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: %d", i+1, res.Code)
		}
	}
	if res := mfaPost(t, h, mfaChallengePath, map[string]string{"mfaToken": ch.MFAToken, "code": codeAt(t, secret, 0)}); res.Code != http.StatusUnauthorized {
		t.Fatalf("the challenge must be gone after %d wrong codes: %d", mfaMaxAttempts, res.Code)
	}
	if res := mfaPost(t, h, "/api/v1/auth/login", loginCredentials("staff@test.dev", "StaffPass1!")); res.Code != http.StatusTooManyRequests {
		t.Fatalf("wrong codes must count toward the lockout: %d %s", res.Code, res.Body.String())
	}
}

func TestPlayerTurnsOnTwoFactorAndSocialSignInStillAsksForTheCode(t *testing.T) {
	auth, h := newMFATestServer(t, false)

	res := mfaPost(t, h, "/api/v1/auth/login", loginCredentials("player@test.dev", "PlayerPass1!"))
	session := decodeInto[tokenResponse](t, res)
	if session.AccessToken == "" {
		t.Fatalf("a player without two-factor signs in directly: %s", res.Body.String())
	}

	statusReq := httptest.NewRequest(http.MethodGet, "/api/v1/auth/mfa", nil)
	statusReq.Header.Set("Authorization", "Bearer "+session.AccessToken)
	statusRes := httptest.NewRecorder()
	h.ServeHTTP(statusRes, statusReq)
	if st := decodeInto[mfaStatusResponse](t, statusRes); !st.Available || st.Enabled || st.Required {
		t.Fatalf("unexpected status %+v", st)
	}

	enroll := mfaPost(t, h, "/api/v1/auth/mfa/enroll", struct{}{}, bearer(session.AccessToken))
	if enroll.Code != http.StatusOK {
		t.Fatalf("enroll: %d %s", enroll.Code, enroll.Body.String())
	}
	secret := decodeInto[mfaEnrollment](t, enroll).Secret
	if bad := mfaPost(t, h, "/api/v1/auth/mfa/activate", mfaCodeRequest{Code: codeAt(t, secret, 20)}, bearer(session.AccessToken)); bad.Code != http.StatusBadRequest {
		t.Fatalf("activate with a wrong code: %d", bad.Code)
	}
	if good := mfaPost(t, h, "/api/v1/auth/mfa/activate", mfaCodeRequest{Code: codeAt(t, secret, -1)}, bearer(session.AccessToken)); good.Code != http.StatusOK {
		t.Fatalf("activate: %d %s", good.Code, good.Body.String())
	}

	// Social sign-in to the same account now stops at the code step.
	provider := fakeGoogle(t, "google-sub-1", "player@test.dev")
	cbReq := httptest.NewRequest(http.MethodGet, "/api/v1/auth/oauth/google/callback?code=c&state=s", nil)
	cbReq.AddCookie(&http.Cookie{Name: provider.stateCookie(), Value: "s"})
	cbRes := httptest.NewRecorder()
	if err := provider.handleCallback(auth, "https://front.test")(cbRes, cbReq); err != nil {
		t.Fatalf("callback: %v", err)
	}
	if loc := cbRes.Header().Get("Location"); loc != "https://front.test/auth/login?mfa=1" {
		t.Fatalf("callback redirected to %q", loc)
	}
	if responseCookie(cbRes, "access_token") != nil {
		t.Fatalf("social sign-in must not skip the code")
	}
	challengeCookie := responseCookie(cbRes, mfaChallengeCookie)
	if challengeCookie == nil || challengeCookie.Path != mfaChallengePath || !challengeCookie.HttpOnly {
		t.Fatalf("expected an HttpOnly challenge cookie scoped to %s, got %+v", mfaChallengePath, challengeCookie)
	}
	done := mfaPost(t, h, mfaChallengePath, map[string]string{"code": codeAt(t, secret, 0)}, withCookie(challengeCookie))
	if done.Code != http.StatusOK || responseCookie(done, "access_token") == nil {
		t.Fatalf("code step after social sign-in: %d %s", done.Code, done.Body.String())
	}
	// The dev session store keeps one session per user; carry on with the new one.
	session = decodeInto[tokenResponse](t, done)

	// The password path asks too; then the player switches it off with a fresh code.
	pw := mfaPost(t, h, "/api/v1/auth/login", loginCredentials("player@test.dev", "PlayerPass1!"))
	if ch := decodeInto[mfaChallengeResponse](t, pw); !ch.MFARequired || ch.Enrollment != nil {
		t.Fatalf("expected a code challenge, got %s", pw.Body.String())
	}
	if used := mfaPost(t, h, "/api/v1/auth/mfa/disable", mfaCodeRequest{Code: codeAt(t, secret, 0)}, bearer(session.AccessToken)); used.Code != http.StatusBadRequest {
		t.Fatalf("disable with a used code: %d %s", used.Code, used.Body.String())
	}
	if off := mfaPost(t, h, "/api/v1/auth/mfa/disable", mfaCodeRequest{Code: codeAt(t, secret, 1)}, bearer(session.AccessToken)); off.Code != http.StatusOK {
		t.Fatalf("disable: %d %s", off.Code, off.Body.String())
	}
	if direct := decodeInto[tokenResponse](t, mfaPost(t, h, "/api/v1/auth/login", loginCredentials("player@test.dev", "PlayerPass1!"))); direct.AccessToken == "" {
		t.Fatalf("with two-factor off the password signs in directly again")
	}
}

func TestSocialSignInCannotEnrollStaff(t *testing.T) {
	auth, _ := newMFATestServer(t, true)
	provider := fakeGoogle(t, "google-sub-2", "staff@test.dev")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/oauth/google/callback?code=c&state=s", nil)
	req.AddCookie(&http.Cookie{Name: provider.stateCookie(), Value: "s"})
	res := httptest.NewRecorder()
	err := provider.handleCallback(auth, "https://front.test")(res, req)
	if appErr := httpx.FromError(err); appErr == nil || appErr.Status != http.StatusForbidden {
		t.Fatalf("expected 403, got %v", err)
	}
	if responseCookie(res, "access_token") != nil {
		t.Fatalf("no session may be issued")
	}
}

func TestSettingsCallsWithTheCookieNeedCSRF(t *testing.T) {
	_, h := newMFATestServer(t, false)
	session := decodeInto[tokenResponse](t, mfaPost(t, h, "/api/v1/auth/login", loginCredentials("player@test.dev", "PlayerPass1!")))
	access := &http.Cookie{Name: "access_token", Value: session.AccessToken}
	if res := mfaPost(t, h, "/api/v1/auth/mfa/enroll", struct{}{}, withCookie(access)); res.Code != http.StatusForbidden {
		t.Fatalf("cookie session without CSRF: %d", res.Code)
	}
	csrf := &http.Cookie{Name: csrfCookieName, Value: "abc123"}
	res := mfaPost(t, h, "/api/v1/auth/mfa/enroll", struct{}{}, withCookie(access), withCookie(csrf),
		func(r *http.Request) { r.Header.Set(csrfHeaderName, "abc123") })
	if res.Code != http.StatusOK {
		t.Fatalf("cookie session with CSRF: %d %s", res.Code, res.Body.String())
	}
}

func TestStaffSignInFailsClosedWithoutAStore(t *testing.T) {
	auth, h := newMFATestServer(t, true)
	auth.mfa.store = nil
	if res := mfaPost(t, h, "/api/v1/auth/login", loginCredentials("staff@test.dev", "StaffPass1!")); res.Code != http.StatusServiceUnavailable {
		t.Fatalf("staff: %d %s", res.Code, res.Body.String())
	}
	if res := mfaPost(t, h, "/api/v1/auth/login", loginCredentials("player@test.dev", "PlayerPass1!")); res.Code != http.StatusOK {
		t.Fatalf("players are unaffected: %d %s", res.Code, res.Body.String())
	}
}

type unreadableMFAStore struct{ *memoryMFAStore }

func (unreadableMFAStore) Factor(context.Context, mfaKey) (mfaFactor, bool, error) {
	return mfaFactor{}, false, errors.New("database is down")
}

func TestSignInFailsClosedWhenTheFactorCannotBeRead(t *testing.T) {
	auth, h := newMFATestServer(t, false)
	auth.mfa.store = unreadableMFAStore{newMemoryMFAStore()}
	if res := mfaPost(t, h, "/api/v1/auth/login", loginCredentials("player@test.dev", "PlayerPass1!")); res.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when two-factor state is unknown, got %d", res.Code)
	}
}

func TestLoadMFASettings(t *testing.T) {
	cases := []struct {
		name     string
		env      string
		vars     map[string]string
		required bool
		wantErr  string
	}{
		{name: "dev default is off", env: "", required: false},
		{name: "production default needs the key", env: "production", wantErr: "AUTH_MFA_ENCRYPTION_KEY"},
		{name: "production with key is on", env: "production", vars: map[string]string{"AUTH_MFA_ENCRYPTION_KEY": testMFAKey}, required: true},
		{name: "production off needs acknowledgement", env: "staging", vars: map[string]string{"AUTH_ADMIN_MFA_REQUIRED": "false"}, wantErr: "AUTH_ADMIN_MFA_OFF_ACKNOWLEDGED"},
		{name: "production off acknowledged", env: "production", vars: map[string]string{"AUTH_ADMIN_MFA_REQUIRED": "false", "AUTH_ADMIN_MFA_OFF_ACKNOWLEDGED": "true"}, required: false},
		{name: "demo turns it on", env: "", vars: map[string]string{"AUTH_ADMIN_MFA_REQUIRED": "true", "AUTH_MFA_ENCRYPTION_KEY": testMFAKey}, required: true},
		{name: "on without key", env: "", vars: map[string]string{"AUTH_ADMIN_MFA_REQUIRED": "true"}, wantErr: "AUTH_MFA_ENCRYPTION_KEY"},
		{name: "not a boolean", env: "", vars: map[string]string{"AUTH_ADMIN_MFA_REQUIRED": "yes please"}, wantErr: "not true or false"},
		{name: "bad key", env: "", vars: map[string]string{"AUTH_MFA_ENCRYPTION_KEY": "short"}, wantErr: "AUTH_MFA_ENCRYPTION_KEY"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, err := loadMFASettings(tc.env, func(k string) string { return tc.vars[k] })
			if tc.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("want error containing %q, got %v", tc.wantErr, err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if s.adminRequired != tc.required {
				t.Fatalf("adminRequired = %v, want %v", s.adminRequired, tc.required)
			}
		})
	}
}

// exerciseMFAStore is the contract both stores must meet.
func exerciseMFAStore(t *testing.T, store mfaStore, key mfaKey) {
	t.Helper()
	ctx := context.Background()
	if _, found, err := store.Factor(ctx, key); err != nil || found {
		t.Fatalf("fresh account: found=%v err=%v", found, err)
	}
	if err := store.SavePending(ctx, key, "v1:first"); err != nil {
		t.Fatal(err)
	}
	if err := store.SavePending(ctx, key, "v1:second"); err != nil {
		t.Fatalf("a pending secret can be replaced: %v", err)
	}
	if ok, _ := store.Activate(ctx, key, "v1:first", 10); ok {
		t.Fatalf("only the current pending secret may be activated")
	}
	if ok, err := store.Activate(ctx, key, "v1:second", 10); err != nil || !ok {
		t.Fatalf("activate: %v %v", ok, err)
	}
	if err := store.SavePending(ctx, key, "v1:third"); !errors.Is(err, errMFAAlreadyActive) {
		t.Fatalf("an active factor must not be replaced: %v", err)
	}
	if f, found, _ := store.Factor(ctx, key); !found || !f.Active || f.LastStep != 10 || f.SecretCiphertext != "v1:second" {
		t.Fatalf("unexpected factor %+v", f)
	}
	if ok, _ := store.ConsumeStep(ctx, key, 10); ok {
		t.Fatalf("a used step must be refused")
	}
	if ok, err := store.ConsumeStep(ctx, key, 11); err != nil || !ok {
		t.Fatalf("a newer step is accepted: %v %v", ok, err)
	}

	digest := strings.Repeat("a", 64)
	ch := mfaChallenge{Account: key, Username: "u", LoginName: "U", ExpiresAt: time.Now().UTC().Add(time.Minute)}
	if err := store.PutChallenge(ctx, digest, ch); err != nil {
		t.Fatal(err)
	}
	if got, found, err := store.Challenge(ctx, digest); err != nil || !found || got.LoginName != "U" || got.Account != key {
		t.Fatalf("challenge: %+v %v %v", got, found, err)
	}
	if n, _ := store.FailChallenge(ctx, digest); n != 1 {
		t.Fatalf("attempts = %d", n)
	}
	if ok, _ := store.TakeChallenge(ctx, digest); !ok {
		t.Fatalf("take")
	}
	if ok, _ := store.TakeChallenge(ctx, digest); ok {
		t.Fatalf("a challenge is taken once")
	}
	expired := strings.Repeat("b", 64)
	ch.ExpiresAt = time.Now().UTC().Add(-time.Second)
	_ = store.PutChallenge(ctx, expired, ch)
	if _, found, _ := store.Challenge(ctx, expired); found {
		t.Fatalf("an expired challenge must not be returned")
	}

	if err := store.Delete(ctx, key); err != nil {
		t.Fatal(err)
	}
	if _, found, _ := store.Factor(ctx, key); found {
		t.Fatalf("deleted")
	}
}

func TestMemoryMFAStoreContract(t *testing.T) {
	exerciseMFAStore(t, newMemoryMFAStore(), mfaKey{Directory: mfaDirectoryStaff, AccountID: "a-1"})
}

// The SQL store and ResetMFA need Postgres: set AUTH_TEST_DB_DSN to run them.
func mfaTestDB(t *testing.T) *sql.DB {
	t.Helper()
	dsn := os.Getenv("AUTH_TEST_DB_DSN")
	if dsn == "" {
		t.Skip("AUTH_TEST_DB_DSN not set")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := (&AuthService{}).ensureUserSchema(db); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestSQLMFAStoreContract(t *testing.T) {
	db := mfaTestDB(t)
	key := mfaKey{Directory: mfaDirectoryUsers, AccountID: fmt.Sprintf("mfa-test-%d", time.Now().UnixNano())}
	t.Cleanup(func() {
		_, _ = db.Exec(`DELETE FROM auth_mfa_totp WHERE account_id = $1`, key.AccountID)
		_, _ = db.Exec(`DELETE FROM auth_mfa_challenges WHERE account_id = $1`, key.AccountID)
	})
	exerciseMFAStore(t, sqlMFAStore{db: db}, key)
}

func TestResetMFARemovesTheEnrollment(t *testing.T) {
	db := mfaTestDB(t)
	id := fmt.Sprintf("mfa-reset-%d", time.Now().UnixNano())
	username := id + "@test.dev"
	if _, err := db.Exec(`INSERT INTO auth_users (id, username, password_hash) VALUES ($1, $2, 'x')`, id, username); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(`DELETE FROM auth_mfa_totp WHERE account_id = $1`, id)
		_, _ = db.Exec(`DELETE FROM auth_users WHERE id = $1`, id)
	})
	store := sqlMFAStore{db: db}
	key := mfaKey{Directory: mfaDirectoryUsers, AccountID: id}
	if err := store.SavePending(context.Background(), key, "v1:x"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Activate(context.Background(), key, "v1:x", 1); err != nil {
		t.Fatal(err)
	}
	matched, removed, err := ResetMFA(context.Background(), db, username)
	if err != nil || matched != 1 || removed != 1 {
		t.Fatalf("ResetMFA = %d, %d, %v", matched, removed, err)
	}
	if _, found, _ := store.Factor(context.Background(), key); found {
		t.Fatalf("the enrollment must be gone")
	}
	if matched, _, err := ResetMFA(context.Background(), db, "nobody-"+id); err != nil || matched != 0 {
		t.Fatalf("unknown account: %d, %v", matched, err)
	}
}

// fakeGoogle is the Google provider pointed at a local token + userinfo server
// that vouches for email.
func fakeGoogle(t *testing.T, subject, email string) *socialProvider {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/token" {
			_, _ = w.Write([]byte(`{"access_token":"provider-token"}`))
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": subject, "email": email, "verified_email": true})
	}))
	t.Cleanup(srv.Close)
	p := googleProvider()
	p.clientID = "test-client"
	p.tokenURL = srv.URL + "/token"
	p.userInfoURL = srv.URL + "/userinfo"
	return p
}
