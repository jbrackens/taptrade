# Tap Trade — Deployment

> Describes the deployment **as it actually runs today**: a single Hetzner box
> running docker-compose behind Caddy, driven by GitHub Actions over SSH. The
> previous Kubernetes/Cloud-SQL/Memorystore guide was fiction; it was retired in
> the P2-04 cleanup and survives only in git history (commit `3ec79f0a`).

## Topology (demo)

```
Cloudflare (orange-cloud proxy, Full Strict TLS)
       │
       ▼
GitHub Actions ──SSH──▶ Hetzner box (2 vCPU, :80/:443 firewalled to CF IPs)
                          ├─ Caddy            TLS (LE), basic_auth on office host,
                          │                   strips client geo headers, stamps X-Edge-Auth
                          ├─ predict_gateway  :18080  (bind to 127.0.0.1; only Caddy reaches it)
                          ├─ predict_auth     :18081
                          ├─ predict_player   :3000
                          ├─ predict_office   :3001
                          ├─ postgres 16      (named docker volume — survives rsync --delete)
                          ├─ redis            (auth sessions + rate limiter; not a
                          │                    gateway read cache)
                          ├─ db-backup        6h pg_dump sidecar (opt-in)
                          └─ rocketchat       community feed
```

Compose files: `docker-compose.yml` (base: postgres, redis, gateway, auth) +
`docker-compose.demo.yml` (overlay: rocketchat-mongo, rocketchat, player, office,
caddy, db-backup, plus SMM and feature-flag env). The demo overlay **requires**
`JWT_SECRET` (`${JWT_SECRET:?}`) and sets production-shape env. Both files pin
fixed `container_name` values (`predict_postgres`, `predict_gateway`, …), so only
one stack can run on a box.

## CI/CD

Ten GitHub Actions workflows, all in the **repository-root** `.github/workflows/`
(GitHub does not read the `apps/taptrade-platform/.github/workflows/` copies):

| Workflow | Trigger | What it does |
|---|---|---|
| `deploy-demo.yml` | push to `main` touching `apps/taptrade-platform/**`, or manual | the deploy pipeline below |
| `migrate-demo.yml` | manual (`workflow_dispatch`, goose command) | runs goose against the box DB |
| `demo-ops.yml` | manual | read-only box maintenance (catalog-sync diagnosis, gateway restart) |
| `test.yml` | push/PR → `main` | external-symlink guard, cashier guard scripts, FE Biome + unit tests, Go `build` + `test -race` for platform/gateway/auth |
| `e2e.yml` | PR → `main` (frontend/go-platform paths), or manual | Playwright journey suite against a freshly seeded stack |
| `frontend-build.yml` | PR touching `frontend/**` | clean-clone install, typecheck, unit tests, production build |
| `guard-conventions.yml` | PR → `main`, or manual | convention gate (G-01) |
| `guard-db-migrations.yml` | push/PR → `main` | fresh-DB migration run (G-03) |
| `guard-money-path.yml` | push/PR → `main` | money-path test gate (G-02) |
| `guard-openapi-drift.yml` | push/PR → `main` | OpenAPI drift gate (G-04) |

The four `guard-*` workflows are what block a PR; expect them on any change.

### deploy-demo pipeline (the validated manual flow, automated)

1. **Guard branch** — `DEMO_DEPLOY_BRANCH_ALLOWLIST` is `main`; any other ref
   aborts the run.
