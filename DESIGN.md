# Design System — Tap Trade (purple + gold)

> **This document mirrors the code. It does not govern it.**
>
> The design system is defined by the `:root` blocks of
> `apps/taptrade-platform/frontend/packages/app/app/globals.css` and enforced by
> `apps/taptrade-platform/frontend/packages/app/app/__tests__/color-system.test.ts`,
> which pins the nineteen colour primitives and the role bindings by regex. **If this
> document disagrees with those two files, the files are right and this document
> is stale — fix the document.** Do not "correct" the code to match a table
> written here.
>
> Verified against the tree at `f89b5a8b` on 2026-09-06. Every value below was
> read out of the source; contrast ratios were recomputed, not carried forward.
>
> The previous canonical document — the 1C "lime skin, terminal bones" system
> locked 2026-08-06 — is archived at
> `docs/archive/2026-07-rebrand/design-system-1c-lime.md`. It was superseded in
> code on 2026-08-22 and its token table, brand section and contrast figures no
> longer describe anything that ships.
>
> **Scope:** this describes the **player app** (`frontend/packages/app`) only.
> The back-office (`frontend/packages/office`) runs a separate, unrelated palette
> — see §11.

## 1. Product context

Binary event-contract exchange: users trade YES/NO on real-world outcomes.
The product is **points-only and non-redeemable**. Contract prices are **Points,
1–99**, with `yes + no = 100`; a winning contract pays 100 points per share and a
losing one pays 0 (`public/static/locales/en/prediction.json` `MARKET_RESOLVED_EXPLAINER`).
Nothing in the UI should present points as money.

Audience: retail traders comfortable in brokerage apps. The visual target is a
trading surface with a warm brand voice — dense and numeric where data lives,
branded and generous where the product sells itself.

## 2. The rules

1. **Purple is the interaction voice.** `--brand-purple` (via `--accent`,
   `--accent-text`, `--focus-ring`) carries links, primary CTAs, selected
   controls, hover affordances and focus. `--brand-deep` / `--brand-dark` anchor
   dark chrome. This is what the test asserts (`--accent: var(--brand-purple)`,
   `--focus-ring: var(--brand-purple)`).
2. **Gold is a signal, never a generic CTA.** `--signal-gold` (via `--live`,
   `--reward`) marks live activity, trending markets, rewards and priority
   information. On light surfaces gold-as-text must use `--signal-gold-text`
   `#885206`; gold fills take `--on-gold`. The test explicitly forbids the gold
   Trending signal from sitting adjacent to YES/NO semantics.
3. **Teal and mulberry speak only for market direction.** `--dir-yes` /
   `--dir-no` colour prices, deltas, bars and settlement outcomes — never
   chrome, never brand, never decoration. Selection is the purple voice, even on
   a NO cell.
4. **Lime is one scoped channel: featured redemption.** `--reward-lime`
   `#c6f24e` exists only for the reward hero on `/predict`, where it is used as
   display heading text and mono numerals on `--reward-hero-bg`. Verbatim from
   `globals.css`: *"The lime channel is intentionally limited to featured
   redemption surfaces. It never doubles as a generic brand CTA or YES signal."*
   Lime is not the action colour and has not been since 2026-08-22.
5. **Every numeral is mono.** Geist Mono with tabular figures for prices,
   points, counts, timestamps and tickers. The `.mono` utility and the Tailwind
   `font-mono` utility both guarantee `tabular-nums`. If it can be compared or
   summed, it is mono.
6. **Honest data or no data.** No fabricated deltas, sparklines, activity or
   balances. Missing values render an em dash, never a zero and never an implied
   direction. Probability bars are sized by real prices.

## 3. Tokens

Values below are transcribed from `globals.css`. The primitives marked **pinned**
are asserted by `color-system.test.ts` and cannot be changed without changing the
test.

### 3.1 Neutral foundation (pinned)

| CSS | Value | Role |
|---|---|---|
| `--paper` | `#f1f4f6` | page ground (cool, not warm) |
| `--card` | `#ffffff` | cards, cells, panels |
| `--raised` | `#ebeef0` | inner wells, inset fields, disabled fill |
| `--hairline` | `#dde2e5` | default 1px border |
| `--hairline-strong` | `#cbd1d5` | hover tier, outer card frames |
| `--ink` | `#101112` | primary text |
| `--ink-2` | `#43494d` | secondary text |
| `--ink-3` | `#576066` | metadata, micro-labels, faintest tier |

