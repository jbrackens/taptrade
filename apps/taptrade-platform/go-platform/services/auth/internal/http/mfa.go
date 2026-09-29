package http

// Two-factor sign-in with an authenticator app (TOTP).
//
// The whole feature is off unless AUTH_MFA_ENABLED=true: no challenges at
// sign-in, and the /api/v1/auth/login/mfa and /api/v1/auth/mfa routes are not
// mounted. When it is on, staff (role admin, whether from auth_users or the
// gateway's admin_users) must use it while AUTH_ADMIN_MFA_REQUIRED is on, and
// players can turn it on from Account → Security. With a factor in play, login takes two steps: the
// password returns a short-lived challenge instead of a session, and
// POST /api/v1/auth/login/mfa trades the challenge plus a code for the
// session. A staff member with no authenticator yet is enrolled inside that
// challenge: the password step returns a new secret, and the first code from
// it both confirms the factor and signs them in. Secrets are stored encrypted
// (totp.go); `auth mfa-reset` clears a lost authenticator.

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	stdhttp "net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/lib/pq"
	"taptrade/platform/transport/httpx"
)

const (
	mfaDirectoryUsers  = "auth_users"
	mfaDirectoryStaff  = "admin_users"
	mfaChallengeTTL    = 5 * time.Minute
	mfaMaxAttempts     = 5
	mfaChallengeCookie = "mfa_challenge"
	mfaChallengePath   = "/api/v1/auth/login/mfa"
	defaultMFAIssuer   = "TapTrade"
)

var errMFAAlreadyActive = errors.New("two-factor sign-in is already on")

func mfaUnavailable() *httpx.AppError {
	return httpx.NewError(stdhttp.StatusServiceUnavailable, "service_unavailable",
		"two-factor sign-in is unavailable right now", nil, nil)
}

// mfaKey names an account across the two directories that can sign in.
type mfaKey struct{ Directory, AccountID string }

// boundTo is the additional data sealed into the secret's ciphertext.
func (k mfaKey) boundTo() string { return k.Directory + ":" + k.AccountID }

func mfaKeyFor(directory, accountID string) mfaKey {
	if directory == "" {
		directory = mfaDirectoryUsers
	}
	return mfaKey{Directory: directory, AccountID: accountID}
}

type mfaFactor struct {
	SecretCiphertext string
	Active           bool // false while enrollment waits for its first code
	LastStep         int64
}

type mfaChallenge struct {
	Account   mfaKey
	Username  string // the account's own username (admin_users: its email)
	LoginName string // what was typed at sign-in; the lockout counter's key
	Enrolling bool
	Attempts  int
	ExpiresAt time.Time
}

// mfaStore keeps factors and sign-in challenges. sqlMFAStore is the real one;
// memoryMFAStore serves development and tests without a database.
type mfaStore interface {
	Factor(ctx context.Context, key mfaKey) (mfaFactor, bool, error)
	// SavePending stores a secret awaiting its first code, replacing an
	// earlier pending one. errMFAAlreadyActive if a factor is already active.
	SavePending(ctx context.Context, key mfaKey, ciphertext string) error
	// Activate confirms exactly the pending secret given and records step as
	// used; false if that secret is no longer the pending one.
	Activate(ctx context.Context, key mfaKey, ciphertext string, step int64) (bool, error)
	// ConsumeStep records step as used on the active factor; false unless it
	// is newer than the last one, which makes each code single use.
	ConsumeStep(ctx context.Context, key mfaKey, step int64) (bool, error)
	Delete(ctx context.Context, key mfaKey) error

	PutChallenge(ctx context.Context, digest string, c mfaChallenge) error
	Challenge(ctx context.Context, digest string) (mfaChallenge, bool, error)
	// FailChallenge counts a wrong code and returns the attempts so far.
	FailChallenge(ctx context.Context, digest string) (int, error)
	// TakeChallenge deletes the challenge; true only for the caller that did.
	TakeChallenge(ctx context.Context, digest string) (bool, error)
}

type mfaSettings struct {
	enabled       bool // AUTH_MFA_ENABLED; everything below is inert when false
	adminRequired bool
	cipher        *mfaCipher // nil when AUTH_MFA_ENCRYPTION_KEY is unset
	store         mfaStore   // nil when no store can be trusted (see NewAuthService)
	issuer        string
	now           func() time.Time // the clock codes are checked against
}

