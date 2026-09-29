# STORE_AND_PAYMENTS — Point Store, Demo Checkout, and Stripe Readiness

Status: **IMPLEMENTED & LIVE.** Landed 2026-07-12 (`7a7109d9`, `084e3d19`, `146041ea`)
and merged to `main`; the branch `feat/store-and-perf-audit` no longer exists. Re-checked
2026-09-06 against the tree at `f89b5a8b`: migration `051_store_point_packs.sql`,
`internal/store/`, `internal/http/store_admin_handlers.go`, the player route
`app/store/page.tsx` and the office page
`app/(dashboard)/prediction-admin/store-packs/page.tsx` are all present, and the demo
deploy still sets `STORE_ENABLED=true` / `STORE_PROVIDER=demo`.
Backend live-smoked end to end (checkout →
confirm → exactly-once ledger credits → replay no-ops → webhook signature
enforcement); UI flows browser-verified with exact balance deltas; E2E
journeys automated in Playwright (`tests/smoke/journeys-*`). Sections marked
*[final]* are the implemented contract; §10 lists every guardrail-test
change made, with evidence.

## 0. Policy note (read first)

The repo's launch-economy rules (`docs/taptrade-economy-rules.md`) were written
for a **free-points** posture: "No fiat deposits", point packs as free
operator-configured grants, and money-route trees gated behind
`TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED` (a boot error in deployed envs).

The 2026-07-12 product brief explicitly directs a **purchasable point-pack
store** (closed-loop, video-game/social-casino model: money in, points out,
no cash-out ever) with a simulated checkout now and Stripe later. This
document implements that brief. The store is:

- a **new, demo-safe route tree** (`/api/v1/store/*`) behind a **new flag**
  (`STORE_ENABLED`), fully separate from the legacy cashier/payments trees,
  which stay retired and boot-blocked exactly as before;
- **one-way**: purchases credit non-redeemable gameplay points. There is no
  withdrawal, cash-out, redemption, or transfer path, and `pointMode`
  remains `non_redeemable_points`.

Where existing guardrail *tests* encode the old "points are never sold"
assumption and directly contradict the brief, they are updated **narrowly**
and each such change is listed in §10. Guardrails protecting things the brief
also wants (no cash-out, no legacy cashier routes, no `$`/money wording in
locale bundles, points-native API aliases) are kept green untouched.

## 1. Point denomination *[final]*

- 1 Point = $0.01 nominal platform value. 100 points = $1.00.
- Balances, ledger amounts, pack contents: **integer whole Points** on the
  wire (`*Points` fields, `unit: "PTS"`) and in Postgres (`*_points` BIGINT).
- Real-money purchase prices: **integer USD cents** (`priceUsdCents`,
  `price_usd_cents`) — deliberately cash-named per the migration-050
  precedent for genuine-money columns; never mixed into `*_points` fields.
- No floating-point arithmetic anywhere in wallet/ledger/purchase paths.
- UI: point balances render in the play currency's display name, Clout
  (`1,234 Clout`, tabular figures, since 2026-09-28 — `player/app/lib/points.ts`;
  this line said `pts` until 2026-09-29), never with `$`; purchase prices render as USD (`$25.00`) formatted client-side
  from `priceUsdCents` via `Intl.NumberFormat` — never stored in locale
  bundles (the 6-language locale scanner bans `$`/payment wording there).

## 2. Pack schema *[final]*

Table `store_point_packs` (goose migration `051_store_point_packs.sql`):

| column | type | notes |
|---|---|---|
| id | TEXT PK | slug, e.g. `starter` |
| name | TEXT | display name |
| price_usd_cents | BIGINT CHECK > 0 | real purchase price |
| base_points | BIGINT CHECK > 0 | points paid for |
| bonus_points | BIGINT CHECK >= 0 | promotional extra, shown separately |
| display_order | INT | sort |
| active | BOOLEAN | inactive packs never served |
| badge | TEXT NULL | e.g. `Popular`, `Best Value` — only real config |
| intro_only | BOOLEAN | first-purchase-only pack eligibility |
| promo_starts_at / promo_ends_at | TIMESTAMPTZ NULL | optional promo window |
| stripe_price_id | TEXT NULL | placeholder mapping for Stripe Checkout |
| created_at / updated_at | TIMESTAMPTZ | |

