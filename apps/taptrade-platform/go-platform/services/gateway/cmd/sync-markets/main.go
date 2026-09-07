// sync-markets is a one-shot runner that pulls prediction markets from the
// three free upstream sources and writes them to imported_markets under our
// own UUIDs and image paths. Phase 1 — invoked by hand to reseed the demo.
package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"log"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "github.com/lib/pq"

	"taptrade/gateway/internal/discover"
	"taptrade/gateway/internal/markettranslate"
	"taptrade/gateway/internal/prediction"
)

func main() {
	var (
		polymarketLimit  = flag.Int("polymarket", 200, "max markets to pull from polymarket")
		kalshiLimit      = flag.Int("kalshi", 200, "max markets to pull from kalshi")
		manifoldLimit    = flag.Int("manifold", 100, "max markets to pull from manifold")
		publicRoot       = flag.String("public-root", "", "absolute path to player-app public/ dir for image rehosting (defaults to office-backoffice/packages/app/public)")
		timeoutSec       = flag.Int("timeout", 180, "overall sync timeout in seconds")
		translate        = flag.Bool("translate", envBool("AI_MARKET_TRANSLATION_ENABLED", false), "generate cached LLM translations after promotion")
		translateLimit   = flag.Int("translate-limit", envInt("AI_TRANSLATION_LIMIT", 50), "maximum promoted markets to scan for missing/stale translations")
		translateLocales = flag.String("translate-locales", strings.Join(markettranslate.DefaultLocaleCodes(), ","), "comma-separated target locales for translation")
	)
	flag.Parse()

	dsn := strings.TrimSpace(os.Getenv("GATEWAY_DB_DSN"))
	if dsn == "" {
		log.Fatal("GATEWAY_DB_DSN environment variable not set")
	}

	resolvedPublicRoot := *publicRoot
	if resolvedPublicRoot == "" {
		resolvedPublicRoot = defaultPublicRoot()
	}
	if resolvedPublicRoot == "" {
		log.Fatal("could not resolve player-app public/ directory; pass -public-root")
	}

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		log.Fatalf("ping db: %v", err)
	}

	repo := discover.NewRepository(db)
	rehoster := discover.NewImageRehoster(resolvedPublicRoot)

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(*timeoutSec)*time.Second)
	defer cancel()

	limits := map[string]int{
		"polymarket": *polymarketLimit,
		"kalshi":     *kalshiLimit,
		"manifold":   *manifoldLimit,
	}

	slog.Info("sync-markets: starting", "limits", limits, "public_root", resolvedPublicRoot)
	t0 := time.Now()
	// Curation sweep first — retire already-promoted ad-spam regardless of
	// upstream health (mirrors the in-process hourly worker). The repo/svc
	// pair is the same NoopWallet service Promote uses below.
	predRepo := prediction.NewSQLRepository(db)
	predSvc := prediction.NewService(predRepo, nil)
	if voided, cerr := discover.CurateImportedCatalog(ctx, db, predSvc); cerr != nil {
		slog.Warn("sync-markets: curation sweep failed", "error", cerr)
	} else if voided > 0 {
		slog.Info("sync-markets: curation sweep retired unsuitable imports", "voided", voided)
	}
	res, deduped, err := discover.Sync(ctx, repo, rehoster, limits)
	elapsed := time.Since(t0).Round(time.Millisecond)
	if err != nil {
		log.Fatalf("sync failed after %s: %v", elapsed, err)
	}

	// Promote into the AMM. Imported markets become first-class
	// prediction_markets rows. Service walks the FSM (unopened→open→
	// closed→settled), writes lifecycle events, and runs the settlement
	// engine for upstream-resolved markets. NewService(repo, nil)
	// substitutes a NoopWallet — fine for sync because Promote never
	// touches user balances (CreateMarket doesn't debit; ResolveMarket
	// on a market with zero positions is a no-op for the wallet).
	promoteRes, err := discover.Promote(ctx, db, predRepo, predSvc, deduped)
	if err != nil {
		log.Fatalf("promote failed after %s: %v", time.Since(t0).Round(time.Millisecond), err)
	}

	translationSummary := markettranslate.Summary{}
	if *translate {
		cfg := markettranslate.ConfigFromEnv()
		cfg.Limit = *translateLimit
		cfg.Locales = markettranslate.ParseLocaleList(*translateLocales)
		repo := markettranslate.NewRepository(db)
		translator := markettranslate.NewOpenAICompatibleClient(cfg)
		translationCtx, translationCancel := context.WithTimeout(context.Background(), time.Duration(envInt("AI_TRANSLATION_JOB_TIMEOUT_SECONDS", 300))*time.Second)
		translationSummary, err = markettranslate.Backfill(translationCtx, repo, translator, cfg)
		translationCancel()
		if err != nil {
			slog.Warn("sync-markets: translation backfill failed", "err", err)
		}
	}

	totalElapsed := time.Since(t0).Round(time.Millisecond)
	fmt.Fprintf(os.Stderr,
		"sync-markets: ok in %s\n"+
			"  fetched : polymarket=%d kalshi=%d manifold=%d\n"+
			"  dedupe  : %d → %d\n"+
			"  imported: created=%d updated=%d expired_removed=%d images=%d (failed=%d dropped_shared=%d aligned=%d)\n"+
			"  promote : open=%d resolved=%d closed=%d resolved_existing=%d removed=%d skipped=%d failed=%d\n"+
			"  translate: enabled=%t scanned=%d markets=%d written=%d skipped=%d failed=%d\n"+
			"  by_cat  : %v\n",
		totalElapsed,
		res.FetchedPolymarket, res.FetchedKalshi, res.FetchedManifold,
		res.BeforeDedupe, res.AfterDedupe,
		res.Created, res.Updated, res.RemovedExpired, res.ImagesRehosted, res.ImagesFailed, res.ImagesDroppedShared, res.MarketImagesAligned,
		promoteRes.Created, promoteRes.Resolved, promoteRes.Closed, promoteRes.ResolvedExisting, promoteRes.Removed, promoteRes.Skipped, promoteRes.Failed,
		*translate, translationSummary.MarketsScanned, translationSummary.MarketsTranslated, translationSummary.TranslationsWritten, translationSummary.MarketsSkipped, translationSummary.Failures,
		promoteRes.ByCategory,
	)
	if len(res.FetchErrors) > 0 {
		fmt.Fprintf(os.Stderr, "  warnings: %d fetch errors (see stderr above)\n",
			len(res.FetchErrors))
	}
}