// loadMFASettings reads the MFA environment. The feature is off unless
// AUTH_MFA_ENABLED=true. Once on, staff MFA defaults on in production and
// staging, where switching it off takes a second, explicit flag, and it
// cannot be on without the key that encrypts the secrets.
func loadMFASettings(env string, getenv func(string) string) (mfaSettings, error) {
	deployed := env == "production" || env == "staging"
	s := mfaSettings{issuer: strings.TrimSpace(getenv("AUTH_MFA_ISSUER")), now: time.Now}
	if raw := strings.TrimSpace(getenv("AUTH_MFA_ENABLED")); raw != "" {
		enabled, err := strconv.ParseBool(raw)
		if err != nil {
			return mfaSettings{}, fmt.Errorf("AUTH_MFA_ENABLED=%q is not true or false", raw)
		}
		s.enabled = enabled
	}
	if !s.enabled {
		if required, _ := strconv.ParseBool(strings.TrimSpace(getenv("AUTH_ADMIN_MFA_REQUIRED"))); required {
			return mfaSettings{}, errors.New("AUTH_ADMIN_MFA_REQUIRED=true needs AUTH_MFA_ENABLED=true")
		}
		return s, nil
	}
	s.adminRequired = deployed
	if s.issuer == "" {
		s.issuer = defaultMFAIssuer
	}
	if raw := strings.TrimSpace(getenv("AUTH_MFA_ENCRYPTION_KEY")); raw != "" {
		key, err := parseMFAKey(raw)
		if err != nil {
			return mfaSettings{}, err
		}
		if s.cipher, err = newMFACipher(key); err != nil {
			return mfaSettings{}, err
		}
	}
	if raw := strings.TrimSpace(getenv("AUTH_ADMIN_MFA_REQUIRED")); raw != "" {
		required, err := strconv.ParseBool(raw)
		if err != nil {
			return mfaSettings{}, fmt.Errorf("AUTH_ADMIN_MFA_REQUIRED=%q is not true or false", raw)
		}
		s.adminRequired = required
	}
	if deployed && !s.adminRequired && strings.TrimSpace(getenv("AUTH_ADMIN_MFA_OFF_ACKNOWLEDGED")) != "true" {
		return mfaSettings{}, fmt.Errorf("AUTH_ADMIN_MFA_REQUIRED=false in %s also needs AUTH_ADMIN_MFA_OFF_ACKNOWLEDGED=true", env)
	}
	if s.adminRequired && s.cipher == nil {
		return mfaSettings{}, errors.New("AUTH_ADMIN_MFA_REQUIRED needs AUTH_MFA_ENCRYPTION_KEY (base64 of 32 random bytes)")
	}
	return s, nil
}

func (a *AuthService) mfaAvailable() bool {
	return a.mfa.enabled && a.mfa.store != nil && a.mfa.cipher != nil
}

func (a *AuthService) mfaRequiredForRole(role string) bool {
	return a.mfa.enabled && a.mfa.adminRequired && role == roleAdmin
}

// ─── Sign-in ────────────────────────────────────────────────

// loginOutcome is a session, or a challenge the session waits behind.
type loginOutcome struct {
	Tokens    *tokenResponse
	Challenge *mfaChallengeResponse
}

type mfaChallengeResponse struct {
	MFARequired      bool           `json:"mfaRequired"`
	MFAToken         string         `json:"mfaToken"`
	ExpiresInSeconds int64          `json:"expiresInSeconds"`
	Enrollment       *mfaEnrollment `json:"enrollment,omitempty"`
}

type mfaEnrollment struct {
	Secret     string `json:"secret"`
	OtpauthURL string `json:"otpauthUrl"`
}