`totalPoints = basePoints + bonusPoints` is computed, never stored.

## 3. Seed catalogue *[final]* (easy to change: plain UPDATE/INSERT rows)

| id | name | price | base | bonus | badge |
|---|---|---|---|---|---|
| starter | Starter | $5.00 | 500 | 0 | Starter |
| player | Player | $10.00 | 1,000 | 50 | — |
| popular | Popular | $25.00 | 2,500 | 250 | Popular *(default highlight)* |
| pro | Pro | $50.00 | 5,000 | 750 | Best Value |
| high_roller | High Roller | $100.00 | 10,000 | 2,000 | — |

## 4. Purchase-state model *[final]*

Table `store_purchases`:

- `id` TEXT PK (crypto-random, `sp_` prefix)
- `user_id` TEXT NOT NULL (session-derived only, never from request body)
- `pack_id` + immutable snapshots: `price_usd_cents`, `base_points`,
  `bonus_points` (server-resolved from the pack row at checkout; client
  supplies only `packId`)
- `status` TEXT CHECK: `pending_payment → completed | failed | canceled`
  (terminal states final; only `pending_payment` rows may transition —
  same `canApply` pattern as the proven legacy webhook handler)
- `provider` TEXT (`demo` now, `stripe` later), `provider_session_id` TEXT
- `client_idempotency_key` TEXT, `UNIQUE(user_id, client_idempotency_key)` —
  double-submitted checkout POSTs return the same purchase
- `failure_reason`, timestamps, `completed_at`

Table `store_payment_events`: append-only provider-event evidence
(`purchase_id`, `event_type`, `provider_event_id` UNIQUE-when-present,
`signature_valid`, `received_at`, raw payload) — payment-event persistence
and replay audit trail.

## 5. Fulfillment + ledger + idempotency *[final]*

Fulfillment is **one function, one DB transaction** (pattern copied from the
legacy `DBPaymentService.HandleWebhook`, the battle-tested shape in this
repo):

1. `SELECT ... FOR UPDATE` the purchase row.
2. If already `completed`: return idempotent success (`alreadyFulfilled:
   true`), **no wallet ops** (duplicate confirmations/webhook replays are
   200-OK no-ops).
3. If not `pending_payment`: reject transition.
4. `wallet.Service.CreditWithTx` base points — idempotency key
   `store_purchase:<purchaseID>`, reason `point_pack_purchase`.
5. If bonus > 0: second `CreditWithTx` — key
   `store_purchase:<purchaseID>:bonus`, reason `promo_bonus`.
6. Flip status to `completed`, stamp `completed_at`, insert payment event.
7. Commit. (Wallet UNIQUE `(entry_type,user_id,idempotency_key)` is the
   second, independent double-credit backstop under the same tx.)

`failed` / `canceled` transitions: status flip + event row only — **no wallet
operations of any kind**. `pending_payment` purchases hold zero spendable
points (nothing is credited until fulfillment).

Constraints honoured (from the wallet subsystem audit):

- Reasons `point_pack_purchase` / `promo_bonus` are **new**, deliberately not
  in `isRewardGrantReason` — purchases don't consume the free-faucet
  `REWARD_DAILY_GRANT_LIMIT_CENTS` budget and don't run the free-grant
  device/IP cluster caps.
- Key prefix `store_purchase:` collides with no existing prefix and no
  mission/badge ledger-evidence matcher.
- Per-order keys (unlike the free `point_pack:<uid>:<packID>` once-ever key)
  so a user can buy the same pack repeatedly.
- Ledger mapping to the required entry shape: unique id (`le:<n>`), user,
  type (credit), integer amount, direction (encoded by type), balance-after
  stored + balance-before derivable (`after − amount`), reference
  type/id (encoded in the idempotency key + full detail on the
  `store_purchases` row), timestamp, status (purchase row), description
  (reason + purchase row). Purchased vs bonus points are distinguishable by
  reason (`point_pack_purchase` vs `promo_bonus`) in transaction history.

## 6. Provider abstraction *[final]*

