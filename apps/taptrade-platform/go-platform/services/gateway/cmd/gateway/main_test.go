package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"taptrade/platform/transport/httpx"
)

// TD-008: /api/v1/bot/keys is managed by a signed-in player, so it must go
// through session auth and CSRF; the API-key routes skip both.
func TestBotKeysNeedSessionWhileBotAPIUsesItsKey(t *testing.T) {
	public := gatewayPublicPrefixes()
	csrfSkip := gatewayCSRFSkipPrefixes()
	for _, path := range []string{"/api/v1/bot/keys", "/api/v1/bot/keys/key-1"} {
		if matchesAnyPrefix(path, public) {
			t.Fatalf("%s must require a session; public prefixes=%v", path, public)
		}
		if matchesAnyPrefix(path, csrfSkip) {
			t.Fatalf("%s must keep CSRF protection; skip prefixes=%v", path, csrfSkip)
		}
	}
	for _, path := range []string{"/api/v1/bot/orders", "/api/v1/bot/positions", "/api/v1/bot/markets"} {
		if !matchesAnyPrefix(path, public) {
			t.Fatalf("%s authenticates with an API key and must skip session auth", path)
		}
		if !matchesAnyPrefix(path, csrfSkip) {
			t.Fatalf("%s authenticates with an API key and must skip CSRF", path)
		}
	}

	reached := map[string]bool{}
	mux := http.NewServeMux()
	for _, path := range []string{"/api/v1/bot/orders", "/api/v1/bot/keys"} {
		path := path
		mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
			reached[path] = true
			w.WriteHeader(http.StatusOK)
		})
	}
	handler := httpx.Chain(mux,
		httpx.Auth("http://127.0.0.1:1", public),
		httpx.CSRF(csrfSkip),
	)

	// A bot order with only a bearer key (no cookies) reaches the handler.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/bot/orders", strings.NewReader(`{}`))
	req.Header.Set("Authorization", "Bearer tna_abc_secret")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if !reached["/api/v1/bot/orders"] {
		t.Fatalf("bot order blocked before its handler: %d %s", rec.Code, rec.Body.String())
	}

	// Key management without a session is refused by session auth.
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/bot/keys", nil))
	if rec.Code != http.StatusUnauthorized || reached["/api/v1/bot/keys"] {
		t.Fatalf("GET /api/v1/bot/keys without a session: %d, reached=%v; want 401 before the handler", rec.Code, reached["/api/v1/bot/keys"])
	}
}

func TestLegacyMoneyPathsAreNotPublicOrCSRFSkippedByDefault(t *testing.T) {
	t.Setenv(legacyMoneyRoutesEnv, "")
	publicPrefixes := gatewayPublicPrefixes()
	csrfSkipPrefixes := gatewayCSRFSkipPrefixes()

	paths := []string{
		"/api/v1/cashier/alpha/config",
		"/api/v1/cashier/alpha/wallet/challenge",
		"/api/v1/cashier/alpha/wallet/connect",
		"/api/v1/cashier/alpha/wallets",
		"/api/v1/cashier/alpha/deposit-intents",
		"/api/v1/cashier/alpha/deposit-intents/intent-1/submit-tx",
		"/api/v1/cashier/alpha/withdrawal-requests",
		"/api/v1/cashier/alpha/withdrawal-requests/request-1/cancel",
		"/api/v1/admin/cashier/alpha/preflight",
		"/api/v1/admin/cashier/alpha/deposits",
		"/api/v1/admin/cashier/alpha/reconciliation",
		"/api/v1/admin/cashier/alpha/withdrawals",
		"/api/v1/admin/cashier/alpha/audit-events",
		"/api/v1/admin/cashier/alpha/withdrawals/request-1/approve",
		"/api/v1/payments/deposit",
		"/api/v1/payments/withdraw",
		"/api/v1/payments/methods",
		"/api/v1/payments/status",
		"/api/v1/payments/webhook",
		"/api/v1/payments/crypto/config",
		"/api/v1/payments/crypto/deposit-address",
		"/v1/provider-callbacks/relay",
	}

	for _, path := range paths {
		if matchesAnyPrefix(path, publicPrefixes) {
			t.Fatalf("%s must not be public in launch mode; public prefixes=%v", path, publicPrefixes)
		}
		if matchesAnyPrefix(path, csrfSkipPrefixes) {
			t.Fatalf("%s must not skip CSRF in launch mode; skip prefixes=%v", path, csrfSkipPrefixes)
		}
	}
}

