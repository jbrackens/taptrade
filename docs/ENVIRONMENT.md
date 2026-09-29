# Environment and commands

> **Scope:** Prerequisites, local setup, environment variables, build/lint/test commands, CI workflows, and demo deployment mechanics for the Tap Trade stack.
> **Authoritative for:** local dev setup, the env-var reference, CI pipeline shape, "how does a push become a deploy". **Not for:** system topology → [ARCHITECTURE.md](ARCHITECTURE.md); the deploy pipeline and production configuration → [DEPLOYMENT.md](DEPLOYMENT.md); what each integration does → [INTEGRATIONS.md](INTEGRATIONS.md); on-call procedures → [`stack/ops/RUNBOOK.md`](../apps/taptrade-platform/ops/RUNBOOK.md).
> **Last verified:** 2026-09-29 at commit `4924a670` — go.mod/go.work (gateway, auth, platform-mod), frontend `package.json`/`.nvmrc`, `stack/docker-compose.yml` + `docker-compose.demo.yml`, env-var grep (`os.Getenv`/`getenv(`/`envBool(`/`envString(`/`envInt64(`/`process.env.`) across gateway, auth, platform-mod, player, office, and the dormant Node cashier services, all nine `.github/workflows/*.yml` (ten since the 2026-09-29 hardening change added `rollback-demo.yml`, documented below with the new auth variables and scripts), gateway `Makefile`, root `Makefile`, `player/gate.sh`, `scripts/*`, and `stack/DEVELOPMENT.md` / `stack/DEPLOYMENT.md` / `docs/DEMO_DEPLOYMENT.md` / `stack/README.md` / `frontend/README.md` / `player/README.md` / `office/README.md` / root `README.md` / `CLAUDE.md` for conflicts.

## 1. Prerequisites

| Tool | Version | Source of truth |
|---|---|---|
| Go | 1.25.0 (module `go 1.25.0`) | `gateway/go.mod`, `auth/go.mod`, `go-platform/go.work` (`go 1.25.0`) |
| Go (shared module) | 1.24.0 | `platform-mod/go.mod` — one minor behind gateway/auth; both compile under the workspace's 1.25 toolchain |
| Node.js | >=20 (`.nvmrc` pins `20`) | `frontend/package.json` `engines.node`, `frontend/.nvmrc` |
| Yarn | >=1.22.22 <2 (yarn classic, not Berry) | `frontend/package.json` `engines.yarn` |
| Docker / Docker Compose | any recent Compose v2 (`docker compose`, not `docker-compose`) | `stack/docker-compose.yml`; no pinned version in the repo |
| Postgres client tools | optional, `psql` for direct inspection | `stack/DEVELOPMENT.md` |
| Redis client tools | optional, `redis-cli` for direct inspection | `stack/DEVELOPMENT.md` |

**Discrepancy (corrected in this review):** `frontend/README.md` "Requirements" said `Node v14.9.0`, `Yarn v1.17.3`, NVM, and an `npm login` step against a private registry (`lena-srv01.flipsports.net`) — all inherited from the pre-fork Taya Na Sportsbook codebase. The real requirement is Node ≥20 / Yarn 1.22.22–<2 per `package.json` `engines` and `.nvmrc`; the private registry is not used by this repo. That README now points here.

**Discrepancy:** CI (`test.yml`, `frontend-build.yml`) runs `actions/setup-node@v4` with `node-version: '22'`, one major above the `.nvmrc` value of `20`. Both satisfy `engines.node: ">=20"`, so this isn't a hard break, but a contributor matching `.nvmrc` locally is on a different Node minor than CI.

### Known macOS issue — brotli

If a frontend install crashes with a `libbrotlicommon.1.dylib` code-signature error (Apple Silicon):

```bash
codesign --force --sign - /opt/homebrew/lib/libbrotlicommon.1.dylib
codesign --force --sign - /opt/homebrew/lib/libbrotlidec.1.dylib
codesign --force --sign - /opt/homebrew/lib/libbrotlienc.1.dylib
```

On Intel Macs, use `/usr/local/lib/` instead. (CLAUDE.md "Known macOS Issue — Brotli".)

## 2. Local setup

Run `yarn install --frozen-lockfile` from `frontend/` (workspace root), never from a sub-package — CI does the same (`.github/workflows/test.yml`). An `npm install` from `player/` or `office/` hangs for hours because npm doesn't detect the up-tree workspace declaration (CLAUDE.md).

| Step | Command | Status |
|---|---|---|
| 1. Datastores | `cd stack/ && docker compose up -d postgres redis` | **Unverified** on 2026-09-29 (Docker was not started for this review); documented in the archived `DEVELOPMENT.md` and consistent with the compose files |
| 2. Migrate | `cd gateway/ && GATEWAY_DB_DSN=... MIGRATIONS_DIR="$(pwd)/migrations" go run ./cmd/migrate up` | **Unverified** (needs a database; not run on 2026-09-29) |
| 3. Seed | `make seed` (gateway Makefile, `-mode base`) | **Unverified** (connects to a DB) |
| 4. Run gateway | `GATEWAY_DB_DSN=... WALLET_DB_DSN=... WALLET_STORE_MODE=db go run ./cmd/gateway` | **Unverified** (starts a server) |
| 5. Run auth | `AUTH_STORE_MODE=db AUTH_DB_DSN=... AUTH_COOKIE_SECURE=false go run ./cmd/auth` | **Unverified** (starts a server) |
| 6. Install frontend | `cd frontend/ && yarn install --frozen-lockfile` | **Unverified** (network install; not run on 2026-09-29) |
| 7. Run player | `cd player/ && NEXT_PUBLIC_API_URL=http://localhost:18080 npx next dev --webpack -p 3010` | **Unverified** (starts a server) |
| 8. Run office | `cd office/ && npx next dev --webpack -p 3001` | **Unverified** (starts a server; office has no own `dev` script — port comes from the runner, per CLAUDE.md) |
| — | `go build ./...` in gateway, auth, platform-mod | **Verified 2026-09-29** — `go vet ./...` and `go test ./...` (incl. `-race` on `internal/alphacashier`/`internal/payments`) pass repo-wide |
| — | `go run ./cmd/migrate --help` | **Not run** — connects to a DB even for `--help` in some code paths; not run on 2026-09-29 |