```go
// internal/store/provider.go
type PaymentProvider interface {
    // CreateCheckoutSession registers a checkout attempt with the provider
    // and returns provider session details for the client.
    CreateCheckoutSession(ctx, req CheckoutSessionRequest) (CheckoutSession, error)
    // GetCheckoutStatus asks the provider for the current session state.
    GetCheckoutStatus(ctx, providerSessionID string) (CheckoutStatus, error)
    // HandlePaymentConfirmation validates a provider confirmation (demo
    // confirm call or verified webhook event) and maps it to a purchase
    // outcome. It never credits points itself.
    HandlePaymentConfirmation(ctx, conf ConfirmationInput) (ConfirmationResult, error)
}
```

- **DemoProvider** (`STORE_PROVIDER=demo`, default): deterministic simulator.
  Checkout sessions carry a demo token; outcomes are chosen on the demo
  checkout screen (`success` / `failure` / `cancel` / `delayed`).
  `delayed` leaves the purchase `pending_payment`; `GetCheckoutStatus`
  reports `completed` only after a fixed delay elapses, exercising
  pending → completed. Repeated success confirmations are idempotent.
- **Stripe (future)**: `STORE_PROVIDER=stripe` is recognized and refused at
  boot with "not implemented" — reserved seam. The integration point is:
  implement the interface with Stripe Checkout Sessions
  (`stripe_price_id` mapping), point the webhook route's verifier at
  Stripe's `Stripe-Signature: t=...,v1=...` scheme, and nothing about the
  store, wallet, or ledger changes.

**Trust boundary (both providers): points are only credited by server-side
fulfillment after a server-verified confirmation.** The browser redirect /
return URL and any client-supplied values are never sufficient: amounts come
from the server-side purchase snapshot, and the demo `confirm` endpoint is
authenticated, owner-checked, and conveys only an outcome for a purchase the
server created. `/api/v1/store/webhook` verifies HMAC-SHA256 signatures
(raw-body, ±5-min timestamp window — same shape as the legacy verifier)
against `STORE_WEBHOOK_SECRET`.

## 7. HTTP surface *[final]*

All under `/api/v1/store/`, registered **only when `STORE_ENABLED=true`**;
session-authenticated except the webhook:

| route | notes |
|---|---|
| `GET /api/v1/store/packs` | active catalogue + `firstPurchase` eligibility |
| `POST /api/v1/store/checkout` | `{packId, idempotencyKey}` → purchase + provider session; server resolves price/points |
| `GET /api/v1/store/purchases` | session user's purchase history |
| `GET /api/v1/store/purchases/{id}` | owner-or-admin status read |
| `POST /api/v1/store/purchases/{id}/confirm` | demo provider only; owner-only; `{outcome}` |
| `POST /api/v1/store/webhook` | HMAC-verified provider events; public + CSRF-exempt only under `STORE_ENABLED` |
| `GET /api/v1/admin/store/packs` | full catalogue incl. inactive (RBAC `finances:view`) |
| `POST /api/v1/admin/store/packs` | create pack (RBAC `finances:write`; validated; audit-logged) |
| `PUT /api/v1/admin/store/packs/{id}` | update pack (RBAC `finances:write`; validated; audit-logged) |

Boot rules (mirroring the legacy-flag hygiene): when `STORE_ENABLED=true` in
`ENVIRONMENT=production|staging`, `STORE_WEBHOOK_SECRET` must be non-empty
and not a known placeholder. Legacy money-route boundaries are untouched:
`/api/v1/payments/*` and cashier trees remain absent/404 at launch.

## 8. Store UX flow *[final]*

Entry points: TopBar balance chip + **Add Points** action (authed), Portfolio
and Rewards cross-links, and the TradeTicket insufficient-balance state which
becomes an actionable **Add Points** CTA carrying market context
(`/store?return=/market/<ticker>`).

Flow: `/store` (pack grid; base/bonus/total/price per card; badges from
config only; `popular` highlighted by default but every pack inspectable) →
select pack → order summary (pack, base, bonus, total, price, status) →
continue → **demo checkout screen, explicitly labeled as a simulated
checkout with no real charge** → outcome → result state:

- success: wallet credited exactly once → balance refresh (cache invalidation
  + Redux update so the TopBar updates immediately) → ledger entries visible
  in transaction history → "Return to market" when `return` context exists;
- failure: clear error + retry action, no points;
- cancel: back to summary, no points;
- delayed/pending: pending state with status re-check, points only on
  confirmed completion.