func TestLegacyMoneyOptInOnlyExemptsProviderCallbacks(t *testing.T) {
	t.Setenv(legacyMoneyRoutesEnv, "true")
	publicPrefixes := gatewayPublicPrefixes()
	csrfSkipPrefixes := gatewayCSRFSkipPrefixes()

	exemptPaths := []string{
		"/api/v1/payments/webhook",
		"/v1/provider-callbacks/relay",
	}
	for _, path := range exemptPaths {
		if !matchesAnyPrefix(path, publicPrefixes) {
			t.Fatalf("%s should be public only after legacy opt-in; public prefixes=%v", path, publicPrefixes)
		}
		if !matchesAnyPrefix(path, csrfSkipPrefixes) {
			t.Fatalf("%s should skip CSRF only after legacy opt-in; skip prefixes=%v", path, csrfSkipPrefixes)
		}
	}

	interactivePaths := []string{
		"/api/v1/cashier/alpha/config",
		"/api/v1/cashier/alpha/wallet/challenge",
		"/api/v1/cashier/alpha/wallet/connect",
		"/api/v1/cashier/alpha/wallets",
		"/api/v1/cashier/alpha/deposit-intents",
		"/api/v1/cashier/alpha/deposit-intents/intent-1/submit-tx",
		"/api/v1/cashier/alpha/withdrawal-requests",
		"/api/v1/cashier/alpha/withdrawal-requests/request-1/cancel",
		"/api/v1/admin/cashier/alpha/preflight",
		"/api/v1/admin/cashier/alpha/deposits",
		"/api/v1/admin/cashier/alpha/reconciliation",
		"/api/v1/admin/cashier/alpha/withdrawals",
		"/api/v1/admin/cashier/alpha/audit-events",
		"/api/v1/admin/cashier/alpha/withdrawals/request-1/approve",
		"/api/v1/payments/deposit",
		"/api/v1/payments/withdraw",
		"/api/v1/payments/methods",
		"/api/v1/payments/status",
		"/api/v1/payments/crypto/config",
		"/api/v1/payments/crypto/deposit-address",
	}
	for _, path := range interactivePaths {
		if matchesAnyPrefix(path, publicPrefixes) {
			t.Fatalf("%s must still require auth after legacy opt-in; public prefixes=%v", path, publicPrefixes)
		}
		if matchesAnyPrefix(path, csrfSkipPrefixes) {
			t.Fatalf("%s must still require CSRF after legacy opt-in; skip prefixes=%v", path, csrfSkipPrefixes)
		}
	}
}

func TestRetiredBetReconciliationReportCommandStaysAbsent(t *testing.T) {
	root := filepath.Clean("../..")
	retiredFiles := []string{
		filepath.Join(root, "cmd/reconciliation-report/main.go"),
		filepath.Join(root, "cmd/reconciliation-report/main_test.go"),
		filepath.Join(root, "internal/http/testdata/reconciliation/lifecycle_cases.json"),
	}
	for _, path := range retiredFiles {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("retired bet reconciliation replay artifact must stay absent: %s", path)
		}
	}
}

func matchesAnyPrefix(path string, prefixes []string) bool {
	for _, prefix := range prefixes {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}
	return false
}

func TestPaymentsWebhookRequiresAuthByDefault(t *testing.T) {
	t.Setenv(legacyMoneyRoutesEnv, "")
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/payments/webhook", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
	})

	handler := httpx.Chain(
		mux,
		httpx.RequestID(),
		httpx.Auth("http://127.0.0.1:1", gatewayPublicPrefixes()),
		httpx.CSRF(gatewayCSRFSkipPrefixes()),
	)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusUnauthorized {
		t.Fatalf("expected legacy payments webhook to require auth by default, got %d", res.Code)
	}
}

func TestPaymentsWebhookBypassesAuthAndCSRFOnlyWhenLegacyMoneyRoutesOptIn(t *testing.T) {
	t.Setenv(legacyMoneyRoutesEnv, "true")
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/payments/webhook", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
	})

	handler := httpx.Chain(
		mux,
		httpx.RequestID(),
		httpx.Auth("http://127.0.0.1:1", gatewayPublicPrefixes()),
		httpx.CSRF(gatewayCSRFSkipPrefixes()),
	)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusAccepted {
		t.Fatalf("expected opted-in legacy webhook request to bypass auth/csrf and reach handler, got %d", res.Code)
	}
}

