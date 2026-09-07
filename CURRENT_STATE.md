# Current state — 2026-09-06

Written against `main` at `f89b5a8b`, then reconciled with the 2026-09-06 hold commits
(`6ae9ae78` … `aadab541`); the hold record is the last section. This file is deliberately short: it says what the
product is, where the code lives, what landed last, and what is switched off. Anything
that needs more detail than a sentence lives in `CLAUDE.md` or in the per-surface docs.

## What the product is

Tap Trade is a prediction market. Users trade binary YES/NO contracts on real-world
outcomes. Six categories are active in the schema — politics, esports, sports,
entertainment, tech, economics. Migration `046_taptrade_launch_taxonomy.sql` added
esports and **deactivated** crypto (renamed "Legacy Crypto", `active = false`), so any
doc still listing crypto as a live category is out of date, and crypto markets must not
be seeded back in.

The economy is **points-only and non-redeemable**:

- Prices are whole Points. `prediction_markets` constrains `yes_price_points` and
  `no_price_points` to `BETWEEN 1 AND 99` with `yes + no = 100`; a correct contract
  settles at 100 Points. 1 Point = 1 cent of in-platform play value, nominal.
- Migration `050_points_unit_model.sql` (2026-07-07) renamed every active-economy
  `*_cents` column to `*_points`. It renamed columns only — no stored value moved. The
  wire contract is `yesPricePoints` / `noPricePoints` and point-native payloads carry
  `unit: "PTS"`. `internal/prediction/types.go` contains zero occurrences of "Cents".
- `GET /api/v1/status` advertises `"pointMode": "non_redeemable_points"`. There is no
  withdrawal, cash-out, redemption, or transfer path.
- Points can be **bought** — the point store (migration `051`) sells packs for USD and
  credits non-redeemable points. Money in, points out, never back. See
  `STORE_AND_PAYMENTS.md`.

## Where the surfaces are

| Surface | Path | Stack | Local port |
|---|---|---|---|
| Player app | `apps/taptrade-platform/frontend/packages/app` | Next.js 16 App Router, React 19, Tailwind | 3010 by convention |
| Backoffice | `apps/taptrade-platform/frontend/packages/office` | Next.js 16 **App Router** + Ant Design 5 | 3001, set by the dev runner |
| Gateway API | `apps/taptrade-platform/go-platform/services/gateway` | Go 1.25, stdlib HTTP, PostgreSQL | 18080 |
| Auth service | `apps/taptrade-platform/go-platform/services/auth` | Go 1.25 | 18081 |
| PostgreSQL | Docker Compose `postgres` | 16 | 5434 |
| Redis | Docker Compose `redis` | rate limiters, auth sessions, optional WS fan-out — **not** a read cache | 6380 |

There is no read cache in the gateway. `REDIS_URL` backs the HTTP rate limiter (which
falls back to per-process counters when unset) and, with `WS_BACKBONE=redis`, the
cross-replica WebSocket backbone; the auth service uses it for sessions and its own
limiter.

The office package has no `pages/` directory — it is App Router throughout. Older docs
that call it a Pages Router app are stale.

The frontend is a yarn-1 workspace rooted at
`apps/taptrade-platform/frontend`. Install from there with
`yarn install --frozen-lockfile`, which is what CI does.

## What shipped most recently

Newest first, from `git log` on `main`:

