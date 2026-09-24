# Design System — Tap Trade · "Kilig"

> **This document mirrors the code. It does not govern it.**
>
> The system lives in the `:root` blocks of
> `apps/taptrade-platform/frontend/packages/app/app/globals.css` and the font
> loading in `app/layout.tsx`, and is enforced by
> `app/__tests__/color-system.test.ts`. If this document disagrees with those
> files, the files are right — fix the document.
>
> Adopted 2026-09-24 (decision `bbca37fe`), replacing the purple + gold system
> of 2026-08-22, and revised the same day (§13): the palette stays, the
> poster type, monospace numerals and typographic poster tiles are retired
> for a single-typeface, image-led, commercial-grade layout. Scope: the
> **player app** (`frontend/packages/app`) only; the back-office runs its own
> palette (§12). Read this before any visual change.

*Kilig* (Filipino): the giddy rush when the thing you called actually happens.

## 1. Product context

- **What:** a points-only, non-redeemable binary YES/NO prediction market.
  Prices are Points 1–99 (= implied probability); a correct contract settles
  at 100 Points, a wrong one at 0. Nothing is money.
- **Who:** Gen Z and Millennial adults in the Philippines.
- **Markets:** local culture first — PBA, MLBB/esports, pageants, OPM/K-pop,
  politics, tech, weather.
- **Peers:** Kalshi, Polymarket (brokerage/terminal looks); PrizePicks,
  Robinhood (dark, neon, imagery-first); Maya/GCash (PH fintech).
- **Positioning:** everyone else designs like a brokerage because they assume
  users come for the odds. Tap Trade users come for the *moment*; the design
  leads with the moment and makes trading the precise instrument underneath.

## 2. The rules

1. **Lead with a real market.** Discovery opens on one featured market —
   contested, high-volume, with its real price chart and both outcomes —
   beside a ranked trending list. Then a clean, scannable card grid.
2. **Colour is earned.** Chrome is ink, white and hairlines. Kilig pink is
   identity and liveness. Blue and orange mean YES and NO and nothing else.
3. **Ink is the interaction voice.** Primary buttons, selected pills, focus
   rings and links are ink. Pink is never the default button.
4. **One typeface.** Inter everywhere; hierarchy comes from size, weight and
   colour, never a display face or all-caps. Every comparable numeral uses
   tabular figures.
5. **Honest data or no data.** No invented deltas, sparklines, activity, or
   "LIVE" claims without a live signal. Missing values render "—".
6. **Points are play value.** Prices read "44 pts", never "44¢". No cash,
   prize, redemption, peso or dollar vocabulary or imagery anywhere.

## 3. Colour

### 3.1 Primitives (pinned by the test)

| Token | Light | Role |
|---|---|---|
| `--paper` | `#f5f5f7` | page ground (cool white) |
| `--card` | `#ffffff` | cards, bars, panels |
| `--raised` | `#ededf1` | wells, selected nav, inert fill |
| `--hairline` / `--hairline-strong` | `#e3e3e8` / `#cdcdd4` | borders; hover step |
| `--ink` / `--ink-2` / `--ink-3` | `#111114` / `#3c3c44` / `#5e5e68` | text tiers; ink = action |
| `--ink-deep` / `--ink-deep-2` | `#0b0b0e` / `#1c1d24` | landing ground, dark chrome |
| `--poster-ink` / `--poster-ink-2` | `#f4f3ef` / `#b8b8c0` | text on dark grounds |
| `--kilig` | `#e0126e` | identity, LIVE/trending dots, fills |
| `--kilig-bright` | `#ff2d78` | pink on dark grounds |
| `--kilig-text` | `#c40f60` | pink as text on light (AA on every surface) |
| `--dir-yes` / `--dir-yes-text` / `--dir-yes-bar` | `#1f5fe0` / `#1a56cc` / `#bfd2f8` | YES fill / text / bar |
| `--dir-no` / `--dir-no-text` / `--dir-no-bar` | `#c94a12` / `#b3410f` / `#f2cfbc` | NO fill / text / bar |
| `--success` / `--warning` / `--danger` | `#0b7a52` / `#8f5400` / `#b3122e` | system messages only |
| `--cat-politics` … `--cat-general` | slate, green, violet, pink, teal, amber, ink | category icon tiles only (clear of YES blue / NO orange) |