### 3.2 Brand — purple and gold (pinned unless noted)

| CSS | Value | Role |
|---|---|---|
| `--brand-deep` | `#1e1235` | darkest brand ground (landing, dark chrome) |
| `--brand-dark` | `#28153f` | brand ground step 2; `--on-gold`; invalid-input border |
| `--brand-purple` | `#6334a8` | the interaction colour |
| `--brand-lavender` | `#ece3f7` | soft branded surface (selection, pending, accent-soft) |
| `--signal-gold` | `#f5c454` | live / reward / featured signal |
| `--signal-gold-text` | `#885206` | gold as text on light surfaces |
| `--signal-gold-soft` | `rgba(245, 196, 84, 0.18)` | soft gold wash — not asserted by the test |
| `--on-brand` | `#ffffff` | text on purple fills — not asserted by the test |
| `--on-gold` | `var(--brand-dark)` | text on gold fills |

### 3.3 Reward channel (scoped to the featured redemption hero)

| CSS | Value | Role |
|---|---|---|
| `--reward-lime` | `#c6f24e` | reward hero headline, numerals, CTA fill (**pinned**) |
| `--reward-lime-soft` | `rgba(198, 242, 78, 0.16)` | soft lime wash |
| `--on-reward-lime` | `#161a0f` | text on a lime fill |
| `--reward-hero-bg` | `#090711` | near-black hero ground |
| `--reward-hero-muted` | `#d2d6df` | hero secondary text |
| `--reward-hero-border` | `rgba(198, 242, 78, 0.38)` | hero hairline |

### 3.4 Direction — market voice (pinned)

| CSS | Value | Role |
|---|---|---|
| `--dir-yes` | `#126d68` | YES/up text, strokes |
| `--dir-no` | `#9c3b65` | NO/down text, strokes |
| `--dir-yes-bar` | `#a7d8d3` | YES probability-bar segment, dots |
| `--dir-no-bar` | `#e5b5c9` | NO probability-bar segment, dots |
| `--yes-soft` | `color-mix(in srgb, var(--dir-yes) 8%, transparent)` | soft YES pill |
| `--yes-border` | `color-mix(in srgb, var(--dir-yes) 28%, transparent)` | YES pill stroke |
| `--no-soft` | `color-mix(in srgb, var(--dir-no) 8%, transparent)` | soft NO pill |
| `--no-border` | `color-mix(in srgb, var(--dir-no) 26%, transparent)` | NO pill stroke |

The soft/border derivations are asserted by the test; they must stay
`color-mix` on the shared primitives, not hand-mixed hexes.

### 3.5 Role bindings — what components actually reference

These are the names in daily use. Almost all app code goes through this layer
rather than the primitives above.

| CSS | Resolves to | Role |
|---|---|---|
| `--t1` / `--t2` | `--ink` / `--ink-2` | primary / secondary text |
| `--t3` and `--t4` | both `--ink-3` | tertiary text (the fourth tier collapsed; there is no fainter step) |
| `--surface-1` | `--card` | card surface |
| `--surface-2` and `--surface-3` | both `--raised` | well / inset surface |
| `--border-1` / `--border-2` | `--hairline` / `--hairline-strong` | default / hover border |
| `--bg-deep` | `--paper` | body ground |
| `--accent` / `--accent-text` | `--brand-purple` | primary action, link |
| `--accent-lo` | `--brand-dark` | pressed / deep action |
| `--accent-soft` | `--brand-lavender` | soft action surface |
| `--focus-ring` | `--brand-purple` | focus outline |
| `--ticket-cta-text` | `--on-brand` | text on the primary CTA |
| `--live` / `--reward` | `--signal-gold` | live and reward signal |
| `--live-text` / `--reward-text` | `--signal-gold-text` | those signals as text |
| `--live-soft` / `--reward-soft` | `--signal-gold-soft` | those signals as wash |
| `--info-text` / `--info-dot` | `--brand-purple` | informational messages stay in the brand channel |
| `--info-soft` | `color-mix(in srgb, var(--brand-purple) 8%, transparent)` | info wash |
| `--brand-ink` | `--brand-deep` | wordmark colour |
| `--brand-period` | `--signal-gold` | wordmark accent |
| `--tier-1..5` | `--ink-3`, `--ink-2`, `--signal-gold`, `--brand-dark`, `--brand-purple` | loyalty progression |