// challengeFor decides whether a password-verified account needs a code
// before it gets a session; nil means it doesn't. It fails closed: if the
// account's factor can't be read, or staff need a factor the service can't
// provide, sign-in stops. allowEnroll=false refuses a sign-in that would have
// to enroll, for flows with no page to show the new secret.
func (a *AuthService) challengeFor(account user, loginName string, allowEnroll bool) (*mfaChallengeResponse, error) {
	if !a.mfa.enabled {
		return nil, nil
	}
	required := a.mfaRequiredForRole(account.Role)
	if a.mfa.store == nil {
		if required {
			return nil, mfaUnavailable()
		}
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), userDBTimeout)
	defer cancel()
	key := mfaKeyFor(account.Directory, account.ID)
	factor, found, err := a.mfa.store.Factor(ctx, key)
	if err != nil {
		slog.Error("auth: two-factor lookup failed", "userId", account.ID, "error", err)
		return nil, mfaUnavailable()
	}
	active := found && factor.Active
	if !active && !required {
		return nil, nil
	}
	if a.mfa.cipher == nil {
		return nil, mfaUnavailable()
	}

	var enrollment *mfaEnrollment
	if !active {
		if !allowEnroll {
			return nil, httpx.Forbidden("sign in with your password to set up two-factor authentication")
		}
		if enrollment, err = a.startEnrollment(ctx, key, account.Username); err != nil {
			return nil, err
		}
	}
	token, err := makeToken("mfa")
	if err != nil {
		return nil, httpx.Internal("failed to start two-factor sign-in", err)
	}
	if err := a.mfa.store.PutChallenge(ctx, digestToken(token), mfaChallenge{
		Account:   key,
		Username:  account.Username,
		LoginName: loginName,
		Enrolling: !active,
		ExpiresAt: time.Now().UTC().Add(mfaChallengeTTL),
	}); err != nil {
		return nil, httpx.Internal("failed to start two-factor sign-in", err)
	}
	a.audit.Event("auth.mfa.challenge_issued", map[string]any{"userId": account.ID, "enrolling": !active})
	return &mfaChallengeResponse{
		MFARequired:      true,
		MFAToken:         token,
		ExpiresInSeconds: int64(mfaChallengeTTL.Seconds()),
		Enrollment:       enrollment,
	}, nil
}

func (a *AuthService) startEnrollment(ctx context.Context, key mfaKey, accountName string) (*mfaEnrollment, error) {
	secret, err := newTOTPSecret()
	if err != nil {
		return nil, httpx.Internal("failed to create a two-factor secret", err)
	}
	sealed, err := a.mfa.cipher.seal(secret, key.boundTo())
	if err != nil {
		return nil, httpx.Internal("failed to protect the two-factor secret", err)
	}
	if err := a.mfa.store.SavePending(ctx, key, sealed); err != nil {
		if errors.Is(err, errMFAAlreadyActive) {
			return nil, httpx.Conflict(err.Error(), nil)
		}
		return nil, httpx.Internal("failed to save the two-factor secret", err)
	}
	return &mfaEnrollment{Secret: secret, OtpauthURL: otpauthURL(a.mfa.issuer, accountName, secret)}, nil
}

// VerifyLoginMFA completes a two-step sign-in: the challenge from the password
// step plus a current code. Wrong codes count toward both the challenge's
// attempt limit and the account lockout.
func (a *AuthService) VerifyLoginMFA(challengeToken, code string) (tokenResponse, error) {
	expired := httpx.Unauthorized("sign-in expired; enter your password again")
	if !a.mfaAvailable() {
		return tokenResponse{}, mfaUnavailable()
	}
	ctx, cancel := context.WithTimeout(context.Background(), userDBTimeout)
	defer cancel()
	digest := digestToken(challengeToken)
	ch, found, err := a.mfa.store.Challenge(ctx, digest)
	if err != nil {
		return tokenResponse{}, httpx.Internal("failed to read the sign-in challenge", err)
	}
	if !found || ch.ExpiresAt.Before(time.Now().UTC()) {
		return tokenResponse{}, expired
	}
	if a.lockout.IsLocked(ch.LoginName) {
		a.audit.Event("auth.login.locked_out", map[string]any{"username": ch.LoginName})
		return tokenResponse{}, httpx.TooManyRequests("account temporarily locked due to repeated failures")
	}
	account, ok := a.accountForChallenge(ch)
	if !ok {
		_, _ = a.mfa.store.TakeChallenge(ctx, digest)
		return tokenResponse{}, expired
	}

	verified, err := a.checkChallengeCode(ctx, ch, code)
	if err != nil {
		return tokenResponse{}, err
	}
	if !verified {
		attempts, ferr := a.mfa.store.FailChallenge(ctx, digest)
		if ferr != nil || attempts >= mfaMaxAttempts {
			_, _ = a.mfa.store.TakeChallenge(ctx, digest)
		}
		a.lockout.RecordFailure(ch.LoginName)
		a.recordAuthMetric("login_failure")
		a.audit.Event("auth.mfa.failed", map[string]any{"username": ch.LoginName, "userId": account.ID})
		return tokenResponse{}, httpx.Unauthorized("incorrect code")
	}
	if taken, err := a.mfa.store.TakeChallenge(ctx, digest); err != nil || !taken {
		return tokenResponse{}, expired
	}
	if ch.Enrolling {
		a.audit.Event("auth.mfa.enrolled", map[string]any{"userId": account.ID, "via": "login"})
	}
	a.lockout.ClearFailures(ch.LoginName)
	return a.openSession(account, ch.LoginName)
}

