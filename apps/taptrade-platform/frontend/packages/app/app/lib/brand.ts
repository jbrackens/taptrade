/**
 * Brand configuration (P3-04 / white-label).
 *
 * Single source of truth for the white-labelable brand identity. Values
 * resolve from NEXT_PUBLIC_BRAND_* env at BUILD time (Next inlines
 * NEXT_PUBLIC_* into both server and client bundles), defaulting to the current
 * "Tap Trade" brand so an unset env is a no-op. Switching brand = set the env (a
 * build-arg in the deploy, the same way NEXT_PUBLIC_WS_URL etc. are baked) and
 * rebuild — no code change. The launch name is SETTLED: the product launches as
 * Tap Trade, and the default below is that decision expressed as config rather
 * than a refactor.
 *
 * Scope today: brand NAME, support/legal contact, operator entity — the
 * visible chrome (title, nav/footer wordmark, login, home hero). DOCUMENTED
 * NEXT STEP: logo/video assets under public/brand/, per-brand accent tokens via
 * `data-brand` scoping over the P8 CSS variables in globals.css, and the
 * long-tail legal-copy pages (privacy/terms/about/responsible-gaming) which
 * still inline the name pending a counsel-reviewed copy pass.
 */

export interface Brand {
  /** Display name / wordmark text, e.g. "Tap Trade". */
  name: string;
  /** Operator legal entity, used in legal and footer copy. */
  legalEntity: string;
  supportEmail: string;
  privacyEmail: string;
  legalEmail: string;
  /** External support chat / help-center URL. */
  supportChatUrl: string;
}

export const brand: Brand = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME || "Tap Trade",
  legalEntity:
    process.env.NEXT_PUBLIC_BRAND_LEGAL_ENTITY || "DORA Research, Inc.",
  supportEmail:
    process.env.NEXT_PUBLIC_BRAND_SUPPORT_EMAIL || "support@taptrade.com",
  privacyEmail:
    process.env.NEXT_PUBLIC_BRAND_PRIVACY_EMAIL || "privacy@taptrade.com",
  legalEmail: process.env.NEXT_PUBLIC_BRAND_LEGAL_EMAIL || "legal@taptrade.com",
  // Reuses the pre-existing NEXT_PUBLIC_SUPPORT_CHAT_URL contract that
  // OpenChatButton already honored, so no env name churns.
  supportChatUrl:
    process.env.NEXT_PUBLIC_SUPPORT_CHAT_URL ||
    "https://support.taptrade.com/chat",
};
