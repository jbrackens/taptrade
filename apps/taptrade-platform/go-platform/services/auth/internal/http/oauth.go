package http

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	stdhttp "net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"taptrade/platform/transport/httpx"
)

// Social OAuth 2.0 (authorization-code) for multiple providers.
//
// Design notes (security-critical):
//   - Identity is keyed by (provider, subject) in auth_identities, NOT by email.
//   - An incoming social login is auto-LINKED to an existing local account ONLY
//     when the provider asserts a VERIFIED email that matches. Providers that do
//     not return a verified email (X/Twitter, TikTok, Reddit) therefore never
//     auto-link; they always get an isolated account keyed by provider+subject.
//     This closes the "unverified-email account-takeover" vector.
//   - This service NEVER provisions wallets or crypto addresses. Wallets are
//     owned by the gateway and created lazily; any crypto cashier also lives
//     in the gateway (internal/alphacashier). (Confirmed design boundary.)

const oauthUserAgent = "taptrade-auth/1.0"

var oauthHTTPClient = &stdhttp.Client{Timeout: 10 * time.Second}

// oauthIdentity is the normalized result of a provider's userinfo endpoint.
type oauthIdentity struct {
	Provider      string
	Subject       string // provider's stable user id — the linking key
	Email         string // may be empty (X/TikTok/Reddit)
	EmailVerified bool   // only true when the provider asserts verification
	Name          string
}

// socialProvider holds the per-provider OAuth configuration and the bits of the
// flow that differ between providers (token-auth style, PKCE, userinfo shape).
type socialProvider struct {
	name        string // url slug, e.g. "google"
	displayName string // human label for error messages
	clientIDEnv string // env var that holds the client id/key (for error text)

	clientID     string
	clientSecret string
	redirectURI  string

	authURL     string
	tokenURL    string
	userInfoURL string
	scope       string

	clientParam     string            // "client_id" (default) or "client_key" (TikTok)
	clientIDInBody  bool              // include clientParam=clientID in the token request body
	secretInBody    bool              // include client_secret in the token request body
	basicAuth       bool              // send HTTP Basic (clientID:clientSecret) on the token request
	usesPKCE        bool              // PKCE S256 (required by X/Twitter)
	extraAuthParams map[string]string // extra params on the authorize URL (e.g. Reddit duration)

	parseUserInfo func([]byte) (oauthIdentity, error)
}

// configured reports whether the provider has a client id set.
func (p *socialProvider) configured() bool { return p.clientID != "" }

// ─── Registry ──────────────────────────────────────────────────

// registerSocialOAuthRoutes wires /start and /callback for every provider. Routes
// are registered even when a provider is unconfigured; start then returns a clear
// "not configured" error (matching the original Google/Apple behavior).
func registerSocialOAuthRoutes(mux *stdhttp.ServeMux, auth *AuthService, frontendURL string) {
	for _, p := range buildSocialProviders() {
		p := p
		mux.Handle("/api/v1/auth/oauth/"+p.name+"/start", httpx.Handle(p.handleStart()))
		mux.Handle("/api/v1/auth/oauth/"+p.name+"/callback", httpx.Handle(p.handleCallback(auth, frontendURL)))
	}
}

func buildSocialProviders() []*socialProvider {
	return []*socialProvider{
		googleProvider(),
		facebookProvider(),
		discordProvider(),
		twitterProvider(),
		tiktokProvider(),
		redditProvider(),
	}
}

// newProvider seeds shared defaults and reads clientID/secret/redirectURI from
// env using the given prefix (e.g. "GOOGLE_OAUTH").
func newProvider(name, displayName, envPrefix string) *socialProvider {
	return &socialProvider{
		name:           name,
		displayName:    displayName,
		clientIDEnv:    envPrefix + "_CLIENT_ID",
		clientID:       os.Getenv(envPrefix + "_CLIENT_ID"),
		clientSecret:   os.Getenv(envPrefix + "_CLIENT_SECRET"),
		redirectURI:    getEnvOrDefault(envPrefix+"_REDIRECT_URI", "http://localhost:18081/api/v1/auth/oauth/"+name+"/callback"),
		clientParam:    "client_id",
		clientIDInBody: true,
		secretInBody:   true,
	}
}

