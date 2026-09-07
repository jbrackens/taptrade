package main

import (
	"context"
	"fmt"
	"log"
	"log/slog"
	stdhttp "net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"taptrade/gateway/internal/alphacashier"
	gatewayhttp "taptrade/gateway/internal/http"
	"taptrade/gateway/internal/store"
	"taptrade/gateway/internal/tenant"
	"taptrade/gateway/internal/tracing"
	"taptrade/platform/logging"
	"taptrade/platform/runtime"
	"taptrade/platform/transport/httpx"

	_ "github.com/lib/pq" // Register PostgreSQL driver for database/sql
	"github.com/redis/go-redis/v9"
)

const legacyMoneyRoutesEnv = "TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED"

func main() {
	// Subcommand dispatch runs before any server bootstrap. Keep this list
	// small — the gateway is primarily a server; subcommands are narrow
	// admin tools that happen to ship in the same binary so they inherit
	// the same build + deps. See PLAN-loyalty-leaderboards.md §8.
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "migrate-legacy-loyalty":
			os.Exit(runMigrateLegacyLoyalty(os.Args[2:]))
		case "rbac-bootstrap":
			os.Exit(runRBACBootstrap(os.Args[2:]))
		}
	}

	cfg := runtime.LoadServiceConfig("gateway", "18080")

	// Initialize structured logging (JSON in production, text in dev)
	env := strings.ToLower(strings.TrimSpace(os.Getenv("ENVIRONMENT")))
	if err := validateGatewayRuntimeConfig(os.Getenv); err != nil {
		log.Fatalf("gateway configuration error: %v", err)
	}
	logging.Init(cfg.Name, env)

	// Initialize OpenTelemetry tracing (configured via OTEL_* env vars)
	tracingCtx := context.Background()
	shutdownTracing, err := tracing.Init(tracingCtx, cfg.Name, "1.0.0")
	if err != nil {
		slog.Warn("tracing initialization failed", "error", err)
	}
	defer func() {
		if err := shutdownTracing(tracingCtx); err != nil {
			slog.Warn("tracing shutdown error", "error", err)
		}
	}()

	mux := stdhttp.NewServeMux()
	metricsRegistry := httpx.NewMetricsRegistry()
	// Fold gateway infrastructure counters (geo-gate denials, WS fan-out drops)
	// into the canonical /metrics scrape alongside HTTP request metrics (P3-05).
	metricsRegistry.RegisterCollector(gatewayhttp.GatewayInfraMetrics)
	mux.Handle("/metrics", httpx.MetricsHandler(metricsRegistry, cfg.Name))
	gatewayhttp.RegisterRoutes(mux, cfg.Name)

	// Auth service URL for token validation
	authServiceURL := os.Getenv("AUTH_SERVICE_URL")
	if authServiceURL == "" {
		authServiceURL = "http://localhost:18081"
	}

	// Public paths that do not require authentication.
	// The payments webhook is intentionally public so providers can reach it,
	// but the handler performs its own HMAC verification before processing.
	publicPrefixes := gatewayPublicPrefixes()

	// CSRF-exempt prefixes (auth endpoints and provider-to-provider webhooks
	// handle their own verification).
	csrfSkipPrefixes := gatewayCSRFSkipPrefixes()

	// CORS origins. Comma-separated list; credentials require exact origin match
	// (no "*"). Defaults cover the local dev ports for the player app and the
	// backoffice. For production set GATEWAY_CORS_ORIGINS to real domains.
	corsOrigins := os.Getenv("GATEWAY_CORS_ORIGINS")
	if corsOrigins == "" {
		corsOrigins = "http://localhost:3000,http://localhost:3001"
	}
	corsMW := httpx.CORS(strings.Split(corsOrigins, ","))

	// Build middleware chain — execution order is right-to-left:
	// Recovery -> Metrics -> AccessLog -> RateLimit -> CSRF -> Auth -> RequestID -> handler
	authEnabled := strings.ToLower(strings.TrimSpace(os.Getenv("GATEWAY_AUTH_ENABLED"))) != "false"

	// IP-keyed rate limiting on public read prefixes only. Runs before Auth
	// on the way in so unauthenticated abuse traffic is dropped before any
	// auth-service or DB work; 429s still hit AccessLog/Metrics (both sit
	// outside it). Pass-through no-op when GATEWAY_RATELIMIT_ENABLED=false.
	rateLimitMW := buildRateLimitMiddleware()

	middlewares := []httpx.Middleware{
		// Auth-disabled (dev/demo) chain has no httpx.Auth to strip client-set
		// identity headers, so do it explicitly here (SECURITY-REVIEW #24).
		stripClientIdentityHeaders,
		tenant.Middleware, // innermost: resolves the active tenant after auth (ADR-0005 step 2)
		httpx.RequestID(),
		httpx.NormalizeTrailingSlash("/api/", "/admin/", "/auth/"),
		tracing.Middleware(),
		httpx.SecurityHeaders(),
		corsMW,
		rateLimitMW,
		httpx.AccessLog(log.Default()),
		httpx.Metrics(metricsRegistry),
		httpx.Recovery(log.Default()),
		httpx.MaxBodySize(1 << 20), // 1 MB — applied first (outermost)
	}

	if authEnabled {
		middlewares = []httpx.Middleware{
			httpx.RequestID(),
			httpx.NormalizeTrailingSlash("/api/", "/admin/", "/auth/"),
			tracing.Middleware(),
			httpx.SecurityHeaders(),
			corsMW,
			httpx.Auth(authServiceURL, publicPrefixes),
			httpx.CSRF(csrfSkipPrefixes),
			rateLimitMW,
			httpx.AccessLog(log.Default()),
			httpx.Metrics(metricsRegistry),
			httpx.Recovery(log.Default()),
			httpx.MaxBodySize(1 << 20), // 1 MB — applied first (outermost)
		}
		slog.Info("auth middleware enabled", "auth_service", authServiceURL)
	} else {
		slog.Warn("auth middleware DISABLED — all routes are unprotected", "reason", "GATEWAY_AUTH_ENABLED=false")
	}
	slog.Info("CORS configured", "origins", corsOrigins)

	handler := httpx.Chain(mux, middlewares...)

	// Graceful shutdown on SIGINT/SIGTERM
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	slog.Info("starting service", "service", cfg.Name, "port", cfg.Port)
	if err := runtime.RunHTTPServer(ctx, cfg, handler); err != nil {
		log.Fatalf("%s service failed: %v", cfg.Name, err)
	}
	slog.Info("service stopped gracefully", "service", cfg.Name)
}

