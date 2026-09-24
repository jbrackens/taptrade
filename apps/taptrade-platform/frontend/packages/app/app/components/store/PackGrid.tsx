"use client";

/**
 * PackGrid — the purchasable point-pack catalogue on /store.
 *
 * Cards are whole-card <button>s (keyboard accessible for free) with an
 * aria-pressed selected state. The total is the prominent figure (Geist
 * Mono, whole Points via lib/points); base and bonus render separately —
 * bonus uses "+N bonus points" promotional language, never implying a
 * denomination change. Prices come from priceUsdCents through lib/usd only.
 * Badges render ONLY from real pack config (no fabricated urgency).
 */

import { useTranslation } from "react-i18next";
import type { StorePack } from "../../lib/api/store-client";
import { formatPointsAmount } from "../../lib/points";
import { formatUsdCents } from "../../lib/usd";

const GRID_CLASS =
  "grid gap-3 grid-cols-3 max-[1023px]:grid-cols-2 max-[639px]:grid-cols-1";
// No resting shadow, no lift — hover reads entirely through the border
// step (DESIGN.md §5 elevation doctrine).
const CARD_BASE_CLASS =
  "relative flex w-full cursor-pointer flex-col items-start gap-1.5 rounded-[var(--r-rh-lg)] border bg-[var(--surface-1)] p-4 text-left [font-family:inherit] transition-[border-color,background-color] duration-150";
const CARD_IDLE_CLASS =
  "border-[var(--border-1)] hover:border-[var(--border-2)]";
const CARD_SELECTED_CLASS = "border-[var(--accent)] bg-[var(--accent-soft)]";
// Marketing badge ("Popular") is an identity accent, the same licence as
// the MarketCard "Trending" dot — not a reward/loyalty amount.
const BADGE_CLASS =
  "inline-flex items-center rounded-[var(--r-pill)] bg-[var(--live-soft)] px-2 py-0.5 text-[12px] font-semibold text-[var(--live-text)]";
const NAME_CLASS = "text-sm font-bold text-[var(--t1)]";
const TOTAL_CLASS =
  "mono-wide text-[24px] font-semibold leading-tight text-[var(--t1)] tabular-nums font-mono";
const TOTAL_UNIT_CLASS = "ml-1 text-[13px] font-medium text-[var(--t3)]";
const SPLIT_CLASS =
  "text-xs text-[var(--t3)] tabular-nums font-mono";
// Bonus points are a generic point amount — ink, not the reward pink
// (DESIGN.md §3.2 + the Kilig brief scope pink to progress/streaks).
const BONUS_CLASS =
  "text-xs font-semibold text-[var(--t1)] tabular-nums font-mono";
const PRICE_ROW_CLASS =
  "mt-2 flex w-full items-center justify-between border-t border-[var(--border-1)] pt-2.5";
const PRICE_LABEL_CLASS = "text-[11px] font-medium text-[var(--t3)]";
const PRICE_CLASS =
  "text-sm font-semibold text-[var(--t1)] tabular-nums font-mono";

export interface PackGridProps {
  packs: StorePack[];
  selectedPackId: string | null;
  onSelect: (packId: string) => void;
}

export function PackGrid({ packs, selectedPackId, onSelect }: PackGridProps) {
  const { t } = useTranslation("store");
  return (
    // biome-ignore lint/a11y/useSemanticElements: labeled control group; fieldset/legend swap is queued for the P2 primitives pass (fieldset layout quirks)
    <div
      className={GRID_CLASS}
      role="group"
      aria-label={t("packs.heading", "Point packs")}
    >
      {packs.map((pack) => {
        const selected = pack.id === selectedPackId;
        return (
          <button
            key={pack.id}
            type="button"
            data-testid={`pack-card-${pack.id}`}
            aria-pressed={selected}
            onClick={() => onSelect(pack.id)}
            className={`${CARD_BASE_CLASS} ${
              selected ? CARD_SELECTED_CLASS : CARD_IDLE_CLASS
            }`}
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span className={NAME_CLASS}>{pack.name}</span>
              {pack.badge ? (
                <span className={BADGE_CLASS}>{pack.badge}</span>
              ) : null}
            </span>
            <span className={TOTAL_CLASS}>
              {formatPointsAmount(pack.totalPoints)}
              <span className={TOTAL_UNIT_CLASS}>{t("packs.unit", "pts")}</span>
            </span>
            <span className={SPLIT_CLASS}>
              {t("packs.base", "{{points}} base points", {
                points: formatPointsAmount(pack.basePoints),
              })}
            </span>
            {pack.bonusPoints > 0 ? (
              <span className={BONUS_CLASS}>
                {t("packs.bonus", "+{{points}} bonus points", {
                  points: formatPointsAmount(pack.bonusPoints),
                })}
              </span>
            ) : null}
            <span className={PRICE_ROW_CLASS}>
              <span className={PRICE_LABEL_CLASS}>
                {t("packs.priceLabel", "Price")}
              </span>
              <span className={PRICE_CLASS}>
                {formatUsdCents(pack.priceUsdCents)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
