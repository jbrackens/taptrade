> **Status (2026-09-29):** shipped (Phases A–D); kept here as the design
> record and build log because code comments cite it. What exists today:
> [SPEC_CURRENT.md](../SPEC_CURRENT.md) and [INTEGRATIONS.md](../INTEGRATIONS.md).
> What is still open: TD-046 in [TECH_DEBT.md](../TECH_DEBT.md) and D-9 in
> [TASKS.md](../TASKS.md).

# AI Market Drafting — Implementation Plan (v3.1)

**Status:** Shipped 2026-05-24 (Phases A–D). All three §13 decisions are resolved — see §16 (items 2 and 3, locked) and §19 (item 1). This file is an append-only build log; read §18 last, it supersedes the earlier "not started" and "required before live" notes.
**Author:** drafted via /plan-eng-review, hardened by 2 independent Codex reviews + web research
**Date:** 2026-05-23 (status corrected 2026-09-06)
**Scope owner:** Backoffice + Gateway

**Verified present 2026-09-06:** `office/lib/ai/` (`provider.ts`, `marketDrafter.ts`, `schemas.ts`, `marketQualityValidator.ts`, `marketDuplicateDetector.ts`, `marketResolutionSources.ts`, `marketTemplates.ts`, `evals/`), `office/lib/ingest/{ssrfGuard,urlFetch}.ts`, `office/app/api/market-bot/draft/route.ts`, `office/containers/prediction-markets/DraftFromArticleModal.tsx`, gateway migration `024_market_ai_drafting.sql`, and the routes `/api/v1/admin/market-sources`, `/api/v1/admin/ai-budget` and `/api/v1/admin/ai-budget/reserve` in `internal/http/prediction_handlers.go`.

**Still open** (from §18, unchanged): a live end-to-end run against a real model; the redirect / DNS-rebinding SSRF integration test; and populating `cost_micros` (the column exists in migration 024; the spend cap counts tokens today).

## 1. What this is

Extend the existing backoffice **Create Market** flow so an operator can paste (or link) a news
article and get 1-3 AI-drafted, validated, binary market candidates that **prefill the existing
create-market modal**. The operator edits and submits through the **existing** create path. The
market is born `unopened` (the draft state), the operator opens it, it trades, closes, and is
resolved through the **existing** manual resolution machinery.

This is NOT the standalone "AI Market Creator Bot" from the original PRD. We do not build a parallel
contract/review/publish system. We reuse what the platform already has and add only: an AI drafting
service (office-side), article + AI-generation provenance (gateway-side), and UI affordances.

### Non-goals (MVP)
Auto-publication (operator always opens), auto-resolution of news markets (manual only),
multiple-choice/scalar markets (binary only), PDF/screenshot/RSS ingestion, AI odds/probability,
a browsable candidate history table, non-English articles, a new role tier.

## 2. Locked decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Lean reuse**, not a parallel system | markets are already the contract; reuse lifecycle + resolution + audit |
| D2 | **LLM runs in an office Next.js API route**, not the Go gateway | keep slow/flaky model calls out of the trading core |
| D3 | **Paste + server-side URL fetch** | operator convenience; URL fetch hardened against SSRF (§7.1) |
| D4 | **Multi-provider via Vercel AI SDK**; OSS routine tier = extraction only, hosted hard tier = drafting + risk + block gate + QA | open-source-where-practical without a hand-rolled seam; safety on the strong model |
| D5 | **Binary-only** markets | platform is binary YES/NO; multi-outcome = N binary markets, deferred |
| D6 | **Admin-only** end to end | gateway admin routes are admin-gated; smallest permission surface |
| D7 | **Event picker / create-event** in the draft flow | not a seeded "Newsroom" event (taxonomy + lifecycle debt) |
| D8 | **Resolution UI ships in MVP** | AI markets can open, so they must be resolvable + criteria rendered |

## 3. What already exists (reuse — do NOT rebuild)

