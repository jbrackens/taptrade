"use client";

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// Statically bundled English resources for every INIT_NAMESPACE (P12 perf,
// 2026-07-12). Bundling EN (~31KB raw / ~8KB gzip across all 11 files) lets
// i18next initialise synchronously with ZERO locale fetches, so first paint
// no longer waits on 11 network round-trips. The JSON files stay in
// public/static/locales/ untouched — non-EN locales (and lazy EN namespaces
// outside this list) still load through the fetch backend below.
import enCommon from "../../../public/static/locales/en/common.json";
import enHeader from "../../../public/static/locales/en/header.json";
import enSidebar from "../../../public/static/locales/en/sidebar.json";
import enFooter from "../../../public/static/locales/en/footer.json";
import enAccount from "../../../public/static/locales/en/account.json";
import enSettings from "../../../public/static/locales/en/settings.json";
import enRewards from "../../../public/static/locales/en/rewards.json";
import enPortfolio from "../../../public/static/locales/en/portfolio.json";
import enLeaderboards from "../../../public/static/locales/en/leaderboards.json";
import enPrediction from "../../../public/static/locales/en/prediction.json";
import enMarketContent from "../../../public/static/locales/en/market-content.json";
// The language selector's namespace is bundled so SSR never emits raw keys.
// (The old marketing landing's page-home namespace was retired when "/"
// became the market board, 2026-09-24.)
import enLanguageSelector from "../../../public/static/locales/en/language-selector.json";

/**
 * All available translation namespaces.
 * These correspond to JSON files under /public/static/locales/{lng}/<ns>.json
 */
const NAMESPACES = [
  "common",
  "header",
  "sidebar",
  "footer",
  "login",
  "register",
  "account",
  "portfolio",
  "leaderboards",
  "account-status-bar",
  "settings",
  "limits",
  "responsible-gaming",
  "self-exclude",
  "idle-activity",
  "session-timer",
  "language-selector",
  "api-errors",
  "error-component",
  "page-about",
  "page-terms",
  "page-privacy-policy",
  "notifications",
  "transactions",
  "security",
  "personal-details",
  "rewards",
  "bonus",
  "content",
  "prediction",
  "market-content",
  // Point Store (/store) — lazy namespace: NOT in INIT_NAMESPACES and not
  // statically bundled; the fetch backend loads it on first
  // useTranslation("store") mount. Store surfaces carry inline English
  // fallbacks so EN never flashes raw keys while the fetch resolves.
  "store",
];

const SUPPORTED_LANGUAGES = ["en", "zh-Hans", "zh-Hant", "tl", "ms", "id"];

/**
 * Dynamically load a namespace JSON from the public folder.
 * Works with Next.js public static file serving.
 */
const loadNamespace = async (
  lng: string,
  ns: string,
): Promise<Record<string, string>> => {
  try {
    const res = await fetch(`/static/locales/${lng}/${ns}.json`);
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
};

// Custom backend plugin for i18next that loads from /public/static/locales/
const fetchBackend = {
  type: "backend" as const,
  init: () => {},
  read: (
    lng: string,
    ns: string,
    callback: (err: Error | null, data: Record<string, string> | null) => void,
  ) => {
    loadNamespace(lng, ns)
      .then((data) => callback(null, data))
      .catch((err) =>
        callback(err instanceof Error ? err : new Error(String(err)), null),
      );
  },
};

/**
 * Critical namespaces available at init. All of these are bundled for
 * English (EN_RESOURCES below), so init is synchronous and fetch-free.
 * Page-specific namespaces are loaded on demand by useTranslation().
 */
const INIT_NAMESPACES = [
  "common",
  "header",
  "sidebar",
  "footer",
  "account",
  "settings",
  "rewards",
  "portfolio",
  "leaderboards",
  "prediction",
  "market-content",
  "language-selector",
];

// Build-time English resources for the init namespaces. Because every init
// namespace is present here for the default language, i18next has nothing to
// load from the backend at init — combined with initImmediate:false this
// makes module-level init fully synchronous on BOTH server and client, so
// SSR emits real English markup instead of an empty shell.
const EN_RESOURCES = {
  common: enCommon,
  header: enHeader,
  sidebar: enSidebar,
  footer: enFooter,
  account: enAccount,
  settings: enSettings,
  rewards: enRewards,
  portfolio: enPortfolio,
  leaderboards: enLeaderboards,
  prediction: enPrediction,
  "market-content": enMarketContent,
  "language-selector": enLanguageSelector,
};

// Only initialize once
if (!i18n.isInitialized) {
  i18n
    .use(fetchBackend)
    .use(initReactI18next)
    .init({
      lng: "en",
      fallbackLng: "en",
      load: "currentOnly",
      supportedLngs: SUPPORTED_LANGUAGES,
      ns: INIT_NAMESPACES,
      defaultNS: "common",
      resources: { en: EN_RESOURCES },
      // Bundled EN above + fetch backend for everything else: i18next only
      // hits the backend for namespaces missing from `resources` (non-EN
      // locales, and lazy page namespaces in any language).
      partialBundledLanguages: true,
      // Synchronous init: with all init namespaces bundled for the default
      // language there are no pending backend reads, so isInitialized is
      // true as soon as this module executes — no "initialized" event wait,
      // no blank first paint (see I18nProvider).
      initImmediate: false,
      interpolation: {
        escapeValue: false, // React handles XSS
      },
      react: {
        useSuspense: false, // Don't suspend — show keys as fallback
      },
    });
}

export { SUPPORTED_LANGUAGES, NAMESPACES };
export default i18n;
