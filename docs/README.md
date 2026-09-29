# Tap Trade documentation

> **Scope:** the map of the project's documentation — which document is the
> single source of truth for each topic — and the rules for keeping it current.
> **Last verified:** 2026-09-29 at commit `4924a670` — every document listed
> below exists at the path given; the core documents were written or reviewed
> against the code in the 2026-09-29 documentation review.

Tap Trade is a prediction market: players trade binary YES/NO contracts priced
1–99 in a non-redeemable play currency (Points internally, shown to players as
Clout). A Next.js player app and back office sit on a Go gateway and auth
service over Postgres and Redis. There is no cash-out; the money code that
exists is kept switched off ([ADR-0010](adr/0010-points-only-non-redeemable-launch-boundary.md),
[ADR-0012](adr/0012-cashier-merged-dark-behind-flags.md)).

## Where to start

| If you want to… | Read |
|---|---|
| Understand how the system fits together | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Know what the product does today, and what is stubbed or off | [SPEC_CURRENT.md](SPEC_CURRENT.md) |
| Run it locally, run tests, find an environment variable | [ENVIRONMENT.md](ENVIRONMENT.md) |
| Change the database | [DATA_MODEL.md](DATA_MODEL.md), then [the migrations README](../apps/taptrade-platform/go-platform/services/gateway/migrations/README.md) |
| Work as a coding agent in this repo | [`CLAUDE.md`](../CLAUDE.md) (rules and procedures), then this map |
| Pick up work | [TASKS.md](TASKS.md), with evidence in [TECH_DEBT.md](TECH_DEBT.md) |
| Know why something is the way it is | [DECISIONS.md](DECISIONS.md) and [`adr/`](adr/) |

## Documentation map

Each topic has one authoritative home. Other documents link to it rather than
repeating it.

### Core living documents

| Document | Authoritative for |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, gateway package map, middleware and auth chain, core patterns (idempotency, reservations, advisory locks, boot validation), request and data lifecycles, background workers, real-time, front-end structure |
| [DATA_MODEL.md](DATA_MODEL.md) | Tables, keys and constraints, ownership, state machines, units, idempotency keys, seed data, model-vs-migration discrepancies |
| [SPEC_CURRENT.md](SPEC_CURRENT.md) | Implemented capabilities and business rules, user flows, routes and pages, permissions, the API catalogue, and what is partial, stubbed, mocked, dormant or flagged off |
| [INTEGRATIONS.md](INTEGRATIONS.md) | External services, OAuth providers, AI providers, webhooks in and out, workers and scheduled jobs — with config keys and failure handling |
| [ENVIRONMENT.md](ENVIRONMENT.md) | Prerequisites, local setup, every environment variable, build/lint/test/migrate/seed commands, CI workflows |
| [DEPLOYMENT.md](DEPLOYMENT.md) | The demo deployment, the deploy pipeline, required production/staging configuration, edge hardening, backups |
| [TECH_DEBT.md](TECH_DEBT.md) | Open technical debt with evidence, impact and priority |
| [TASKS.md](TASKS.md) | The backlog: agreed work, recommended work, decisions needed, recently done |
| [DECISIONS.md](DECISIONS.md) | The ADR index and supersession chain; decisions recorded outside ADRs |

### Topic documents (authoritative for their topic)