// checkChallengeCode checks code against the account's active factor, or,
// for an enrolling challenge, against the pending secret, which it activates.
func (a *AuthService) checkChallengeCode(ctx context.Context, ch mfaChallenge, code string) (bool, error) {
	factor, found, err := a.mfa.store.Factor(ctx, ch.Account)
	if err != nil {
		return false, httpx.Internal("failed to read the two-factor secret", err)
	}
	if !found || (!factor.Active && !ch.Enrolling) {
		return false, nil
	}
	secret, err := a.mfa.cipher.open(factor.SecretCiphertext, ch.Account.boundTo())
	if err != nil {
		slog.Error("auth: two-factor secret did not decrypt", "userId", ch.Account.AccountID, "error", err)
		return false, mfaUnavailable()
	}
	step, ok := totpMatch(secret, code, a.mfa.now())
	if !ok {
		return false, nil
	}
	if factor.Active {
		ok, err = a.mfa.store.ConsumeStep(ctx, ch.Account, step)
	} else {
		ok, err = a.mfa.store.Activate(ctx, ch.Account, factor.SecretCiphertext, step)
	}
	if err != nil {
		return false, httpx.Internal("failed to record the two-factor code", err)
	}
	return ok, nil
}

// accountForChallenge re-reads the account, so one disabled or removed while
// the code was being typed doesn't get a session.
func (a *AuthService) accountForChallenge(ch mfaChallenge) (user, bool) {
	var account user
	var ok bool
	if ch.Account.Directory == mfaDirectoryStaff {
		account, ok = a.lookupAdminUser(ch.Username)
	} else {
		account, ok = a.lookupUser(ch.Username)
	}
	if !ok || account.ID != ch.Account.AccountID {
		return user{}, false
	}
	return account, true
}

// ─── Account → Security ─────────────────────────────────────

type mfaStatusResponse struct {
	Available bool `json:"available"`
	Enabled   bool `json:"enabled"`
	Pending   bool `json:"pending"`
	Required  bool `json:"required"`
}

type mfaCodeRequest struct {
	Code string `json:"code"`
}

func (a *AuthService) MFAStatus(s session) (mfaStatusResponse, error) {
	status := mfaStatusResponse{Available: a.mfaAvailable(), Required: a.mfaRequiredForRole(s.Role)}
	if a.mfa.store == nil {
		return status, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), userDBTimeout)
	defer cancel()
	factor, found, err := a.mfa.store.Factor(ctx, mfaKeyFor(s.Directory, s.UserID))
	if err != nil {
		return mfaStatusResponse{}, httpx.Internal("failed to read two-factor status", err)
	}
	status.Enabled = found && factor.Active
	status.Pending = found && !factor.Active
	return status, nil
}

func (a *AuthService) MFAEnroll(s session) (*mfaEnrollment, error) {
	if !a.mfaAvailable() {
		return nil, mfaUnavailable()
	}
	ctx, cancel := context.WithTimeout(context.Background(), userDBTimeout)
	defer cancel()
	return a.startEnrollment(ctx, mfaKeyFor(s.Directory, s.UserID), s.Username)
}

