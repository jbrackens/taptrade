"use client";

/**
 * PlayLimitsCard — the player's own point-use and order-size limits
 * (behind FEATURE_LIMITS). Moved here from the retired /profile page.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  setPointUseLimits,
  setPredictionLimits,
  type SetPointUseLimitsRequest,
  type SetPredictionLimitsRequest,
} from "../../lib/api/compliance-client";
import { Button, Input } from "../ui";
import { useToast } from "../ToastProvider";
import { SettingsCard } from "./SettingsShell";

const LABEL_CLASS = "mb-1.5 block text-[13px] font-semibold text-[var(--t2)]";

export function PlayLimitsCard({ userId }: { userId: string }) {
  const { t } = useTranslation("settings");
  const toast = useToast();
  const [daily, setDaily] = useState("");
  const [weekly, setWeekly] = useState("");
  const [monthly, setMonthly] = useState("");
  const [maxOrder, setMaxOrder] = useState("");
  const [saving, setSaving] = useState(false);
  const dirty = Boolean(daily || weekly || monthly || maxOrder);

  async function save() {
    setSaving(true);
    try {
      if (daily || weekly || monthly) {
        const pointUse: SetPointUseLimitsRequest = {
          user_id: userId,
          dailyLimitPoints: daily ? Number(daily) : undefined,
          weeklyLimitPoints: weekly ? Number(weekly) : undefined,
          monthlyLimitPoints: monthly ? Number(monthly) : undefined,
        };
        await setPointUseLimits(pointUse);
      }
      if (maxOrder) {
        const prediction: SetPredictionLimitsRequest = {
          user_id: userId,
          maxOrderPoints: Number(maxOrder),
        };
        await setPredictionLimits(prediction);
      }
      toast.success(t("limits.saved", "Limits saved"));
    } catch (err: unknown) {
      toast.error(
        t("limits.saveFailed", "Couldn’t save your limits"),
        err instanceof Error ? err.message : undefined,
      );
    } finally {
      setSaving(false);
    }
  }

  const field = (id: string, label: string, value: string, set: (v: string) => void) => (
    <div>
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
      </label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={t("limits.none", "No limit")}
        className="w-full tabular-nums"
      />
    </div>
  );

  return (
    <SettingsCard
      id="limits"
      title={t("limits.title", "Play limits")}
      description={t("limits.description", "Cap the Clout you use and the size of any one order. Limits apply from your next order.")}
      footer={
        <Button type="button" variant="primary" size="sm" onClick={save} disabled={!dirty || saving}>
          {saving ? t("saving", "Saving…") : t("limits.save", "Save limits")}
        </Button>
      }
    >
      <div className="grid grid-cols-3 gap-4 max-[640px]:grid-cols-1">
        {field("limit-daily", t("limits.daily", "Daily (Clout)"), daily, setDaily)}
        {field("limit-weekly", t("limits.weekly", "Weekly (Clout)"), weekly, setWeekly)}
        {field("limit-monthly", t("limits.monthly", "Monthly (Clout)"), monthly, setMonthly)}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-4 max-[640px]:grid-cols-1">
        {field("limit-max-order", t("limits.maxOrder", "Largest order (Clout)"), maxOrder, setMaxOrder)}
      </div>
    </SettingsCard>
  );
}