`docker compose up -d postgres redis` alone starts only the datastores; `docker compose up -d postgres redis gateway auth` (per `stack/README.md`/`stack/DEVELOPMENT.md`) also builds and starts the gateway/auth containers, which is a different (containerized) path from steps 4–5 above (`go run` from source). CLAUDE.md's "Local drift notes" warn the **containerized** gateway image can go stale and start returning 400 on buys — prefer `go run ./cmd/gateway` from source when trading locally.

### Ports

| Service | Port | Notes |
|---|---|---|
| Player app (Next.js) | 3010 | Chosen because 3000 is taken by another project on the maintainer's machine; `.claude/launch.json` pins 3010. Player package's own `dev` script (`next dev --webpack`) has no `-p`, so it defaults to 3000 unless overridden |
| Backoffice (Next.js) | 3001 | Set by the dev runner (`-p 3001`), not by `package.json` |
| Go Gateway | 18080 | Code default; `PORT` overrides (`platform-mod/runtime/config.go` `LoadServiceConfig`) |
| Go Auth Service | 18081 | Same `PORT` mechanism |
| PostgreSQL (Docker) | 5434 → container 5432 | `postgres:16-alpine`; 5432 is a sibling sportsbook container, 5433 is swarmqa |
| Redis (Docker) | 6380 → container 6379 | `redis:7-alpine`; 6379 is the sportsbook container |

**Discrepancy:** `PORT` (read by `platform-mod/runtime/config.go`, shared by both services) is the actual port override for gateway and auth — CLAUDE.md's Environment Variables block says this explicitly ("`GATEWAY_PORT`/`AUTH_PORT` are NOT read"). `stack/docker-compose.yml` nonetheless sets `GATEWAY_PORT` and `AUTH_PORT`, not `PORT` — those two compose vars are inert; the containers boot on the code default (18080/18081) regardless. `stack/DEVELOPMENT.md` "Run gateway manually" / "Run auth manually" snippets also set `GATEWAY_PORT=18080` / `AUTH_PORT=18081`, which are likewise no-ops (harmless because they already match the default).

Demo image base: `stack/go-platform/services/{gateway,auth}/Dockerfile` build from `golang:1.25` and run on `alpine:3.19`. The frontend demo image (`frontend/docker/frontend.Dockerfile`) builds and runs on `node:22-bookworm-slim`.

## 3. Environment variables