| Concern | Reuse | Location |
|---|---|---|
| Market = contract | `markets` + `events` + `categories/series` | — |
| Create market | `POST /api/v1/admin/markets` -> `Service.CreateMarket` (born `unopened`) | `internal/prediction/service.go:1241`, `internal/http/prediction_handlers.go:640` |
| Draft state | `unopened` market status | `internal/prediction/lifecycle.go` |
| Open to trading | operator "Open" action | `containers/prediction-markets/index.tsx:343` |
| Manual settlement | `admin-manual` source, `CanSettle=false` (AutoSettler skips, left for admin) | `internal/prediction/feed/manual.go` |
| Resolution | direct `ResolveMarket` on `closed` (settlements screen) OR propose->challenge->finalize | `internal/prediction/settlement.go:409`, migration `023_resolution_proposals_disputes.sql` |
| Roles/auth | gateway admin gate; office auth is client-side only (non-authoritative) | `internal/http/admin_handlers.go:277`, `office/utils/auth.ts` |
| Audit | `audit_logs` (mig 009), `prediction_lifecycle_events` | — |

## 4. Architecture & data flow

```
Operator (office, admin) pastes article text (+ optional URL, + optional notes)
   |
   v
office  POST /api/market-bot/draft   (Next.js API route, server-side, SELF-AUTHENTICATING)
   |   0. authenticate: read access_token + csrf_token from NextRequest.cookies, validate
   |      session + admin role  (office /api/* is NOT covered by the proxy auth guard — proxy.ts:39)
   |   1. ingest: URL? -> SSRF-guarded fetch + Readability extract; else use pasted text
   |   2. sha256(text), short excerpt, summary  (NEVER store/forward full copyrighted body)
   |   3. ROUTINE tier (OSS): extract entities / claims / dates  -> deterministic post-checks
   |   4. HARD tier (hosted): draft 1-3 binary candidates + AUTHORITATIVE risk class + block gate + QA
   |   5. zod-validate -> marketQualityValidator (deterministic rules)
   |   6. persist provenance to gateway (POST /api/v1/admin/market-sources) -> articleSourceId
   |
   v  candidates + articleSourceId  (candidates ephemeral; generation log persisted)
Operator picks a candidate -> PREFILLS the existing Create-Market modal
   |   settlementSourceKey="admin-manual", settlementRule="binary_outcome",
   |   settlementParams = typed criteria JSON (§6), articleSourceId set
   v
office -> POST /api/v1/admin/markets   (EXISTING path; CreateMarketRequest gains 1 optional field)
   |   gateway calls require: Cookie access_token + csrf_token AND X-CSRF-Token header (§7.3)
   v
gateway CreateMarket -> market 'unopened' (+ article_source_id FK, lifecycle 'created' event)
   v
operator "Open" -> trading -> close_at (AutoSettler skips manual) -> 'closed'
   v
resolution (manual): direct ResolveMarket OR propose -> challenge -> finalize (§8)
```

The trading core (AMM, matching, settlement workers) never calls the LLM. Provenance and the actual
market mutation live in the gateway (system of record). The LLM call lives office-side.

## 5. Data model delta

New migration `024_market_ai_drafting.sql` (do not edit shipped migrations; next number is 024).

