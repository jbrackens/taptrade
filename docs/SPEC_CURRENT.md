# Current specification

> **Scope:** what Tap Trade does today — business rules, user flows, pages,
> permissions and API behaviour — and, just as explicitly, what is partial,
> stubbed, mocked, dormant or switched off.
> **Authoritative for:** implemented behaviour and its status. **Not for:**
> how it is built → [ARCHITECTURE.md](ARCHITECTURE.md); table shapes →
> [DATA_MODEL.md](DATA_MODEL.md); external services → [INTEGRATIONS.md](INTEGRATIONS.md);
> configuration → [ENVIRONMENT.md](ENVIRONMENT.md); economy-rule history →
> [taptrade-economy-rules.md](taptrade-economy-rules.md); store contract →
> [`../STORE_AND_PAYMENTS.md`](../STORE_AND_PAYMENTS.md).
> **Last verified:** 2026-09-29 at commit `4924a670`; bot keys, settlement
> overrides and two-factor sign-in updated the same day with the hardening
> change. Route registrations in
> `gateway/internal/**` and `gateway/cmd/gateway/main.go`, `gateway/internal/prediction`
> business logic, every `player/app/**/page.tsx` and `office/app/(dashboard)/**/page.tsx`,
> `player/FEATURE_MANIFEST.json`, `player/app/lib/features.ts`, and the demo
> compose file. No live user journey was exercised in this review except the
> demo smoke checks in [DEPLOYMENT.md](DEPLOYMENT.md#smoke-checks).

Status words: **Complete**, **Partial**, **Stub**, **Mock**, **Dormant** (built,
not mounted), **Flagged off** (built and mounted only when a flag is set). Other
markers are defined in [README.md](README.md#evidence-markers).

## 1. Product and launch boundary

Players trade binary YES/NO contracts on real-world outcomes. Prices are whole
Points from 1 to 99; YES + NO = 100; the YES price is the implied probability.
A correct contract settles at 100, an incorrect one at 0. Points are
non-redeemable play value. Since 2026-09-28 the player app shows the unit as
**Clout** ("44 Clout", `player/app/lib/points.ts` `CURRENCY_NAME`); loyalty
progress is **XP**. APIs, the ledger and code keep the name Points (`*Points`
fields, `unit: "PTS"`). `player/app/__tests__/clout-currency.test.ts` pins the
display names.

**The points-only launch boundary** ([ADR-0010](adr/0010-points-only-non-redeemable-launch-boundary.md)):

- `GET /api/v1/status` reports `pointMode: "non_redeemable_points"` and
  `legacyMoneyRoutes: enabled|disabled` (`gateway/internal/http/handlers.go`).
- Deposit, withdrawal, payments-webhook, provider-callback and alpha-cashier
  routes are **not registered** unless `TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED=true`
  (`gateway/internal/http/launch_boundary.go`). Unmounting is structural, not a
  request-time check.
- In production/staging that flag, `ALPHA_CASHIER_ENABLED`, and any value in
  `CRYPTO_RPC_URL` / `CRYPTO_ASSET_CONTRACT` / `CRYPTO_DEPOSIT_ADDRESS_SOURCE`
  refuse boot (`validateGatewayRuntimeConfig`; full list in
  [DEPLOYMENT.md](DEPLOYMENT.md#required-productionstaging-configuration)).
- Admin-authored user-facing copy is scrubbed of money and wagering vocabulary
  before save (`gateway/internal/compliance/launch_safety.go`
  `HasLaunchProhibitedCopy`); the player app mirrors the redaction.
- Points enter a wallet only through: the starter grant, the daily claim, free
  point packs, missions/streaks, loyalty and bonus grants, admin credits,
  settlement payouts, and the point store ([§2.6](#26-how-points-enter-a-wallet)).

On the demo: `ENVIRONMENT` is unset, `BETA_COMPLIANCE_MODE=permissive`, the
geo and KYC gates are off, `SMM_ENABLED=true`, `STORE_ENABLED=true` with the
`demo` provider, and the player build sets `NEXT_PUBLIC_FEATURE_CHAT`,
`NEXT_PUBLIC_FEATURE_SOCIAL_AUTH` and `NEXT_PUBLIC_DEMO_SYNTHETIC_CHARTS`.

## 2. Business rules

### 2.1 Pricing and fees — Complete

- Price bounds 1–99 (`gateway/internal/prediction/accounting.go`
  `MinTickPricePoints`, `MaxTickPricePoints`, `ParPricePoints = 100`), enforced
  at order entry (`exchange.go` `ValidatePlaceOrderRequest`,
  `ErrPriceBandViolation`) and in the schema (`CHECK (yes_price_points +
  no_price_points = 100)`).
- New markets start at 50/50 (`service.go` `CreateMarket`); each fill re-derives
  both prices from one number (`exchange.go` `markTradePrice`).
- **Taker fee** (`accounting.go` `CalculateTakerFeePoints`):
  `floor(fee_bps × price × (100 − price) × quantity / 1,000,000)`, default
  100 bps (`DefaultTakerFeeBps`), peaking at 0.25 per contract at price 50.
  Makers pay nothing. Matches the economy rules. **Open question:** the owner
  has a parked choice between this and a flat 1% ([D-5](TASKS.md#needs-a-decision)).

### 2.2 Orders and matching — Complete (one option Partial)

- Types `market` and `limit`; actions `buy` and `sell`; time in force `gtc`,
  `ioc`, `fok` (`gateway/internal/prediction/types.go`). Market orders require
  `notionalCapPoints` and never rest. `post_only` rejects an order that would
  take (`ErrPostOnlyWouldTake`). FOK that cannot fill fully is rejected; IOC
  cancels its remainder; GTC limit orders rest.
- Self-match: `cancel_taker`, `cancel_maker`, `cancel_both`. **Partial:**
  `cancel_both` behaves like `cancel_taker` (`exchange.go` `applySelfMatch`,
  [TD-039](TECH_DEBT.md#f-gateway-api-and-real-time)).
- Matching is a central limit order book with price-time priority
  (`ExchangeEngine.BuildPlan`, a pure function over a snapshot taken under a
  per-market advisory lock). Two crossing paths: secondary transfer between
  holders, and **complementary issuance** — a YES buy at *p* matches a NO buy
  at 100 − *p*, minting a pair backed by 100 in the market's collateral pool.
  There are no naked shorts; a sell needs an owned position.
- Buy orders **reserve** their cost (`HoldWithTx`, reference
  `prediction_order:<id>`); fills capture from the hold; cancels and expiries
  release the rest. Reservation lifetime: a GTC order's market close time plus
  one hour, otherwise 24 hours (`service.go` `reservationTTL`). Resting sells
  lock shares on the position (`reserved_quantity`).
- AMM execution is retired: orders on `execution_mode='amm'` markets are
  refused; the LMSR code only quotes legacy markets ([ADR-0008](adr/0008-clob-execution-replaces-amm.md)).
- Order placement runs the responsible-play stake check and the compliance
  gate (geo, KYC) first ([§2.9](#29-responsible-play-and-compliance)).

### 2.3 Market lifecycle — Complete

- States and transitions are enforced by `gateway/internal/prediction/lifecycle.go`
  (diagram in [DATA_MODEL.md](DATA_MODEL.md#marketevent-lifecycle-state-machines)).
  Only `open` markets trade.
- `MarketCloser` closes markets past `close_at` every 30 s, with a
  compare-and-swap so it never overwrites an admin's concurrent halt or void.
- **Resting orders do not expire by age.** `RestingOrderExpirer` (every 60 s)
  finalizes open/partial orders only once their market is closed, settled or
  voided, releasing their reservations. A GTC order on an open market rests
  until filled or cancelled.

### 2.4 Settlement, voids, resolution and disputes — Complete

- **Settlement** pays 100 per winning contract and 0 per losing one
  (`settlement.go` `calculatePayout`), in batches of 500 with a crash-resume
  path, each credit keyed `prediction_payout:<market>:<position>`.
- **Void** refunds every position at its entry cost (`VoidMarket`; key
  `prediction_void:<market>:<position>`). Terminal markets cannot be voided.
- **Windowed resolution** ([ADR-0004](adr/0004-dispute-and-appeal.md)): an
  admin (or the auto-settler) proposes a result on a closed market
  (`proposed_resolution`); a challenge window opens (default one hour,
  `prediction.DefaultChallengeWindow`); any holder of a position may file a
  dispute (`disputed`); after the window, with no open dispute, the result is
  finalized and payouts run. Payouts never happen at proposal time.
- **Dual control:** the finalizer and the dispute reviewer must differ from
  the proposer (`settlement.go`). Upholding a dispute voids the market;
  rejecting it lets finalization proceed once no dispute is open.
- **Direct settlement** — `POST /api/v1/admin/settlements/{marketId}` settles a
  closed market immediately and needs only `settlements:resolve`: one admin can
  settle a market alone ([TD-002](TECH_DEBT.md#a-admin-controls-and-points-integrity)).
  When the admin gives an override reason (the office's *Override Reason*
  field, for settling against the imbalance check), it is stored on
  `prediction_settlements` with who overrode and when (since 2026-09-29;
  earlier overrides recorded nothing).

### 2.5 Settlement sources — Partial

`AutoSettler` (every 60 s) finalizes proposals whose window has passed and asks
each closed market's source adapter for a result. By default the only adapters
registered are `admin-manual` and `manual`, which never settle automatically —
**launch markets are settled by admins**. A CoinGecko price adapter exists but
registers only with `TAPTRADE_LEGACY_ASSET_PRICE_FEEDS_ENABLED=true`
(**Flagged off**; `gateway/internal/prediction/feed/crypto.go`). After three
consecutive failures a source is marked unhealthy and its markets stay closed
for manual resolution. Detail: [INTEGRATIONS.md](INTEGRATIONS.md).

### 2.6 How Points enter a wallet

| Source | Rule | Status |
|---|---|---|
| Starter grant | `POST /api/v1/wallet/starter-grant`; once per user (`starter_grant:<user>`); amount `STARTER_GRANT_CENTS` (Points despite the name; demo 500) | Complete, off when 0/unset |
| Daily claim | `POST /api/v1/wallet/daily-claim`; once per UTC day; amount `DAILY_CLAIM_CENTS` (demo 50); checked against a daily reward cap and device/IP abuse clusters | Complete, off when 0/unset |
| Free point packs | `/api/v1/wallet/point-packs` claims (`POINT_PACK_*_CENTS`); unrelated to the paid store despite the name | Complete, each off when 0/unset |
| Missions and streaks | `/api/v1/wallet/missions`, `/streaks` — derived from ledger history, env-gated per reward | Complete |
| Point store | Buy packs through a checkout ([`STORE_AND_PAYMENTS.md`](../STORE_AND_PAYMENTS.md)); the only provider is `demo` (simulated checkout, no charge); `stripe` refuses boot. Purchases count against responsible-play deposit limits; optional first-purchase bonus (`STORE_FIRST_PURCHASE_BONUS_BPS`) | Complete with the demo provider; real payments not implemented |
| Admin credit | `POST /api/v1/admin/wallet/credit` (`finances:write`), no upper limit | Complete ([TD-001](TECH_DEBT.md#a-admin-controls-and-points-integrity)) |
| Loyalty and bonus adjustments | Admin loyalty adjustments (`finances:write`); bonus grants (admin role) | Complete ([TD-003](TECH_DEBT.md#a-admin-controls-and-points-integrity)) |
| Settlement and void | [§2.4](#24-settlement-voids-resolution-and-disputes--complete) | Complete |

### 2.7 Loyalty, leaderboards and rewards — Complete

- **Tiers** (`gateway/internal/loyalty/tiers.go`): Newcomer from 1 XP, Trader
  500, Sharp 2,500, Whale 10,000, Legend 50,000 (tier 0 is hidden). Accrual on
  settlement: `round(volume × 1.5)` for a correct position, `round(volume × 1.0)`
  otherwise. **Discrepancy:** the office tier editor writes `loyalty_tier_config`,
  which the accrual code does not read ([TD-004](TECH_DEBT.md#a-admin-controls-and-points-integrity)).
- **Leaderboards** are snapshots recomputed every 5 minutes
  (`gateway/internal/leaderboards/predict_recomputer.go`): accuracy (30 days),
  weekly P&L, sharpness (30 days, minimum volume), and per-category champions.
  Players can opt out of display (`/api/v1/me/privacy`).
- **Rewards:** missions, streaks (3 to 90 days) and cosmetic badges, all derived
  from wallet-ledger evidence (`gateway/internal/http/wallet_handlers.go`);
  suspicious device/IP clusters are reviewable in the office.

### 2.8 Social, watchlist and notifications

- **Social** — threaded comments with reactions, a position disclosure frozen at
  posting, follows, reports with an office moderation queue, and activity feeds
  (`gateway/internal/http/market_social_handlers.go`). Writes are rate-limited
  per user and per IP. All social routes need a session. Complete.
- **Watchlist** — add, remove and list markets. Complete.
- **Notifications** — an in-app bell (`user_notifications`), live WebSocket
  toasts, and email on settlement payouts when SMTP is configured (log-only
  otherwise). No mobile or web push. Complete for in-app; email **Flagged off**
  on the demo. Notification *preferences* are not persisted (**Stub**,
  disclosed in the UI).

### 2.9 Responsible play and compliance

| Control | Behaviour | Status |
|---|---|---|
| Stake and deposit limits | Daily/weekly/monthly caps checked against logged activity before an order or store purchase (`gateway/internal/compliance/rg_postgres.go`) | Complete |
| Self-exclusion, cool-off | Blocks play for the period | Complete (UI behind `NEXT_PUBLIC_FEATURE_RG`, off by default) |
| Session-duration limit | Endpoint validates and echoes; nothing stored or enforced, although the responsible-gaming page says it works | **Stub** ([TD-016](TECH_DEBT.md#c-compliance-and-licensability)) |
| Trading KYC gate | With `KYC_REQUIRED_FOR_TRADING=true`, trading needs `approved` KYC; fails closed in production/staging, open in dev | Complete, off by default and on the demo |
| Withdrawal KYC gate | Threshold (`KYC_WITHDRAWAL_THRESHOLD_CENTS`) over cumulative cash-out across both money rails | Complete but **Dormant** (withdrawal routes unmounted) |
| KYC review | Submissions queue as `pending`; an admin decides via `POST /api/v1/admin/kyc/decision` (`compliance:write`); no vendor integration | Partial — no office queue ([TD-013](TECH_DEBT.md#c-compliance-and-licensability)) |
| Geo gate | Country from the edge header (`CF-IPCountry` by default); allowlist or denylist; fails closed on a missing header; per-market jurisdiction overlays can only narrow it (`gateway/internal/compliance/geo_gate.go`, `gateway/internal/prediction/jurisdiction.go`) | Complete, off by default and on the demo; policy in [compliance/geofencing-kyc.md](compliance/geofencing-kyc.md) |
| GPS geo check | `POST /api/v1/compliance/geo/verify` backed by a mock in every environment; no player code calls it | **Mock** ([TD-017](TECH_DEBT.md#c-compliance-and-licensability)) |

## 3. Player app pages

38 pages under `player/app/` (Next.js App Router). "Flag" means the page
returns 404 or redirects unless the named build-time flag is `true`.

| Area | Route | Purpose | Status |
|---|---|---|---|
| Landing | `/` | Marketing landing page with a live market card, topic counts and trending markets | Complete |
| Board | `/predict` | Discovery board (featured, trending, closing soon, recent), in-place quick trade, 30 s refresh | Complete |
| Board | `/discover` | Ranked boards (trending, volume, discussion, movers) from real price history | Complete |
| Board | `/category/[slug]`, `/series/[slug]` | Filtered market grids | Complete |
| Board | `/live` | Live sports/esports events with provider status | Flag `NEXT_PUBLIC_FEATURE_LIVE_MARKETS` (redirects to `/predict`) |
| Board | `/activity` | Global activity feed | Complete |
| Market | `/market/[ticker]` | Detail: header, chart, order book, trades, discussion, rules, trade ticket; WebSocket updates | Complete |
| Market | `/event/[id]` | All markets of one event, one resolution block, aggregate exposure, trade panel | Complete |
| Portfolio | `/portfolio` | Positions, orders, history, summary | Complete |
| Store | `/store` | Pack grid → order summary → demo checkout → result | Complete (demo provider) |
| Rewards | `/rewards` | Tier ladder, daily claim, missions, streaks, packs, badges, bonuses, ledger | Complete |
| Leaderboards | `/leaderboards`, `/leaderboards/[id]` | Boards and standings; `[id]` redirects to `?board=` | Complete |
| Account | `/account` | Own profile hub: balance, marked positions, result sparkline | Complete |
| Account | `/account/settings` | Details, language, privacy toggle; KYC card (`FEATURE_KYC`), limits (`FEATURE_LIMITS`) | Complete; the details save is not persisted ([TD-036](TECH_DEBT.md#f-gateway-api-and-real-time)) |
| Account | `/account/security` | Password change, sessions; the two-factor tab (status, setup with an authenticator key, turn off with a code) shows only with `NEXT_PUBLIC_FEATURE_MFA` (off) | Complete (two-factor off by flag) |
| Account | `/account/notifications` | Preference UI; backend does not persist | Partial / Stub |
| Account | `/account/transactions` | Clout ledger with filters and CSV export | Complete |
| Account | `/account/rg-history`, `/account/self-exclude`, `/responsible-gaming` | Responsible-play history, self-exclusion wizard, info page | Flag `NEXT_PUBLIC_FEATURE_RG` |
| Profile | `/users/[userId]` | Another player's public profile, follow, activity | Complete |
| Auth | `/auth/login`, `/auth/register` | Password login and two-step registration (terms and points-only disclosure); social buttons behind `FEATURE_SOCIAL_AUTH` | Complete |
| Auth | `/auth/verify-email`, `/auth/reset-password`, `/reset-password` | Token-based verify and reset (the last redirects) | Complete, but reset links can only be issued manually |
| Auth | `/auth/forgot-password` | Static "contact support" notice; no reset endpoint | **Stub** ([TD-043](TECH_DEBT.md#g-player-app)) |
| Cashier | `/cashier` | Read-only crypto deposit card from the alpha cashier config; no deposit action | **Stub**, flag `NEXT_PUBLIC_FEATURE_CASHIER_UI` (never set on the demo — CI-enforced) |
| Info | `/about`, `/terms`, `/terms-and-conditions`, `/tos`, `/privacy`, `/privacy-policy`, `/attributions` | CMS pages with static fallbacks; aliases re-export `/terms`; image credits | Complete (`/privacy` and `/privacy-policy` are two versions of one page) |
| Info | `/contact-us` | Form that falls back to `mailto:` (no backend endpoint) | Partial |

### 3.1 Board and landing behaviour

- **Event cards.** Promotion creates one real event per upstream event (id
  `upstream-event-<source>:<group>`, `is_synthetic=false`,
  `gateway/internal/discover/promote.go`); imports with no event fall into
  per-category catch-alls. Markets carry `eventSynthetic` and
  `eventOpenMarkets`, and the board's `MarketGrid` folds a real event's markets
  into one `EventCard`. A lone market whose event has two or more open markets
  also becomes an event card, which fetches up to 10 open sibling markets by
  activity (`EventCard.tsx` `EVENT_ROW_POOL`). Rows use the source's short label
  (`outcomeLabel` — Polymarket `groupItemTitle`, Kalshi `yes_sub_title`,
  migration 061), else the words the rows don't share, and show the likeliest
  outcomes, skipping 1–2% and 98–99% rows while livelier ones exist
  (`event-groups.ts`). **Discrepancy:** CLAUDE.md said the fetch used
  `pageSize=3`; the code uses 10 (corrected there).
- **Cards** show the market's image tile, an eyebrow (the real event's title,
  else the category), the question, the chance, Yes/No buttons priced in Clout,
  and a footer with volume and time left.
- **Activity rail.** `GET /api/v1/activity/recent` (public) returns recent fills
  on open markets and 24-hour movers from `prediction_trades`; the board's
  `ActivityRail` polls it every 30 s and renders nothing when both lists are empty.
- **Featured rail.** "This week in the Philippines" (`ThisWeekRail`) appears
  once at least four events flagged featured have an open market
  (`MIN_RAIL_MOMENTS`). Curated in the office under Featured Moments
  (`PATCH /api/v1/admin/events/{id}`, migration 057). Licensed topic covers are
  in `player/public/images/covers/` (credits in `CREDITS.md`); the approved
  slate is [content/2026-q4-ph-market-slate.md](content/2026-q4-ph-market-slate.md).
- **Signed-out visitors** see a one-line welcome strip under the topic chips.
- **Quick trade.** Each `MarketGrid` hosts one `QuickTradePanel`: a card's
  Yes/No opens `InspectorPanel` (the real `ConnectedTradeTicket`, side
  preselected, plus a link to the market) in a dialog wider than 1023 px or a
  bottom sheet below. Closed markets link to `/market/<ticker>?side=` instead.
- **Landing (`/`).** `components/welcome/WelcomePage.tsx`, full-bleed
  (`AppShell` `isMarketingRoute`), built on live data (a real market card, topic
  counts, trending markets); its "Markets" links go to `/predict`, and its
  money-word legal lines are inline English constants in `WelcomeSections.tsx`
  rather than locale strings. Inside the app the logo returns to `/predict`.

Retired routes redirect in `player/next.config.js`: `/floor`, `/book`,
`/standing` (Floor trial, 2026-09-23), `/welcome` → `/`, `/profile` →
`/account/settings`.

**Discrepancy:** `player/FEATURE_MANIFEST.json` `pages[]` still lists
sportsbook-era pages (`/bets`, `/esports-bets`, `/match/[id]`, `/promotions`,
`/cashier/cheque`, `/stream-bets`…) as REAL. They do not exist. Use the table
above ([TD-042](TECH_DEBT.md#g-player-app)). The manifest's three STUBBED
entries are `/cashier`, `ChatSidebar` (renders "Chat isn't connected yet") and
`chat-client` (calls `/api/v1/chat/*` routes the gateway does not serve).

## 4. User flows

1. **Register and sign in.** `/auth/register` (terms and the no-cash-out
   disclosure) → account created → signed in. `/auth/login` for password login.
   Social login (Google, Facebook, Discord, X, TikTok, Reddit) probes
   `/api/v1/auth/oauth/<provider>/start/`; a provider without credentials shows
   "not configured". Only Google and Discord link to an existing account, and
   only on a verified email ([INTEGRATIONS.md](INTEGRATIONS.md)).
8. **Two-factor sign-in — built, switched off** (`AUTH_MFA_ENABLED`,
   `NEXT_PUBLIC_FEATURE_MFA`; owner, 2026-09-29). When on: an account with it
   gets a second step for the 6-digit code from its authenticator app, after a
   password or a social sign-in; `/account/security` → *Two-factor sign-in* →
   *Set up* shows a key and the first code turns it on; turning it off needs a
   current code; staff can't turn it off while it is required, and a staff
   account without it is set up at its next sign-in.
2. **Get Clout.** Claim the starter grant and daily claim on `/rewards`, or buy
   a pack on `/store` (simulated checkout on the demo).
3. **Discover and quick-trade.** `/predict` → a card's Yes/No opens the trade
   ticket in a dialog (wider than 1023 px) or bottom sheet → preview → place →
   balance and cards refresh.
4. **Trade on the market page.** `/market/[ticker]` → ticket → preview → place
   (idempotency key per submit). Insufficient balance links to
   `/store?return=…`.
5. **Follow outcomes.** `/portfolio` shows positions and orders; settlement
   credits arrive as a bell notification and live toast.
6. **Dispute a proposed result.** A holder files a dispute while the market is
   in `proposed_resolution`; an admin upholds (void and refund) or rejects.
7. **Compete.** `/leaderboards` standings; `/rewards` tier progress (XP).
8. **Discuss.** Comment, react, report and follow from the market page and
   profiles.

## 5. Back office

`office/app/(dashboard)/`. The office does not authorize anything itself: the
sidebar is filtered by `GET /api/v1/admin/me` as a hint and fails open; every
data call is authorized by the gateway ([§6](#6-permissions)). The office host
on the demo also sits behind HTTP basic auth.

| Route | Purpose | Status |
|---|---|---|
| `/dashboard` | Open markets, settlement queue, 24 h volume, movers | Complete |
| `/users`, `/users/[id]` | Player search and detail (profile, settlements, ledger, notes) | Complete |
| `/access-control` | Staff users and the role × permission matrix | Complete |
| `/prediction-admin/markets` | Market list, create, lifecycle actions, AI draft-from-article | Complete |
| `/prediction-admin/taxonomy` | Categories and series | Complete |
| `/prediction-admin/moments` | Featured events and cover photos for the home rail | Complete |
| `/prediction-admin/images` | Review, replace or remove market covers | Complete |
| `/prediction-admin/settlements` | Settlement queue and manual resolution | Complete |
| `/prediction-admin/reward-clusters` | Reward-abuse evidence, CSV | Complete |
| `/prediction-admin/store-packs` | Point-pack catalogue | Complete (needs `STORE_ENABLED`; on for the demo) |
| `/prediction-admin/activity` | Activity export, CSV | Complete |
| `/prediction-admin/risk` | Settlement aging, concentration, accounting invariants | Complete |
| `/disputes` | Dispute review (uphold/reject) | Complete |
| `/social-moderation` | Comment reports | Complete |
| `/content` | CMS pages and banners | Complete |
| `/loyalty`, `/loyalty/[id]`, `/loyalty/settings` | Accounts, adjustments, tier/rule settings | Complete ([TD-004](TECH_DEBT.md#a-admin-controls-and-points-integrity)) |
| `/leaderboards`, `/leaderboards/[id]` | Board list, detail, recompute | Complete |
| `/audit-logs` | Audit log search | Complete |
| `/campaigns`, `/reports` | Retired; redirect to `/dashboard` | Retired |
| `/risk-management` | Redirects to `/prediction-admin/risk` | Retired |

## 6. Permissions

- **Session roles** (auth service): `player` and `admin`. The seeded bot
  account (`user-bot`, used by the market maker) is an ordinary player.
- **Staff RBAC** (gateway, migration 027 and later): `admin_users` bound to the
  session by email; roles and permissions below. The `super-admin` role cannot
  be edited through the API; actors can only grant within their own set; the
  last active super-admin cannot be removed; nobody can suspend or delete
  themselves. Production has no seeded staff: create the first super-admin with
  `gateway rbac-bootstrap`.
- **Two-factor sign-in for staff — off.** The feature is built but off unless
  `AUTH_MFA_ENABLED=true` (off on the demo, [TD-005](TECH_DEBT.md#b-authentication-and-access-control)).
  With it on and `AUTH_ADMIN_MFA_REQUIRED` on (the default in
  production/staging once the feature is enabled), every admin account — in
  `auth_users` with role `admin`, or in `admin_users` — signs in with a password
  and then a TOTP code. An admin without an authenticator is shown a setup key
  at their next sign-in, and the first code both confirms it and signs them in;
  until then the password alone decides who enrolls
  ([TD-057](TECH_DEBT.md#b-authentication-and-access-control)). Staff cannot
  turn it off; an operator clears a lost authenticator with `auth mfa-reset`
  ([runbook §16](../apps/taptrade-platform/ops/RUNBOOK.md)).

| Permission | Super Admin | Operations Manager | Customer Support |
|---|---|---|---|
| `users:read`, `markets:read`, `finances:view` | ✓ | ✓ | ✓ |
| `roles:read`, `markets:edit`, `settlements:resolve` | ✓ | ✓ | |
| `finances:write`, `compliance:write`, `cashier:broadcast` | ✓ | ✓ | |
| `users:write`, `roles:write`, `partners:read`, `partners:write` | ✓ | | |
| `cashier:read`, `cashier:write` | ✓ | ✓ | `cashier:read` only |

- **Enforcement functions** (`gateway/internal/http`): `requireAdminRole`
  (session role is `admin`; never a header), `requireRBACPermission` (role
  plus permission), `requireAdminPermission` (the business-route gate; falls
  back to role-only when no RBAC service is wired, as in memory mode). Most
  money-moving and market-changing routes use a specific permission; some admin
  reads use role only; CMS and bonus writes use an inline role check
  ([TD-009](TECH_DEBT.md#b-authentication-and-access-control)).
- **Public routes** (no session) are listed in `gatewayPublicPrefixes()`
  (`gateway/cmd/gateway/main.go`): health and status, `/api/v1/auth/`, `/ws`
  (authenticates itself), CMS delivery, attributions, recent activity, the
  public catalogue (`discover`, `discovery`, `live-markets`, `categories`,
  `series`, `tags`, `events`, `markets`), leaderboards, and the API-key bot
  routes `/api/v1/bot/orders`, `/positions` and `/markets` (also CSRF-exempt).
  `/api/v1/store/webhook` and the legacy webhook prefixes are
  added only when their feature is on. Everything else needs a session.
- **Bot API keys**: `Authorization: Bearer tna_<prefix>_<secret>`, bcrypt-checked,
  scoped (`read`, `trade`, `admin`), rate-limited per key
  (`gateway/internal/prediction/botauth.go`). Operators issue partner keys via
  `/api/v1/admin/partner-keys`. Players manage their own keys at
  `/api/v1/bot/keys` with their session (subject to `BOT_KEYS_SELF_SERVE`);
  until 2026-09-29 those routes always answered 401.
- **Dev bypasses** — `GATEWAY_ALLOW_ADMIN_ANON=true` and
  `GATEWAY_AUTH_ENABLED=false` — refuse boot in production/staging.

## 7. API behaviour

The gateway uses the standard library `ServeMux`; handlers switch on the method
themselves. The OpenAPI spec (`gateway/api/openapi.yaml`, 130 paths) is a
curated subset. The G-04 guard (`scripts/check-openapi-drift.sh`) checks two
things only: every documented path matches a registered route, and every
registered public `/api/v1/<group>` is documented or allow-listed. Admin routes
are exempt, and methods and schemas are not checked.

### 7.1 Endpoint catalogue (player-facing; session unless marked)

| Group | Endpoints |
|---|---|
| Health | `GET /healthz`, `/readyz`, `/metrics`, `/metrics/prediction`, `/api/v1/status` — public |
| Catalogue (public) | `GET /api/v1/discovery`, `/categories[/{slug}]`, `/series`, `/tags`, `/events[/{id}]`, `/markets[/{idOrTicker}]`, `/markets/{id}/trades`, `/orderbook`, `/prices`, `/api/v1/discover`, `/api/v1/live-markets`, `/api/v1/activity/recent`, `/api/v1/attributions` |
| Orders | `GET/POST /api/v1/orders`, `POST /api/v1/orders/preview`, `POST /api/v1/orders/{id}/cancel` |
| Portfolio | `GET /api/v1/portfolio`, `/portfolio/summary`, `/portfolio/history` |
| Wallet and rewards | `GET /api/v1/wallet/{userId}[/breakdown\|/ledger]` (owner or admin); `POST /api/v1/wallet/starter-grant`, `/daily-claim`; `GET/POST` `/api/v1/wallet/{point-packs,missions,streaks}[/claim]`; `GET /api/v1/wallet/badges`, `/reward-limits` |
| Store (`STORE_ENABLED`) | `GET /api/v1/store/packs`, `POST /api/v1/store/checkout`, `GET /api/v1/store/purchases[/{id}]`, `POST /api/v1/store/purchases/{id}/confirm` (demo provider only), `POST /api/v1/store/webhook` (public, HMAC) |
| Loyalty, leaderboards | `GET /api/v1/loyalty[/standing\|/ledger\|/tiers]`; `GET /api/v1/leaderboards`, `/leaderboards/{id}/entries` (public); `GET /api/v1/me/leaderboards`; `GET/PUT /api/v1/me/privacy` |
| Social | `/api/v1/social/activity`, `/social/users/{id}/{profile,follow,activity}`, `/social/markets/{id}/comments`, `/social/comments/{id}/{react,report}` |
| Watchlist, notifications | `GET /api/v1/watchlist/markets`, `PUT/DELETE /api/v1/watchlist/markets/{id}`; `GET /api/v1/notifications`, `POST /api/v1/notifications/read` |
| Disputes | `GET/POST /api/v1/disputes` |
| Bonuses (DB only) | `GET /api/v1/bonuses/active`, `/{id}`, `/{id}/progress`, `POST /api/v1/bonuses/claim` |
| Compliance | 16 routes under `/api/v1/compliance/{geo,kyc,rg}/*`; all but the geo routes bind the user to the session |
| Users | `GET/PUT /api/v1/users/{id}/profile` (PUT not persisted), `POST /api/v1/punters/delete` (schedules deletion in 30 days) |
| CMS (public, DB only) | `GET /api/v1/content/{slug}`, `/api/v1/banners` |
| Bot (API key) | `POST /api/v1/bot/orders`, `GET /api/v1/bot/positions`, `/bot/markets`; key management `GET/POST /api/v1/bot/keys`, `DELETE /api/v1/bot/keys/{id}` (session) |
| Auth | `/api/v1/auth/*` and `/auth/*` are reverse-proxied to the auth service. Two-factor, mounted only with `AUTH_MFA_ENABLED=true`: `POST /api/v1/auth/login/mfa` (challenge + code → session); `GET /api/v1/auth/mfa` (status); `POST /api/v1/auth/mfa/enroll`, `/activate`, `/disable` (session + CSRF). The old `POST /api/v1/auth/2fa/toggle` is gone |

**Admin API** (`/api/v1/admin/*`, most also mounted under `/admin/*`): markets
and taxonomy, lifecycle actions, propose/finalize, settlements and replay,
jurisdiction overlays, AI budget and provenance, dashboards and drift alerts,
risk, resolution-source health, punters (status, notes, settlements, wallet),
audit logs, wallet credit/debit and reward clusters, store packs, KYC decisions,
disputes, partner keys, webhook endpoints, social moderation, loyalty, leaderboards,
CMS, campaigns and bonuses, staff users and roles, and `me`. Permissions per
route: [§6](#6-permissions) and the handlers. **Stubs:**
`/admin/punters/{id}/{reset-password,risk-segment,limits}` return 501, and
`/admin/promotions/usage`, `/admin/feed-health`, `/admin/config` return fixed
payloads ([TD-035](TECH_DEBT.md#f-gateway-api-and-real-time)).

**Dormant** (only with the legacy money flag): `/api/v1/payments/*`, 11 player
routes under `/api/v1/cashier/alpha/*`, and 8 admin routes under
`/api/v1/admin/cashier/alpha/*` ([ADR-0012](adr/0012-cashier-merged-dark-behind-flags.md)).

### 7.2 Errors

Every error is `{"error": {"code", "message", "requestId", "details"}}`
(`platform-mod/transport/httpx/handler.go`). Codes: `bad_request` (400 —
including domain validation), `unauthorized` (401), `forbidden` (403),
`not_found` (404), `method_not_allowed` (405), `conflict` (409),
`too_many_requests` (429), `internal_error` (500). `X-Request-ID` is honoured or
generated and echoed. Debugging guide: [`stack/ERRORS.md`](../apps/taptrade-platform/ERRORS.md).

### 7.3 WebSocket

One endpoint, `GET /ws`, which authenticates itself (cookie or bearer, checked
against the auth service) and rejects unlisted origins in production/staging.
Clients send `{"type":"subscribe","channels":[…]}`; the server pushes
`{"type":"event","channel","eventId","data"}`. Unknown channel prefixes are
refused; `wallet:`, `portfolio:` and `loyalty:` channels must match the
connected user.

| Channel | Fires on | Status |
|---|---|---|
| `market:{id}` | Price/status updates and resolution-phase changes | Complete |
| `trades:{marketId}` | Each fill | Complete |
| `orderbook:{marketId}` | Top-of-book change (clients refetch depth) | Complete |
| `portfolio:{userId}`, `wallet:{userId}` | Fills and settlement payouts | Complete |
| `loyalty:{userId}` | Tier promotion | Complete |
| `event:{id}`, `category:{slug}`, `leaderboard:accuracy` | Nothing — no code publishes them | Dormant |
| `admin:resolutions`, `admin:disputes` | Published, but no client may subscribe | Broken |

Wire protocol: [`gateway/internal/ws/README.md`](../apps/taptrade-platform/go-platform/services/gateway/internal/ws/README.md).
Channel cleanup: [TD-034](TECH_DEBT.md#f-gateway-api-and-real-time).

## 8. Partial, stubbed, mocked, dormant and flagged off

| Item | Status | Where |
|---|---|---|
| Legacy payments (fiat deposit/withdraw, mock payment service) | Dormant | `gateway/internal/payments` |
| Alpha crypto cashier (deposits, withdrawals, scanner, reorg watcher) | Dormant | `gateway/internal/alphacashier`, [ADR-0012](adr/0012-cashier-merged-dark-behind-flags.md) |
| `/cashier` deposit card | Stub, flagged off | `player/app/cashier/` |
| Node cashier-api, bridge-watcher, relayer, cashier-sdk, contracts | Dormant, never deployed | `services/`, `packages/`, `contracts/` |
| Two-person approval rule | Built, not wired | `gateway/internal/approval` ([D-1](TASKS.md#needs-a-decision)) |
| Multi-tenancy | Schema and package only | [ADR-0005](adr/0005-multi-tenancy-foundation.md) |
| Chat | Stub (shell only, no transport) | `ChatSidebar`, `chat-client` |
| Stripe store provider | Not implemented (boot-refused) | `gateway/internal/store/config.go` |
| KYC vendor (IDV) | Not implemented; manual review only | `gateway/internal/compliance/idv.go` |
| GPS geo verification | Mock | `/api/v1/compliance/geo/verify` |
| Session-duration limit, notification preferences, profile update | Accepted but not stored | [TD-016](TECH_DEBT.md#c-compliance-and-licensability), [TD-043](TECH_DEBT.md#g-player-app), [TD-036](TECH_DEBT.md#f-gateway-api-and-real-time) |
| Forgot-password | Stub | `/auth/forgot-password` |
| Synthetic market maker | Real orders through the normal path, as user `user-bot`; on for the demo only | `gateway/internal/prediction/workers/smm.go` |
| Synthetic demo charts | A seeded random walk while price history loads or is flat; demo only | `NEXT_PUBLIC_DEMO_SYNTHETIC_CHARTS` |
| CoinGecko settlement feed | Flagged off | `TAPTRADE_LEGACY_ASSET_PRICE_FEEDS_ENABLED` |
| Authenticated Kalshi live data | Flagged off | `AUTHENTICATED_MARKET_DATA_ENABLED` |
| Player feature flags | `FEATURE_RG`, `FEATURE_KYC`, `FEATURE_LIMITS`, `FEATURE_LIVE_MARKETS`, `FEATURE_CASHIER_UI` off; `FEATURE_CHAT`, `FEATURE_SOCIAL_AUTH` on for the demo | `player/app/lib/features.ts` |
| Loyalty and leaderboards without a database | Legacy in-memory implementations (dev/test only) | `gateway/internal/http/loyalty_handlers.go`, `leaderboard_handlers.go` |

## 9. Where documented intent and code disagree

- The archived persona research (`archive/2026-09-29-docs-consolidation/PRODUCT-USER-JOURNEYS.md`)
  describes cent pricing, a live crypto category and withdrawals. None exist:
  prices are Points, the crypto category is deactivated (migration 046), and
  there is no withdrawal path.
- The responsible-gaming page promises session limits that are not enforced
  ([§2.9](#29-responsible-play-and-compliance)).
- The office tier editor implies tiers are configurable; accrual ignores it
  ([§2.7](#27-loyalty-leaderboards-and-rewards--complete)).
- `FEATURE_MANIFEST.json` lists pages that do not exist ([§3](#3-player-app-pages)).
- ADR-0004's action checklist was never ticked although every item shipped
  (status update added to the ADR).
- The name "resting order expiry" suggests orders age out; they do not
  ([§2.3](#23-market-lifecycle--complete)).
