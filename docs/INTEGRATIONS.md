# Integrations

> **Scope:** every external service, provider, API, webhook, background worker
> and scheduled job — what it is for, what data crosses, where it lives, how it
> is configured, how failure is handled, and whether it is live.
> **Authoritative for:** integration behaviour and failure handling. **Not
> for:** every environment variable's default → [ENVIRONMENT.md](ENVIRONMENT.md);
> the deploy pipeline → [DEPLOYMENT.md](DEPLOYMENT.md); how to register social
> login apps → [SOCIAL_LOGIN_SETUP.md](SOCIAL_LOGIN_SETUP.md).
> **Last verified:** 2026-09-29 at commit `4924a670` — the source files cited in
> each section, `stack/docker-compose.demo.yml` and `.github/workflows/deploy-demo.yml`.
> **No external call was made in this review:** "Live on demo" means the code
> path is enabled by the demo configuration, not that the upstream was observed
> responding.

Status: **Live on demo** (enabled by the demo configuration), **Built, off**
(implemented, disabled by default and on the demo), **Dormant** (behind the
money boundary), **Stub** / **Not implemented**. Keys are listed by name only.

## Summary

| Integration | Direction | Status |
|---|---|---|
| Polymarket, Kalshi, Manifold market import | Out (HTTP) | Live on demo (every 15 min) |
| Polymarket sports / Kalshi live feeds | Out (WebSocket) | Polymarket live on demo; Kalshi built, off |
| Wikidata, Wikimedia Commons, Openverse, App Store (covers) | Out (HTTP) | Live on demo (Openverse off without a token) |
| OpenRouter — market translation (gateway) | Out (HTTP) | Built; runs only on manual trigger |
| OpenRouter / Anthropic — AI market drafting (office) | Out (HTTP) | Live on demo when `OPENROUTER_API_KEY` is set |
| Social OAuth (Google, Facebook, Discord, X, TikTok, Reddit) | Out (OAuth) | Built; each off until credentials are set |
| SMTP email | Out | Built, off (logs instead) |
| KYC identity vendor | Out | Not implemented (manual review only) |
| CoinGecko settlement feed | Out (HTTP) | Built, off |
| Point store provider and webhook | In (webhook) | Live on demo with the simulated `demo` provider; Stripe not implemented |
| Outbound partner webhooks | Out (HTTP) | Built and running; no endpoints registered |
| Legacy payments webhook | In | Dormant |
| Alpha cashier EVM RPC | Out (JSON-RPC) | Dormant |
| Redis | Internal | Live (auth sessions, rate limits); WS backbone off |
| OpenTelemetry, Prometheus, Grafana | Out / scrape | Metrics endpoints live; no exporter or scraper configured |
| Cloudflare and Caddy edge | In | Live |
| Rocket.Chat | Internal service | Live on demo (community chat) |
| Backups | Internal | Built; opt-in on the demo |
| GitHub Actions | CI/CD | Live |

## Market data

### Market import — Polymarket, Kalshi, Manifold

- **What:** imports market metadata, prices, outcomes and resolution status into
  `imported_markets`, then promotes them into Tap Trade events and markets
  (`gateway/internal/discover/sync.go` `Sync`, `promote.go` `Promote`).
- **Sources:** Polymarket Gamma API (`fetch_polymarket.go`, 100-row pages,
  60/40 open/closed budget, resolved when the winning price ≥ 0.95); Kalshi
  `/events` with nested markets and a persisted rotating cursor (`fetch_kalshi.go`,
  skips multivariate parlay events); Manifold binary markets
  (`fetch_manifold.go`; `MKT`/`CANCEL` resolutions go to manual settlement).
- **When:** an in-process worker (`startHourlyMarketSyncWorker`,
  `gateway/internal/http/handlers.go`) runs at boot and then every
  `MARKET_SYNC_INTERVAL` (default 1 h; the demo sets 15 min). The one-shot CLI
  `gateway/cmd/sync-markets` does the same on demand; the deploy runs it only
  when asked (`sync_catalog` input or `[sync-catalog]` in the commit message).
