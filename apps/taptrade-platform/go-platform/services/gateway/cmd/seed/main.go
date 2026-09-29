package main

import (
	"database/sql"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	_ "github.com/lib/pq"
)

// Modes for cmd/seed:
//
//	base — run the SQL seed (categories, events, markets, users, wallets).
//	       Default. Behavior preserved from before the demo extension.
//	demo — run base, then layer on demo-ready state: cleanup stuck orders,
//	       seed an order book on every order_book market via the bot user,
//	       generate historical trade volume + price history, give the demo
//	       user a real portfolio, settle a few markets so leaderboards and
//	       rewards have data.
//	wipe — remove only the rows the demo phases wrote. Identified by
//	       idempotency keys with the 'demo:' prefix and synthetic trade
//	       rows with trade_kind='demo_history'. Base seed rows are
//	       untouched.
//
// The mode flag is the contract used by `make seed`, `make demo-data`, and
// `make wipe-demo` in services/gateway/Makefile. Keep the names stable.
const (
	modeBase = "base"
	modeDemo = "demo"
	modeWipe = "wipe"
)

func main() {
	mode := flag.String("mode", modeBase, "seed mode: base | demo | wipe")
	flag.Parse()

	switch *mode {
	case modeBase, modeDemo, modeWipe:
		// ok
	default:
		log.Fatalf("error: unknown -mode %q (want base, demo, or wipe)", *mode)
	}

	driver := os.Getenv("GATEWAY_DB_DRIVER")
	if strings.TrimSpace(driver) == "" {
		driver = "postgres"
	}

	dsn := os.Getenv("GATEWAY_DB_DSN")
	if strings.TrimSpace(dsn) == "" {
		log.Fatal("error: GATEWAY_DB_DSN environment variable not set\n\nUsage:\n  GATEWAY_DB_DSN='postgres://user:pass@localhost:5432/predict?sslmode=disable' go run ./cmd/seed [-mode demo|wipe]")
	}

	db, err := sql.Open(driver, dsn)
	if err != nil {
		log.Fatalf("error: could not open database: %v", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		log.Fatalf("error: could not connect to database: %v", err)
	}

	// Base SQL seed runs in base and demo modes. Wipe mode skips it — the
	// goal is to remove demo additions, not reset the world.
	if *mode == modeBase || *mode == modeDemo {
		seedFile := os.Getenv("SEED_FILE")
		if seedFile == "" {
			seedFile = findSeedFile()
		}
		if seedFile == "" {
			log.Fatal("error: seed file not found. Set SEED_FILE env or run from the gateway directory.")
		}
		seedSQL, err := os.ReadFile(seedFile)
		if err != nil {
			log.Fatalf("error: could not read seed file %s: %v", seedFile, err)
		}

		fmt.Printf("Connected to database. Running base seed from %s...\n", seedFile)
		result, err := db.Exec(string(seedSQL))
		if err != nil {
			log.Fatalf("error: seed failed: %v", err)
		}
		rows, _ := result.RowsAffected()
		fmt.Printf("Base seed completed. Rows affected: %d\n", rows)
	}

	switch *mode {
	case modeDemo:
		if err := RunDemo(db, driver, dsn); err != nil {
			log.Fatalf("error: demo seed failed: %v", err)
		}
	case modeWipe:
		if err := RunWipe(db); err != nil {
			log.Fatalf("error: wipe failed: %v", err)
		}
	}

	printSummary(db)
}

func findSeedFile() string {
	// Check common locations
	candidates := []string{
		"seed-data/seed_prediction.sql",
		"../seed-data/seed_prediction.sql",
		"../../seed-data/seed_prediction.sql",
	}

	// Also try relative to executable
	if exePath, err := os.Executable(); err == nil {
		candidates = append(candidates,
			filepath.Join(filepath.Dir(exePath), "..", "..", "seed-data", "seed_prediction.sql"),
		)
	}

	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			abs, _ := filepath.Abs(c)
			return abs
		}
	}
	return ""
}

func printSummary(db *sql.DB) {
	fmt.Println("\n--- Seed Data Summary ---")

	tables := []struct {
		name  string
		query string
	}{
		{"Categories", "SELECT COUNT(*) FROM prediction_categories"},
		{"Series", "SELECT COUNT(*) FROM prediction_series"},
		{"Events", "SELECT COUNT(*) FROM prediction_events"},
		{"Markets", "SELECT COUNT(*) FROM prediction_markets"},
		{"Orders", "SELECT COUNT(*) FROM prediction_orders"},
		{"Positions", "SELECT COUNT(*) FROM prediction_positions"},
		{"Trades", "SELECT COUNT(*) FROM prediction_trades"},
		{"Users", "SELECT COUNT(*) FROM punters"},
		{"Wallets", "SELECT COUNT(*) FROM wallet_balances"},
	}

	for _, t := range tables {
		var count int
		if err := db.QueryRow(t.query).Scan(&count); err != nil {
			fmt.Printf("  %-14s error: %v\n", t.name, err)
		} else {
			fmt.Printf("  %-14s %d\n", t.name, count)
		}
	}

	// List open markets
	fmt.Println("\n--- Open Markets ---")
	rows, err := db.Query(`
		SELECT ticker, title, yes_price_points, volume_points
		FROM prediction_markets WHERE status = 'open'
		ORDER BY volume_points DESC LIMIT 10`)
	if err != nil {
		fmt.Printf("  error: %v\n", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var ticker, title string
		var yesPrice int
		var volume int64
		if err := rows.Scan(&ticker, &title, &yesPrice, &volume); err != nil {
			continue
		}
		// Points unit-model (migration 050): volume_points IS whole Points —
		// print it directly (the retired /100 was a cents-era conversion).
		fmt.Printf("  %-20s YES:%d%%  Vol:%-8d pts %s\n", ticker, yesPrice, volume, truncate(title, 40))
	}
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max-3] + "..."
}
