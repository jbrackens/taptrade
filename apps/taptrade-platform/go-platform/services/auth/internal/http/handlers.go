package http

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"log/slog"
	"net"
	stdhttp "net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
	"taptrade/platform/transport/httpx"
)

const (
	defaultAccessTokenTTL  = 15 * time.Minute
	defaultRefreshTokenTTL = 24 * time.Hour
	tokenSize              = 24
	csrfTokenSize          = 32
	csrfCookieName         = "csrf_token"
	csrfHeaderName         = "X-CSRF-Token"
)

type AuthService struct {
	mu sync.RWMutex

	usersByUsername map[string]user
	oauthIdentities map[string]string // "provider:subject" -> userID (in-memory fallback when db == nil)
	db              *sql.DB           // nil = in-memory mode
	store           SessionStore
	audit           AuditLogger
	metrics         authMetrics
	mfa             mfaSettings // two-factor sign-in (mfa.go)

	accessTTL  time.Duration
	refreshTTL time.Duration

	loginLimiter    RateLimiterBackend
	registerLimiter RateLimiterBackend
	lockout         LockoutBackend
}

type registerRequest struct {
	Username                      string `json:"username"`
	Password                      string `json:"password"`
	// QA fix ISSUE-023 (2026-07-26): the player app has always SENT an
	// email at signup, but this struct silently dropped it at decode —
	// so "USERNAME OR EMAIL" login could never match an email and no
	// address was on file for recovery.
	Email                         string `json:"email,omitempty"`
	Role                          string `json:"role,omitempty"`
	TermsAccepted                 *bool  `json:"terms_accepted,omitempty"`
	TermsAcceptedCamel            *bool  `json:"termsAccepted,omitempty"`
	TermsVersion                  string `json:"terms_version,omitempty"`
	TermsVersionCamel             string `json:"termsVersion,omitempty"`
	LaunchDisclosureAccepted      *bool  `json:"launch_disclosure_accepted,omitempty"`
	LaunchDisclosureAcceptedCamel *bool  `json:"launchDisclosureAccepted,omitempty"`
	LaunchDisclosureVersion       string `json:"launch_disclosure_version,omitempty"`
	LaunchDisclosureVersionCamel  string `json:"launchDisclosureVersion,omitempty"`
}

const (
	bcryptCost                = 12
	userDBTimeout             = 5 * time.Second
	rolePlayer                = "player"
	roleAdmin                 = "admin"
	taptradeLaunchTermsVersion = "taptrade-launch-v1"
	taptradeDisclosureVersion  = "points-no-cashout-v1"
)

type user struct {
	ID                         string
	Username                   string
	Email                      string // lowercased; empty for legacy/seeded accounts
	Password                   string // plaintext (dev mode only, deprecated)
	PasswordHash               string // bcrypt hash (production mode)
	Role                       string // "player" or "admin"
	Directory                  string // "" or "auth_users"; "admin_users" for back-office staff
	TermsAccepted              bool
	TermsVersion               string
	TermsAcceptedAt            string
	LaunchDisclosureAccepted   bool
	LaunchDisclosureVersion    string
	LaunchDisclosureAcceptedAt string
}

