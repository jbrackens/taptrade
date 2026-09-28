"use client";

import { useTranslation } from "react-i18next";
import { WageringProgress } from "../components/WageringProgress";
import type { PlayerBonus } from "../lib/api/bonus-client";
import { formatPointsAmount } from "../lib/points";

// Same section and card recipe as the rest of /rewards.
const CLAIM_WRAP_CLASS = "mt-8";
const CLAIM_TITLE_CLASS = "m-0 text-[17px] font-semibold text-[var(--t1)]";
const CLAIM_BODY_CLASS = "m-0 mt-1 text-[13px] text-[var(--t3)]";
const PACKS_LIST_CLASS = "mt-3 grid grid-cols-2 gap-3 max-[640px]:grid-cols-1";
const PACK_ROW_CLASS =
  "flex items-start justify-between gap-3 rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] p-4 shadow-[var(--shadow-card)]";
const PACK_NAME_CLASS = "m-0 text-[14px] font-semibold text-[var(--t1)]";
const PACK_DESC_CLASS = "m-0 mt-1 text-[13px] leading-[1.45] text-[var(--t3)]";
const PACK_AMOUNT_CLASS =
  "whitespace-nowrap text-[14px] font-semibold tabular-nums text-[var(--reward-text)]";
const MISSION_PROGRESS_CLASS = "mt-0.5 text-[12px] text-[var(--t3)]";

export function ActiveBonusesControl({ bonuses }: { bonuses: PlayerBonus[] }) {
  const { t } = useTranslation("rewards");
  if (bonuses.length === 0) return null;
  return (
    <section className={CLAIM_WRAP_CLASS}>
      <h2 className={CLAIM_TITLE_CLASS}>
        {t("activeBonuses.title", "Active Clout bonuses")}
      </h2>
      <p className={CLAIM_BODY_CLASS}>
        {t(
          "activeBonuses.body",
          "Track promotional Clout and its progress.",
        )}
      </p>
      <div className={PACKS_LIST_CLASS}>
        {bonuses.map((bonus) => (
          <div key={bonus.bonusId} className={PACK_ROW_CLASS}>
            <div className="min-w-0 flex-1">
              <p className={PACK_NAME_CLASS}>
                {bonus.campaignName ||
                  t("activeBonuses.fallbackName", "Clout bonus")}
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
                {t("activeBonuses.remaining", "Clout remaining")}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
