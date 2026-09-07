# Tap Trade Economy Rules

## Purpose

Tap Trade uses non-redeemable gameplay points for prediction-market play. Points are an entertainment accounting unit only. They are not money, stored value, crypto, prizes, credits, or a claim on anything redeemable.

## Unit Model (corrected 2026-07-07)

**1 Point = 1 cent of in-platform play value.** This is a pricing convention only — Points are not money, cash, stored value, or anything redeemable.

- A market price displayed as 8¢ means **8 Points per contract** and an 8% implied probability.
- Buying 25 YES contracts at 8¢ costs **200 Points** before fees.
- A correct contract settles at **100 Points**; an incorrect contract settles at **0 Points**.
- Fees are computed on the Points spent on the fill (see the fee-model decision, 2026-04-24: `floor(fee_bps × price × (100 − price) × quantity / 1,000,000)`, flat 100 bps in v1, rounding down — peaking at 0.25 Points/contract at p=50).
- Balances, grants, rewards, and ledger entries are integer whole Points. There is **no sub-unit below the Point**; the retired "point-cents" abstraction (which treated stored integers as hundredths of a display-point) is a deprecated implementation detail and must not return.

## Non-Negotiable Constraints

- No fiat deposits. **(Amended 2026-07-12 — see the note below.)**
- No crypto deposits.
- No withdrawals or cashouts.
- No redeemable prizes.
- No cash-equivalent balances.
- No product copy implying points have monetary value.
- No external wallet connection required for gameplay.
- Every point movement must create an immutable ledger entry.

> **Amendment — the point store (2026-07-12).** "No fiat deposits" was written
> for a free-points posture. The owner brief of 2026-07-12 directs a
> **purchasable point-pack store**: closed-loop, video-game / social-casino
> model — money in, non-redeemable points out, **no cash-out ever**. It shipped
> as a separate route tree (`/api/v1/store/*`) behind its own `STORE_ENABLED`
> flag, with migration `051_store_point_packs.sql` and `internal/store/`, and is
> live on the demo box with `STORE_PROVIDER=demo`. Note the "Allowed Point
> Sources" section below already contemplates this ("Non-redeemable point packs,
> if sold or granted"). What "no fiat deposits" still means, and what remains
> non-negotiable, is that **no balance is redeemable and no value can leave the
> platform** — the legacy cashier, withdrawal, crypto and provider-callback
> trees stay absent and are a boot error in deployed environments. The full
> contract is `STORE_AND_PAYMENTS.md`; where this file and that one disagree
> about the store, that one is current.

## Launch Route Boundary

Launch builds must not register money-movement routes or render money-movement admin tools. Gateway routes for legacy cashier, deposits, withdrawals, payment methods/status/webhooks, crypto config/deposit addresses, and provider callbacks must be absent unless an explicit non-launch legacy flag is enabled. Deployed environments must reject that opt-in. Office/backoffice builds must not expose cashier pages, cashier navigation, admin payment operation actions, or cashier endpoint clients.

When legacy alpha cashier user or admin compatibility routes are explicitly
enabled outside launch mode, they remain private compatibility surfaces rather
than points-app features. The inherited route and struct contracts may remain
for preservation, but response rendering must copy rows and redact unsafe
restored free-text fields such as `failureReason`, `reviewNote`, unsafe legacy
token/network string values, and audit identifier/payload string values. User
compatibility deposit/release reads must redact unsafe `failureReason`,
`reviewNote`, and legacy token string response values without mutating raw
repository state. User config compatibility reads must redact unsafe legacy
string values such as token symbols while preserving inherited field names and
without mutating raw service config. Admin deposit/release compatibility reads
must redact unsafe legacy token string values without mutating raw row records.
Admin reconciliation compatibility reads must redact unsafe legacy token string
values without mutating raw service summaries.
Admin audit-event compatibility reads must redact unsafe legacy `subjectType`,
`eventType`, and payload string values without mutating raw audit rows. Admin
preflight/status compatibility reads must redact unsafe legacy operational
messages, metadata string values, and token/network fields without mutating raw
service reports. Admin approve/reject review notes must reject
launch-prohibited money wording before persistence or ledger release. Admin
compatibility error responses must keep inherited request field names where
needed, but must not render external-chain, crypto, fiat, cashout, payout, or
cash-equivalent wording.

## Allowed Point Sources

- Starter point grant on new account creation.
- Daily claim, subject to cooldown and abuse controls.
- Non-redeemable point packs, if sold or granted, with clear point-use and no-cashout disclosure.
- Mission/streak/reward grants.
- Admin adjustments for support, migration, testing, or abuse remediation, with audit reason.
- Settlement payouts in gameplay points.

## Account Creation Disclosure

Launch registration must require and persist both general terms acceptance and the points-only/no-cashout disclosure before an account can be created. The auth service should store accepted versions and timestamps for `taptrade-launch-v1` terms and `points-no-cashout-v1` disclosure, expose that evidence on the authenticated session, and keep starter-point grants as a separate idempotent ledger-backed wallet action after login. Starter grants must credit only the authenticated session user, use an operator-configured non-redeemable point amount, expose `PTS` response/ledger fields to launch clients, and remain idempotent under `starter_grant:{userId}` so sequential or concurrent retries do not add points twice.

## Allowed Point Uses

- Buy YES/NO positions.
- Reserve points for resting orders.
- Release points when orders are canceled, expired, rejected, or partially unfilled.
- Pay gameplay fees if configured and disclosed.
- Social/gameplay mechanics that consume points only when clearly non-redeemable.

Watchlists/favorites, series/tag browsing, admin taxonomy edits, and market-movement discovery metrics are discovery metadata only. Adding or removing a watched market, creating a category or tagged series, filtering by tag, opening a series page, or viewing a movement signal must not move points, imply point value, or create a reward unless a separate mission/reward rule writes an explicit point ledger entry. Live discovery proof should treat watchlist changes, tag/category filters, series pages, and movement rows as no-ledger journeys unless a separate reward claim is explicitly exercised and verified.

Activity-feed entries for comments, follows, trades, rewards, leaderboard movement, settlement, admin point-ledger inspection, admin market list review/export, admin risk snapshot review/export, social report moderation/export, or admin prediction activity review/export are reporting metadata. They must reflect existing source records such as `prediction_markets`, `prediction_trades`, `prediction_payouts`, `prediction_settlements`, `loyalty_ledger`, `leaderboard_snapshots`, moderation reports, or wallet ledger rows and must not create additional point movements. Trade activity and trade tape size labels must use point units, not dollars or cash notation, and activity feeds should show both buyer and seller perspectives when the persisted trade records include both sides. Market-list, discovery, market-detail, and risk snapshot APIs/exports must use point-accounting and returned-point language for launch-facing fields; moderation, activity, market-list, and admin CSV exports must keep user-provided text cells spreadsheet-formula-safe; any legacy compatibility alias is transitional and must not be documented as a cash-equivalent balance.

Badges and cosmetics are non-redeemable status metadata. They may be derived from existing source records such as `daily_claim`, `mission_reward`, `streak_reward`, first-prediction, prediction-regular, prediction-veteran, prediction-expert, streak-champion, monthly-streak, monthly-check-in, seasonal-check-in, quarterly-check-in, double-monthly-streak, and quarterly-streak wallet ledger rows, leaderboard-debut `leaderboard_snapshots` standing rows, and settled-result, settlement-regular, settlement-veteran, and settlement-expert `prediction_payout:*` settlement ledger rows, but viewing or earning badge status must not create points, imply point value, or create any redeemable prize path.

Leaderboards and loyalty admin tools must present points-only rank and reward configuration. Launch-facing leaderboard copy and API responses must use `unit: "PTS"`, point metric aliases, and non-redeemable `rewardSummary` language, not USD, prizes, or cash-equivalent rewards. Public/admin leaderboard responses must not emit retired `currency` or `prizeSummary` aliases; leaderboard create/update requests must reject those retired aliases before persistence. Loyalty standing, public tier, and admin account-review APIs must expose point-native XP/rank aliases such as `xp`, `xpPoints`, `rank`, `rankName`, `nextRank`, `nextRankName`, `xpToNextRank`, `minXpPoints`, and `unit: "PTS"` and must not emit retired tier/threshold/progress aliases such as `tier`, `tierName`, `currentTier`, `nextTier`, `nextTierName`, `pointsToNextTier`, `name`, or `pointsThreshold`; old loyalty payloads may be read only by private compatibility fallback code. Demo seed mode must recompute leaderboard snapshots from seeded settlements before exit so seeded leaderboards are real derived rows rather than static mock ranks. Loyalty accrual rules may translate inherited source keys for compatibility, but visible admin copy and preferred API aliases must describe prediction-settlement rewards, point-unit thresholds, and eligible prediction types through fields such as `predictionSourceType`, `minQualifiedPoints`, and `eligiblePredictionTypes`, not bets, stakes, or cents as money.

Loyalty ledger payloads must expose point-native settlement metadata for launch clients. Settlement-accrual entries should provide aliases such as `predictionSourceId`, `predictionId`, and `pointVolumeCents`, and reason text must describe prediction settlement rewards. Inherited metadata keys such as bet IDs or stake cents may remain inside internal services or snapshots only as compatibility details and must not be the preferred launch payload shape.

Order-book reservation and release rows are audit markers for available-point movement. They must keep total balance unchanged: `reservation` records points locked for a resting order, `release` records uncaptured points unlocked on cancel, expiry, or partial-fill remainder, and debit/credit rows record actual fills and seller proceeds. Launch balance, ledger, breakdown, and order APIs must expose point-native fields and `PTS` units for clients. Core wallet balance, ledger, and breakdown read responses must not emit legacy cents, real-money, bonus-fund, or cash-named aliases; old wallet read payloads may be read only by private compatibility fallback code. Launch clients must label normalized balance, ledger, and breakdown units as points, never as USD or another cash currency. Wallet/admin point-account error responses must use point-native wording such as `insufficient points` or point account mutation copy, not cash-like `funds`, money, cash, wallet-as-value-store, deposit, withdraw, crypto, fiat, or redeemable-value wording.

## Required Ledger Entries

Each entry must include user, delta, balance before, balance after, reason, reference type, reference id, timestamp, and idempotency key when initiated by a user action.

Required ledger reasons:

- `starter_grant`
- `daily_claim`
- `point_pack_grant`
- `mission_reward`
- `streak_reward`
- `admin_adjustment`
- `order_reserve`
- `order_capture`
- `order_release`
- `trade_fee`
- `settlement_payout`
- `market_cancel_refund`
- `abuse_reversal`

## Trading Model

Launch must use one explicit liquidity model per market:

- `order_book`: price-time priority with resting limit orders, market orders, reservations, and depth display.
- `amm`: virtual liquidity curve with honest AMM depth/price-impact display. AMM reserve/curve visuals may show current price, YES/NO reserves, subsidy, and curve K, but must not imply points are money or invent order-book levels.

The UI must never display synthetic order-book depth as real exchange depth. If a market is AMM-backed, it must be labeled and visualized as AMM depth. AMM impact quotes must come from the preview service or another backend quote source; read-only quotes do not move points and do not re-enable retired AMM order execution.

Launch seed/demo data may keep a launch-safe legacy AMM market solely so reviewers can verify the AMM detail surface, reserve/curve visualization, and preview-backed price-impact quotes. That fixture must remain quote-only in the user trade ticket, and demo-user order seeding must skip AMM markets. New launch market creation and normal user orders should use order-book markets unless a future AMM execution path is explicitly rebuilt, documented, and covered by ledger/reservation proof.

## Settlement Rules

Market resolution must be based on the pre-declared settlement source and rule. Admin override is allowed only with reason, actor, timestamp, and audit log. Settlement must be idempotent and replayable. Admin settlement responses must expose point-native disbursement aliases and `PTS` units; operation-level responses must use `pointDisbursements` and must not emit, document, or reattach the retired `payouts` array, while field-level/internal `payout` compatibility names remain transitional. Portfolio settlement history must render the actual settlement credit from the settlement row, not loyalty or XP accruals. Settlement notifications must use point/share wording rather than cash-equivalent or contract payout copy. Replay controls may only resume incomplete point disbursements and must not create duplicate point credits. Dispute-uphold and void flows must describe the operation as returning locked points or point disbursements, not as refunding stakes.

Launch market creation may only use manual/admin-manual settlement sources and binary outcome rules. Asset-price feeds, price-threshold rules, and market copy or metadata that references launch-prohibited asset/cashout terms must be rejected before persistence. Legacy automated feed adapters may remain in code for compatibility only when they are not registered by default, are protected by explicit non-launch opt-in, and are absent from office create-market controls and launch seed/demo data.

Persisted engine statuses may use legacy names, but launch admin surfaces must present the Tap Trade lifecycle mapping: draft, open, paused, closed, resolving, settled, and invalid. Admin market edits may update metadata, close/cutoff/source/rule parameters, and liquidity/fee configuration, but must not change status/result or move points; those remain lifecycle and settlement responsibilities. Lifecycle actions such as Open, Pause, Close, Cancel/Invalidate, Propose Resolution, Finalize, and Settle must not move points unless the underlying settlement/void logic writes the appropriate point ledger or settlement-disbursement records. Lifecycle audit views and exports must expose actor, reason, timestamp, metadata, and mapped stage so admin actions are reviewable. Stored lifecycle reason and metadata strings from restored/imported rows must be redacted at JSON/CSV response boundaries without mutating the raw audit row. CSV audit exports must keep text cells spreadsheet-formula-safe. Office operation copy must display points, not cash values.

## Abuse Controls

- Starter grant is once per account, credited only after authenticated account creation, and must be visible as a single `credit` row in the point ledger for the new user.
- Daily claim is credited only to the authenticated session user, uses an operator-configured amount, writes `daily_claim` to the point ledger, and is idempotent per user per UTC day. Reward grants may be capped by distinct users per configured device header and per client IP through `REWARD_DAILY_MAX_USERS_PER_DEVICE` and `REWARD_DAILY_MAX_USERS_PER_IP`; cluster evidence must be stored as hashed wallet-service device/IP markers outside the point ledger, schema-managed DBs must create that store through `048_wallet_reward_clusters.sql`, admins may review/export only hashed cluster summaries plus affected user IDs through `/api/v1/admin/wallet/reward-clusters` and office `/prediction-admin/reward-clusters`, idempotent same-user retries remain allowed, blocked clustered claims must not write point ledger rows, and raw device/IP signals must not be written to the point ledger or admin responses. Broader account-graph clustering and multi-node/live abuse proof are still required before launch.
- Point packs, missions, and streaks have idempotency keys. Configured point-pack grants are session-user-only, operator amount-configured, and one ledger credit per user/pack using `point_pack:{user}:{pack}` idempotency and `point_pack_grant` reason. Point-pack user surfaces must state that points are non-redeemable gameplay points and provide no cashout, withdrawal, crypto, fiat, or prize path. The daily check-in mission is completed from the existing `daily_claim` ledger key and credited once per UTC day using `mission_reward:{user}:daily_check_in:{date}` idempotency and `mission_reward` reason. The first-prediction mission is completed from existing `reservation:prediction_order:*` or `prediction_fill:*` ledger evidence and credited once per user using `mission_reward:{user}:first_prediction_order` idempotency and `mission_reward` reason. The three-predictions mission is completed from three distinct `reservation:prediction_order:*` or `prediction_fill:*` ledger evidence keys and credited once per user using `mission_reward:{user}:three_predictions` idempotency and `mission_reward` reason. The five-predictions mission is completed from five distinct `reservation:prediction_order:*` or `prediction_fill:*` ledger evidence keys and credited once per user using `mission_reward:{user}:five_predictions` idempotency and `mission_reward` reason. The ten-predictions mission is completed from ten distinct `reservation:prediction_order:*` or `prediction_fill:*` ledger evidence keys and credited once per user using `mission_reward:{user}:ten_predictions` idempotency and `mission_reward` reason. The settled-result mission is completed from existing `prediction_payout:*` settlement ledger evidence and credited once per user using `mission_reward:{user}:settled_result` idempotency and `mission_reward` reason. The three-settled-results mission is completed from three distinct `prediction_payout:*` settlement ledger evidence keys and credited once per user using `mission_reward:{user}:three_settled_results` idempotency and `mission_reward` reason. The five-settled-results mission is completed from five distinct `prediction_payout:*` settlement ledger evidence keys and credited once per user using `mission_reward:{user}:five_settled_results` idempotency and `mission_reward` reason. The ten-settled-results mission is completed from ten distinct `prediction_payout:*` settlement ledger evidence keys and credited once per user using `mission_reward:{user}:ten_settled_results` idempotency and `mission_reward` reason. The weekly check-in mission is completed from seven consecutive `daily_claim:{user}:{date}` ledger keys and credited once per user using `mission_reward:{user}:weekly_check_in` idempotency and `mission_reward` reason. The monthly check-in mission is completed from thirty consecutive `daily_claim:{user}:{date}` ledger keys and credited once per user using `mission_reward:{user}:monthly_check_in` idempotency and `mission_reward` reason. The seasonal check-in mission is completed from sixty consecutive `daily_claim:{user}:{date}` ledger keys and credited once per user using `mission_reward:{user}:seasonal_check_in` idempotency and `mission_reward` reason. The quarterly check-in mission is completed from ninety consecutive `daily_claim:{user}:{date}` ledger keys and credited once per user using `mission_reward:{user}:quarterly_check_in` idempotency and `mission_reward` reason. The leaderboard debut mission is completed from existing Predict `leaderboard_snapshots` standing evidence and credited once per user using `mission_reward:{user}:leaderboard_debut` idempotency and `mission_reward` reason. The 3-day, 7-day, 14-day, 30-day, 60-day, and 90-day check-in streaks are derived from consecutive `daily_claim:{user}:{date}` ledger keys and credited once per user using `streak_reward:{user}:daily_3`, `streak_reward:{user}:daily_7`, `streak_reward:{user}:daily_14`, `streak_reward:{user}:daily_30`, `streak_reward:{user}:daily_60`, and `streak_reward:{user}:daily_90` idempotency with `streak_reward` reason. Reward APIs must expose point-native aliases and `PTS` units for grant, claim, balance, reward, and limit amounts without `grantCents`, `claimCents`, `balanceCents`, `amountCents`, `rewardCents`, `limitCents`, `grantedCents`, or `remainingCents` response aliases; old reward payloads may be read only by private compatibility fallback code. `REWARD_DAILY_GRANT_LIMIT_CENTS`, when configured, caps new daily reward grants across `daily_claim`, `point_pack_grant`, `mission_reward`, and `streak_reward` ledger rows per user per UTC day; idempotent retries of already-recorded grants remain safe success responses.
- Reward user interfaces must render claimed/claimable state from persisted ledger evidence rather than local click state. Daily claim controls should become claimed once today's `daily_claim:{user}:{date}` evidence exists, point-pack controls should use the backend `claimed` flag derived from `point_pack:{user}:{pack}`, and mission/streak controls should refresh from the backend after reward writes so repeated clicks are visibly idempotent and cannot imply another point grant is available.
- If legacy bonus/campaign player endpoints remain registered during the transition, player-facing responses must expose only point-native aliases and `PTS` units for granted, remaining, required, completed, and progress amounts. Gateway JSON and exported launch-client bonus/progress/breakdown state must not emit, export, or reattach retired amount, wagering, real-money, bonus-fund, generic progress, or cash-unit aliases; old payload names may be read only by private compatibility fallback code. Launch clients must present these as point-play progress rather than wagering, cash, or redeemable value.
- If legacy bonus/campaign admin endpoints remain registered during the transition, campaign budgets, spent amounts, reward amounts, trigger thresholds, and contribution caps must expose only point-native aliases and `PTS` units. Gateway JSON must not emit raw campaign rules, raw rule configs, retired budget/spent fields, or retired rule amount keys; old request/internal names may remain compatibility-only and must not be documented as cash-equivalent value.
- Responsible-play point-use limits and prediction/order-size limits must use launch client helper names and launch-facing API routes. Requests, responses, check endpoints, restrictions summaries, and denied-limit reasons must expose point-native amount/limit aliases, stable point-native reason codes, and `PTS` units for launch clients. Launch responsible-play routes must reject retired request aliases such as `amountCents`, `stakePoints`, and `stakeCents`; those aliases may remain only on explicitly named legacy compatibility routes during the transition. Inherited deposit- or bet-named routes may remain as compatibility aliases during the transition, but compatibility endpoint names must not appear in launch copy or API documentation as player deposit or betting mechanics.
- Trading uses idempotent order placement and balance reservations. Order-book reservations must write point-ledger lock/unlock markers keyed by the prediction order, while captures and seller proceeds write trade-fill debit/credit rows. The client trade ticket must reject over-balance buys as points-only `Not enough points` states before submission; market buys may compare against previewed fill cost, but limit buys must compare the selected point amount against balance because unfilled resting amounts still reserve points. Order placement/read responses must expose `pricePoints`, `averageFillPricePoints`, `totalCostPoints`, `reservedPoints`, `capturedPoints`, `releasedPoints`, `filledCostPoints`, `notionalCapPoints`, and `unit: "PTS"` and must not emit, document, or reattach `priceCents`, `averageFillPriceCents`, `totalCostCents`, `filledCostCents`, `notionalCapCents`, `walletReservationId`, or retired cash-named reservation/capture/release aliases in launch JSON, launch OpenAPI, exported shared-client types, normalized player-app outputs, or player order UI. Launch clients, OpenAPI docs, session order APIs, preview APIs, and bot order APIs must send and accept only `pricePoints` for limit-order prices and `notionalCapPoints` for market-buy caps; retired request price/cap fields may remain only in lower-level private compatibility structs. Portfolio position responses must expose `totalCostPoints`, `realizedPoints`, and `unit: "PTS"` and must not emit, document, or reattach `totalCostCents` or `realizedPnlCents`; old position responses may be read only by private compatibility fallback code. Portfolio summary responses must expose point-native aliases such as `totalValuePoints`, `portfolioValuePoints`, `investedPoints`, `unrealizedPoints`, `realizedPoints`, and `unit: "PTS"` and must not emit, document, or reattach `totalValueCents`, `unrealizedPnlCents`, or `realizedPnlCents`; old summary responses may be read only by private compatibility fallback code. Portfolio settlement-history responses must expose `realizedPoints`, `settlementPoints`, and `unit: "PTS"` and must not emit, document, or reattach `payoutCents` or `pnlCents`; old history rows may be read only by private compatibility fallback code. Responsible-play denials returned by order placement must use prediction/responsible-play wording and stable reason-code details, even when the inherited service still reports bet-limit names internally.
- Order preview responses must expose preferred point-native aliases such as `pricePoints`, `totalCostPoints`, `feePoints`, `maxProfitPoints`, `maxLossPoints`, `totalCostWithFeesPoints`, `estimatedSlippagePoints`, and `unit: "PTS"` and must not emit, document, or reattach legacy preview price/cost/fee/result/slippage aliases in launch JSON, launch OpenAPI, exported shared-client types, normalized player-app outputs, or player preview UI. Old preview payloads may be read only by private compatibility fallback code. Preview endpoints are non-mutating quote surfaces and must not write point ledger, reservation, order, position, reward, or settlement rows.
- Trade tape and live fill payloads must expose point-native fields such as `pricePoints`, `feePoints`, `notionalPoints`, and `unit: "PTS"` without legacy trade price/fee aliases in launch JSON, launch OpenAPI, exported shared-client types, normalized player-app outputs, live fill payloads, or player trade-tape UI. Old trade rows may be read only by private compatibility fallback code. Trade reads are activity evidence from existing fills and must not create point movement.
- Market discovery, detail, and admin market payloads must expose point-native fields such as `yesPricePoints`, `noPricePoints`, `lastTradePricePoints`, `volumePoints`, `openInterestPoints`, `liquidityPoints`, `ammSubsidyPoints`, `collateralPoolPoints`, `settlementPoolPoints`, best-quote point aliases, and `unit: "PTS"` without legacy market price/activity/liquidity aliases in launch JSON, launch OpenAPI, exported shared-client types, normalized player/admin app outputs, or market UI consumers. Old market payloads may be read only by private compatibility fallback code. Reading or exporting market metadata must not create point movement.
- Market price-history payloads must expose point-native fields such as `yesPricePoints`, `volumePoints`, and `unit: "PTS"` without legacy history price/activity aliases in launch JSON, launch OpenAPI, exported shared-client types, normalized player-app outputs, or chart/discovery UI consumers. Old history payloads may be read only by private compatibility fallback code. Reading chart history is metadata only and must not create point movement.
- Order-book/depth payloads must expose point-native price/notional fields and explicit share-count fields through `pricePoints`, `shares`, `cumulativeShares`, `notionalPoints`, `totalNotionalPoints`, and `unit: "PTS"` only. Reading depth is metadata only and must not create point movement.
- Live market and order-book WebSocket payloads must expose the same preferred point-native aliases as their REST counterparts, including market price/activity aliases, best-quote point aliases, and `unit: "PTS"` without legacy live-frame price/activity or best-quote aliases. Receiving live frames is metadata only and must not create point movement.
- Admin dashboard market-activity payloads and launch OpenAPI docs must expose movement prices, movement volume, aggregate volume, and `unit: "PTS"` through point-native fields only. Reading dashboard activity is admin metadata only and must not create point movement.
- Admin drift-alert payloads and launch OpenAPI docs must expose maximum drift, total drift, and `unit: "PTS"` through point-native fields only. Reading drift alerts is admin reconciliation metadata only and must not create point movement.
- Admin risk snapshots and office risk dashboards are launch admin surfaces and must use the point-native risk contract directly: `pointAccounting`, `openPositionPointCostCents`, `maxSettlementPoints`, `reservedPoints`, `openPointCostCents`, and `maxReturnedPoints`. The gateway risk JSON must not emit retired money/cash compatibility aliases for this snapshot, office must not translate retired aliases into visible point-accounting UI, and missing point-accounting data should fail closed rather than silently falling back to legacy fields.
- Bot/partner trading APIs are proof and automation surfaces, not a bypass around the point economy. Bot-authenticated orders must use the same order-book reservation/capture/fill path as session orders, write the same `prediction_fill` ledger rows, update the same wallet balance and position tables, and remain subject to the same jurisdiction, responsible-play, and launch-money-route boundaries. Bot proofs do not replace the required session-authenticated browser/account-ledger proof for parity.
- Social actions use authenticated writes for comments, follows, reactions, and reports; reactions and follows are idempotent per user. Social write bursts are rate-limited per user/action through `SOCIAL_WRITE_RATE_LIMIT_PER_MIN` and `SOCIAL_WRITE_RATE_LIMIT_BURST`, and may also be rate-limited per client IP/action through `SOCIAL_WRITE_IP_RATE_LIMIT_PER_MIN` and `SOCIAL_WRITE_IP_RATE_LIMIT_BURST` to reduce multi-account bursts from a shared network. Blocked writes must not persist comments, reactions, reports, follows, ledger rows, rewards, or any redeemable value path. Report moderation is admin-gated, keeps reviewer metadata, resolves reports to reviewed or dismissed, and may export formula-safe moderation CSVs without creating any redeemable value path.
- Watchlists are authenticated per-user metadata and are idempotent for repeated add/remove actions.
- Bot/API access is rate-limited and cannot bypass compliance or point-reservation checks. Bot order routes must use the same request-validation and point-safe order-denial contracts as session order routes: required market/side/action/type/quantity fields, limit prices, exchange controls, and market-buy notional caps are validated before market lookup; responsible-play and prediction-limit denials return stable point-native reason codes, avoid inherited bet/stake wording, and stop before order persistence or point movement. Bot and partner key creation may only issue `read` and `trade` launch scopes; omitted scopes default to `read`, and wildcard/unknown scopes such as `admin` must be rejected before persistence.
- Admin adjustments require permissions and audit reason.