type session struct {
	UserID                     string    `json:"userId"`
	Username                   string    `json:"username"`
	Role                       string    `json:"role"`
	Directory                  string    `json:"directory,omitempty"` // which table the account is in (mfa.go)
	AccessTokenDigest          string    `json:"accessTokenDigest"`
	RefreshTokenDigest         string    `json:"refreshTokenDigest"`
	AccessUntil                time.Time `json:"accessUntil"`
	RefreshUntil               time.Time `json:"refreshUntil"`
	IssuedAt                   time.Time `json:"issuedAt"`
	TermsAccepted              bool      `json:"termsAccepted"`
	TermsVersion               string    `json:"termsVersion,omitempty"`
	TermsAcceptedAt            string    `json:"termsAcceptedAt,omitempty"`
	LaunchDisclosureAccepted   bool      `json:"launchDisclosureAccepted"`
	LaunchDisclosureVersion    string    `json:"launchDisclosureVersion,omitempty"`
	LaunchDisclosureAcceptedAt string    `json:"launchDisclosureAcceptedAt,omitempty"`
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type refreshRequest struct {
	RefreshToken string `json:"refreshToken"`
}

type changePasswordRequest struct {
	UserID          string `json:"user_id"`
	UserIDCamel     string `json:"userId"`
	CurrentPassword string `json:"current_password"`
	CurrentCamel    string `json:"currentPassword"`
	NewPassword     string `json:"new_password"`
	NewCamel        string `json:"newPassword"`
}

type tokenResponse struct {
	TokenType       string `json:"tokenType"`
	AccessToken     string `json:"accessToken"`
	RefreshToken    string `json:"refreshToken"`
	ExpiresInSecond int64  `json:"expiresInSeconds"`
}

type sessionResponse struct {
	Authenticated              bool   `json:"authenticated"`
	UserID                     string `json:"userId"`
	Username                   string `json:"username"`
	Role                       string `json:"role"`
	ExpiresAt                  string `json:"expiresAt"`
	TermsAccepted              bool   `json:"termsAccepted"`
	TermsVersion               string `json:"termsVersion,omitempty"`
	TermsAcceptedAt            string `json:"termsAcceptedAt,omitempty"`
	LaunchDisclosureAccepted   bool   `json:"launchDisclosureAccepted"`
	LaunchDisclosureVersion    string `json:"launchDisclosureVersion,omitempty"`
	LaunchDisclosureAcceptedAt string `json:"launchDisclosureAcceptedAt,omitempty"`
}

type metricsResponse struct {
	LoginSuccess   int64 `json:"loginSuccess"`
	LoginFailure   int64 `json:"loginFailure"`
	RefreshSuccess int64 `json:"refreshSuccess"`
	RefreshFailure int64 `json:"refreshFailure"`
	SessionSuccess int64 `json:"sessionSuccess"`
	SessionFailure int64 `json:"sessionFailure"`
}

type authMetrics struct {
	loginSuccess   int64
	loginFailure   int64
	refreshSuccess int64
	refreshFailure int64
	sessionSuccess int64
	sessionFailure int64
}

type AuditLogger interface {
	Event(name string, fields map[string]any)
}

type structuredAuditLogger struct {
	logger *log.Logger
}

func NewAuthService() *AuthService {
	env := strings.ToLower(strings.TrimSpace(os.Getenv("ENVIRONMENT")))

	demoUsername := os.Getenv("AUTH_DEMO_USERNAME")
	demoPassword := os.Getenv("AUTH_DEMO_PASSWORD")
	demoUserID := getEnvOrDefault("AUTH_DEMO_USER_ID", "u-1")
	adminUsername := os.Getenv("AUTH_ADMIN_USERNAME")
	adminPassword := os.Getenv("AUTH_ADMIN_PASSWORD")
	adminUserID := getEnvOrDefault("AUTH_ADMIN_USER_ID", "user-admin")

	// In production/staging, seed credentials MUST come from environment.
	// In development, provide defaults so the platform works out-of-the-box.
	if env == "production" || env == "staging" {
		if demoUsername == "" || demoPassword == "" || adminUsername == "" || adminPassword == "" {
			log.Fatalf("FATAL: AUTH_DEMO_USERNAME, AUTH_DEMO_PASSWORD, AUTH_ADMIN_USERNAME, and AUTH_ADMIN_PASSWORD must be set in %s", env)
		}
	} else {
		if demoUsername == "" {
			demoUsername = "demo@taptrade.local"
		}
		if demoPassword == "" {
			demoPassword = "demo123"
		}
		if adminUsername == "" {
			adminUsername = "admin@taptrade.local"
		}
		if adminPassword == "" {
			adminPassword = "admin123"
		}
	}
	mfa, err := loadMFASettings(env, os.Getenv)
	if err != nil {
		log.Fatalf("FATAL: %v", err)
	}

	sessionStorePath := os.Getenv("AUTH_SESSION_STORE_FILE")
	// Session store backend selection. Redis is preferred: it is durable across
	// an auth-service restart AND shared across instances, so the service scales
	// horizontally (the file-backed store is per-process — a second instance
	// cannot validate a token the first minted, and a restart drops every
	// session unless a single file happens to be mounted). AUTH_SESSION_REDIS_URL
	// takes precedence; absent that we reuse AUTH_REDIS_URL (the same Redis
	// already used for rate limiting). With neither set, fall back to the
	// single-instance file-backed store for local dev.
	sessionRedisURL := strings.TrimSpace(os.Getenv("AUTH_SESSION_REDIS_URL"))
	if sessionRedisURL == "" {
		sessionRedisURL = strings.TrimSpace(os.Getenv("AUTH_REDIS_URL"))
	}
	isProduction := env == "production" || env == "staging"
	if isProduction && sessionStorePath == "" && sessionRedisURL == "" {
		log.Fatalf("FATAL: set AUTH_SESSION_REDIS_URL (preferred — enables multi-instance) or AUTH_SESSION_STORE_FILE in %s; sessions would otherwise be lost on restart", env)
	}
	var sessionStore SessionStore
	if sessionRedisURL != "" {
		opts, sErr := redis.ParseURL(sessionRedisURL)
		if sErr != nil {
			log.Fatalf("FATAL: session Redis URL is invalid: %v", sErr)
		}
		sessionStore = NewRedisSessionStore(redis.NewClient(opts))
		slog.Info("auth: session store backed by Redis (restart-durable, multi-instance)")
	} else {
		sessionStore = NewFileBackedSessionStore(sessionStorePath)
		slog.Info("auth: session store file-backed (single-instance only)", "path", sessionStorePath)
	}

	// Hash seed passwords with bcrypt for consistency
	demoHash, _ := bcrypt.GenerateFromPassword([]byte(demoPassword), bcryptCost)
	adminHash, _ := bcrypt.GenerateFromPassword([]byte(adminPassword), bcryptCost)

	users := map[string]user{
		demoUsername: {
			ID:           demoUserID,
			Username:     demoUsername,
			Password:     demoPassword,
			PasswordHash: string(demoHash),
			Role:         rolePlayer,
		},
	}
	if _, exists := users[adminUsername]; !exists {
		users[adminUsername] = user{
			ID:           adminUserID,
			Username:     adminUsername,
			Password:     adminPassword,
			PasswordHash: string(adminHash),
			Role:         roleAdmin,
		}
	}

	// Select rate-limiting backend: Redis (for multi-instance prod) or in-memory (dev).
	var loginLimiter, registerLimiter RateLimiterBackend
	var lockoutBackend LockoutBackend
	redisURL := strings.TrimSpace(os.Getenv("AUTH_REDIS_URL"))
	if redisURL != "" {
		opts, redisErr := redis.ParseURL(redisURL)
		if redisErr != nil {
			log.Fatalf("FATAL: AUTH_REDIS_URL is invalid: %v", redisErr)
		}
		rc := redis.NewClient(opts)
		loginLimiter = newRedisRateLimiter(rc, "rl:login")
		registerLimiter = newRedisRateLimiter(rc, "rl:register")
		lockoutBackend = newRedisLockoutTracker(rc)
		slog.Info("auth: rate limiting backed by Redis", "url", redisURL)
	} else {
		loginLimiter = newRateLimiter()
		registerLimiter = newRateLimiter()
		lockoutBackend = newLockoutTracker()
		slog.Info("auth: rate limiting backed by in-memory (single-instance only)")
	}

	svc := &AuthService{
		usersByUsername: users,
		oauthIdentities: map[string]string{},
		store:           sessionStore,
		audit:           &structuredAuditLogger{logger: log.Default()},
		accessTTL:       durationFromEnvSeconds("AUTH_ACCESS_TTL_SECONDS", defaultAccessTokenTTL),
		refreshTTL:      durationFromEnvSeconds("AUTH_REFRESH_TTL_SECONDS", defaultRefreshTokenTTL),
		loginLimiter:    loginLimiter,
		registerLimiter: registerLimiter,
		lockout:         lockoutBackend,
	}

	// Optionally initialize DB-backed user store
	storeMode := strings.ToLower(strings.TrimSpace(os.Getenv("AUTH_STORE_MODE")))
	if storeMode == "db" || storeMode == "postgres" {
		dsn := strings.TrimSpace(os.Getenv("AUTH_DB_DSN"))
		if dsn != "" {
			db, err := sql.Open("postgres", dsn)
			if err != nil {
				log.Printf("warning: failed to open auth DB: %v; falling back to in-memory", err)
			} else {
				ctx, cancel := context.WithTimeout(context.Background(), userDBTimeout)
				defer cancel()
				if err := db.PingContext(ctx); err != nil {
					log.Printf("warning: auth DB ping failed: %v; falling back to in-memory", err)
					_ = db.Close()
				} else if err := svc.ensureUserSchema(db); err != nil {
					log.Printf("warning: auth DB schema init failed: %v; falling back to in-memory", err)
					_ = db.Close()
				} else {
					svc.db = db
					svc.seedDBUsers(demoUsername, demoPassword, demoUserID, rolePlayer)
					svc.seedDBUsers(adminUsername, adminPassword, adminUserID, roleAdmin)
					// Seed the four Predict punters from seed_prediction.sql into
					// auth_users so they can log in with matching IDs. Skipped in
					// production/staging — those envs should manage users via the
					// normal registration flow or an external identity provider.
					if env != "production" && env != "staging" {
						svc.seedDBUsers("alice@predict.dev", "predict123", "user-001", rolePlayer)
						svc.seedDBUsers("bob@predict.dev", "predict123", "user-002", rolePlayer)
						svc.seedDBUsers("charlie@predict.dev", "predict123", "user-003", rolePlayer)
						svc.seedDBUsers("bot@predict.dev", "predict123", "user-bot", rolePlayer)
					}
					log.Printf("auth service initialized in DB mode")
				}
			}
		} else {
			log.Printf("warning: AUTH_STORE_MODE=%s but AUTH_DB_DSN is empty; using in-memory", storeMode)
		}
	}

	// Two-factor enrollments live next to the users. Without a database,
	// development keeps them in memory; production and staging get no store,
	// so staff sign-in fails closed instead of forgetting enrollments on
	// restart.
	switch {
	case svc.db != nil:
		mfa.store = sqlMFAStore{db: svc.db}
	case env != "production" && env != "staging":
		mfa.store = newMemoryMFAStore()
	}
	svc.mfa = mfa

	return svc
}

func (a *AuthService) ensureUserSchema(db *sql.DB) error {
	ctx, cancel := context.WithTimeout(context.Background(), userDBTimeout)
	defer cancel()
	if _, err := db.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS auth_users (
  id VARCHAR(255) PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'player',
  terms_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  terms_version TEXT NOT NULL DEFAULT '',
  terms_accepted_at TIMESTAMPTZ NULL,
  launch_disclosure_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  launch_disclosure_version TEXT NOT NULL DEFAULT '',
  launch_disclosure_accepted_at TIMESTAMPTZ NULL,
  oauth_provider VARCHAR(50),
  oauth_subject VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`); err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, `
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS terms_accepted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS terms_version TEXT NOT NULL DEFAULT '';
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ NULL;
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS launch_disclosure_accepted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS launch_disclosure_version TEXT NOT NULL DEFAULT '';
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS launch_disclosure_accepted_at TIMESTAMPTZ NULL;
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS email VARCHAR(255);`); err != nil {
		return err
	}
	// ISSUE-023: email login. Unique per address among rows that have one
	// (legacy rows stay NULL/'' and never collide).
	if _, err := db.ExecContext(ctx, `
CREATE UNIQUE INDEX IF NOT EXISTS auth_users_email_lower_idx
ON auth_users (lower(email)) WHERE email IS NOT NULL AND email <> ''`); err != nil {
		return err
	}

	// auth_identities maps a social provider's stable subject (its user id) to
	// a local auth_users row. Identity is keyed by (provider, subject) — NOT by
	// email — so that two providers asserting the same email only merge when the
	// email is provider-verified (see resolveOAuthAccount). email_verified is
	// recorded so the linking decision is auditable after the fact.
	_, err := db.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS auth_identities (
  id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, subject)
)`)
	if err != nil {
		return err
	}
	return ensureMFASchema(ctx, db)
}

func (a *AuthService) seedDBUsers(username, password, id, role string) {
	if a.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), userDBTimeout)
	defer cancel()

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	if err != nil {
		log.Printf("warning: failed to hash seed password for %s: %v", username, err)
		return
	}
	_, _ = a.db.ExecContext(ctx, `
INSERT INTO auth_users (id, username, password_hash, role)
VALUES ($1, $2, $3, $4)
ON CONFLICT (username) DO NOTHING`, id, username, string(hash), role)
}