Dark primitives are defined under `:root[data-theme="dark"]` (paper
`#0e0f13`, card `#17181f`, ink `#f4f3ef`, YES text `#7fa6ff`, NO text
`#ff8a4c`). Nothing sets `data-theme` yet: light is the default; dark mode is a
follow-up.

### 3.2 Role bindings (what components reference)

| Role | Resolves to |
|---|---|
| `--t1` / `--t2` / `--t3` (`--t4`) | ink / ink-2 / ink-3 |
| `--surface-1` / `--surface-2` (`--surface-3`) | card / raised |
| `--border-1` / `--border-2` | hairline / hairline-strong |
| `--accent`, `--accent-text`, `--focus-ring` | ink |
| `--accent-soft` | `--ink-soft` (ink 6%) — selection wash |
| `--ticket-cta-text` | white (text on ink) |
| `--live` / `--reward` | kilig; `-text` → kilig-text; `-soft` → kilig 9% |
| `--yes` / `--no` | dir-yes / dir-no (fills, strokes, bars) |
| `--yes-text` / `--no-text` | dir-yes-text / dir-no-text |
| `--yes-soft` / `--no-soft` | `color-mix` 8% (chip backgrounds) |
| `--tier-1..5` | ink-3, ink-2, ink, kilig-text, kilig |
| `--inert-*` | literal copies of raised / hairline / ink-3 |

**Deprecated names** (`--brand-deep/-dark/-purple/-lavender`,
`--signal-gold*`, `--on-brand`, `--on-gold`) still resolve (to ink-deep,
ink-deep-2, kilig, `#efeff3`, kilig, white) so unmigrated files render. Do not
use them in new code; replace them with the role they mean when you touch a
file.

## 4. Typography

| Face | Role | Loading |
|---|---|---|
| **Inter** (variable, optical-size axis) | Everything: UI, headings, market questions, labels and numbers. `font-sans`; `font-mono` / `.mono` are kept as *numeric* utilities (tabular figures), not a second face. | `next/font/google` → `--font-inter` |

Scale in use: landing hero 44–88px/600/−0.04em · page title 28px/650 ·
section title 20px/600 · market question 28px (detail), 22px (featured),
14.5px (cards) · body 14–16px · label 12–13px/500 · chance figures 20px
(card), 40–44px (featured, detail). Sentence case everywhere; uppercase
only for tickers. `.type-poster` is the heading class (semibold, tight,
sentence case) — the name survives from Kilig so existing headings moved
together.

## 5. Shape, elevation, imagery

- **Radius:** 6 tags · **8** controls/buttons (`--r-rh-md`) · **12** cards
  (`--r-rh-lg`) · 16 sheets/dialogs · pills for tags, search and the
  balance chip.
- **Elevation:** a whisper at rest (`--shadow-card`, 1px 4% ink) so cards
  read as objects on the paper; hover lifts to `--shadow-card-hover` with a
  border step. Rows inside a list (settings list, board rows) take a
  `--surface-2` wash instead. `--shadow-pop` is for floating layers only.
- **Market images** (`MarketThumb`): every market carries a square image —
  its photo when it has one (falling back on load error), otherwise its
  category's icon on a soft tile of the category tint. 40px in cards, 48px
  featured, 56px on the market page, 32px in lists.

## 6. Components

- **Buttons** (`ui/Button`): primary = ink fill, white label; secondary =
  white on a strong hairline; ghost; danger = `--danger`; `cta` = full-width
  ink commit button. Semibold labels, 8px radius, 1px press drop.
- **Segmented controls** (sort, window, market/limit): a recessed
  `--surface-2` track, the selected segment raised in white.
- **YES/NO buttons:** soft (`--yes-soft`/`--no-soft` + side text) at rest,
  filled on hover/press; the featured market uses filled buttons. Labelled
  "Yes"/"No" with the price; aria-label `"{n}% Buy Yes"`.
- **Inputs** (`ui/Input`): white on a hairline, ink focus, `aria-invalid` →
  `--danger` (never NO colour).
- **MarketCard:** image tile + question (up to 3 lines) + YES chance at the
  right, Yes/No buttons, one quiet line of volume · category · close date.
  Uniform size; the grid is 3 columns (2 ≤1020px, 1 ≤640px).
- **FeaturedMarket:** the most-traded contested market (10–90) on the first
  page, with image, question, big chance figure, outcome rows, filled
  Buy Yes/Buy No, and its real price chart; beside it a ranked Trending
  list of the next five.