```sql
-- +goose Up
CREATE TABLE prediction_article_sources (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url    TEXT,
  source_name   TEXT,
  title         TEXT,
  author        TEXT,
  published_at  TIMESTAMPTZ,
  language      TEXT DEFAULT 'en',
  jurisdiction  JSONB,
  excerpt       TEXT,                 -- short fair-use snippet only
  summary       TEXT,                 -- AI summary
  text_hash     TEXT NOT NULL UNIQUE, -- sha256(article text); dedupe
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE prediction_ai_generation_logs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_source_id  UUID REFERENCES prediction_article_sources(id) ON DELETE SET NULL,
  market_id          UUID REFERENCES prediction_markets(id) ON DELETE SET NULL,
  stage              TEXT NOT NULL,        -- 'ingest'|'extract'|'draft'|'risk'|'validate'
  tier               TEXT,                 -- 'routine'|'hard'
  model_provider     TEXT,
  model_name         TEXT,
  inference_endpoint TEXT,
  prompt_version     TEXT,
  input_json         JSONB,                -- REDACTED/TRUNCATED — never the full article body
  output_json        JSONB,
  risk_level         TEXT,
  validator_result   JSONB,
  blocked            BOOLEAN NOT NULL DEFAULT FALSE,
  latency_ms         INTEGER,
  input_tokens       INTEGER,
  output_tokens      INTEGER,
  cost_micros        BIGINT,               -- provider cost in millionths for spend caps
  created_by         TEXT,
  request_id         TEXT,
  error_message      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE prediction_markets
  ADD COLUMN article_source_id UUID REFERENCES prediction_article_sources(id);  -- nullable

-- +goose Down
ALTER TABLE prediction_markets DROP COLUMN IF EXISTS article_source_id;
DROP TABLE IF EXISTS prediction_ai_generation_logs;
DROP TABLE IF EXISTS prediction_article_sources;
```

Resolution criteria for a manual market live in the EXISTING `settlement_params` JSONB column,
as a **typed, versioned** shape (snapshotted immutably at create; rendered in the resolution UI):

```jsonc
{
  "schemaVersion": 1,
  "criteria": "Resolves YES if ...",
  "primarySources": ["ICC official website", "ICC press releases"],
  "edgeCases": ["Sealed warrants not publicly confirmed do not count", "..."],
  "invalidResolutionPolicy": "void if ...",
  "asOfCutoff": "2026-07-31T23:59:00Z",
  "timezone": "UTC",
  "promptVersion": "market_draft_v1"
}
```

NOTE: gateway enforces a **1 MB request body limit** (`cmd/gateway/main.go:108`). Never POST full
article bodies to the gateway. The `/admin/market-sources` payload carries excerpt + summary + hash
only.

## 6. AI provider layer (D4)

Use the **Vercel AI SDK** as the provider seam (in-process, TS-native; do not hand-roll adapters):

- `createOpenAICompatible({ baseURL })` covers OpenAI + self-hosted vLLM + local Ollama / LM Studio
  via one config. `@ai-sdk/anthropic` for native Anthropic.
- `createProviderRegistry` / `customProvider` give per-task logical aliases:
  `routine` -> local/OSS model, `hard` -> hosted model. Each task carries
  `model_provider`, `model_name`, `inference_endpoint` from config.
- `wrapLanguageModel` middleware records per-call provider/model/endpoint/tier/latency/tokens/cost
  into `prediction_ai_generation_logs` (audit + spend caps).
- `generateObject` (+ zod) for structured output.

### Tier routing (the safety boundary matters)
- **ROUTINE (OSS, cheap/free)** — article parsing, entity/claim/date extraction ONLY. Followed by
  deterministic post-checks.
- **HARD (hosted, strong)** — contract drafting, **authoritative risk classification, the
  block/publish gate**, and final QA. Risk and the block decision NEVER run on the cheap tier.

### Structured-output reliability
Constrain at the **serving engine**, do not rely on prompt-asking:
- vLLM: `structured_outputs.json` via the OpenAI client `extra_body` (note: `guided_json` was removed
  in vLLM v0.12.0).
- Ollama: native `format: <jsonschema>` (its OpenAI `response_format` ignores `json_schema`).
- Always zod-validate the result. ONE repair-retry max, then fail (no loop).
- Structured output is a structure guarantee only, NOT a correctness guarantee. Treat every model
  response as untrusted until zod + deterministic validation pass.

### Fallback
`ai-fallback` is allowed for the ROUTINE/extraction tier only. The HARD tier (drafting/risk/block)
**fails closed** — on provider error, surface the error and require retry/human review. Never silently
swap the model behind the safety gate.

### Config (env-driven, per environment)
```
AI_ROUTINE_PROVIDER=openai-compatible
AI_ROUTINE_MODEL=qwen2.5:14b
AI_ROUTINE_ENDPOINT=http://localhost:11434/v1
AI_HARD_PROVIDER=anthropic
AI_HARD_MODEL=claude-sonnet-4-6
AI_HARD_ENDPOINT=https://api.anthropic.com
AI_DAILY_SPEND_CAP_MICROS=...      # global daily cap (§7.4)
AI_PER_ADMIN_DAILY_CAP_MICROS=...
```