func TestCashierProviderCallbackRequiresAuthByDefault(t *testing.T) {
	t.Setenv(legacyMoneyRoutesEnv, "")
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/provider-callbacks/relay", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
	})

	handler := httpx.Chain(
		mux,
		httpx.RequestID(),
		httpx.Auth("http://127.0.0.1:1", gatewayPublicPrefixes()),
		httpx.CSRF(gatewayCSRFSkipPrefixes()),
	)

	req := httptest.NewRequest(http.MethodPost, "/v1/provider-callbacks/relay", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusUnauthorized {
		t.Fatalf("expected cashier provider callback to require auth by default, got %d", res.Code)
	}
}

func TestCashierProviderCallbackBypassesAuthAndCSRFOnlyWhenLegacyMoneyRoutesOptIn(t *testing.T) {
	t.Setenv(legacyMoneyRoutesEnv, "true")
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/provider-callbacks/relay", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
	})

	handler := httpx.Chain(
		mux,
		httpx.RequestID(),
		httpx.Auth("http://127.0.0.1:1", gatewayPublicPrefixes()),
		httpx.CSRF(gatewayCSRFSkipPrefixes()),
	)

	req := httptest.NewRequest(http.MethodPost, "/v1/provider-callbacks/relay", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusAccepted {
		t.Fatalf("expected opted-in provider callback to bypass auth/csrf and reach handler, got %d", res.Code)
	}
}

func TestPaymentsDepositStillRequiresAuthentication(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/payments/deposit", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
	})

	handler := httpx.Chain(
		mux,
		httpx.RequestID(),
		httpx.Auth("http://127.0.0.1:1", gatewayPublicPrefixes()),
		httpx.CSRF(gatewayCSRFSkipPrefixes()),
	)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/deposit", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusUnauthorized {
		t.Fatalf("expected deposit route to remain protected, got %d", res.Code)
	}
}

func TestPredictionTaxonomyReadEndpointsBypassAuth(t *testing.T) {
	for _, path := range []string{"/api/v1/series", "/api/v1/tags"} {
		t.Run(path, func(t *testing.T) {
			mux := http.NewServeMux()
			mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
			})

			handler := httpx.Chain(
				mux,
				httpx.RequestID(),
				httpx.Auth("http://127.0.0.1:1", gatewayPublicPrefixes()),
				httpx.CSRF(gatewayCSRFSkipPrefixes()),
			)

			req := httptest.NewRequest(http.MethodGet, path, nil)
			res := httptest.NewRecorder()
			handler.ServeHTTP(res, req)

			if res.Code != http.StatusOK {
				t.Fatalf("expected public taxonomy route to bypass auth, got %d", res.Code)
			}
		})
	}
}

func TestValidateGatewayRuntimeConfigRefusesUnknownEnvironment(t *testing.T) {
	// "prod" is not "production": without this check it would boot with the
	// whole production policy skipped (TD-007).
	for _, env := range []string{"prod", "preprod", "live"} {
		err := validateGatewayRuntimeConfig(prodBaseEnv(map[string]string{"ENVIRONMENT": env}))
		if err == nil || !strings.Contains(err.Error(), "not recognised") {
			t.Fatalf("ENVIRONMENT=%q: got %v, want an unrecognised-environment error", env, err)
		}
	}
	for _, env := range []string{"", "development", "test", "demo"} {
		if err := validateGatewayRuntimeConfig(func(key string) string {
			if key == "ENVIRONMENT" {
				return env
			}
			return ""
		}); err != nil {
			t.Fatalf("ENVIRONMENT=%q: got %v, want nil for a development environment", env, err)
		}
	}
}

func TestValidateGatewayRuntimeConfigBlocksLegacyCustodialCryptoRailInProduction(t *testing.T) {
	for _, legacyKey := range []string{"CRYPTO_RPC_URL", "CRYPTO_ASSET_CONTRACT", "CRYPTO_DEPOSIT_ADDRESS_SOURCE"} {
		t.Run(legacyKey, func(t *testing.T) {
			err := validateGatewayRuntimeConfig(prodBaseEnv(map[string]string{
				legacyKey: "legacy-test-value",
			}))

			if err == nil {
				t.Fatalf("expected production validation to block legacy custodial crypto rail config")
			}
		})
	}
}