| Document | Authoritative for |
|---|---|
| [`../DESIGN.md`](../DESIGN.md) | The player app's design system (it mirrors `globals.css`; the CSS wins if they disagree) |
| [`../STORE_AND_PAYMENTS.md`](../STORE_AND_PAYMENTS.md) | The point store contract (cited by code — keep the path) |
| [taptrade-economy-rules.md](taptrade-economy-rules.md) | Economy rules and their per-change record (cited by code — keep the path) |
| [compliance/geofencing-kyc.md](compliance/geofencing-kyc.md) | Geofencing and KYC policy and the open legal decisions (cited by code — keep the path) |
| [SOCIAL_LOGIN_SETUP.md](SOCIAL_LOGIN_SETUP.md) | How to register each social login provider and install its credentials |
| [i18n-implementation-notes.md](i18n-implementation-notes.md), [localization-glossary.md](localization-glossary.md) | How localization works; the terms translators keep stable |
| [content/2026-q4-ph-market-slate.md](content/2026-q4-ph-market-slate.md) | The approved Q4 2026 Philippine market slate |
| [ai-market-drafting/IMPLEMENTATION-PLAN.md](ai-market-drafting/IMPLEMENTATION-PLAN.md) | Design record of AI market drafting (cited by code — keep the path) |
| [`../apps/taptrade-platform/go-platform/services/gateway/LIVE_MARKETS_DECISION.md`](../apps/taptrade-platform/go-platform/services/gateway/LIVE_MARKETS_DECISION.md) | Why authenticated live-market data is behind a flag |

### Component guides (kept beside their code)

| Document | Purpose |
|---|---|
| [`../CLAUDE.md`](../CLAUDE.md), [`player/CLAUDE.md`](../apps/taptrade-platform/frontend/packages/app/CLAUDE.md) | Agent rules and procedures for the repo and the player package |
| [`player/README.md`](../apps/taptrade-platform/frontend/packages/app/README.md), [`office/README.md`](../apps/taptrade-platform/frontend/packages/office/README.md), [`go-platform/README.md`](../apps/taptrade-platform/go-platform/README.md) | Package orientation (`go-platform/README.md` is scanned by `TestLaunchDocsStayPointsOnly` — keep the path) |
| [`gateway/internal/ws/README.md`](../apps/taptrade-platform/go-platform/services/gateway/internal/ws/README.md) | WebSocket wire protocol |
| [`stack/ops/RUNBOOK.md`](../apps/taptrade-platform/ops/RUNBOOK.md) | The runbook: on-call incident scenarios, then routine procedures (Part 2) |
| [`stack/ERRORS.md`](../apps/taptrade-platform/ERRORS.md), [`stack/API_EXAMPLES.md`](../apps/taptrade-platform/API_EXAMPLES.md), [`stack/UPGRADE.md`](../apps/taptrade-platform/UPGRADE.md), [`stack/MIGRATION.md`](../apps/taptrade-platform/MIGRATION.md), [`stack/DX.md`](../apps/taptrade-platform/DX.md) | Developer guides (the last four carry staleness banners until rewritten: T-026) |
| [`stack/ops/backup/README.md`](../apps/taptrade-platform/ops/backup/README.md), [`stack/ops/grafana/README.md`](../apps/taptrade-platform/ops/grafana/README.md) | Backup scripts; dashboards and alert rules |
| `services/*/README.md`, `packages/cashier-sdk/README.md` | The dormant Node cashier trees |

### Records (point-in-time; not descriptions of today)

- [`adr/`](adr/) — decisions; never rewritten once accepted.
- [`audit/`](audit/) — dated audits and reviews. Their findings were
  re-verified into [TECH_DEBT.md](TECH_DEBT.md); `AUDIT_REPORT.md` and
  `IMPROVEMENT_PLAN.md` are cited by code, so keep their paths.
- [`archive/`](archive/) — retired documents, each with a banner saying what
  replaced it. The 2026-09-29 consolidation is indexed in
  [`archive/2026-09-29-docs-consolidation/`](archive/2026-09-29-docs-consolidation/README.md).