// rateLimitedReadPrefixes are the public, unauthenticated read paths that
// are the prime abuse target — anyone on the internet can hit them, no
// session needed. We rate-limit ONLY these in v1 so a Redis blip
// (which fails open) cannot accidentally let through unbounded traffic on
// point-moving endpoints. Mutating + authenticated endpoints are bounded
// by the auth-service login limiter, the per-endpoint limiters (bots,
// disputes, social), and per-user wallet idempotency keys instead.
//
// Keep this in sync with `gatewayPublicPrefixes` for the read-only entries.
func rateLimitedReadPrefixes() []string {
	return []string{
		"/api/v1/discovery",
		"/api/v1/discover",
		"/api/v1/categories",
		"/api/v1/events",
		"/api/v1/markets",
		"/api/v1/leaderboards",
		"/api/v1/content",
		"/api/v1/banners",
	}
}

// buildRateLimitMiddleware wires the IP-keyed rate-limit middleware. Returns
// a pass-through no-op when GATEWAY_RATELIMIT_ENABLED=false. Backend: Redis
// (fixed-window counters shared across replicas) when REDIS_URL parses;
// in-memory sliding window otherwise (single-instance deployments + dev).
//
//	GATEWAY_RATELIMIT_ENABLED=false        → middleware not installed
//	GATEWAY_RATELIMIT_RPM=120              → per-key requests per minute
//	GATEWAY_TRUSTED_PROXY_CIDRS=10.0.0.0/8 → comma-list of proxy CIDRs
func buildRateLimitMiddleware() httpx.Middleware {
	if strings.ToLower(strings.TrimSpace(os.Getenv("GATEWAY_RATELIMIT_ENABLED"))) == "false" {
		slog.Warn("rate limiting DISABLED", "reason", "GATEWAY_RATELIMIT_ENABLED=false")
		return func(next stdhttp.Handler) stdhttp.Handler { return next }
	}

	rpm := 120
	if v := strings.TrimSpace(os.Getenv("GATEWAY_RATELIMIT_RPM")); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 {
			rpm = parsed
		} else {
			slog.Warn("invalid GATEWAY_RATELIMIT_RPM, using default", "value", v, "default", rpm)
		}
	}

	// Mirror the P2-07 WS-backbone pattern: REDIS_URL is the single source
	// of Redis config; anything unset/invalid degrades to in-memory.
	var limiter httpx.RateLimiter
	backend := "memory"
	if redisURL := strings.TrimSpace(os.Getenv("REDIS_URL")); redisURL != "" {
		if opt, perr := redis.ParseURL(redisURL); perr == nil {
			limiter = httpx.NewRedisRateLimiter(redis.NewClient(opt), "rl:gateway")
			backend = "redis"
		} else {
			slog.Warn("rate limiter falling back to in-memory (REDIS_URL invalid)",
				"error", perr,
				"impact", "counters not shared across replicas")
		}
	}
	if limiter == nil {
		limiter = httpx.NewMemoryRateLimiter()
	}

	// Trusted-proxy CIDRs let us safely honor X-Forwarded-For. If unset,
	// the limiter keys on r.RemoteAddr only — correct for direct-to-gateway
	// dev, and safe (but coarse) when deployed behind a proxy without
	// configuration: every request looks like it came from the proxy IP,
	// so the proxy itself gets rate-limited instead of individual clients.
	// Set GATEWAY_TRUSTED_PROXY_CIDRS to enable per-client keying.
	keyFunc := httpx.ClientIP
	keying := "peer-addr"
	if cidrs := strings.TrimSpace(os.Getenv("GATEWAY_TRUSTED_PROXY_CIDRS")); cidrs != "" {
		fn, err := httpx.TrustedProxyClientIP(strings.Split(cidrs, ","))
		if err != nil {
			// Fail-fast on misconfiguration — a bad CIDR string at startup
			// is far better than silently keying all requests on the proxy.
			log.Fatalf("invalid GATEWAY_TRUSTED_PROXY_CIDRS: %v", err)
		}
		keyFunc = fn
		keying = "per-client"
		slog.Info("rate limiter trusts X-Forwarded-For from configured proxies", "cidrs", cidrs)
	} else {
		// The 2026-08-16 incident was invisible precisely because nothing
		// said this out loud: behind a proxy, peer-addr keying puts every
		// visitor in ONE bucket, so the public read limit becomes a
		// site-wide budget and market data 429s under trivial load. Warn
		// loudly — it is correct only for direct-to-gateway dev.
		slog.Warn("rate limiter keys on the peer address — all clients behind a proxy SHARE ONE BUCKET",
			"fix", "set GATEWAY_TRUSTED_PROXY_CIDRS to every proxy hop's CIDR",
			"ok_if", "gateway is reached directly (dev)",
		)
	}

	cfg := httpx.RateLimitConfig{
		Limiter:      limiter,
		Limit:        rpm,
		Window:       time.Minute,
		PathPrefixes: rateLimitedReadPrefixes(),
		KeyFunc:      keyFunc,
	}
	slog.Info("rate limiting enabled",
		"backend", backend,
		"rpm", rpm,
		"keying", keying,
		"scope", "public reads only",
		"prefixes", cfg.PathPrefixes,
	)
	return httpx.RateLimit(cfg)
}