func RegisterRoutes(mux *stdhttp.ServeMux, service string, auth *AuthService) {
	mux.Handle("/healthz", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		w.WriteHeader(stdhttp.StatusOK)
		_, _ = w.Write([]byte("ok"))
		return nil
	}))

	mux.Handle("/readyz", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]string{
			"service": service,
			"status":  "ready",
		})
	}))

	mux.Handle("/api/v1/status", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]string{
			"service": service,
			"status":  "up",
		})
	}))

	mux.Handle("/api/v1/auth/login", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}
		r.Body = stdhttp.MaxBytesReader(w, r.Body, 64<<10) // 64KB for auth payloads
		auth.PruneExpiredSessions()

		var body loginRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			return httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
		}
		if body.Username == "" || body.Password == "" {
			return httpx.BadRequest("username and password are required", nil)
		}

		// Per-IP limit alongside the per-username one inside Login: a
		// password spray (one password across many usernames) never trips a
		// per-username counter, so it needs its own bucket (audit SEC-05).
		// 30/min = 3x the per-username budget, low enough to blunt sprays.
		if ip := extractIP(r); ip != "" && !auth.loginLimiter.Allow("login-ip:"+ip, 30, time.Minute) {
			auth.audit.Event("auth.login.rate_limited_ip", map[string]any{"ip": ip})
			return httpx.TooManyRequests("too many login attempts, try again later")
		}

		outcome, err := auth.Login(body.Username, body.Password)
		if err != nil {
			return err
		}
		if outcome.Challenge != nil {
			// Password accepted; the session waits for the code (mfa.go).
			setMFAChallengeCookie(w, outcome.Challenge.MFAToken, int(mfaChallengeTTL.Seconds()))
			return httpx.WriteJSON(w, stdhttp.StatusOK, outcome.Challenge)
		}

		// Set HttpOnly cookies for secure token transport
		writeSessionCookies(w, auth, *outcome.Tokens)
		return httpx.WriteJSON(w, stdhttp.StatusOK, outcome.Tokens)
	}))

	mux.Handle("/api/v1/auth/register", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}
		r.Body = stdhttp.MaxBytesReader(w, r.Body, 64<<10) // 64KB for auth payloads

		// Rate limit: 3 registrations per minute per IP
		remoteIP := extractIP(r)
		if !auth.registerLimiter.Allow("register:"+remoteIP, 3, time.Minute) {
			return httpx.TooManyRequests("too many registration attempts, try again later")
		}

		var body registerRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			return httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
		}

		if !acceptedBool(body.TermsAccepted, body.TermsAcceptedCamel) {
			return httpx.BadRequest("terms acceptance is required", map[string]any{"field": "terms_accepted"})
		}
		if !acceptedBool(body.LaunchDisclosureAccepted, body.LaunchDisclosureAcceptedCamel) {
			return httpx.BadRequest("points-only no-cashout disclosure acceptance is required", map[string]any{"field": "launch_disclosure_accepted"})
		}
		termsVersion := firstNonEmpty(body.TermsVersion, body.TermsVersionCamel, taptradeLaunchTermsVersion)
		disclosureVersion := firstNonEmpty(body.LaunchDisclosureVersion, body.LaunchDisclosureVersionCamel, taptradeDisclosureVersion)

		newUser, err := auth.RegisterWithAcceptance(body.Username, body.Password, body.Email, termsVersion, disclosureVersion)
		if err != nil {
			return err
		}

		return httpx.WriteJSON(w, stdhttp.StatusCreated, map[string]any{
			"userId":                     newUser.ID,
			"username":                   newUser.Username,
			"role":                       newUser.Role,
			"termsAccepted":              newUser.TermsAccepted,
			"termsVersion":               newUser.TermsVersion,
			"termsAcceptedAt":            newUser.TermsAcceptedAt,
			"launchDisclosureAccepted":   newUser.LaunchDisclosureAccepted,
			"launchDisclosureVersion":    newUser.LaunchDisclosureVersion,
			"launchDisclosureAcceptedAt": newUser.LaunchDisclosureAcceptedAt,
		})
	}))

	mux.Handle("/api/v1/auth/refresh", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}
		r.Body = stdhttp.MaxBytesReader(w, r.Body, 64<<10) // 64KB for auth payloads
		auth.PruneExpiredSessions()

		// Read refresh token from HttpOnly cookie first, fall back to request body
		var refreshToken string
		if cookie, err := r.Cookie("refresh_token"); err == nil && cookie.Value != "" {
			refreshToken = cookie.Value
		} else {
			var body refreshRequest
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				return httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
			}
			refreshToken = body.RefreshToken
		}
		if refreshToken == "" {
			return httpx.BadRequest("refresh token is required", nil)
		}

		response, err := auth.Refresh(refreshToken)
		if err != nil {
			return err
		}

		// Set new HttpOnly cookies
		secure := os.Getenv("AUTH_COOKIE_SECURE") != "false"
		stdhttp.SetCookie(w, &stdhttp.Cookie{
			Name:     "access_token",
			Value:    response.AccessToken,
			Path:     "/",
			HttpOnly: true,
			Secure:   secure,
			SameSite: stdhttp.SameSiteLaxMode,
			MaxAge:   int(auth.accessTTL.Seconds()),
		})
		stdhttp.SetCookie(w, &stdhttp.Cookie{
			Name:     "refresh_token",
			Value:    response.RefreshToken,
			Path:     "/api/v1/auth/refresh",
			HttpOnly: true,
			Secure:   secure,
			SameSite: stdhttp.SameSiteLaxMode,
			MaxAge:   int(auth.refreshTTL.Seconds()),
		})
		setCSRFCookie(w, secure, int(auth.accessTTL.Seconds()))

		return httpx.WriteJSON(w, stdhttp.StatusOK, response)
	}))

	mux.Handle("/api/v1/auth/session", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		auth.PruneExpiredSessions()

		// Read access token from HttpOnly cookie first, fall back to Authorization header
		var token string
		if cookie, err := r.Cookie("access_token"); err == nil && cookie.Value != "" {
			token = cookie.Value
		} else {
			var parseErr error
			token, parseErr = parseBearerToken(r.Header.Get("Authorization"))
			if parseErr != nil {
				return parseErr
			}
		}

		currentSession, err := auth.ValidateAccessToken(token)
		if err != nil {
			return err
		}

		return httpx.WriteJSON(w, stdhttp.StatusOK, sessionResponse{
			Authenticated:              true,
			UserID:                     currentSession.UserID,
			Username:                   currentSession.Username,
			Role:                       currentSession.Role,
			ExpiresAt:                  currentSession.AccessUntil.UTC().Format(time.RFC3339),
			TermsAccepted:              currentSession.TermsAccepted,
			TermsVersion:               currentSession.TermsVersion,
			TermsAcceptedAt:            currentSession.TermsAcceptedAt,
			LaunchDisclosureAccepted:   currentSession.LaunchDisclosureAccepted,
			LaunchDisclosureVersion:    currentSession.LaunchDisclosureVersion,
			LaunchDisclosureAcceptedAt: currentSession.LaunchDisclosureAcceptedAt,
		})
	}))

	mux.Handle("/api/v1/auth/logout", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}
		r.Body = stdhttp.MaxBytesReader(w, r.Body, 64<<10) // 64KB for auth payloads

		// Verify CSRF token on state-changing request.
		// Skip CSRF check if no CSRF cookie exists (e.g., client clearing
		// cookies during a failed login before a CSRF token was ever issued).
		if _, cookieErr := r.Cookie(csrfCookieName); cookieErr == nil {
			if err := verifyCSRF(r); err != nil {
				return err
			}
		}

		// Clear auth cookies
		stdhttp.SetCookie(w, &stdhttp.Cookie{
			Name:     "access_token",
			Value:    "",
			Path:     "/",
			HttpOnly: true,
			MaxAge:   -1,
		})
		stdhttp.SetCookie(w, &stdhttp.Cookie{
			Name:     "refresh_token",
			Value:    "",
			Path:     "/api/v1/auth/refresh",
			HttpOnly: true,
			MaxAge:   -1,
		})
		stdhttp.SetCookie(w, &stdhttp.Cookie{
			Name:   csrfCookieName,
			Value:  "",
			Path:   "/",
			MaxAge: -1,
		})

		// Invalidate session: try cookie first, then Authorization header
		var tokenToInvalidate string
		if cookie, err := r.Cookie("access_token"); err == nil && cookie.Value != "" {
			tokenToInvalidate = cookie.Value
		}
		if tokenToInvalidate == "" {
			if authHeader := r.Header.Get("Authorization"); strings.HasPrefix(authHeader, "Bearer ") {
				tokenToInvalidate = strings.TrimPrefix(authHeader, "Bearer ")
			}
		}
		if tokenToInvalidate != "" {
			// Pass the RAW token: the store digests internally. Digesting here
			// double-hashed the key, so logout never actually revoked the
			// session server-side (audit SEC-01).
			if err := auth.store.DeleteByAccessToken(tokenToInvalidate); err != nil {
				slog.Warn("auth: logout session revocation failed", "error", err)
			}
		}

		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]string{"status": "logged_out"})
	}))

	// ─── Sessions Management ────────────────────────────────────
	mux.Handle("/api/v1/auth/sessions/", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		// DELETE /api/v1/auth/sessions/{sessionId} — revoke a specific session
		if r.Method != stdhttp.MethodDelete {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodDelete)
		}

		sessionID := strings.TrimPrefix(r.URL.Path, "/api/v1/auth/sessions/")
		sessionID = strings.TrimSuffix(sessionID, "/")
		if sessionID == "" {
			return httpx.BadRequest("session ID required", nil)
		}

		// Authenticate the caller and scope revocation to their own sessions
		// (this endpoint previously required no auth at all — audit SEC-05).
		var token string
		if cookie, err := r.Cookie("access_token"); err == nil && cookie.Value != "" {
			token = cookie.Value
		} else {
			var parseErr error
			token, parseErr = parseBearerToken(r.Header.Get("Authorization"))
			if parseErr != nil {
				return parseErr
			}
		}
		currentSession, err := auth.ValidateAccessToken(token)
		if err != nil {
			return err
		}
		owned, err := auth.store.ListByUserID(currentSession.UserID)
		if err != nil {
			return httpx.Internal("failed to list sessions", err)
		}
		owns := false
		for _, s := range owned {
			if s.AccessTokenDigest == sessionID || s.RefreshTokenDigest == sessionID {
				owns = true
				break
			}
		}
		if !owns {
			// Same response for "someone else's session" and "no such
			// session" — don't leak which digests exist.
			return httpx.NotFound("session not found")
		}

		if err := auth.store.DeleteBySessionID(sessionID); err != nil {
			return httpx.Internal("failed to revoke session", err)
		}

		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]string{"message": "session revoked"})
	}))

	mux.Handle("/api/v1/auth/sessions", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		// GET /api/v1/auth/sessions — list active sessions for the authenticated user
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}

		auth.PruneExpiredSessions()

		// Authenticate: read access token from cookie or header
		var token string
		if cookie, err := r.Cookie("access_token"); err == nil && cookie.Value != "" {
			token = cookie.Value
		} else {
			var parseErr error
			token, parseErr = parseBearerToken(r.Header.Get("Authorization"))
			if parseErr != nil {
				return parseErr
			}
		}

		currentSession, err := auth.ValidateAccessToken(token)
		if err != nil {
			return err
		}

		sessions, err := auth.store.ListByUserID(currentSession.UserID)
		if err != nil {
			return httpx.Internal("failed to list sessions", err)
		}

		type sessionEntry struct {
			ID         string `json:"id"`
			Device     string `json:"device"`
			Location   string `json:"location"`
			LastActive string `json:"last_active"`
			Current    bool   `json:"current"`
		}

		result := make([]sessionEntry, 0, len(sessions))
		for _, s := range sessions {
			isCurrent := s.AccessTokenDigest == currentSession.AccessTokenDigest
			result = append(result, sessionEntry{
				ID:         s.AccessTokenDigest,
				Device:     r.Header.Get("User-Agent"),
				Location:   r.RemoteAddr,
				LastActive: s.IssuedAt.UTC().Format(time.RFC3339),
				Current:    isCurrent,
			})
		}

		return httpx.WriteJSON(w, stdhttp.StatusOK, result)
	}))

	mux.Handle("/api/v1/auth/change-password", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}

		currentSession, err := auth.currentSessionFromRequest(r)
		if err != nil {
			return err
		}

		var body changePasswordRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			return httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
		}

		requestedUserID := firstNonEmpty(body.UserID, body.UserIDCamel)
		if requestedUserID != "" && requestedUserID != currentSession.UserID {
			return httpx.Forbidden("not authorized to change this password")
		}

		currentPassword := firstNonEmpty(body.CurrentPassword, body.CurrentCamel)
		newPassword := firstNonEmpty(body.NewPassword, body.NewCamel)
		if currentPassword == "" || newPassword == "" {
			return httpx.BadRequest("current and new password are required", nil)
		}

		if err := auth.ChangePassword(currentSession.Username, currentPassword, newPassword); err != nil {
			return err
		}

		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]string{"message": "password updated"})
	}))

	registerMFARoutes(mux, auth)

	mux.Handle("/api/v1/auth/metrics", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, auth.MetricsSnapshot())
	}))

	// ─── OAuth Routes ────────────────────────────────────────────
	frontendURL := getEnvOrDefault("AUTH_FRONTEND_URL", "http://localhost:3000")

	// Social OAuth: Google, Facebook, Discord, X (Twitter), TikTok, Reddit.
	// Generic /start + /callback per provider (see oauth.go). Identity is keyed
	// by (provider, subject); auto account-linking happens only on a
	// provider-VERIFIED matching email. This service never provisions wallets or
	// crypto addresses — those are gateway-owned (lazy + fail-closed).
	registerSocialOAuthRoutes(mux, auth, frontendURL)
}