func TestValidateGatewayRuntimeConfigRejectsLegacyMoneyRoutesInDeployedEnvs(t *testing.T) {
	for _, env := range []string{"production", "staging"} {
		err := validateGatewayRuntimeConfig(func(key string) string {
			switch key {
			case "ENVIRONMENT":
				return env
			case legacyMoneyRoutesEnv:
				return "true"
			default:
				return ""
			}
		})
		if err == nil {
			t.Fatalf("expected boot refusal for legacy money route opt-in in %s", env)
		}
	}
}

func TestValidateGatewayRuntimeConfigRejectsAlphaCashierInDeployedEnvs(t *testing.T) {
	for _, env := range []string{"production", "staging"} {
		err := validateGatewayRuntimeConfig(func(key string) string {
			switch key {
			case "ENVIRONMENT":
				return env
			case "ALPHA_CASHIER_ENABLED":
				return "true"
			default:
				return ""
			}
		})
		if err == nil {
			t.Fatalf("expected boot refusal for alpha cashier in %s", env)
		}
	}
}

func TestValidateGatewayRuntimeConfigRequiresLegacyRouteOptInForAlphaCashier(t *testing.T) {
	err := validateGatewayRuntimeConfig(alphaCashierEnv(map[string]string{
		"ENVIRONMENT": "development",
	}))
	if err == nil {
		t.Fatalf("expected alpha cashier to require explicit legacy route opt-in")
	}
	if !strings.Contains(err.Error(), legacyMoneyRoutesEnv) {
		t.Fatalf("expected error to mention %s, got %v", legacyMoneyRoutesEnv, err)
	}
}

func TestValidateGatewayRuntimeConfigAllowsAlphaCashierOnlyWithLegacyRouteOptIn(t *testing.T) {
	err := validateGatewayRuntimeConfig(alphaCashierEnv(map[string]string{
		"ENVIRONMENT":             "development",
		legacyMoneyRoutesEnv:      "true",
		"PAYMENTS_WEBHOOK_SECRET": "whsec_real_for_legacy_compat",
	}))
	if err != nil {
		t.Fatalf("expected explicit local legacy opt-in with valid alpha cashier config to validate, got %v", err)
	}
}

func TestValidateGatewayRuntimeConfigAllowsMissingWebhookSecretInDevelopment(t *testing.T) {
	err := validateGatewayRuntimeConfig(func(key string) string {
		if key == "ENVIRONMENT" {
			return "development"
		}
		return ""
	})

	if err != nil {
		t.Fatalf("expected development validation to allow missing webhook secret, got %v", err)
	}
}

func TestValidateGatewayRuntimeConfigRequiresWebhookSecretOnlyForLegacyMoneyOptIn(t *testing.T) {
	cases := []struct {
		name      string
		secret    string
		wantError bool
	}{
		{name: "missing secret", secret: "", wantError: true},
		{name: "dev placeholder", secret: "whsec_local", wantError: true},
		{name: "real secret", secret: "whsec_real_for_legacy_compat", wantError: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateGatewayRuntimeConfig(func(key string) string {
				switch key {
				case "ENVIRONMENT":
					return "development"
				case legacyMoneyRoutesEnv:
					return "true"
				case "PAYMENTS_WEBHOOK_SECRET":
					return tc.secret
				default:
					return ""
				}
			})
			if tc.wantError && err == nil {
				t.Fatalf("expected legacy money opt-in to require a real webhook secret")
			}
			if !tc.wantError && err != nil {
				t.Fatalf("expected real webhook secret to validate for legacy money opt-in, got %v", err)
			}
		})
	}
}

func TestValidateGatewayRuntimeConfigRefusesAuthDisabledInDeployedEnvs(t *testing.T) {
	for _, env := range []string{"production", "staging"} {
		err := validateGatewayRuntimeConfig(func(key string) string {
			switch key {
			case "ENVIRONMENT":
				return env
			case "GATEWAY_AUTH_ENABLED":
				return "false"
			case "PAYMENTS_WEBHOOK_SECRET":
				return "whsec_present"
			default:
				return ""
			}
		})

		if err == nil {
			t.Fatalf("expected boot refusal with auth disabled in %s", env)
		}
	}
}

func TestValidateGatewayRuntimeConfigAllowsAuthDisabledInDevelopment(t *testing.T) {
	err := validateGatewayRuntimeConfig(func(key string) string {
		switch key {
		case "ENVIRONMENT":
			return "development"
		case "GATEWAY_AUTH_ENABLED":
			return "false"
		default:
			return ""
		}
	})

	if err != nil {
		t.Fatalf("expected dev to allow the auth kill switch, got %v", err)
	}
}