Grepped from code (`os.Getenv`, `getenv(`, `envBool(`, `envString(`, `envInt64(`, `envInt(`, `envOr(`, `envDefault(`, `envFirst(`, `intEnvOr(`, `durationFromEnvSeconds`, `process.env.`/`process.env[…]`), not copied from docs. Placeholders only — no real secret values are shown. Boot-refusal rules below are `cmd/gateway/main.go` `validateGatewayRuntimeConfig` (+ `internal/alphacashier/config.go` `ValidateRuntimeConfig`, `internal/store/config.go` `ValidateRuntimeConfig`) unless noted otherwise; the production/staging requirements are summarised in [DEPLOYMENT.md](DEPLOYMENT.md#required-productionstaging-configuration).

### gateway — core, DB, networking

| Name | Default (code) | Purpose | Prod/staging constraint | Example |
|---|---|---|---|---|
| `GATEWAY_DB_DSN` | none (fatal if unset) | Primary Postgres DSN | Must not contain `:localdev@` | `postgres://predict:<secret>@db:5432/predict?sslmode=require` |
| `WALLET_DB_DSN` | none (fatal if unset) | Wallet's own DSN (same DB, separate env read) | Same `:localdev@` check | same shape as above |
| `WALLET_STORE_MODE` | `memory` | `db` \| `memory` | — | `db` |
| `PORT` | `18080` | HTTP listen port (via `platform-mod`) | — | `18080` |
| `GATEWAY_DB_DRIVER` | `postgres` | Read by `cmd/migrate` | — | `postgres` |
| `MIGRATIONS_DIR` | auto-detected | Read by `cmd/migrate` | — | `/app/migrations` |
| `REDIS_URL` | none (rate limiter falls back to in-process counters; WS fan-out needs it) | HTTP rate limiter backend + optional WS backbone | — | `redis://redis:6379/0` |
| `WS_BACKBONE` | unset (local, in-process) | `redis` fans WebSocket broadcasts across replicas over `REDIS_URL` | — | `redis` |
| `GATEWAY_RATELIMIT_RPM` | `120` | Requests/min per rate-limit key | — | `600` |
| `GATEWAY_RATELIMIT_ENABLED` | on | Kill switch | — | `true` |
| `GATEWAY_TRUSTED_PROXY_CIDRS` | unset (keys on `RemoteAddr`) | CIDRs to trust for XFF-based client keying | — | `10.0.0.0/8,192.168.0.0/16` |
| `GATEWAY_CORS_ORIGINS` | unset | CORS allowlist | — | `https://app.example.com` |
| `AUTH_SERVICE_URL` | none (fatal) | Where the gateway proxies auth | — | `http://auth:18081` |
| `GATEWAY_ALLOW_ADMIN_ANON` | off | Dev-only RBAC bypass | **Boot error** if `true` | `false` |
| `GATEWAY_AUTH_ENABLED` | on | `false` = dev-only auth kill switch | **Boot error** if `false` | `true` |
| `WALLET_DB_MAX_OPEN_CONNS` / `WALLET_DB_MAX_IDLE_CONNS` / `WALLET_DB_CONN_MAX_IDLE_TIME` / `WALLET_DB_CONN_MAX_LIFETIME` | driver defaults | Wallet DB pool tuning (no `GATEWAY_DB_MAX_*` equivalent exists — grep-confirmed) | — | `20` / `4` |
| `ENVIRONMENT` | unset | `production`/`staging` gates the boot-refusal rules below; `local`, `dev`, `development`, `test`, `demo` or unset (as on the demo box) skip them. Any other value is a **boot error** in gateway and auth (`platform-mod/runtime/environment.go`), so a typo such as `prod` can't run as development | — | `production` |
| `LOG_LEVEL` | info-shaped | `debug` enables debug logging (`platform-mod/logging/logger.go`; only checks for the literal string `debug`) | — | `debug` |

**Discrepancy ([TD-026](TECH_DEBT.md#d-delivery-and-operations)):** `GATEWAY_READ_REPO_MODE` is set in `stack/docker-compose.yml` (`GATEWAY_READ_REPO_MODE: "db"`) and referenced in `stack/README.md`'s prose ("store-mode gates … `GATEWAY_READ_REPO_MODE`") but **no Go code reads it** (confirmed by grep across gateway/auth/platform-mod) — it is inert, matching CLAUDE.md's own callout.

**Discrepancy ([TD-025](TECH_DEBT.md#d-delivery-and-operations)):** `JWT_SECRET` is required by both compose files (`stack/docker-compose.yml` sets a literal dev value; `docker-compose.demo.yml` uses `${JWT_SECRET:?export a strong JWT_SECRET before up}`, a hard compose-interpolation failure if unset) and `stack/DEPLOYMENT.md` lists it as a required prod/staging variable ("set on auth only; the gateway delegates token validation to auth"). **No Go code anywhere in the repo references `JWT_SECRET` or does JWT signing/verification** (grep for `jwt`/`JWT` across `gateway/`, `auth/`, `platform-mod/` returns nothing). Sessions are opaque `crypto/rand` tokens (`auth/internal/http/handlers.go` `newSession`, `session_store.go`, `redis_session_store.go`) — `office/README.md` independently confirms this: "the Go gateway … issues opaque `atk_...` bearer tokens rather than JWTs." `deploy-demo.yml` itself passes `JWT_SECRET=unused` to every `docker compose` invocation purely to satisfy the compose file's own interpolation guard. Treat `JWT_SECRET` as dead weight kept alive by the compose files, not a real secret.

### gateway — WebSocket, security headers

| Name | Default | Purpose |
|---|---|---|
| `WS_ALLOWED_ORIGINS` | unset | Origin allowlist for `/ws` upgrade |
| `EDGE_SHARED_SECRET` | unset | Anti-spoof token Caddy stamps as `X-Edge-Auth`; **required** in prod/staging when `GEO_TRUSTED_PROXY_MODE=require` (boot error otherwise) |
| `GEO_TRUSTED_PROXY_MODE` | unset | `require` = edge must always set the country header |
| `GEO_COUNTRY_HEADER` | `CF-IPCountry` (`internal/http/pretrade_gate.go` `geoCountryHeader`) | Header the edge writes with the caller's ISO country |

### gateway — launch boundary (points-only)

| Name | Default | Purpose | Prod/staging constraint |
|---|---|---|---|
| `TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED` | off | Mounts deposit/withdraw/cashier/crypto/provider-callback routes | **Boot error** if `true` |
| `ALPHA_CASHIER_ENABLED` | off | Alpha crypto cashier | **Boot error** if `true`; outside prod/staging also requires the flag above |
| `PAYMENTS_WEBHOOK_SECRET` | unset | HMAC secret for the legacy payments webhook | Validated (non-empty, not `whsec_local`) **only** when legacy routes are enabled |
| `CRYPTO_RPC_URL`, `CRYPTO_ASSET_CONTRACT`, `CRYPTO_DEPOSIT_ADDRESS_SOURCE` | must be unset | Configured the removed legacy crypto rail | **Boot error** if any non-empty in prod/staging (stale-config guard, not an activation knob) |
| `STARTER_GRANT_CENTS` | unset/0 (disabled) | One-time play-money faucet grant, in **Points** despite the name | — |
| `DAILY_CLAIM_CENTS` | unset/0 (disabled) | Daily claim, in Points | — |

### gateway — point store (`internal/store`)

| Name | Default | Purpose | Prod/staging constraint |
|---|---|---|---|
| `STORE_ENABLED` | off | Mounts `/api/v1/store/*` | — |
| `STORE_PROVIDER` | `demo` | Only `demo` is implemented | `stripe` is a reserved seam — **boot error** everywhere, not just prod/staging |
| `STORE_WEBHOOK_SECRET` | unset | HMAC secret for `/api/v1/store/webhook` | Required (non-empty, not `whsec_local`) when `STORE_ENABLED=true` and deployed. **Never copy a value from compose/CI** — the demo generates it fresh every deploy (`openssl rand -hex 24`, written to the box's `.env`, never committed) |
| `STORE_FIRST_PURCHASE_BONUS_BPS` | `0` (off) | Bonus points on a user's first completed purchase, basis points | Must parse as an integer 0–10000 |

### gateway — Alpha cashier (`internal/alphacashier`) — dormant, `make cashier-check` validated

Full knob set (all read via `envString(getenv,…)` / `envBool(getenv,…)` / `envInt64(getenv,…)` in `internal/alphacashier/config.go`): `ALPHA_CASHIER_ENABLED`, `_CHAIN_ID` (default not <=0, e.g. `8453`), `_CHAIN_NAME` (`base`), `_RPC_URL` (required when enabled — must be a valid http(s) URL), `_TOKEN_SYMBOL` (`USDC`), `_TOKEN_ADDRESS`/`_TREASURY_ADDRESS`/`_PAYOUT_ADDRESS` (must be valid EVM hex addresses), `_TOKEN_DECIMALS` (2–30), `_CONFIRMATIONS`, `_FINALITY_CONFIRMATIONS`, `_MIN_DEPOSIT_CENTS`/`_MAX_DEPOSIT_CENTS`/`_DAILY_DEPOSIT_LIMIT_CENTS` (min ≤ max ≤ daily), `_DEPOSIT_SCANNER_ENABLED`, `_WITHDRAWALS_ENABLED`, `_WITHDRAWAL_REVIEW_REQUIRED`, `_WITHDRAWAL_BROADCAST_ACK`, `_TWO_PERSON_WITHDRAWAL` + `_TWO_PERSON_WITHDRAWAL_ACK_DISABLED`, `_SCREENING_ENFORCEMENT` + `_SCREENING_ENFORCEMENT_ACK_DISABLED`, `_CHALLENGE_DOMAIN`. In prod/staging with the rail enabled: withdrawal review must stay required, screening enforcement must be on or explicitly acked off, and (if withdrawals are enabled) broadcast must be acked and two-person control must be on or explicitly acked off. `internal/http/demo_money_flags_test.go` fails CI if any of `TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED`, `ALPHA_CASHIER_ENABLED`, `ALPHA_CASHIER_WITHDRAWALS_ENABLED`, `ALPHA_CASHIER_DEPOSIT_SCANNER_ENABLED`, `ALPHA_CASHIER_RPC_URL`, the three `CRYPTO_*` vars, or `NEXT_PUBLIC_FEATURE_CASHIER_UI` are set on a live (non-comment) line in `docker-compose.demo.yml` or `deploy-demo.yml`.

### gateway — compliance / KYC / geo

| Name | Default | Purpose | Prod/staging constraint |
|---|---|---|---|
| `KYC_IDV_PROVIDER` | `''`/`manual` (back-office review) | Pluggable vendor IDV | needs `KYC_IDV_API_KEY` if set to a vendor |
| `KYC_ENFORCEMENT` | unset | Withdrawal-side KYC gate | Must be `true` or `KYC_ENFORCEMENT_ACK_DISABLED=true` |
| `KYC_REQUIRED_FOR_TRADING` | unset | Requires verified identity to trade | Must be `true` or `KYC_REQUIRED_FOR_TRADING_ACK_DISABLED=true` |
| `KYC_WITHDRAWAL_THRESHOLD_CENTS` | unset | Threshold above which withdrawal KYC triggers | — |
| `BETA_COMPLIANCE_MODE` (or `COMPLIANCE_MODE`) | unset | `permissive`/`permissive_beta`/`beta_permissive` disables jurisdiction + trading-KYC gates | **Invalid in production** outright; staging/demo only, and requires `COMPLIANCE_STARTUP_ACK=true` |
| `GEO_GATE_ENABLED` | off | Jurisdiction enforcement on the trading path | Required `true` in prod/staging unless acked-permissive |
| `GEO_ALLOWED_COUNTRIES` | empty | ISO-3166 allowlist | Required non-empty in prod/staging unless acked-permissive |
| `GEO_BLOCKED_COUNTRIES` | empty | Denylist | — |
| `COMPLIANCE_GEO_SANDBOX_MODE`/`_COUNTRY`/`_STATE`/`_CITY` | unset | Dev-only geo override | — |
| `PROVIDER_OPS_AUDIT_STORE_MODE` | unset | Must resolve DB-backed | **Boot error** in prod/staging if not `db`/unset-with-valid-DSN |
| `PROVIDER_OPS_AUDIT_DB_DSN`, `_DB_DRIVER`, `_FILE` | fall back to `GATEWAY_DB_DSN` | Audit trail persistence | — |

### gateway — SMM, bot API, social, other subsystems (grep-complete, one line each)

`SMM_ENABLED` (off) + `SMM_USER_ID`/`_TICK_INTERVAL`/`_DEPTH_CENTS`/`_HALF_SPREAD_CENTS`/`_MAX_DRIFT_CENTS`/`_MAX_MARKETS_PER_TICK`/`_MAX_POSITION_QTY` (synthetic market maker tuning, Points despite `_CENTS` names) · `BOT_KEYS_SELF_SERVE`, `BOT_RATE_LIMIT_PER_MIN`, `BOT_RATE_LIMIT_BURST` (bot API self-serve + throttling) · `SOCIAL_WRITE_RATE_LIMIT_PER_MIN`/`_BURST`, `SOCIAL_WRITE_IP_RATE_LIMIT_PER_MIN`/`_BURST`, `DISPUTE_RATE_LIMIT_PER_MIN`, `REWARD_DAILY_GRANT_LIMIT_CENTS`, `REWARD_DEVICE_HEADER`, `REWARD_DAILY_MAX_USERS_PER_DEVICE`/`_PER_IP` · `LIVE_MARKETS_ENABLED`, `LIVE_MARKETS_MAX_EVENTS` · `MARKET_SYNC_ENABLED`, `MARKET_SYNC_INTERVAL` (default hourly; demo sets `15m`), `MARKET_IMAGE_PUBLIC_ROOT`, `KALSHI_API_KEY_ID`/`_PRIVATE_KEY`/`_PRIVATE_KEY_PATH`, `KALSHI_WS_URL`, `POLYMARKET_SPORTS_WS_URL` (catalog sync sources) · `MARKET_COVER_RESOLVER` (on by default; `false` disables), `COVER_ENTITY_LOOKUPS_PER_RUN`, `COVER_BACKFILL_PER_RUN`, `COVER_TOPIC_LOOKUPS_PER_RUN`, `COVER_LIVE_TEST`, `OPENVERSE_API_TOKEN` (cover resolver, see CLAUDE.md's cover-resolver paragraph) · `AI_TRANSLATION_PROVIDER`/`_ENDPOINT`/`_MODEL`/`_API_KEY` (each also readable as `AI_ROUTINE_*`/`AI_HARD_*` via `envFirst`), `AI_TRANSLATION_LOCALES`, `_LIMIT`, `_JOB_TIMEOUT_SECONDS`, `_TIMEOUT_SECONDS`, `_MAX_DESCRIPTION_CHARS` · `AUTHENTICATED_MARKET_DATA_ENABLED`, `AI_MARKET_TRANSLATION_ENABLED` · `WALLET_LEDGER_FILE`, `LOYALTY_STATE_FILE`, `LEADERBOARD_STATE_FILE`, `SEED_FILE` (JSON-file fallback stores, dev only) · `SMTP_HOST`/`_USER`/`_PASSWORD`/`_FROM`/`_PORT` (default `587`), `NOTIFY_RESOLUTION_TO` (resolution emails; logs if `SMTP_HOST` unset) · `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_TRACES_EXPORTER` (tracing) · `MIGRATE_ALLOW_MISSING` (used by `cmd/migrate`, and by the demo deploy's `migrate up` step) · `RBAC_BOOTSTRAP_EMAIL`/`_PASSWORD`/`_NAME` (one-shot prod super-admin bootstrap, needs `GATEWAY_DB_DSN`) · `DEPOSIT_AUTO_APPROVE` (legacy-route dev convenience).

### auth service

| Name | Default | Purpose | Prod/staging constraint |
|---|---|---|---|
| `PORT` | `18081` | Listen port (via `platform-mod`) | — |
| `AUTH_STORE_MODE` | `memory` | `db` \| `memory` | — |
| `AUTH_DB_DSN` | none | Postgres DSN | — |
| `AUTH_COOKIE_SECURE` | secure unless `AUTH_COOKIE_SECURE=false` exactly | Cookie `Secure` flag | must be `true` behind TLS (`false` only for local HTTP) |
| `AUTH_REDIS_URL` | unset (in-process rate limiting) | Redis for rate limiting, and session fallback if `AUTH_SESSION_REDIS_URL` unset | — |
| `AUTH_SESSION_REDIS_URL` | falls back to `AUTH_REDIS_URL` | Preferred session-store backend (multi-instance) | — |
| `AUTH_SESSION_STORE_FILE` | unset | File-backed session store (single instance only) | Boot fatal if neither this nor a session Redis URL is set outside dev |
| `AUTH_ACCESS_TTL_SECONDS` | `900` (15m) | Access token TTL | — |
| `AUTH_REFRESH_TTL_SECONDS` | `86400` (24h) | Refresh token TTL | — |
| `AUTH_FRONTEND_URL` | `http://localhost:3000` | Where OAuth callbacks return the user; code default targets port 3000, not the actual local dev port 3010 — must be overridden locally | — |
| `AUTH_DEMO_USERNAME`/`_PASSWORD`, `AUTH_ADMIN_USERNAME`/`_PASSWORD`, `AUTH_DEMO_USER_ID` (default `u-1`), `AUTH_ADMIN_USER_ID` (default `user-admin`) | seeded defaults | Dev/demo bootstrap account overrides | — |
| `TRUSTED_PROXY_CIDRS` | unset | Proxy trust for auth's own rate limiter | — |
| `ENVIRONMENT` | unset | Same allowlist and production/staging gate as gateway | Unknown values are a boot error |
| `AUTH_ADMIN_MFA_REQUIRED` | on in production/staging, off elsewhere | Admin accounts must sign in with an authenticator code (`internal/http/mfa.go`); `true` on the demo | Turning it off needs `AUTH_ADMIN_MFA_OFF_ACKNOWLEDGED=true` too, or boot fails |
| `AUTH_MFA_ENCRYPTION_KEY` | unset (two-factor sign-in unavailable) | Base64 of 32 bytes; AES-256-GCM key for the stored TOTP secrets. Changing it makes every enrollment unreadable. Demo: `/var/lib/taptrade/mfa.key`, appended to `.env` by the deploy | Required while `AUTH_ADMIN_MFA_REQUIRED` is on (boot fails without it) |
| `AUTH_MFA_ISSUER` | `TapTrade` | Account label shown in authenticator apps | — |
| `{PROVIDER}_OAUTH_CLIENT_ID` + `_CLIENT_SECRET` + `_REDIRECT_URI` for `GOOGLE`, `FACEBOOK`, `DISCORD`, `TWITTER`, `REDDIT`; TikTok uses `TIKTOK_OAUTH_CLIENT_KEY` instead of `_CLIENT_ID` | each provider OFF until its client id is set | Social login; redirect URI defaults to `http://localhost:18081/api/v1/auth/oauth/<provider>/callback` | Google/Discord auto-link on verified email; Facebook is isolated (no verified-email claim); Twitter/TikTok/Reddit are always isolated (no email) |

Full OAuth reference with provider console links: `auth/.env.example`.

`AUTH_TEST_DB_DSN` (tests only) runs the Postgres-backed two-factor store and
`mfa-reset` tests in `auth/internal/http/mfa_test.go`; without it they skip.

### db-backup sidecar (demo)

Set in `docker-compose.demo.yml`, read by `stack/ops/backup/backup-db.sh`:
`BACKUP_DIR` (`/backups`, the `db_backups` volume), `BACKUP_RETENTION_DAYS` (`7`),
`BACKUP_INTERVAL_SECONDS` (`21600`, 6h) and `BACKUP_OFFSITE_CMD` (empty; when set,
it is run with the new dump's path as `$1`, e.g. an `aws s3 cp` command — the
destination is [D-13](TASKS.md#needs-a-decision)). Connection comes from the
standard `PG*` variables.

### player app (`NEXT_PUBLIC_*` unless noted)

| Name | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:18080` (`app/lib/api/client.ts`, `next.config.js`) | Gateway origin |
| `NEXT_PUBLIC_AUTH_URL` | `http://localhost:18081` (`app/api/auth/login/route.ts`) | Auth service origin |
| `NEXT_PUBLIC_WS_URL` | `ws://localhost:18080/ws` in dev, empty in prod build unless set | WebSocket origin |
| `NEXT_PUBLIC_FEATURE_RG` | off | Responsible-gambling pages |
| `NEXT_PUBLIC_FEATURE_KYC` | off | KYC surface on `/profile` |
| `NEXT_PUBLIC_FEATURE_LIMITS` | off | Deposit/stake/session limits tab |
| `NEXT_PUBLIC_FEATURE_CHAT` | off | Chat entry points, pairs with `NEXT_PUBLIC_CHAT_PUBLIC_URL` |
| `NEXT_PUBLIC_FEATURE_SOCIAL_AUTH` | off | Social login buttons (demo sets `true` at build time) |
| `NEXT_PUBLIC_FEATURE_LIVE_MARKETS` | off | `/live` route + nav entries |
| `NEXT_PUBLIC_DEMO_SYNTHETIC_CHARTS` | off | **Demo only** — synthetic-walk chart fallback; never set on a real-money deploy |
| `NEXT_PUBLIC_HERO_AMBIENT_VIDEO` | unset | Landing hero video asset path; empty = no video element |
| `NEXT_PUBLIC_FEATURE_CASHIER_UI` | off (`/cashier` 404s) | Gates the read-only Alpha cashier deposit card. CI-enforced never-set-on-demo (see `demo_money_flags_test.go` above) |
| `NEXT_PUBLIC_DISABLE_GEOLOCATION_CHECK` | unset | Dev override for client-side geo check |
| `NEXT_PUBLIC_SUPPORT_CHAT_URL` | unset | Support chat entry point |
| `NEXT_PUBLIC_BRAND_NAME`, `_LEGAL_ENTITY`, `_LEGAL_EMAIL`, `_PRIVACY_EMAIL`, `_SUPPORT_EMAIL` | unset | White-label brand strings |
| `AUTH_URL`, `GATEWAY_URL`, `SKIP_STACK_SMOKE` | fall back to `http://localhost:18081` / `http://localhost:18080`; smoke skips if gateway is down or `SKIP_STACK_SMOKE=1` | Not app runtime vars — only read by the integration test `app/__tests__/integration/stack-smoke.test.ts` (excluded from the plain `yarn test` glob) against a live local stack |

**Discrepancy:** none of `NEXT_PUBLIC_BRAND_*`, `NEXT_PUBLIC_DISABLE_GEOLOCATION_CHECK`, `NEXT_PUBLIC_SUPPORT_CHAT_URL`, `AUTH_URL`, `GATEWAY_URL`, or `SKIP_STACK_SMOKE` appear in CLAUDE.md's "Environment Variables" block, `player/README.md`'s "Configuration" section, or `stack/DEVELOPMENT.md` — all found only by grepping `app/`. `player/README.md`'s feature-flag list is otherwise accurate but incomplete (omits `NEXT_PUBLIC_DEMO_SYNTHETIC_CHARTS`, `NEXT_PUBLIC_HERO_AMBIENT_VIDEO`, `NEXT_PUBLIC_FEATURE_CASHIER_UI`).

### office (backoffice)

| Name | Default | Purpose | Prod/staging constraint |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:18080` fallback in `next.config.js` rewrites | Gateway origin for client + dev proxy rewrites | — |
| `NEXT_PUBLIC_AUTH_URL` | unset | Auth origin | — |
| `NEXT_PUBLIC_BRAND_NAME` | unset | White-label brand string | — |
| `GATEWAY_INTERNAL_URL` | falls back to `http://localhost:18080` (wrong inside a container — see `proxy.ts` comment) | Server-side (App Router route handlers) gateway URL, since `NEXT_PUBLIC_*` is browser-only | — |
| `AI_HARD_PROVIDER`/`_MODEL`/`_ENDPOINT`/`_API_KEY` | provider `anthropic`, model `claude-sonnet-4-6` | High-tier AI market drafting | Demo sets provider to `openai-compatible` to route through OpenRouter — the code default of `anthropic` would bypass it |
| `AI_ROUTINE_PROVIDER`/`_MODEL`/`_ENDPOINT`/`_API_KEY` | provider `openai-compatible`, model `qwen2.5`, endpoint `http://localhost:11434/v1` | Low-tier AI extraction | Demo overrides model to `openai/gpt-4o-mini` — OSS models on OpenRouter don't support strict structured output |
| `AI_URL_FETCH_ENABLED` / `AI_URL_FETCH_DISABLED` | fetch off | AI drafting URL-fetch capability | Left unset at launch (paste-text only) |
| `OFFICE_AUTH_GUARD_DISABLED` | off | Bypasses the proxy session gate (dev/backend-less escape hatch) | **Refused in production** (`instrumentation.ts` throws at boot) |
| `OFFICE_SESSION_VALIDATE_URL` | falls back to `GATEWAY_INTERNAL_URL` | Where the office's session-validating proxy calls out | — |

None of the office vars above are documented in CLAUDE.md, `office/README.md`, or `stack/DEVELOPMENT.md`; all found by grep. `office/README.md` does correctly note the `atk_...` opaque-token dev bypass (`isDevOpaqueToken`), which is a separate mechanism from `OFFICE_AUTH_GUARD_DISABLED`.

### Node cashier services — dormant, `make cashier-check` validated only

`services/cashier-api/` has no `package.json`/server entrypoint of its own — it is exercised only by `node --test services/cashier-api/test/*.test.mjs` inside `scripts/check-cashier-all.sh`. Its env surface (`src/bootstrap.mjs`, read as `env.X` not `process.env.X`, so grep the `env.` form): `CASHIER_REPOSITORY_BACKEND` (`postgres`/`memory`, inferred from `CASHIER_DATABASE_URL`/`DATABASE_URL` if unset), `CASHIER_DATABASE_URL` or `DATABASE_URL`, `CASHIER_DATABASE_POOL_MAX` (default `10`), `CASHIER_DATABASE_SSL`, `CASHIER_ALLOW_IN_MEMORY_REPOSITORY` (memory backend guard), `PGSSLMODE`, `DEPLOY_ENV`, `VERCEL_ENV`, `NODE_ENV`. `packages/cashier-sdk/` and `services/{bridge-watcher,relayer}` are pure TypeScript/docs/fixtures with **no runtime env reads at all** (bridge-watcher has one adapter file and docs; relayer is docs + fixtures only — no `src/`).

## 4. Commands

| Purpose | Command | Where | Status |
|---|---|---|---|
| Gateway build | `go build ./...` | `gateway/` | **Verified 2026-09-29** |
| Gateway/auth/platform-mod tests | `go test ./...` (`-race -count=1` in CI) | each module | **Verified 2026-09-29** — all pass, incl. `-race` on `internal/alphacashier`/`internal/payments` |
| Gateway format check | `gofmt -l .` | `gateway/` | **Verified 2026-09-29** — flags `internal/prediction/types.go` (pre-existing, not fixed) |
| Frontend lint (Biome) | `yarn lint:biome` (root `biome check .`) | `frontend/` | **Unverified** on 2026-09-29; app-scoped variant (`npx @biomejs/biome check packages/app/app`) is what CI actually runs in `frontend-tests` — the root `lint:biome` also covers `packages/office`, which has its own pending burn-down |
| Player typecheck | `yarn typecheck` (scoped, `scripts/typecheck-scoped.sh`) / `yarn typecheck:full` (`tsc --noEmit`) | `player/` | **Verified 2026-09-29** — `tsc --noEmit` clean |
| Player unit tests | `yarn test` (`tsx --test app/__tests__/*.test.ts`) | `player/` | **Verified 2026-09-29** — 600 pass / 0 fail |
| Player Playwright smoke | `yarn test:smoke` (`playwright test --config=./playwright.config.ts`, `testDir: tests/smoke`) | `player/` | **Unverified** — needs a running stack (docker compose + gateway + auth + `next dev -p 3010`), per the config's own prereq comment |
| Player Playwright visual | `npx playwright test --project=visual-desktop --project=visual-mobile[-authed]` (same config, `testDir: tests/visual`) | `player/` | **Unverified** — no dedicated `yarn` script; darwin-local, deliberately not run in CI (snapshots are platform-suffixed) |
| Repo-wide Playwright e2e | `npx playwright test` (`testDir: ./e2e`, projects `player-app`/`backoffice`) | `frontend/` | **Unverified** |
| Prediction-only e2e | `PREDICT_BASE_URL=http://localhost:8080 npx playwright test --config playwright.prediction.config.ts` (`testDir: ./e2e/prediction`) | `frontend/` | **Unverified** — default base URL is `:8080` (a Caddy-fronted local target), distinct from the raw gateway's `:18080` |
| Office tests | `test` = `vitest run`; `test:jest` = legacy Jest suite | `office/` | **Unverified** |
| `player/gate.sh` — 9 gates | see below | `player/` | **Verified 2026-09-29** — 8/9 pass, **Gate 5 (feature manifest) FAILS**: `FEATURE_MANIFEST.json` has 3 STUBBED entries |
| `office/gate.sh` — 7 gates | TS zero-errors, no sportsbook domain code, no `SAMPLE_`/`MOCK_` hardcoded data, no `@ts-nocheck`/`@ts-ignore`/`as any`, feature-manifest coverage, Pages/App Router coexistence (informational), Next build | `office/` | **Unverified** on 2026-09-29 |
| Migrations | `go run ./cmd/migrate {up,down,status,reset}` (goose under the hood); `MIGRATIONS_DIR` auto-detects if unset | `gateway/` | **Not run** — connects to a DB |
| Seeds | `make seed` (`-mode base`) / `make demo-data` (`-mode demo`) / `make wipe-demo` (`-mode wipe`) | `gateway/` Makefile | **Not run** — connects to a DB |
| Cashier dormant-tree validation | `make cashier-check` (root Makefile → `scripts/check-cashier-all.sh`) | repo root | **Verified 2026-09-29** — passes |
| Convention gate (G-01) | `scripts/check-conventions.sh` | repo root | **Verified 2026-09-29** — 0 bans |
| Deploy/branch guard | `scripts/agent-preflight.sh` | repo root | **Verified 2026-09-29** — asserts the checkout path, branch `main`, a clean tree and sync with `origin/main`; refuses to run with unpushed commits |

### `player/gate.sh` — the 9 gates

1. **TypeScript zero errors** — `npx tsc --noEmit --pretty`
2. **No phantom imports** — no `@taptrade-ui/design-system` under `app/` (webpack-hang risk)
3. **No mock classes in production code** — no `class Mock*` under `app/components/`, `app/lib/`
4. **No TODO/FIXME in critical paths** — informational only, never fails the gate
5. **Feature manifest coverage** — parses `FEATURE_MANIFEST.json`; fails if any entry is `STUBBED` or `MISSING`. **Failing on 2026-09-29**: 3 STUBBED entries ([TD-042](TECH_DEBT.md#g-player-app))
6. **No `@ts-nocheck` in app code** — excludes test files
7. **Pages/App Router conflict check** — no-op today (no `pages/` dir exists)
8. **Next.js build** — `next build --webpack` (must be `--webpack`; Next 16 defaults to Turbopack, which silently drops `next.config.js`'s webpack-specific config), `GATE_BUILD_TIMEOUT_SECS` overrides the 600s default
9. **Biome lint wall** — `npx @biomejs/biome check app` scoped to `app/` only (root `lint:biome` also covers `office/`, which isn't clean)

### Other scripts in `scripts/` (root) — one line each

`agent-preflight.sh` / `check-conventions.sh` — see above. `wait-for-ci.sh <sha> [owner/repo]` — waits for `test.yml` and whichever `guard-*` workflows ran on a commit and fails unless all succeeded; the deploy's `ci-gate` job runs it (needs `gh` and `jq`; `CI_WAIT_TIMEOUT_SECONDS`, `CI_WAIT_SETTLE_SECONDS`, `CI_WAIT_POLL_SECONDS` tune it). `check-cashier-all.sh` — orchestrates every cashier check below plus `go test ./cmd/gateway ./internal/payments ./internal/webhookauth`, the cashier-api Node tests, `packages/cashier-sdk` test+build, and `replay-cashier-mock-e2e.mjs`. `check-alpha-cashier-stage1.sh`, `check-cashier-guards.sh`, `check-cashier-frontend-types.sh` — shell guards over the gateway/app trees for the Alpha cashier and legacy cashier boundaries. `check-cashier-contracts.mjs`, `check-cashier-doc-links.mjs`, `check-cashier-launch-readiness.mjs`, `check-cashier-observability.mjs`, `check-cashier-openapi.mjs`, `check-cashier-provider-scenarios.mjs`, `check-cashier-schema.mjs`, `check-cashier-service-stubs.mjs`, `check-cashier-sql-artifacts.mjs` — Node assertion scripts validating the dormant `contracts/`, `services/cashier-api/`, `services/bridge-watcher/` trees stay internally consistent (schema ↔ rollback SQL, OpenAPI ↔ contract docs, provider fixture manifest, launch-readiness matrix). `check-no-external-symlinks.sh` — fails if the checkout has symlinks pointing outside the repo (clean-clone guard, runs in `test.yml`). `check-openapi-drift.sh` — G-04, `api/openapi.yaml` vs. gateway's registered routes. `check-trongrid-smoke.mjs` — live smoke check against TronGrid (`TRONGRID_API_KEY`), unrelated to the EVM-based Alpha cashier. `replay-cashier-mock-e2e.mjs` — replays a mock cashier flow end to end against fixtures. `seed-local-cashier-dev.sh` — seeds `services/cashier-api`'s local dev DB from `seeds/local_cashier_seed.sql`. `prediction_markets.py` — standalone Python fetcher pulling market metadata from Polymarket/Kalshi/other free APIs for demo-seed authoring; not wired into any Make target or CI job.

### `stack/scripts/` (i.e. `apps/taptrade-platform/scripts/`)

`security/cf-firewall.sh` (+ its `cf-firewall.service` systemd unit) — restricts the demo box's `:80`/`:443` to Cloudflare IP ranges via iptables; re-run automatically on every `deploy-demo.yml` run. `releases.sh {record|list|prune|rollback}` — runs on the box (piped over SSH by the workflows): records each deploy in `/var/lib/taptrade/releases.log`, prunes release images beyond `KEEP` (3), and rolls back to a kept release (`DRY_RUN=1` previews) — see [DEPLOYMENT.md](DEPLOYMENT.md#rollback).

## 5. CI — `.github/workflows/`

| Workflow | Trigger | What it runs | Secrets (by name) |
|---|---|---|---|
| `test.yml` ("Tests") | push/PR → `main` | 3 jobs: `cashier-guards` (symlink check + `check-cashier-all.sh`), `frontend-tests` (Biome on `packages/app/app`, `npm test` in player), `go-build-and-test` (`go build` + `go test -race -count=1` for platform-mod, gateway, auth) | none |
| `guard-money-path.yml` (G-02) | push/PR → `main` | Money-bearing packages under the race detector, twice, against a real Postgres service container (DB-backed tests self-skip with no DSN) | none |
| `guard-db-migrations.yml` (G-03) | push/PR → `main`, paths: migrations/`cmd/migrate`/`cmd/seed` | Fresh-DB goose migration run + seed against real Postgres 16 | none |
| `guard-openapi-drift.yml` (G-04) | push/PR → `main`, paths: `internal/http/**`, `api/openapi.yaml`, the check script | `scripts/check-openapi-drift.sh` — every documented path resolves to a route, no undocumented public route group | none |
| `guard-conventions.yml` (G-01) | `workflow_dispatch` + PR → `main` (PR trigger noted as a follow-up in-repo until proven green) | `scripts/check-conventions.sh` | none |
| `frontend-build.yml` | PR touching `frontend/**` | Clean-clone install, typecheck, unit test, production build of the player app (catches cross-repo symlinks / machine-local deps) | none |
| `e2e.yml` (P3-11) | PR → `main` (frontend/go-platform paths) + manual | Playwright journey suite against a freshly seeded stack (`next dev`, not a production build; desktop-only, sequential) | none |
| `deploy-demo.yml` | push to `main` touching `apps/taptrade-platform/**` + manual | The full deploy pipeline (§6), after a `ci-gate` job that waits for the commit's tests and guards (`scripts/wait-for-ci.sh`, built-in `GITHUB_TOKEN` with `actions: read`) | `DEPLOY_SSH_KEY`, `BACKOFFICE_BASIC_AUTH_HASH`, `EDGE_SHARED_SECRET`, `OPENROUTER_API_KEY`, `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET`, `FACEBOOK_OAUTH_CLIENT_ID`/`_SECRET`, `DISCORD_OAUTH_CLIENT_ID`/`_SECRET`, `TWITTER_OAUTH_CLIENT_ID`/`_SECRET`, `TIKTOK_OAUTH_CLIENT_KEY`/`_SECRET`, `REDDIT_OAUTH_CLIENT_ID`/`_SECRET` |
| `rollback-demo.yml` | manual only (`release`, `dry_run` inputs; shares the deploy's concurrency group) | Restores a kept release's images on the box and recreates auth, gateway, player and office ([DEPLOYMENT.md](DEPLOYMENT.md#rollback)) | `DEPLOY_SSH_KEY` |
| `migrate-demo.yml` | manual only (`workflow_dispatch`, goose command choice) | One-shot goose command against the box DB over SSH, in a throwaway golang container | `DEPLOY_SSH_KEY` |
| `demo-ops.yml` | manual only | Read-only box maintenance: diagnose catalog sync, optionally restart gateway | `DEPLOY_SSH_KEY` |

**Verified 2026-09-29:** on commits `71350057` and `4924a670`, Tests, G-02, G-03, G-04 and Deploy demo all reported `success`.

## 6. Deployment (demo)

A push to `main` that touches `apps/taptrade-platform/**` deploys the demo via
`.github/workflows/deploy-demo.yml`. The pipeline, the secrets it uses, the
smoke checks, the missing rollback procedure and the production/staging boot
rules are in [DEPLOYMENT.md](DEPLOYMENT.md). On-call procedures:
[`stack/ops/RUNBOOK.md`](../apps/taptrade-platform/ops/RUNBOOK.md) (incident scenarios, then routine procedures in Part 2).

## 7. Test credentials

This document does not list credentials. Local accounts are created by the seed
data (`gateway/seed-data/seed_prediction.sql`, `gateway/cmd/seed`) and by the
auth service's dev seeding (`auth/internal/http/handlers.go` `seedDBUsers`,
which runs in `AUTH_STORE_MODE=db` outside production/staging); the agent
instructions in [`CLAUDE.md`](../CLAUDE.md) name them.

**Unverified (carried from CLAUDE.md, observed 2026-07):** the demo account can
be rejected by a drifted local database, and a stale containerized gateway image
can return 400 on buys; running the gateway from source avoids the latter.