## Copy Rules

Use these terms:

- points
- starter points
- available points
- locked points
- point ledger
- prediction
- outcome
- rewards
- ranks

Do not use these terms on launch user surfaces:

- cash
- cashout
- deposit
- withdrawal
- fiat
- crypto
- wallet address
- redeem
- redeemable
- prize
- dollar value
- cents as money
- balance as stored value

Internal legacy database column names such as `balance_points` may remain temporarily, but user-facing copy and API documentation for launch must present points only.

Public homepage and marketing-adjacent market teasers must follow the same boundary. Example markets should use launch-safe local prediction topics such as politics, basketball, pageants, esports, MLBB, culture, or entertainment, and trust copy should describe outcome rules and settlement sources rather than payout, payment, crypto, fiat, or cash-value mechanics.

Bundled market fallback content and discovery category affordances are launch surfaces. Locale fallback values used for market titles, descriptions, category labels, featured carousel categories, subcategory navigation, and metadata must not introduce crypto assets, fiat/dollar price targets, cash-value language, payout/payment framing, or redeemable-prize wording. Compatibility keys may remain temporarily only when their rendered values are launch-safe and covered by parsed-value regression scans.

Supported launch-language locale bundles are also launch surfaces. Parsed rendered values in every JSON bundle under `public/static/locales/{en,id,ms,tl,zh-Hans,zh-Hant}` must avoid inherited deposit, withdrawal, cashier, casino, crypto, fiat, payout, payment, wager, stake, redeemable, prize, or cash-value wording, except where a required legal disclosure clearly denies the path rather than offering it. Technical regex strings may contain syntax such as `$` anchors, but those values must not be rendered as product copy.

Office/backoffice translation values are launch-adjacent admin surfaces. Parsed rendered values under `packages/office/translations/en` must avoid inherited deposit, withdrawal, cashier, casino, crypto, fiat, payout, payment, wager, stake, refund, freebet, wallet-as-stored-value, cents-as-money, or cash-value wording. Compatibility keys may remain temporarily only when their rendered values use point-account, point-ledger, bonus-rule, points-used, returned-points, or prediction language and are covered by parsed-value regression scans.

Gateway launch docs and OpenAPI descriptions are launch-facing documentation. They must describe points as gameplay subunits and must not document cashier, deposit, withdrawal, crypto, fiat, payout, dollar exposure, or sportsbook-era surfaces as launch behavior. Compatibility schema names may remain while handlers expose them, but descriptions, summaries, and README launch prose must use point/points-only language and be regression scanned. Admin market edit, lifecycle audit, lifecycle transition, and settlement replay docs must describe metadata edits, lifecycle status changes, formula-safe exports, and settlement point disbursements without implying external value. Responsible-play docs must describe session-bound point-use limits, prediction-size limits, decision checks, cool-off/self-exclusion statuses, restrictions, `PTS` aliases, and point-native reason codes without documenting inherited compatibility route names. Reward docs for daily claims, point packs, missions, streaks, badges, cosmetics, and reward limits must state that credits go only to the authenticated session user, expose `PTS` point aliases, and avoid any external-value path. Loyalty docs must describe session-scoped XP/rank standing, point-delta ledger rows, public rank tiers, admin account review, admin point adjustments, editable rank-tier config, and `PTS` aliases without documenting temporary external-value compatibility aliases. Reward-cluster admin docs must describe hashed device/IP signal summaries, distinct-user counts, formula-safe exports, raw-signal omission, and no point movement. Social API docs must describe comments, replies, reactions, reports, follows, profiles, activity, moderation, and formula-safe admin exports as metadata-only surfaces with no point movement or external value. Admin prediction risk docs must describe read-only settlement aging, point-cost concentration, point-accounting invariants, and formula-safe point-accounting exports without documenting temporary external-value compatibility aliases. Leaderboard docs must describe computed point ranking boards, authenticated self-standing lookups, `PTS` units, point metric labels, non-redeemable reward summaries, and background recompute acknowledgements without documenting temporary external-value compatibility aliases. Bot API docs must describe API-key order entry as an automation surface that shares session order validation, point-reservation and fill behavior, responsible-play reason codes, bot-key rate limits, and read-only point-backed positions. Bot-key management docs must describe user-owned key list/create/revoke and operator-issued partner-key issue/list as key metadata or audit surfaces with no point movement, one-time full-key display, owner-scoped revocation, self-serve production gating, read/trade-only scope issuance, wildcard-scope rejection before persistence, and RBAC-gated partner issuance. OpenAPI `$ref` syntax and `non-redeemable` denial phrasing are allowed.

Discovery taxonomy docs must describe public/admin categories, recurring series, and tags as launch-safe metadata-only discovery controls, including the rule that prohibited taxonomy terms are rejected before admin category persistence and that taxonomy reads/writes do not move points.

Admin account-review docs must describe account lists, account detail, point-account summaries, point-ledger inspection, settlement-history review, status updates, notes, and audit logs as admin review or metadata surfaces. Preferred launch schemas must expose `PTS`, `pointAccountBalanceCents`, `realizedPoints`, `settlementPoints`, `amountPoints`, and `balancePoints`; transitional wallet, P&L, payout, amount, or balance compatibility fields may remain only as non-preferred aliases. They must not document placeholder account actions as launch behavior, and account-review reads or notes must not imply point movement unless a separate audited admin adjustment endpoint writes an explicit ledger row.

Admin market-operation docs must describe market list/export, event creation, market creation, source provenance, and AI drafting token-budget checks as metadata, audit, or rate-limit surfaces. Market and event creation must not imply point movement; market list exports must use point-accounting fields and formula-safe CSV wording; AI drafting docs must describe token/rate limits rather than external value.

Settlement and dispute docs must describe direct settlement, proposed-resolution challenge windows, finalization, holder disputes, admin dispute review, and resolution-source health as point-disbursement, returned-locked-point, or read-only monitoring workflows. Preferred launch schemas must expose `PTS`, `pointDisbursements`, `settlementPoints`, `realizedPoints`, and `totalSettlementPoints`; operation-level `payouts` arrays must not be documented, and remaining field-level compatibility names may be named only as non-preferred aliases.

Gateway route tests for proposed-resolution settlement must cover the same trust boundary as the service tests: direct settlement cannot bypass an active challenge flow, the proposer cannot finalize their own proposal, holder disputes block finalization until reviewed, and second-admin finalization must expose point-disbursement aliases rather than external-value wording.

Gateway boot/middleware tests must also pin the launch no-money-path boundary before handlers run. In launch mode, legacy cashier, admin cashier, payment, crypto-payment, provider callback, and webhook paths must not be public prefixes and must not skip CSRF. Gateway runtime route-domain summaries, startup logs, and infrastructure metrics must not advertise legacy money domains or emit cashier/payment/crypto diagnostic collectors when those routes are absent; edge-auth and geo-gate diagnostics should describe guarded requests rather than money routes. Launch deployments must not require dormant payment-webhook secrets when the legacy route tree is absent; any explicit non-launch legacy opt-in may exempt only provider callback or webhook paths for signature-verified compatibility, while interactive legacy routes still require auth and CSRF, and that opt-in must require a real non-placeholder webhook secret. Alpha-cashier service enablement is part of the same legacy route boundary: `ALPHA_CASHIER_ENABLED=true` must be rejected unless `TAPTRADE_LEGACY_MONEY_ROUTES_ENABLED=true` is also present, and deployed environments must reject alpha cashier before boot. The same opt-in may restore legacy diagnostics only for that non-launch compatibility mode, but opt-in metrics should use legacy-route or guarded-request wording rather than money-route wording. Deployed environments must continue to reject that legacy opt-in before boot.

Backend discovery taxonomy is also a launch surface. Public and admin category lists must not expose inherited crypto taxonomy in launch mode, direct category lookups for launch-prohibited slugs must fail safely, and admin-created categories must reject crypto, fiat, cashout, withdrawal, payout, or asset-token framing. Fresh and migrated launch databases should seed launch-safe categories such as esports and deactivate inherited crypto compatibility rows unless a non-launch compatibility path explicitly needs them outside user/admin discovery.

Backend import and translation seeds must follow the same launch boundary. Upstream markets whose category, title, or description is crypto-like or asset-price-like should be skipped before promotion rather than recategorized into another launch category. Synthetic event category sets should use launch-safe categories such as esports, not inherited crypto buckets. Backend translation migrations and seeded market metadata must use the same launch-safe rendered copy as the app fallback bundles.

Prediction seed data is a launch surface. Fresh seeds and reruns must use launch-safe categories, manual settlement, binary outcome rules, point-safe wallet units such as `PTS`, and must clean or avoid inherited asset-price demo rows. Demo settlement phases that create `prediction_payouts` should refresh derived leaderboard snapshots in the same run so public boards, activity feed rows, and viewer standings reflect real seeded settlement data without waiting for a long-running server worker. Demo reward-history phases may seed prior-day `daily_claim:{demoUser}:{date}` ledger evidence only after the wallet schema exists, and must backdate transaction timestamps so today's reward-limit accounting is reserved for live user actions. Full demo seed cleanup must tolerate fresh migrated databases where runtime wallet-ledger compatibility tables do not exist yet, while still deleting demo ledger rows on rerun when those tables exist. Seed CLI summaries are also launch-adjacent copy: top-up, volume, balance, and open-market summaries must render visible amounts as `pts`, never as dollar-style or cash-equivalent amounts.

## Loop 164 Settlement Operation Rule

Admin settlement, finalization, and invalidation operation responses must use `pointDisbursements` as the launch array contract. They must not emit, document, or reattach the retired operation-level `payouts` array. Point-disbursement rows in those operation responses must expose `realizedPoints`, `settlementPoints`, and `unit: "PTS"` without `payoutCents` or `pnlCents`. Public portfolio and admin account-review settlement-history rows must follow the same point-native field rule and must not emit, document, or reattach `payoutCents` or `pnlCents`. Temporary internal storage names may remain only as compatibility details until the broader storage cleanup is completed.

## Loop 166 Portfolio History Rule

`/api/v1/portfolio/history` is a launch-facing player surface. It must expose explicit settlement metadata plus `realizedPoints`, `settlementPoints`, and `unit: "PTS"` only for settled result amounts. Gateway JSON, launch OpenAPI, exported shared-client types, and normalized player-app portfolio history objects must not emit or reattach `payoutCents` or `pnlCents`; old rows may be read only by private compatibility fallback code.

## Loop 167 Account-Review Settlement History Rule

`/api/v1/admin/punters/{id}/settlements` is a launch-adjacent account-review surface. It must expose explicit settlement metadata plus `realizedPoints`, `settlementPoints`, and `unit: "PTS"` only for settled result amounts. Gateway JSON, launch OpenAPI, and office account-review UI rows must not emit, document, or consume `payoutCents` or `pnlCents`; internal storage may keep legacy names until the broader repository cleanup.

## Loop 168 Account-Review Summary Rule

`/api/v1/admin/punters` and `/api/v1/admin/punters/{id}` are launch-adjacent account-review surfaces. They must expose point-account balance and settled-result summaries through `pointAccountBalanceCents`, `realizedPoints`, and `unit: "PTS"` rather than wallet/P&L compatibility aliases. Gateway JSON, launch OpenAPI, and office account-list/detail mapping must not emit, document, or consume `walletBalanceCents` or list-level `realizedPnlCents` for account-review summaries.

## Loop 169 Portfolio Summary Rule

`/api/v1/portfolio/summary` is a launch-facing player surface and may also appear inside admin account detail. It must expose portfolio value, invested points, unrealized result, realized result, and `unit: "PTS"` through point-native fields only. Gateway JSON, launch OpenAPI, exported shared-client types, normalized player-app summary objects, and player summary UI must not emit, document, or consume `totalValueCents`, `unrealizedPnlCents`, or `realizedPnlCents`; old summary payloads may be read only by private compatibility fallback code.

## Loop 170 Portfolio Position Rule

`/api/v1/portfolio` position rows are launch-facing player surfaces. They must expose position cost and realized result through `totalCostPoints`, `realizedPoints`, and `unit: "PTS"` only. Gateway JSON, launch OpenAPI, exported shared-client types, normalized player-app position objects, and player position UI must not emit, document, or consume `totalCostCents` or `realizedPnlCents`; old position payloads may be read only by private compatibility fallback code.

## Loop 171 Order Response Rule

`/api/v1/orders`, order-list reads, and bot/session order result rows are launch-facing trading surfaces. They must expose limit price, average fill price, order cost, filled cost, and market-buy cap through `pricePoints`, `averageFillPricePoints`, `totalCostPoints`, `filledCostPoints`, `notionalCapPoints`, and `unit: "PTS"` only. Gateway JSON, launch OpenAPI `Order`, exported shared-client `PredictionOrder`, normalized player-app order objects, and player order UI must not emit, document, or consume `priceCents`, `averageFillPriceCents`, `totalCostCents`, `filledCostCents`, `notionalCapCents`, or `walletReservationId`; old order payloads may be read only by private compatibility fallback code. Retired request price/cap inputs must be rejected by session order, preview, and bot order HTTP endpoints; launch OpenAPI, exported shared-client request types, player-app preview/place-order calls, and idempotency signatures must send and document `pricePoints` and `notionalCapPoints` only. `OrderPreview` response aliases are governed by the Loop 172 rule below.

## Loop 172 Order Preview Rule

`/api/v1/orders/preview` is a launch-facing quote surface. It must expose quote prices, estimated cost, fees, result bounds, post-preview prices, average fill price, total cost with fees, estimated slippage, and `unit: "PTS"` through point-native fields only. Gateway JSON, launch OpenAPI `OrderPreview`, exported shared-client `OrderPreview`, normalized player-app preview objects, AMM quote ladders, and TradeTicket preview UI must not emit, document, reattach, or consume `priceCents`, `totalCostCents`, `feeCents`, `maxProfitCents`, `maxLossCents`, `newYesPriceCents`, `newNoPriceCents`, `averageFillPriceCents`, `totalCostWithFeesCents`, or `estimatedSlippageCents`; old preview payloads may be read only by private compatibility fallback code. Request-side launch docs, exported clients, player-app calls, and the preview HTTP endpoint must use `pricePoints` and `notionalCapPoints` only; lower-level private compatibility may still parse old request structs outside the launch HTTP contract.

