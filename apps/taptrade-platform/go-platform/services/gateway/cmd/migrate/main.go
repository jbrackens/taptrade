package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	_ "github.com/lib/pq"
	"github.com/pressly/goose/v3"
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	command := strings.ToLower(os.Args[1])

	// Parse environment variables for database connection
	driver := os.Getenv("GATEWAY_DB_DRIVER")
	if strings.TrimSpace(driver) == "" {
		driver = "postgres"
	}

	dsn := os.Getenv("GATEWAY_DB_DSN")
	if strings.TrimSpace(dsn) == "" {
		log.Fatal("error: GATEWAY_DB_DSN environment variable not set")
	}

	// Get migrations directory path
	migrationsDir := os.Getenv("MIGRATIONS_DIR")
	if strings.TrimSpace(migrationsDir) == "" {
		// Try to find migrations directory relative to this binary
		exePath, err := os.Executable()
		if err != nil {
			log.Fatal("error: could not determine executable path")
		}
		migrationsDir = filepath.Join(filepath.Dir(exePath), "..", "..", "migrations")
	}

	// Verify migrations directory exists
	if _, err := os.Stat(migrationsDir); os.IsNotExist(err) {
		log.Fatalf("error: migrations directory not found at %s", migrationsDir)
	}

	// Open database connection
	db, err := sql.Open(driver, dsn)
	if err != nil {
		log.Fatalf("error: could not open database: %v", err)
	}
	defer db.Close()

	// Test the connection
	if err := db.Ping(); err != nil {
		log.Fatalf("error: could not ping database: %v", err)
	}

	// Set up goose
	goose.SetDialect(strings.ToLower(driver))

	// Execute migration command. The demo deployment can intentionally receive
	// out-of-order migrations when a feature branch adds a lower-numbered
	// migration after the deployed branch has already applied a newer one. Keep
	// the default strict for local/dev, and require an explicit env opt-in.
	if command == "up" && strings.EqualFold(strings.TrimSpace(os.Getenv("MIGRATE_ALLOW_MISSING")), "true") {
		if err := goose.UpContext(context.Background(), db, migrationsDir, goose.WithAllowMissing()); err != nil {
			log.Fatalf("error: migration command '%s' failed: %v", command, err)
		}
		return
	}

	// Execute migration command
	args := []string{command}
	if len(os.Args) > 2 {
		args = append(args, os.Args[2:]...)
	}

	if err := goose.RunContext(context.Background(), command, db, migrationsDir, args...); err != nil {
		log.Fatalf("error: migration command '%s' failed: %v", command, err)
	}
}

func printUsage() {
	usage := `Database migration tool for the Tap Trade gateway

Usage:
  migrate <command> [options]

Commands:
  up              Apply all pending migrations
  down            Rollback one migration
  status          Show migration status
  version         Print database schema version
  create <name>   Create a new migration file
  reset           Rollback all migrations
  fix             Fix broken migration state

Environment variables:
  GATEWAY_DB_DRIVER    Database driver (default: postgres)
  GATEWAY_DB_DSN       Database connection string (required)
  MIGRATIONS_DIR       Path to migrations directory (auto-detected if not set)

Examples:
  export GATEWAY_DB_DSN="postgres://user:pass@localhost:5432/sportsbook"

  migrate up                          # Apply all pending migrations
  migrate status                      # Show migration status
  migrate down                        # Rollback one migration
  migrate create add_new_table        # Create a new migration
`
	fmt.Print(usage)
}