func acceptedBool(values ...*bool) bool {
	for _, value := range values {
		if value != nil {
			return *value
		}
	}
	return false
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

// Login checks the password. Accounts without a second factor get a session;
// the rest get a challenge for POST /api/v1/auth/login/mfa (mfa.go).
func (a *AuthService) Login(username string, password string) (loginOutcome, error) {
	a.PruneExpiredSessions()

	// Rate limit: 10 login attempts per minute per username
	if !a.loginLimiter.Allow("login:"+username, 10, time.Minute) {
		a.audit.Event("auth.login.rate_limited", map[string]any{"username": username})
		return loginOutcome{}, httpx.TooManyRequests("too many login attempts, try again later")
	}

	// Account lockout check
	if a.lockout.IsLocked(username) {
		a.audit.Event("auth.login.locked_out", map[string]any{"username": username})
		return loginOutcome{}, httpx.TooManyRequests("account temporarily locked due to repeated failures")
	}

	account, exists := a.lookupUser(username)
	authenticated := exists && a.verifyPassword(account, password)
	if !authenticated && strings.Contains(username, "@") {
		// ISSUE-023: the login field promises "USERNAME OR EMAIL", and
		// registration stores the address — match it. Only reached when no
		// username literally equals the input, so existing logins (including
		// seeds whose username IS an email) are unaffected.
		if byEmail, ok := a.lookupUserByEmail(username); ok && a.verifyPassword(byEmail, password) {
			account, authenticated = byEmail, true
		}
	}
	if !authenticated {
		// Back-office staff fallback: authenticate against the gateway-owned
		// admin_users directory (the self-contained RBAC staff table). Only
		// reached when the player/auth_users path did not match, so existing
		// logins are unaffected.
		if staff, ok := a.lookupAdminUser(username); ok && a.verifyPassword(staff, password) {
			account, authenticated = staff, true
		}
	}
	if !authenticated {
		a.lockout.RecordFailure(username)
		a.recordAuthMetric("login_failure")
		a.audit.Event("auth.login.failed", map[string]any{"username": username, "reason": "invalid_credentials"})
		return loginOutcome{}, httpx.Unauthorized("invalid username or password")
	}

	challenge, err := a.challengeFor(account, username, true)
	if err != nil {
		a.recordAuthMetric("login_failure")
		a.audit.Event("auth.login.failed", map[string]any{"username": username, "reason": "mfa_unavailable"})
		return loginOutcome{}, err
	}
	if challenge != nil {
		// The failure count is cleared only once the code is accepted, so
		// asking for fresh challenges can't reset it between wrong codes.
		return loginOutcome{Challenge: challenge}, nil
	}

	// Successful login clears lockout state
	a.lockout.ClearFailures(username)

	tokens, err := a.openSession(account, username)
	if err != nil {
		return loginOutcome{}, err
	}
	return loginOutcome{Tokens: &tokens}, nil
}

// openSession issues and stores a session for an authenticated account.
func (a *AuthService) openSession(account user, loginName string) (tokenResponse, error) {
	s, response, err := newSession(account, a.accessTTL, a.refreshTTL)
	if err != nil {
		a.recordAuthMetric("login_failure")
		a.audit.Event("auth.login.failed", map[string]any{"username": loginName, "reason": "token_generation_failed"})
		return tokenResponse{}, httpx.Internal("failed to initialize session", err)
	}
	if err := a.store.Put(s); err != nil {
		a.recordAuthMetric("login_failure")
		a.audit.Event("auth.login.failed", map[string]any{"username": loginName, "reason": "session_store_failed"})
		return tokenResponse{}, httpx.Internal("failed to persist session", err)
	}

	a.recordAuthMetric("login_success")
	a.audit.Event("auth.login.success", map[string]any{"username": loginName, "userId": account.ID})

	return response, nil
}

func (a *AuthService) ChangePassword(username string, currentPassword string, newPassword string) error {
	account, exists := a.lookupUser(username)
	authenticated := exists && a.verifyPassword(account, currentPassword)
	isStaff := false
	if !authenticated {
		// Back-office staff (admin_users) self-service, mirroring the Login fallback.
		if staff, ok := a.lookupAdminUser(username); ok && a.verifyPassword(staff, currentPassword) {
			account, authenticated, isStaff = staff, true, true
		}
	}
	if !authenticated {
		a.audit.Event("auth.password_change.failed", map[string]any{"username": username, "reason": "invalid_credentials"})
		return httpx.Unauthorized("current password is incorrect")
	}
	if currentPassword == newPassword {
		return httpx.BadRequest("new password must be different from current password", nil)
	}
	if err := validatePasswordStrength(newPassword); err != nil {
		return err
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcryptCost)
	if err != nil {
		return httpx.Internal("failed to hash password", err)
	}

	if a.db != nil {
		ctx, cancel := context.WithTimeout(context.Background(), userDBTimeout)
		defer cancel()
		// Staff credentials live in admin_users; regular accounts in auth_users.
		query := `UPDATE auth_users SET password_hash = $1, updated_at = NOW() WHERE username = $2`
		if isStaff {
			query = `UPDATE admin_users SET password_hash = $1, updated_at = now() WHERE lower(email) = lower($2)`
		}
		if _, err := a.db.ExecContext(ctx, query, string(hash), username); err != nil {
			return httpx.Internal("failed to update password", err)
		}
	}

	// Staff accounts aren't in the in-memory auth_users map; only refresh it for
	// regular accounts.
	if !isStaff {
		a.mu.Lock()
		updated := account
		updated.Password = ""
		updated.PasswordHash = string(hash)
		a.usersByUsername[username] = updated
		a.mu.Unlock()
	}

	// Revoke every live session for this user: a hijacked session must not
	// outlive the password rotation that was meant to evict it (SEC-01
	// sibling, audit P1-05). The user re-authenticates with the new password.
	if err := a.store.DeleteByUserID(account.ID); err != nil {
		slog.Warn("auth: failed to revoke sessions after password change",
			"userId", account.ID, "error", err)
	}

	a.audit.Event("auth.password_change.success", map[string]any{"username": username, "userId": account.ID})
	return nil
}

func (a *AuthService) verifyPassword(account user, password string) bool {
	// Prefer bcrypt hash if available
	if account.PasswordHash != "" {
		return bcrypt.CompareHashAndPassword([]byte(account.PasswordHash), []byte(password)) == nil
	}
	// Fallback to plaintext for legacy dev-mode accounts (deprecated)
	return account.Password != "" && account.Password == password
}

func (a *AuthService) Register(username, password, _ string) (user, error) {
	return a.registerUser(username, password, "", "", "")
}

func (a *AuthService) RegisterWithAcceptance(username, password, email string, termsVersion, disclosureVersion string) (user, error) {
	return a.registerUser(username, password, email, termsVersion, disclosureVersion)
}

func (a *AuthService) registerUser(username, password, email string, termsVersion, disclosureVersion string) (user, error) {
	username = strings.TrimSpace(username)
	password = strings.TrimSpace(password)
	// ISSUE-023: the address is stored (lowercased) so Login can match it.
	// Optional at this layer — legacy callers and seeds pass "" — but when
	// present it must look like an address and be unique.
	email = strings.ToLower(strings.TrimSpace(email))
	if username == "" {
		return user{}, httpx.BadRequest("username is required", nil)
	}
	if email != "" {
		if !strings.Contains(email, "@") || strings.ContainsAny(email, " \t") {
			return user{}, httpx.BadRequest("email is invalid", map[string]any{"field": "email"})
		}
		if _, exists := a.lookupUserByEmail(email); exists {
			return user{}, httpx.Conflict("email already registered", nil)
		}
	}
	// Reserve the ':' namespace used by isolated social accounts
	// (oauthSyntheticUsername = "<provider>:<subject>"). Without this, a user
	// could pre-register "twitter:<victimId>" and a later social login for that
	// subject would adopt the attacker's account.
	if strings.Contains(username, ":") {
		return user{}, httpx.BadRequest("username may not contain ':'", nil)
	}
	if err := validatePasswordStrength(password); err != nil {
		return user{}, err
	}
	// Registration always creates player accounts. Admin accounts must be
	// created through a separate protected admin endpoint or seeded via env.
	role := rolePlayer
	termsVersion = strings.TrimSpace(termsVersion)
	disclosureVersion = strings.TrimSpace(disclosureVersion)
	acceptedAt := ""
	if termsVersion != "" || disclosureVersion != "" {
		acceptedAt = time.Now().UTC().Format(time.RFC3339)
		if termsVersion == "" {
			termsVersion = taptradeLaunchTermsVersion
		}
		if disclosureVersion == "" {
			disclosureVersion = taptradeDisclosureVersion
		}
	}

	// Check if user already exists
	if _, exists := a.lookupUser(username); exists {
		return user{}, httpx.Conflict("username already registered", nil)
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	if err != nil {
		return user{}, httpx.Internal("failed to hash password", err)
	}

	userIDSuffix := sha256.Sum256([]byte(strings.ToLower(username)))
	newID := fmt.Sprintf("u-%s", hex.EncodeToString(userIDSuffix[:])[:12])
	newUser := user{
		ID:                         newID,
		Username:                   username,
		Email:                      email,
		PasswordHash:               string(hash),
		Role:                       role,
		TermsAccepted:              termsVersion != "",
		TermsVersion:               termsVersion,
		TermsAcceptedAt:            acceptedAt,
		LaunchDisclosureAccepted:   disclosureVersion != "",
		LaunchDisclosureVersion:    disclosureVersion,
		LaunchDisclosureAcceptedAt: acceptedAt,
	}

	if a.db != nil {
		ctx, cancel := context.WithTimeout(context.Background(), userDBTimeout)
		defer cancel()
		_, err := a.db.ExecContext(ctx, `
INSERT INTO auth_users (
  id, username, email, password_hash, role,
  terms_accepted, terms_version, terms_accepted_at,
  launch_disclosure_accepted, launch_disclosure_version, launch_disclosure_accepted_at
)
VALUES ($1, $2, NULLIF($3, ''), $4, $5, $6, $7, NULLIF($8, '')::timestamptz, $9, $10, NULLIF($11, '')::timestamptz)`,
			newUser.ID, newUser.Username, newUser.Email, newUser.PasswordHash, newUser.Role,
			newUser.TermsAccepted, newUser.TermsVersion, newUser.TermsAcceptedAt,
			newUser.LaunchDisclosureAccepted, newUser.LaunchDisclosureVersion, newUser.LaunchDisclosureAcceptedAt,
		)
		if err != nil {
			if strings.Contains(err.Error(), "auth_users_email_lower_idx") {
				return user{}, httpx.Conflict("email already registered", nil)
			}
			if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique constraint") {
				return user{}, httpx.Conflict("username already registered", nil)
			}
			return user{}, httpx.Internal("failed to create user", err)
		}
	}

	// Also store in memory map for session lookups
	a.mu.Lock()
	a.usersByUsername[username] = newUser
	a.mu.Unlock()

	a.audit.Event("auth.register.success", map[string]any{"username": username, "userId": newID, "role": role})
	return newUser, nil
}

func (a *AuthService) Refresh(refreshToken string) (tokenResponse, error) {
	a.PruneExpiredSessions()

	existing, found, err := a.store.GetByRefreshToken(refreshToken)
	if err != nil {
		a.recordAuthMetric("refresh_failure")
		a.audit.Event("auth.refresh.failed", map[string]any{"reason": "session_store_read_failed"})
		return tokenResponse{}, httpx.Internal("failed to read refresh token", err)
	}
	if !found || existing.RefreshUntil.Before(time.Now().UTC()) {
		_ = a.store.DeleteByRefreshToken(refreshToken)
		a.recordAuthMetric("refresh_failure")
		a.audit.Event("auth.refresh.failed", map[string]any{"reason": "invalid_or_expired_refresh"})
		return tokenResponse{}, httpx.Unauthorized("refresh token is invalid or expired")
	}

	account, exists := a.lookupUser(existing.Username)
	if !exists {
		a.recordAuthMetric("refresh_failure")
		a.audit.Event("auth.refresh.failed", map[string]any{"username": existing.Username, "reason": "user_not_found"})
		return tokenResponse{}, httpx.Internal("session user not found", nil)
	}

	if err := a.store.DeleteByRefreshToken(refreshToken); err != nil {
		a.recordAuthMetric("refresh_failure")
		a.audit.Event("auth.refresh.failed", map[string]any{"username": existing.Username, "reason": "session_store_delete_failed"})
		return tokenResponse{}, httpx.Internal("failed to rotate session", err)
	}

	s, response, err := newSession(account, a.accessTTL, a.refreshTTL)
	if err != nil {
		a.recordAuthMetric("refresh_failure")
		a.audit.Event("auth.refresh.failed", map[string]any{"username": existing.Username, "reason": "token_generation_failed"})
		return tokenResponse{}, httpx.Internal("failed to refresh session", err)
	}
	if err := a.store.Put(s); err != nil {
		a.recordAuthMetric("refresh_failure")
		a.audit.Event("auth.refresh.failed", map[string]any{"username": existing.Username, "reason": "session_store_failed"})
		return tokenResponse{}, httpx.Internal("failed to persist refreshed session", err)
	}

	a.recordAuthMetric("refresh_success")
	a.audit.Event("auth.refresh.success", map[string]any{"username": existing.Username, "userId": existing.UserID})

	return response, nil
}

func (a *AuthService) ValidateAccessToken(accessToken string) (session, error) {
	a.PruneExpiredSessions()

	s, found, err := a.store.GetByAccessToken(accessToken)
	if err != nil {
		a.recordAuthMetric("session_failure")
		a.audit.Event("auth.session.failed", map[string]any{"reason": "session_store_read_failed"})
		return session{}, httpx.Internal("failed to read access token", err)
	}
	if !found || s.AccessUntil.Before(time.Now().UTC()) {
		_ = a.store.DeleteByAccessToken(accessToken)
		a.recordAuthMetric("session_failure")
		a.audit.Event("auth.session.failed", map[string]any{"reason": "invalid_or_expired_access"})
		return session{}, httpx.Unauthorized("access token is invalid or expired")
	}

	a.recordAuthMetric("session_success")
	a.audit.Event("auth.session.success", map[string]any{"username": s.Username, "userId": s.UserID})
	return s, nil
}

func (a *AuthService) PruneExpiredSessions() {
	now := time.Now().UTC()
	if err := a.store.DeleteExpired(now); err != nil {
		a.audit.Event("auth.session.prune_failed", map[string]any{"reason": err.Error()})
	}
}

func (a *AuthService) currentSessionFromRequest(r *stdhttp.Request) (session, error) {
	a.PruneExpiredSessions()

	if cookie, err := r.Cookie("access_token"); err == nil && cookie.Value != "" {
		return a.ValidateAccessToken(cookie.Value)
	}

	token, err := parseBearerToken(r.Header.Get("Authorization"))
	if err != nil {
		return session{}, err
	}
	return a.ValidateAccessToken(token)
}

func (a *AuthService) MetricsSnapshot() metricsResponse {
	a.mu.RLock()
	defer a.mu.RUnlock()

	return metricsResponse{
		LoginSuccess:   a.metrics.loginSuccess,
		LoginFailure:   a.metrics.loginFailure,
		RefreshSuccess: a.metrics.refreshSuccess,
		RefreshFailure: a.metrics.refreshFailure,
		SessionSuccess: a.metrics.sessionSuccess,
		SessionFailure: a.metrics.sessionFailure,
	}
}

func (a *AuthService) recordAuthMetric(name string) {
	a.mu.Lock()
	defer a.mu.Unlock()

	switch name {
	case "login_success":
		a.metrics.loginSuccess++
	case "login_failure":
		a.metrics.loginFailure++
	case "refresh_success":
		a.metrics.refreshSuccess++
	case "refresh_failure":
		a.metrics.refreshFailure++
	case "session_success":
		a.metrics.sessionSuccess++
	case "session_failure":
		a.metrics.sessionFailure++
	}
}

func (a *AuthService) lookupUser(username string) (user, bool) {
	// Check DB first if available
	if a.db != nil {
		ctx, cancel := context.WithTimeout(context.Background(), userDBTimeout)
		defer cancel()
		var u user
		var termsAcceptedAt sql.NullTime
		var disclosureAcceptedAt sql.NullTime
		err := a.db.QueryRowContext(ctx, `
SELECT id, username, COALESCE(email, ''), password_hash, COALESCE(role, 'player'),
       COALESCE(terms_accepted, false), COALESCE(terms_version, ''), terms_accepted_at,
       COALESCE(launch_disclosure_accepted, false), COALESCE(launch_disclosure_version, ''), launch_disclosure_accepted_at
FROM auth_users
WHERE username = $1`, username).Scan(
			&u.ID, &u.Username, &u.Email, &u.PasswordHash, &u.Role,
			&u.TermsAccepted, &u.TermsVersion, &termsAcceptedAt,
			&u.LaunchDisclosureAccepted, &u.LaunchDisclosureVersion, &disclosureAcceptedAt,
		)
		if err == nil {
			if termsAcceptedAt.Valid {
				u.TermsAcceptedAt = termsAcceptedAt.Time.UTC().Format(time.RFC3339)
			}
			if disclosureAcceptedAt.Valid {
				u.LaunchDisclosureAcceptedAt = disclosureAcceptedAt.Time.UTC().Format(time.RFC3339)
			}
			return u, true
		}
		if err != sql.ErrNoRows {
			log.Printf("warning: auth DB lookup failed for %s: %v; falling back to memory", username, err)
		}
	}

	// Fallback to in-memory map
	a.mu.RLock()
	defer a.mu.RUnlock()
	account, exists := a.usersByUsername[username]
	return account, exists
}

// lookupUserByEmail resolves a player account by its registered address
// (ISSUE-023). Registration lowercases addresses on write, so the lookup
// lowercases on read; legacy rows without an email simply never match.
func (a *AuthService) lookupUserByEmail(email string) (user, bool) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return user{}, false
	}
	if a.db != nil {
		ctx, cancel := context.WithTimeout(context.Background(), userDBTimeout)
		defer cancel()
		var username string
		err := a.db.QueryRowContext(ctx, `
SELECT username FROM auth_users WHERE lower(email) = $1`, email).Scan(&username)
		if err == nil {
			return a.lookupUser(username)
		}
		if err != sql.ErrNoRows {
			log.Printf("warning: auth DB email lookup failed: %v; falling back to memory", err)
		}
	}
	a.mu.RLock()
	defer a.mu.RUnlock()
	for _, account := range a.usersByUsername {
		if account.Email == email {
			return account, true
		}
	}
	return user{}, false
}

