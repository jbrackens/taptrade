export const supportedLocales = [
  { code: "en", label: "English" },
  { code: "zh-Hans", label: "简体中文" },
  { code: "zh-Hant", label: "繁體中文" },
  { code: "tl", label: "Tagalog" },
  { code: "ms", label: "Bahasa Melayu" },
  { code: "id", label: "Bahasa Indonesia" },
] as const;

export const defaultLocale = "en";
export const localeStorageKey = "taptrade_locale";
export const legacyLocaleStorageKey = "taptrade_language";

export type SupportedLocale = (typeof supportedLocales)[number]["code"];

export function isSupportedLocale(locale: string | null | undefined): locale is SupportedLocale {
  return supportedLocales.some((item) => item.code === locale);
}

export function normalizeLocale(locale: string | null | undefined): SupportedLocale {
  return isSupportedLocale(locale) ? locale : defaultLocale;
}