Buttons disable while processing (no double-submit); duplicate confirms are
server-side no-ops regardless.

No dark patterns: no fake timers, no fake scarcity, no fabricated
crossed-out prices; badges and promos render only from real pack config.

## 9. Required env for eventual Stripe *[final]*

```
STORE_ENABLED=true
STORE_PROVIDER=stripe            # currently refused at boot (reserved)
STORE_WEBHOOK_SECRET=            # webhook signature verification secret
STRIPE_SECRET_KEY=               # server-side only — NEVER set in this repo today
STRIPE_PUBLISHABLE_KEY=          # client key — NEVER set in this repo today
# per-pack stripe_price_id values in store_point_packs
```

No Stripe credential of any kind is added in this iteration; the demo
deploy runs `STORE_PROVIDER=demo`.

## 10. Guardrail changes made for the store *[verified — backend landed 2026-07-12 on `feat/store-and-perf-audit`]*

(Every existing guardrail test change lands here with file:line and reason.)

**Zero existing guardrail tests were modified.** All pinned expectations in
`cmd/gateway/main_test.go`, `internal/http/launch_boundary_test.go`,
`internal/http/launch_docs_test.go`, and
`cmd/launch-boundary-report/main.go` are byte-for-byte untouched and green
(`go test ./... -count=1` full pass; `go run ./cmd/launch-boundary-report`
with `STORE_ENABLED` unset: 21 probes, 0 failures). The boundary changes are
additive, each with a new pin:

| change | file:line | reason + new pin |
|---|---|---|
| `/api/v1/store/webhook` added to `gatewayPublicPrefixes()` **only when `STORE_ENABLED=true`** | `services/gateway/cmd/gateway/main.go:311` | Intended §10 change: providers must reach the webhook without a session; the handler HMAC-verifies before processing (mirrors the legacy `main.go` payments-webhook pattern). Pinned by `cmd/gateway/store_boundary_test.go` (`TestStoreWebhookNotPublicOrCSRFSkippedByDefault`, `TestStoreOptInOnlyExemptsTheWebhook`, `TestStoreWebhookRequiresAuthByDefault`, `TestStoreWebhookBypassesAuthAndCSRFOnlyWhenStoreEnabled`). |
| `/api/v1/store/webhook` added to `gatewayCSRFSkipPrefixes()` under the same flag | `services/gateway/cmd/gateway/main.go:332` | Same as above; interactive store routes stay session-authed + CSRF'd (`TestStoreCheckoutStillRequiresAuthenticationWhenEnabled`). |
| `store.ValidateRuntimeConfig` added to `validateGatewayRuntimeConfig` | `services/gateway/cmd/gateway/main.go:356` | Boot rules: enabled store in production/staging requires a non-empty, non-placeholder `STORE_WEBHOOK_SECRET` (mirrors the `PAYMENTS_WEBHOOK_SECRET` rule at main.go:360-367); `STORE_PROVIDER=stripe` refuses boot as "reserved, not implemented". Pinned by `cmd/gateway/store_boundary_test.go` (`TestValidateGatewayRuntimeConfigRequiresStoreWebhookSecretInDeployedEnvs`, `TestValidateGatewayRuntimeConfigRefusesStripeStoreProvider`, `...AllowsDormantStripeProviderVar`, `...AllowsDemoStoreWithoutSecretInDevelopment`) and `internal/store/config_test.go`. |
| `point_store` appended to `/api/v1/status` `launchRouteDomains` **only when enabled** | `services/gateway/internal/http/handlers.go:679` | `cmd/launch-boundary-report` asserts include/exclude sets, not an exact set; `point_store` is in neither, and with `STORE_ENABLED` unset the domain stays absent — so the pinned report assertions needed no change. Pinned both ways by `internal/http/store_boundary_test.go`. |
| Store tree registration behind `STORE_ENABLED` | `services/gateway/internal/http/handlers.go:446` + `internal/http/store_routes.go` | New flag, new tree; legacy money-route logic untouched. `internal/http/store_boundary_test.go` pins: all six store routes 404 when the flag is unset; enabling the store does NOT mount any legacy money route, does not add legacy domains, and anonymous store reads stay 403. |
| `/api/v1/store/*` paths + `Store*` schemas added to `api/openapi.yaml` | `services/gateway/api/openapi.yaml` | Written to pass the `TestLaunchDocsStayPointsOnly` banned-word scan (no `$`/USD wording; `priceUsdCents` camelCase key; "point pack purchase"/"checkout"/"price" prose; `*Points` + `unit: [PTS]` convention). No existing openapi slice markers touched. |