func googleProvider() *socialProvider {
	p := newProvider("google", "Google", "GOOGLE_OAUTH")
	p.authURL = "https://accounts.google.com/o/oauth2/v2/auth"
	p.tokenURL = "https://oauth2.googleapis.com/token"
	p.userInfoURL = "https://www.googleapis.com/oauth2/v2/userinfo"
	p.scope = "openid email profile"
	p.parseUserInfo = func(b []byte) (oauthIdentity, error) {
		var g struct {
			ID            string `json:"id"`
			Sub           string `json:"sub"`
			Email         string `json:"email"`
			Name          string `json:"name"`
			EmailVerified bool   `json:"email_verified"`
			VerifiedEmail bool   `json:"verified_email"`
		}
		if err := json.Unmarshal(b, &g); err != nil {
			return oauthIdentity{}, err
		}
		return oauthIdentity{
			Subject:       firstNonEmpty(g.ID, g.Sub),
			Email:         g.Email,
			EmailVerified: g.EmailVerified || g.VerifiedEmail,
			Name:          g.Name,
		}, nil
	}
	return p
}

func facebookProvider() *socialProvider {
	p := newProvider("facebook", "Facebook", "FACEBOOK_OAUTH")
	p.authURL = "https://www.facebook.com/v19.0/dialog/oauth"
	p.tokenURL = "https://graph.facebook.com/v19.0/oauth/access_token"
	p.userInfoURL = "https://graph.facebook.com/me?fields=id,name,email"
	p.scope = "email public_profile"
	p.parseUserInfo = func(b []byte) (oauthIdentity, error) {
		var f struct {
			ID    string `json:"id"`
			Name  string `json:"name"`
			Email string `json:"email"`
		}
		if err := json.Unmarshal(b, &f); err != nil {
			return oauthIdentity{}, err
		}
		// Facebook exposes NO email_verified claim. On a custodial money
		// platform we will not auto-link an existing account on that basis, so
		// EmailVerified stays false: Facebook signups get an isolated
		// (facebook, subject) account, like the no-email providers. The email is
		// still captured below for audit/identity records, just not for linking.
		return oauthIdentity{
			Subject:       f.ID,
			Email:         f.Email,
			EmailVerified: false,
			Name:          f.Name,
		}, nil
	}
	return p
}

func discordProvider() *socialProvider {
	p := newProvider("discord", "Discord", "DISCORD_OAUTH")
	p.authURL = "https://discord.com/oauth2/authorize"
	p.tokenURL = "https://discord.com/api/oauth2/token"
	p.userInfoURL = "https://discord.com/api/users/@me"
	p.scope = "identify email"
	p.parseUserInfo = func(b []byte) (oauthIdentity, error) {
		var d struct {
			ID         string `json:"id"`
			Username   string `json:"username"`
			GlobalName string `json:"global_name"`
			Email      string `json:"email"`
			Verified   bool   `json:"verified"`
		}
		if err := json.Unmarshal(b, &d); err != nil {
			return oauthIdentity{}, err
		}
		return oauthIdentity{
			Subject:       d.ID,
			Email:         d.Email,
			EmailVerified: d.Verified,
			Name:          firstNonEmpty(d.GlobalName, d.Username),
		}, nil
	}
	return p
}