- Changelogs under `apps/taptrade-platform/` stopped in May–July 2026; use
  `git log` and [TASKS.md § Done recently](TASKS.md#done-recently).

## How to maintain these documents

These rules apply to people and coding agents alike.

1. **Same change, same PR.** A change to behaviour, architecture, schema, an
   integration or setup updates the authoritative document for that topic (see the
   map above) in the same commit or PR. A reviewer should reject a behaviour change
   whose authoritative doc was not touched.
2. **Decisions get an ADR.** A significant architectural decision (a new boundary,
   dependency, data ownership rule, deployment shape, or reversal of an earlier
   decision) gets a new ADR in [`adr/`](adr/) and a row in
   [DECISIONS.md](DECISIONS.md). Accepted ADRs are never rewritten: to change a
   decision, write a new ADR that supersedes it, mark the old one
   `Superseded by ADR-NNNN`, and update the living documents it affects. A dated
   "Status update" note at the bottom of an old ADR is allowed for facts (for
   example "implemented in migration 037"); the original body stays as written.
3. **Reconcile the backlog.** When work in [TASKS.md](TASKS.md) is finished or
   becomes obsolete, move it to "Done recently" (with the commit) or delete it with a
   one-line reason, and close or update the matching [TECH_DEBT.md](TECH_DEBT.md)
   entry.
4. **Verification metadata is earned.** Every living document starts with a scope
   line and a `Last verified: <date> at commit <sha> — <what was checked>` line.
   Change that line only when you actually re-checked the content against the code;
   editing one section does not re-verify the whole document — say which section you
   re-verified instead.
5. **Mark what you did not check.** Use the evidence markers below. Never state that
   something is deployed, that an integration works, or that tests pass unless you
   ran it or cite where it was verified.
6. **Open questions name their resolver.** Every **Open question** says what
   evidence or which decision (and by whom, if known) would close it.
7. **One home per fact.** Link to the authoritative document instead of copying.
   If you find the same fact in two places, keep it in the authoritative one and
   replace the other with a link.
8. **No secrets.** Environment variables are documented by name with placeholders
   (`<secret>`, `<dsn>`, `<url>`). Never paste values from `.env` files, compose
   files, CI secrets or the server.
9. **Retire, don't delete.** A document that is no longer current moves to
   [`archive/`](archive/) with a one-line note at its top saying what replaced it and
   when; living documents never link to archived ones as if they were current.

## Evidence markers

| Marker | Meaning |
|---|---|
| *(none)* | Verified against code, migrations or config at the commit in the document's header. |
| **Intent:** | Documented requirement or decision that is not (fully) implemented or not verified. |
| **Unverified:** | Carried over from an earlier document and not re-checked at the commit in the header. |
| **Discrepancy:** | Two sources disagree (code vs doc, model vs migration); both are cited. |
| **Recommendation:** | A suggestion, never a statement of fact. |
| **Open question:** | Unknown, with the evidence or decision needed to resolve it. |

Feature status words: **Complete**, **Partial**, **Stub** (UI or API exists, behaviour
faked or empty), **Mock** (fake implementation used in place of a real one),
**Dormant** (built but not mounted or wired), **Flagged off** (built and wired, off by
default).

## Path aliases

Source references are repo-relative paths in backticks, shortened with these
prefixes, plus the symbol where it matters — for example
`gateway/internal/http/handlers.go` (`gatewayRouteDomains`).

| Alias | Path |
|---|---|
| `gateway/` | `apps/taptrade-platform/go-platform/services/gateway/` |
| `auth/` | `apps/taptrade-platform/go-platform/services/auth/` |
| `platform-mod/` | `apps/taptrade-platform/go-platform/modules/platform/` |
| `player/` | `apps/taptrade-platform/frontend/packages/app/` (the Next.js app dir is `player/app/`) |
| `office/` | `apps/taptrade-platform/frontend/packages/office/` |
| `api-client/` | `apps/taptrade-platform/frontend/packages/api-client/` |
| `stack/` | `apps/taptrade-platform/` (compose files, Caddyfile, `ops/`, `scripts/`) |

Paths without an alias (`services/cashier-api/`, `packages/cashier-sdk/`,
`contracts/`, `scripts/`, `.github/workflows/`) are relative to the repository root.
