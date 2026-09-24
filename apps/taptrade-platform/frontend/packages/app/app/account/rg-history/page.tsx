"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../components/ToastProvider";
import { Button } from "../../components/ui";
import { getLimitsHistory } from "../../lib/api/compliance-client";
import type { LimitHistoryItem } from "../../lib/api/compliance-client";
import { FEATURE_RG } from "../../lib/features";

interface GroupedHistory {
  limits: LimitHistoryItem[];
  coolOffs: LimitHistoryItem[];
  exclusions: LimitHistoryItem[];
}

const pageClass = "mx-auto max-w-[1200px] px-4 py-6";
const headerClass =
  "mb-8 flex items-start justify-between max-[640px]:flex-col max-[640px]:gap-4";
const backClass =
  "inline-flex min-h-11 items-center rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-1)] px-4 py-2.5 text-[13px] font-semibold text-[var(--t1)] no-underline transition-colors duration-150 hover:border-[var(--border-2)]";
const sectionClass =
  "mb-6 rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] p-6";
const tableHeadCellClass =
  "px-4 py-3 text-left text-[12px] font-semibold text-[var(--t3)]";
const tableCellClass =
  "border-b border-[var(--border-1)] px-4 py-3 text-[13px] text-[var(--t1)]";

export default function RGHistoryPage() {
  if (!FEATURE_RG) notFound();
  return <RGHistoryPageContent />;
}

function RGHistoryPageContent() {
  const { user } = useAuth();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [grouped, setGrouped] = useState<GroupedHistory>({
    limits: [],
    coolOffs: [],
    exclusions: [],
  });

  useEffect(() => {
    const load = async () => {
      if (!user?.id) return;
      setLoading(true);
      try {
        const history = await getLimitsHistory(user.id);
        const grouped: GroupedHistory = {
          limits: history.history.filter(
            (h) =>
              h.limitType.includes("point_use") ||
              h.limitType.includes("prediction") ||
              h.limitType.includes("session"),
          ),
          coolOffs: history.history.filter((h) => h.limitType === "cool_off"),
          exclusions: history.history.filter(
            (h) => h.limitType === "self_exclusion",
          ),
        };
        setGrouped(grouped);
      } catch {
        toast.error("Failed to load history");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user?.id, toast]);

  const HistoryTable = ({
    title,
    items,
  }: {
    title: string;
    items: LimitHistoryItem[];
  }) => (
    <div className={sectionClass}>
      <h2 className="mb-4 text-base font-bold text-[var(--t1)]">{title}</h2>
      {items.length === 0 ? (
        <div className="p-8 text-center text-sm text-[var(--t3)]">
          No {title.toLowerCase()} found
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="border-b border-[var(--border-1)] bg-[var(--surface-2)]">
              <tr>
                <th className={tableHeadCellClass}>Limit type</th>
                <th className={tableHeadCellClass}>Old value</th>
                <th className={tableHeadCellClass}>New value</th>
                <th className={tableHeadCellClass}>Effective date</th>
                <th className={tableHeadCellClass}>Created date</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: read-only history rows rendered once per fetch — never reordered in place
                <tr className="hover:bg-[var(--surface-2)]" key={idx}>
                  <td className={tableCellClass}>
                    <span className="inline-block rounded-[var(--r-rh-sm)] bg-[var(--accent-soft)] px-2 py-1 text-xs font-semibold text-[var(--accent-text)]">
                      {item.limitType === "point_use_limit"
                        ? "Point-Use Limit"
                        : item.limitType === "prediction_limit"
                          ? "Prediction Limit"
                          : item.limitType === "session_limit"
                            ? "Session Limit"
                            : item.limitType === "cool_off"
                              ? "Cool-off"
                              : item.limitType === "self_exclusion"
                                ? "Self-Exclusion"
                                : item.limitType}
                    </span>
                  </td>
                  <td className={`${tableCellClass} font-mono tabular-nums`}>
                    {item.oldValue !== null && item.oldValue !== undefined
                      ? typeof item.oldValue === "boolean"
                        ? item.oldValue
                          ? "Enabled"
                          : "Disabled"
                        : `${item.oldValue} pts`
                      : "—"}
                  </td>
                  <td className={`${tableCellClass} font-mono tabular-nums`}>
                    {item.newValue !== null && item.newValue !== undefined
                      ? typeof item.newValue === "boolean"
                        ? item.newValue
                          ? "Enabled"
                          : "Disabled"
                        : `${item.newValue} pts`
                      : "—"}
                  </td>
                  <td className={`${tableCellClass} font-mono text-[12.5px] text-[var(--t2)]`}>
                    {new Date(item.effectiveDate).toLocaleDateString()}
                  </td>
                  <td className={`${tableCellClass} font-mono text-[12.5px] text-[var(--t2)]`}>
                    {new Date(item.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div className={pageClass}>
      <div className={headerClass}>
        <div>
          <h1 className="type-poster m-0 mb-1.5 text-[28px] text-[var(--t1)] max-[640px]:text-[24px]">
            Responsible play history
          </h1>
          <p className="text-sm text-[var(--t3)]">
            Track all your responsible-play limits and actions
          </p>
        </div>
        <Link href="/account" className={backClass}>
          ← Back
        </Link>
      </div>

      {loading ? (
        <div className="p-10 text-center text-sm text-[var(--t3)]">
          Loading history…
        </div>
      ) : (
        <>
          <HistoryTable title="Limits Changes" items={grouped.limits} />
          <HistoryTable title="Cool-offs" items={grouped.coolOffs} />
          <HistoryTable title="Self-Exclusions" items={grouped.exclusions} />

          {grouped.limits.length === 0 &&
            grouped.coolOffs.length === 0 &&
            grouped.exclusions.length === 0 && (
              <div className="flex flex-col items-center justify-center rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] px-6 py-[60px] text-center">
                <svg
                  width="36"
                  height="36"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                  className="mb-4 text-[var(--t3)]"
                >
                  <rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M7 9h10M7 12.5h10M7 16h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <div className="mb-2 text-lg font-bold text-[var(--t1)]">
                  No history yet
                </div>
                <div className="mb-5 max-w-[400px] text-[13px] leading-normal text-[var(--t3)]">
                  You haven't set any responsible-play limits yet. Visit the
                  responsible play page to get started.
                </div>
                <Button variant="primary" render={<Link href="/responsible-gaming" />}>
                  Go to responsible play
                </Button>
              </div>
            )}
        </>
      )}
    </div>
  );
}
