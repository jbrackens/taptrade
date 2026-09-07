# Tap Trade Player App i18n — how it actually works

*Rewritten 2026-09-06. The previous version of this file described a plan for `apps/taptrade-platform/phoenix-frontend-brand-viegg` (Next 11, Pages Router, `next-i18next` 6, CommonJS translation modules). None of that describes the shipped system, and that tree is not built or deployed. This file now documents what is in the code.*

## Scope

The Player app: `apps/taptrade-platform/frontend/packages/app` (Next 16, React 19, App Router).

Static product UI copy is localized. Dynamic content — market titles/descriptions, user-generated text, notifications — is handled separately; see [Market content](#market-content-is-translated-server-side) below.

## What is wired up

- **Library:** `i18next` + `react-i18next` (`package.json`: `"i18next": "^23.7.0"`, `"react-i18next": "^13.5.0"`). There is **no** `next-i18next` dependency and no `appWithTranslation`.
- **Init:** `app/lib/i18n/config.ts` — `i18n.use(initReactI18next)`, plus a fetch backend for lazily loading namespaces.
- **Provider:** `app/lib/i18n/I18nProvider.tsx` — `I18nextProvider` from `react-i18next`.
- **Locale list and helpers:** `app/lib/i18n/locales.ts` — `supportedLocales`, `defaultLocale`, `isSupportedLocale`, `normalizeLocale`.
- **Selector:** `app/components/i18n/LanguageSelector.tsx`.
- **Persistence:** `localStorage` under `taptrade_locale` (`localeStorageKey`), with `taptrade_language` read as a legacy fallback (`legacyLocaleStorageKey`).
- **Translation files:** raw JSON at `public/static/locales/<locale>/<namespace>.json`. 58 namespaces in `en`.
- **Usage:** `useTranslation("<namespace>")` in ~58 component/page files.

### English is bundled, other locales are fetched

`config.ts` statically imports the English JSON for the init namespaces (common, header, sidebar, footer, account, settings, rewards, portfolio, leaderboards, prediction, market-content, page-home, language-selector) so i18next initialises synchronously on server and client with zero locale fetches. Non-English locales load through the fetch backend when `changeLanguage()` runs in `I18nProvider`'s effect, so a returning non-English user briefly sees English. Both tradeoffs are documented in the source comments — read them before changing the init path.

## Supported locales

| Code | Label |
|------|-------|
| `en` | English (default and fallback) |
| `zh-Hans` | 简体中文 |
| `zh-Hant` | 繁體中文 |
| `tl` | Tagalog |
| `ms` | Bahasa Melayu |
| `id` | Bahasa Indonesia |

Source of truth: `app/lib/i18n/locales.ts`. All six directories exist under `public/static/locales/`.

## Adding or changing a key

1. Edit `public/static/locales/en/<namespace>.json` directly. These JSON files **are** the source of truth — they are committed and served.
2. Add the same key to the other five locale files. English is the fallback, so a missing key degrades to English rather than rendering the raw key — except on statically bundled namespaces used by prerendered routes, where a missing English key renders as the literal key string in the HTML.
3. Consume it with `const { t } = useTranslation("prediction");` then `t("KEY_NAME")` / `t("KEY_WITH_VALUE", { value })`.
4. If you add a **new namespace** that a prerendered route needs at first paint, add its English import to the bundled list in `app/lib/i18n/config.ts` as well as to `NAMESPACES`.

### Do not run `bootstrap:locales`

`packages/app` still carries `yarn bootstrap:locales` → `scripts/translations/generate.js`, inherited from the old brand app. It regenerates `public/static/locales` from `packages/app/translations`, and that directory contains only `.gitkeep`. **Running it would wipe every committed locale file.** The same applies to `yarn watch` (`scripts/translations/watch.js`). Both scripts and the empty `translations/` directory are dead weight and should be removed rather than fixed.

## Market content is translated server-side

Market titles and descriptions are **not** hand-written locale files and **not** a future project — they are translated by a gateway-side batch backfill and consumed through the `market-content` namespace.

- Package: `go-platform/services/gateway/internal/markettranslate/` — `Backfill(ctx, store, translator, cfg)`, with a `Store` interface exposing `ListCandidates`, `CountUntranslated`, `CacheHashes`, `UpsertTranslation`. Source-hash caching means unchanged copy is not re-translated.
- Command: `cmd/translate-markets` (also reachable via `cmd/sync-markets`).
- Schema: migrations `028_market_translations.sql` and `029_market_translation_cache.sql`.
- Config: `AI_TRANSLATION_API_KEY`, `AI_TRANSLATION_ENDPOINT`, `AI_TRANSLATION_MODEL`, `AI_TRANSLATION_PROVIDER`.
- Deploy: an **optional** step in `.github/workflows/deploy-demo.yml` ("Optional market translation backfill"), which runs only on `workflow_dispatch` with `translate_markets`, or when the commit message contains `[translate-markets]`. It requires the `OPENROUTER_API_KEY` secret and fails loudly without it.

Consumers on the frontend include `app/category/[slug]/page.tsx`, `app/components/prediction/MarketFeed.tsx`, `MarketHead.tsx`, `CategoryPills.tsx` and the command palette.

Still out of scope for translation: chat messages, CMS/admin announcements, user-generated content, and notification bodies.

**Standing constraint if that scope ever widens:** nothing sent to a third-party translation provider may include session data, individual trading activity, or other user-identifying data without an explicit privacy/compliance review. The current backfill sends market title and description copy only.

## Tone

See `docs/localization-glossary.md` for the term list and tone rules. In short: natural, conversational product language of the kind used on ecommerce, fintech and news sites; regulatory and responsible-gaming copy may be more formal.
