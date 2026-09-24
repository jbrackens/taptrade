/**
 * Licensed topic cover photos (public/images/covers/, see CREDITS.md).
 * A featured moment without its own cover — and whose lead market has no
 * photo — falls back to its category's topic cover, so the home rail stays
 * photo-led. Categories without one (e.g. tech) fall back to the tinted
 * category tile. Pageant moments should set /images/covers/pageants.jpg
 * explicitly: the entertainment default is the showbiz cover.
 */
export const TOPIC_COVERS: Readonly<Record<string, string>> = {
  sports: "/images/covers/basketball.jpg",
  esports: "/images/covers/esports.jpg",
  entertainment: "/images/covers/showbiz.jpg",
  politics: "/images/covers/politics.jpg",
  economics: "/images/covers/economy.jpg",
  general: "/images/covers/culture.jpg",
};

export function topicCover(categorySlug: string | undefined | null): string | null {
  return TOPIC_COVERS[(categorySlug ?? "").toLowerCase()] ?? null;
}
