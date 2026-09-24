"use client";

/**
 * ThisWeekRail — the photo-led "This week in the Philippines" rail at the
 * top of the home board.
 *
 * Curated, not computed: it shows events an operator flagged `featured`
 * in the back office (Featured moments), each with its cover photo and the
 * live chance of its most-traded open market. Honest by construction:
 *  - it renders nothing until MIN_RAIL_MOMENTS featured events are open
 *    with at least one open market (the home page is then just the board);
 *  - a tile's image is the event cover, else the lead market's photo, else
 *    the category's licensed topic cover (topic-covers.ts), else a tinted
 *    category tile with its icon. Never an unlicensed or invented image.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { createPredictionClient } from "@taptrade-ui/api-client/src/prediction-client";
import type {
  PredictionEvent,
  PredictionMarket,
} from "@taptrade-ui/api-client/src/prediction-types";
import { logger } from "../../lib/logger";
import { categoryVisual } from "./MarketThumb";
import { localizedMarket } from "./market-content";
import { topicCover } from "./topic-covers";

const api = createPredictionClient();

/** The rail only appears once this many featured moments are live. */
export const MIN_RAIL_MOMENTS = 4;
const MAX_RAIL_MOMENTS = 5;

interface Moment {
  event: PredictionEvent;
  lead: PredictionMarket;
}

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function momentImage(moment: Moment): string | null {
  const candidates = [
    moment.event.coverImageUrl,
    moment.lead.imagePath,
    moment.lead.imageUrl,
    moment.lead.image_url,
    topicCover(moment.lead.categorySlug),
  ];
  return candidates.find((value) => value && value.trim().length > 0) ?? null;
}

function MomentTile({ moment, large }: { moment: Moment; large: boolean }) {
  const { t } = useTranslation("prediction");
  const [imageFailed, setImageFailed] = useState(false);
  const photo = momentImage(moment);
  const showPhoto = Boolean(photo) && !imageFailed;
  const { icon: Icon, tint } = categoryVisual(moment.lead.categorySlug);
  const pct = clampPercentage(moment.lead.yesPricePoints);

  return (
    <Link
      href={`/event/${moment.event.id}`}
      data-testid="this-week-tile"
      className={`group relative isolate flex min-w-0 flex-col justify-end overflow-hidden rounded-[var(--r-rh-lg)] p-4 text-white no-underline shadow-[var(--shadow-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)] ${
        large ? "min-h-[320px] min-[900px]:row-span-2" : "min-h-[152px]"
      } max-[640px]:min-h-[220px] max-[640px]:w-[82%] max-[640px]:shrink-0 max-[640px]:snap-start`}
      style={
        showPhoto
          ? undefined
          : {
              background: `linear-gradient(155deg, color-mix(in srgb, ${tint} 78%, white), ${tint})`,
            }
      }
    >
      {showPhoto ? (
        // biome-ignore lint/performance/noImgElement: curated covers are remote or /images/ uploads; next/image would need per-host config
        <img
          src={photo ?? undefined}
          alt=""
          aria-hidden="true"
          onError={() => setImageFailed(true)}
          className="absolute inset-0 -z-20 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
      ) : (
        <Icon
          aria-hidden="true"
          size={large ? 120 : 72}
          weight="duotone"
          className="absolute -right-3 -top-3 -z-20 opacity-25"
        />
      )}
      {/* Legibility scrim for the text on top of the photo. */}
      <span
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(0,0,0,0.08)_0%,rgba(0,0,0,0)_22%,rgba(0,0,0,0.35)_55%,rgba(0,0,0,0.82)_100%)]"
      />
      <span className="absolute right-3 top-3 rounded-full bg-[rgba(255,255,255,0.94)] px-2.5 py-1 text-[12px] font-semibold tabular-nums text-[var(--t1)]">
        {t("THIS_WEEK_YES_CHIP", { pct, defaultValue: `${pct}% Yes` })}
      </span>
      <span
        className={`font-semibold leading-tight tracking-[-0.02em] ${
          large ? "text-[24px] max-[640px]:text-[20px]" : "text-[16px]"
        }`}
      >
        {moment.event.title}
      </span>
      <span className="mt-1 line-clamp-2 text-[13px] leading-snug text-[rgba(255,255,255,0.86)]">
        {moment.lead.title}
      </span>
    </Link>
  );
}

export function ThisWeekRail() {
  const { t } = useTranslation("prediction");
  const { t: contentT } = useTranslation("market-content");
  const [moments, setMoments] = useState<Moment[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const events = await api.getEvents({
          featured: true,
          status: "open",
          pageSize: 12,
        });
        const withLeads = await Promise.all(
          (events.data ?? []).map(async (event) => {
            const markets = await api.getMarkets({
              eventId: event.id,
              status: "open",
              sort: "activity",
              pageSize: 1,
            });
            const lead = markets.data?.[0];
            return lead ? { event, lead: localizedMarket(contentT, lead) } : null;
          }),
        );
        if (!cancelled) {
          setMoments(
            withLeads
              .filter((moment): moment is Moment => moment !== null)
              .slice(0, MAX_RAIL_MOMENTS),
          );
        }
      } catch (err: unknown) {
        // The rail is an enhancement: on failure the board stands alone.
        logger.warn("ThisWeekRail", "featured moments load failed", err);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [contentT]);

  if (moments.length < MIN_RAIL_MOMENTS) return null;

  return (
    <section aria-labelledby="this-week-title" className="mb-10 max-[640px]:mb-8" data-testid="this-week-rail">
      <div className="mb-3">
        <h2
          id="this-week-title"
          className="m-0 text-[26px] font-semibold tracking-[-0.025em] text-[var(--t1)] max-[640px]:text-[22px]"
        >
          {t("THIS_WEEK_TITLE", "This week in the Philippines")}
        </h2>
        <p className="m-0 mt-1 text-[14px] text-[var(--t2)]">
          {t("THIS_WEEK_SUB", "The moments everyone's watching, priced by the crowd.")}
        </p>
      </div>
      <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-3 max-[900px]:grid-cols-2 max-[640px]:-mx-4 max-[640px]:flex max-[640px]:snap-x max-[640px]:snap-mandatory max-[640px]:scroll-px-4 max-[640px]:overflow-x-auto max-[640px]:px-4 max-[640px]:[scrollbar-width:none] max-[640px]:[&::-webkit-scrollbar]:hidden">
        {moments.map((moment, index) => (
          <MomentTile key={moment.event.id} moment={moment} large={index === 0} />
        ))}
      </div>
    </section>
  );
}