**Disabled and pending** — disabled comes from the surface, never from opacity
or a filter:

- `--inert-fill` `#ebeef0` · `--inert-border` `#dde2e5` · `--inert-label`
  `#576066`. These three are literal hexes, not `var()` references — they are
  copies of `--raised` / `--hairline` / `--ink-3` and must be moved in lockstep
  with them or disabled controls will drift out of temperature.
- `--pending-fill` `var(--brand-lavender)` · `--pending-border`
  `color-mix(in srgb, var(--brand-purple) 24%, var(--brand-lavender))` ·
  `--pending-label` `var(--brand-dark)`.

### 3.6 Deprecated compatibility aliases — do not use in new code

The lime action channel from the 1C system was not deleted; it was repointed at
purple so unmigrated call sites kept rendering. Every one of these now resolves
to something with no lime in it. Five of the six have no consumer left in
`app/`; `--ink-on-lime` has exactly one — the hold-to-place progress fill on
the trade CTA (`TradeTicket.tsx:1308`) — and should be repointed to `--on-brand`
the next time that file is touched:

| Alias | Now resolves to | Consumers in `app/` |
|---|---|---|
| `--lime` | `var(--brand-purple)` | 0 |
| `--lime-text` | `var(--brand-purple)` | 0 |
| `--ink-on-lime` | `var(--on-brand)` | 1 (`TradeTicket.tsx:1308`) |
| `--lime-wash` | `var(--brand-lavender)` | 0 |
| `--lime-tint` | `var(--brand-lavender)` | 0 |
| `--inset` | `var(--raised)` | 0 |

If you are touching a file that still names one of these, replace it with the
role token it resolves to. Do not reintroduce them. `--reward-lime` is a
different token and is live — see §3.3.

### 3.7 Radii — three scales coexist

There is no single radius scale in the code, and pretending otherwise has caused
churn before. What is actually in use, by consumer count in `app/`:

| Scale | Values | Use |
|---|---|---|
| `--r-rh-sm/md/lg/xl` | `8 · 12 · 16 · 20` | **the live default.** `ui/Button` uses `--r-rh-md`, `ui/Card` uses `--r-rh-lg`, `ui/Input` uses `--r-rh-md`. ~120 references. |
| `--radius-xs/sm/md/lg/pill` | `4 · 6 · 8 · 12 · 999` | narrow use on prediction surfaces (`radius-md` ~7 references: ticket stepper, market stat cells, moment cards, the `cta` button variant). |
| `--r-sm/md/lg/xl/pill` | `10 · 16 · 22 · 28 · 999` | older scale, still defined and still referenced (`--r-sm` ~9, `--r-pill` in pills). |

Use `--r-rh-*` for anything new unless you are editing a surface already built on
one of the others; match the file you are in.

`--space-2xs … --space-4xl` (`4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48`) are
defined in `globals.css` but have **zero consumers** — spacing is expressed
through Tailwind utilities. Do not treat that scale as a requirement.

### 3.8 Elevation

`--shadow-card`, `--shadow-card-hover` and `--shadow-pop` are defined on
`rgba(17, 17, 17, …)` and are **in active use on ordinary cards**, not only on
overlays. Twelve files apply them, including `MarketCard`, `MarketFeed`,
`DiscoveryHero`, `TradeTicket`, `PackGrid` and `MobileTabBar`.

The pattern that actually ships is: hairline border plus one quiet shadow at
rest; on hover the border goes `--border-1` → `--border-2` and the shadow goes
`--shadow-card` → `--shadow-card-hover`. Never a background change on hover.
`--shadow-pop` is reserved for floating elements (the mobile trade CTA, toasts).

Separation still comes from hairlines and spacing first — a shadow is depth, not
a substitute for structure — but "no shadows on cards" is not the rule and has
not been for some time.

## 4. Typography

- **UI: Switzer**, self-hosted woff2 in `public/fonts/`, four weights declared:
  400 Regular, 500 Medium, 600 Semibold, 700 Bold. `--font-sans` and
  `--font-display` both resolve to it; there is no second sans. Differentiation
  comes from size, weight and tracking.