- **MarketChart:** the selected side's line in its direction colour over a
  soft area, the complement muted; hour ticks on intraday ranges; range
  tabs with the current range on a soft chip. No "live data" caption;
  synthetic demo series wear the "Simulated data" badge.
- **MarketHead:** image, status · category · closes-in line, question, then
  the chance figure with a Yes/No price legend.
- **QuickTradePanel:** Yes/No opens the real ticket in place (Dialog
  >1023px, vaul Sheet ≤1023px).
- **Chrome:** TopBar and MobileTabBar are white with a hairline; wordmark =
  brand name + pink period; avatar = ink disc. Discovery pages
  (`/predict`, `/discover`) carry `CategoryTabs`, a sticky text-tab strip
  with an ink underline on the current topic. No left rail.
- **Selection** everywhere = ink (underline, pill or wash), never pink.

## 7. Trade ticket doctrine (unchanged)

The quote rows are the review surface; the CTA is **press-and-hold**. No confirm
modal. A partial fill states the remainder in the card body; a rejected order
states that no points were taken. Amounts and payouts are in points.

## 8. Layout

- Top bar 64px, sticky, white. Mobile tab bar fixed, white, safe-area padded.
- `/predict`: topic tabs, then a 1280px column: FeaturedMarket + Trending
  list → section title + search/sort/window → 3-column card grid.
  Filters drop the hero and show the grid only.
- `/market/[ticker]`: market column (max 920px: header + chart + stats card,
  rules, discussion, related) · 400px sticky trade rail; the rail moves to a
  Sheet ≤1023px. Breadcrumb: Markets / category / event.
- Touch targets ≥44px on phones. No horizontal scroll at 320px.

## 9. Motion

Intentional, never decorative: 150ms colour/border transitions; press =
1px drop + 1% squash; price ticks and the live dot fire only on real events;
entrance motion (`card-in`) runs once. Everything collapses under
`prefers-reduced-motion`.

## 10. Accessibility (WCAG 2.x, recomputed 2026-09-24)

| Pair | Ratio |
|---|---:|
| ink on card / paper | 18.85 / 17.31 |
| ink-3 on card / paper / raised | 6.41 / 5.89 / 5.49 |
| kilig-text on card / paper / raised | 5.86 / 5.38 / 5.02 |
| yes-text on card / paper / raised | 6.47 / 5.94 / 5.54 |
| no-text on card / paper / raised | 5.71 / 5.24 / 4.89 |
| white on ink / kilig / yes / no | 18.85 / 4.69 / 5.57 / 4.70 |
| kilig-bright on ink-deep | 5.38 |
| dark: ink on ground / muted on ground | 17.25 / 6.94 |

Raw `--kilig` is a fill (4.30 on paper): pink text on light uses
`--kilig-text`. Focus: 2px ink ring, 2px offset.

## 11. Copy

Prices: "44 pts" (never ¢), through `PTS_COUNT` ("1 pt" / "44 pts") or the
`PTS` key, never a literal. Probability: "44%" + "chance". Sides read "Yes" /
"No" (localized), never an uppercased enum. Sentence case everywhere. No "bet", "odds", "cash", "win money",
"prize", "redeem". Counted strings use i18next v4 plural keys
(`KEY_one` / `KEY_other`); the v3 `KEY_plural` suffix is ignored by the
installed i18next and renders "100 open market".

## 12. Back-office

`frontend/packages/office` uses `styles/p8-tokens.css` on Ant Design and is
not part of this system. Do not copy values between them.

## 13. Decisions log

| Date | Decision |
|---|---|
| 2026-08-22 | Purple + gold system adopted. **Superseded 2026-09-24.** |
| 2026-09-24 | "Pick. Win. Redeem." iPhone reward hero removed (points are non-redeemable). |
| 2026-09-24 | **Kilig revised** after review ("looks like a high-school project"): poster type (Big Shoulders), Martian Mono numerals, typographic poster tiles, the mixed-size grid and the left topic rail are retired. One typeface (Inter), market image tiles, a featured market with its real chart, a uniform 3-column grid, topic tabs, 12px cards with a whisper of elevation. Palette unchanged. |
| 2026-09-24 | **Kilig adopted** (`/design-consultation`): research across Kalshi, Polymarket, PrizePicks, Robinhood, Maya; Codex and an independent agent converged on hot pink + condensed poster type. Light default, dark primitives defined; poster words auto-derived. Preview: `~/.gstack/projects/jbrackens-taptrade/designs/design-system-20260924/kilig-preview.html`. |
