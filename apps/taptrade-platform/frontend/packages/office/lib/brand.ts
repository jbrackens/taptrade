/**
 * Brand configuration for the back office.
 *
 * Mirrors the player app's app/lib/brand.ts. Before this module the display
 * name was hardcoded in five separate files, so every rename left one of them
 * behind and the chrome drifted. The four chrome surfaces now read it: document
 * metadata, both login screens, and the header wordmark. The fifth site,
 * translations/en/error.js, keeps a literal "Tap Trade" because the i18n bundle
 * is loaded statically and does not evaluate this module.
 *
 * Resolves from NEXT_PUBLIC_BRAND_NAME at BUILD time — Next inlines
 * NEXT_PUBLIC_* into both the server and client bundles — defaulting to the
 * current "Tap Trade" brand so an unset env is a no-op. Same env contract as
 * the player app, so a white-label build sets one variable and both surfaces
 * follow.
 *
 * Deliberately narrow: the human-readable NAME only. The package name
 * (@taptrade-ui/office), import paths, env var keys, telemetry event names and
 * CSS classes are technical identifiers and keep their compact spelling.
 *
 * Lives in lib/ rather than app/lib/ because lib/ is the one directory this
 * package already shares between the App Router (app/) and the legacy Pages
 * Router components (components/, containers/) — no new import direction.
 */

export interface Brand {
  /** Display name / wordmark text, e.g. "Tap Trade". */
  name: string;
}

export const brand: Brand = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME || "Tap Trade",
};