- **Keys:** `MARKET_SYNC_ENABLED` (on unless `false`), `MARKET_SYNC_INTERVAL`,
  `MARKET_SYNC_{POLYMARKET,KALSHI,MANIFOLD}_LIMIT` (200/200/100),
  `MARKET_IMAGE_PUBLIC_ROOT`.
- **Failure handling:** at most 10 requests per source per run
  (`ratelimit.go`); 429s retried three times honouring `Retry-After`, other
  errors not retried; 15 s timeout; 8 MB body cap; a 60 s per-URL cache. If
  every enabled source fails, the run aborts before mutating anything, so a bad
  run cannot mass-retire imports. Rows that mention an upstream venue by name
  are dropped. Titles are de-duplicated at 0.85 similarity.

### Live markets feed

- **What:** a live/in-play snapshot for `GET /api/v1/live-markets`, held in
  memory (up to `LIVE_MARKETS_MAX_EVENTS`, default 100), not persisted
  (`gateway/internal/livemarkets`).
- **Sources:** the Polymarket sports WebSocket (`POLYMARKET_SPORTS_WS_URL`),
  always started unless `LIVE_MARKETS_ENABLED=false`; Kalshi market-data
  WebSocket with RSA-PSS signed headers, only with
  `AUTHENTICATED_MARKET_DATA_ENABLED=true` and `KALSHI_API_KEY_ID` plus a
  private key (decision record: `gateway/LIVE_MARKETS_DECISION.md`).
- **Failure handling:** reconnect forever with backoff (1 s doubling to 30 s);
  the provider's status becomes `error` or `stale` in the snapshot. The player
  `/live` page is behind `NEXT_PUBLIC_FEATURE_LIVE_MARKETS` (off).

### Settlement sources

- `AutoSettler` (60 s) asks each closed market's source adapter for a result
  (`gateway/internal/prediction/workers/settler.go`, `feed/`). Registered by
  default: `admin-manual` and `manual`, which never settle — markets are settled
  by admins.
- **CoinGecko** (`feed/crypto.go`, `price_above`/`price_below` on spot price,
  10 s timeout, SHA-256 of the payload kept as attestation) registers only with
  `TAPTRADE_LEGACY_ASSET_PRICE_FEEDS_ENABLED=true`. Built, off.
- **Failure handling:** a failed fetch is recorded; after three in a row the
  source is marked unhealthy (one error log per episode) and its markets stay
  closed for manual resolution. Health: `GET /api/v1/admin/resolution-sources`.

## Market covers

- **What:** chooses an image for imported markets that lack a usable one
  (`gateway/internal/discover/covers.go`, `cover_shape.go`; decision
  [ADR-0013](adr/0013-market-cover-sourcing-and-serving.md)).
- **Order of preference:**
  1. Sports/esports "A vs B" titles get a generated two-colour matchup tile (no
     network call; team crests are never fetched).
  2. **Wikidata → Wikimedia Commons**: the subject named in the title is looked
     up on Wikidata; only an exact label match (or an alias of 5+ characters),
     of a class that suits the market's category, is accepted. The image comes
     from that class's property on Commons under a free licence: flag (P41) for
     countries and US states; photo (P18) for people with 3+ sitelinks,
     products and places; for organisations and software, a small icon
     (P8972/P2910), else a roughly square logo/seal/monogram (P154/P158/P1543,
     aspect ≤ 1.6), else their photo. **Brands** (an entity with a logo but no
     recognised class) get a square mark or nothing — no photo fallback
     (`groupBrand`). Wide wordmarks are never used.
  3. **Openverse** topic photo, only with `OPENVERSE_API_TOKEN` (the anonymous
     API refuses server calls); CC0/BY/BY-SA/PDM only, at least 320×320.
  4. **App Store icon**, last resort only: when no free image exists for any
     subject, a company's own most-rated app icon, if the developer name names
     the company and the app has 5,000+ ratings (credited as the developer's
     trademark).