func TestValidateGatewayRuntimeConfigRejectsDevDBPasswordInProduction(t *testing.T) {
	err := validateGatewayRuntimeConfig(func(key string) string {
		switch key {
		case "ENVIRONMENT":
			return "production"
		case "PAYMENTS_WEBHOOK_SECRET":
			return "whsec_realsecret"
		case "GATEWAY_DB_DSN":
			return "postgres://predict:localdev@db:5432/predict?sslmode=disable"
		default:
			return ""
		}
	})
	if err == nil {
		t.Fatalf("expected boot refusal for dev database password in production")
	}
}

// prodBaseEnv is a passing production launch configuration: real DB/audit
// config plus the deny-by-default compliance posture (geo allowlist on, KYC
// stated explicitly). Tests override single keys to probe each boot
// requirement.
func prodBaseEnv(overrides map[string]string) func(string) string {
	base := map[string]string{
		"ENVIRONMENT":              "production",
		"PAYMENTS_WEBHOOK_SECRET":  "whsec_a-real-and-strong-secret",
		"GATEWAY_DB_DSN":           "postgres://predict:S3cure-Prod-Pass@db.internal:5432/predict?sslmode=require",
		"WALLET_DB_DSN":            "postgres://predict:S3cure-Prod-Pass@db.internal:5432/predict?sslmode=require",
		"GEO_GATE_ENABLED":         "true",
		"GEO_ALLOWED_COUNTRIES":    "PH,TH,VN",
		"KYC_ENFORCEMENT":          "true",
		"KYC_REQUIRED_FOR_TRADING": "true",
	}
	for k, v := range overrides {
		base[k] = v
	}
	return func(key string) string { return base[key] }
}

func alphaCashierEnv(overrides map[string]string) func(string) string {
	base := map[string]string{
		"ALPHA_CASHIER_ENABLED":          "true",
		"ALPHA_CASHIER_RPC_URL":          "https://rpc.example",
		"ALPHA_CASHIER_TOKEN_ADDRESS":    "0x0000000000000000000000000000000000000001",
		"ALPHA_CASHIER_TREASURY_ADDRESS": "0x0000000000000000000000000000000000000002",
	}
	for k, v := range overrides {
		base[k] = v
	}
	return func(key string) string { return base[key] }
}

func TestValidateGatewayRuntimeConfigAllowsRealSecretsInProduction(t *testing.T) {
	err := validateGatewayRuntimeConfig(prodBaseEnv(nil))
	if err != nil {
		t.Fatalf("expected production with real secrets and compliance posture to validate, got %v", err)
	}
}

func TestValidateGatewayRuntimeConfigDoesNotRequirePaymentWebhookSecretForLaunch(t *testing.T) {
	err := validateGatewayRuntimeConfig(prodBaseEnv(map[string]string{
		"PAYMENTS_WEBHOOK_SECRET": "",
	}))
	if err != nil {
		t.Fatalf("expected production launch config to validate without dormant payment webhook secret, got %v", err)
	}
}

func TestValidateGatewayRuntimeConfigRequiresDBAuditStoreInDeployedEnvs(t *testing.T) {
	// The provider-ops audit trail (append-only, migration 036) must be DB-backed
	// in a deployed environment; the mutable per-instance JSON-file fallback must
	// not boot (P3-06).
	if err := validateGatewayRuntimeConfig(prodBaseEnv(map[string]string{
		"PROVIDER_OPS_AUDIT_STORE_MODE": "file",
	})); err == nil {
		t.Fatalf("expected production boot refusal when the provider-ops audit store is file-backed")
	}
	// An explicit db mode (and the default unset-with-DSN, covered by the
	// passing prodBaseEnv case) validates.
	if err := validateGatewayRuntimeConfig(prodBaseEnv(map[string]string{
		"PROVIDER_OPS_AUDIT_STORE_MODE": "db",
	})); err != nil {
		t.Fatalf("expected db audit store mode to validate in production, got %v", err)
	}
}

