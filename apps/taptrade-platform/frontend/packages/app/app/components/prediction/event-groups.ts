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