func (a *AuthService) MFAActivate(s session, code string) error {
	if !a.mfaAvailable() {
		return mfaUnavailable()
	}
	ctx, cancel := context.WithTimeout(context.Background(), userDBTimeout)
	defer cancel()
	key := mfaKeyFor(s.Directory, s.UserID)
	factor, found, err := a.mfa.store.Factor(ctx, key)
	if err != nil {
		return httpx.Internal("failed to read the two-factor secret", err)
	}
	if found && factor.Active {
		return httpx.Conflict(errMFAAlreadyActive.Error(), nil)
	}
	if !found {
		return httpx.BadRequest("start two-factor setup first", nil)
	}
	secret, err := a.mfa.cipher.open(factor.SecretCiphertext, key.boundTo())
	if err != nil {
		return mfaUnavailable()
	}
	step, ok := totpMatch(secret, code, a.mfa.now())
	if !ok {
		return httpx.BadRequest("incorrect code", map[string]any{"field": "code"})
	}
	activated, err := a.mfa.store.Activate(ctx, key, factor.SecretCiphertext, step)
	if err != nil {
		return httpx.Internal("failed to turn on two-factor sign-in", err)
	}
	if !activated {
		return httpx.Conflict("two-factor setup was restarted elsewhere; start again", nil)
	}
	a.audit.Event("auth.mfa.enrolled", map[string]any{"userId": s.UserID, "via": "settings"})
	return nil
}

func (a *AuthService) MFADisable(s session, code string) error {
	if a.mfaRequiredForRole(s.Role) {
		return httpx.Forbidden("staff accounts must keep two-factor sign-in on")
	}
	if !a.mfaAvailable() {
		return mfaUnavailable()
	}
	ctx, cancel := context.WithTimeout(context.Background(), userDBTimeout)
	defer cancel()
	key := mfaKeyFor(s.Directory, s.UserID)
	factor, found, err := a.mfa.store.Factor(ctx, key)
	if err != nil {
		return httpx.Internal("failed to read the two-factor secret", err)
	}
	if !found || !factor.Active {
		return httpx.BadRequest("two-factor sign-in is not on", nil)
	}
	secret, err := a.mfa.cipher.open(factor.SecretCiphertext, key.boundTo())
	if err != nil {
		return mfaUnavailable()
	}
	step, ok := totpMatch(secret, code, a.mfa.now())
	if !ok {
		return httpx.BadRequest("incorrect code", map[string]any{"field": "code"})
	}
	if consumed, err := a.mfa.store.ConsumeStep(ctx, key, step); err != nil {
		return httpx.Internal("failed to record the two-factor code", err)
	} else if !consumed {
		return httpx.BadRequest("that code was already used; wait for the next one", map[string]any{"field": "code"})
	}
	if err := a.mfa.store.Delete(ctx, key); err != nil {
		return httpx.Internal("failed to turn off two-factor sign-in", err)
	}
	a.audit.Event("auth.mfa.disabled", map[string]any{"userId": s.UserID})
	return nil
}

// ─── Routes ─────────────────────────────────────────────────

