package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"log/slog"
	stdhttp "net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	_ "github.com/lib/pq" // Register PostgreSQL driver so AUTH_STORE_MODE=db works

	authhttp "taptrade/auth/internal/http"
	"taptrade/platform/logging"
	"taptrade/platform/runtime"
	"taptrade/platform/transport/httpx"
)

func main() {
	cfg := runtime.LoadServiceConfig("auth", "18081")

	// Refuse an unrecognised ENVIRONMENT before anything reads it: several
	// checks treat every value but production/staging as development.
	if err := runtime.ValidateEnvironment(os.Getenv("ENVIRONMENT")); err != nil {
		log.Fatalf("auth configuration error: %v", err)
	}

	// `auth mfa-reset <username-or-email>` clears a lost authenticator
	// (ops/RUNBOOK.md) and exits instead of serving.
	if len(os.Args) > 1 && os.Args[1] == "mfa-reset" {
		os.Exit(runMFAReset(os.Args[2:]))
	}

	// Initialize structured logging
	env := strings.ToLower(strings.TrimSpace(os.Getenv("ENVIRONMENT")))
	logging.Init(cfg.Name, env)

	mux := stdhttp.NewServeMux()
	metricsRegistry := httpx.NewMetricsRegistry()
	mux.Handle("/metrics", httpx.MetricsHandler(metricsRegistry, cfg.Name))
	authService := authhttp.NewAuthService()
	authhttp.RegisterRoutes(mux, cfg.Name, authService)
	handler := httpx.Chain(
		mux,
		httpx.RequestID(),
		httpx.NormalizeTrailingSlash("/api/", "/auth/"),
		httpx.AccessLog(log.Default()),
		httpx.Metrics(metricsRegistry),
		httpx.Recovery(log.Default()),
	)

	// Graceful shutdown on SIGINT/SIGTERM
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	slog.Info("starting service", "service", cfg.Name, "port", cfg.Port)
	if err := runtime.RunHTTPServer(ctx, cfg, handler); err != nil {
		log.Fatalf("%s service failed: %v", cfg.Name, err)
	}
	slog.Info("service stopped gracefully", "service", cfg.Name)
}

func runMFAReset(args []string) int {
	if len(args) != 1 {
		fmt.Fprintln(os.Stderr, "usage: auth mfa-reset <username-or-email>")
		return 2
	}
	dsn := strings.TrimSpace(os.Getenv("AUTH_DB_DSN"))
	if dsn == "" {
		fmt.Fprintln(os.Stderr, "mfa-reset: AUTH_DB_DSN is not set")
		return 1
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		fmt.Fprintf(os.Stderr, "mfa-reset: %v\n", err)
		return 1
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	matched, removed, err := authhttp.ResetMFA(ctx, db, args[0])
	if err != nil {
		fmt.Fprintf(os.Stderr, "mfa-reset: %v\n", err)
		return 1
	}
	if matched == 0 {
		fmt.Fprintf(os.Stderr, "mfa-reset: no account signs in as %q\n", args[0])
		return 1
	}
	fmt.Printf("mfa-reset: %d account(s) sign in as %q; removed %d two-factor enrollment(s)\n", matched, args[0], removed)
	return 0
}