Evidence of the §5 fulfillment contract (all proven by `internal/store` tests
plus a live smoke on 2026-07-12 against Postgres 5434 + a gateway on :18089):
one-tx `SELECT FOR UPDATE` fulfillment; ledger shows exactly
`store_purchase:<id>` (reason `point_pack_purchase`) + `store_purchase:<id>:bonus`
(reason `promo_bonus`); duplicate confirm and webhook replays returned
`alreadyFulfilled: true` with no third credit; failed/canceled moved no
points; delayed completed only after the injected clock passed the delay;
both reasons pass `compliance.HasLaunchProhibitedCopy == false`
(`TestLedgerReasonsPassLaunchSafetyScrub`) and are excluded from the
free-grant reason set (`TestLedgerReasonsAreNotFreeGrantReasons`).

## 11. Security assumptions *[final]*

- Pack price/points resolved server-side from the catalogue; client sends ids
  and an idempotency key only.
- Purchase rows bind to the session user; confirm/status routes are
  owner-or-admin; the wallet never accepts client-set balances.
- Webhook is signature-verified, time-boxed, and replay-safe (purchase state
  machine + wallet idempotency).
- No card data of any kind touches this codebase (demo now; Stripe-hosted
  checkout later).
- Secrets stay server-side; nothing new enters client bundles beyond the
  public store API responses.

## 12. Responsible-play + jurisdiction integration (owner decision 2026-07-12)

Point-pack purchases **count toward responsible-play deposit limits** and
checkout is guarded by the jurisdiction gate on the deposit surface:

- Checkout creation checks `CheckDepositAllowed(user, priceUsdCents)` after
  server-side pack resolution and **before any purchase row or provider
  session exists** (in Stripe mode this is the last stop before real money
  moves — a captured payment is never refused fulfillment for limit
  reasons). Denials return 403 with the stable point-native reason code
  `purchase_limit_reached`; raw checker wording (which may contain legacy
  deposit/money vocabulary) never reaches launch clients.
- The **first** successful fulfillment records the spend
  (`RecordDeposit(user, priceUsdCents)`, best-effort); replays and
  failed/canceled outcomes record nothing (proven by tests via limit math).
- Amount semantics: the real-money price in integer cents (numerically equal
  to base points under 1pt = 1¢); promotional bonus points consume no
  headroom.
- Checker outages fail **closed** in production/staging and open (warn) in
  dev, mirroring the legacy payments posture.
- Known small gap (accepted, demo-mode): several concurrently-open pending
  checkouts each pass the limit check before any of them records.
- Seams (`store.RGLimits`, `store.ComplianceGate`) are nil-safe package vars
  wired in `internal/http/handlers.go`, matching the payments precedent.

## 13. Catalogue administration (owner decision 2026-07-12)

Office → **Point Packs** (`/prediction-admin/store-packs`, nav-gated on
`finances:view`): full catalogue table + create/edit forms for price, base,
bonus, badge, display order, active, first-checkout-only, promo window, and
the Stripe price-id placeholder. Gateway admin API (§7 table) registers only
with the store tree, enforces `finances:view`/`finances:write` RBAC (no new
permission rows), validates pack config server-side (positive integers, slug
ids, promo-window ordering, **launch-copy screening of name/badge**), and
audit-logs every mutation as `store.pack_created`/`store.pack_updated`.
Catalogue edits never touch purchases — completed rows keep their immutable
snapshots.

## 14. Demo deploy wiring (in-repo)

`docker-compose.demo.yml` sets `STORE_ENABLED=true`, `STORE_PROVIDER=demo`,
and `STORE_WEBHOOK_SECRET=${STORE_WEBHOOK_SECRET:?…}`;
`deploy-demo.yml` generates a fresh random secret into the box `.env` each
deploy (nothing external signs demo webhooks — it must merely be real and
non-placeholder). When Stripe lands, replace the generated value with a repo
secret carrying the provider's signing secret.