func registerMFARoutes(mux *stdhttp.ServeMux, auth *AuthService) {
	if !auth.mfa.enabled {
		return // AUTH_MFA_ENABLED is off: the routes 404
	}
	mux.Handle(mfaChallengePath, httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}
		r.Body = stdhttp.MaxBytesReader(w, r.Body, 64<<10)
		if ip := extractIP(r); ip != "" && !auth.loginLimiter.Allow("login-ip:"+ip, 30, time.Minute) {
			return httpx.TooManyRequests("too many login attempts, try again later")
		}
		var body struct {
			MFAToken string `json:"mfaToken"`
			Code     string `json:"code"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			return httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
		}
		// The token comes back in the body (the office's server-side proxy)
		// or in the cookie set with it (the player app, social sign-in).
		token := strings.TrimSpace(body.MFAToken)
		if token == "" {
			if c, err := r.Cookie(mfaChallengeCookie); err == nil {
				token = c.Value
			}
		}
		if token == "" {
			return httpx.Unauthorized("sign-in expired; enter your password again")
		}
		if strings.TrimSpace(body.Code) == "" {
			return httpx.BadRequest("code is required", map[string]any{"field": "code"})
		}
		tokens, err := auth.VerifyLoginMFA(token, body.Code)
		if err != nil {
			return err
		}
		setMFAChallengeCookie(w, "", -1)
		writeSessionCookies(w, auth, tokens)
		return httpx.WriteJSON(w, stdhttp.StatusOK, tokens)
	}))

	mux.Handle("/api/v1/auth/mfa", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		s, err := auth.currentSessionFromRequest(r)
		if err != nil {
			return err
		}
		status, err := auth.MFAStatus(s)
		if err != nil {
			return err
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, status)
	}))

	mux.Handle("/api/v1/auth/mfa/enroll", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		s, err := auth.mfaSettingsRequest(w, r, nil)
		if err != nil {
			return err
		}
		enrollment, err := auth.MFAEnroll(s)
		if err != nil {
			return err
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, enrollment)
	}))

	mux.Handle("/api/v1/auth/mfa/activate", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		var body mfaCodeRequest
		s, err := auth.mfaSettingsRequest(w, r, &body)
		if err != nil {
			return err
		}
		if err := auth.MFAActivate(s, body.Code); err != nil {
			return err
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]bool{"enabled": true})
	}))

	mux.Handle("/api/v1/auth/mfa/disable", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		var body mfaCodeRequest
		s, err := auth.mfaSettingsRequest(w, r, &body)
		if err != nil {
			return err
		}
		if err := auth.MFADisable(s, body.Code); err != nil {
			return err
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]bool{"enabled": false})
	}))
}

// mfaSettingsRequest authenticates a state-changing settings call: POST, a
// valid session, the CSRF pair when the session came from the cookie (the
// gateway skips CSRF for /api/v1/auth/*), and a per-account rate limit.
func (a *AuthService) mfaSettingsRequest(w stdhttp.ResponseWriter, r *stdhttp.Request, body any) (session, error) {
	if r.Method != stdhttp.MethodPost {
		return session{}, httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
	}
	s, err := a.currentSessionFromRequest(r)
	if err != nil {
		return session{}, err
	}
	if c, cerr := r.Cookie("access_token"); cerr == nil && c.Value != "" {
		if err := verifyCSRF(r); err != nil {
			return session{}, err
		}
	}
	if !a.loginLimiter.Allow("mfa:"+s.UserID, 10, time.Minute) {
		return session{}, httpx.TooManyRequests("too many attempts, try again later")
	}
	if body != nil {
		r.Body = stdhttp.MaxBytesReader(w, r.Body, 64<<10)
		if err := json.NewDecoder(r.Body).Decode(body); err != nil {
			return session{}, httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
		}
	}
	return s, nil
}

// setMFAChallengeCookie holds the challenge for browsers that sign in
// directly; maxAge -1 clears it.
func setMFAChallengeCookie(w stdhttp.ResponseWriter, token string, maxAge int) {
	stdhttp.SetCookie(w, &stdhttp.Cookie{
		Name:     mfaChallengeCookie,
		Value:    token,
		Path:     mfaChallengePath,
		HttpOnly: true,
		Secure:   os.Getenv("AUTH_COOKIE_SECURE") != "false",
		SameSite: stdhttp.SameSiteLaxMode,
		MaxAge:   maxAge,
	})
}

// ─── Reset (auth mfa-reset) ─────────────────────────────────

// ResetMFA removes the two-factor enrollment of every account that signs in
// as identifier (a username or email, in auth_users and admin_users), with
// any sign-in challenges in flight. Staff enroll again at their next sign-in.
// It returns how many accounts matched and how many enrollments it removed.
func ResetMFA(ctx context.Context, db *sql.DB, identifier string) (matched int, removed int64, err error) {
	identifier = strings.TrimSpace(identifier)
	if identifier == "" {
		return 0, 0, errors.New("a username or email is required")
	}
	lookups := []struct{ directory, query string }{
		{mfaDirectoryUsers, `SELECT id FROM auth_users WHERE username = $1 OR lower(email) = lower($1)`},
		{mfaDirectoryStaff, `SELECT id::text FROM admin_users WHERE lower(email) = lower($1)`},
	}
	for _, l := range lookups {
		ids, err := queryIDs(ctx, db, l.query, identifier)
		var pqErr *pq.Error
		if errors.As(err, &pqErr) && pqErr.Code == "42P01" {
			continue // admin_users belongs to the gateway's schema; absent here
		}
		if err != nil {
			return matched, removed, err
		}
		for _, id := range ids {
			matched++
			res, err := db.ExecContext(ctx, `DELETE FROM auth_mfa_totp WHERE directory = $1 AND account_id = $2`, l.directory, id)
			if err != nil {
				return matched, removed, err
			}
			n, _ := res.RowsAffected()
			removed += n
			if _, err := db.ExecContext(ctx, `DELETE FROM auth_mfa_challenges WHERE directory = $1 AND account_id = $2`, l.directory, id); err != nil {
				return matched, removed, err
			}
		}
	}
	return matched, removed, nil
}

func queryIDs(ctx context.Context, db *sql.DB, query, arg string) ([]string, error) {
	rows, err := db.QueryContext(ctx, query, arg)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// ─── Stores ─────────────────────────────────────────────────

func ensureMFASchema(ctx context.Context, db *sql.DB) error {
	_, err := db.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS auth_mfa_totp (
  directory VARCHAR(20) NOT NULL,
  account_id VARCHAR(255) NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  activated_at TIMESTAMPTZ NULL,
  last_used_step BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (directory, account_id)
);
CREATE TABLE IF NOT EXISTS auth_mfa_challenges (
  token_digest CHAR(64) PRIMARY KEY,
  directory VARCHAR(20) NOT NULL,
  account_id VARCHAR(255) NOT NULL,
  username VARCHAR(255) NOT NULL,
  login_name VARCHAR(255) NOT NULL,
  enrolling BOOLEAN NOT NULL DEFAULT FALSE,
  attempts INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`)
	return err
}