- **Licences:** CC0, CC BY, CC BY-SA, public-domain marks and permissive
  software licences; anything NC or ND is refused. Raw SVGs are never used.
- **When:** inside each market sync — new imports first, then a backfill of
  bare open imports (open markets first, then contested prices, then volume),
  each row retried at most once per 30 days. `COVER_ENTITY_LOOKUPS_PER_RUN`
  (60, half held back for the backfill), `COVER_BACKFILL_PER_RUN` (200),
  `MARKET_COVER_RESOLVER=false` disables.
- **Serving:** files are written under fresh content-hashed names to the
  `market_images` volume and served by Caddy at `/images/markets/*`, not by
  Next.js (which only serves `public/` files present at start-up). Credits ship
  on the market payload, on the market page and at `/attributions`.
- **Sweeps of upstream images:** a shared-image sweep, and a wide-graphic
  sweep (`cover_shape.go`: a source image wider than 1.25:1 that is a flat
  graphic and would lose more than 10% of its marks to the thumbnail's centre
  crop). They judge only upstream images, mark what they drop `swept` so a sync
  never re-applies it, and the backfill resolves those rows in the same run.
  Clearing `cover_checked_at` on a resolver cover (as migration 063 did)
  re-resolves or removes it, whatever the market's status.
- **Operator override:** back office **Market Images**
  (`GET /api/v1/admin/markets/images`, `PATCH /api/v1/admin/market-images/{id}`);
  `image_origin='manual'` is never overwritten.
- **Failure handling:** 12 s timeout for all four services. A network error is
  not cached, so the next run retries; a genuine miss is cached for 30 days;
  running out of lookup budget leaves the row unchecked for the next run.
- **Before changing the resolver:** run `COVER_LIVE_TEST=titles.json go test
  ./internal/discover -run Live` against real board titles and review the picks.

## AI services

### Market translation (gateway) — built, manual trigger

- **What:** translates market titles and descriptions into the other five
  locales (`gateway/internal/markettranslate`).
- **Provider:** an OpenAI-compatible chat-completions API; on the demo,
  OpenRouter with `openai/gpt-4o-mini` (`AI_TRANSLATION_*`, falling back to
  `AI_ROUTINE_*`/`AI_HARD_*` and `OPENROUTER_API_KEY`).
- **When:** never on a request path. Only `gateway/cmd/translate-markets`, or
  `cmd/sync-markets -translate` (`AI_MARKET_TRANSLATION_ENABLED`, off by
  default); the deploy runs it only on request (`translate_markets` input or
  `[translate-markets]` in the commit message).
- **Failure handling:** 45 s timeout, no retry; a failed or malformed market is
  counted and skipped (the market stays untranslated). Translations are cached
  per market and locale by a hash of the English source, so unchanged copy is
  never re-sent.

### AI market drafting (office) — live on demo when keyed

- **What:** turns a pasted article into 3–7 draft binary markets with
  resolution criteria, sources and risk flags (`office/lib/ai/`,
  `office/app/api/market-bot/draft/route.ts`). Every draft requires human review;
  nothing is published automatically.
- **Provider:** the Vercel AI SDK with a "hard" tier. The code defaults to
  Anthropic (`claude-sonnet-4-6`); **the demo overrides it** to an
  OpenAI-compatible endpoint on OpenRouter (`openai/gpt-4o`, `AI_HARD_*` =
  `OPENROUTER_API_KEY`). The "routine" tier is configured but no longer called.
- **Budget:** before each call the office reserves budget from the gateway
  (`POST /api/v1/admin/ai-budget/reserve`): per admin, `AI_DRAFT_RATE_PER_MIN`
  (10) and `AI_DRAFT_DAILY_TOKEN_CAP` (2,000,000 tokens), counted from the
  database. If the gateway is unreachable the draft is refused.