- **Numerals: Geist Mono**, loaded via `--font-geist-mono` on `<html>` and
  exposed as Tailwind `font-mono`. Both `font-mono` and the `.mono` utility
  carry `font-variant-numeric: tabular-nums`, so live-updating values do not
  jitter.
- `.type-display` applies `letter-spacing: -0.015em` and is the display class.

Representative shipped values (read from the components, not aspirational):

| Role | Spec | Where |
|---|---|---|
| Market question | 34px / 600 / lh 1.08 / `-0.035em`, 27px ≤720 | `MarketHead.tsx` |
| Hero probability | Geist Mono 30px / 600 / `-0.045em` tabular, 27px ≤720 | `MarketHead.tsx` |
| Page/section title | 20px / 600 / lh 1.22 | `market/[ticker]/page.tsx` |
| Eyebrow / micro-label | 10px / 600 uppercase, tracking `0.11–0.14em` | ~32 components |
| Wordmark | 26px / 600 / `-0.025em`, 23px ≤900, 21px ≤480, hidden ≤359 | `TopBar.tsx` |

Serif display is not used in product UI.

## 5. Brand

- **Mark:** the Tap Trade stepped-route glyph. `app/components/BrandMark.tsx`
  renders a Figma production export via `next/image` — it deliberately does not
  reconstruct the vector geometry in code. Three toned SVGs live in
  `public/brand/`: `taptrade-mark-brand.svg` (`#6334A8`),
  `taptrade-mark-ink.svg` (`#1E1235`), `taptrade-mark-light.svg` (`#FFFFFF`).
  Default tone is `ink`, default width 30px, aspect ratio 24.001 × 17.8604.
  `app/icon.svg` is the same stepped-route path. There is no split-leaf mark and
  no lime lobe.
- **Wordmark:** the string is `brand.name` from `app/lib/brand.ts`
  (`NEXT_PUBLIC_BRAND_NAME`, defaulting to `Tap Trade`) — it is white-label
  config, not a literal. Rendered in Switzer 600, tracking `-0.025em`, coloured
  `--brand-ink` on light chrome and `--on-brand` on dark chrome.
- **Three brand grounds**, not two:
  1. **Product** — `--paper` `#f1f4f6`, purple actions, gold signals.
  2. **Landing** — the `.landing-1c` scope in `globals.css` overrides a local
     `--l-*` set on a deep purple ground: `--l-bg` `#1e1235`, `--l-inset` /
     `--l-raised` `#28153f`, `--l-purple` `#6334a8`, `--l-gold` `#f5c454`,
     `--l-t1` `#f1f4f6`. Gold carries the accents here; there is no lime on this
     page. Tagline: "Where local moments become markets."
     (`public/static/locales/en/page-home.json`).
  3. **Reward hero** — `--reward-hero-bg` `#090711` with `--reward-lime`. This
     is the only surface where lime appears.
- `--brand-mark-stop-1/2/3` resolve to `--brand-deep`, `--brand-purple`,
  `--brand-purple` for gradient hooks.
- The composition reference cited by the code is the Figma file "TapTrade
  Design" (`BrandMark.tsx` names master `178:7` / export `193:10`;
  `prediction/moments.ts` names the `03 Screens` page). That file is not in the
  repository and its current state cannot be verified from here — treat the
  checked-in SVG exports as the shipping artwork.

## 6. Components and shell

The UI primitives live in `app/components/ui/` — `Button`, `Card`, `Input`,
`Dialog`, `Sheet` (+ `Sheet.lazy`), `PointsFlow`, and shared `variants.ts`.
They are styled exclusively with the tokens above; no hex literals.

Contract points the test pins, so they cannot drift silently:

- `Button` primary: `bg-[var(--accent)]` with `text-[var(--ticket-cta-text)]`.
- Focus: `focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]` on
  `Button`; `focus-visible:shadow-[0_0_0_2px_var(--focus-ring)]` on `Input`.
- Disabled on both: `disabled:bg-[var(--inert-fill)]` with
  `disabled:text-[var(--inert-label)]`, `disabled:opacity-100`.
