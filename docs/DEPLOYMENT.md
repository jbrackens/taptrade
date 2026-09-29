# Deployment

> **Scope:** how Tap Trade is deployed today — the demo box, the pipeline that
> deploys it, the configuration a production or staging deployment must carry,
> network hardening, backups and known gaps.
> **Authoritative for:** deployment topology, the deploy pipeline, required
> production/staging configuration, edge hardening. **Not for:** every
> environment variable → [ENVIRONMENT.md](ENVIRONMENT.md); CI workflows other
> than the deploy → [ENVIRONMENT.md](ENVIRONMENT.md#5-ci--githubworkflows);
> on-call and routine procedures → [`stack/ops/RUNBOOK.md`](../apps/taptrade-platform/ops/RUNBOOK.md).
> **Last verified:** 2026-09-29 at commit `4924a670` — `.github/workflows/deploy-demo.yml`,
> `stack/docker-compose.yml`, `stack/docker-compose.demo.yml`, `stack/Caddyfile`,
> `gateway/cmd/gateway/main.go` (`validateGatewayRuntimeConfig`), and a live smoke
> check of the demo after the deploy of `4924a670`. Updated the same day for the
> hardening change (CI gate, release retention and rollback, backups, two-factor
> key); the backup and restore figures come from a drill run on the box that day.

Consolidated on 2026-09-29 from `apps/taptrade-platform/DEPLOYMENT.md` (moved
here) and `docs/DEMO_DEPLOYMENT.md` (archived).

There is one deployment: the **demo** at `demo.99rtp.io` (player) and
`office.99rtp.io` (back office). There is no staging tier and no production
pipeline ([Gaps](#gaps)). The Kubernetes/Cloud-SQL guide that earlier docs
described was never real infrastructure — it was inherited from pre-fork docs
and removed in the P2-04 cleanup ([ADR-0011](adr/0011-deployment-topology-single-branch-hetzner-compose.md)).

## Topology (demo)

```
Cloudflare (orange-cloud proxy, Full Strict TLS)
       │
       ▼
GitHub Actions ──SSH──▶ Hetzner box (:80/:443 firewalled to Cloudflare ranges)
                          ├─ Caddy            TLS (Let's Encrypt), basic_auth on the office host,
                          │                   strips client geo headers, stamps X-Edge-Auth,
                          │                   serves /images/markets/* from the market_images volume
                          ├─ predict_gateway  :18080  (bound to 127.0.0.1; only Caddy reaches it)
                          ├─ predict_auth     :18081
                          ├─ predict_player   :3000
                          ├─ predict_office   :3001
                          ├─ postgres 16      (named volume — survives rsync --delete)
                          ├─ redis            (auth sessions + rate limiters; not a read cache)
                          ├─ db-backup        6h pg_dump sidecar (started by the deploy)
                          └─ rocketchat (+mongo)  community chat, iframed under /chat
```

Compose files: `stack/docker-compose.yml` (base: postgres, redis, gateway,
auth) plus `stack/docker-compose.demo.yml` (overlay: rocketchat-mongo,
rocketchat, player, office, caddy, db-backup, and the demo's feature and
activation env). Both pin fixed `container_name` values (`predict_postgres`,
`predict_gateway`, …), so one stack runs per box. The box's compose project is
pinned to `phoenix` in `/opt/phoenix/.env`.

**The demo runs with `ENVIRONMENT` unset**, deliberately (comment in
`docker-compose.demo.yml`). None of the production/staging boot rules below
apply to it. It also sets `BETA_COMPLIANCE_MODE=permissive` with
`COMPLIANCE_STARTUP_ACK=true`, and leaves `GEO_GATE_ENABLED` and
`GEO_TRUSTED_PROXY_MODE` commented out, so the geo and trading-KYC gates are
off on the demo.

**Discrepancy:** the header comment of `docker-compose.demo.yml` still says
deploys trigger on pushes to `feat/binary-exchange-engine`. The workflow
triggers on `main` (P2-06 consolidation). Tracked as [TD-028](TECH_DEBT.md#d-delivery-and-operations).

## The deploy pipeline (`deploy-demo.yml`)

Triggers: a push to `main` touching `apps/taptrade-platform/**` or the workflow
file, or a manual `workflow_dispatch`. Runs are serialized
(`concurrency: deploy-demo`, no cancel-in-progress), 90-minute timeout.

0. **Wait for CI** (`ci-gate` job) — `scripts/wait-for-ci.sh` polls the
   GitHub runs for the pushed commit and fails unless every one of `test.yml`,
   `guard-money-path.yml`, `guard-db-migrations.yml` and
   `guard-openapi-drift.yml` that ran on it succeeded (the guards are
   path-filtered, so only the ones triggered are required). The `deploy` job
   `needs` it. A manual dispatch waits for CI on the dispatched commit the same way.
1. **Guard branch** — `DEMO_DEPLOY_BRANCH_ALLOWLIST=main`; any other ref aborts.
   The release id is the first 12 characters of the commit.
2. **Free disk space** on the box: prune release images beyond the newest
   three (`stack/scripts/releases.sh prune`), then stopped containers, unused
   networks and dangling images only (not `system prune -a`, which would delete
   the retained releases); fails if the disk is still over 90% full.
3. **Rsync** `apps/taptrade-platform/` to `/opt/phoenix/` (`rsync -az --delete`;
   Postgres data and market images live on named volumes, so `--delete` cannot
   touch them).
4. **Patch the Caddyfile** `basic_auth` hash on the box from
   `BACKOFFICE_BASIC_AUTH_HASH` (the hash never lives in source control;
   hard-fails if unset).
5. **Write the box `.env`** for compose substitution: `OPENROUTER_API_KEY`,
   `EDGE_SHARED_SECRET` (hard-fails if unset), the social OAuth client pairs,
   chat URLs, and two values **generated fresh on every deploy**
   (`ROCKETCHAT_ADMIN_PASSWORD`, `STORE_WEBHOOK_SECRET`, via `openssl rand`).
   Then **append `AUTH_MFA_ENCRYPTION_KEY`** from `/var/lib/taptrade/mfa.key`,
   which is generated once (32 random bytes, base64, mode 600) and never
   rotated by the deploy: it decrypts every stored authenticator secret
   ([Two-factor key](#two-factor-key)).
6. **Build auth on the runner**, load it on the box (also tagged
   `taptrade-auth:rel-<id>`), recreate it, poll `:18081/healthz` (abort on
   failure). Every image the deploy loads gets the same `rel-<id>` tag
   (front ends: `app-rel-<id>`, `office-rel-<id>`) for [rollback](#rollback).
7. **Build gateway**, **apply migrations**, recreate gateway, poll
   `:18080/healthz` (abort on failure). Migrations run before the new binary
   starts, so the schema is always ahead of the code.
8. **Start Rocket.Chat**, set public read, provision the global room.
9. **Build and recreate the player**; optional catalog sync and market
   translation run here only when requested (`workflow_dispatch` inputs
   `sync_catalog` / `translate_markets`, or `[sync-catalog]` /
   `[translate-markets]` in the commit message).
10. **Health-check the player** and smoke the live routes.
11. **Build and recreate the office**; check the container state on the box
    (basic_auth blocks an external probe).
12. **Force-recreate Caddy** (a plain reload keeps the old Caddyfile inode after
    rsync).
13. **Start the `db-backup` sidecar** (`up -d --no-deps db-backup`; a no-op
    when it is already running).
14. **Record the release** in `/var/lib/taptrade/releases.log`
    (`releases.sh record <id>`), which rollback and pruning read.
15. **Re-firewall the origin** — `stack/scripts/security/cf-firewall.sh`
    restricts `:80/:443` to Cloudflare ranges and syncs its systemd unit; the
    run fails if the firewall is not verifiably in force.

There is no `migrate` compose service. The gateway image ships `/app/migrate`
and `/app/migrations/`, and migrations run through it:

```bash
docker compose -f docker-compose.yml -f docker-compose.demo.yml \
  run --rm --no-deps \
    -e MIGRATIONS_DIR=/app/migrations \
    -e MIGRATE_ALLOW_MISSING=true \
    gateway ./migrate up
```

`migrate-demo.yml` (manual) runs a single goose command against the box DB;
`demo-ops.yml` (manual) is box diagnostics.

### Repository secrets the deploy uses

Names only. Values live in GitHub repository secrets and are never committed.

| Secret | Purpose |
|---|---|
| `DEPLOY_SSH_KEY` | SSH key for the deploy user on the box |
| `BACKOFFICE_BASIC_AUTH_HASH` | bcrypt hash for the office host's `basic_auth` |
| `GITHUB_TOKEN` (built in) | Lets the `ci-gate` job read the commit's workflow runs (`actions: read`) |
| `EDGE_SHARED_SECRET` | Token Caddy stamps as `X-Edge-Auth`; shared with the gateway |
| `OPENROUTER_API_KEY` | Optional — AI market drafting (office) and market translation (gateway) |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`, `DISCORD_…`, `FACEBOOK_…`, `TWITTER_…`, `REDDIT_…`, `TIKTOK_OAUTH_CLIENT_KEY` / `_SECRET` | Optional — each social provider stays off until its pair is set ([SOCIAL_LOGIN_SETUP.md](SOCIAL_LOGIN_SETUP.md)) |

### Smoke checks

| Check | Expected |
|---|---|
| `curl -s https://demo.99rtp.io/api/v1/status` | `pointMode: non_redeemable_points`, `legacyMoneyRoutes: disabled` |
| `https://demo.99rtp.io/` and `/predict/` | 200 |
| `https://demo.99rtp.io/api/v1/markets?limit=1` | 200 |
| `https://demo.99rtp.io/cashier/` | 404 (flag off) |
| `https://office.99rtp.io/` | 401 Basic without operator credentials |

Verified 2026-09-29 against the deploy of `4924a670` (all rows except the
office check, which was not run).

### Rollback

`rollback-demo.yml` (manual, same concurrency group as the deploy, so it never
overlaps one) restores an earlier release's **images**:

1. Actions → *Roll back demo (Hetzner)* → *Run workflow*. Leave `release`
   empty for the release before the current one, or give a 12-character commit
   prefix from the release log. Keep `dry_run` on first: it prints the log and
   the image swaps without changing anything.
2. Run it again with `dry_run` off. It re-points the running tags
   (`taptrade-auth:latest`, `taptrade-gateway:latest`,
   `predict-frontend:app-slim`, `predict-frontend:office-slim`) at that
   release's `rel-` images, recreates auth, gateway, player and office, waits
   for both health checks, logs `rollback-from-<id>`, and smoke-checks the
   player API.

On the box the same thing is `bash stack/scripts/releases.sh list` /
`rollback [id]` (`DRY_RUN=1` to preview), run from `/opt/phoenix`.

Limits: only the newest three releases are kept; **migrations are not
reverted** and the rsynced config (compose files, Caddyfile) stays at the
current version. If the bad release applied a migration the older code can't
run against, fix forward instead. Rollback does not survive the next push to
`main`, which deploys again — revert the commit as well.

Not yet exercised on the demo: the first deploy after this change records the
first release, so a rollback needs two deploys of history.

## Required production/staging configuration

The gateway **fails closed at boot** (`gateway/cmd/gateway/main.go`,
`validateGatewayRuntimeConfig`, plus `alphacashier.ValidateRuntimeConfig` and
`store.ValidateRuntimeConfig`) when `ENVIRONMENT` is `production` or
`staging`. Such a deployment must set:

| Variable | Requirement |
|---|---|
| `GATEWAY_DB_DSN` / `WALLET_DB_DSN` | No dev credentials (`:localdev@` is refused) |
| `GEO_GATE_ENABLED` | `true` |
| `GEO_ALLOWED_COUNTRIES` | Non-empty ISO-3166 allowlist |
| `GEO_TRUSTED_PROXY_MODE` + `EDGE_SHARED_SECRET` | With require-mode on, the secret is mandatory; set the same value on Caddy |
| `KYC_ENFORCEMENT`, `KYC_REQUIRED_FOR_TRADING` | Each `true`, or explicitly acknowledged off with `<VAR>_ACK_DISABLED=true` |
| `PROVIDER_OPS_AUDIT_STORE_MODE` | Must resolve to DB-backed (`db`, or unset with a valid `GATEWAY_DB_DSN`) |
| `BETA_COMPLIANCE_MODE=permissive` | Refused in production; staging only with `COMPLIANCE_STARTUP_ACK=true` (which also waives the geo/KYC rows above) |
| `STORE_WEBHOOK_SECRET` | Required (and not the dev placeholder) when `STORE_ENABLED=true` |
| Auth session store | `auth` exits at boot unless `AUTH_SESSION_REDIS_URL`, `AUTH_REDIS_URL` or `AUTH_SESSION_STORE_FILE` is set |
| `AUTH_MFA_ENABLED` + `AUTH_MFA_ENCRYPTION_KEY` | Two-factor sign-in is off unless `AUTH_MFA_ENABLED=true`. Once it is on, staff two-factor is required by default in production/staging and `auth` exits without the key; switching staff off there takes `AUTH_ADMIN_MFA_REQUIRED=false` **and** `AUTH_ADMIN_MFA_OFF_ACKNOWLEDGED=true`. Turn it on before a production launch ([TD-005](TECH_DEBT.md#b-authentication-and-access-control)) |
| `ENVIRONMENT` | Must be one of `local`, `dev`, `development`, `test`, `demo`, `staging`, `production` or unset; gateway and auth refuse anything else at boot (a typo such as `prod` used to run as development) |

Refused outright in production/staging (each is a boot error):

| Variable | Why |
|---|---|
| `TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED=true` | Launch exposes no deposit, withdrawal, cashier, crypto or provider-callback routes ([ADR-0010](adr/0010-points-only-non-redeemable-launch-boundary.md)) |
| `ALPHA_CASHIER_ENABLED=true` | Same boundary; the alpha cashier stays dark ([ADR-0012](adr/0012-cashier-merged-dark-behind-flags.md)) |
| `CRYPTO_RPC_URL`, `CRYPTO_ASSET_CONTRACT`, `CRYPTO_DEPOSIT_ADDRESS_SOURCE` | They configured the legacy crypto rail, removed 2026-09-29; the refusal stays so a stale config fails loudly |
| `GATEWAY_ALLOW_ADMIN_ANON=true`, `GATEWAY_AUTH_ENABLED=false` | Dev-only bypasses |

**Discrepancy — `JWT_SECRET`.** The earlier version of this guide listed
`JWT_SECRET` as required on auth, and both compose files demand it
(`${JWT_SECRET:?}`). No Go code reads it: sessions are opaque random tokens
(`auth/internal/http/handlers.go`), and `deploy-demo.yml` passes
`JWT_SECRET=unused` only to satisfy the compose guard ([TD-025](TECH_DEBT.md#d-delivery-and-operations)).

## Network hardening

- **Cloudflare in front.** DNS is proxied (orange-cloud); SSL/TLS mode is
  Full (Strict), so Cloudflare validates the origin certificate. ACME HTTP-01
  challenges pass through to Caddy.
- **Origin firewall.** `:80/:443` accept only Cloudflare ranges
  (`cf-firewall.sh`, iptables, re-applied every deploy and restored at boot by
  `cf-firewall.service`). This stops direct-to-origin requests that could forge
  `CF-IPCountry`. Caddy's `trusted_proxies` lists the same ranges.
- **Loopback binding.** The gateway publishes `127.0.0.1:18080`; Caddy is the
  only ingress.
- **Edge auth (SEC-03).** Caddy strips any client-sent `X-Edge-Auth` and stamps
  its own from `EDGE_SHARED_SECRET`. The gateway checks it only under
  `GEO_TRUSTED_PROXY_MODE=require` (`gateway/internal/http/pretrade_gate.go`).
  **On the demo that mode is off**, so the protection there is the firewall and
  the loopback bind, not the header check. (The archived demo note said the
  gateway denies direct requests; that holds only with require-mode on.)

## Backups and restore

`stack/ops/backup/` has `backup-db.sh` (logical `pg_dump`, gzipped,
retention-pruned) and `restore-db.sh` (refuses to restore over the live DB
without `--force`). The demo's `db-backup` sidecar loops every
`BACKUP_INTERVAL_SECONDS` (6h) and writes to the `phoenix_db_backups` volume.
Until 2026-09-29 it had never been started on the demo, so there were no
backups; every deploy now starts it. Details:
[`stack/ops/backup/README.md`](../apps/taptrade-platform/ops/backup/README.md).

**Offsite: not configured.** When `BACKUP_OFFSITE_CMD` is set, the sidecar
runs it with each new dump's path; it is empty on the demo, so a lost box
loses the database ([TD-020](TECH_DEBT.md#d-delivery-and-operations), waiting
on the destination decision [D-13](TASKS.md#needs-a-decision)).

**Restore drill, 2026-09-29, on the demo box:** a one-off dump
(`docker compose run --rm --no-deps db-backup sh /ops/backup-db.sh`) took 12 s
and produced 75 MB; restoring it into a scratch database
(`predict_restore_drill`) took 22 s. Row counts matched the live database on
every table checked (80 tables; 6,408 markets, 896 events, 5 punters, 242,151
orders, 864 trades, 127 positions, 594 settlements, 6,673 imports). The scratch
database was dropped. The restore procedure is in the
[runbook](../apps/taptrade-platform/ops/RUNBOOK.md).

### Two-factor key

`/var/lib/taptrade/mfa.key` is the `AUTH_MFA_ENCRYPTION_KEY` that encrypts
authenticator secrets in `auth_mfa_totp`. Two-factor sign-in is off on the demo
(`AUTH_MFA_ENABLED` unset), so nothing uses the key yet; the deploy keeps it
in `.env` so the feature can be turned on without a new key. It is deliberately **not** in the
database dumps. Restoring a dump onto a box without the same key leaves every
enrollment unreadable: staff sign-in then answers 503 until each account is
cleared with `auth mfa-reset` ([runbook](../apps/taptrade-platform/ops/RUNBOOK.md))
and enrolls again. Keep a copy of the key somewhere other than the dumps
(part of [D-13](TASKS.md#needs-a-decision)).

## Gaps

No staging tier, no infrastructure-as-code, no production pipeline, and
backups that stay on the box. Tracked in [TECH_DEBT.md](TECH_DEBT.md) and
[TASKS.md](TASKS.md) (originally P3-08 in
[`audit/IMPROVEMENT_PLAN.md`](audit/IMPROVEMENT_PLAN.md)).
