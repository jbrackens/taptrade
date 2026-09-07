.PHONY: help build migrate-up migrate-down migrate-status migrate-reset seed clean

# Set default target
.DEFAULT_GOAL := help

# Colors for output
BLUE := \033[0;34m
GREEN := \033[0;32m
RESET := \033[0m

help: ## Display this help message
	@echo "$(BLUE)Tap Trade Prediction Gateway - Make Commands$(RESET)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "$(GREEN)%-20s$(RESET) %s\n", $$1, $$2}'
	@echo ""
	@echo "Database setup:"
	@echo "  make createdb          Create PostgreSQL database"
	@echo "  make migrate-up        Apply all pending migrations"
	@echo "  make migrate-down      Rollback one migration"
	@echo "  make seed              Load Tap Trade launch base seed data"
	@echo ""
	@echo "Environment setup:"
	@echo "  export GATEWAY_DB_DSN=\"postgres://user:pass@localhost:5432/taptrade_predict\""

build: ## Build the migration tool
	@echo "$(BLUE)Building migration tool...$(RESET)"
	go build -o bin/migrate ./cmd/migrate
	@echo "$(GREEN)✓ Migration tool built at bin/migrate$(RESET)"

createdb: ## Create PostgreSQL database
	@echo "$(BLUE)Creating Tap Trade prediction database...$(RESET)"
	@psql -U postgres -c "CREATE DATABASE taptrade_predict;" 2>/dev/null || echo "$(GREEN)Database already exists$(RESET)"

migrate-up: build ## Apply all pending migrations
	@if [ -z "$(GATEWAY_DB_DSN)" ]; then \
		echo "$(BLUE)Error: GATEWAY_DB_DSN environment variable not set$(RESET)"; \
		echo "Set it with: export GATEWAY_DB_DSN=\"postgres://user:pass@localhost:5432/taptrade_predict\""; \
		exit 1; \
	fi
	@echo "$(BLUE)Applying migrations...$(RESET)"
	./bin/migrate up

migrate-down: build ## Rollback one migration
	@if [ -z "$(GATEWAY_DB_DSN)" ]; then \
		echo "$(BLUE)Error: GATEWAY_DB_DSN environment variable not set$(RESET)"; \
		exit 1; \
	fi
	@echo "$(BLUE)Rolling back one migration...$(RESET)"
	./bin/migrate down

migrate-reset: build ## Reset database (rollback all migrations)
	@if [ -z "$(GATEWAY_DB_DSN)" ]; then \
		echo "$(BLUE)Error: GATEWAY_DB_DSN environment variable not set$(RESET)"; \
		exit 1; \
	fi
	@echo "$(BLUE)WARNING: This will rollback ALL migrations$(RESET)"
	@read -p "Continue? [y/N] " -n 1 -r; \
	echo; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		./bin/migrate reset; \
		echo "$(GREEN)✓ Database reset complete$(RESET)"; \
	else \
		echo "$(BLUE)Cancelled$(RESET)"; \
	fi

migrate-status: build ## Check migration status
	@echo "$(BLUE)Migration status:$(RESET)"
	./bin/migrate status

seed: ## Load Tap Trade launch base seed data
	@if [ -z "$(GATEWAY_DB_DSN)" ]; then \
		echo "$(BLUE)Error: GATEWAY_DB_DSN environment variable not set$(RESET)"; \
		exit 1; \
	fi
	@echo "$(BLUE)Loading Tap Trade launch base seed...$(RESET)"
	WALLET_DB_DSN=$(GATEWAY_DB_DSN) WALLET_STORE_MODE=db go run ./cmd/seed -mode base
	@echo "$(GREEN)✓ Tap Trade launch base seed loaded$(RESET)"

demo-data: ## Load base seed + demo state (orderbooks, volume, demo user portfolio, settlements)
	@if [ -z "$(GATEWAY_DB_DSN)" ]; then \
		echo "$(BLUE)Error: GATEWAY_DB_DSN environment variable not set$(RESET)"; \
		exit 1; \
	fi
	@echo "$(BLUE)Loading demo seed (base + phases 0-5)...$(RESET)"
	WALLET_DB_DSN=$(GATEWAY_DB_DSN) WALLET_STORE_MODE=db go run ./cmd/seed -mode demo
	@echo "$(GREEN)✓ Demo seed loaded$(RESET)"

wipe-demo: ## Remove rows the demo seed added; leaves base seed intact
	@if [ -z "$(GATEWAY_DB_DSN)" ]; then \
		echo "$(BLUE)Error: GATEWAY_DB_DSN environment variable not set$(RESET)"; \
		exit 1; \
	fi
	@echo "$(BLUE)Wiping demo additions...$(RESET)"
	WALLET_DB_DSN=$(GATEWAY_DB_DSN) WALLET_STORE_MODE=db go run ./cmd/seed -mode wipe
	@echo "$(GREEN)✓ Demo wiped$(RESET)"

dev-setup: createdb migrate-up seed ## Complete development setup (create DB, migrate, seed)
	@echo "$(GREEN)✓ Development database setup complete!$(RESET)"
	@echo ""
	@echo "$(BLUE)Next steps:$(RESET)"
	@echo "1. Run tests: go test ./..."
	@echo "2. Start gateway: go run ./cmd/gateway"
	@echo "3. Check seed data: psql -d taptrade_predict -c \"SELECT COUNT(*) FROM punters;\""

verify-schema: ## Verify database schema
	@echo "$(BLUE)Verifying schema...$(RESET)"
	@psql $(GATEWAY_DB_DSN) -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;" 2>/dev/null || echo "$(BLUE)Database not accessible$(RESET)"

test-connection: ## Test database connection
	@echo "$(BLUE)Testing database connection...$(RESET)"
	@psql $(GATEWAY_DB_DSN) -c "SELECT version();" && echo "$(GREEN)✓ Connection successful$(RESET)" || echo "$(BLUE)Connection failed$(RESET)"

clean: ## Remove compiled migration tool
	@rm -f bin/migrate
	@echo "$(GREEN)✓ Cleaned build artifacts$(RESET)"

lint: ## Lint SQL migrations
	@echo "$(BLUE)Checking SQL migrations for basic syntax...$(RESET)"
	@for f in migrations/*.sql; do \
		if [ "$$f" != "migrations/seed.sql" ]; then \
			echo "  Checking $$f..."; \
			grep -q "-- +goose Up" "$$f" || echo "    $(BLUE)Warning: Missing -- +goose Up$(RESET)"; \
			grep -q "-- +goose Down" "$$f" || echo "    $(BLUE)Warning: Missing -- +goose Down$(RESET)"; \
		fi; \
	done
	@echo "$(GREEN)✓ Lint complete$(RESET)"

docs: ## Display migration documentation
	@echo "$(BLUE)Opening migration documentation...$(RESET)"
	@cat MIGRATIONS.md | less || cat MIGRATIONS.md

help-env: ## Display environment variable help
	@echo "$(BLUE)Environment Variable Setup$(RESET)"
	@echo ""
	@echo "Required:"
	@echo "  GATEWAY_DB_DSN       PostgreSQL connection string"
	@echo "                       Example: postgres://user:pass@localhost:5432/taptrade_predict"
	@echo ""
	@echo "Optional:"
	@echo "  GATEWAY_DB_DRIVER    Database driver (default: postgres)"
	@echo "  MIGRATIONS_DIR       Path to migrations (auto-detected)"
	@echo ""
	@echo "Setup:"
	@echo "  export GATEWAY_DB_DSN=\"postgres://postgres:postgres@localhost:5432/taptrade_predict\""
	@echo "  make dev-setup"

.SILENT: help help-env