// lookupAdminUser authenticates back-office staff against the gateway-owned
// admin_users directory (the self-contained RBAC staff table, migration 027).
// Only active accounts are returned, with role "admin" so they pass the
// gateway's coarse admin gate; RBAC then narrows by their assigned permissions.
// Returns false when no DB is wired or the table/row is absent — back-office
// login is simply unavailable, with no effect on player/auth_users login.
func (a *AuthService) lookupAdminUser(username string) (user, bool) {
	if a.db == nil {
		return user{}, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), userDBTimeout)
	defer cancel()
	var u user
	err := a.db.QueryRowContext(ctx, `
SELECT id::text, email, password_hash
FROM admin_users
WHERE lower(email) = lower($1) AND status = 'active'`, username).
		Scan(&u.ID, &u.Username, &u.PasswordHash)
	if err != nil {
		if err != sql.ErrNoRows {
			log.Printf("warning: admin_users lookup failed for %s: %v", username, err)
		}
		return user{}, false
	}
	u.Role = "admin"
	u.Directory = mfaDirectoryStaff
	return u, true
}

func newSession(account user, accessTTL, refreshTTL time.Duration) (session, tokenResponse, error) {
	accessToken, err := makeToken("atk")
	if err != nil {
		return session{}, tokenResponse{}, err
	}
	refreshToken, err := makeToken("rtk")
	if err != nil {
		return session{}, tokenResponse{}, err
	}

	role := account.Role
	if role == "" {
		role = rolePlayer
	}

	now := time.Now().UTC()
	return session{
			UserID:                     account.ID,
			Username:                   account.Username,
			Role:                       role,
			Directory:                  account.Directory,
			AccessTokenDigest:          digestToken(accessToken),
			RefreshTokenDigest:         digestToken(refreshToken),
			AccessUntil:                now.Add(accessTTL),
			RefreshUntil:               now.Add(refreshTTL),
			IssuedAt:                   now,
			TermsAccepted:              account.TermsAccepted,
			TermsVersion:               account.TermsVersion,
			TermsAcceptedAt:            account.TermsAcceptedAt,
			LaunchDisclosureAccepted:   account.LaunchDisclosureAccepted,
			LaunchDisclosureVersion:    account.LaunchDisclosureVersion,
			LaunchDisclosureAcceptedAt: account.LaunchDisclosureAcceptedAt,
		}, tokenResponse{
			TokenType:       "Bearer",
			AccessToken:     accessToken,
			RefreshToken:    refreshToken,
			ExpiresInSecond: int64(accessTTL.Seconds()),
		}, nil
}

