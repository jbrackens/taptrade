# ADR-0013: Market cover sourcing (Wikidata-only) and serving (Caddy from a volume, not Next `public/`)

**Status:** Accepted — both parts implemented, most recently revised 2026-09-28.
**Date:** Serving decision: 2026-09-28 (commit `21ef9961`). Sourcing decision (Wikidata-only, dropping free-text search): 2026-09-28 (commit `1c14f85e`). Underlying persistent-volume decision: 2026-05-18 (commit `c302e4c7`).
**Deciders:** Not individually named in any commit.

> **Scope:** two coupled infrastructure decisions about market cover
> images: (1) where cover files are served from, (2) how a cover subject is
> resolved when the imported market's own source provides no image.
> **Authoritative for:** the serving path and resolver strategy.
> **Not for:** the resolver's category-fit / class-matching rules in detail
> — see `internal/discover/covers.go` and the corresponding section of
> `CLAUDE.md` for the full, current mechanics.

## Judgment call on ADR-worthiness

The 2026-09-29 documentation review judged these two decisions as ADR-worthy (not merely a
`CLAUDE.md` implementation note) because each is a **reversal of a prior
approach that silently failed in production** — not a green-field design
choice, but a decision made under an observed failure with recorded
evidence of what broke and why. That is the same shape as the other
significant-decision ADRs in this set. Both decisions already have their
rationale recorded (in commit messages and `CLAUDE.md`), satisfying this
doc set's rule against inventing rationale where none exists.

## Context

**Serving.** Market thumbnails are runtime state written by a sync
process, not build-time assets. Two failure modes were observed and fixed
in sequence:
- 2026-05-18 (`c302e4c7`): thumbnails were baked into the player image's `public/`, so a redeploy's `rsync -az --delete` wiped them, desyncing the DB's `image_url` from the files on disk — "all 32 image-cards 404'd live." Fixed by moving to a named `market_images` docker volume the player serves and the sync writes to, surviving `rsync --delete`, image rebuilds and container recreation.
- 2026-09-28 (`21ef9961`): even served from the volume, covers still 404'd — "The player's Next.js server serves `public/` from a file list taken at startup, so every cover the sync wrote after the last player restart 404'd... game images and all 107 entity photos on 2026-09-28, though the files were on the volume." Fixed by having **Caddy** serve `/images/markets/*` straight from the `market_images` volume (mounted read-only, one-day cache), bypassing Next's startup-time file list entirely.

**Sourcing.** The cover resolver went through a similar observed-failure →
fix cycle, recorded in commit `1c14f85e` (2026-09-28): "The resolver filled
almost no cards: Openverse refuses keyless requests, only markets fetched
in the current sync were considered, swept rows were never retried, and
Commons SVG renditions (flags, logos) were rejected because their thumb
URLs carry a query string." The fix included dropping free-text search
entirely: **"Free-text Wikipedia/Commons search is gone: it matched
namesakes."** `CLAUDE.md`'s cover-resolver section restates this rationale
independently: "Free-text Wikipedia/Commons search was tried and dropped
(it matched namesakes)."

## Decision and scope

**Serving:** market cover images are served by Caddy directly from the
`market_images` docker volume, never through the Next.js player's own
static-file serving. `CLAUDE.md`: "Market thumbnails (`/images/markets/*`)
are served by Caddy straight from the `market_images` volume, not by the
player: Next.js serves `public/` from a file list taken at startup, so
covers written by the sync after a player restart 404'd."

**Sourcing:** when an imported market's own source provides no usable
image, the resolver looks up the subject the market's title names on
**Wikidata only** — "the top search result whose label (or a 5+ character
alias) is exactly that name, of a known class that fits the market's
category" — then takes that class's image from Wikimedia Commons under a
free licence (flag for countries/US states, photo for people with 3+
sitelinks, a size-constrained mark for companies/brands, never a wide
wordmark). Free-text search against Wikipedia/Commons is explicitly
**not** used, because it matched namesakes (same name, wrong entity). App
Store icons are the documented last resort only, per `CLAUDE.md`'s full
resolver description.