// stripClientIdentityHeaders removes client-supplied identity headers at ingress.
// httpx.Auth performs this in the auth-enabled chain; the auth-disabled (dev/demo)
// chain has none, so we strip explicitly to stop a handler's header fallback from
// honoring an attacker-set identity (SECURITY-REVIEW #24, defense-in-depth).
func stripClientIdentityHeaders(next stdhttp.Handler) stdhttp.Handler {
	return stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		for _, h := range []string{"X-User-ID", "X-Admin-Role", "X-Bot-Scopes", "X-Bot-Key-ID", "X-Admin-Actor", "X-Admin-User", "X-Actor-Id"} {
			r.Header.Del(h)
		}
		next.ServeHTTP(w, r)
	})
}

func gatewayPublicPrefixes() []string {
	prefixes := []string{
		"/healthz",
		"/readyz",
		"/metrics",
		"/api/v1/status",
		"/api/v1/auth/",
		"/auth/",
		"/ws",              // WebSocket has its own auth
		"/api/v1/content/", // CMS content delivery (public)
		"/api/v1/banners",  // CMS banner delivery (public)

		// Prediction platform — public read-only endpoints
		"/api/v1/discover", // demo product feed (imported_markets); pre-launch behind app auth, but no session needed for the read
		"/api/v1/discovery",
		"/api/v1/live-markets",
		"/api/v1/categories",
		"/api/v1/series",
		"/api/v1/tags",
		"/api/v1/events",
		"/api/v1/markets",

		// Leaderboards — board list + per-board entries are public; the
		// per-user /api/v1/me/leaderboards endpoint sits outside this prefix
		// and still requires a session.
		"/api/v1/leaderboards",

		// Bot API uses its own API-key auth middleware, not the session auth
		"/api/v1/bot/",
	}
	if legacyMoneyRoutesEnabledFromOS() {
		prefixes = append(prefixes,
			"/api/v1/payments/webhook",
			"/v1/provider-callbacks/", // Legacy cashier provider callbacks verify raw-body signatures in-handler.
		)
	}
	if storeEnabledFromOS() {
		// The point store webhook is public only when the store tree is
		// mounted; the handler performs its own HMAC verification against
		// STORE_WEBHOOK_SECRET before processing (mirrors the legacy
		// payments-webhook pattern above). All other /api/v1/store/* routes
		// stay session-authenticated.
		prefixes = append(prefixes, "/api/v1/store/webhook")
	}
	return prefixes
}