- `Input` invalid: `aria-invalid:border-[var(--brand-dark)]` — explicitly *not*
  `--no-text`, so a validation error never borrows market-NO semantics.

Prediction surfaces (`app/components/prediction/`) include `TopBar` (64px
sticky strip), `TerminalCategoryRail`, `MarketCard`, `MarketFeed`,
`MarketGrid`, `AllMarketsSection`, `MomentCard` / `MomentMarketsSection`,
`MarketHead`, `MarketChart`, `TradeTicket` / `ConnectedTradeTicket`,
`OrderBook`, `RecentTrades`, `TrendingSidebar`, `DiscoveryHero`,
`PredictFooter`.

Component rules: selection is the purple voice (lavender wash + purple stroke);
disabled is always the inert recipe; one icon family; icons are never emoji.

## 7. Trade ticket doctrine

- **The quote rows are the review surface.** The CTA submits via
  **press-and-hold** — `"Hold to place · {{amount}}"` with helper text
  `"Press and hold to submit — release to cancel."`
  (`public/static/locales/en/prediction.json` `HOLD_TO_PLACE_AMOUNT` /
  `HOLD_HINT`). There is no confirm modal, and a "Review trade" step is not to
  be reintroduced.
- Card states the ticket actually renders include: ready, limit, sell from
  position, signed-out, insufficient points, no liquidity, halted, settled, and
  AMM quote-only (read-only). Amounts and payouts are stated in points.
- Post-submit notices: status speaks through the dot; the card body is not
  tinted. A partial fill must state the remainder and the returned points in the
  card body — that detail may not be toast-only. Rejected orders must state that
  no points were taken.

## 8. Layout

- **Top bar:** 64px (`h-16`), sticky; brand, nav, search, auth. Max content
  width 1588px on the standard bar.
- **`/predict` (`PredictionWorkspace`, 232 lines):** two columns —
  `224px` category rail + fluid main, inside `max-w-[1920px]`. At ≤1199px the
  rail narrows to `72px`; at ≤1023px it collapses to one column. The page is
  `TerminalCategoryRail` + `RewardHero` + a two-up notice grid +
  `AllMarketsSection variant="moments"`. **There is no preview rail and no
  featured-market slot on this route** — selecting a card navigates.
- **`/market/[ticker]`:** three columns —
  `200px topic rail · fluid main · 380px ticket rail`, `min-h-[calc(100vh-64px)]`.
  At ≤1279px: `72 · fluid · 340`. At ≤1023px the grid becomes a flex column, the
  rails hide, and the ticket moves into a `vaul` Sheet opened by a fixed trade
  CTA. This is the route where the preview/ticket-rail interaction pattern still
  lives.
- The market-head chart panel splits `minmax(280px,0.82fr) / minmax(420px,1.25fr)`
  and stacks at ≤1180px.
- **Mobile tab bar** (`MobileTabBar`, shown below 900px per D12) is fixed to the bottom with
  `env(safe-area-inset-bottom)` padding; touch targets are ≥44px on mobile
  surfaces.
- The chart's y-domain is **pinned to 0–100** (`MarketChartCanvas.tsx:118-142`),
  never auto-scaled, so the mirrored YES/NO series always cross at exactly 50;
  missing history renders an honest empty state.

## 9. Motion

Market-data motion is data-driven or feedback — never decorative. The price
ticks and the LIVE dot fire on a real event (a `market:{id}` WebSocket message,
a user action) and settle; idle market surfaces hold still. That doctrine is
scoped to market surfaces: `globals.css` also ships six `infinite` loops that
are loaders or attention cues, not data — listed below so nobody mistakes the
rule for a global fact.

- `price-tick-up` / `price-tick-down`: 900ms ease-out, fading from `--yes-soft`
  / `--no-soft` to transparent. Direction speaks through the soft signal tokens;
  the wash never carries text-contrast duty.
- `live-dot-beat` (`globals.css:404`, applied by `MarketHead.tsx`): one 600ms
  scale beat, fired once per real price/volume change and never on a timer. It
  is the reference implementation of the doctrine.
- Entrance motion — `landing-rise`, `landing-fade`, `card-in` — runs once on
  mount (`both` fill) and settles.