2. **Rsync** `apps/taptrade-platform/` to `/opt/phoenix/` on the box
   (`rsync -az --delete`; Postgres data and market thumbnails live on named docker
   volumes, so `--delete` can't touch them). The box's compose project is pinned
   to `phoenix` via `/opt/phoenix/.env`.
3. **Patch Caddyfile** `basic_auth` hash on the box (the bcrypt hash never lives
   in source control — `${{ secrets.BACKOFFICE_BASIC_AUTH_HASH }}`).
4. **Inject secrets** into the box `.env` for compose substitution:
   `OPENROUTER_API_KEY` (AI drafting/translation) and `EDGE_SHARED_SECRET`
   (anti-spoof edge auth — hard-fails if missing).
5. **Build + recreate `auth`**, then health-check `:18081/healthz` (abort on fail).
6. **Build `gateway`**, **apply migrations**, **recreate `gateway`**, health-check
   `:18080/healthz` (abort on fail — built first so a Go failure aborts before any
   frontend is touched).
7. Build + recreate the player frontend, then health-check it and smoke the live
   player routes. Catalog sync and market translation are **opt-in**
   `workflow_dispatch` inputs (`sync_catalog`, `translate_markets`), default false.
8. Build + recreate the office frontend.
9. Start Rocket.Chat; configure public read; provision the global room.
10. **Recreate Caddy** (force-recreate to pick up new Caddyfile inode after rsync).
11. **Firewall origin** — `cf-firewall.sh` restricts `:80/:443` to Cloudflare IP
    ranges via iptables (re-runs every deploy to pick up new ranges).

There is **no `migrate` compose service**. The gateway image ships `/app/migrate`
and `/app/migrations/` alongside the gateway binary (see
`go-platform/services/gateway/Dockerfile`), and migrations run through it:

```bash
docker compose -f docker-compose.yml -f docker-compose.demo.yml \
  run --rm --no-deps \
    -e MIGRATIONS_DIR=/app/migrations \
    -e MIGRATE_ALLOW_MISSING=true \
    gateway ./migrate up
```

Goose is idempotent. Apply migrations before recreating the gateway so the schema
is always ahead of the binary.

## Required production/staging configuration

The gateway **fails closed at boot** (`cmd/gateway/main.go: validateGatewayRuntimeConfig`)
when `ENVIRONMENT` ∈ {production, staging}. You MUST set:

| Variable | Requirement |
|---|---|
| `GATEWAY_DB_DSN` / `WALLET_DB_DSN` | non-`localdev` credentials |
| `GEO_GATE_ENABLED` | `true` (mandatory) |
| `GEO_ALLOWED_COUNTRIES` | non-empty ISO-3166 allowlist (allowlist mode mandatory) |
| `GEO_TRUSTED_PROXY_MODE` + `EDGE_SHARED_SECRET` | if require-mode is on, the secret is mandatory (anti-spoof, SEC-03) — set the same value on the Caddy container as `{$EDGE_SHARED_SECRET}` |
| `KYC_ENFORCEMENT`, `KYC_REQUIRED_FOR_TRADING` | each `true` or explicitly `*_ACK_DISABLED=true` |
| `PROVIDER_OPS_AUDIT_STORE_MODE` | must resolve to DB-backed (`db`, or unset with a valid `GATEWAY_DB_DSN`) — the JSON-file fallback cannot be the audit system of record (P3-06) |
| `BETA_COMPLIANCE_MODE=permissive` | **invalid in production** (boot error); staging only with `COMPLIANCE_STARTUP_ACK=true` |
| `GATEWAY_ALLOW_ADMIN_ANON` | refused in prod/staging |
| `GATEWAY_AUTH_ENABLED=false` | refused in prod/staging |
| `JWT_SECRET` | required by the demo overlay (`${JWT_SECRET:?}`) — set on **auth** only; the gateway delegates token validation to auth |

Refused outright in production/staging (each is a boot error):

| Variable | Why |
|---|---|
| `TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED=true` | launch must not expose deposit, withdrawal, cashier, crypto or provider-callback routes |
| `ALPHA_CASHIER_ENABLED=true` | launch is points-only; there is no crypto cashier rail |
| `CRYPTO_RPC_URL`, `CRYPTO_ASSET_CONTRACT`, `CRYPTO_DEPOSIT_ADDRESS_SOURCE` | legacy custodial rail is prototype-only and must not be configured |

`PAYMENTS_WEBHOOK_SECRET` is validated (non-empty, not `whsec_local`) **only** when
the legacy money routes are enabled — which is itself refused in prod/staging — so
a points-only deployment does not need it to boot. The full env reference is the
commented block in `docker-compose.demo.yml` and `../../CLAUDE.md`; the boot rules
themselves live in `cmd/gateway/main.go: validateGatewayRuntimeConfig`.

## Network hardening (Cloudflare proxied mode)

DNS is proxied (orange-cloud) through Cloudflare. CF SSL/TLS is set to
**Full (Strict)** so CF validates the Let's Encrypt cert on the origin. ACME
HTTP-01 challenges pass through CF to Caddy.

- **Origin firewall:** `:80/:443` are restricted to Cloudflare IP ranges via
  `scripts/security/cf-firewall.sh` (iptables, runs automatically on every
  deploy). This prevents direct-to-origin requests that could forge
  `CF-IPCountry`.
- **Edge auth:** Caddy stamps `X-Edge-Auth` with `EDGE_SHARED_SECRET`; the
  gateway validates it under `GEO_TRUSTED_PROXY_MODE=require`. A request that
  bypasses Caddy lacks this header and is denied on money-path routes (SEC-03).
- **Loopback binding:** gateway port (`127.0.0.1:18080:18080`) is not reachable
  off-box — Caddy is the only ingress.

## Backup & restore

`ops/backup/` provides `backup-db.sh` (logical pg_dump, gzipped, retention) and
`restore-db.sh`. The demo compose ships a `db-backup` sidecar (6h loop, opt-in via
`docker compose … up -d db-backup`). **Local-only by default** — a local dump does
not survive box loss; set `BACKUP_OFFSITE_CMD` for true offsite. Run a restore
drill and document the RTO before relying on it (P3-08).

## Gaps (see audit workstream G / P3-08)

No staging tier (only the demo box), no IaC, no production pipeline, offsite
backup off by default, no tested restore drill. These are tracked in
`docs/audit/IMPROVEMENT_PLAN.md` P3-08.