func TestValidateGatewayRuntimeConfigRequiresGeoGateInDeployedEnvs(t *testing.T) {
	cases := map[string]map[string]string{
		"geo gate off":          {"GEO_GATE_ENABLED": ""},
		"geo gate false":        {"GEO_GATE_ENABLED": "false"},
		"empty allowlist":       {"GEO_ALLOWED_COUNTRIES": ""},
		"allowlist only commas": {"GEO_ALLOWED_COUNTRIES": " , ,"},
	}
	for name, overrides := range cases {
		t.Run(name, func(t *testing.T) {
			if err := validateGatewayRuntimeConfig(prodBaseEnv(overrides)); err == nil {
				t.Fatalf("expected production boot refusal with %s", name)
			}
		})
	}
}

func TestValidateGatewayRuntimeConfigRequiresExplicitKYCPostureInDeployedEnvs(t *testing.T) {
	for _, kycVar := range []string{"KYC_ENFORCEMENT", "KYC_REQUIRED_FOR_TRADING"} {
		t.Run(kycVar+" silently off", func(t *testing.T) {
			if err := validateGatewayRuntimeConfig(prodBaseEnv(map[string]string{kycVar: ""})); err == nil {
				t.Fatalf("expected production boot refusal when %s is silently off", kycVar)
			}
		})
		t.Run(kycVar+" acked off", func(t *testing.T) {
			err := validateGatewayRuntimeConfig(prodBaseEnv(map[string]string{
				kycVar:                   "",
				kycVar + "_ACK_DISABLED": "true",
			}))
			if err != nil {
				t.Fatalf("expected acked-off %s to validate, got %v", kycVar, err)
			}
		})
	}
}

func TestValidateGatewayRuntimeConfigRefusesPermissiveComplianceInProduction(t *testing.T) {
	err := validateGatewayRuntimeConfig(prodBaseEnv(map[string]string{
		"BETA_COMPLIANCE_MODE":   "permissive",
		"COMPLIANCE_STARTUP_ACK": "true",
	}))
	if err == nil {
		t.Fatalf("expected production boot refusal for permissive compliance mode even with ack")
	}
}

func TestValidateGatewayRuntimeConfigAckedPermissiveStagingSkipsGateRequirements(t *testing.T) {
	// Acked-permissive staging intentionally runs ungated (closed beta), so
	// the geo/KYC posture requirements must not apply there.
	err := validateGatewayRuntimeConfig(prodBaseEnv(map[string]string{
		"ENVIRONMENT":              "staging",
		"BETA_COMPLIANCE_MODE":     "permissive",
		"COMPLIANCE_STARTUP_ACK":   "true",
		"GEO_GATE_ENABLED":         "",
		"GEO_ALLOWED_COUNTRIES":    "",
		"KYC_ENFORCEMENT":          "",
		"KYC_REQUIRED_FOR_TRADING": "",
	}))
	if err != nil {
		t.Fatalf("expected acked-permissive staging to validate without geo/KYC posture, got %v", err)
	}
}

func TestValidateGatewayRuntimeConfigRequiresAckForPermissiveBetaComplianceInDeployedEnvs(t *testing.T) {
	err := validateGatewayRuntimeConfig(func(key string) string {
		switch key {
		case "ENVIRONMENT":
			return "staging"
		case "PAYMENTS_WEBHOOK_SECRET":
			return "whsec_a-real-and-strong-secret"
		case "GATEWAY_DB_DSN", "WALLET_DB_DSN":
			return "postgres://predict:S3cure-Prod-Pass@db.internal:5432/predict?sslmode=require"
		case "BETA_COMPLIANCE_MODE":
			return "permissive"
		default:
			return ""
		}
	})
	if err == nil {
		t.Fatalf("expected deployed permissive beta compliance mode to require COMPLIANCE_STARTUP_ACK=true")
	}
}

func TestValidateGatewayRuntimeConfigAllowsAckedPermissiveBetaComplianceInDeployedEnvs(t *testing.T) {
	err := validateGatewayRuntimeConfig(func(key string) string {
		switch key {
		case "ENVIRONMENT":
			return "staging"
		case "PAYMENTS_WEBHOOK_SECRET":
			return "whsec_a-real-and-strong-secret"
		case "GATEWAY_DB_DSN", "WALLET_DB_DSN":
			return "postgres://predict:S3cure-Prod-Pass@db.internal:5432/predict?sslmode=require"
		case "BETA_COMPLIANCE_MODE":
			return "permissive"
		case "COMPLIANCE_STARTUP_ACK":
			return "true"
		default:
			return ""
		}
	})
	if err != nil {
		t.Fatalf("expected acknowledged permissive beta compliance mode to validate, got %v", err)
	}
}