- Looping (`infinite`) animations, all loaders or attention cues:
  `predict-pulse` (the legacy `.live-dot` pulse), `shimmer` / `shimmerCard`
  (skeletons), `pulseLogo`, and the `tap-dot` / `tap-dot-ring` loader pair.
  None of them may be attached to market data; the `.live-dot` loop is the one
  that contradicts the doctrine and is the first candidate for removal.
- Two `@media (prefers-reduced-motion: reduce)` blocks in `globals.css` collapse
  motion. Any new animation must survive them.

## 10. Accessibility

Contrast ratios recomputed 2026-09-06 from the shipped token values using the
WCAG 2.x relative-luminance formula. Recompute rather than copy if you change a
primitive.

| Pair | Ratio | Level |
|---|---:|---|
| `--ink` on `--card` | 18.90 | AAA |
| `--ink` on `--paper` | 17.11 | AAA |
| `--ink` on `--raised` | 16.22 | AAA |
| `--ink-2` on `--card` | 9.14 | AAA |
| `--ink-2` on `--paper` | 8.27 | AAA |
| `--ink-3` on `--card` | 6.42 | AA |
| `--ink-3` on `--paper` | 5.81 | AA |
| `--brand-purple` on `--card` | 8.12 | AAA |
| `--brand-purple` on `--paper` | 7.35 | AAA |
| `--brand-purple` on `--brand-lavender` | 6.53 | AA |
| `--on-brand` on `--brand-purple` | 8.12 | AAA |
| `--signal-gold-text` on `--card` | 6.45 | AA |
| `--signal-gold-text` on `--paper` | 5.84 | AA |
| `--on-gold` on `--signal-gold` | 10.17 | AAA |
| `--dir-yes` on `--card` | 6.15 | AA |
| `--dir-no` on `--card` | 6.51 | AA |
| `--dir-yes` on `--paper` | 5.57 | AA |
| `--dir-no` on `--paper` | 5.89 | AA |
| `--inert-label` on `--inert-fill` | 5.51 | AA, without opacity tricks |
| `--reward-lime` on `--reward-hero-bg` | 15.44 | AAA |
| `--on-reward-lime` on `--reward-lime` | 13.64 | AAA |
| `--l-t1` on `--l-bg` (landing) | 15.93 | AAA |
| `--l-t3` on `--l-bg` (landing) | 9.82 | AAA |
| `--l-gold` on `--l-bg` (landing) | 10.82 | AAA |

Notes:

- Raw `--signal-gold` `#f5c454` is a **fill**, not a text colour on light
  surfaces (1.63:1 on white, 1.47:1 on paper). Gold text uses
  `--signal-gold-text`.
- Raw `--reward-lime` as text is correct **only** on `--reward-hero-bg`, where it
  clears AAA. It must not be used as text on any light surface.
- Focus: `:focus-visible { outline: 2px solid var(--focus-ring); outline-offset:
  2px; }` — a purple ring, globally.
- `--t3` and `--t4` both resolve to `--ink-3`; there is no fainter text tier, so
  a call site asking for `--t4` gets `--t3`. Do not add a lighter grey to
  recreate the missing step without checking contrast.

## 11. Token vocabulary — live, dead, and elsewhere

**Live vocabulary in the player app.** By consumer count in `app/`, the role
tokens dominate and are what you should read and write: `--t1` (~294),
`--border-1` (~269), `--t3` (~261), `--t2` (~156), `--surface-1` (~153),
`--surface-2` (~150), `--accent` (~142), `--r-rh-md` (~69), `--border-2` (~60).
The primitives (`--ink`, `--paper`, `--brand-purple`, `--signal-gold`, …) are
referenced directly in the low tens, mostly on prediction surfaces.

**Dead vocabulary.** `--lime`, `--lime-text`, `--lime-wash`, `--lime-tint`,
`--inset` and the whole `--space-*` scale have zero consumers; `--ink-on-lime`
has exactly one (`TradeTicket.tsx:1308`, see §3.6). They stay defined only so
nothing breaks; they are not a migration target.

**There is no rename migration in progress.** A previous version of this
document instructed every agent to rename `--t1` → `--ink` and `--r-rh-md` →
`--radius-md` in any file it touched. That instruction is withdrawn: it pointed
at a token set the 2026-08-22 rebrand abandoned, and following it would churn
roughly 1,400 call sites toward names with no future. Match the vocabulary of
the file you are editing.