type sqlMFAStore struct{ db *sql.DB }

func (s sqlMFAStore) Factor(ctx context.Context, key mfaKey) (mfaFactor, bool, error) {
	var f mfaFactor
	err := s.db.QueryRowContext(ctx, `
SELECT secret_ciphertext, activated_at IS NOT NULL, last_used_step
FROM auth_mfa_totp WHERE directory = $1 AND account_id = $2`, key.Directory, key.AccountID).
		Scan(&f.SecretCiphertext, &f.Active, &f.LastStep)
	if errors.Is(err, sql.ErrNoRows) {
		return mfaFactor{}, false, nil
	}
	if err != nil {
		return mfaFactor{}, false, err
	}
	return f, true, nil
}

func (s sqlMFAStore) SavePending(ctx context.Context, key mfaKey, ciphertext string) error {
	res, err := s.db.ExecContext(ctx, `
INSERT INTO auth_mfa_totp (directory, account_id, secret_ciphertext)
VALUES ($1, $2, $3)
ON CONFLICT (directory, account_id) DO UPDATE
SET secret_ciphertext = EXCLUDED.secret_ciphertext, last_used_step = 0, updated_at = NOW()
WHERE auth_mfa_totp.activated_at IS NULL`, key.Directory, key.AccountID, ciphertext)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return errMFAAlreadyActive
	}
	return nil
}

func (s sqlMFAStore) Activate(ctx context.Context, key mfaKey, ciphertext string, step int64) (bool, error) {
	return s.execOne(ctx, `
UPDATE auth_mfa_totp SET activated_at = NOW(), last_used_step = $4, updated_at = NOW()
WHERE directory = $1 AND account_id = $2 AND secret_ciphertext = $3 AND activated_at IS NULL`,
		key.Directory, key.AccountID, ciphertext, step)
}

func (s sqlMFAStore) ConsumeStep(ctx context.Context, key mfaKey, step int64) (bool, error) {
	return s.execOne(ctx, `
UPDATE auth_mfa_totp SET last_used_step = $3, updated_at = NOW()
WHERE directory = $1 AND account_id = $2 AND activated_at IS NOT NULL AND last_used_step < $3`,
		key.Directory, key.AccountID, step)
}

func (s sqlMFAStore) Delete(ctx context.Context, key mfaKey) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM auth_mfa_totp WHERE directory = $1 AND account_id = $2`, key.Directory, key.AccountID)
	return err
}

func (s sqlMFAStore) PutChallenge(ctx context.Context, digest string, c mfaChallenge) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM auth_mfa_challenges WHERE expires_at < NOW()`); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO auth_mfa_challenges (token_digest, directory, account_id, username, login_name, enrolling, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		digest, c.Account.Directory, c.Account.AccountID, c.Username, c.LoginName, c.Enrolling, c.ExpiresAt)
	return err
}