## 7. Security (the bulk of the real work)

### 7.1 SSRF (server-side URL fetch)
Pick ONE hard boundary plus simple app-level checks (do not stack three redundant defenses):
- **Preferred:** fetch through an **isolated egress proxy** with no route to the VPC / internal
  services / cloud metadata, plus IMDSv2 on the host. Then app-level scheme + IP checks are belt.
- **If no egress proxy:** the in-process boundary is `request-filtering-agent` (maintained;
  blocks non-unicast IPs) used with `got` (it does NOT work with native `fetch`/undici) PLUS manual
  re-validation of scheme + resolved IP on **every** redirect hop with the connection pinned to the
  validated IP (anti DNS-rebinding). This is mandatory if there is no network boundary.
- Always: scheme allowlist (http/https), redirect cap, total timeout, max response bytes,
  content-type allowlist, strip auth headers across redirects, audit each fetch.
- Isolate `got` to `office/lib/ingest/urlFetch.ts` only. Do not introduce `got` conventions into
  normal gateway calls (those stay on `fetch` + cookies/CSRF).
- Extraction: `@mozilla/readability` + `jsdom` on already-fetched HTML (adds no fetch surface).
  Do NOT use `@postlight/parser` (abandoned, bundles its own fetch).

### 7.2 Prompt injection (untrusted article text)
The article body is attacker-controllable. Layer defenses; no single layer is load-bearing:
- **Spotlighting / datamarking**: untrusted article text in its own fenced user turn with a
  randomized delimiter; system prompt says content inside the fence is data, never instructions.
- **Canary token** in the system prompt; reject the response if it leaks (signals steering).
- **Output is advisory.** `requires_human_review` is set by OUR code, never the model. The model's
  `risk_level` is input to a deterministic gate, not the gate itself.
- **Creation authority lives in deterministic code + human review.** Attacker text must be
  structurally incapable of creating a market by itself (markets start `unopened`; only an admin opens).
- A prompt-injection classifier (Llama Prompt Guard / Azure Prompt Shields) is OPTIONAL telemetry,
  a tripwire. Do NOT allow/block on its output (false confidence + false positives).

### 7.3 Auth & CSRF (verified against code)
- Gateway reads `access_token` cookie then `Authorization` (`httpx/middleware.go:257`). CSRF requires
  `csrf_token` cookie + matching `X-CSRF-Token` header on mutations (`httpx/middleware.go:388`).
  Enabled in `cmd/gateway/main.go:101`.
- Office login sets `access_token` HttpOnly + `csrf_token` readable (`office/app/api/auth/login/route.ts`).
- **TRAP:** office `/api/*` routes are skipped by the office proxy auth guard (`office/proxy.ts:39`).
  Therefore `/api/market-bot/draft` MUST authenticate itself: read `access_token` + `csrf_token` from
  `NextRequest.cookies`, validate session + admin role, and when calling gateway mutations construct
  minimal headers (`Cookie: access_token=..; csrf_token=..` plus `X-CSRF-Token: ..`). Do NOT
  blind-forward the entire browser cookie blob.

### 7.4 Abuse / cost controls
- Per-admin and global **daily spend caps**, enforced BEFORE any provider fallback (one hostile URL
  or a retry storm can otherwise burn money). Track cost in `prediction_ai_generation_logs.cost_micros`.
- Rate-limit `/api/market-bot/draft` per admin; URL-fetch quota per admin.

## 8. Settlement & resolution
- AI markets use `settlementSourceKey="admin-manual"`, `settlementRule="binary_outcome"`. The manual
  adapter has `CanSettle=false`, so the AutoSettler skips them and they wait for admin resolution.
- **Open decision (§13):** whether AI/news markets MUST go through propose -> 1h challenge -> finalize
  (migration 023, aligns with the launch dispute policy) rather than direct `ResolveMarket` on
  `closed` (`prediction_handlers.go:794`). If yes, block/hide the direct settle path for AI-sourced
  markets.