## Loop 173 Trade Tape Rule

`/api/v1/markets/{id}/trades` and live `trades:<marketID>` fill payloads are launch-facing activity surfaces. They must expose fill price, fee, notional, and unit through `pricePoints`, `feePoints`, `notionalPoints`, and `unit: "PTS"` only. Gateway JSON, live fill payloads, launch OpenAPI `Trade`, exported shared-client `Trade`, normalized player-app trade objects, and `RecentTrades` UI must not emit, document, reattach, or consume `priceCents` or `feeCents`; old trade payloads may be read only by private compatibility fallback code.

## Loop 174 Market Payload Rule

Central `Market` payloads from discovery, public market list/detail, admin market list/create/update, and related-market reads are launch-facing metadata surfaces. They must expose market prices, activity, liquidity, collateral pool, settlement pool, AMM subsidy, best quotes, and unit through point-native fields only. Gateway JSON, launch OpenAPI `Market`, exported shared-client `PredictionMarket`, normalized app/office market objects, live market-detail merge behavior, and market UI consumers must not emit, document, reattach, or consume `yesPriceCents`, `noPriceCents`, `lastTradePriceCents`, `volumeCents`, `openInterestCents`, `liquidityCents`, `ammSubsidyCents`, `collateralPoolCents`, `settledPayoutPoolPoints`, `settledPayoutPoolCents`, or best-quote `*Cents` aliases; old market payloads may be read only by private compatibility fallback code. Price-history, order-book/depth, admin dashboard activity, live frames, and request input compatibility are separate contracts.

## Loop 175 Price History Rule

`/api/v1/markets/{id}/prices` and `PricePoint` rows are launch-facing chart metadata surfaces. They must expose bucket price, fill activity, and unit through `yesPricePoints`, `volumePoints`, and `unit: "PTS"` only. Gateway JSON, launch OpenAPI `PricePoint`, exported shared-client `PricePoint`, normalized player-app history objects, market chart, hero price-history, and discover movement consumers must not emit, document, reattach, or consume `yesPriceCents` or `volumeCents`; old history payloads may be read only by private compatibility fallback code.

## Loop 176 Order Book Depth Rule

`/api/v1/markets/{id}/orderbook` and `OrderBookLevel` rows are launch-facing depth metadata surfaces. They must expose level price, share counts, notional depth, and unit through `pricePoints`, `shares`, `cumulativeShares`, `notionalPoints`, `totalNotionalPoints`, and `unit: "PTS"` only. Gateway JSON, launch OpenAPI `OrderBookLevel`, exported shared-client `OrderBookLevel`, normalized player-app order-book objects, and market-detail order-book UI must not emit, document, reattach, or consume `priceCents`, `quantity`, or `total` for depth rows; old depth payloads may be read only by private compatibility fallback code.

## Loop 177 Admin Dashboard Activity Rule

`/api/v1/admin/dashboard/volume`, `DashboardVolumeStats`, and `DashboardMover` are launch-adjacent admin metadata surfaces. They must expose aggregate activity, movement prices, mover activity, and unit through `totalVolumePoints`, `yesPricePointsStart`, `yesPricePointsNow`, `volumePoints`, and `unit: "PTS"` only. Gateway JSON, launch OpenAPI dashboard schemas, exported shared-client dashboard types, normalized office dashboard objects, and the office dashboard UI must not emit, document, reattach, or consume `totalVolumeCents`, `yesPriceCentsStart`, `yesPriceCentsNow`, or `volumeCents`; old dashboard payloads may be read only by private compatibility fallback code.

## Loop 178 Admin Drift Alert Rule

`/api/v1/admin/prediction/drift-alerts` and `CollateralDriftAlert` are launch-adjacent admin reconciliation metadata surfaces. They must expose maximum drift, total drift, and unit through `maxDriftPoints`, `totalDriftPoints`, and `unit: "PTS"` only. Gateway JSON, launch OpenAPI drift schemas, exported shared-client drift types, normalized office drift objects, and office market/settlement drift warnings must not emit, document, reattach, or consume `maxDriftCents` or `totalDriftCents`; old drift payloads may be read only by private compatibility fallback code.

## Loop 179 Live Market Frame Rule

Live `market:<id>` update frames and `orderbook:<id>` hint frames are launch-facing metadata surfaces. They must expose market price/activity and best-quote fields through `yesPricePoints`, `noPricePoints`, `lastTradePricePoints`, `volumePoints`, `openInterestPoints`, best-quote point aliases, and `unit: "PTS"` only. Gateway live-frame builders and player-app source regressions must not emit or reattach `yesPriceCents`, `noPriceCents`, `lastTradePriceCents`, `volumeCents`, `openInterestCents`, `bestYesBidCents`, `bestYesAskCents`, `bestNoBidCents`, or `bestNoAskCents`; old live frames may be read only by private compatibility fallback code.

## Loop 180 Core Wallet Read Rule

`/api/v1/wallet/{userId}`, `/api/v1/wallet/{userId}/ledger`, and `/api/v1/wallet/{userId}/breakdown` are launch-facing wallet read surfaces. They must expose balances, available/reserved points, ledger deltas, and breakdown buckets through `balancePoints`, `availablePoints`, `reservedPoints`, `amountPoints`, `basePoints`, `bonusPoints`, `totalPoints`, and `unit: "PTS"` only. Gateway JSON, normalized player-app wallet/breakdown outputs, and source regressions must not emit, export, reattach, or consume `balanceCents`, `availableCents`, `reservedCents`, `amountCents`, `realMoneyCents`, `bonusFundCents`, `totalCents`, or `currency` for these read responses; old wallet read payloads may be read only by private compatibility fallback code. Reward response aliases are covered by the Loop 181 rule.

## Loop 181 Reward Response Rule

`/api/v1/wallet/starter-grant`, `/api/v1/wallet/daily-claim`, `/api/v1/wallet/point-packs`, `/api/v1/wallet/point-packs/claim`, `/api/v1/wallet/missions`, `/api/v1/wallet/missions/claim`, `/api/v1/wallet/streaks`, `/api/v1/wallet/streaks/claim`, and `/api/v1/wallet/reward-limits` are launch-facing reward surfaces. They must expose reward amounts, granted/claimed points, balances, pack amounts, mission/streak rewards, and daily reward-limit totals through `grantPoints`, `claimPoints`, `balancePoints`, `amountPoints`, `rewardPoints`, `limitPoints`, `grantedPoints`, `remainingPoints`, and `unit: "PTS"` only. Gateway JSON and normalized player-app reward outputs must not emit, export, reattach, or consume `grantCents`, `claimCents`, `balanceCents`, `amountCents`, `rewardCents`, `limitCents`, `grantedCents`, or `remainingCents`; old reward payloads may be read only by private compatibility fallback code.

## Loop 182 Leaderboard Response Rule

`/api/v1/leaderboards`, `/api/v1/admin/leaderboards`, and leaderboard detail/recompute responses are launch-facing rank surfaces. They must expose leaderboard point units, metric labels, and reward copy through `unit: "PTS"`, `pointMetricKey`, and `rewardSummary` only. Gateway JSON and office leaderboard admin source must not emit, export, reattach, or consume retired `currency` or `prizeSummary` response aliases; leaderboard create/update request parsing must reject those retired aliases before persistence.

## Loop 183 Loyalty Standing/Tier Response Rule

`/api/v1/loyalty`, `/api/v1/loyalty/standing`, and `/api/v1/loyalty/tiers` are launch-facing rank surfaces. They must expose XP/rank values through `xp`, `xpPoints`, `rank`, `rankName`, `nextRank`, `nextRankName`, `xpToNextRank`, `minXpPoints`, and `unit: "PTS"` only. Gateway JSON, launch OpenAPI loyalty standing/tier schemas, exported player-app loyalty types, and rewards/header UI consumers must not emit, document, export, reattach, or consume retired `tier`, `tierName`, `nextTier`, `nextTierName`, `pointsToNextTier`, `name`, or `pointsThreshold` response aliases; old loyalty payloads may be read only by private compatibility fallback code.

## Loop 184 Admin Loyalty Account Rank Rule

`/api/v1/admin/loyalty/accounts` and `/api/v1/admin/loyalty/accounts/{playerId}` are launch-adjacent account-review rank surfaces. They must expose account progress through `rank`, `rankName`, `nextRank`, `nextRankName`, `xpToNextRank`, and `unit: "PTS"` only. Gateway JSON, launch OpenAPI `AdminLoyaltyAccount`, and office loyalty list/detail pages must not emit, document, export, reattach, or consume retired account progress aliases such as `currentTier`, `nextTier`, or `pointsToNextTier`; `tierCode` may remain only as an old filter/config identifier for editable tier-configuration routes.

## Loop 185 Player Bonus Point Contract Rule

`/api/v1/bonuses/active`, `/api/v1/bonuses/claim`, `/api/v1/bonuses/{id}`, and `/api/v1/bonuses/{id}/progress` are launch-facing bonus compatibility surfaces while they remain registered. They must expose player bonus amounts and progress through `grantedPoints`, `remainingPoints`, `playRequiredPoints`, `playCompletedPoints`, `playProgressPct`, and `unit: "PTS"` only. Gateway JSON, exported player-app bonus/progress types, normalized outputs, Redux bonus state, and wallet-breakdown state must not emit, export, reattach, or consume retired aliases such as `grantedAmountCents`, `remainingAmountCents`, `wageringRequiredCents`, `wageringCompletedCents`, `wageringProgressPct`, snake_case equivalents, `progressPct`, `realMoneyCents`, `bonusFundCents`, or `totalCents`; old payload names may be read only by private compatibility fallback code.

## Loop 186 Admin Campaign Point Contract Rule

`/api/v1/admin/campaigns`, `/api/v1/admin/campaigns/{id}`, and campaign create/detail responses are launch-adjacent admin bonus compatibility surfaces while they remain registered. They must expose campaign budgets, spend, and rule amount thresholds through `budgetPoints`, `spentPoints`, sanitized `pointRuleConfig`, and `unit: "PTS"` only. Gateway JSON must not emit, document, or reattach retired aliases such as `budgetCents`, `spentCents`, raw campaign `rules`, raw `ruleConfig`, `max_bonus_points`, `fixed_amount_points`, `max_stake_contribution_points`, or `min_amount_points`; old request/internal names may remain only as service/storage compatibility during the transition.

## Loop 187 Bonus/Campaign OpenAPI Rule

Launch OpenAPI must document the registered player bonus, admin campaign, and admin bonus compatibility routes only through point-native response contracts. Player bonus schemas must expose `unit: "PTS"`, `grantedPoints`, `remainingPoints`, `playRequiredPoints`, `playCompletedPoints`, and `playProgressPct` without retired amount, wagering, or generic progress aliases. Admin campaign schemas must expose `unit: "PTS"`, `budgetPoints`, `spentPoints`, and sanitized `pointRuleConfig` without documenting raw campaign `rules`, raw `ruleConfig`, retired budget/spend aliases, or retired rule amount keys. Old request/internal names may remain compatibility-only until the service/storage cleanup reaches them, but they must not be promoted into the launch OpenAPI as preferred contracts.

## Loop 188 Bonus/Campaign Request Alias Rule

Admin campaign create and admin bonus grant requests must use point-native request fields in launch-facing clients and docs. Campaign create requests must use `budget_points` and `rules[].point_rule_config`; admin bonus grant requests must use `override_points`. Gateway request handling may normalize those aliases into existing internal fields after the HTTP boundary, but retired HTTP request fields must not be accepted as the launch contract. Launch OpenAPI must document the preferred point-native request schemas only, while old internal names remain private service/storage compatibility.

## Loop 189 Active Bonus Rewards UI Rule

The launch rewards page must surface active bonus progress as point-play progress, not wagering or cash-equivalent value. Active bonus UI should load through the point-native bonus client, render `remainingPoints`, `playRequiredPoints`, `playCompletedPoints`, `playProgressPct`, and `unit: "PTS"` semantics, and avoid consuming or displaying retired amount/wagering aliases. The active-bonus panel is informational progress state; it must not imply withdrawals, cashout, or redeemable value.

## Loop 190 Demo Active Bonus Seed Rule

Demo seed mode should include one active point-play bonus grant for the demo user so reviewers can see active bonus progress on `/rewards` without manual admin setup. The seeded campaign and player bonus must be scoped to `demo-seed` metadata so cleanup/wipe removes them deterministically, must use point-play display copy, and must not create wallet credits, external-value balances, or redeemable value. The demo bonus is progress evidence only; real reward claims remain ledger-backed through the wallet reward endpoints.

## Loop 191 Demo Active Bonus API Proof Rule

The demo active-bonus seed values and `/api/v1/bonuses/active` response mapper must stay aligned around point-play semantics. The seeded demo bonus should remain a positive, partially used point-play grant with deterministic progress, and the player bonus API response must expose it through `unit: "PTS"`, `remainingPoints`, `playRequiredPoints`, `playCompletedPoints`, and `playProgressPct` only. Retired amount, wagering, or generic progress aliases must not reappear in the launch-facing active-bonus response.

## Loop 192 Active Bonus Endpoint Rule

`/api/v1/bonuses/active` must enforce the authenticated session boundary before returning active bonus progress. The handler must list active bonuses for the session user and return a `bonuses` array whose rows use `unit: "PTS"`, campaign copy, `remainingPoints`, `playRequiredPoints`, `playCompletedPoints`, and `playProgressPct` only. Endpoint-level tests should fail if retired amount, wagering, or generic progress aliases reappear in the active-bonus JSON response.

## Loop 193 Bonus Detail Ownership Rule

`/api/v1/bonuses/{id}` and `/api/v1/bonuses/{id}/progress` must enforce ownership before returning player bonus details or progress. A session user may read only their own bonus rows, and progress responses must use `unit: "PTS"`, `playRequiredPoints`, `playCompletedPoints`, and `playProgressPct` only. Endpoint-level tests should fail if non-owners can read another player's bonus or if retired wagering/generic progress aliases reappear.

## Loop 194 Bonus Claim Session Rule

`/api/v1/bonuses/claim` must bind bonus claims to the authenticated session user, not to any user identity supplied in the request body. Claim responses must use `unit: "PTS"`, `grantedPoints`, `remainingPoints`, `playRequiredPoints`, `playCompletedPoints`, and `playProgressPct` only. Endpoint-level tests should fail if body-supplied user identity can control the claim or if retired amount, wagering, or generic progress aliases reappear.

## Loop 195 Admin Bonus Actor Rule

Admin bonus grant and forfeit actions must bind operator identity to the authenticated admin session. `/api/v1/admin/bonuses/grant` may accept preferred point-native request aliases such as `override_points`, but it must set `GrantedBy` from the session and return point-play `PTS` bonus fields without retired amount/progress aliases. `/api/v1/admin/bonuses/{id}/forfeit` must set `ForfeitedBy` from the session and act on the requested bonus id. Endpoint-level tests should fail if request bodies can spoof admin actor identity or if retired bonus response aliases reappear.

## Loop 196 Windowed Resolution Dual-Control Rule

Proposed-resolution, holder-dispute, dispute-review, and finalization routes must preserve dual-control across every admin decision leg. The proposing admin must not finalize their own proposed result or review a holder dispute against that same proposed result; the dispute must remain open until another admin reviews it. Proposal responses should expose challenge-window metadata without point-disbursement or currency fields, and finalization responses must expose `unit: "PTS"` plus `pointDisbursements` without retired aliases such as `payouts`, `payoutCents`, `pnlCents`, `totalPayoutCents`, or `currency`.

## Loop 197 Identified Admin Resolution Rule

Windowed resolution actions require an identified admin actor even in development environments where anonymous admin bypass is enabled for other test/dev admin routes. Uid-less requests must not create proposed resolutions, finalize proposals, or move markets through the challenge-window flow, because `proposedBy: null` is reserved for system-proposed automation and must not be reachable from human admin HTTP actions.

## Loop 198 Settlement Audit Metadata Rule

Launch-facing settlement audit details should use point-native metadata names. Admin finalize, void, and settlement audit callbacks should record `totalSettlementPoints`, `pointDisbursementCount`, and `unit: "PTS"` rather than retired aliases such as `totalPayoutCents`, `payoutCount`, or `currency`. Internal database fields and Go struct names may remain compatibility details, but audit-log details exposed through admin surfaces should not promote them as launch contract fields.

## Loop 199 Settlement Record Contract Rule

Launch-facing settlement schemas and exported client types should expose settlement totals through `totalSettlementPoints` and `unit: "PTS"` only. `totalPayoutCents` may remain a private compatibility fallback while parsing old responses, but it must not appear in launch OpenAPI or exported TypeScript settlement record types. Source regressions should distinguish private legacy readers from exported launch contracts.

## Loop 200 Settlement Operation Runtime Rule

Admin settlement operation responses should map settlement records through an explicit launch DTO rather than embedding the raw settlement model. Runtime JSON should not expose internal disbursement cursor fields such as `payoutsTotal` or `payoutsCompleted`, nor retired totals such as `totalPayoutCents`; those values may remain internal storage/replay details. Launch responses should use `totalSettlementPoints`, `pointDisbursements`, `positionsSettled`, and `unit: "PTS"` where relevant.

## Loop 201 Office Recent Activity Point-Unit Rule

Office user recent-activity timelines are launch-adjacent account-review surfaces. Go timeline payloads may still contain old `currency` fields as private compatibility inputs, but normalized activity rows and rendered timeline tags must use `unit: "PTS"` and point wording only. Admin review UI must not translate old timeline currencies into cash symbols or use cash-themed glyphs for point activity.

## Loop 202 User App Money Formatter Retirement Rule

Launch user-app source must not ship generic fiat/currency formatter helpers or dormant site-setting contracts for fiat currency, deposits, withdrawals, or stake thresholds. Point-formatting helpers should stay local to point surfaces and render `pts`/`PTS`; any legacy money formatter file or site-settings action/selector that can reintroduce USD/EUR/GBP, deposits, withdrawals, or stake-limit wording must remain absent from the points-only app.

## Loop 203 User App Compliance Contract Rule

Launch user-app responsible-play clients and profile call sites must expose point-use and prediction-limit contracts only. Preferred request fields should be point-native, such as `dailyLimitPoints`, `weeklyLimitPoints`, `monthlyLimitPoints`, and `maxOrderPoints`, and API barrel exports should not advertise legacy deposit-limit, stake-limit, currency, or monthly-deposit helper names. Any gateway compatibility parsing must stay private and must not be re-exported as the launch app contract.

## Loop 204 Bonus Wallet Breakdown Unit Rule

Launch user-app bonus wallet-breakdown contracts must expose point units through `unit`, not `currency`. Normalized API outputs and Redux bonus state should contain `basePoints`, `bonusPoints`, `totalPoints`, and `unit` only; old `currency` values may be read only as private gateway compatibility input and must not be re-exported, stored, or rendered as the public launch contract.

## Loop 205 Wallet Balance/Ledger Unit Rule

Launch user-app wallet balance and ledger contracts must expose point units through `unit`, not `currency`. Exported `Balance` and `Transaction` types should normalize primary wallet and ledger responses to `unit: "PTS"` semantics, while old raw `currency` fields may exist only inside private legacy fallback input shapes and must not be returned from public wallet-client methods.

## Loop 206 User Preference Currency Retirement Rule

Launch user-app profile and notification preference contracts must not expose a currency preference. Preference requests should contain only communication settings, exported preference responses should omit currency, and any old raw `currency` value returned by a compatibility endpoint must be discarded during normalization instead of being stored or re-exported.

## Loop 207 Odds Preference Retirement Rule

Launch user-app settings must not expose sportsbook odds-format preferences or unused odds conversion utilities. Prediction market prices should be rendered through the point/probability display path, and dead settings such as `DisplayOddsEnum`, `oddsFormat`, betting preference selectors, and unused decimal/American/fractional odds utilities must remain absent from the points-only app.

## Loop 208 Responsible-Play History Label Rule

Responsible-play history UI must render normalized launch limit labels only. Old `deposit_limit` and `stake_limit` names may be normalized inside compatibility clients, but account history pages must not filter, label, or display those retired terms; visible rows should use point-use limits, prediction limits, session limits, cool-offs, and self-exclusions.

## Loop 209 Retired Prediction Store and Compliance Fixture Rule

Launch user-app state must not preserve dormant dollar-stake prediction contracts. Unused store slices or barrel exports that model `stakeUsd`, prediction stake setters, or prediction stake selectors must remain absent; active prediction order state belongs in the trade ticket and point-native order/preview APIs. Compliance-denial tests and comments should use active launch denial sources only: geo-gate jurisdiction copy and pretrade identity-verification copy. Legacy payment-handler or withdrawal KYC phrases must not be kept as launch fixture evidence.

## Loop 210 Retired Deposit-Limits Locale Rule

Launch user-app localization must not carry a dormant `deposit-limits` namespace. Responsible-play copy should live under launch-safe point-use, prediction-limit, responsible-gaming, or account namespaces, and retired `deposit-limits.json` files must not ship in locale bundles. Compatibility clients may normalize inherited backend source names privately, but visible i18n namespaces and shipped locale artifacts should not preserve deposit-limit framing.