## Alternatives considered

**Serving:** none discussed beyond the two approaches tried in sequence
(bake into the image → named volume served by the app → named volume
served by the edge proxy). Each commit fixes the specific failure mode
observed in the prior approach; no document weighs a CDN, object storage,
or other alternative.

**Sourcing:** the alternative actually tried and rejected is recorded —
free-text Wikipedia/Commons search — with the specific failure mode
(namesake collisions) given as the reason for dropping it. Other
alternatives (a curated/manual image library, a different open-image API,
paid stock licensing) are not discussed.

## Rationale and trade-offs

**Recorded, for both.** Serving: Next's `public/` directory is
enumerated once at process startup, so any file written after that point
by a separate sync process is invisible to the running server until a
restart — an architectural mismatch between "build-time static assets" and
"runtime-written state," fixed by moving the *serving* responsibility to
the process that doesn't have that startup-enumeration behavior (Caddy).
Sourcing: free-text search optimizes for surface-string match, which is
exactly the failure mode for a system that needs *entity* identity — a
market titled after a person, place or organization needs the *specific*
entity's image, not any image matching the search string, and namesakes
(same name, different entity) are common enough to have been observed in
production.

## Consequences and constraints

- **Verified at `4924a670`:** back-office **Market Images**
  (`GET /api/v1/admin/markets/images`, `PATCH /api/v1/admin/market-images/{id}`)
  gives operators a manual override path, and `image_origin='manual'` is
  never overwritten by the automated resolver (`CLAUDE.md`) — this is the
  designed escape hatch for cases the resolver gets wrong or can't cover.
- Trade-off accepted: organisations and software without a square-enough
  logo fall back to their photo rather than a wide wordmark. **Discrepancy:**
  `CLAUDE.md` says the same of brands, but the resolver's brand group
  (`gateway/internal/discover/covers.go`, `groupBrand`) has no photo (P18)
  fallback — a brand gets a square mark or nothing. Subjects with no
  free image at all fall back to a matchup tile or the category icon — the
  resolver is deliberately conservative about what it will display rather
  than showing a low-confidence match.
- Every sync backfills bare open imports on a 30-day retry cadence
  (`cover_checked_at`, migration `062`); clearing that field re-resolves or
  removes a cover regardless of the market's status.
- Openverse (a secondary source) is gated behind `OPENVERSE_API_TOKEN` and
  was unusable without one — per commit `1c14f85e`, "Openverse refuses
  keyless requests" was itself one of the original failure modes.
- **Open question:** whether the Caddy-serving fix (2026-09-28) fully
  resolved the class of "written after startup" staleness for *other*
  runtime-written static assets the player serves (if any) is not
  evaluated in this ADR — only market covers were investigated.

## Evidence

- Commit `21ef9961` (2026-09-28) — Caddy-serving fix and its failure-mode description (107 entity photos 404ing).
- Commit `1c14f85e` (2026-09-28) — Wikidata-only resolver rewrite, dropping free-text search, with its own failure-mode list.
- Commit `c302e4c7` (2026-05-18) — the earlier persistent-volume fix this builds on.
- `gateway/migrations/060_cover_resolver.sql`, `062_cover_checked_at.sql`, `063_cover_square_marks.sql`, `064_cover_fresh_files.sql` — schema support for the resolver (`image_origin`, `cover_lookups`, `cover_checked_at`).
- `CLAUDE.md`, player-app "Prediction pages" section — the current, fuller description of both decisions and the reasoning quoted above.
- `gateway/internal/discover/covers.go` — the resolver implementation (not read symbol-by-symbol in the 2026-09-29 documentation review; cited as the authoritative code location).

## Related

- `CLAUDE.md` — the living description this ADR draws its rationale citations from; treat `CLAUDE.md` as authoritative if the two ever disagree, since it is updated continuously and this ADR is a point-in-time record.