- Resolution UI MUST render the typed `settlement_params` criteria at propose/finalize time, and the
  office markets screen status color map must add `proposed_resolution` and `disputed`
  (`containers/prediction-markets/index.tsx:33`).

## 9. Phases (with real paths)

**Phase A — Gateway (Go)** (~0.5-1 day CC)
1. `migrations/024_market_ai_drafting.sql` (§5).
2. `internal/prediction/types.go`: add `ArticleSourceID *string` to `CreateMarketRequest`; new
   `ArticleSource` + `AIGenerationLog` types.
3. `internal/prediction/service.go` `CreateMarket`: set `article_source_id`; add `CreateArticleSource`
   (dedupe on hash) + `LogAIGeneration`. Emit a distinct `ai_drafted` lifecycle/audit event separate
   from `created` and `opened` (immutable, actor-bound).
4. `internal/prediction/sql_repository.go`: writes for the 2 tables + new column; extend `Repository`
   interface + fakes.
5. `internal/http/prediction_handlers.go`: `POST /api/v1/admin/market-sources` (admin-gated; small
   payload only — excerpt/summary/hash, never full body).

**Phase B — Office AI core (TS)** (~1-1.5 days CC; parallel with A)
6. `office/lib/ai/provider.ts` — Vercel AI SDK registry (routine/hard aliases), middleware logging.
7. `office/lib/ai/schemas.ts` — zod schemas (binary candidate, analysis).
8. `office/lib/ai/marketDrafter.ts` — extraction (routine) + drafting/risk/QA (hard) + spotlighting +
   canary; structured output via serving-engine constraints + zod.
9. `office/lib/ai/marketQualityValidator.ts` — deterministic rules: required fields, vague-term
   blocklist, deadline sanity (close < resolution, future), binary outcomes exactly `[Yes,No]`,
   >=1 source, `requires_human_review` set here (not from model).
10. `office/lib/ingest/urlFetch.ts` — SSRF-hardened fetch (§7.1) + Readability extraction. Isolated.
11. `office/pages/api/market-bot/draft.ts` — self-authenticating (§7.3), rate-limited, spend-capped,
    calls gateway `/admin/market-sources` for provenance.

**Phase C — Office UI (TS)** (~0.5-1 day CC; after B)
12. Extend `containers/prediction-markets/index.tsx`: "Draft from article" entry, generate panel
    (textarea + URL + notes), candidate cards (question/type/close/quality/risk/why/warning),
    "Use this" -> `form.setFieldsValue(...)` prefill; add `proposed_resolution`/`disputed` to the
    status map.
13. Event picker / minimal create-event in the draft flow (D7) — replaces the free-text Event UUID.
14. Resolution UI: render typed `settlement_params` criteria at propose/finalize (settlements screen).
15. `api-client/src/prediction-client.ts` + `prediction-types.ts`: add `articleSourceId` to
    `CreateMarketRequest`; add `createMarketSource()`.

**Phase D — Wire + tests** (§10) (~0.5 day CC)

## 10. Test plan (coverage targets)

```
office/lib/ingest/urlFetch.ts
  [REQUIRED] blocks 169.254.169.254 / 10.x / 127.x / ::1 / redirect->internal / DNS-rebinding
  [REQUIRED] timeout + byte-cap + scheme allowlist enforced
office/lib/ai/marketQualityValidator.ts
  [REQUIRED] rejects missing/past deadline, close>resolution, vague terms, non-[Yes,No], no source
  [REQUIRED] requires_human_review is set by code regardless of model output
office/lib/ai/marketDrafter.ts
  [REQUIRED] invalid JSON -> typed error, no crash; ONE repair-retry then fail
  [GAP->EVAL] golden-set (legal/sports/crypto/elections/already-resolved/private-individual):
             binary+deadline+sources present; allegation-as-fact rejected; injection payload ignored
office/pages/api/market-bot/draft.ts
  [REQUIRED] unauthenticated request -> 401; non-admin -> 403
  [REQUIRED] spend cap exceeded -> 429; rate limit -> 429
  [→E2E] paste -> candidates -> prefill -> create 'unopened' -> open
gateway internal/prediction (Go)
  [REQUIRED] CreateMarket persists article_source_id
  [REQUIRED] CreateArticleSource dedupes on text_hash
  [REQUIRED] /admin/market-sources requires admin + CSRF; rejects >1MB body
  [REQUIRED] ai_drafted audit event is separate + actor-bound
```