## Loop 211 Point Ledger Movement Type Rule

Launch account-transaction and point-ledger presentation must render current point movement types only. User-app ledger helpers should label `credit`, `debit`, `reservation`, `release`, prediction order/fill/proceeds, settlement, and reward movements with point-native wording, and should not preserve explicit deposit or withdrawal type branches as accepted launch cases. Any backend compatibility normalization for old ledger rows must happen before launch presentation helpers receive rows.

## Loop 212 Prediction Order Validation Test Rule

Launch app tests must model prediction orders through point-native order concepts, not old bet-placement mirrors. Validation fixtures should cover point amounts, point-cent limit prices, gameplay point availability, binary prediction-order economics, and idempotent prediction-order keys. Retired stake, decimal-odds, and generic payout test contracts must not be kept as accepted launch behavior.

## Loop 213 Stack Smoke Prediction Order Rule

Full-stack smoke tests for the launch app must exercise prediction-order and point-wallet routes, not retired sportsbook bet placement paths. Use `/api/v1/orders`, `/api/v1/orders/preview`, and `/api/v1/wallet/{userId}` with point-native fields such as `notionalCapPoints`, `balancePoints`, `availablePoints`, and `unit: "PTS"`. Smoke tests should reject leaked cash-balance aliases and must not keep `/api/v1/bets`, stake-cents, odds precheck, or bet-placement language as accepted launch behavior.

## Loop 214 Reconciliation Tool Retirement Rule

Gateway command-line or reconciliation tooling must not replay retired sportsbook bet lifecycles. Tools and fixtures should not call `/api/v1/bets/place`, `/api/v1/admin/bets/{id}/lifecycle/*`, import historical-bets CSV exports, or preserve `stakeCents`, decimal odds, and bet settlement expectations. Launch reconciliation evidence should come from point-ledger, prediction-order, settlement, and point-wallet surfaces.

## Loop 215 Wallet Live Frame and Admin Mutation Rule

Runtime wallet and portfolio updates must use point-native aliases. Order-fill portfolio frames should publish `filledPricePoints` with `unit: "PTS"`, wallet frames should publish `balancePoints` with `unit: "PTS"`, and admin wallet mutation responses/audit details should return point ledger payloads without raw `balanceCents` aliases.

## Loop 216 Leaderboard Metric Alias Rule

Launch-facing leaderboard definitions must not expose inherited metric keys that imply money, stake, or cash accounting. Public/admin leaderboard JSON should emit `metricKey` and `pointMetricKey` as the same point-native aliases, such as `net_points` and `point_volume`, along with `unit: "PTS"` and non-redeemable `rewardSummary` copy. Any mapping to legacy scorer keys such as `net_profit_points` or `stake_points` must remain private to service compatibility and must not appear in leaderboard API responses.

## Loop 217 Admin Wallet Mutation Request Rule

Admin point-ledger adjustment requests must prefer `amountPoints` for credit and debit amounts. Legacy `amountCents` may be accepted only as old-request compatibility, and if both aliases are supplied they must match exactly or the request must be rejected with a point-native `amountPoints` validation detail. Admin wallet authorization tests, idempotency tests, and audit fixtures should use point adjustment reasons and point-native request fields instead of deposit, bet, money, or cash-balance wording.

## Loop 218 Provider-Ops Audit Naming Rule

Gateway audit helpers and comments for privileged admin operations must use provider-ops, point-accounting, point-wallet, settlement, or operator-action wording. Shared audit utilities must not preserve `money audit`, `money-moving`, or `recordMoneyAuditEntry` naming as the accepted launch contract. Renames should keep persisted audit behavior stable while making the backend terminology match the points-only economy boundary.

## Loop 219 Retired Promo Metrics Rule

Provider-ops audit entries and admin report placeholders must not serialize sportsbook promo fields. Dormant audit fields such as `freebetId`, `oddsBoostId`, and `freebetAppliedCents` must remain absent, and placeholder promotion usage reports must use point-campaign zero fields with `unit: "PTS"` rather than betting counts, stake cents, freebet usage, or odds-boost usage.

## Loop 220 Admin Wallet Reconciliation Report Rule

Admin wallet reconciliation reports are launch-adjacent point-accounting metadata surfaces. They may aggregate real ledger credits, debits, net movement, entry count, and distinct user count, but launch JSON must expose point-native fields such as `totalCreditPoints`, `totalDebitPoints`, `netMovementPoints`, and `unit: "PTS"`. Retired aggregate response names such as `totalCreditsCents`, `totalDebitsCents`, or `netMovementCents` may remain only inside the private wallet service and must not be forwarded by report handlers.

## Loop 221 Admin Report OpenAPI Rule

Launch OpenAPI documentation for admin report endpoints must match the point-native runtime contract. Wallet reconciliation docs must describe read-only point-accounting fields such as `totalCreditPoints`, `totalDebitPoints`, `netMovementPoints`, and `unit: "PTS"` without retired aggregate aliases. Point-campaign usage docs must describe the honest placeholder fields `pointRewardCampaigns`, `usersWithPointRewards`, `totalRewardPoints`, and `unit: "PTS"` without betting or promo-mechanic metrics.

## Loop 222 Bot Key Scope Documentation Rule

Launch bot and partner API key documentation must advertise only the scopes the runtime allows: `read` and `trade`. Security schemes, key metadata schemas, self-serve key creation docs, and operator partner-key docs must not imply an `admin` scope or any wildcard scope can be issued. Privileged or unknown scope rejection should remain documented as a trust-boundary control.

## Loop 223 Admin Account-Review Point-Ledger Docs Rule

Launch OpenAPI account-review ledger documentation must expose point-native ledger fields only. `AdminPointLedgerEntry` should document `amountPoints`, `balancePoints`, and `unit: "PTS"` for point deltas and balances, while retired `amountCents` and `balanceCents` aliases may remain only as private compatibility parsing or internal service fields and must not be documented as launch API response fields.

## Loop 224 Pretrade Compliance Fixture Rule

Launch-adjacent pretrade compliance tests and comments should exercise active prediction-order routes and guarded-surface language. Geo allowlist, trusted-edge, and KYC regressions should use `/api/v1/orders` with the trade surface, not cashier deposit-intent paths or deposit/withdraw fixtures. Legacy compatibility surface constants may remain for old callers, but launch HTTP tests must not treat those paths as the accepted safety proof.

## Loop 225 Place-Order Request Cap Rule

Launch order request surfaces must use `notionalCapPoints` for market-buy caps. The player trade ticket, market-detail preview/place-order handlers, idempotency signatures, exported shared-client request types, launch OpenAPI, session order API, preview API, bot order API, and launch validation error details must not send, accept, document, or require `notionalCapCents`. The old request cap may remain only as lower-level private compatibility parsing and private old-response fallback input, and must not be re-exported as the launch client contract.

## Loop 226 Place-Order Limit Price Rule

Launch order limit-price surfaces must use `pricePoints`. The gateway order JSON mapper, launch OpenAPI `Order` and `PlaceOrderRequest` schemas, exported shared-client order/request types, player trade ticket, market-detail preview/place-order handlers, idempotency signatures, bot/session order validation fixtures, session order API, preview API, bot order API, and launch validation error details must not send, accept, document, emit, or require `priceCents`. The old request/response price alias may remain only as lower-level private compatibility parsing or private old-response fallback input, and must not be re-exported as the launch client contract.

## Loop 227 Order Average Fill Price Rule

Launch order read surfaces must use `averageFillPricePoints` for filled-order average price. Gateway order JSON, launch OpenAPI `Order`, exported shared-client `PredictionOrder`, normalized player-app order objects, and player order UI must not emit, document, export, reattach, or consume `averageFillPriceCents`. The old response alias may remain only as private old-response fallback input, and the older `OrderPreview` backing field remains governed by the Loop 172 order-preview rule and custom point-native JSON.

## Loop 228 Order Reservation Identifier Rule

Launch order read surfaces must not expose wallet-named reservation identifiers. Gateway order JSON, launch OpenAPI `Order`, exported shared-client `PredictionOrder`, normalized player-app order objects, and player order UI must not emit, document, export, reattach, or consume `walletReservationId`. Internal services and persistence may keep `WalletReservationID` for reservation wiring, but launch clients should rely on point-native reservation/capture/release amounts and point-ledger markers rather than internal reservation IDs.

## Loop 229 Portfolio Price Alias Rule

Launch portfolio, position, and settlement-history price fields must use point-native aliases. Open positions should expose `avgPricePoints`; settled history and settlement disbursement rows should expose `entryPricePoints` and `exitPricePoints`; launch OpenAPI, exported TypeScript client types, normalized outputs, and portfolio UI must not emit, document, export, reattach, or render retired `avgPriceCents`, `entryPriceCents`, or `exitPriceCents` aliases. Older aliases may remain only as private compatibility fallback inputs or internal storage fields.

## Loop 230 Responsible-Play Prediction Check Rule

Launch responsible-play prediction checks must expose checked order size through `amountPoints` and `unit: "PTS"` only. `ResponsiblePlayCheckResponse`, `/api/v1/compliance/rg/check-prediction`, and launch docs must not emit or document retired `stakePoints` or `stakeCents` aliases. Old query aliases may remain only as private compatibility inputs for older callers.

## Loop 231 Bonus Contribution Amount Rule

Launch player-app bonus progress contracts must describe contribution history as point play, not stake. Exported `PlayContribution` rows should use `playAmountPoints` plus `contributionPoints`; old `stakePoints` or `stakeCents` names may be accepted only as private legacy response inputs before normalization and must not be re-exported through app types, state, or visible progress UI.

## Loop 232 Admin Campaign Point-Play Rule Config Rule

Launch admin campaign rule configs must describe contribution caps as point play. Public `pointRuleConfig` responses and OpenAPI docs should use `max_play_contribution_points`; `max_stake_contribution_points` and `max_stake_contribution_points` may remain only as private compatibility inputs or internal evaluator/storage keys and must not be documented as launch admin request or response fields.

## Loop 233 Admin Campaign Rule Type Rule

Launch admin campaign rule types must use point-play vocabulary. Public request docs and response payloads should expose the play-progress rule as `play`; inherited `wagering` may remain only as the private evaluator/storage rule type after request normalization and must not be documented as a launch admin rule type.

## Loop 234 Bonus Domain Event Amount Rule

Bonus grant and expiry domain events are launch-adjacent game-economy events and must expose point-native amount keys. `bonus.granted` should publish `amount_points` with `unit: "PTS"`, and `bonus.expired` should publish `forfeited_points` with `unit: "PTS"`. Retired generic keys such as `amount_points` and `forfeited_amount` may remain only in negative regression assertions or old-event compatibility adapters, not in newly published event payloads.

## Loop 235 Bonus Campaign Type Rule

Launch-facing bonus and campaign type fields must use point-game economy vocabulary. Player bonus and admin campaign responses should expose values such as `signup_bonus`, `custom`, `point_grant`, and `point_match`; inherited promo values such as `freebet_grant`, `freebet`, `cash`, or `deposit_match` may remain only in internal storage compatibility, mapper branches, or negative regression fixtures.

## Loop 236 Bonus Campaign Runtime Safety Rule

Bonus campaign creation, claim, and admin-grant paths must normalize inherited promo campaign types to point-native campaign types before persistence or player-bonus creation. Tap Trade launch bonus service code must not create freebet side effects from campaign claims; any old freebet-style campaign value may remain only as compatibility input that is converted to a non-redeemable point campaign.

## Loop 237 Bonus Admin Amount Alias Conflict Rule

Admin bonus and campaign internal write paths may reject old amount aliases as compatibility input, but the launch HTTP boundary should not accept those retired fields. If a lower-level compatibility path supplies both a retired amount field and its point-native replacement, the values must match exactly or the request must be rejected before persistence, wallet mutation, campaign lookup, or bonus creation. Error details should name the point-native field such as `budget_points` or `override_points`.

## Loop 238 Bonus Rule Config Amount Alias Conflict Rule

Admin campaign rule configs may accept retired nested amount keys only as compatibility input. If a rule config supplies both a retired amount key and its point-native replacement, values must match exactly or campaign creation must fail before normalization or persistence. This includes reward keys such as `fixed_amount_points`, `max_bonus_points`, and `min_points`, plus point-play contribution keys such as `max_play_contribution_points`.

## Loop 239 Bonus Admin Conflict Error Details Rule

Admin bonus and campaign HTTP errors for point-alias conflicts should use the standard bad-request envelope and include `details.field` with the relevant point-native field. Top-level campaign budget conflicts should report `budget_points`, admin bonus override conflicts should report `override_points`, and nested campaign rule config conflicts should report the clean point-native nested key without array-prefix text.

## Loop 240 Leaderboard Reward Summary Copy Rule

Admin leaderboard create/update requests must reject launch-prohibited reward-summary copy before persistence. Preferred `rewardSummary` input must not offer or imply cash, prizes, payouts, crypto, fiat, deposits, withdrawals, USD/dollar value, or redemption, and retired `prizeSummary` input must be rejected before persistence. Rejections should use the standard bad-request envelope with `details.field: "rewardSummary"`. Existing persisted inherited summaries may still be mapped to point-safe read responses for compatibility.

## Loop 241 Leaderboard Display Copy Rule

Admin leaderboard create/update requests must reject launch-prohibited display copy before persistence. Launch-visible `slug`, `name`, `description`, and `rewardSummary` inputs must not offer or imply cash, prizes, payouts, crypto, fiat, deposits, withdrawals, USD/dollar value, or redemption, and retired `prizeSummary` input must be rejected before persistence. Rejections should use the standard bad-request envelope with `details.field` set to the offending field. Existing persisted inherited reward summaries may still be mapped to point-safe read responses for compatibility, but newly authored public leaderboard URLs and display text must be point-safe at write time.

## Loop 242 Redeemable Copy Edge Rule

Leaderboard display-copy guards must reject redeemable-offer wording even when the unsafe term appears as `redeemable` rather than `redeem`. Explicit `non-redeemable` disclosure language is allowed and should not be treated as an offer of value. Rejections should continue to use the standard bad-request envelope with `details.field` set to the offending launch-visible leaderboard field.

## Loop 243 Bonus Campaign Display Copy Rule

Admin bonus campaign creation must reject launch-prohibited display copy before persistence. Campaign `name` and `description` inputs must not offer or imply cash, deposits, crypto, fiat, freebets, prizes, payouts, sportsbook mechanics, stakes, wagering, redemption, or redeemable value. Explicit `non-redeemable` point-play disclosure language is allowed. Rejections should use the standard bad-request envelope with `details.field` set to the offending campaign field.

## Loop 244 Bonus Rule Config Type Alias Rule

Admin bonus campaign rule responses must not echo inherited reward-config type values such as `freebet`, `cash`, `odds_boost`, or `deposit_match`. Launch-facing `pointRuleConfig.type` values should use point-native aliases such as `point_grant` or `point_match`; old values may remain only as private internal storage or compatibility inputs before response mapping.

## Loop 245 Campaign Activation Event Type Rule

Bonus campaign activation domain events must not echo inherited promo campaign type values. The `campaign.activated` payload should expose point-native `type` and `campaign_type` values such as `point_grant` or `point_match`, include `unit: "PTS"`, and keep old values such as `freebet_grant`, `freebet`, `cash`, `odds_boost`, and `deposit_match` only as private storage or compatibility inputs before event mapping.

## Loop 246 Campaign Trigger Event Rule

Admin bonus campaign trigger rule configs must use point-native event wording. Campaign creation should reject launch-prohibited trigger `event` values such as inherited money or betting events before persistence, and admin `pointRuleConfig.event` responses should map old stored event values to safe aliases such as `manual_review`, `prediction_order`, or `point_grant` rather than echoing the old trigger term.

## Loop 247 Campaign Eligibility Activity Rule

Admin bonus campaign eligibility rule configs must use point-native activity and rank wording. Campaign creation should reject retired `min_deposits` keys before persistence, and admin `pointRuleConfig` responses should map old stored `min_deposits` to `min_point_activity_count` and `tier_min` to `rank_min` rather than echoing inherited eligibility fields.

## Loop 248 Campaign Eligibility Rank Alias Rule

Admin bonus campaign eligibility rule configs must accept preferred `min_point_activity_count` and `rank_min` request keys at the launch boundary and normalize them into private evaluator storage before persistence. Retired `tier_min` keys should be rejected before campaign creation, with errors pointing admins to `rank_min`.

## Loop 249 Direct Claim Eligibility Verification Rule

Direct player bonus claims must not silently bypass eligibility rules that require verified point activity or rank review. If a campaign rule includes normalized activity or rank eligibility, the direct claim path should fail closed until that verification is explicitly wired, while admin grants remain the reviewed override path.

## Loop 250 Player Claim Eligibility Error Rule

Player-facing bonus claim errors for activity/rank eligibility review must use point-native review wording and must not expose backend method names, admin override implementation details, or internal wiring instructions. These failures should return a forbidden response rather than a generic internal error.

## Loop 251 Bonus Forfeit Event Amount Rule

Manual bonus-forfeit domain events must use the same point-native forfeited amount contract as bonus-expiry events. New `bonus.forfeited` payloads should expose `forfeited_points`, `unit: "PTS"`, and audit metadata such as reason and actor, and must not publish retired generic amount keys such as `forfeited_amount` or `amount_points`.

## Loop 252 Bonus Forfeit Consistency Rule

Manual bonus forfeiture must not mark a player bonus as forfeited or publish a `bonus.forfeited` event unless the point-wallet forfeiture mutation succeeds first. Wallet mutation failures should return a point-native service error and leave bonus status/event state unchanged.

## Loop 253 Bonus Forfeit Actual Amount Rule

Manual and expiry bonus-forfeit events must publish the actual point amount removed by the point-wallet ledger mutation, not merely the requested player-bonus remaining amount. If wallet forfeiture is capped by the available bonus-point bucket or removes zero points, `forfeited_points` should reflect that actual ledger amount.

## Loop 254 Bonus Validation Copy Rule

Bonus campaign validation errors that can reach admin/API callers must describe reward points and point-play rules in launch-facing terms. Internal inherited storage names such as wagering and generic cents wording must not be echoed for public `play` rule validation or reward point bounds.

## Loop 255 Bonus Forfeit Response Rule

Admin bonus-forfeit mutation responses must stay inside the point boundary. A successful forfeit response should include `unit: "PTS"` with the lifecycle status so admin clients and API documentation do not treat the mutation as a generic status update detached from the point-play economy.

## Loop 256 Campaign Lifecycle Response Rule

Admin point-play campaign lifecycle mutation responses must stay inside the point boundary. Successful activate, pause, and close responses should include `unit: "PTS"` with the lifecycle status so admin clients and API documentation preserve the non-redeemable point-play context.

## Loop 257 Campaign Close Event Rule

Campaign lifecycle domain events must preserve the point-play economy context. `campaign.closed` events should include mapped point-native campaign type aliases, `status: "closed"`, and `unit: "PTS"` rather than a bare campaign id or inherited promo type values.

## Loop 258 Campaign Pause Event Rule

Campaign pause transitions must publish a point-native lifecycle event. `campaign.paused` events should include mapped point-native campaign type aliases, `status: "paused"`, and `unit: "PTS"` so admin/game-economy event streams do not lose the non-redeemable point-play context.

## Loop 259 Campaign Activation Event Rule

Campaign activation events must include explicit point-play lifecycle status. `campaign.activated` events should include mapped point-native campaign type aliases, `status: "active"`, and `unit: "PTS"` so activation, pause, and close events share a consistent non-redeemable lifecycle contract.

## Loop 260 Scheduled Campaign Expiry Rule

Scheduled expired-campaign closure must preserve the same point-native lifecycle event contract as manual close. Batch expiry jobs should publish one `campaign.closed` event for each campaign they transition, with mapped point-native campaign type aliases, `status: "closed"`, and `unit: "PTS"` rather than returning only an aggregate count.

## Loop 261 Campaign Lifecycle Publisher Rule

Campaign lifecycle event publication should use a shared nil-safe point-native publisher. Manual activate, pause, close, and scheduled expiry close must preserve mapped lifecycle payloads when an event bus is present, while status transitions should not fail solely because event-bus wiring is absent in development or isolated service contexts.

## Loop 262 Bonus Event Publisher Rule

Bonus grant, manual-forfeit, and expiry event publication should use a shared nil-safe point-native publisher. Event payloads must preserve `PTS` amount contracts and audit metadata when an event bus is present, while wallet and bonus lifecycle mutations should not fail solely because event-bus wiring is absent after the point mutation succeeds.

## Loop 263 Campaign Rule Response Alias Rule

Admin campaign rule responses must not echo retired stake-named point-play contribution aliases from old stored configs. `pointRuleConfig` should map `max_stake_contribution_points` to the launch-facing `max_play_contribution_points` field and omit the retired key from admin JSON. Old stake-named keys may remain only as private compatibility input or storage details.

## Loop 264 Campaign Rule Alias Precedence Rule