func makeToken(prefix string) (string, error) {
	raw := make([]byte, tokenSize)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s_%s", prefix, hex.EncodeToString(raw)), nil
}

func parseBearerToken(header string) (string, error) {
	parts := strings.SplitN(header, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
		return "", httpx.Unauthorized("missing or invalid Authorization bearer token")
	}
	return parts[1], nil
}

func digestToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func makeCSRFToken() (string, error) {
	raw := make([]byte, csrfTokenSize)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}

func setCSRFCookie(w stdhttp.ResponseWriter, secure bool, maxAge int) {
	token, err := makeCSRFToken()
	if err != nil {
		return
	}
	stdhttp.SetCookie(w, &stdhttp.Cookie{
		Name:     csrfCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: false, // JS must read this
		Secure:   secure,
		SameSite: stdhttp.SameSiteLaxMode,
		MaxAge:   maxAge,
	})
}

func verifyCSRF(r *stdhttp.Request) error {
	cookie, err := r.Cookie(csrfCookieName)
	if err != nil || cookie.Value == "" {
		return httpx.Forbidden("missing CSRF token cookie")
	}
	header := r.Header.Get(csrfHeaderName)
	if header == "" {
		return httpx.Forbidden("missing CSRF token header")
	}
	if !hmacEqual(cookie.Value, header) {
		return httpx.Forbidden("CSRF token mismatch")
	}
	return nil
}

func hmacEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	result := byte(0)
	for i := 0; i < len(a); i++ {
		result |= a[i] ^ b[i]
	}
	return result == 0
}

func durationFromEnvSeconds(name string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	seconds, err := strconv.Atoi(raw)
	if err != nil || seconds <= 0 {
		return fallback
	}
	return time.Duration(seconds) * time.Second
}

func (l *structuredAuditLogger) Event(name string, fields map[string]any) {
	if l == nil || l.logger == nil {
		return
	}
	payload, err := json.Marshal(fields)
	if err != nil {
		l.logger.Printf("event=%s fields=\"{}\"", name)
		return
	}
	l.logger.Printf("event=%s fields=%s", name, string(payload))
}

// extractIP returns the client IP for rate-limiting. Forwarding headers are
// client-controlled, so they are honored ONLY when the direct peer is inside
// TRUSTED_PROXY_CIDRS (comma-separated; e.g. the Caddy/edge subnet) — and then
// the RIGHTMOST X-Forwarded-For entry is used, the one appended by our proxy.
// Previously the leftmost (attacker-chosen) entry was trusted unconditionally,
// which let registration/login limits be bypassed by varying XFF (audit
// SEC-05). With no trusted proxies configured the peer address is the answer.
func extractIP(r *stdhttp.Request) string {
	host := r.RemoteAddr
	if h, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		host = h
	}
	peer := net.ParseIP(host)
	if peer == nil || !ipInTrustedProxies(peer) {
		return host
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		if ip := strings.TrimSpace(parts[len(parts)-1]); ip != "" {
			return ip
		}
	}
	if xri := strings.TrimSpace(r.Header.Get("X-Real-Ip")); xri != "" {
		return xri
	}
	return host
}