## 11. Failure modes (new codepaths)

| Codepath | Failure | Mitigation | Visible? |
|---|---|---|---|
| urlFetch | SSRF / DNS-rebinding | one hard boundary + per-redirect re-validate (§7.1) | yes (refused) |
| urlFetch | paywall / garbage HTML | fall back to paste with message | yes |
| LLM hard tier | timeout / 429 / 5xx | fail closed, retry/review, no fallback swap | yes |
| LLM output | invalid JSON | serving-engine constraint + zod + 1 retry | yes |
| LLM content | hallucination / allegation-as-fact / injection | spotlighting + deterministic validator + human review (only backstop) | mitigated |
| provenance | gateway down / >1MB | persist source before create; small payload only | degrades |
| spend | retry storm / hostile URL | per-admin + global daily caps before fallback | yes (429) |
| manual market | never resolved | existing settlement queue surfaces closed-unsettled | yes |

Critical: hallucination has no automated catch. The human review gate (markets stay `unopened`) is
the only backstop. The model's risk verdict is advisory; deterministic code + human approval hold
creation authority.

## 12. Parallelization

| Lane | Work | Depends on |
|---|---|---|
| A (gateway) | mig 024, types, service, repo, /admin/market-sources | — |
| B (office AI core) | provider, schemas, drafter, validator, urlFetch, draft route | — |
| C (office UI) | modal, event picker, resolution UI, api-client | B |

Launch A and B in parallel worktrees (no shared files). Merge. Then C. Agree the field name
`articleSourceId` up front (the only A/B contract touchpoint).

## 13. Open decisions (resolve before/at Phase A)

1. **Direct-settlement policy for AI/news markets.** Force propose->challenge->finalize (1h window,
   aligns with launch dispute policy) and block direct `ResolveMarket` for AI-sourced markets? —
   Recommend YES.
2. **OSS routine model + where it runs** (local dev via Ollama vs a self-hosted vLLM box) + cost/
   latency budget + per-environment endpoint config.
3. **Egress proxy availability** — determines SSRF approach (§7.1): proxy boundary vs in-process
   `request-filtering-agent` + redirect re-validation.

## 14. Review trail

- `/plan-eng-review` — scope challenge (cut PRD's 6 tables -> 2 + 1 column), architecture, tests.
- Codex review #1 — 5 factual corrections (admin-only gating; direct-settle exists; office modal
  drops fields; status map incomplete); moved risk classification to the hard tier.