When an admin campaign rule config contains both a preferred point-native field and a retired compatibility alias, launch responses must keep the preferred point-native value. Retired contribution aliases must not overwrite `max_play_contribution_points` during response sanitization, and they must remain absent from admin JSON.

## Loop 265 Campaign Rule Reward Type Write Rule

Admin campaign reward rule configs must store point-native reward type values. Retired promo `type` inputs such as `freebet_grant`, `freebet`, `cash`, `odds_boost`, and `deposit_match` must be rejected at the launch HTTP boundary and may remain only as lower-level compatibility inputs that normalize to `point_grant` or `point_match` before private persistence.

## Loop 266 Campaign Rule Point-Play Response Filter

Admin campaign rule responses must not expose inherited odds/parlay/sports-exclusion mechanics in launch `pointRuleConfig` payloads. Old stored keys such as `min_odds_decimal`, `parlay_multiplier`, and `excluded_sports` must be filtered from admin JSON unless a future point-native equivalent is explicitly designed and documented.

## Loop 267 Campaign Rule Point-Play Write Boundary

Admin campaign rule creation must reject inherited point-play mechanics before persistence. `point_rule_config` payloads containing `min_odds_decimal`, `parlay_multiplier`, or `excluded_sports` should fail with a structured field error rather than storing mechanics that are not part of the launch point-play economy.

## Loop 268 Campaign Rule Config Precedence Rule

When an admin campaign rule request includes both preferred `point_rule_config` and legacy `rule_config`, the preferred point-native payload must control launch validation and normalization. Legacy `rule_config` may remain a compatibility fallback only when `point_rule_config` is absent.

## Loop 269 Direct Claim Trigger Review Rule

Direct player bonus claims must not satisfy explicit campaign trigger rules by assertion. Triggered campaigns, including manual-review triggers, prediction-order triggers, and point-grant triggers, should fail closed on the direct claim endpoint until verified point activity or admin review has occurred through the appropriate path.

## Loop 270 Bonus Credit Failure Compensation Rule

Bonus claim and admin-grant wallet-credit failures after player-bonus creation must compensate repository state before returning. The service should release the campaign claim/budget reservation and mark the created bonus non-active so no active bonus row or campaign counter implies points were granted without a point-wallet ledger credit.

## Loop 271 Admin Wallet Mutation Request Rule

Admin wallet credit/debit mutations must use the point-native `amountPoints` request field. Retired `amountCents` and `amount_points` request bodies should fail before mutation execution so admin point adjustments do not preserve generic amount/cents compatibility at the launch API boundary.

## Loop 272 Leaderboard Write Contract Rule

Admin leaderboard create/update requests must use launch-facing point-status fields. New leaderboard writes should reject retired `currency` and `prizeSummary` fields, retired storage metric keys such as `net_profit_points` and `stake_points`, and any unit other than `PTS`; read paths may continue mapping old stored definitions to point-native response fields.

## Loop 273 Bonus/Campaign Write Contract Rule

Admin campaign create and admin bonus grant requests must use launch-facing point-play fields. New campaign/bonus writes should reject retired `budget_points`, raw `rule_config`, retired rule amount keys such as `fixed_amount_points`, `max_bonus_points`, `min_amount_points`, `max_stake_contribution_points`, and `max_stake_contribution_points`, retired promo campaign or reward `type` values such as `freebet_grant`, `freebet`, `cash`, `odds_boost`, and `deposit_match`, and retired admin grant `override_amount_points`; internal model normalization may continue mapping preferred launch aliases to private evaluator/storage fields.

## Loop 274 Order Request Contract Rule

Launch order request endpoints must reject retired order price/cap aliases before service normalization. Session order placement, order preview, and bot order placement must require `pricePoints` and `notionalCapPoints`; `priceCents` and `notionalCapCents` may remain only in lower-level private compatibility structs or old-response fallback readers, not as accepted launch HTTP request fields.

## Loop 275 Responsible-Play Request Contract Rule

Launch responsible-play mutation and decision endpoints must reject retired amount/stake request aliases before service normalization. `/api/v1/compliance/rg/point-use-limit`, `/api/v1/compliance/rg/prediction-limit`, `/api/v1/compliance/rg/check-point-use`, and `/api/v1/compliance/rg/check-prediction` must require `amountPoints`; `amountCents`, `stakePoints`, and `stakeCents` may remain only on explicitly named legacy compatibility routes such as `deposit-limit`, `bet-limit`, `check-deposit`, and `check-bet` while those routes exist.

## Loop 276 Loyalty Rule Contract Rule

Admin loyalty rule create/update endpoints must use launch-facing prediction and point fields. `/api/v1/admin/loyalty/rules` and `/api/v1/admin/loyalty/rules/{ruleId}` must require `predictionSourceType`, `minQualifiedPoints`, and `eligiblePredictionTypes`; retired rule fields such as `sourceType`, `minQualifiedStakeCents`, `eligibleSportIds`, and `eligibleBetTypes` must fail before service normalization. Admin loyalty rule responses and launch OpenAPI docs must expose point-native rule fields plus `unit: "PTS"` without echoing the retired canonical rule aliases.

## Loop 277 Loyalty Ledger Contract Rule

Player and admin loyalty ledger read surfaces must expose point-native prediction source metadata only. `/api/v1/loyalty/ledger`, admin loyalty account detail ledger rows, and admin loyalty adjustment responses should use `predictionSourceType`, `predictionSourceId`, sanitized metadata, and `unit: "PTS"`; retired `sourceType`, `sourceId`, old `bet_settlement`, `bet:`, `betId`, and `stakeCents` values may remain only in private storage or normalization inputs and must not be emitted or documented in launch JSON.

## Loop 278 Legacy Loyalty Standing Contract Rule

Every registered public loyalty standing route, including legacy fallback `/api/v1/loyalty`, must serialize the launch `LoyaltyStanding` contract. Responses should expose `userId`, `pointsBalance`, XP/rank fields, optional `lastActivity`, and `unit: "PTS"` without embedding canonical account aliases such as `accountId`, `playerId`, `currentTier`, `currentTierAssignedAt`, `nextTier`, `pointsToNextTier`, or `lastAccrualAt`.

## Loop 279 Legacy Loyalty Tier Contract Rule

Every registered public loyalty tier route, including legacy fallback `/api/v1/loyalty/tiers`, must serialize the launch `LoyaltyTier` contract. Responses should expose `rank`, `rankName`, `minXpPoints`, benefits, and `unit: "PTS"` without embedding canonical tier aliases such as `tierCode`, `displayName`, `minLifetimePoints`, `minRolling30dPoints`, `active`, or retired public aliases such as `tier`, `name`, and `pointsThreshold`.

## Loop 280 Admin Leaderboard Event Contract Rule

Admin leaderboard entry recording must use launch-facing activity source metadata. `/api/v1/admin/leaderboards/{id}/entries` should accept `activitySourceType` and `activitySourceId`, reject retired `sourceType` and `sourceId` request fields before service normalization, and return event payloads with activity source aliases plus `unit: "PTS"` instead of canonical leaderboard event source aliases.

## Loop 281 Leaderboard Standing Metadata Rule

Leaderboard standing read payloads must sanitize event metadata before launch JSON leaves the gateway. Public entries, public detail top entries, admin detail entries, recompute entries, and viewer-entry responses should expose PTS standing payloads and map old stored `betId`, `stakeCents`, `payoutCents`, `sourceType`, and `sourceId` metadata to `predictionId`, `pointVolumeCents`, `settlementPoints`, `activitySourceType`, and `activitySourceId`; new admin score writes must reject those retired metadata keys before persistence.

## Loop 282 Predict Leaderboard Board Threshold Rule

Public Predict leaderboard board definitions must expose point-volume qualification thresholds through `minVolumePoints` only. Gateway JSON, launch OpenAPI docs, and exported player-app leaderboard client types must not emit, document, export, or consume the retired `minVolumeCents` board field; internal recompute variables may keep private compatibility names until broader storage cleanup.

## Loop 283 Predict Leaderboard Board Alias Rule

Public Predict leaderboard board definitions must use the same launch rank aliases as other leaderboard surfaces. `/api/v1/leaderboards` should expose `metricKey`, `pointMetricKey`, `rewardSummary`, and `unit: "PTS"` for board definitions and must not emit, document, export, or consume the retired public board fields `metricLabel` or `qualificationMsg`; player UI fallback labels should remain point-safe.

## Loop 284 Leaderboard Locale Copy Rule

Player leaderboard locale values are launch-facing game-economy copy. Supported launch locale bundles should describe leaderboard point results with point-result wording such as Weekly Points and Net points, not P&L, profit, earnings, or translated profit/loss labels. Locale regression tests should cover the leaderboard namespace separately from broader money-path scans because profit/P&L wording is not always caught by deposit/withdrawal/cashout patterns.

## Loop 285 Portfolio And Account Locale Copy Rule

Portfolio, account, and result-stat locale values are launch-facing point-account copy. Supported launch locale bundles and UI fallback labels should describe realized results, board metrics, weekly result boards, and settled history columns as point results, not P&L, profit, earnings, or translated profit/loss labels. Locale regression tests should cover `portfolio`, `account`, and `win-loss-statistics` namespaces separately from broader money-path scans because profit/P&L wording is not always caught by deposit/withdrawal/cashout patterns.

## Loop 286 Sharpness Locale Copy Rule

Portfolio and leaderboard sharpness copy is launch-facing ranking copy. Supported launch locale bundles and UI fallback labels should describe sharpness as point efficiency on settled markets, not ROI, return on risk, return on investment, or translated investment-return wording. Locale regression tests should cover `portfolio` and `leaderboards` namespaces for those terms separately from broader money-path scans because investment-return wording is not always caught by deposit/withdrawal/cashout patterns.

## Loop 287 Office Account-Review Copy Rule

Office account-review and risk-report surfaces are launch-adjacent admin copy. They should describe account balances, settled results, and platform aggregate results as points or point results, not dollar balances, P&L, profit, or cash-formatted values. Regression tests should cover rendered office source and translation files directly when those strings live outside player locale JSON.

## Loop 288 Office Risk Report Prediction Copy Rule

Office risk-summary report values are launch-adjacent admin copy. Rendered labels should describe prediction activity, point boosts, bonus point usage, and point counts instead of bets, odds boosts, stakes, profit, or cash-style report wording. Legacy translation keys may remain compatibility identifiers until broader storage cleanup, but rendered values should stay point-native and regression-covered.

## Loop 289 Office Leaderboard Placeholder Rule

Office leaderboard creation forms are launch-adjacent game-economy admin surfaces. Example slugs, placeholders, and default copy should describe point-based standings, not profit races, cash prizes, P&L, ROI, or other investment-return framing. Regression tests should cover visible example values because they can shape newly authored leaderboard definitions.

## Loop 290 Office Audit Log Copy Rule

Office audit logs are launch-adjacent admin review surfaces. Rendered audit action, filter, and product labels should describe prediction activity, point boosts, or clearly legacy non-launch feeds, not bets, odds boosts, sportsbook products, stakes, payouts, or cash-style operations. Compatibility keys may remain private while rendered values and regression coverage stay point-native.

## Loop 291 Office Provider-Ops Copy Rule

Office provider-ops intervention forms are launch-adjacent admin operations surfaces. Rendered labels should describe prediction IDs, prediction settlement intervention, and prediction intervention audit logs, not bet IDs or bet-status language. Compatibility keys may remain private while rendered source and static locale values stay point-native and regression-covered.

## Loop 292 Office Translation Bet-Wording Rule

English office translation values should not render standalone bet, betting, or cashed-out wording, even in retired sportsbook-era modules that are redirected away from launch navigation. Rendered values should use prediction or closed wording while old keys may remain private compatibility identifiers until the retired modules are removed.

## Loop 293 Office Translation Odds-Wording Rule

English office translation values should not render sportsbook odds wording, even in retired sportsbook-era modules that are redirected away from launch navigation. Rendered values should use price or probability wording while old odds-named keys may remain private compatibility identifiers until the retired modules are removed.

## Loop 294 Office Translation Bettable-Wording Rule

English office translation values should not render inherited bettable market-state wording, even when old keys remain for compatibility. Rendered market lifecycle and error copy should describe prediction availability with phrases such as open for predictions, closed for predictions, or market is closed for predictions.

## Loop 295 Gateway Status Boundary Rule

Public gateway status should make the launch economy boundary inspectable without enabling inherited money routes. `/api/v1/status` should report non-redeemable point mode and default disabled legacy money routes, and its launch route-domain list should use point-safe labels while not advertising alpha-cashier, payment, or crypto-payment domains.

## Loop 296 Legacy Money Route Preservation Rule

Inherited cashier, payment, crypto-payment, and provider-callback implementations may remain in the codebase only as private/local compatibility artifacts behind explicit non-deployed opt-in. Launch registration must keep their interactive routes absent by default, not public, and not CSRF-exempt; even under local compatibility opt-in, only provider callbacks and webhooks may bypass auth/CSRF for provider delivery.

## Loop 297 Office Limit Unit Rule

Office point-limit controls may keep inherited private form/storage keys while they are being retired, but launch-facing labels and units must describe points. Admin limit inputs and rendered limit values should use point units such as `pts`, not dollar prefixes or other cash-style formatting.

## Loop 298 Discovery Taxonomy Fallback Rule

Player discovery helpers must not retain crypto-specific fallback display mappings. If inherited crypto taxonomy appears from older data, public discovery should filter it explicitly rather than relabeling it through category pills, top-mover inference, image hues, or featured-carousel copy.

## Loop 299 Preservation Boundary Rule

Inherited production internals should be preserved unless they expose a launch-facing money path or money-value message. Public routes, UI, client exports, locale bundles, OpenAPI schemas, and admin copy must obey the points-only launch contract; private storage keys, compatibility structs, normalizers, and service internals may retain old names while adapters keep the launch boundary point-native. Deleted operational proof tools, especially reconciliation or settlement replay artifacts, require point-native replacements before the related parity scenario can be marked Pass.

## Loop 300 Reconciliation Proof Rule

Reconciliation proof artifacts must be point-native. Fixtures and reports should use PTS ledger fields such as `amountPoints`, `prediction_order`, and `prediction_settlement`, and must reject retired request/ledger vocabulary such as `amountCents`, `stakeCents`, `betId`, deposit, withdrawal, cashier, crypto, fiat, USD, payout, or stake wording. Rebuilding proof tools is allowed and required, but restoring old bet-route or money-contract replay tools unchanged is not launch-compatible.

## Loop 301 Contract-Bound Proof Rule

Point reconciliation proof should be bound to current launch contracts, not just standalone fixture math. Reconciliation tests should read the authoritative gateway OpenAPI and handler sources for point-native order, wallet, and settlement fields, then assert the proof fixture uses the same contract vocabulary. This keeps proof tools aligned with the active launch API while preserving private compatibility internals behind adapters.

## Loop 302 Player Route Manifest Rule

The shipped player route tree must not contain money-path segments. Source-level route regressions and production build-manifest inspection should reject cashier, cashout, crypto, deposit, fiat, payment, prize, redeem, and withdrawal path segments across app pages and route handlers. Known private compatibility internals may remain outside the player route tree, but they must not become routable player app paths.

## Loop 303 Office Route Manifest Rule

The shipped office/admin route tree follows the same launch boundary as the player route tree. Office App Router pages and route handlers must not expose cashier, cashout, crypto, deposit, fiat, payment, prize, redeem, or withdrawal path segments. Admin operations may keep private compatibility identifiers while being retired or replaced, but prohibited money operations must not be reachable as shipped office routes.

## Loop 304 Gateway Launch Boundary Report Rule

Gateway launch-boundary proof should be runnable and route-backed. A proof command may instantiate the real gateway router in launch mode and probe inherited cashier, payment, crypto-payment, deposit, and withdrawal paths, but every prohibited path must return 404 and `/api/v1/status` must report non-redeemable points with legacy money routes disabled. This preserves private compatibility implementations while making the launch route boundary reviewable.

## Loop 305 Persisted Settlement Ledger Rule

Settlement proof must include persisted point-ledger behavior, not only fixture accounting. A closed market resolved through the production prediction settlement engine and wallet adapter must write the settlement header, payout rows, winner point-ledger credits, and resulting point balances in the migrated database, while losing positions must not receive settlement credits. This proof should preserve the existing settlement and wallet internals and verify the launch boundary through adapter behavior.

## Loop 306 Live No-Money Boundary Rule

Live launch-boundary proof must check running surfaces, not only source or build manifests. Player and office apps should return `404` or `410` for retired money-path routes before auth redirects, while gateway `/api/v1/status` should report non-redeemable point mode and disabled legacy money routes. A reusable live probe should cover positive launch pages, retired player/admin web paths, and inherited gateway cashier/payment/crypto-payment paths so compatibility internals can remain preserved without becoming reachable launch routes.

## Loop 307 DB Reward Cluster Rule

Reward abuse-control cluster evidence must work across gateway nodes, not only inside one process. DB-backed wallet services should store hashed device/IP signal evidence in `wallet_reward_clusters`, allow idempotent same-user retries, block a different user once a shared daily cluster reaches its cap, and keep raw device/IP values out of storage and admin summaries.

## Loop 308 Bonus Claim Ledger Rule

Player bonus claims must prove real point-ledger persistence, not only point-native response JSON. A successful `/api/v1/bonuses/claim` request must bind to the authenticated session user, create an active `player_bonuses` row, credit the point wallet through a `wallet_ledger` bonus entry keyed as `bonus-grant:<bonusId>`, update the bonus point balance, and return `unit: "PTS"` with point-native bonus fields only. Duplicate claims for the same user/campaign must fail without writing a second ledger credit, and body-supplied user identities must not receive bonus points.

## Loop 309 Active Bonus Rewards UI Rule

The rewards page must render active point-play bonuses from `/api/v1/bonuses/active` using point-native fields. Smoke coverage should require the seeded demo active bonus API payload and visible rewards panel, including `unit: "PTS"`, remaining/required/completed point-play fields, no retired bonus aliases, and a `Play progress` control. Rendered component regressions should also reject money, stake, withdrawal, fiat, crypto, deposit, or cash-style wording on the active-bonus panel.

## Loop 310 Live Rewards Proof Rule

Rewards proof should include a healthy authenticated browser run when local infrastructure permits. A valid live proof may use an isolated migrated and seeded database, but it must exercise the real auth setup, real player-app proxy, real gateway routes, and seeded demo reward data; component-only proof is not enough for live Scenario 9 evidence.

## Loop 311 Live Windowed Resolution Rule

Admin proposed-resolution proof must preserve the real authorization model. Live evidence should keep auth middleware and RBAC enabled, may seed missing disposable staff identities with existing roles, and must prove the proposer cannot self-review or self-finalize, open holder disputes block finalization, a second authorized admin resolves the dispute and finalizes, and final settlement responses remain PTS-native without retired payout or currency aliases.

## Loop 312 Dispute Bond Contract Rule

Dispute challenge-bond storage may retain inherited private `bond_points`/`BondCents` names, but launch-facing dispute JSON, OpenAPI, office types, and live proofs must expose `bondPoints` plus `unit: "PTS"` and must not emit `bondCents`.

## Loop 313 Admin Market AMM Subsidy Request Rule

Admin market create/update request payloads are launch-facing. They must use `ammSubsidyPoints` for optional AMM fixture subsidy point subunits and must reject retired `ammSubsidyCents` request bodies before service normalization. Private Go fields, SQL columns, and read-compatibility fallbacks may retain inherited AMM subsidy names while adapters keep launch OpenAPI, exported request types, and office request bodies point-native.

## Loop 314 Admin Account Ledger UI Rule

Admin account-review point-ledger UI is launch-adjacent. Office account ledger components must consume and render `amountPoints`, `balancePoints`, and `unit: "PTS"` from `/api/v1/admin/punters/{id}/wallet`; reusable render components must not expose `amountCents` or `balanceCents` as their public row contract. Older ledger aliases may be read only in private route/client compatibility normalizers while the broader storage cleanup continues.

## Loop 315 Player Market Activity Prop Rule

Player market-card activity is launch-facing point-volume copy. Market card components and active discovery/category callers should use `volumePoints` as their public prop contract and format it with point helpers; retired `volumeCents` aliases may exist only in private normalization or negative regression assertions. Next.js page modules should not export test-only UI helpers, because invalid page exports can hide otherwise-correct points-only reward surfaces behind a production build failure.

## Loop 316 Player Market Liquidity Prop Rule

Player market-card liquidity is launch-facing point-liquidity copy. Market card components and active discovery/category callers should use `liquidityPoints` as their public prop contract and format it with point helpers; retired `liquidityCents` aliases may exist only in private normalization or negative regression assertions.

## Loop 317 Trade Ticket Point Result Copy Rule

The active trade ticket may show an estimated point outcome for correct contracts, but launch-facing labels, i18n keys, comments, and trust copy should describe point results or points if correct, not payouts. Private settlement storage and historical type names may continue to be retired separately, but the order-review surface should avoid `PAYOUT`/`PAYOUT_IF_SIDE` keys and winning-contract receive wording.