- `f89b5a8b` (2026-08-26) — reward hero uses a fictional prediction UI.
- `2852db8e` (2026-08-25, PR #79) — elevated Predict reward hero.
- `0cfd3e89` (2026-08-24, PR #78) — `/predict` rebuilt around "trending moments".
- `83d92631` / `21b2c9ea` / `7a8b7f56` (2026-08-22) — the **purple + gold** Tap Trade
  identity. This replaced the 1C "lime skin" system. `DESIGN.md` describes the current
  system; `app/__tests__/color-system.test.ts` pins it.
- `37690520` … `d9861e56` (2026-08-17) — rate-limiting and edge fixes: the whole
  internet had been sharing one rate-limit bucket because the visitor IP did not
  survive Cloudflare and Caddy.

Deploy is `push to main` → `.github/workflows/deploy-demo.yml` → `demo.99rtp.io`
(player) and `office.99rtp.io` (backoffice).

## What is deliberately switched off

These are not unfinished work. They are boundaries the gateway enforces at boot
(`validateGatewayRuntimeConfig` in `cmd/gateway/main.go`):

- **Legacy money routes** — deposits, withdrawals, cashier, crypto, and provider
  callbacks live behind `TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED`. Setting it to `true`
  when `ENVIRONMENT` is `production` or `staging` is a boot **error**, not a warning.
- **The alpha crypto cashier** — `ALPHA_CASHIER_ENABLED=true` is likewise a boot error
  in deployed environments, and outside them it additionally requires the legacy
  money-route flag. The `internal/cashier`, `internal/alphacashier` and
  `internal/payments` packages still exist in the tree but do not mount at launch.
- **Admin anonymous bypass and the auth kill switch** — `GATEWAY_ALLOW_ADMIN_ANON=true`
  and `GATEWAY_AUTH_ENABLED=false` are local-dev only, and both refuse to boot in
  deployed environments.
- **Stripe** — `STORE_PROVIDER=stripe` is a reserved seam that is refused at boot. The
  demo deploy runs `STORE_PROVIDER=demo` with a simulated checkout.
- **Player feature flags**, all default-off in `app/lib/features.ts`:
  `NEXT_PUBLIC_FEATURE_RG`, `_KYC`, `_LIMITS`, `_CHAT`, plus social auth and live
  markets, which activate from their own configuration.

## Known open threads

- **`origin/feat/hula-na-cashier`** — 22 commits, untouched since 2026-05-25. Real-money
  cashier surfaces that the launch-safety gates classify as prohibited today. **Owner
  decision 2026-09-06: KEEP the branch — the intent is to enable this rail one day.** It
  has no path to `main` while the product is points-only, so treat it as a parked feature
  branch, not pending work: do not merge it, and do not delete it. When it is revived it
  will need rebasing over the rebrand and the points unit model. (The other two archive
  branches were retired on 2026-09-06 — see the licensability thread above.)
- **Back-office licensability** — the `pam/p0-modernization` branch (345 commits, terminated
  2026-07-06, never merged) was retired on 2026-09-06 to tag
  `archive/pam-p0-modernization-2026-07-06`. It is unmergeable as code (pre-rebrand paths,
  pre-points units, migration numbers colliding with main's), but it verified real gaps that
  `main` still has. **The headline: staff MFA does not exist** — `services/auth` has no TOTP
  code, and the `2fa/toggle` endpoint flips an in-memory boolean that login never checks. That
  and seven other verified gaps are registered in `docs/licensability-gaps.md`; the design
  record is in `docs/archive/2026-07-pam-modernization/`.
- **`app/components/chat/ChatSidebar.tsx`** ships `MOCK_CHAT_MESSAGES` — fourteen
  hardcoded messages — behind `NEXT_PUBLIC_FEATURE_CHAT` (off). It is a stub sitting in
  production code, not a working feature.
- **The Lighthouse performance ceiling** is structural: the player app is effectively a
  client-rendered SPA (109 files carry `"use client"`), so content-bearing routes hydrate
  a full client tree before their data paints. The July 2026 audit concluded this cannot
  be moved without incremental React Server Components adoption. Nobody has started that.

## Project hold — 2026-09-06

The project was paused on 2026-09-06 for a few weeks. The workspace was cleaned so
re-entry starts from truth; this sweep (PR #80) is part of that cleanup.

**State at pause.** `main` == `origin/main`, deployed through the hold commits
(`71506d8d` is the last deploy; docs-only pushes do not trigger `deploy-demo.yml`).
Tests and the money-path guard were green on every hold commit. Live smoke: `/`,
`/predict/`, `/auth/register/` 200; `office.99rtp.io` 401 behind its basic-auth gate.

**Cleanup executed** (each step verified by command output): ten superseded local
branches deleted (nine merged by ancestry; `feat/moments-predict-experience` was
tree-diffed against `main`, the only delta being main's newer hero fix); the merged
brand-identity branch `origin/feat/tap-path-identity` deleted;
`feat/predict-redesign-p10` pushed to origin as an archive branch; the `pam-worktree`
removed (history preserved on `origin/pam/p0-modernization`); the parent folder's era
artifacts moved to
`/Users/john/Sandbox/taptrade-workspace/_archive-2026-09/`; the July rebrand ledger
(`WORKLOG.md`, `CURRENT_STATE.md`, `RENAME_MAP.md`) archived under
`docs/archive/2026-07-rebrand/` — the hold entry that briefly lived in that WORKLOG is
this section.

**Deploy-guard incident, closed.** The first hold deploy tripped `deploy-demo.yml`'s
disk guard: the box was 97% full from ~23GB of unrotated container json logs
(`predict_gateway` 14G, `predict_rocketchat_mongo` 8.7G — docker's json-file driver has
no default rotation). `demo-ops.yml` gained read-only `disk_report` and WRITE
`disk_cleanup` dispatch jobs (truncation took the box to 34%), and every
`docker-compose.demo.yml` service now carries a 50m×3 `logging:` cap. The cap applies
per container on its next recreate; rocketchat/mongo, db-backup and caddy are not
recreated by deploys, so they keep unbounded logs until a manual `docker compose up -d`
on the box.

**Local-dev drift to expect.** The player app runs on port 3010 (3000 is bound by an
unrelated project on this Mac); if `demo@taptrade.local` is rejected locally, use
`alice@predict.dev` / `predict123`; the dockerized gateway image can go stale (market
buys return 400) — run it from source when trading locally.

**Parked owner decisions** (unchanged; nothing here is blocked on code): whether to
delete `feat/hula-na-cashier` (real-money rail vs the points-only boundary); the fee
policy — the implemented variance fee vs a flat 1% (25×8 Points costs 201 vs 202; see
the 2026-07-07 points entry in the archived WORKLOG); an optional one-time rewrite of
cents-era keys inside stored bonus rule-config JSONB; CF origin-firewall reboot
persistence (the 2026-07-28 fix is applied but not yet authorized to persist across
reboots); and rotating the Gemini/Google AI Studio key plus revoking the Hugging Face
token that were pasted into a July session transcript.

## Standing decisions (2026-09-06)

- **Demo box stays up.** Its original notes scoped it to a 2–6 week run; that window has
  passed. Owner decision: keep it running through the pause — the cost is acceptable. Its
  disk is capped now (50m x 3 per container) so the 2026-09-06 log-fill incident should not
  recur, but nothing recreates rocketchat/mongo, db-backup or caddy on deploy, so those
  three keep unbounded logs until someone runs `docker compose up -d` on the box.
- **`feat/hula-na-cashier` is kept**, not pending. See the thread above.
- **The Gemini / Hugging Face credentials are kept, not rotated.** `GEMINI_API_KEY` has a
  real ongoing use — `packages/app/scripts/hero-ambient-generate.sh` generates the landing
  hero video through the Veo/Gemini API (see `packages/app/docs/hero-ambient-video.md`).
  Neither key is in the repository, in git history, or shipped to the demo box: the deploy
  workflow references neither, `.env*` is git-ignored, and a scan of all commits found no
  key-shaped strings. They do appear in plaintext in local Claude session logs under
  `~/.claude/projects/` (ten files across six unrelated projects as of 2026-09-06), which
  is a local-machine exposure only. Revisit if a log is ever shared or synced off-device.

## Where to look next

- `CLAUDE.md` — architecture, conventions, local setup, the rules that bind agents.
- `README.md` — the shortest path from a clean checkout to a running app.
- `DESIGN.md` — the shipped design system (mirrors `globals.css`; the CSS wins).
- `STORE_AND_PAYMENTS.md` — the point store contract.
- `PRODUCT-USER-JOURNEYS.md` — implemented user journeys.
- `docs/archive/` — finished and superseded records, each banner-marked. Nothing there
  describes the current system.