// ipInTrustedProxies parses TRUSTED_PROXY_CIDRS on each call — auth endpoints
// are low-rate, and re-parsing keeps the function trivially testable with
// t.Setenv. Bare IPs are accepted as /32 (/128 for IPv6).
func ipInTrustedProxies(ip net.IP) bool {
	raw := strings.TrimSpace(os.Getenv("TRUSTED_PROXY_CIDRS"))
	if raw == "" {
		return false
	}
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if !strings.Contains(part, "/") {
			if single := net.ParseIP(part); single != nil && single.Equal(ip) {
				return true
			}
			continue
		}
		if _, network, err := net.ParseCIDR(part); err == nil && network.Contains(ip) {
			return true
		}
	}
	return false
}

func getEnvOrDefault(name string, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

// ─── Password Strength ──────────────────────────────────────────

const minPasswordLength = 7

func validatePasswordStrength(password string) error {
	if len(password) < minPasswordLength {
		return httpx.BadRequest(fmt.Sprintf("password must be at least %d characters", minPasswordLength), nil)
	}
	var hasUpper, hasLower, hasDigit bool
	for _, ch := range password {
		switch {
		case ch >= 'A' && ch <= 'Z':
			hasUpper = true
		case ch >= 'a' && ch <= 'z':
			hasLower = true
		case ch >= '0' && ch <= '9':
			hasDigit = true
		}
	}
	classes := 0
	if hasUpper {
		classes++
	}
	if hasLower {
		classes++
	}
	if hasDigit {
		classes++
	}
	if classes < 2 {
		return httpx.BadRequest("password must contain at least two of: uppercase, lowercase, digits", nil)
	}
	return nil
}

// ─── Rate Limiting ──────────────────────────────────────────────

type rateLimiter struct {
	mu      sync.Mutex
	windows map[string][]time.Time
}

func newRateLimiter() *rateLimiter {
	rl := &rateLimiter{windows: make(map[string][]time.Time)}
	// Sweep old entries every 60s
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			rl.sweep()
		}
	}()
	return rl
}

// Allow satisfies the RateLimiterBackend interface.
func (rl *rateLimiter) Allow(key string, limit int, window time.Duration) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-window)
	// Filter to recent entries
	recent := make([]time.Time, 0, len(rl.windows[key]))
	for _, t := range rl.windows[key] {
		if t.After(cutoff) {
			recent = append(recent, t)
		}
	}
	if len(recent) >= limit {
		rl.windows[key] = recent
		return false
	}
	rl.windows[key] = append(recent, now)
	return true
}

func (rl *rateLimiter) sweep() {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	cutoff := time.Now().Add(-5 * time.Minute)
	for key, times := range rl.windows {
		recent := make([]time.Time, 0, len(times))
		for _, t := range times {
			if t.After(cutoff) {
				recent = append(recent, t)
			}
		}
		if len(recent) == 0 {
			delete(rl.windows, key)
		} else {
			rl.windows[key] = recent
		}
	}
}

// ─── Account Lockout ────────────────────────────────────────────

const (
	maxFailedAttempts   = 5
	lockoutDuration     = 15 * time.Minute
	failedAttemptWindow = time.Minute
)

type lockoutTracker struct {
	mu       sync.Mutex
	failures map[string][]time.Time // username -> timestamps of failures
	lockouts map[string]time.Time   // username -> locked until
}

func newLockoutTracker() *lockoutTracker {
	lt := &lockoutTracker{
		failures: make(map[string][]time.Time),
		lockouts: make(map[string]time.Time),
	}
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			lt.sweep()
		}
	}()
	return lt
}

// IsLocked satisfies the LockoutBackend interface.
func (lt *lockoutTracker) IsLocked(username string) bool {
	lt.mu.Lock()
	defer lt.mu.Unlock()
	until, ok := lt.lockouts[username]
	if !ok {
		return false
	}
	if time.Now().After(until) {
		delete(lt.lockouts, username)
		delete(lt.failures, username)
		return false
	}
	return true
}

// RecordFailure satisfies the LockoutBackend interface.
func (lt *lockoutTracker) RecordFailure(username string) {
	lt.mu.Lock()
	defer lt.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-failedAttemptWindow)
	recent := make([]time.Time, 0, len(lt.failures[username]))
	for _, t := range lt.failures[username] {
		if t.After(cutoff) {
			recent = append(recent, t)
		}
	}
	recent = append(recent, now)
	lt.failures[username] = recent
	if len(recent) >= maxFailedAttempts {
		lt.lockouts[username] = now.Add(lockoutDuration)
	}
}

// ClearFailures satisfies the LockoutBackend interface.
func (lt *lockoutTracker) ClearFailures(username string) {
	lt.mu.Lock()
	defer lt.mu.Unlock()
	delete(lt.failures, username)
	delete(lt.lockouts, username)
}

func (lt *lockoutTracker) sweep() {
	lt.mu.Lock()
	defer lt.mu.Unlock()
	now := time.Now()
	for u, until := range lt.lockouts {
		if now.After(until) {
			delete(lt.lockouts, u)
			delete(lt.failures, u)
		}
	}
}