func gatewayCSRFSkipPrefixes() []string {
	prefixes := []string{
		"/api/v1/auth/",
		"/auth/",
		"/healthz",
		"/readyz",
		"/metrics",
		"/api/v1/status",
	}
	if legacyMoneyRoutesEnabledFromOS() {
		prefixes = append(prefixes,
			"/api/v1/payments/webhook",
			"/v1/provider-callbacks/",
		)
	}
	if storeEnabledFromOS() {
		prefixes = append(prefixes, "/api/v1/store/webhook")
	}
	return prefixes
}

func validateGatewayRuntimeConfig(getenv func(string) string) error {
	env := strings.ToLower(strings.TrimSpace(getenv("ENVIRONMENT")))
	realEnv := env == "production" || env == "staging"
	if legacyMoneyRoutesEnabled(getenv) && realEnv {
		return fmt.Errorf("%s=true is not permitted when ENVIRONMENT=%s; Tap Trade launch must not expose deposit, withdrawal, cashier, crypto, or provider-callback routes", legacyMoneyRoutesEnv, env)
	}
	alphaCashierEnabled := strings.EqualFold(strings.TrimSpace(getenv("ALPHA_CASHIER_ENABLED")), "true")
	if alphaCashierEnabled && realEnv {
		return fmt.Errorf("ALPHA_CASHIER_ENABLED=true is not permitted when ENVIRONMENT=%s; Tap Trade launch is points-only with no crypto cashier rail", env)
	}
	if alphaCashierEnabled && !legacyMoneyRoutesEnabled(getenv) {
		return fmt.Errorf("ALPHA_CASHIER_ENABLED=true requires %s=true; Tap Trade launch keeps the legacy cashier route tree disabled", legacyMoneyRoutesEnv)
	}
	if err := alphacashier.ValidateRuntimeConfig(getenv); err != nil {
		return err
	}
	// Point store boot rules (STORE_AND_PAYMENTS.md §7): an enabled store in
	// production/staging must carry a real STORE_WEBHOOK_SECRET, and
	// STORE_PROVIDER=stripe is a reserved seam refused until implemented.
	if err := store.ValidateRuntimeConfig(getenv); err != nil {
		return err
	}

	// The auth kill switch is a local-dev convenience only. Refuse to boot with
	// it disabled in any deployed environment.
	if strings.EqualFold(strings.TrimSpace(getenv("GATEWAY_AUTH_ENABLED")), "false") && realEnv {
		return fmt.Errorf("GATEWAY_AUTH_ENABLED=false is not permitted when ENVIRONMENT=%s", env)
	}

	// The admin anonymous bypass skips BOTH the admin-role check and RBAC
	// permission enforcement (see requireAdminRole / requireRBACPermission). It
	// is a local-dev convenience only — refuse to boot with it enabled in any
	// deployed environment so it can never silently disable back-office
	// authorization in prod/staging.
	if strings.EqualFold(strings.TrimSpace(getenv("GATEWAY_ALLOW_ADMIN_ANON")), "true") && realEnv {
		return fmt.Errorf("GATEWAY_ALLOW_ADMIN_ANON=true is not permitted when ENVIRONMENT=%s", env)
	}

	// Payment webhooks are not launch routes. Validate their HMAC secret only
	// when the legacy money-route tree is explicitly enabled, so Tap Trade launch
	// does not require a dormant payment secret to boot.
	if legacyMoneyRoutesEnabled(getenv) {
		switch strings.TrimSpace(getenv("PAYMENTS_WEBHOOK_SECRET")) {
		case "":
			return fmt.Errorf("PAYMENTS_WEBHOOK_SECRET must be set when %s=true and ENVIRONMENT=%s", legacyMoneyRoutesEnv, env)
		case "whsec_local":
			return fmt.Errorf("PAYMENTS_WEBHOOK_SECRET is the dev placeholder 'whsec_local'; set a real secret when %s=true and ENVIRONMENT=%s", legacyMoneyRoutesEnv, env)
		}
	}

	// Everything below applies only to deployed environments. Local dev and the
	// demo box (ENVIRONMENT unset) keep the convenient docker-compose defaults.
	if !realEnv {
		return nil
	}

	// Refuse the dev database password in a deployed environment. The local
	// docker-compose bakes in 'localdev' for convenience; a DSN still carrying
	// it in prod/staging is a leftover dev config, not a real credential.
	for _, dsnVar := range []string{"GATEWAY_DB_DSN", "WALLET_DB_DSN"} {
		if strings.Contains(getenv(dsnVar), ":localdev@") {
			return fmt.Errorf("%s uses the dev database password 'localdev'; use real credentials when ENVIRONMENT=%s", dsnVar, env)
		}
	}

	// P3-06: the provider-ops audit trail is append-only (migration 036) and is
	// the system of record for compliance actions, so in a deployed environment
	// it must be DB-backed. The JSON-file fallback is mutable and per-instance —
	// it cannot be authoritative — so fail closed rather than silently degrade.
	// (Mirrors buildProviderOpsAuditStoreFromEnv's DB-selection branch.)
	auditMode := strings.ToLower(strings.TrimSpace(getenv("PROVIDER_OPS_AUDIT_STORE_MODE")))
	auditDSN := strings.TrimSpace(getenv("PROVIDER_OPS_AUDIT_DB_DSN"))
	if auditDSN == "" {
		auditDSN = strings.TrimSpace(getenv("GATEWAY_DB_DSN"))
	}
	auditDB := auditMode == "db" || auditMode == "sql" || auditMode == "postgres" || auditMode == "shared" || (auditMode == "" && auditDSN != "")
	if !auditDB {
		return fmt.Errorf("provider-ops audit store must be DB-backed when ENVIRONMENT=%s: set PROVIDER_OPS_AUDIT_STORE_MODE=db (or leave it unset with a valid GATEWAY_DB_DSN); the JSON-file fallback is mutable and per-instance and cannot be the audit system of record", env)
	}

	for _, key := range []string{"CRYPTO_RPC_URL", "CRYPTO_ASSET_CONTRACT", "CRYPTO_DEPOSIT_ADDRESS_SOURCE"} {
		if strings.TrimSpace(getenv(key)) != "" {
			return fmt.Errorf("%s must not be set in production: legacy custodial cashier rail is prototype-only; use non-custodial cashier services instead", key)
		}
	}

	complianceMode := strings.ToLower(strings.TrimSpace(getenv("BETA_COMPLIANCE_MODE")))
	if complianceMode == "" {
		complianceMode = strings.ToLower(strings.TrimSpace(getenv("COMPLIANCE_MODE")))
	}
	ackedPermissive := false
	switch complianceMode {
	case "permissive", "permissive_beta", "beta_permissive":
		// The permissive bypass disables the jurisdiction and trading-KYC
		// gates entirely. That is a staging/demo posture only — production
		// must never run ungated, ack or no ack.
		if env == "production" {
			return fmt.Errorf("BETA_COMPLIANCE_MODE=%s is not permitted when ENVIRONMENT=production; permissive mode is for staging/demo only", complianceMode)
		}
		if !strings.EqualFold(strings.TrimSpace(getenv("COMPLIANCE_STARTUP_ACK")), "true") {
			return fmt.Errorf("permissive beta compliance mode disables KYC/geofence gates; set COMPLIANCE_STARTUP_ACK=true when ENVIRONMENT=%s to acknowledge this beta policy", env)
		}
		ackedPermissive = true
	}

	// Deny-by-default jurisdiction + KYC posture: a deployed environment that
	// is not in acked-permissive mode must enforce the geo gate in allowlist
	// mode and state its KYC posture explicitly. The boot checks demand the
	// canonical value "true" (stricter than the runtime parsers, which also
	// accept 1/yes) so a deploy can never pass validation with a value the
	// runtime might not honor.
	if !ackedPermissive {
		if !strings.EqualFold(strings.TrimSpace(getenv("GEO_GATE_ENABLED")), "true") {
			return fmt.Errorf("GEO_GATE_ENABLED=true is required when ENVIRONMENT=%s (deny-by-default jurisdiction posture); use BETA_COMPLIANCE_MODE=permissive + COMPLIANCE_STARTUP_ACK=true on staging if the bypass is intended", env)
		}
		if !hasCountryEntries(getenv("GEO_ALLOWED_COUNTRIES")) {
			return fmt.Errorf("GEO_ALLOWED_COUNTRIES must list the permitted ISO-3166 countries when ENVIRONMENT=%s — allowlist mode is mandatory for launch (a blocklist is too easy to under-specify)", env)
		}
		for _, kycVar := range []string{"KYC_ENFORCEMENT", "KYC_REQUIRED_FOR_TRADING"} {
			v := strings.TrimSpace(getenv(kycVar))
			ack := strings.EqualFold(strings.TrimSpace(getenv(kycVar+"_ACK_DISABLED")), "true")
			if !strings.EqualFold(v, "true") && !ack {
				return fmt.Errorf("%s must be explicitly 'true' or explicitly acknowledged off via %s_ACK_DISABLED=true when ENVIRONMENT=%s — KYC posture must not default off silently", kycVar, kycVar, env)
			}
		}
		// Anti-spoof edge-auth (audit SEC-03): in a trusted-edge deploy the
		// gateway origin must not be reachable with a forged country header.
		// If GEO_TRUSTED_PROXY_MODE=require, EDGE_SHARED_SECRET must be set so
		// the gate can prove a request transited the edge — otherwise
		// require-mode is a no-op and the bypass stays open.
		if strings.EqualFold(strings.TrimSpace(getenv("GEO_TRUSTED_PROXY_MODE")), "require") &&
			strings.TrimSpace(getenv("EDGE_SHARED_SECRET")) == "" {
			return fmt.Errorf("EDGE_SHARED_SECRET must be set when GEO_TRUSTED_PROXY_MODE=require and ENVIRONMENT=%s — without it the origin can be hit directly with a spoofed country header (audit SEC-03); set it here and stamp it at the edge (Caddy: header_up X-Edge-Auth)", env)
		}
	}
	return nil
}

func legacyMoneyRoutesEnabledFromOS() bool {
	return legacyMoneyRoutesEnabled(os.Getenv)
}

func storeEnabledFromOS() bool {
	return store.EnabledFromEnv(os.Getenv)
}

func legacyMoneyRoutesEnabled(getenv func(string) string) bool {
	return strings.EqualFold(strings.TrimSpace(getenv(legacyMoneyRoutesEnv)), "true")
}

// hasCountryEntries reports whether a comma-separated country list contains at
// least one non-empty entry (mirrors compliance.parseCountrySet's tokenizing).
func hasCountryEntries(raw string) bool {
	for _, tok := range strings.Split(raw, ",") {
		if strings.TrimSpace(tok) != "" {
			return true
		}
	}
	return false
}

// CORS configuration moved to platform/transport/httpx as httpx.CORS — see
// that package for the implementation and security notes (it ships with a
// strict allowlist contract that route handlers must not bypass).