## Loop 318 Order Preview Result Field Rule

Order preview responses are launch-facing trading review contracts. They should expose maximum correct-outcome point results as `maxResultPoints`, not as profit or payout fields. Private engine math and compatibility normalizers may keep inherited `MaxProfit` or `maxProfit*` reads when needed, but gateway JSON, OpenAPI, exported client types, and active UI/test contracts should use the point-result alias.

## Loop 319 Notification Preference Copy Rule

Player account preferences are launch-facing copy even when a setting is local-only or not yet persisted. Notification category keys and labels should use prediction-market and point-play language such as market results, price alerts, point bonus updates, missions, topics, series, followed markets, and closing windows. They should not expose retired betting, odds, sportsbook category, subscription, billing, or special-offer wording.

## Loop 320 Communication Settings Locale Rule

Shipped communication-settings locale values must follow the same prediction-market notification boundary as the active account page. Compatibility keys may stay stable for older callers, but rendered values should say market updates, prediction activity, resolved markets, point bonus updates, and followed-event market alerts rather than subscription, betting, match-resolution, made-bets, billing, odds, or sportsbook wording.

## Loop 321 Broad Locale Bet/Odds Copy Rule

Supported launch-language locale values must not ship standalone sportsbook-era bet, betting, odds, or sportsbook wording as rendered product copy. Compatibility keys may retain inherited names during migration, but values should use prediction, market, price, point-result, and point-limit language. Explicit legal or trust-boundary prohibitions may mention prohibited concepts only as prohibitions, and technical syntax such as password regular expressions must remain narrowly exempted.

## Loop 322 Preservation Checkpoint Rule

Deleted inherited artifacts must be classified before their related scenario can be treated as complete. Public money-path routes, UI, client exports, and locale bundles may stay absent when launch-prohibited, but deleted reconciliation, settlement, ledger, abuse-control, or admin-review proof tools require point-native replacements. Replacement evidence should name the new command, route, test, fixture, or live proof that preserves the old operational assurance under Tap Trade's non-redeemable points contract.

## Loop 323 Result History Locale Rule

Legacy result-history and esports locale bundles are launch-facing when shipped. Rendered values should describe events, markets, probability, point prices, categories, and point-ledger entries rather than sportsbook market types, odds-format labels, sportbook taxonomy, financial transactions, or cash-style ledger identifiers. Compatibility keys may stay unchanged until callers are migrated, but parsed values must remain point-native.

## Loop 324 Mock Seed and Placeholder Copy Rule

Mock chat seed messages, sample usernames, and admin placeholder examples are launch-facing when they ship in source-rendered UI. They should use point-native prediction-market examples from allowed launch categories and avoid sportsbook terms, crypto asset tickers, dollar thresholds, commodity-price examples, cashback examples, or any wording that implies redeemable value. Regression tests may keep retired strings only as negative assertions.

## Loop 325 Footer and Denial Copy Rule

Footer, legal-adjacent, geolocation, and denial messages are launch-facing even when they are short fallback strings. They should describe non-redeemable point prediction markets and prediction orders, not sports bets, betting availability, bet placement, default dollar amounts, or sportsbook-era account modules. Comments near active UI should follow the same vocabulary when they guide future behavior.

## Loop 326 Admin Tab State Naming Rule

Launch-adjacent admin UI state keys should follow the same vocabulary as rendered admin copy when they represent active point-native surfaces. Account-review trade history tabs should use `trades` or prediction-market terms rather than inherited `bets` keys, while truly private compatibility adapters may keep old tokens only where needed to read legacy data.

## Loop 327 Admin Limit Form Boundary Rule

Launch-adjacent admin limit forms should use point-use language in rendered labels, local state, and form fields. If an inherited API still expects a legacy stake-named enum, map to that enum only at the submit adapter boundary and guard the active UI against `editables.stake`, stake title keys, or dollar units.

## Loop 328 Admin Activity Type Rule

Office recent-activity output models should use prediction-native activity types such as `PREDICTION_ORDER` and `PREDICTION_RESULT`. Legacy timeline strings such as `BET_PLACEMENT` and `BET_WON` may be accepted only inside compatibility normalizers and must be mapped before reaching active renderers.

## Loop 329 Runnable Regression Rule

Launch-boundary regressions should live in the package's configured test include paths. When an old `__tests__` file is excluded by the active runner, migrate the useful coverage into `tests/` and remove stale excluded copies so evidence is runnable and does not preserve obsolete money or bet fixtures.

## Loop 330 Admin Audit Action Display Rule

Office audit-log rendering is launch-adjacent. Legacy stored action strings such as `bet.placed` or `bet.precheck.failed` may remain searchable compatibility input, but active display resolvers and translation keys should map them to prediction-order category/action labels before rendering. New runnable regressions for this boundary must live under the configured office `tests/` suite, and excluded `__tests__` copies should not be the only evidence for launch vocabulary.

## Loop 331 Admin Audit Reducer Regression Rule

Audit-log reducer compatibility tests should also live under configured test paths. Legacy stored audit action strings may be accepted as raw row input so old records remain searchable, but runnable tests should prove those rows are display-safe through the audit resolver and should avoid stale `BET`, `SPORTSBOOK`, cash, or sportsbook-era entity/product fixtures where prediction-order metadata can express the same behavior.

## Loop 332 Deterministic Seed Hygiene Rule

Deterministic launch seed directories should contain only canonical source fixtures. Stray duplicate `*.seed*.json` files are treated as launch-surface risk because local-stack and QA scripts may later copy or reference them accidentally. Compatibility env names such as `BET_STORE_FILE` may remain when inherited code requires them, but generated reports and docs should describe that file as legacy compatibility order state, not as a launch bet surface.

## Loop 333 Point-Native Reconciliation Gate Rule

Release and QA gates must not call deleted retired bet replay commands or retired reconciliation fixtures. Compatibility Make target names may remain for automation stability, but they should execute the point-native prediction reconciliation command and clearly state when historical bet CSV replay is retired for launch. Batch wrappers should produce retired-replay notices plus point-native replacement reports rather than attempting to replay cash/stake/bet CSV contracts.

## Loop 334 Launch Critical Proof Rule

Critical-path release hooks must not prove launch readiness through retired `/bets` place/settle, cashout, stake, odds, or payout flows. Until a fully deployed-like authenticated canonical journey proof replaces them, compatibility hook names may run a launch-safe proof bundle that checks default no-money route boundaries and point-native reconciliation, and must publish reviewable artifacts showing the retired flow is no longer the launch gate.

## Loop 335 Launch Capability Gate Rule

Capability and SLO release hooks must not seed cents, credit wallets through money-path routes, place legacy bets, or measure cashout quote latency as launch readiness evidence. Until a fully deployed-like point-native capability benchmark exists, compatibility hook names may run a launch-safe proof bundle that checks default no-money route boundaries and PTS reconciliation, and must publish reviewable artifacts that make the retired performance probes explicit.

## Loop 336 Regression Pack Gate Rule

Mandatory regression packs must prove launch readiness through prediction orders, point wallet ledgers, launch-boundary HTTP contracts, settlement replay, and point-native reconciliation. They must not use inherited sportsbook bet placement, stake, odds, payout, cashout, or public wallet-credit tests as the canonical release gate, though those tests may remain as private compatibility evidence until retired deliberately.

## Loop 337 Local Governance Hook Rule

Local commit hooks and developer governance checks must follow the Tap Trade launch model. They should run maintained launch-safe gates for prediction orders, no-money route boundaries, and PTS reconciliation, and must not block or certify commits by requiring cashier, deposit, withdrawal, cashout, betslip, stake, odds, pending-withdrawal, or sportsbook health surfaces.

## Loop 338 Player Frontend Verify Rule

Frontend verification targets used by release or governance automation must validate the launch player app, not the retired sportsbook app tree. Compatibility target names may remain stable, but the verifier should run Tap Trade player typecheck, production build, and upstream-leak checks against `frontend/packages/app` and must not certify launch readiness by building sportsbook-only betslip, odds-feed, cashier, or deposit/withdrawal surfaces.

## Loop 339 API Contract Verifier Rule

API contract fixture verifiers used by release or governance automation must validate the launch Tap Trade API-client and player-app contracts, not retired sportsbook response-shape fixtures. Compatibility target names may remain stable, but the verifier should build `@taptrade-ui/api-client` and run focused contract tests for prediction-client routing, auth refresh/retry, point-native order validation, preview economics, wallet/reward paths, and point-ledger presentation. It must not certify launch readiness by running sportsbook-only response fixtures, bet placement contracts, stake/cashout flows, or old cashier/payment clients.

## Loop 340 Discovery Compatibility Gate Rule

Sports-named QA targets may remain as compatibility aliases for inherited automation, but they must not certify launch readiness by probing `/sports/<sport>`, esports wrappers, odds-feed fixtures, betslips, odds, cashout, or stake flows. These gates should run Tap Trade discovery, market-display, market-copy, and API/client contract tests against the launch app and shared client. Release readiness scripts should prefer Tap Trade-named environment variables for these gates while accepting old variable names only as external compatibility aliases.

## Loop 341 Managed Runtime Gate Rule

Managed local stacks and runtime-profile release gates must start and wait for the launch Tap Trade player app, not the retired sportsbook app tree. Legacy env names such as `SPORTSBOOK_PORT` may remain as compatibility aliases for old automation, and stale legacy pid files may be stopped defensively, but active start/status/log/wait steps should use Tap Trade player naming, `frontend/packages/app`, `PLAYER_PORT`, and the Tap Trade discovery/API compatibility gate.

## Loop 342 Release Security Evidence Rule

Release security and dependency gates must preserve inherited coverage while scanning the actual launch surfaces. Secret, SBOM, vulnerability, and dependency-modernization baselines should include backend, Tap Trade Backoffice, Tap Trade Player App, and Go platform coverage where applicable, and must not certify readiness by scanning only a retired sportsbook frontend tree. Blocked inherited-backend scans should publish concrete error artifacts rather than dangling report paths. Vulnerability baselines must parse and report available advisory payloads, including high/critical counts, so dependency risk remains visible before launch.

## Loop 343 Dependency Remediation Rule

When release dependency baselines identify high or critical findings on active launch frontend paths, prefer narrow same-major remediations that can be proven by the lockfile, yarn audit output, and production verifier builds. Audit-count reductions must be regenerated through the official baseline script, not hand-edited. Verifier scripts should use the current supported Next/Node build mode and must not depend on retired compatibility flags such as OpenSSL legacy provider when the modern toolchain rejects them.

## Loop 344 Transitive Parser Dependency Rule

Office upload/import tooling is launch-adjacent when it parses administrator-supplied documents. If a transitive parser package has high or critical advisories and a same-major patched release is available, pin the patched transitive version through the workspace resolution rather than replacing the inherited business flow. The remediation must be proven by lockfile inspection, regenerated audit counts, and the office production verifier.

## Loop 345 Preservation Deletion Gate Rule

Any active deletion of inherited production artifacts must be reviewable before Tap Trade can approach release-candidate status. Launch-prohibited public money-path files may remain deleted only when they are classified as such and guarded by route/source regressions. Deleted operational proof tools must have point-native replacements. Deleted tests must be classified as launch-incompatible or relocated/replaced by point-native regressions. `make qa-preservation-deletions` must fail on unclassified deleted artifacts so broad rewrites or accidental loss of production contracts cannot be hidden inside the launch safety work.

## Loop 346 Live No-Money Runtime Gate Rule

Runtime launch rehearsal must include a live no-money-boundary probe after the player app, office app, and gateway are reachable. The probe must check that launch pages respond, retired player/office money routes return absent statuses before auth redirects, gateway status reports non-redeemable point mode with legacy money routes disabled, required launch domains remain present, prohibited money domains remain absent, and inherited cashier/payment/crypto endpoints return absent statuses. The managed runtime profile should run this probe by default and publish the resulting markdown artifact.

## Loop 347 Partial Runtime Boundary Evidence Rule

When the full local stack is blocked by missing developer dependencies, partial live no-money-boundary probes may be used as incremental Scenario 12 evidence only if the skipped surfaces are explicit in the artifact. Gateway route-absence probes should run with gateway auth disabled so inherited cashier/payment/crypto paths return router-level absence statuses rather than auth middleware responses. Partial-surface artifacts must not be used to mark Scenario 12 complete; player, office, settlement, reward, admin, abuse-control, and authenticated canonical journey evidence remain required.

## Loop 348 Full No-Money Boundary Evidence Rule

A full live no-money-boundary artifact should cover the player app, office app, and gateway in the same run. Player and office probes must include positive launch pages plus retired cashier, cashout, crypto, deposit, fiat, payment, prize, redemption, and withdrawal routes. Gateway probes must include status-domain assertions plus inherited cashier/payment/crypto endpoints. Passing this route-boundary artifact strengthens Scenario 12 evidence, but it still does not prove the authenticated canonical journey, backend terminology cleanup, settlement/reward/admin operations, or abuse-control completeness by itself.

## Loop 349 Preservation Map Rule

Deletion classification must produce a durable reviewer-facing artifact, not only pass/fail terminal output. The preservation map should list every deleted inherited path, its classification, and a summary count so reviewers can distinguish launch-prohibited public money-path removals from point-native replacements, relocated tests, and duplicate cleanup. A clean preservation map is required evidence for reviewing the current large diff, but it is not sufficient to pass Scenario 12 without live canonical-journey, settlement, reward, admin, and abuse-control proof.

## Loop 350 Abuse Boundary Gate Rule

Reward and social abuse controls must have a focused maintained gate. The gate should prove hashed reward-cluster persistence, same-device and same-IP reward blocking across distinct users, blocked reward attempts leaving no point-ledger rows, admin review/export without raw device or IP signals, same-user social burst throttling, and same-IP multi-account throttles for comments, reports, reactions, and follows. This gate should run in local governance, publish a markdown report plus logs, and remain supplemental to the fully deployed-like authenticated canonical journey.

## Loop 351 Canonical API Journey Contract Rule

Authenticated critical-path API specs must use launch-native contracts from registration through ledger inspection. New-user flows should accept the terms and no-cashout disclosure, claim starter points only through the bounded point faucet, place point-native orders with `notionalCapPoints`, verify `PTS` order and ledger fields, and assert retired money aliases are absent. Listing or syntax proof is useful but cannot complete the canonical journey without a live stack run against the player same-origin proxy and gateway.

## Loop 352 Modification Preservation Rule

Broad modifications to inherited production artifacts must be reviewable before Tap Trade can approach release-candidate status. Modified auth, gateway HTTP, prediction, wallet, economy, OpenAPI, shared-client, player, office, seed, and release-governance files should be classified by risk and surface, with line churn visible per path. `make qa-preservation-modifications` must fail on unclassified modified artifacts so accidental rewrites of production business logic, API contracts, or operational proof paths cannot be hidden inside the points-only launch migration. A clean modification map is supplemental evidence only; it does not by itself prove contract preservation or parity completion.

## Loop 353 Extended API Journey Rule

Authenticated API journey proof should follow point movement to the ledger, not only to response bodies. A canonical new-user API slice must prove the starter grant, YES/NO order fills, mission/reward claims, and any reward progression through `PTS` response fields plus immutable ledger idempotency keys such as `starter_grant:<userId>`, `prediction_fill:*`, and `mission_reward:<userId>:first_prediction_order`. Social activity proof should assert the activity row types actually emitted by the user activity endpoint; if reward rows are not emitted there, reward proof must remain ledger-backed instead of inferred from the feed.

## Loop 354 Public Contract Anchor Preservation Rule

Preservation review must include public contract anchor comparison, not only file classification. A maintained gate should compare the current worktree against the inherited baseline for reviewable public anchors such as gateway OpenAPI paths, registered gateway route strings, and exported API-client method names. Additive anchors are allowed and should be reported. Launch-prohibited money-path removals may be allowed only when they match the no-fiat/no-crypto/no-withdrawal boundary. Any other inherited public anchor removal must fail until restored, more narrowly classified, or replaced with explicit compatibility evidence.

## Loop 355 Same-Run Admin Settlement Rule

Admin settlement proof must follow the market from a real user position through the admin lifecycle endpoint, settlement endpoint, user wallet ledger, and user portfolio history in one live stack run. A valid API proof should close a traded market, settle it with `PTS` response fields, verify lifecycle audit stages, verify a deterministic `prediction_payout:{marketId}:...` ledger idempotency key, and verify the settled result appears in user history. Response assertions should reject retired settlement aliases such as `payouts`, `payoutCents`, `totalPayoutCents`, and `currency` at the launch-facing boundary.

## Loop 356 Leaderboard Appearance Rule

Leaderboard appearance proof must not stop at board availability. After a user has a settled prediction result, an operator-triggered recompute should refresh point-native leaderboard snapshots synchronously, and the user must be visible through the authenticated `/api/v1/me/leaderboards` standing plus the public board entries. Viewer-rank assertions belong on authenticated `/me` routes; public leaderboard entry routes should prove public row inclusion without relying on session-only viewer context.
## Loop 357 Dual-Admin Challenge Rule

Proposed-resolution challenge windows are part of the settlement trust boundary. An absent `windowHours` query must use the configured default challenge window, while an explicit non-negative `windowHours` value may shorten the window for deterministic QA/operator proof. `windowHours=0` is allowed only as an explicit value and must still preserve dual-control rules: direct settlement cannot bypass an active challenge flow, the proposing admin cannot finalize their own proposal, holder disputes block finalization until reviewed, and the proposing admin cannot resolve their own challenge dispute. Finalization must be performed by a different admin and must emit point-native settlement aliases with `unit: "PTS"` and no retired operation-level payout/currency aliases.

## Loop 358 Canonical Browser Journey Rule

Canonical journey proof must include rendered player UI behavior, not only API calls. A valid browser proof should register a fresh user, verify no-cashout disclosure acceptance, prove starter points, market discovery/search/watch, market-detail resolution/liquidity/trade controls, YES and NO point trades, portfolio, point ledger, social comment/reaction/follow, reward claim, leaderboard appearance, activity feed visibility, post-settlement history, and absent retired money routes. API use is acceptable only for operations not yet exposed in one continuous browser workflow, such as admin close/settlement/recompute or direct ledger assertions; those API calls must still verify `PTS` fields and reject retired payout/currency aliases.

## Loop 372 Dependency Evidence Note

Frontend dependency-security remediation remains part of the Scenario 12 trust
boundary because launch cannot claim readiness while known high-risk inherited
tooling advisories remain untriaged. Loop 372 keeps the inherited Lerna
workspace tooling in place and patches only the vulnerable `external-editor ->
tmp` leaf through `tmp@0.2.7`. This is not a product-economy change: it does not
alter point sources, point uses, ledger behavior, rewards, settlement, or any
launch money-path boundary. The official dependency baseline now reports zero
`tmp` findings and `critical 0, high 22` for both active frontend scopes.

## Loop 373 Dependency Evidence Note

Loop 373 keeps inherited commitlint and release-governance tooling in place and
patches only the vulnerable commitlint `lodash` subtree through
`lodash@4.18.1`. This is not a product-economy change: it does not alter point
sources, point uses, ledger behavior, rewards, settlement, or any launch
money-path boundary. The official dependency baseline now reports zero
`lodash` findings and `critical 0, high 17` for both active frontend scopes.

## Loop 374 Dependency Evidence Note

Loop 374 keeps inherited Jest/sane, Lerna, globby, fast-glob, and micromatch
tooling in place and patches only the vulnerable `braces` leaf through
`braces@3.0.3`. This is not a product-economy change: it does not alter point
sources, point uses, ledger behavior, rewards, settlement, or any launch
money-path boundary. The official dependency baseline now reports zero
`braces` findings and `critical 0, high 5` for both active frontend scopes.

## Loop 375 Residual Dependency Evidence Note

The remaining frontend high advisories are confined to inherited Lerna
add/version/publish tooling paths: `ip` through package-fetch proxy support and
`lodash.set` through the old Lerna GitHub client. Both advisories report no
patched upstream range in the current Yarn audit payload. No dependency
override was applied in this loop, so point sources, point uses, ledger
behavior, rewards, settlement, launch route boundaries, and money-path
constraints are unchanged. Treat any future Lerna replacement as a separate
preservation-risk slice, not as a gameplay economy change.

## Loop 376 Residual Advisory Gate Rule

Residual dependency risk must be executable governance, not only a narrative
exception. The frontend residual advisory gate may allow the reviewed no-fix
Lerna toolchain advisories only when they remain confined to the documented
Lerna add/version/publish paths, keep the same advisory ids and installed
versions, and still report no patched upstream range. Any new critical row, new
high row, expanded count, patched-range change, or non-Lerna path must fail the
gate until remediated or separately reviewed. This gate does not change point
sources, point uses, ledger behavior, rewards, settlement, or launch money-path
constraints.

## Loop 377 JVM Direct Dependency Evidence Rule