func twitterProvider() *socialProvider {
	p := newProvider("twitter", "X", "TWITTER_OAUTH")
	p.authURL = "https://twitter.com/i/oauth2/authorize"
	p.tokenURL = "https://api.twitter.com/2/oauth2/token"
	p.userInfoURL = "https://api.twitter.com/2/users/me"
	p.scope = "tweet.read users.read"
	// X requires PKCE and authenticates confidential clients via HTTP Basic;
	// it does not return email through OAuth 2.0.
	p.usesPKCE = true
	p.basicAuth = true
	p.secretInBody = false
	p.parseUserInfo = func(b []byte) (oauthIdentity, error) {
		var t struct {
			Data struct {
				ID       string `json:"id"`
				Name     string `json:"name"`
				Username string `json:"username"`
			} `json:"data"`
		}
		if err := json.Unmarshal(b, &t); err != nil {
			return oauthIdentity{}, err
		}
		return oauthIdentity{
			Subject: t.Data.ID,
			Name:    firstNonEmpty(t.Data.Name, t.Data.Username),
		}, nil
	}
	return p
}

func tiktokProvider() *socialProvider {
	p := newProvider("tiktok", "TikTok", "TIKTOK_OAUTH")
	// TikTok names the client id "client_key" in both the authorize URL and the
	// token request body.
	p.clientParam = "client_key"
	p.clientIDEnv = "TIKTOK_OAUTH_CLIENT_KEY"
	p.clientID = os.Getenv("TIKTOK_OAUTH_CLIENT_KEY")
	p.authURL = "https://www.tiktok.com/v2/auth/authorize/"
	p.tokenURL = "https://open.tiktokapis.com/v2/oauth/token/"
	p.userInfoURL = "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name"
	p.scope = "user.info.basic"
	p.parseUserInfo = func(b []byte) (oauthIdentity, error) {
		var t struct {
			Data struct {
				User struct {
					OpenID      string `json:"open_id"`
					DisplayName string `json:"display_name"`
				} `json:"user"`
			} `json:"data"`
		}
		if err := json.Unmarshal(b, &t); err != nil {
			return oauthIdentity{}, err
		}
		return oauthIdentity{
			Subject: t.Data.User.OpenID,
			Name:    t.Data.User.DisplayName,
		}, nil
	}
	return p
}

func redditProvider() *socialProvider {
	p := newProvider("reddit", "Reddit", "REDDIT_OAUTH")
	p.authURL = "https://www.reddit.com/api/v1/authorize"
	p.tokenURL = "https://www.reddit.com/api/v1/access_token"
	p.userInfoURL = "https://oauth.reddit.com/api/v1/me"
	p.scope = "identity"
	// Reddit authenticates via HTTP Basic and does not expose email.
	p.basicAuth = true
	p.secretInBody = false
	p.clientIDInBody = false
	p.extraAuthParams = map[string]string{"duration": "temporary"}
	p.parseUserInfo = func(b []byte) (oauthIdentity, error) {
		var r struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		}
		if err := json.Unmarshal(b, &r); err != nil {
			return oauthIdentity{}, err
		}
		return oauthIdentity{Subject: r.ID, Name: r.Name}, nil
	}
	return p
}

// ─── Handlers ──────────────────────────────────────────────────

func (p *socialProvider) handleStart() func(stdhttp.ResponseWriter, *stdhttp.Request) error {
	return func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if !p.configured() {
			return httpx.BadRequest(fmt.Sprintf("%s OAuth is not configured (set %s)", p.displayName, p.clientIDEnv), nil)
		}
		state, err := makeCSRFToken()
		if err != nil {
			return httpx.Internal("failed to generate OAuth state", err)
		}
		secure := oauthCookieSecure()
		setOAuthFlowCookie(w, p.stateCookie(), state, secure, 300)

		params := url.Values{}
		params.Set(p.clientParam, p.clientID)
		params.Set("redirect_uri", p.redirectURI)
		params.Set("response_type", "code")
		params.Set("scope", p.scope)
		params.Set("state", state)
		for k, v := range p.extraAuthParams {
			params.Set(k, v)
		}
		if p.usesPKCE {
			verifier, challenge, perr := newPKCE()
			if perr != nil {
				return httpx.Internal("failed to generate PKCE challenge", perr)
			}
			setOAuthFlowCookie(w, p.pkceCookie(), verifier, secure, 300)
			params.Set("code_challenge", challenge)
			params.Set("code_challenge_method", "S256")
		}

		stdhttp.Redirect(w, r, p.authURL+"?"+params.Encode(), stdhttp.StatusTemporaryRedirect)
		return nil
	}
}

