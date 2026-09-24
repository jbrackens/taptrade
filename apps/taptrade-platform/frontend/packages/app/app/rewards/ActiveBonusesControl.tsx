"use client";

import { useTranslation } from "react-i18next";
import { WageringProgress } from "../components/WageringProgress";
import type { PlayerBonus } from "../lib/api/bonus-client";
import { formatPointsAmount } from "../lib/points";

const CLAIM_WRAP_CLASS =
  "mb-5 mt-6 border-t border-[var(--border-1)] pt-5 text-left";
const CLAIM_TITLE_CLASS =
  "m-0 mb-1 text-[13px] font-semibold text-[var(--t3)]";
const CLAIM_BODY_CLASS = "m-0 mb-3 text-sm leading-[1.55] text-[var(--t2)]";
const PACKS_LIST_CLASS = "mt-3 flex flex-col gap-2";
const PACK_ROW_CLASS =
  "flex items-center justify-between gap-3 rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-2)] p-3";
const PACK_NAME_CLASS = "m-0 text-sm font-bold text-[var(--t1)]";
const PACK_DESC_CLASS = "m-0 mt-0.5 text-xs leading-[1.45] text-[var(--t3)]";
const PACK_AMOUNT_CLASS =
  "whitespace-nowrap text-sm font-bold text-[var(--reward-text)] tabular-nums font-mono";
const MISSION_PROGRESS_CLASS =
  "mt-1 text-xs text-[var(--t3)] tabular-nums font-mono";

export function ActiveBonusesControl({ bonuses }: { bonuses: PlayerBonus[] }) {
  const { t } = useTranslation("rewards");
  if (bonuses.length === 0) return null;
  return (
    <div className={CLAIM_WRAP_CLASS}>
      <h3 className={CLAIM_TITLE_CLASS}>
        {t("activeBonuses.title", "Active point-play bonuses")}
      </h3>
      <p className={CLAIM_BODY_CLASS}>
        {t(
          "activeBonuses.body",
          "Track promotional gameplay points and their point-play progress.",
        )}
      </p>
      <div className={PACKS_LIST_CLASS}>
        {bonuses.map((bonus) => (
          <div key={bonus.bonusId} className={PACK_ROW_CLASS}>
            <div className="min-w-0 flex-1">
              <p className={PACK_NAME_CLASS}>
                {bonus.campaignName ||
                  t("activeBonuses.fallbackName", "Point-play bonus")}
              </p>
              <p className={PACK_DESC_CLASS}>
                {t("activeBonuses.status", "Status: {{status}}", {
                  status: bonus.status,
                })}
              </p>
              <div className="mt-2">
                <WageringProgress
                  requiredPoints={bonus.playRequiredPoints}
                  completedPoints={bonus.playCompletedPoints}
                  progressPct={bonus.playProgressPct}
                  expiresAt={bonus.expiresAt}
                />
              </div>
            </div>
            <div className="text-right">
              <div className={PACK_AMOUNT_CLASS}>
                {formatPointsAmount(bonus.remainingPoints)}
              </div>
              <div className={MISSION_PROGRESS_CLASS}>
                {t("activeBonuses.remaining", "pts remaining")}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