- **Safety:** a canary token in the system prompt discards any draft that
  echoes it (prompt-injection tripwire); an advisory injection scan; URL fetch
  (`AI_URL_FETCH_*`) is off at launch.
- **Failure handling:** a model error returns 502 with no retry; the duplicate
  check fails open per candidate with a visible warning.
- **Unverified:** never run end to end against a real model; cost is not
  recorded ([TD-046](TECH_DEBT.md#h-ai-market-drafting)).

## Identity and messaging

### Social OAuth (auth service) — built, each off until configured

- Google (`openid email profile`), Facebook (`email public_profile`), Discord
  (`identify email`), X/Twitter (`tweet.read users.read`, PKCE), TikTok
  (`user.info.basic`), Reddit (`identity`) — `auth/internal/http/oauth.go`.
- **Keys:** `<PROVIDER>_OAUTH_CLIENT_ID` (TikTok: `_CLIENT_KEY`), `_CLIENT_SECRET`,
  `_REDIRECT_URI`; callbacks at `/api/v1/auth/oauth/<provider>/callback`.
  Unconfigured providers answer "not configured".
- **Account linking:** identities are keyed by `(provider, subject)`. Only a
  provider-verified email links to an existing account (Google, Discord);
  Facebook's email is treated as unverified; X, TikTok and Reddit return no
  email. Everything else gets an isolated account.
- **Failure handling:** 10 s timeout, no retry; strict `state` (and PKCE)
  cookies; responses capped at 1 MB. The auth service never creates wallets.
- **Setup guide:** [SOCIAL_LOGIN_SETUP.md](SOCIAL_LOGIN_SETUP.md) (matches the
  code, including scopes and callback paths).

### Email (SMTP) — built, off

- `gateway/internal/notify` uses Go's `net/smtp` when `SMTP_HOST` is set;
  otherwise it logs (`LogNotifier`). Keys: `SMTP_HOST`, `SMTP_PORT` (587),
  `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `NOTIFY_RESOLUTION_TO`.
- **Sends:** an ops notice when a market settles or voids (to
  `NOTIFY_RESOLUTION_TO`) and one email per settlement payout recipient.
- **Failure handling:** best effort — a 10 s timeout, logged and dropped, no
  queue or retry. The in-app bell (`user_notifications`) is the durable record.

### KYC identity vendor — not implemented

`gateway/internal/compliance/idv.go` defines a provider seam. The default
`ManualReviewProvider` always returns `pending` for an admin to decide; any
named vendor (`KYC_IDV_PROVIDER`, `KYC_IDV_API_KEY`) errors because no client
exists, and the error is downgraded to `pending` — nothing is ever
auto-approved by a vendor. Submissions carry document metadata only, no files.
Separate risk: when the KYC database is unavailable the gateway falls back to
an auto-approving mock ([TD-006](TECH_DEBT.md#b-authentication-and-access-control)).

### Rocket.Chat — live on demo

The demo runs Rocket.Chat 8.4 (with MongoDB) as a community room iframed under
`/chat`; the deploy provisions public read access and a global room. The player
app's chat shell is behind `NEXT_PUBLIC_FEATURE_CHAT` (on for the demo) and has
no in-app chat transport (STUBBED in the manifest).

## Webhooks

### Point store provider and webhook — live on demo (simulated)

- `STORE_PROVIDER=demo` is the only implementation: an in-process simulator,
  no outbound calls, where the player picks the outcome on a demo checkout
  screen. `stripe` refuses boot until implemented (`gateway/internal/store/config.go`).
- `POST /api/v1/store/webhook` (public only while `STORE_ENABLED=true`) verifies
  `X-Store-Signature` with `gateway/internal/webhookauth`: HMAC-SHA256 over the
  raw body, and a timestamp **inside the signed body** within five minutes.
  An empty secret fails closed (503); a bad signature is 401.
- **Idempotency:** the purchase row is locked (`SELECT … FOR UPDATE`), terminal
  states are no-ops on replay, and wallet credits are keyed
  `store_purchase:<id>` (and `:bonus`). Rejected webhooks for a known purchase
  are recorded as evidence. Contract: [`STORE_AND_PAYMENTS.md`](../STORE_AND_PAYMENTS.md).

### Outbound partner webhooks — running, none registered

- Events `order.filled`, `market.settled`, `market.voided`
  (`gateway/internal/webhooks`). `withdrawal.status` is declared but never sent.
- Enqueued after commit into `webhook_deliveries` (fire-and-forget — an enqueue
  failure is logged, never blocks trading); a dispatcher polls every 5 s in
  batches of 50.
- Signed `X-TNA-Signature: sha256=<hex>` over the body, with `X-TNA-Event` and
  `X-TNA-Delivery-Id`; per-endpoint secrets `whsec_…` shown once.
- **Failure handling:** 10 s timeout; 5xx, 408, 429 and network errors retry
  with backoff from 2 s to 5 min, up to 6 attempts, then dead-letter; other 4xx
  dead-letter immediately. SSRF protection refuses private, loopback and
  metadata addresses at registration and at dial time, re-checking redirects.
- Endpoints are registered by operators (`/api/v1/admin/webhook-endpoints`,
  `partners:*`). None are seeded.

### Legacy payments webhook — dormant

`POST /api/v1/payments/webhook` (`X-Payments-Signature`, the same
`webhookauth` scheme, `PAYMENTS_WEBHOOK_SECRET` read per request) exists only
with `TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED=true`. No real payment processor is
integrated; the rail is a database state machine with a mock fallback.
`/v1/provider-callbacks/` is listed as a public prefix under the same flag but
has no handler ([TD-035](TECH_DEBT.md#f-gateway-api-and-real-time)).

### Alpha cashier EVM RPC — dormant

`gateway/internal/alphacashier/evm.go` wraps go-ethereum's JSON-RPC client
(`ALPHA_CASHIER_RPC_URL`; default chain Base, USDC). Used to verify ERC-20
transfers, read balances and decimals, and scan treasury `Transfer` logs.
The deposit scanner retries RPC calls three times with backoff and never
advances its cursor past a failed range; a wrong `ALPHA_CASHIER_TOKEN_DECIMALS`
leaves the service without chain access. Everything here is behind the money
boundary ([ADR-0012](adr/0012-cashier-merged-dark-behind-flags.md)).

## Background workers and scheduled jobs

All in-process in the gateway (`gateway/internal/http/handlers.go`), started
only when a database is configured. There are no cron jobs or systemd timers.

| Worker | Interval | Job | Flag | On error |
|---|---|---|---|---|
| `MarketCloser` | 30 s | Close markets past `close_at` (compare-and-swap) | always | Log; next tick |
| `AutoSettler` | 60 s | Finalize elapsed proposals; fetch results from sources | always | Log; unhealthy sources fall back to manual |
| `RestingOrderExpirer` | 60 s | Finalize resting orders on closed markets; release holds | always | Log; next tick |
| Settlement resumer | at boot, then 60 s | Finish payout batches interrupted by a crash | always | Idempotent retry |
| Wallet reservation expirer | 60 s | Expire stale holds | always | Log |
| `Reconciler` | 15 min | Per-market collateral drift check; metrics and error log on drift | always | Per-market log; continues |
| `SMM` market maker | 30 s (default) | Two-sided resting orders on every open order-book market as `user-bot`, through the normal order path | `SMM_ENABLED` (on for the demo) | Per-market warning |
| Leaderboard recomputer | 5 min | Recompute snapshots | DB-backed loyalty wired | Log |
| Market sync (with covers) | 1 h (demo 15 min) | Import, promote, backfill covers | `MARKET_SYNC_ENABLED` | Records a failed sync status; next run |
| Webhook dispatcher | 5 s | Deliver outbound webhooks | DB wired | Retry, then dead-letter |
| Alpha reorg watcher | 5 min | Re-verify credited deposits; freeze reorged ones | alpha cashier enabled | Dormant |
| Alpha deposit scanner | 15 s | Match treasury transfers to open deposit intents | `ALPHA_CASHIER_DEPOSIT_SCANNER_ENABLED` | Dormant |

Outside the gateway: the demo's `db-backup` sidecar loops a `pg_dump` every six
hours when started ([DEPLOYMENT.md](DEPLOYMENT.md#backup--restore)), and
`cf-firewall.service` re-applies the origin firewall at boot.

## Platform services

### Redis

| Use | Where | Keys | On Redis failure |
|---|---|---|---|
| Gateway rate limiting (public reads, 120 rpm default) | `gateway/cmd/gateway/main.go`, `platform-mod/transport/httpx/ratelimit.go` | `REDIS_URL`, `GATEWAY_RATELIMIT_*`, `GATEWAY_TRUSTED_PROXY_CIDRS` | Allows the request (fails open); without `REDIS_URL`, per-process limits |
| WebSocket fan-out across replicas | `gateway/internal/ws/backbone.go` | `WS_BACKBONE=redis`, `REDIS_URL` | Local delivery continues; `/readyz` shows `degraded`. Off by default and on the demo |
| Auth sessions | `auth/internal/http/redis_session_store.go` | `AUTH_SESSION_REDIS_URL` or `AUTH_REDIS_URL` | Errors surface to the caller; production refuses boot without a session store |
| Login rate limit and lockout | `auth/internal/http/redis_rate_limiter.go` | `AUTH_REDIS_URL` | Fails open ([TD-012](TECH_DEBT.md#b-authentication-and-access-control)) |

Redis is not used as a read cache anywhere.

### Observability

- **Metrics:** `/metrics` and `/metrics/prediction` are public, hand-written
  Prometheus text (no client library). Dashboards and ten alert rules live in
  `stack/ops/grafana/` and `stack/ops/prometheus/`, but **no Prometheus or
  Grafana runs** in either compose file ([TD-023](TECH_DEBT.md#d-delivery-and-operations)).
- **Tracing:** `gateway/internal/tracing` wraps each request in a span and sets
  `X-Trace-Id`. It exports only with `OTEL_EXPORTER_OTLP_ENDPOINT` (gRPC,
  hard-coded plaintext) or `OTEL_TRACES_EXPORTER=stdout`; neither is set
  anywhere, so tracing is a no-op. The auth service has no tracing.

### Edge — Cloudflare and Caddy

Cloudflare proxies DNS (Full Strict TLS); the origin accepts only Cloudflare
ranges; Caddy trusts `X-Forwarded-For` only from those ranges, strips a forged
`X-Geo-Country`, forwards `CF-IPCountry`, and stamps `X-Edge-Auth` from
`EDGE_SHARED_SECRET`. The gateway checks that header only under
`GEO_TRUSTED_PROXY_MODE=require`, which the demo does not set. Details and the
production requirements: [DEPLOYMENT.md](DEPLOYMENT.md#network-hardening).

### GitHub Actions

Ten workflows; triggers and what each runs are in
[ENVIRONMENT.md](ENVIRONMENT.md#5-ci--githubworkflows). The deploy uses the
repository secrets listed in [DEPLOYMENT.md](DEPLOYMENT.md#repository-secrets-the-deploy-uses).

## Dormant Node cashier services

`services/cashier-api` (a Postgres repository behind HTTP handlers, run only by
its tests), `services/bridge-watcher` (one fixture-driven adapter; the design
targets Relay, Symbiosis, LI.FI and deBridge, none integrated), `services/relayer`
(policy documents only) and `packages/cashier-sdk` (types and validators, no
network code). None has a `package.json` entry point, container or deploy step;
`make cashier-check` keeps them internally consistent
([ADR-0010](adr/0010-points-only-non-redeemable-launch-boundary.md)).