- Web research — SSRF (don't hand-roll), structured output (constrain at engine), prompt injection
  (advisory output + code/human gate), provider routing (adopt Vercel AI SDK), dedup.
- Codex review #2 — flagged over-correction (simplified SSRF/injection/dedup/fallback), verified the
  office-API self-auth + CSRF trap, caught 1 MB body limit + spend caps + audit granularity +
  direct-settlement bypass.

## 15. Deferred (NOT in scope, captured)

Multiple-choice/scalar markets, auto-publication, auto-resolution, PDF/screenshot/RSS, AI
odds/probability, browsable candidate table, semantic dedup (pgvector + embeddings + LLM-judge —
start with text_hash + ticker/title uniqueness + normalized (entity, direction, deadline) key; add
embeddings only when real duplicate volume appears), non-English, lower-role drafting, prompt-injection
classifier as a control (telemetry only).

## 16. Phase B — autonomous progress (2026-05-24)

Done overnight, on `feat/ai-market-drafting`, scoped to verifiable, zero-new-dependency,
decision-independent pieces (office test runner is **vitest**, not the broken legacy jest):

- `office/lib/ai/types.ts` — `MarketCandidate` and related shapes.
- `office/lib/ai/marketQualityValidator.ts` — deterministic §17 validation. The model's
  risk verdict is advisory; this code computes `requiresHumanReview` and the publish gate.
- `office/lib/ingest/ssrfGuard.ts` — pure SSRF core: scheme allowlist + blocked-IP ranges
  (v4/v6, incl. `169.254.169.254` + AWS IMDS v6 + ULA/link-local/CGNAT/mapped-v4).
- `office/tests/market-quality-validator.test.ts` + `office/tests/ssrf-guard.test.ts` —
  17 vitest tests, all green; the lib files are `tsc --strict` clean.

**Deferred — needs decisions, new deps, and/or live API keys (do NOT start blind):**
- Provider seam (Vercel AI SDK) — needs `ai` + adapters installed; assumed default per §6.
- SSRF **fetch wiring** (DNS-resolve + connection-pin + redirect re-validation) — needs the
  egress-proxy-vs-in-process decision (§13.3) + `got` + `request-filtering-agent`; the pure
  classifier above is the testable core, the network layer is the open part.
- Article extraction (`@mozilla/readability` + `jsdom`) — needs deps.
- `app/api/market-bot/draft/route.ts` (App Router; self-authenticating per §7.3 using the
  `adminFetch`/cookie+CSRF pattern) — needs the seam + can't be e2e-tested without LLM keys.

**LOCKED decisions — John approved, Codex-concurred 2026-05-24 (supersedes §13 items 2 & 3):**
1. **Provider layer = Vercel AI SDK** (`createOpenAICompatible` + `@ai-sdk/anthropic`,
   `createProviderRegistry`/`customProvider`, `wrapLanguageModel` audit middleware,
   `generateObject`). Caveat: pin exact provider/model IDs, centralize registry config, keep
   audit logging non-blocking but failure-visible.
2. **SSRF (dev/Phase B) = in-process** `request-filtering-agent` + `got` + per-redirect
   re-validation with the connection pinned to the resolved IP; scheme allowlist, redirect
   cap, timeout, max-bytes; `got` isolated to the urlFetch module.
   **RELEASE GATE (Codex):** this is NOT production egress isolation — server-side URL fetch
   must be blocked/degraded in production until an isolated egress proxy exists, and the
   redirect + DNS-pinning paths need integration tests before prod.
3. **Tiers:** routine (extraction only) = local/self-hosted OSS, default `qwen2.5` via Ollama
   at `http://localhost:11434/v1`; hard (drafting + risk classification + block/publish gate +
   QA) = `claude-sonnet-4-6`; env-configured (`AI_ROUTINE_*` / `AI_HARD_*`). Risk + block gate
   NEVER on the cheap tier. Caveat: pin exact OSS model/version, allowlist the routine
   endpoint, and handle Ollama native `format` vs OpenAI `response_format` explicitly (Ollama's
   OpenAI endpoint ignores `json_schema`). Structured output constrained at the serving engine +
   zod net + at most one repair-retry.

Resolved (separate from the 3 above): §13 item 1 — AI/news markets use **direct admin resolve
(Option B)**, no propose→challenge→finalize window. See the decision record in §19.

## 17. Phase B build complete (2026-05-24, office-side)

Built on `feat/ai-market-drafting` per the locked decisions. All new modules are
`tsc --strict` clean; 45 vitest tests pass.

- `lib/ai/schemas.ts` — zod schemas for LLM output (`requiresHumanReview` excluded; model can't set it).
- `lib/ai/provider-types.ts` + `lib/ai/provider.ts` — `ModelProvider` seam + Vercel AI SDK v6 adapter, env-routed tiers (`AI_ROUTINE_*` / `AI_HARD_*`).
- `lib/ai/marketDrafter.ts` — two-tier orchestration (routine extract → hard draft/risk/block), article spotlighting + canary injection tripwire, deterministic validator integration, MVP forces human review.
- `lib/ingest/urlFetch.ts` — SSRF-guarded fetch (request-filtering-agent + got + per-redirect re-validation) + Readability/jsdom extraction.
- `lib/market-bot/validation.ts` + `app/api/market-bot/draft/route.ts` — `POST /api/market-bot/draft`: self-auth, validation, ingest, draft, persist provenance to the gateway.
- Tests: market-quality-validator, ssrf-guard, ai-schemas, market-drafter (mock provider), ai-provider (env), url-fetch (extract + SSRF pre-check), draft-validation.

**Verified offline:** validation, SSRF classification + URL pre-check, schema parsing, drafter orchestration (mock provider incl. canary block), env routing, Readability extraction.

**NOT yet verified (integration-pending — needs an LLM endpoint + key + a running gateway/auth):**
the live `generateObject` calls, the real URL fetch/redirect path, and the gateway provenance round-trip. These are type-checked only.

**Required before enabling live (carry-over from §16 + Codex):**
1. Per-admin rate limiting + model spend caps (needs a shared store) on the draft route.
2. Production SSRF egress isolation gate (block/degrade URL fetch until an isolated egress exists) + redirect/DNS-pin integration tests.
3. Surface per-call provider/model/usage/cost from the drafter into the gateway generation log (currently a minimal stage-only log) for the audit trail + spend caps.
4. An LLM eval suite (golden articles) before trusting drafting quality.

*(The "Phase C (not started)" bullet that stood here was already false when §18 was written the same day, and was removed on 2026-09-06. Phase C shipped — see §18.)*

## 18. Phase C + §17 hardening complete (2026-05-24)

Supersedes the "not started" / "required before live" notes above.

- **Phase C shipped:** Draft-from-article modal + candidate cards + prefill; event picker; inline create-event (gateway `POST /api/v1/admin/events` + UI); resolution UI (`proposed_resolution`/`disputed` statuses + AI criteria rendered in the settle modal).
- **§17a** — richer audit logging: per-call provider/model/tokens flow into the gateway generation log. ✓
- **§17b** — production SSRF egress gate: URL fetch off by default in prod (`AI_URL_FETCH_ENABLED` to opt in; `AI_URL_FETCH_DISABLED` kill switch). ✓
- **§17c** — per-admin rate-limit + daily token cap: gateway-enforced + DB-backed via `GET /api/v1/admin/ai-budget`; office pre-flight fails closed. ✓
- **§17d** — LLM eval harness + golden fixtures (`lib/ai/evals`) with a tested property checker; real-model run via `runEval(createAISDKProvider())` when a key is set. ✓

**Still genuinely remaining (need a key/infra; not buildable offline):**
1. A live end-to-end run (LLM endpoint + key + running gateway) — the whole AI path is unit/integration-tested with mocks but never run against a real model.
2. The redirect/DNS-rebinding SSRF integration test (needs a controlled server + DNS harness).
3. `cost_micros` population via a per-model price map (the spend cap uses tokens today; `cost_micros` is logged-but-empty for reporting).

Test footprint: 87 office vitest tests (14 files) + the gateway Go suite (AI provenance, budget, create-event, plus DB-backed dedupe/log integration tests).

## 19. Decision record — §13 item 1 (resolved 2026-05-24)

**Decision:** AI/news markets resolve via **direct admin resolve (Option B)** — no
propose→challenge→finalize window.

**Rationale:** We only offer markets with a clear, unambiguous resolution, so a public
challenge window adds latency without buying safety. The safety net shifts entirely
**pre-publication**: mandatory human review on every AI draft plus the AI risk/ambiguity
flags (both already enforced) gate what ever reaches `open`. The windowed flow (mig 023,
propose→challenge→finalize, dual-control) remains available in the gateway and is unaffected.

**Code impact:** none. The gateway already supports direct `ResolveMarket` on `closed`
markets; nothing forces the window for `article_source_id != nil` markets.

**Revisit if:** we introduce contested/ambiguous AI markets — at that point, enforce the
windowed flow specifically for markets with `article_source_id != nil`.
