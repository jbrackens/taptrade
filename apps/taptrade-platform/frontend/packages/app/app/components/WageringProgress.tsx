"use client";

import type React from "react";
import { useTranslation } from "react-i18next";
import { formatPoints } from "../lib/points";

interface WageringProgressProps {
  requiredPoints: number;
  completedPoints: number;
  progressPct: number;
  expiresAt: string;
}

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr).getTime();
  const now = Date.now();
  const diff = target - now;
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export const WageringProgress: React.FC<WageringProgressProps> = ({
  requiredPoints,
  completedPoints,
  progressPct,
  expiresAt,
}) => {
  const { t } = useTranslation("bonus");
  const daysLeft = daysUntil(expiresAt);
  const isExpired = daysLeft <= 0;
  const clampedPct = Math.min(100, Math.max(0, progressPct));

  return (
    <div className="flex flex-col gap-1.5">
      {/* Progress bar */}
      <progress
        className="block h-2 w-full appearance-none overflow-hidden rounded-full border-0 bg-[var(--surface-2)] [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-[var(--reward)] [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-[var(--surface-2)] [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-[var(--reward)] [&::-webkit-progress-value]:transition-all [&::-webkit-progress-value]:duration-500"
        value={clampedPct}
        max={100}
        aria-label="Play progress"
      />

      {/* Labels */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--t3)]">
          {t("playProgressRequired", {
            completed: formatPoints(completedPoints),
            required: formatPoints(requiredPoints),
          })}
        </span>
        <span
          className={
            isExpired ? "text-[var(--warning)]" : "text-[var(--t3)]"
          }
        >
          {isExpired ? t("expired") : t("expiresIn", { days: daysLeft })}
        </span>
      </div>
    </div>
  );
};