When Java/SBT are unavailable, backend JVM dependency risk should still have
bounded evidence rather than a blank blocker. A direct OSV scan may parse
declared Maven coordinates from SBT source files and query OSV without moving
gameplay logic, point sources, point uses, settlement, rewards, or route
boundaries. Such a scan is supplemental only: it must clearly state that it does
not include transitive resolution, eviction behavior, or classpath-specific SCA,
and full backend JVM SCA remains required once Java/SBT or another
resolver-backed tool is available.

## Loop 378 JVM Direct Remediation Rule

Direct JVM dependency remediation should prefer the smallest fixed-version bump
that removes a reviewed advisory without changing inherited business logic or
launch economy behavior. The `commons-text` 1.9 to 1.10.0 and
`logback-classic` 1.2.11 to 1.2.13 changes are dependency-security changes
only: they do not alter point sources, point uses, ledger behavior, rewards,
settlement, social features, route boundaries, or launch money-path
constraints. A direct OSV count reduction is not enough for Scenario 12 pass;
resolved transitive JVM SCA remains required.

## Loop 379 JVM Test Dependency Rule

Test-scoped dependency remediation may proceed independently from runtime
economy behavior when the changed dependency is mapped to the SBT `Test`
configuration and the update stays on the same compatible major line. The
`wiremock-jre8-standalone` 2.33.2 to 2.35.1 change is a backend test dependency
security change only: it does not alter runtime point sources, point uses,
ledger behavior, settlement, route boundaries, social features, rewards, or
launch money-path constraints. It still requires Java/SBT verification before
it can be treated as compile- or test-proven.

## Loop 380 JVM Documentation Surface Dependency Rule

Documentation-surface dependency remediation may proceed when a fixed patch
version removes a reviewed advisory and preserves the inherited static asset
behavior. The `swagger-ui` 4.1.2 to 4.1.3 change is a backend docs dependency
security change only: it does not alter runtime point sources, point uses,
ledger behavior, settlement, route boundaries, social features, rewards, or
launch money-path constraints. Because live docs rendering still requires the
backend runtime, Java/SBT verification remains required before this can support
Scenario 12 pass.

## Loop 381 JVM Residual Governance Rule

Residual direct JVM advisories must be executable-governed when Java/SBT are
unavailable. The gate may allow only the reviewed runtime residual package,
version, and advisory-id set; any new package, changed version, changed GHSA
set, malformed artifact, or missing direct OSV JSON must fail. This governance
does not change point sources, point uses, ledger behavior, settlement, route
boundaries, social features, rewards, or launch money-path constraints, and it
does not replace resolver-backed JVM SCA.

## Loop 382 JVM Release Gate Rule

Launch readiness must fail when backend JVM dependency graph and eviction
evidence cannot be produced. A non-strict baseline may keep writing diagnostic
reports for review, but a strict release target must fail on missing Java,
missing SBT, or failed resolver execution. This rule is a trust-boundary gate
only; it does not change point sources, point uses, ledger behavior,
settlement, rewards, social features, or launch money-path constraints.

## Loop 383 RC Completion Audit Rule

Parity Release Candidate v1 may not be declared while any canonical
progress-matrix scenario remains `Partial` or `Fail`. The RC completion audit
gate must read the canonical `spec.md` and fail unless all 12 scenarios are
`Pass` with evidence. This rule protects the points-only economy by preventing
partial trading, portfolio, lifecycle, reward, admin, API, or safety evidence
from being treated as launch-complete. It does not change point sources, point
uses, ledger behavior, settlement, rewards, social features, route contracts,
or launch money-path constraints.

## Loop 384 Office Ledger Consumer Rule

Office account-review user-detail surfaces are launch-adjacent ledger
inspection tools. They must consume point-ledger rows through
`amountPoints` and `balancePoints` only, without active fallback to
retired `amountCents` or `balanceCents` fields. Older aliases may remain only
inside explicitly private compatibility readers or negative regression tests;
they must not be used by active office ledger rendering.

## Loop 385 Office Limit Editor Rule

Office user-limit editors are launch-adjacent responsible-play controls. Their
active UI state, form fields, and translation keys must describe point-add and
point-use limits rather than deposit or stake concepts. If an inherited backend
contract still serializes the point-add limit under an old key, that value may
remain only behind a point-native enum member or compatibility adapter; active
office form state must not use deposit-shaped names.

## Loop 386 Office Point-Use Limit Rule

The office user-limit editor is a launch-adjacent admin surface. Active UI,
form, translation-key, and TypeScript enum member names for prediction point-use
limits must use point-use language rather than inherited stake/loss wording.
The inherited serialized API value `"stake"` may remain compatibility-only
behind `TapTradePunterLimitsTypesEnum.POINT_USE`, but active office form state must
use `pointUse`, rendered copy must use `HEADER_CARD_LIMITS_POINT_USE`, and the
office route/source regression must reject `values.losses`, `field="losses"`,
`HEADER_CARD_LIMITS_LOSS`, `TapTradePunterLimitsTypesEnum.STAKE`, and `STAKE =`
in the active limit-editor files.

## Loop 387 Office Limit History Type Rule

Office limit-history types are launch-adjacent responsible-play surfaces.
Active TypeScript enum member names must use point-add and prediction-point
language rather than inherited deposit/stake wording. Inherited serialized
history values such as `"DEPOSIT_AMOUNT"` and `"STAKE_AMOUNT"` may remain only
behind point-native members such as `POINT_ADD_AMOUNT` and
`PREDICTION_POINT_AMOUNT`, because existing API/history rows use those values
to resolve point-safe translation keys.

## Loop 388 Office Limit History Translation Rule

Office limit-history rendering must not use inherited serialized history values
as launch-facing translation keys. Backend values such as `"DEPOSIT_AMOUNT"`
and `"STAKE_AMOUNT"` may remain in history rows for compatibility, but active
office rendering must map them to point-native translation keys such as
`LIMIT_TYPE_POINT_ADD_AMOUNT` and `LIMIT_TYPE_PREDICTION_POINT_AMOUNT` before
calling the translation layer. Direct `t("...:${limitType}")` rendering is not
allowed for this launch-adjacent surface.

## Loop 389 Office Financial Summary Translation-Key Rule

Office account-review financial-summary translation keys are launch-adjacent
display contracts. Active keys for lifetime point additions, lifetime point
usage, and pending point use must use point-native names such as
`HEADER_CARD_FINANCIAL_SUMMARY_LIFETIME_POINTS_ADDED`,
`HEADER_CARD_FINANCIAL_SUMMARY_LIFETIME_POINTS_USED`, and
`HEADER_CARD_FINANCIAL_SUMMARY_PENDING_POINT_USE`. Deposit- or
withdrawal-shaped key names may remain only in negative regression assertions or
historical documentation, not in active Office translation modules.

## Loop 390 Office Legacy Sports Feed Copy Rule

Office launch-adjacent translation values must not render inherited
`Sportsbook` wording. Compatibility enum or product identifiers may remain only
when required to read inherited rows, but rendered account-review and point
ledger labels must describe those rows as legacy sports-feed metadata, such as
`Legacy sports feed`, rather than an active sportsbook product surface.

## Loop 391 Office Retired Bet-Cancel Source Rule

Dormant Office components must not retain active retired bet-operation endpoint
strings. If an inherited user bet-cancel path remains for preservation review,
it must be a null or inert compatibility stub and must not call
`admin/bets/:id/cancel`, import the active API hook, or load the retired
`page-bets` namespace. Launch admin order cancellation must use prediction
order/lifecycle operations with point-native copy and audit evidence.

## Loop 392 Office Bet Translation-Key Rule

Office launch-adjacent translation keys for prediction trades, positions,
cancel-order actions, and point-ledger prediction rows must use prediction,
order, or position wording. Bet-shaped translation keys such as
`HEADER_BETS_HISTORY`, `HEADER_CARD_FINANCIAL_SUMMARY_OPEN_BETS`,
`ACTION_CANCEL_BET`, and `CELL_TYPE_BET` may remain only in negative
regression assertions or historical notes, not active Office translation
modules.

## Loop 393 Office Admin README Rule

Office launch-adjacent project documentation that describes current admin
surfaces must use point-native Tap Trade wording. Current admin documentation for
loyalty, leaderboard, account review, or point-ledger surfaces must not describe
those surfaces as sportsbook-native and must not advertise cashier, deposit,
withdrawal, crypto, fiat, redemption, prize, wager, stake, refund, payout,
payment, or dollar-value behavior. Historical documents may mention inherited
terms only when clearly marked as historical or retired compatibility context.

## Loop 394 Office Navigation/Risk Comment Rule

Active Office source comments that explain launch navigation, redirects, or
prediction-admin risk pages must use Tap Trade-native compatibility language.
They may preserve inherited enum names, paths, and redirects for compatibility,
but they should describe retired paths as legacy or pre-Tap Trade surfaces rather
than using inherited sportsbook-era product terms. Any comment cleanup must not
change route registration, redirect behavior, admin API calls, or operation
logic unless a separate functional parity slice requires it.

## Loop 395 Office Audit Scoped URL Rule

Office audit-log scoped handoff URLs and copy telemetry are launch-adjacent
admin surfaces. They must include only launch-supported audit query/filter keys
such as preset, action, actor, target, user, product, page, and limit.
Unsupported inherited promo keys such as `freebetId` and `oddsBoostId` may
remain inside raw compatibility row types or negative tests, but must not be
carried into copied audit URLs or telemetry filter signatures.

## Loop 396 Office Audit Diff Display Rule

Office audit-log expanded diff JSON is a launch-adjacent admin display surface.
Raw audit rows may retain inherited compatibility keys such as `freebetId`,
`oddsBoostId`, or `freebetAppliedCents`, but rendered before/after diff JSON
must map those keys to point-native display keys before stringification. The
display boundary must not mutate raw rows, API responses, filters, copied URLs,
or telemetry contracts.

## Loop 397 Gateway Makefile Setup Rule

Active gateway setup/help tooling is launch-adjacent documentation. Makefile
help, environment examples, development database names, and setup instructions
must describe the Tap Trade prediction gateway and use point-native Tap Trade
database naming such as `taptrade_predict`, not inherited sportsbook database or
service names. This rule does not require rewriting historical migrations or
legacy compatibility schemas.

## Loop 398 Gateway Makefile Seed Rule

Active gateway seed tooling must use the launch-safe Tap Trade seed command
family. `make seed` should invoke `go run ./cmd/seed -mode base`, which
discovers `seed-data/seed_prediction.sql`, and `make demo-data` should invoke
`go run ./cmd/seed -mode demo`. Active Makefile seed targets must not directly
load removed or inherited money-era seed files such as `migrations/seed.sql`.

## Loop 399 Gateway Demo Backoffice Audit Seed Rule

Launch-visible demo seed data for backoffice audit logs must use launch-seeded
prediction markets and point-native detail keys. Demo audit JSON must not
insert retired crypto tickers, oracle-feed examples, `payout_pool_points`, or
`yes_price_points` into active admin rows. Compatibility schemas may still store
point-cent integer values internally, but rendered/seeded admin examples should
use explicit point-native keys such as `settlementPoints` and
`yesPricePoints`.

## Loop 400 Gateway Seed Operator Wording Rule

Active seed command output, cleanup comments, and error context are
launch-adjacent operator surfaces. They must describe reserved points, point
releases, and settlement credits instead of cash refunds, reserved cash,
payouts, or payout pools. Preserved internal schema names such as
`prediction_payouts` and idempotency keys such as `prediction_payout:*` may
remain when they are part of inherited storage compatibility, but the
operator-facing seed wording around them must be point-native.

## Loop 401 Gateway Seed Market-Maker Wording Rule

Active market-maker seed comments and seed error output are launch-adjacent
operator surfaces. They must describe point balances, points, and resting
point bids rather than dollars, cash, stakes, funds, or cent-symbol money
labels. This rule does not change order-book placement, matching, wallet
reservation, or inherited storage field names.

## Loop 402 Launch Readiness Preservation Gate Rule

Launch readiness must run the preservation deletion, modification, and public
contract-anchor gates before release signoff. Deleted inherited artifacts,
broad modified artifacts, and public contract-anchor removals must stay
classified and reviewable. These gates are preservation governance; they do not
replace behavioral proof for point ledgers, settlement, admin operations, or
full RC completion.

## Loop 403 Launch Readiness Abuse Boundary Rule

Launch readiness must run the reward/social abuse-boundary proof before
release signoff. Blocked reward claims must not write point-ledger rows,
reward-cluster review evidence must stay hashed and outside the point ledger,
and blocked social writes must not persist comments, reports, reactions, or
follows. This gate strengthens Scenario 12 but does not replace live no-money
runtime proof or the full authenticated canonical journey.

## Loop 404 Shared API Wallet Contract Rule

Shared API-client wallet exports are launch-facing contracts. Exported wallet
balance, ledger, and mutation request/response types must use point-native
fields such as `balancePoints`, `availablePoints`,
`reservedPoints`, `amountPoints`, and `unit: "PTS"`. Retired
`amountCents` or `balanceCents` fields may remain only as private compatibility
reads inside normalizers and must not be re-exported.

## Loop 405 Shared API Audit Log Contract Rule

Shared API-client audit-log exports are launch-facing admin contracts. Exported
audit entries must use point-native review fields such as `pointGrantId`,
`pointRuleId`, and `pointGrantAppliedPoints`. Retired promo fields such
as `freebetId`, `oddsBoostId`, or `freebetAppliedCents` may remain only as
private compatibility reads inside normalizers and must not be re-exported.

## Loop 406 Shared API Order-Book Hint Contract Rule

Shared API-client order-book hint exports are launch-facing market contracts.
`OrderBookHint` must expose point-native best-quote fields such as
`bestYesBidPoints`, `bestYesAskPoints`, `bestNoBidPoints`,
`bestNoAskPoints`, and `unit: "PTS"` metadata. Retired best-quote aliases
such as `bestYesBidCents`, `bestYesAskCents`, `bestNoBidCents`, or
`bestNoAskCents` may remain only as private compatibility reads in normalizers
and must not be re-exported.

## Loop 407 Shared API Portfolio History Contract Rule

Shared API-client portfolio-history exports are launch-facing portfolio
contracts. Settlement-history row types must use point-result wording such as
`SettledPositionResult` and point-native fields such as
`realizedPoints`, `settlementPoints`, and `unit: "PTS"` metadata.
Payout-named exported types such as `SettledPayout` must not be re-exported.
Older `pnlCents` or `payoutCents` payload fields may remain only as private
compatibility reads in normalizers.

## Loop 408 Market Settlement Pool Contract Rule

Public market JSON, launch OpenAPI, and shared API-client market types must use
settlement-pool wording such as `settlementPoolPoints`. Payout-pool names
such as `settledPayoutPoolPoints` must not be published as launch-facing
market fields. Inherited storage fields and older payout-pool payload keys may
remain only as internal DB fields or private compatibility reads.

## Loop 409 Production Preservation Dossier Rule

Launch readiness must include a production preservation dossier that summarizes
the tracked rewrite magnitude, high-risk inherited contract domains, deleted
launch-prohibited money-path files, and explicit compatibility anchors. Inherited
public/client names should be wrapped or aliased when possible instead of being
silently replaced. The one such alias, `PhoenixApiClient`, was removed in the
2026-09 brand migration once the product was confirmed pre-launch with no external
consumers; `TapTradeApiClient` is now the sole export. Private
compatibility normalizers may read inherited payload fields, but launch-facing
exports must stay point-native. This dossier is preservation governance and does
not replace human review or behavioral RC proof.

## Loop 410 Untracked Artifact Preservation Rule

The production preservation dossier must classify untracked artifacts as well
as tracked changes. Untracked gateway behavior, schema, seed data, player or
office surfaces, verification scripts, browser proofs, visual assets, and
evidence reports must be assigned a risk/classification bucket. Any
unclassified untracked path must fail the preservation dossier gate because it
is invisible to tracked diff review and could otherwise bypass inherited
production-contract review.

## Loop 411 Progress Matrix Ownership Rule

The progress matrix should not keep a scenario Partial because of blockers that
belong to another scenario. If a scenario's own acceptance checklist has direct
browser, API, SQL, or regression evidence, it may be marked Pass while broader
API/data cleanup remains under Scenario 11 and safety, compliance, dependency,
or release-hardening work remains under Scenario 12. This rule does not relax
the requirement that every Pass row must cite reviewable evidence.

## Loop 412 Scenario 11 API Surface Gate Rule

Scenario 11 API/data surface completion must be backed by
`make qa-scenario-11-api-surface`. The gate must verify each explicit Scenario
11 requirement against launch OpenAPI operations or documented query
parameters, plus required shared client/service methods for central prediction,
order, portfolio, settlement, taxonomy, and wallet-ledger flows. Passing this
gate proves API surface coverage only; safety terminology, abuse hardening,
dependency governance, deployed-like journey proof, live no-money runtime proof,
and production preservation signoff remain Scenario 12 responsibilities.

## Loop 413 API-Visible Ledger Reason Rule

Wallet ledger reasons are launch-facing because player and admin ledger APIs
return them and player account history can render them. Starter grants, reward
claims, prediction fills, settlement rows, and admin point adjustments must use
point-native reason text. Money-style ledger reasons are not allowed even when
the point amount fields are already `PTS`-native. Focused handler tests should
read the ledger API after a mutation when a reason is changed, not only assert
the mutation response body.

## Loop 414 Admin Wallet Reason Boundary Rule

Admin wallet adjustment reasons are launch-facing because the same value can be
stored in wallet ledger entries and provider-ops audit details. Admin
credit/debit request validation must reject launch-prohibited money,
cashout/deposit/withdrawal, crypto/fiat, prize/payout, sportsbook/wagering,
money, or redeemable wording before any point ledger mutation or audit entry is
written. The validation may allow explicit non-redeemable disclosure wording
when the rest of the reason is point-native. Error responses must identify the
`reason` field without echoing the unsafe admin-supplied value.

## Loop 415 Lifecycle And Settlement Reason Boundary Rule

Admin lifecycle and settlement reasons are launch-facing because they can be
returned in lifecycle action responses, lifecycle audit rows, settlement rows,
settlement override fields, and provider-ops audit details. Market lifecycle
action reasons, proposed-resolution reasons, direct-settlement reasons, and
settlement override reasons must pass the same point-native wording guard as
admin wallet adjustments before service calls are made. Unsafe reason text must
be rejected before market lookup, settlement persistence, point disbursement,
or audit persistence, and error responses must identify the relevant field
without echoing the unsafe admin-supplied value.

## Loop 416 Loyalty Adjustment Reason Boundary Rule

Admin loyalty adjustment reasons are launch-facing because they can be stored
in XP/rank ledger metadata and returned through admin or player loyalty ledger
APIs. Predict loyalty adjustment requests must trim and validate `reason`
before adjusting the account. Unsafe money, redemption, prize, payout,
deposit/withdrawal, crypto/fiat, sportsbook/wagering, or cash-equivalent
wording must be rejected before any points/rank ledger mutation is attempted,
and errors must identify `reason` without echoing the unsafe admin-supplied
value.

## Loop 417 Admin Dispute Note Boundary Rule

Admin dispute-resolution notes are launch-facing because they can be persisted
as `resolutionNote` and returned through holder/admin dispute APIs. Admin
review notes must pass the shared point-native wording guard before dispute
resolution is attempted. Unsafe money, redemption, prize, payout,
deposit/withdrawal, crypto/fiat, sportsbook/wagering, or cash-equivalent
wording must be rejected before dispute state changes or audit persistence, and
errors must identify `note` without echoing the unsafe admin-supplied value.
User-filed dispute reasons remain user-generated moderation content and are
governed by moderation/reporting controls rather than product-copy guards.

## Loop 418 Admin KYC Decision Reason Boundary Rule

Admin KYC decision reasons are launch-facing because a denied review reason can
be persisted by the DB-backed KYC service and returned through compliance or
account-review surfaces. Admin KYC decision requests must trim and validate
`reason` before calling the persistent service. Unsafe money, redemption, prize,
payout, deposit/withdrawal, crypto/fiat, sportsbook/wagering, or
cash-equivalent wording must be rejected before the KYC decision is written, and
errors must identify `reason` without echoing the unsafe admin-supplied value.

## Loop 419 Admin Social Report Review Note Boundary Rule

Admin social-report review notes are launch-facing because they can be
persisted as moderation `reviewNote` values and exported through social report
CSV. Admin report-resolution requests must trim and validate `note` before
calling the moderation store. Unsafe money, redemption, prize, payout,
deposit/withdrawal, crypto/fiat, sportsbook/wagering, or cash-equivalent
wording must be rejected before social report state changes or CSV-visible note
persistence, and errors must identify `note` without echoing the unsafe
admin-supplied value. User-filed report reasons remain user-generated
moderation content and are governed by moderation/reporting controls rather
than product-copy guards.

## Loop 420 Admin CRM Punter Note Boundary Rule

Admin CRM punter notes are launch-facing because `user_notes.content` is
persisted and returned to office account-review surfaces. Admin punter-note
requests must trim and validate `content` before calling the persistent note
repository. Unsafe money, redemption, prize, payout, deposit/withdrawal,
crypto/fiat, sportsbook/wagering, or cash-equivalent wording must be rejected
before note persistence, and errors must identify `content` without echoing the
unsafe admin-supplied value.