func (s sqlMFAStore) Challenge(ctx context.Context, digest string) (mfaChallenge, bool, error) {
	var c mfaChallenge
	err := s.db.QueryRowContext(ctx, `
SELECT directory, account_id, username, login_name, enrolling, attempts, expires_at
FROM auth_mfa_challenges WHERE token_digest = $1 AND expires_at > NOW()`, digest).
		Scan(&c.Account.Directory, &c.Account.AccountID, &c.Username, &c.LoginName, &c.Enrolling, &c.Attempts, &c.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return mfaChallenge{}, false, nil
	}
	if err != nil {
		return mfaChallenge{}, false, err
	}
	return c, true, nil
}

func (s sqlMFAStore) FailChallenge(ctx context.Context, digest string) (int, error) {
	var attempts int
	err := s.db.QueryRowContext(ctx, `
UPDATE auth_mfa_challenges SET attempts = attempts + 1 WHERE token_digest = $1 RETURNING attempts`, digest).Scan(&attempts)
	if errors.Is(err, sql.ErrNoRows) {
		return mfaMaxAttempts, nil
	}
	return attempts, err
}

func (s sqlMFAStore) TakeChallenge(ctx context.Context, digest string) (bool, error) {
	return s.execOne(ctx, `DELETE FROM auth_mfa_challenges WHERE token_digest = $1 AND expires_at > NOW()`, digest)
}

func (s sqlMFAStore) execOne(ctx context.Context, query string, args ...any) (bool, error) {
	res, err := s.db.ExecContext(ctx, query, args...)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n == 1, err
}

// memoryMFAStore is for development and tests only: NewAuthService never uses
// it in production or staging, where losing enrollments on restart would let
// a password alone enroll a new authenticator.
type memoryMFAStore struct {
	mu         sync.Mutex
	factors    map[mfaKey]mfaFactor
	challenges map[string]mfaChallenge
}

func newMemoryMFAStore() *memoryMFAStore {
	return &memoryMFAStore{factors: map[mfaKey]mfaFactor{}, challenges: map[string]mfaChallenge{}}
}

func (m *memoryMFAStore) Factor(_ context.Context, key mfaKey) (mfaFactor, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	f, ok := m.factors[key]
	return f, ok, nil
}

func (m *memoryMFAStore) SavePending(_ context.Context, key mfaKey, ciphertext string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if f, ok := m.factors[key]; ok && f.Active {
		return errMFAAlreadyActive
	}
	m.factors[key] = mfaFactor{SecretCiphertext: ciphertext}
	return nil
}

func (m *memoryMFAStore) Activate(_ context.Context, key mfaKey, ciphertext string, step int64) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	f, ok := m.factors[key]
	if !ok || f.Active || f.SecretCiphertext != ciphertext {
		return false, nil
	}
	m.factors[key] = mfaFactor{SecretCiphertext: ciphertext, Active: true, LastStep: step}
	return true, nil
}

func (m *memoryMFAStore) ConsumeStep(_ context.Context, key mfaKey, step int64) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	f, ok := m.factors[key]
	if !ok || !f.Active || f.LastStep >= step {
		return false, nil
	}
	f.LastStep = step
	m.factors[key] = f
	return true, nil
}

func (m *memoryMFAStore) Delete(_ context.Context, key mfaKey) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.factors, key)
	return nil
}

func (m *memoryMFAStore) PutChallenge(_ context.Context, digest string, c mfaChallenge) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now().UTC()
	for d, existing := range m.challenges {
		if existing.ExpiresAt.Before(now) {
			delete(m.challenges, d)
		}
	}
	m.challenges[digest] = c
	return nil
}

func (m *memoryMFAStore) Challenge(_ context.Context, digest string) (mfaChallenge, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.challenges[digest]
	if !ok || !c.ExpiresAt.After(time.Now().UTC()) {
		return mfaChallenge{}, false, nil
	}
	return c, true, nil
}

func (m *memoryMFAStore) FailChallenge(_ context.Context, digest string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.challenges[digest]
	if !ok {
		return mfaMaxAttempts, nil
	}
	c.Attempts++
	m.challenges[digest] = c
	return c.Attempts, nil
}

func (m *memoryMFAStore) TakeChallenge(_ context.Context, digest string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.challenges[digest]
	if !ok || !c.ExpiresAt.After(time.Now().UTC()) {
		return false, nil
	}
	delete(m.challenges, digest)
	return true, nil
}