func (p *socialProvider) handleCallback(auth *AuthService, frontendURL string) func(stdhttp.ResponseWriter, *stdhttp.Request) error {
	return func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if provErr := r.URL.Query().Get("error"); provErr != "" {
			// User declined consent, or the provider rejected the request.
			return httpx.BadRequest("OAuth authorization was not completed: "+provErr, nil)
		}
		code := r.URL.Query().Get("code")
		state := r.URL.Query().Get("state")
		if code == "" || state == "" {
			return httpx.BadRequest("missing code or state parameter", nil)
		}
		secure := oauthCookieSecure()
		stateCookie, err := r.Cookie(p.stateCookie())
		if err != nil || stateCookie.Value == "" || stateCookie.Value != state {
			return httpx.Forbidden("OAuth state mismatch")
		}
		setOAuthFlowCookie(w, p.stateCookie(), "", secure, -1)

		verifier := ""
		if p.usesPKCE {
			if pc, perr := r.Cookie(p.pkceCookie()); perr == nil {
				verifier = pc.Value
			}
			setOAuthFlowCookie(w, p.pkceCookie(), "", secure, -1)
			if verifier == "" {
				return httpx.Forbidden("missing PKCE verifier")
			}
		}

		token, err := p.exchangeCode(code, verifier)
		if err != nil {
			log.Printf("%s OAuth token exchange failed: %v", p.name, err)
			return httpx.Internal(p.displayName+" OAuth token exchange failed", err)
		}

		identity, err := p.fetchIdentity(token)
		if err != nil {
			log.Printf("%s OAuth userinfo failed: %v", p.name, err)
			return httpx.Internal("failed to get "+p.displayName+" user info", err)
		}
		identity.Provider = p.name
		if identity.Subject == "" {
			return httpx.Internal(p.displayName+" returned no account identifier", nil)
		}

		account, created, err := resolveOAuthAccount(auth, identity)
		if err != nil {
			return httpx.Internal("failed to resolve OAuth account", err)
		}

		// An account with two-factor sign-in still needs its code: hand the
		// challenge to the login page's code step. Enrolling needs the page
		// that shows the new secret, so that stays with password sign-in.
		challenge, err := auth.challengeFor(account, account.Username, false)
		if err != nil {
			return err
		}
		if challenge != nil {
			setMFAChallengeCookie(w, challenge.MFAToken, int(mfaChallengeTTL.Seconds()))
			auth.audit.Event("auth.oauth."+p.name+".mfa_challenge", map[string]any{"userId": account.ID, "provider": p.name})
			stdhttp.Redirect(w, r, frontendURL+"/auth/login?mfa=1", stdhttp.StatusTemporaryRedirect)
			return nil
		}

		s, response, err := newSession(account, auth.accessTTL, auth.refreshTTL)
		if err != nil {
			return httpx.Internal("failed to create session", err)
		}
		if err := auth.store.Put(s); err != nil {
			return httpx.Internal("failed to persist session", err)
		}
		writeSessionCookies(w, auth, response)

		if created {
			auth.audit.Event("auth.oauth."+p.name+".user_created", map[string]any{"userId": account.ID, "provider": p.name})
		}
		auth.audit.Event("auth.oauth."+p.name+".login", map[string]any{"userId": account.ID, "provider": p.name})

		stdhttp.Redirect(w, r, frontendURL+"/", stdhttp.StatusTemporaryRedirect)
		return nil
	}
}

// ─── Token exchange + userinfo ─────────────────────────────────

type oauthTokenResponse struct {
	AccessToken string `json:"access_token"`
}

