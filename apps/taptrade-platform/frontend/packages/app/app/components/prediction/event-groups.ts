import type { PredictionMarket } from "@taptrade-ui/api-client/src/prediction-types";

/**
 * Grid items for a ranked market list: markets that share a real event
 * (a game's moneyline, spread and total; an election's candidates) fold
 * into one event card, in the position of the first of them; everything
 * else stays a market card. Markets parked in a per-category catch-all
 * event (`eventSynthetic`) never group — they are unrelated questions.
 *
 * The activity ranking deliberately keeps an event's siblings apart, so a
 * page usually carries one market per event. A lone market whose event has
 * more open markets (`eventOpenMarkets`) still becomes an event card; the
 * card loads the rest of its rows itself.
 */
export type EventGroup = {
  kind: "event";
  eventId: string;
  title: string;
  markets: PredictionMarket[];
  /** Open markets in the event, when more than this list carries. */
  openMarkets: number;
};

export type GridItem = { kind: "market"; market: PredictionMarket } | EventGroup;

export const EVENT_CARD_ROWS = 3;

export function groupIntoEventCards(markets: PredictionMarket[]): GridItem[] {
  const byEvent = new Map<string, PredictionMarket[]>();
  for (const m of markets) {
    if (!m.eventId || m.eventSynthetic) continue;
    const list = byEvent.get(m.eventId);
    if (list) list.push(m);
    else byEvent.set(m.eventId, [m]);
  }

  const placed = new Set<string>();
  const items: GridItem[] = [];
  for (const m of markets) {
    const group = m.eventId && !m.eventSynthetic ? byEvent.get(m.eventId) : undefined;
    const openMarkets = Math.max(m.eventOpenMarkets ?? 0, group?.length ?? 0);
    if (!group || (group.length < 2 && openMarkets < 2)) {
      items.push({ kind: "market", market: m });
      continue;
    }
    if (placed.has(m.eventId)) continue;
    placed.add(m.eventId);
    items.push({
      kind: "event",
      eventId: m.eventId,
      title: m.eventTitle?.trim() || group[0].title,
      markets: group,
      openMarkets,
    });
  }
  return items;
}

/**
 * Whether an eyebrow would only repeat the title: the same words, or one a
 * prefix of the other ("New York Mets vs. Washington Nationals" over itself).
 */
export function repeatsTitle(eyebrow: string, title: string): boolean {
  const norm = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const a = norm(eyebrow);
  const b = norm(title);
  if (!a || !b) return false;
  return a === b || b.startsWith(a) || a.startsWith(b);
}

/**
 * Row labels for an event card: the source's own short label when it has
 * one ("Spread -3.5", "25 bps increase", "Lamine Yamal"), otherwise the
 * part of each question the rows do not share — "October 31" and
 * "November 30" rather than "US x Iran cease…" twice.
 */
export function eventRowLabels(
  markets: Pick<PredictionMarket, "title" | "outcomeLabel">[],
  eventTitle: string,
  matchWinner: string,
): string[] {
  const words = markets.map((m) => m.title.trim().split(/\s+/));
  let prefix = 0;
  let suffix = 0;
  if (words.length >= 2) {
    const shortest = Math.min(...words.map((w) => w.length));
    while (prefix < shortest - 1 && words.every((w) => sameWord(w[prefix], words[0][prefix]))) prefix++;
    while (
      suffix < shortest - prefix - 1 &&
      words.every((w) => sameWord(w[w.length - 1 - suffix], words[0][words[0].length - 1 - suffix]))
    )
      suffix++;
  }
  return markets.map((m, i) => {
    if (m.outcomeLabel?.trim()) return m.outcomeLabel.trim();
    const title = m.title.trim();
    if (eventTitle.trim() && title.toLowerCase() === eventTitle.trim().toLowerCase()) return matchWinner;
    if (words.length >= 2 && (prefix > 0 || suffix > 0)) {
      // A lone shared "Will" only comes off when a name follows ("Will Jack
      // Lowden …" → "Jack Lowden"); "Will there be no change…" keeps it,
      // because "There be no change" is not a label.
      const start = prefix === 1 && !/^\p{Lu}/u.test(words[i][1] ?? "") ? 0 : prefix;
      const middle = words[i].slice(start, words[i].length - suffix).join(" ").replace(/^[\s:–—-]+|[\s:,–—-]+$/g, "");
      if (middle) return capitalise(middle);
    }
    return marketLabelInEvent(title, eventTitle, matchWinner);
  });
}

function sameWord(a: string | undefined, b: string | undefined): boolean {
  return a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * The rows an event card shows: the most likely outcomes first, and never
 * a near-settled one (1–2% or 98–99%) while livelier outcomes are left to
 * show — "Will the Fed decrease… Yes 1%" sat inside the Fed card on
 * 2026-09-28 while the ranking kept such markets off the board.
 */
export function pickEventRows<T extends Pick<PredictionMarket, "yesPricePoints">>(markets: T[], limit: number): T[] {
  const lively = (m: T) => m.yesPricePoints > 2 && m.yesPricePoints < 98;
  const ordered = [...markets].sort((a, b) => b.yesPricePoints - a.yesPricePoints);
  const picked = ordered.filter(lively).slice(0, limit);
  if (picked.length === 0) return ordered.slice(0, limit);
  return picked;
}

/**
 * A market's label inside its event card: the event title is redundant
 * there, so "Chiefs vs. Dolphins: O/U 48.5" reads "O/U 48.5" and a
 * moneyline that repeats the event title reads "Match winner".
 */
export function marketLabelInEvent(
  marketTitle: string,
  eventTitle: string,
  fallback: string,
): string {
  const title = marketTitle.trim();
  const event = eventTitle.trim();
  if (!event) return title;
  if (title.toLowerCase() === event.toLowerCase()) return fallback;
  const prefix = title.toLowerCase().startsWith(event.toLowerCase())
    ? title.slice(event.length).replace(/^[\s:–—-]+/, "")
    : "";
  return prefix || title;
}