**The back-office is a separate system.** `frontend/packages/office` loads
`styles/p8-tokens.css` + `styles/p8-antd.css` against Ant Design 5. It declares
only P9-era names (`--accent`, `--accent-lo/soft/text`, `--bg-deep`,
`--border-1/2`, `--danger`, `--focus-ring`, `--no*`, `--r-rh-*`,
`--surface-1/2`, `--t1..4`, `--warn`, `--yes*`) and none of the player app's
current names — no `--paper`, `--ink`, `--hairline`, `--brand-purple`,
`--signal-gold`, `--on-brand`. The overlapping names mean **opposite things**:
office `--accent` is mint `#2be480`, `--yes` is `#71eeb8` and `--no` is
`#ff8b6b`, against the app's purple `#6334a8` and teal/mulberry pair.

No convergence sweep is scheduled, and aligning the two would be a full rename
plus a value swap, not the "value/composition sweep" earlier docs promised. New
office styling references the `p8-tokens.css` custom properties and must not
introduce hex literals; new player-app styling references `globals.css`. Do not
copy values between them.

## 12. History

Earlier directions and their dispositions are recorded in the archived 1C
document (`docs/archive/2026-07-rebrand/design-system-1c-lime.md`, §10): Liquid
Glass, warm-dark Robinhood, P8 warm-cream, P9 gallery-white + mint, P10/P11 dark
terminal, and the "Ink & lime" handoff framing. Full text for all of them is in
`git log -p`.

| Date | Decision |
|---|---|
| 2026-08-06 | 1C "lime skin, terminal bones" locked as the canonical system. **Superseded — archived 2026-09-06.** |
| 2026-08-22 | **Brand identity adopted** (`83d92631`): stepped-route mark as Figma SVG exports, title-case wordmark bound to `brand.name`. Adopted that day under the interim "Tap Path" working name; the artwork is unchanged and ships as Tap Trade. |
| 2026-08-22 | **Purple + gold colour system applied** (`21b2c9ea`, 73 files): `--accent`/`--focus-ring` → `--brand-purple`; `--live`/`--reward` → `--signal-gold`; the lime action tokens repointed at purple as deprecated aliases. Locked by `app/__tests__/color-system.test.ts` (`7a8b7f56` surfaced gold on Predict). |
| 2026-08-24 | `/predict` rebuilt around trending moments (`0cfd3e89`): `PredictionWorkspace` reduced to a two-column rail + moments grid; the featured-market/preview-rail model retired from that route. Direction pair refreshed to teal `#126d68` / mulberry `#9c3b65`. |
| 2026-09-06 | This document rewritten against `globals.css` + `color-system.test.ts`. The supremacy clause ("this document wins over the code") removed — the code and its tests are the source of truth and this document mirrors them. |

### Known stale cross-references (not fixed here)

Several source comments cite section anchors from the 1C document and are now
wrong. Section numbers here were chosen to keep §3 (tokens), §6 (components and
shell), §7 (trade ticket) and §8 (layout) resolving, and §9 is now a real Motion
section, but these still need a sweep in the files themselves:

- `globals.css:435` — the focus-ring comment describes "dark mint"; the ring is
  purple.
- `globals.css:159`, `:188`, `:233` — comments referencing the Ink & lime and
  Robinhood-direction eras.
- `components/prediction/DiscoveryHero.tsx:5` — "warm-light surface"; the ground
  is cool.
- `components/prediction/TopBar.tsx:4` and `components/AppShell.tsx:6` — cite
  "glass-med" / "Liquid Glass", both long retired.
- `components/prediction/FeaturedCarousel.tsx:9` — cites a "Hero owns the page"
  rule that no longer exists.
- The `¢` price glyph is still rendered as user-visible price text in 27
  player-app components (68 occurrences — `MarketHead.tsx`, `MarketFeed.tsx`,
  `OrderBook.tsx`, `RecentTrades.tsx`, the chart axis, …) as well as
  `globals.css` and `public/static/locales/en/prediction.json`; prices are
  Points, so this is a product-copy sweep, not a two-file fix.
- `globals.css:1425` cited `DESIGN.md §9` for accessibility; §9 is now Motion
  and accessibility is §10. Corrected in the same change that landed this file.