func (p *socialProvider) exchangeCode(code, verifier string) (string, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", p.redirectURI)
	if p.clientIDInBody {
		form.Set(p.clientParam, p.clientID)
	}
	if p.secretInBody {
		form.Set("client_secret", p.clientSecret)
	}
	if p.usesPKCE && verifier != "" {
		form.Set("code_verifier", verifier)
	}

	req, err := stdhttp.NewRequest(stdhttp.MethodPost, p.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", oauthUserAgent)
	if p.basicAuth {
		req.SetBasicAuth(p.clientID, p.clientSecret)
	}

	resp, err := oauthHTTPClient.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("token endpoint returned %d: %s", resp.StatusCode, snippet(body))
	}

	var tr oauthTokenResponse
	if err := json.Unmarshal(body, &tr); err != nil {
		return "", fmt.Errorf("failed to decode token response: %w", err)
	}
	if tr.AccessToken == "" {
		return "", fmt.Errorf("empty access_token from %s", p.name)
	}
	return tr.AccessToken, nil
}

func (p *socialProvider) fetchIdentity(accessToken string) (oauthIdentity, error) {
	req, err := stdhttp.NewRequest(stdhttp.MethodGet, p.userInfoURL, nil)
	if err != nil {
		return oauthIdentity{}, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", oauthUserAgent)

	resp, err := oauthHTTPClient.Do(req)
	if err != nil {
		return oauthIdentity{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 400 {
		return oauthIdentity{}, fmt.Errorf("userinfo endpoint returned %d: %s", resp.StatusCode, snippet(body))
	}
	return p.parseUserInfo(body)
}

// ─── Account resolution (find / link / create) ─────────────────

// resolveOAuthAccount maps a provider identity to a local account and reports
// whether it was newly created. Linking to an EXISTING account happens only on
// a provider-verified matching email; everything else gets an isolated account
// keyed by (provider, subject). All DB-backed lookups fail CLOSED — a transient
// DB error aborts the login rather than silently creating or duplicating an
// account on a money platform.
func resolveOAuthAccount(auth *AuthService, id oauthIdentity) (user, bool, error) {
	// 1) Known identity → log straight in.
	userID, found, err := auth.lookupIdentity(id.Provider, id.Subject)
	if err != nil {
		return user{}, false, err
	}
	if found {
		account, ok, err := auth.lookupUserByID(userID)
		if err != nil {
			return user{}, false, err
		}
		if !ok {
			// auth_identities.user_id is ON DELETE CASCADE, so a dangling row
			// should be impossible. Treat it as corruption and fail closed
			// rather than rebuilding into a possibly-wrong account.
			return user{}, false, fmt.Errorf("oauth: dangling identity %s:%s -> missing user %s", id.Provider, id.Subject, userID)
		}
		return account, false, nil
	}

	// 2) New identity. Decide whether to link to an existing account or isolate.
	var account user
	created := false
	switch {
	case id.Email != "" && id.EmailVerified:
		existing, ok, err := auth.userByUsername(id.Email)
		if err != nil {
			return user{}, false, err
		}
		if ok {
			account = existing
		} else {
			account, err = auth.createOAuthUser(id.Email, rolePlayer)
			if err != nil {
				return user{}, false, err
			}
			created = true
		}
	default:
		account, err = auth.createOAuthUser(oauthSyntheticUsername(id.Provider, id.Subject), rolePlayer)
		if err != nil {
			return user{}, false, err
		}
		created = true
	}

	// 3) Record the link and adopt the CANONICAL mapping. If another writer won
	// the (provider, subject) row first, their account is authoritative.
	canonicalID, err := auth.linkIdentity(id, account.ID)
	if err != nil {
		return user{}, false, err
	}
	if canonicalID != account.ID {
		canonical, ok, err := auth.lookupUserByID(canonicalID)
		if err != nil {
			return user{}, false, err
		}
		if !ok {
			return user{}, false, fmt.Errorf("oauth: identity %s:%s links to missing user %s", id.Provider, id.Subject, canonicalID)
		}
		return canonical, false, nil
	}
	return account, created, nil
}

// oauthSyntheticUsername is the username for an isolated (no-verified-email)
// social account. The ':' separator is reserved — Register rejects usernames
// containing it — so a user can never pre-create a row that a later social
// login would collide with and silently adopt.
func oauthSyntheticUsername(provider, subject string) string {
	return provider + ":" + subject
}

// ─── AuthService identity/account helpers ──────────────────────
//
// These fail CLOSED: when a DB is configured it is authoritative, and any error
// other than "no rows" is returned to the caller (which aborts the OAuth login).
// The in-memory maps are used only when no DB is configured (dev/test).

func (a *AuthService) lookupIdentity(provider, subject string) (string, bool, error) {
	if a.db != nil {
		ctx, cancel := context.WithTimeout(context.Background(), userDBTimeout)
		defer cancel()
		var userID string
		err := a.db.QueryRowContext(ctx,
			`SELECT user_id FROM auth_identities WHERE provider = $1 AND subject = $2`,
			provider, subject).Scan(&userID)
		switch {
		case err == nil:
			return userID, true, nil
		case errors.Is(err, sql.ErrNoRows):
			return "", false, nil
		default:
			return "", false, err
		}
	}
	a.mu.RLock()
	defer a.mu.RUnlock()
	userID, ok := a.oauthIdentities[provider+":"+subject]
	return userID, ok, nil
}

// linkIdentity upserts the (provider, subject) → user mapping and returns the
// CANONICAL user id. On a conflict the existing mapping wins, so concurrent
// callers converge on a single account instead of trusting a locally-resolved
// one that may differ.
func (a *AuthService) linkIdentity(id oauthIdentity, userID string) (string, error) {
	if a.db != nil {
		ctx, cancel := context.WithTimeout(context.Background(), userDBTimeout)
		defer cancel()
		rowID := "idn-" + shortHash(id.Provider+":"+id.Subject)
		if _, err := a.db.ExecContext(ctx,
			`INSERT INTO auth_identities (id, user_id, provider, subject, email, email_verified)
			 VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6)
			 ON CONFLICT (provider, subject) DO NOTHING`,
			rowID, userID, id.Provider, id.Subject, id.Email, id.EmailVerified); err != nil {
			return "", err
		}
		var canonical string
		if err := a.db.QueryRowContext(ctx,
			`SELECT user_id FROM auth_identities WHERE provider = $1 AND subject = $2`,
			id.Provider, id.Subject).Scan(&canonical); err != nil {
			return "", err
		}
		return canonical, nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	key := id.Provider + ":" + id.Subject
	if existing, ok := a.oauthIdentities[key]; ok {
		return existing, nil
	}
	a.oauthIdentities[key] = userID
	return userID, nil
}

func (a *AuthService) lookupUserByID(id string) (user, bool, error) {
	if a.db != nil {
		ctx, cancel := context.WithTimeout(context.Background(), userDBTimeout)
		defer cancel()
		var u user
		err := a.db.QueryRowContext(ctx, `
SELECT id, username, password_hash, COALESCE(role, 'player')
FROM auth_users
WHERE id = $1`, id).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role)
		switch {
		case err == nil:
			return u, true, nil
		case errors.Is(err, sql.ErrNoRows):
			return user{}, false, nil
		default:
			return user{}, false, err
		}
	}
	a.mu.RLock()
	defer a.mu.RUnlock()
	for _, u := range a.usersByUsername {
		if u.ID == id {
			return u, true, nil
		}
	}
	return user{}, false, nil
}

// userByUsername is a fail-closed lookup by username (the email for email-keyed
// accounts). Distinct from lookupUser, which fails OPEN for the password-login
// availability path.
func (a *AuthService) userByUsername(username string) (user, bool, error) {
	if a.db != nil {
		ctx, cancel := context.WithTimeout(context.Background(), userDBTimeout)
		defer cancel()
		var u user
		err := a.db.QueryRowContext(ctx, `
SELECT id, username, password_hash, COALESCE(role, 'player')
FROM auth_users
WHERE username = $1`, username).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role)
		switch {
		case err == nil:
			return u, true, nil
		case errors.Is(err, sql.ErrNoRows):
			return user{}, false, nil
		default:
			return user{}, false, err
		}
	}
	a.mu.RLock()
	defer a.mu.RUnlock()
	u, ok := a.usersByUsername[username]
	return u, ok, nil
}

// createOAuthUser inserts a password-less player account. It is idempotent on
// username: a pre-existing row (e.g. a concurrent signup) is reused rather than
// duplicated.
func (a *AuthService) createOAuthUser(username, role string) (user, error) {
	if role == "" {
		role = rolePlayer
	}
	newUser := user{
		ID:       "u-oauth-" + shortHash(username),
		Username: username,
		Role:     role,
	}

	if a.db != nil {
		ctx, cancel := context.WithTimeout(context.Background(), userDBTimeout)
		defer cancel()
		if _, err := a.db.ExecContext(ctx,
			`INSERT INTO auth_users (id, username, password_hash, role, created_at)
			 VALUES ($1, $2, '', $3, NOW())
			 ON CONFLICT (username) DO NOTHING`,
			newUser.ID, newUser.Username, role); err != nil {
			return user{}, err
		}
		// Re-read so a conflicting (pre-existing) row wins, keeping the
		// identity link pointed at the canonical user id. Fail closed.
		existing, ok, err := a.userByUsername(username)
		if err != nil {
			return user{}, err
		}
		if ok {
			return existing, nil
		}
		return newUser, nil
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	if existing, ok := a.usersByUsername[username]; ok {
		return existing, nil
	}
	a.usersByUsername[username] = newUser
	return newUser, nil
}

// ─── small helpers ─────────────────────────────────────────────

func oauthCookieSecure() bool { return os.Getenv("AUTH_COOKIE_SECURE") != "false" }

// Per-provider cookie names so concurrent flows in different tabs don't clobber
// each other's state/verifier.
func (p *socialProvider) stateCookie() string { return "oauth_state_" + p.name }
func (p *socialProvider) pkceCookie() string  { return "oauth_pkce_" + p.name }

// setOAuthFlowCookie sets (or clears, with maxAge < 0) a short-lived OAuth flow
// cookie. The PKCE verifier is a bearer secret, so Secure mirrors the session
// cookie policy.
func setOAuthFlowCookie(w stdhttp.ResponseWriter, name, value string, secure bool, maxAge int) {
	stdhttp.SetCookie(w, &stdhttp.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: stdhttp.SameSiteLaxMode,
		MaxAge:   maxAge,
	})
}

func writeSessionCookies(w stdhttp.ResponseWriter, auth *AuthService, resp tokenResponse) {
	secure := os.Getenv("AUTH_COOKIE_SECURE") != "false"
	stdhttp.SetCookie(w, &stdhttp.Cookie{
		Name: "access_token", Value: resp.AccessToken,
		Path: "/", HttpOnly: true, Secure: secure, SameSite: stdhttp.SameSiteLaxMode,
		MaxAge: int(auth.accessTTL.Seconds()),
	})
	stdhttp.SetCookie(w, &stdhttp.Cookie{
		Name: "refresh_token", Value: resp.RefreshToken,
		Path: "/api/v1/auth/refresh", HttpOnly: true, Secure: secure, SameSite: stdhttp.SameSiteLaxMode,
		MaxAge: int(auth.refreshTTL.Seconds()),
	})
	setCSRFCookie(w, secure, int(auth.accessTTL.Seconds()))
}

// newPKCE returns a high-entropy verifier and its S256 challenge (RFC 7636).
func newPKCE() (verifier, challenge string, err error) {
	raw := make([]byte, 32)
	if _, err = rand.Read(raw); err != nil {
		return "", "", err
	}
	verifier = base64.RawURLEncoding.EncodeToString(raw)
	sum := sha256.Sum256([]byte(verifier))
	challenge = base64.RawURLEncoding.EncodeToString(sum[:])
	return verifier, challenge, nil
}

func shortHash(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])[:16]
}

func snippet(b []byte) string {
	const max = 200
	s := strings.TrimSpace(string(b))
	if len(s) > max {
		return s[:max]
	}
	return s
}
