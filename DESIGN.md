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
> of 2026-08-22. Scope: the **player app** (`frontend/packages/app`) only; the
> back-office runs its own palette (§12). Read this before any visual change.

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

1. **The moment leads.** Discovery pages open on one lead moment (poster,
   headline, YES/NO). Market lists mix sizes — never a uniform wall of
   identical cards.
2. **Colour is earned.** Chrome is ink, white and hairlines. Kilig pink is
   identity and liveness. Blue and orange mean YES and NO and nothing else.
3. **Ink is the interaction voice.** Primary buttons, selected pills, focus
   rings and links are ink. Pink is never the default button.
4. **Every comparable numeral is Martian Mono** with tabular figures. Poster
   art numerals (aria-hidden tiles) are the only exception.
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
| `--ink-deep` / `--ink-deep-2` | `#0b0b0e` / `#1c1d24` | poster ground, dark chrome |
| `--poster-ink` / `--poster-ink-2` | `#f4f3ef` / `#b8b8c0` | text on poster |
| `--kilig` | `#e0126e` | identity, LIVE/trending dots, fills |
| `--kilig-bright` | `#ff2d78` | pink on dark grounds, poster accents |
| `--kilig-text` | `#c40f60` | pink as text on light (AA on every surface) |
| `--dir-yes` / `--dir-yes-text` / `--dir-yes-bar` | `#1f5fe0` / `#1a56cc` / `#bfd2f8` | YES fill / text / bar |
| `--dir-no` / `--dir-no-text` / `--dir-no-bar` | `#c94a12` / `#b3410f` / `#f2cfbc` | NO fill / text / bar |
| `--success` / `--warning` / `--danger` | `#0b7a52` / `#8f5400` / `#b3122e` | system messages only |

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
| **Instrument Sans** (400–700, width axis) | UI, body, market questions, labels. Tailwind `font-sans`. | `next/font/google` → `--font-instrument-sans` |
| **Big Shoulders** (opsz axis → Display cut at size) | Poster type: uppercase page heroes, lead headlines, section titles, poster tiles. `.type-poster` / `font-poster`. | → `--font-big-shoulders` |
| **Martian Mono** (width 75–112.5) | Every comparable numeral. `font-mono` / `.mono` (width 87.5); `.mono-wide` (112.5) for hero numbers; `.mono-tight` (75) for dense tables. | → `--font-martian-mono` |

Scale in use: poster hero 40–80px · section title (poster) 28–40px · market
question 26–34px/600/−0.025em (detail), 16–19px (cards) · body 14–16px ·
label 12–13px/600 · micro (mono) 10.5–11.5px uppercase +0.06–0.1em.
Poster type is never used for market questions, body copy or data.

## 5. Shape, elevation, imagery

- **Radius:** 4 (tags, tight controls) · **6** controls/buttons/chips
  (`--r-rh-md`) · **8** cards (`--r-rh-lg`) · 12 sheets/dialogs · pills only
  for tags, search and the balance chip. The three historical scales resolve
  onto this one.
- **Elevation:** none at rest (`--shadow-card: none`). A card's hover is a
  border step `--border-1 → --border-2`, never a shadow or background change.
  Rows inside a list (the account settings list, board rows) take a
  `--surface-2` wash instead. `--shadow-pop` is for floating layers only.
- **Poster tiles** (`PosterTile`, `market-poster.ts`): ink-deep tile, the
  category word small in warm white over a big pink accent (the question's
  first number, or "?"), cropped off the bottom-left. Real market photos
  replace the art when a market has one (3 of 100 did at adoption); a photo
  that fails to load falls back to the art (feed rows: the monogram), never
  a broken-image glyph.

## 6. Components

- **Buttons** (`ui/Button`): primary = ink fill, white label, hover lifts toward
  the surface; secondary = white on a strong hairline; ghost; danger =
  `--danger`; `cta` = full-width ink commit button. Semibold labels, 6px
  radius, 1px press drop.
- **YES/NO chips:** soft (`--yes-soft`/`--no-soft` + side text) at rest,
  filled (`--yes`/`--no` + white) on hover/press. On poster grounds the
  buttons are filled. Always labelled YES/NO; aria-label `"{n}% Buy YES"`.
- **Inputs** (`ui/Input`): white on strong hairline, ink focus,
  `aria-invalid` → `--danger` (never NO colour).
- **Cards** (`ui/Card`): white, hairline, 8px; error edge = `--danger`.
- **MarketCard:** rank (mono) + category, pink "Trending" dot, question,
  big mono probability + "chance", YES/NO split bar, mono footer, YES/NO
  chips. `size="wide"` puts a poster tile beside the content.
- **MarketGrid** `pattern="mixed"`: 7-card rhythm (wide+std · 3 std ·
  std+wide) at 3 columns.
- **LeadMoment:** poster article (scorebug "Trending #1", poster headline,
  question, filled YES/NO, mono meta) + "Happening now" stack.
- **QuickTradePanel:** YES/NO opens the real ticket in place (Dialog >1023px,
  vaul Sheet ≤1023px).
- **MarketChart:** ink line for the selected side, muted complement, hour
  ticks on intraday ranges. No "live data" caption; synthetic demo series
  wear the "Simulated data" badge.
- **Chrome:** TopBar and MobileTabBar are white with a hairline; nav items
  are quiet pills (raised well when current); wordmark = brand name + pink
  period; avatar = ink disc. The category rail is white with an ink pill for
  the current topic.
- **Selection** everywhere = ink pill (or ink wash + ink stroke), never pink.

## 7. Trade ticket doctrine (unchanged)

The quote rows are the review surface; the CTA is **press-and-hold**. No confirm
modal. A partial fill states the remainder in the card body; a rejected order
states that no points were taken. Amounts and payouts are in points.

## 8. Layout

- Top bar 64px, sticky, white. Mobile tab bar fixed, white, safe-area padded.
- `/predict`: 224px light category rail + fluid main (max 1180px): quiet
  guide line → LeadMoment → poster section title + filters → mixed grid.
  Filters (search/sort/window) drop the lead and show the grid only.
- `/market/[ticker]`: topic rail · main · ticket rail; ticket moves to a Sheet
  ≤1023px. Breadcrumb links to the event page.
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

Prices: "44 pts" (never ¢), and "pts" comes from the `PTS` key, not a
literal. Probability: "44%" + "chance". Sentence case in UI; uppercase only
in poster type and mono micro-labels. No "bet", "odds", "cash", "win money",
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
| 2026-09-24 | **Kilig adopted** (`/design-consultation`): research across Kalshi, Polymarket, PrizePicks, Robinhood, Maya; Codex and an independent agent converged on hot pink + condensed poster type. Light default, dark primitives defined; poster words auto-derived. Preview: `~/.gstack/projects/jbrackens-taptrade/designs/design-system-20260924/kilig-preview.html`. |