func envBool(key string, fallback bool) bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	if v == "" {
		return fallback
	}
	return v == "1" || v == "true" || v == "yes" || v == "on"
}

func envInt(key string, fallback int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	var out int
	if _, err := fmt.Sscanf(v, "%d", &out); err == nil && out > 0 {
		return out
	}
	return fallback
}

// defaultPublicRoot resolves the player-app public/ directory relative to the
// gateway service. Layout:
//
//	apps/taptrade-platform/
//	  go-platform/services/gateway/      ← cwd when run via `go run ./cmd/sync-markets`
//	  frontend/packages/app/public/      ← target
//
// NOTE (pre-existing, unrelated to branding): the candidates below still probe
// the pre-2026-07 `office-backoffice/` path, which no longer exists, so this
// function currently returns "" on every checkout. Left as-is — repointing it is
// a behaviour change, not a rename.
func defaultPublicRoot() string {
	cwd, err := os.Getwd()
	if err != nil {
		return ""
	}
	candidates := []string{
		filepath.Join(cwd, "..", "..", "..", "office-backoffice", "packages", "app", "public"),
		filepath.Join(cwd, "..", "..", "office-backoffice", "packages", "app", "public"),
	}
	for _, c := range candidates {
		abs, err := filepath.Abs(c)
		if err != nil {
			continue
		}
		if info, err := os.Stat(abs); err == nil && info.IsDir() {
			return abs
		}
	}
	return ""
}
