package http

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The demo is points-only (CLAUDE.md "Points-only launch boundary"). Its
// ENVIRONMENT is deliberately unset, so the production/staging boot refusals
// do not protect it: the money flags simply must never be set there. The
// crypto cashier merged from feat/hula-na-cashier (2026-09-29) stays behind
// these flags, so this test pins that the demo's compose file and deploy
// workflow never set them on a live (non-comment) line.
func TestDemoDeployNeverSetsMoneyFlags(t *testing.T) {
	flags := []string{
		"TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED",
		"ALPHA_CASHIER_ENABLED",
		"ALPHA_CASHIER_WITHDRAWALS_ENABLED",
		"ALPHA_CASHIER_DEPOSIT_SCANNER_ENABLED",
		"ALPHA_CASHIER_RPC_URL",
		"CRYPTO_RPC_URL",
		"CRYPTO_ASSET_CONTRACT",
		"CRYPTO_DEPOSIT_ADDRESS_SOURCE",
		"NEXT_PUBLIC_FEATURE_CASHIER_UI",
	}
	files := []string{
		filepath.Join("..", "..", "..", "..", "..", "docker-compose.demo.yml"),
		filepath.Join("..", "..", "..", "..", "..", "..", "..", ".github", "workflows", "deploy-demo.yml"),
	}
	flagRe := regexp.MustCompile(`\b(` + strings.Join(flags, "|") + `)\b`)
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatalf("read %s: %v", f, err)
		}
		for i, line := range strings.Split(string(raw), "\n") {
			code := strings.TrimSpace(line)
			if strings.HasPrefix(code, "#") {
				continue
			}
			if idx := strings.Index(code, " #"); idx >= 0 {
				code = code[:idx]
			}
			if m := flagRe.FindString(code); m != "" {
				t.Errorf("%s:%d sets %s on the demo: %q", f, i+1, m, strings.TrimSpace(line))
			}
		}
	}
}