## Loop 421 Admin Bonus Reason Boundary Rule

Admin bonus grant and forfeit reasons are launch-facing because grant reasons
can be persisted in bonus metadata, folded into point-credit ledger reasons,
and returned through admin/player bonus surfaces, while forfeit reasons can be
stored on player bonus state. Admin bonus grant and forfeit requests must trim
and validate `reason` before calling bonus services. Unsafe money, redemption,
prize, payout, deposit/withdrawal, crypto/fiat, sportsbook/wagering, or
cash-equivalent wording must be rejected before bonus metadata, ledger, or
forfeit state changes, and errors must identify `reason` without echoing the
unsafe admin-supplied value.

## Loop 422 Admin Loyalty Adjustment Reason Boundary Rule

Admin loyalty adjustment reasons are launch-facing because the older loyalty
adjustment endpoint can create point-ledger metadata returned through admin
account detail and loyalty ledger surfaces. Admin loyalty adjustment requests
must trim and validate `reason` before calling the loyalty service. Unsafe
money, redemption, prize, payout, deposit/withdrawal, crypto/fiat,
sportsbook/wagering, or cash-equivalent wording must be rejected before loyalty
account creation or ledger mutation, and errors must identify `reason` without
echoing the unsafe admin-supplied value.

## Loop 423 Admin Loyalty Tier Copy Boundary Rule

Admin loyalty tier display names and benefit text are launch-facing because
they can be persisted by the older loyalty tier editor and returned through
admin config and public tier surfaces. Admin loyalty tier update requests must
validate `displayName` and all visible `benefits` values before calling the
loyalty service. Unsafe money, redemption, prize, payout, deposit/withdrawal,
crypto/fiat, sportsbook/wagering, or cash-equivalent wording must be rejected
before tier configuration changes, and errors must identify the affected
visible field without echoing the unsafe admin-supplied value.

## Loop 424 CMS Page Copy Boundary Rule

CMS page title, body, meta title, and meta description text are launch-facing
because admin-created pages can be published through the public content
delivery API. Admin content page create and update requests must validate
`title`, `content`, `meta_title`, and `meta_description` before calling the
content service. Unsafe money, redemption, prize, payout, deposit/withdrawal,
crypto/fiat, sportsbook/wagering, or cash-equivalent wording must be rejected
before `content_pages` persistence, and errors must identify the affected field
without echoing the unsafe admin-supplied value.

## Loop 425 CMS Banner Copy And Link Boundary Rule

CMS banner titles and link destinations are launch-facing because active
banners are returned through the public banner delivery API and can route users
to product surfaces. Admin banner create and update requests must validate
visible `title` copy and `link_url` destinations before calling the content
service. Unsafe money, redemption, prize, payout, deposit/withdrawal,
crypto/fiat, sportsbook/wagering, cash-equivalent wording, or retired money
route destinations must be rejected before banner persistence, and errors must
identify the affected field without echoing the unsafe admin-supplied value.

## Loop 501 Admin CMS Read Boundary Rule

Admin CMS page and banner reads are launch-adjacent office surfaces. Stored
page `title`, `content`, `meta_title`, `meta_description`, nested block JSON
strings, banner `title`, and banner `link_url` values from restored/imported
rows must be redacted before admin list, detail, create, or update responses
render. This response boundary must not mutate the raw `content_pages`,
`content_blocks`, or `banners` records, so internal preservation review can
still inspect the historical source values outside launch-facing JSON.

## Loop 502 Resolution Source Health Error Boundary Rule

Resolution-source health is an admin operations surface, but adapter
`lastError` values can include restored legacy provider text or future source
error messages. Admin health responses must copy `feed.SourceHealth` snapshots
and redact unsafe `lastError` text before rendering JSON. The boundary must
preserve source identifiers, counters, timestamps, and the raw reporter
snapshot so operators and preservation reviewers can still diagnose source
health outside launch-facing response serialization.

## Loop 426 RBAC Role Copy Boundary Rule

Custom RBAC role names and descriptions are launch-facing operator copy because
they are persisted and returned to office access-control screens. Admin role
creation requests must validate `name` and `description` before calling the
RBAC service. Unsafe money, redemption, prize, payout, deposit/withdrawal,
crypto/fiat, sportsbook/wagering, or cash-equivalent wording must be rejected
before role persistence, and errors must identify the affected field without
echoing the unsafe admin-supplied value.

## Loop 427 Partner Key Name Boundary Rule

Operator-issued partner API key names are launch-facing operator copy because
they are persisted with partner key metadata and returned through admin partner
key listing surfaces. Admin partner key creation requests must validate `name`
before generating or persisting a key. Unsafe money, redemption, prize, payout,
deposit/withdrawal, crypto/fiat, sportsbook/wagering, or cash-equivalent
wording must be rejected before key generation or persistence, and errors must
identify `name` without echoing the unsafe admin-supplied value.

## Loop 428 Partner Webhook Destination Boundary Rule

Operator-managed partner webhook URLs are launch-facing operator destinations
because they are persisted with endpoint metadata, returned through admin
webhook listing surfaces, and recorded in provider-ops audit details. Admin
webhook endpoint creation must validate the URL for network safety and then
reject retired money-route destination terms in the path, query, or fragment
before endpoint persistence. Unsafe cashier, deposit, withdrawal, crypto/fiat,
cashout, redemption, or redeemable-route wording must be rejected with `url`
identified and without echoing the unsafe destination value.

## Loop 429 Self-Serve Bot Key Name Boundary Rule

Self-serve bot API key names are launch-facing account copy because they are
persisted with user-issued key metadata and returned through the bot key list
surface. Bot key creation requests must trim and validate `name` before scope
normalization, key generation, or persistence. Unsafe money, redemption, prize,
payout, deposit/withdrawal, crypto/fiat, sportsbook/wagering, or
cash-equivalent wording must be rejected before key creation, and errors must
identify `name` without echoing the unsafe user-supplied value.

## Loop 430 Loyalty Rule Name Boundary Rule

Admin loyalty accrual rule names are launch-facing operator/economy copy
because they are persisted with loyalty rule configuration and returned through
admin loyalty config/rule payloads. Admin loyalty rule create and update
requests must trim and validate `name` before calling the loyalty service.
Unsafe money, redemption, prize, payout, deposit/withdrawal, crypto/fiat,
sportsbook/wagering, or cash-equivalent wording must be rejected before rule
persistence, and errors must identify `name` without echoing the unsafe
admin-supplied value.

## Loop 431 Predict Loyalty Tier Copy Boundary Rule

DB-backed Predict loyalty tier display names and benefit text are
launch-facing operator/economy copy because they are persisted by the active
Predict loyalty admin tier editor and returned through admin tier payloads.
Predict loyalty tier update requests must validate `displayName` and all
visible `benefits` values before calling the loyalty admin service. Unsafe
money, redemption, prize, payout, deposit/withdrawal, crypto/fiat,
sportsbook/wagering, or cash-equivalent wording must be rejected before tier
configuration changes, and errors must identify the affected visible field
without echoing the unsafe admin-supplied value.

## Loop 432 Admin Taxonomy Copy Boundary Rule

Admin-created discovery taxonomy is launch-facing public copy because category
names, series titles, series descriptions, and series tags can be persisted and
returned through public discovery/category/series/tag APIs. Admin taxonomy
creation requests must validate category `name` plus series `title`,
`description`, and `tags` before persistence. Unsafe money, redemption, prize,
payout, deposit/withdrawal, crypto/fiat, sportsbook/wagering, or
cash-equivalent wording must be rejected before taxonomy rows are written, and
errors must identify the affected visible field without echoing the unsafe
admin-supplied value.

## Loop 433 Admin Event Copy Boundary Rule

Admin-created events are launch-facing public market-grouping copy because
event titles and descriptions can be persisted and returned through market,
event, discovery, and admin APIs. Admin event creation requests must validate
`title` and `description` before persistence. Unsafe money, redemption, prize,
payout, deposit/withdrawal, crypto/fiat, sportsbook/wagering, or
cash-equivalent wording must be rejected before event rows are written, and
errors must identify the affected visible field without echoing the unsafe
admin-supplied value.

## Loop 434 Gateway Runtime Boundary Evidence Rule

Gateway-only live no-money-boundary probes are useful current-worktree runtime
evidence when the full player/office/gateway stack is not already reachable.
They must run with player and office surfaces explicitly omitted, gateway auth
disabled for router-level path absence checks, and artifact inputs showing the
reduced scope. A passing gateway-only artifact strengthens Scenario 12 route
absence evidence, but it must remain Partial evidence until full player,
office, authenticated canonical journey, abuse-control, preservation, and
release-hardening proof are current.

## Loop 435 Full Runtime Boundary Evidence Rule

Full live no-money-boundary probes must cover the player app, office app, and
gateway in the same artifact before route-boundary evidence can be considered
current. A passing full-surface artifact must show positive player/office launch
pages below 500, retired player/office cashier/cashout/crypto/deposit/fiat/
payment/prize/redeem/redemption/withdrawal routes absent, gateway
non-redeemable point mode, disabled legacy money routes, required launch
domains present, prohibited money domains absent, and inherited
cashier/payment/crypto API endpoints absent. This proof clears the live
route-boundary blocker, but it does not replace human preservation review,
multi-node/live abuse proof, dependency/release hardening, or final RC audit
evidence.

## Loop 436 DB-Backed Abuse Boundary Evidence Rule

Abuse-boundary evidence must include a DB-backed reward-cluster proof, not only
same-process in-memory route tests. The maintained gate should start an
isolated Postgres instance, run two independent wallet services against the
same `wallet_reward_clusters` table, prove same-user retries remain allowed
across service instances, prove a second account sharing the same device/IP
cluster is blocked, prove blocked users are not added to cluster evidence, and
prove raw device/IP signal values are not stored or returned. This proof clears
the reward-cluster shared-store/multi-instance requirement, but broader live
social/account-graph abuse proof, human preservation review,
dependency/release hardening, and final RC audit evidence remain separate
Scenario 12 responsibilities.

## Loop 437 Fresh Dependency Residual Evidence Rule

Dependency residual evidence must be current and executable. Frontend yarn
audit logs should be timestamped per run, and the frontend residual advisory
gate should read the latest logs by default so reviewed Lerna residuals cannot
hide behind stale March artifacts. The dependency baseline should distinguish
reviewed high residuals from untriaged high/critical findings. JVM direct OSV
residuals must be refreshed from OSV and then checked by the direct residual
gate. Passing frontend and direct-JVM residual gates clears residual-governance
freshness, but it does not replace resolver-backed JVM transitive SCA,
compile/runtime validation for dependency movement, human preservation review,
or final RC audit evidence.

## Loop 438 Preservation Replacement Evidence Rule

Deletion classification is not enough for inherited production artifacts. Each
deleted artifact class must also have durable replacement evidence checked by
the preservation deletion gate. Launch-prohibited cashier, payment, crypto,
deposit, withdrawal, cashout, and related Office money surfaces must point to
the live no-money-boundary proof harness. Retired player money helpers must
point to point-ledger and wallet-client tests. Relocated Office tests must
point to their package-level audit/activity replacements. Retired bet replay
proof must point to the point-native prediction reconciliation command and
fixture. This rule strengthens preservation evidence for Scenario 12, but it
does not substitute for human review of high-risk inherited business logic.

## Loop 439 Backend Point-Native Lifecycle Copy Rule

Launch-facing market lifecycle descriptions must avoid payout, cash, money,
deposit, withdrawal, crypto, fiat, prize, redeem, sportsbook, wager, and bet
language. Settled lifecycle copy should describe final results and point
disbursements. Prediction and wallet production comments should describe held
points or point reservations when they explain launch prediction-order flows;
legacy DB column names and compatibility route names may remain only where
renaming them would be a separate contract migration.

## Loop 440 DB-Backed Social Graph Evidence Rule

Abuse-boundary evidence for the social layer must distinguish shared social
graph persistence from route-local rate limiting. A DB-backed proof should run
two independent SQL social-store instances against one Postgres database and
prove comments, reactions, reports, report resolution, follows, profiles, user
activity, and global activity are shared across instances, with duplicate
reactions and follows remaining idempotent. This strengthens Scenario 12
social/account-graph evidence, but it does not by itself prove cross-node
social write limiter enforcement, human preservation review, resolver-backed
JVM/transitive SCA, or the final authenticated RC journey.

## Loop 441 DB-Backed Social Write Limiter Rule

When the gateway has a DB connection, social write limiter state must be shared
through persistent token-bucket rows rather than per-process memory only. The
schema must be migration-owned, and abuse-boundary proof must exercise two
independent route instances sharing one Postgres database. The proof must show
same-user and same-IP bursts are blocked across route instances and that
blocked writes do not persist comments, reports, reactions, or follows. No-DB
local/test paths may continue to use the in-memory limiter.

## Loop 442 Canonical Browser Journey Gate Rule

The final authenticated canonical journey must be proved by a maintained,
artifact-producing browser gate rather than by an ad hoc command. The gate must
run against a real seeded player stack through the same-origin player URL,
verify the gateway proxy is reachable through `/api/v1/status`, execute the
rendered-player Playwright journey, and write a rolling report plus timestamped
log artifacts. A passing wrapper syntax check or Makefile dry run is not
canonical-journey evidence; Scenario 12 remains incomplete until the gate
passes against a running seeded stack.

## Loop 443 Ephemeral Canonical Stack Rule

The canonical browser journey should remain reproducible from an empty local
runtime. The maintained stack runner must start a disposable DB-backed stack,
apply migrations, seed demo data, run auth and gateway in DB mode, serve the
Tap Trade player app through the same-origin API proxy, execute the canonical
browser gate, and tear down the disposable database and services afterward.
Fresh passing stack-runner evidence clears the authenticated canonical journey
blocker, but Scenario 12 still requires preservation review, backend legacy
contract cleanup, and remaining security/dependency evidence before RC.

## Loop 444 Preservation Review Focus Rule

Production-preservation evidence must tell reviewers what to verify, not only
which inherited files changed. The production dossier should attach domain
review focus to each high-risk changed artifact, including auth/session
compatibility, public API/client compatibility, gateway route/authz/audit
behavior, prediction lifecycle and settlement invariants, wallet ledger
idempotency and reservation semantics, and deleted fixture replacement
evidence. A passing preservation dossier remains review guidance and does not
replace human sign-off on inherited production contracts.

## Loop 445 Admin Note Category Copy Rule

Admin-supplied CRM note metadata is launch-facing once it can be persisted and
returned through office APIs. Note categories must be trimmed and checked with
the same launch-facing reason validator used for note content, wallet
adjustments, lifecycle reasons, loyalty adjustments, dispute notes, and social
moderation notes. Unsafe category values must fail before persistence and must
not be echoed in error responses.

## Loop 446 Resolved JVM Classpath SCA Rule

Direct JVM OSV checks are not enough for launch readiness. The release gate
must include an SBT-resolved compile classpath OSV baseline so transitive Maven
coordinates are visible from the actual backend dependency graph. A passing
resolved-classpath baseline proves evidence collection only; any observed OSV
findings still require remediation, compatibility validation, or explicit
residual-risk acceptance before Scenario 12 can pass.

## Loop 447 Resolved JVM Residual Gate Rule

Resolved JVM classpath findings must be executable-governed before launch, not
only listed in a baseline. A missing reviewed residual policy means no resolved
JVM OSV findings are accepted. The residual gate should fail on every
unreviewed resolved coordinate, fail on stale accepted residual entries, and
require a rationale for any residual entry that remains after remediation is
not feasible.

## Loop 448 Compile-Verified JVM Remediation Rule

JVM dependency remediation must be resolver- and compile-verified before it can
reduce Scenario 12 risk. Version candidates that OSV lists as fixed but cannot
resolve in this SBT/Coursier build, or that introduce source/binary
compatibility failures, must be removed from the remediation batch and tracked
as residual follow-up. A remediation batch counts only when strict SBT
update/evicted evidence, resolved-classpath OSV evidence, direct residual
governance, refreshed SBOM evidence, and backend compile evidence all exist.

## Loop 449 Direct-Residual-Preserving JVM Remediation Rule

Resolved-classpath remediation must not turn a transitive residual into a new
unreviewed direct residual. If a candidate override lowers the resolved OSV
count but still has OSV findings itself, the direct residual gate must reject
it unless an explicit reviewed direct residual policy already covers the exact
package, version, and advisory set. Keep only candidates that resolve, compile,
and preserve the direct residual gate; track partial reductions such as
still-vulnerable Kafka or LZ4 upgrades as residual follow-up rather than
launch-readiness progress.

## Loop 450 JVM Residual Triage Rule

Residual triage is not launch acceptance. Origin maps, rejected-candidate
notes, and migration-shape recommendations make Scenario 12 blockers
reviewable, but they do not satisfy the resolved residual gate. Scenario 12 can
only pass when the resolved JVM findings are remediated or represented by an
explicit reviewed residual policy with compatibility and launch sign-off.

## Loop 513 Production Contract Review Pack Rule

When inherited production artifacts have broad tracked or untracked movement,
the preservation dossier is necessary but not sufficient. A compact
production-contract review pack must summarize the diff magnitude, separate
launch-required public money-path removals from high-risk business/API/admin
contract changes, list the highest-churn files, and state reviewer signoff
questions for auth/session, gateway route/authz/audit behavior, prediction
settlement, wallet ledger invariants, public OpenAPI/shared clients, and
office/admin operations. This pack is reviewer guidance only; Scenario 12 can
pass only after human preservation signoff and launch-owner/security residual
acceptance or remediation.

## Loop 514 Expanded Contract Anchor Gate Rule

The preservation contract-anchor gate must cover more than top-level route
strings. It should compare launch OpenAPI paths, root gateway route strings,
core wallet/prediction gateway route strings, inherited shared API-client
methods, prediction API-client methods, and player wallet-client exports
against the inherited baseline. Launch-prohibited payment/cashier helpers such
as deposit, withdraw, or payment transaction-status polling may be classified
as allowed removals only when they represent the no-fiat/no-crypto/no-withdrawal
boundary. Any other inherited route or client-method removal must fail the gate
until restored, explicitly reviewed, or replaced by documented compatibility
evidence.

## Loop 515 Current Residual Gate Evidence Rule

Scenario 12 residual-security evidence must come from executable gates run
against current artifacts. Frontend residual advisory governance must prove no
critical rows and only reviewed high residuals confined to inherited tooling
paths. JVM direct and resolved-classpath residual governance must prove every
observed OSV finding matches the reviewed package, version, advisory id set,
and rationale or residual policy. Passing these gates proves drift control only;
launch readiness still requires remediation where feasible or explicit
launch-owner/security acceptance for any residual risk that remains.

## Loop 516 Security Residual Acceptance Packet Rule

Residual-security acceptance must be a reviewable decision packet, not an
implicit conclusion from passing gates. The packet should list current frontend,
direct JVM, and resolved JVM residual evidence, identify each residual class,
state whether acceptance or remediation is required, and call out compatibility
constraints for auth/session, gateway, prediction, wallet, office/admin, and
shared API-client contracts. An unsigned packet is evidence preparation only;
Scenario 12 can pass only after a launch-owner/security reviewer records
acceptance or required remediation and preservation reviewers sign off the
high-risk production-contract queue.

## Loop 517 Scenario 12 Signoff Gate Rule

The final Scenario 12 human decisions must be machine-checkable. Launch
readiness must run a signoff gate that fails until security residual acceptance
and production preservation signoff files exist with accepted or approved
status, named reviewer, ISO date, and references to the current residual,
production-contract review, and preservation dossier artifacts. Missing,
unsigned, stale, or artifact-free signoff files must keep Scenario 12 Partial
even when all automated abuse, route-boundary, residual, preservation, and
contract-anchor gates pass.

## Loop 518 Pending Signoff Template Rule

Pending signoff templates may be committed to give reviewers exact files,
artifact references, and decision prompts, but they must not satisfy Scenario
12. Templates with `Status: pending`, missing accountable reviewer, or missing
ISO signoff date must fail the Scenario 12 signoff gate. Only a completed
accepted or approved signoff, or remediation that removes the need for that
acceptance, can unblock the RC completion audit.

## Loop 519 Signoff Governance Classification Rule

Scenario 12 signoff files are launch governance records, not generic revival
notes. The production preservation dossier must classify `revival/signoffs/`
as launch signoff governance so pending, accepted, stale, or incomplete
security and preservation decisions remain visible in the production review
queue. Classification is not approval: `Status: pending`, missing named
reviewer, or missing ISO signoff date must still keep Scenario 12 Partial and
the RC audit failing.

## Loop 520 Reviewer Handoff Rule

A reviewer handoff may summarize the current signoff files, residual evidence,
production preservation dossier, commands, and non-negotiable launch
constraints, but it is only a navigation aid. It must not be treated as a
decision record. Scenario 12 can move from Partial to Pass only when the
security residual and production preservation signoff files are completed by
accountable reviewers, or when remediation removes the residual risk and
preservation concerns those files were created to accept.
