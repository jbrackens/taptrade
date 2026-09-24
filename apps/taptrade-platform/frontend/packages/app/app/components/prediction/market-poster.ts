/**
 * Poster words for moment tiles (Kilig, DESIGN.md §5).
 *
 * Almost no markets carry photography, so a moment's visual is a
 * typographic poster: one short word in poster type with a Kilig accent,
 * cropped off the tile edge. The words are derived, never invented:
 *   - main   the category label ("Politics", "Sports", …)
 *   - accent the first standalone number in the question ("2028", "7"),
 *            or "?" when there is none — the market is a question.
 *
 * Poster numerals are artwork (aria-hidden), not data, so they are the
 * one place numerals appear in poster type rather than Martian Mono.
 */

export interface PosterParts {
  main: string;
  accent: string;
}

const NUMBER_TOKEN = /(?:^|[^\w.])(\d{1,4})(?![\w.]|\d)/;

export function posterParts(title: string, categoryLabel?: string): PosterParts {
  const main = (categoryLabel || "Moment").trim().split(/\s+/)[0] || "Moment";
  const match = NUMBER_TOKEN.exec(title);
  return { main, accent: match ? match[1] : "?" };
}
