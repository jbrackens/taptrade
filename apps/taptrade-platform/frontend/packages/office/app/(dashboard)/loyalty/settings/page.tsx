"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { adminFetch } from "../../../lib/admin-fetch";
import {
  ErrorBoundary,
  ErrorState,
  LoadingSpinner,
} from "../../../components/shared";

interface LoyaltyTier {
  tierCode: string;
  displayName: string;
  rank: number;
  minLifetimePoints: number;
  minRolling30dPoints?: number;
  benefits?: Record<string, string>;
  active: boolean;
}

interface LoyaltyRule {
  ruleId: string;
  name: string;
  sourceType: string;
  predictionSourceType?: string;
  active: boolean;
  multiplier: number;
  minQualifiedStakePoints: number;
  minQualifiedPoints?: number;
  eligibleBetTypes?: string[];
  eligiblePredictionTypes?: string[];
  maxPointsPerEvent?: number;
  effectiveFrom?: string;
  effectiveTo?: string;
}

type CssVars = CSSProperties & Record<`--${string}`, string | number>;

function toLaunchLoyaltySourceType(value: string): string {
  return value === "bet_settlement" ? "prediction_settlement" : value;
}

function toLegacyLoyaltySourceType(value: string): string {
  const trimmed = value.trim();
  return trimmed === "prediction_settlement" ? "bet_settlement" : trimmed;
}

function normalizeLoyaltyRule(rule: LoyaltyRule): LoyaltyRule {
  const sourceType =
    rule.predictionSourceType || toLaunchLoyaltySourceType(rule.sourceType);
  const minQualifiedPoints =
    rule.minQualifiedPoints ?? rule.minQualifiedStakePoints ?? 0;
  const eligiblePredictionTypes =
    rule.eligiblePredictionTypes ?? rule.eligibleBetTypes ?? [];

  return {
    ...rule,
    sourceType,
    predictionSourceType: sourceType,
    minQualifiedStakePoints: minQualifiedPoints,
    minQualifiedPoints,
    eligibleBetTypes: eligiblePredictionTypes,
    eligiblePredictionTypes,
  };
}

/** Convert an RFC3339 string to a datetime-local input value (YYYY-MM-DDTHH:mm). */
function rfc3339ToLocal(rfc: string | undefined): string {
  if (!rfc) return "";
  try {
    const d = new Date(rfc);
    if (isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

/** Convert a datetime-local value back to an RFC3339 string with UTC offset. */
function localToRfc3339(local: string): string {
  if (!local) return "";
  try {
    const d = new Date(local);
    if (isNaN(d.getTime())) return "";
    return d.toISOString();
  } catch {
    return "";
  }
}

function LoyaltySettingsPageContent() {
  const [tiers, setTiers] = useState<LoyaltyTier[]>([]);
  const [rules, setRules] = useState<LoyaltyRule[]>([]);
  const [selectedTierCode, setSelectedTierCode] = useState("");
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [tierDraft, setTierDraft] = useState<LoyaltyTier | null>(null);
  const [ruleDraft, setRuleDraft] = useState<LoyaltyRule | null>(null);
  const [referralBonusPoints, setReferralBonusPoints] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingTier, setIsSavingTier] = useState(false);
  const [isSavingRule, setIsSavingRule] = useState(false);
  const [isCreatingRule, setIsCreatingRule] = useState(false);
  const [ruleMode, setRuleMode] = useState<"edit" | "create">("edit");
  const [newRuleDraft, setNewRuleDraft] = useState<Omit<LoyaltyRule, "ruleId">>(
    {
      name: "",
      sourceType: "prediction_settlement",
      active: true,
      multiplier: 1.0,
      minQualifiedStakePoints: 0,
      maxPointsPerEvent: 0,
    },
  );
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Benefits editor state — kept separate and merged into tierDraft on save
  const [benefitRows, setBenefitRows] = useState<
    { key: string; value: string }[]
  >([]);

  const loadConfig = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await adminFetch("/api/v1/admin/loyalty/config");
      if (!response.ok) {
        throw new Error("Failed to load loyalty configuration");
      }
      const data = await response.json();
      const nextTiers = Array.isArray(data?.tiers) ? data.tiers : [];
      const nextRules = Array.isArray(data?.rules)
        ? data.rules.map(normalizeLoyaltyRule)
        : [];
      setTiers(nextTiers);
      setRules(nextRules);
      setReferralBonusPoints(Number(data?.referralBonusPoints || 0));
      const initialTier = nextTiers[0] || null;
      const initialRule = nextRules[0] || null;
      setSelectedTierCode(initialTier?.tierCode || "");
      setSelectedRuleId(initialRule?.ruleId || "");
      setTierDraft(initialTier);
      setRuleDraft(initialRule);
      syncBenefitRows(initialTier);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load loyalty configuration",
      );
    } finally {
      setIsLoading(false);
    }
  };

  /** Sync the benefit editor rows from a tier's benefits record. */
  const syncBenefitRows = (tier: LoyaltyTier | null) => {
    if (!tier?.benefits || Object.keys(tier.benefits).length === 0) {
      setBenefitRows([]);
      return;
    }
    setBenefitRows(
      Object.entries(tier.benefits).map(([key, value]) => ({ key, value })),
    );
  };

  useEffect(() => {
    void loadConfig();
  }, []);

  useEffect(() => {
    const next =
      tiers.find((tier) => tier.tierCode === selectedTierCode) || null;
    setTierDraft(next);
    syncBenefitRows(next);
  }, [tiers, selectedTierCode]);

  useEffect(() => {
    setRuleDraft(rules.find((rule) => rule.ruleId === selectedRuleId) || null);
  }, [rules, selectedRuleId]);

  const tierSummary = useMemo(
    () =>
      tiers
        .map(
          (tier) =>
            `${tier.displayName}: ${tier.minLifetimePoints.toLocaleString()}+`,
        )
        .join(" · "),
    [tiers],
  );

  /** Build a benefits Record from the editor rows (strips empty keys). */
  const buildBenefitsRecord = (): Record<string, string> => {
    const record: Record<string, string> = {};
    for (const row of benefitRows) {
      const k = row.key.trim();
      if (k) {
        record[k] = row.value;
      }
    }
    return record;
  };

  const saveTier = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!tierDraft) return;
    setIsSavingTier(true);
    setFeedback(null);
    setError(null);
    try {
      const benefitsPayload = buildBenefitsRecord();
      const payload = {
        ...tierDraft,
        benefits:
          Object.keys(benefitsPayload).length > 0 ? benefitsPayload : undefined,
      };
      const response = await adminFetch(
        `/api/v1/admin/loyalty/tiers/${encodeURIComponent(tierDraft.tierCode)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        throw new Error("Failed to save tier settings");
      }
      const data = await response.json();
      const nextTiers = Array.isArray(data?.tiers) ? data.tiers : [];
      setTiers(nextTiers);
      setFeedback("Tier thresholds updated.");
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to save tier settings",
      );
    } finally {
      setIsSavingTier(false);
    }
  };

  const saveRule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ruleDraft) return;
    setIsSavingRule(true);
    setFeedback(null);
    setError(null);
    try {
      const payload = {
        ...ruleDraft,
        predictionSourceType: ruleDraft.sourceType,
        sourceType: toLegacyLoyaltySourceType(ruleDraft.sourceType),
        minQualifiedPoints: ruleDraft.minQualifiedStakePoints,
        eligiblePredictionTypes: ruleDraft.eligibleBetTypes || [],
        effectiveFrom:
          localToRfc3339(rfc3339ToLocal(ruleDraft.effectiveFrom)) || undefined,
        effectiveTo:
          localToRfc3339(rfc3339ToLocal(ruleDraft.effectiveTo)) || undefined,
      };
      const response = await adminFetch(
        `/api/v1/admin/loyalty/rules/${encodeURIComponent(ruleDraft.ruleId)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        throw new Error("Failed to save accrual rule");
      }
      const data = await response.json();
      const nextRules = Array.isArray(data?.rules)
        ? data.rules.map(normalizeLoyaltyRule)
        : [];
      setRules(nextRules);
      setFeedback("Accrual rule updated.");
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to save accrual rule",
      );
    } finally {
      setIsSavingRule(false);
    }
  };

  const createRule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsCreatingRule(true);
    setFeedback(null);
    setError(null);
    try {
      const payload = {
        ...newRuleDraft,
        predictionSourceType: newRuleDraft.sourceType,
        sourceType: toLegacyLoyaltySourceType(newRuleDraft.sourceType),
        minQualifiedPoints: newRuleDraft.minQualifiedStakePoints,
        eligiblePredictionTypes: newRuleDraft.eligibleBetTypes || [],
        maxPointsPerEvent: newRuleDraft.maxPointsPerEvent || undefined,
      };
      const response = await adminFetch("/api/v1/admin/loyalty/rules", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error("Failed to create accrual rule");
      }
      const data = await response.json();
      const nextRules = Array.isArray(data?.rules)
        ? data.rules.map(normalizeLoyaltyRule)
        : [];
      setRules(nextRules);
      const created = nextRules[nextRules.length - 1];
      if (created) {
        setSelectedRuleId(created.ruleId);
      }
      setFeedback("Accrual rule created.");
      setRuleMode("edit");
      setNewRuleDraft({
        name: "",
        sourceType: "prediction_settlement",
        active: true,
        multiplier: 1.0,
        minQualifiedStakePoints: 0,
        maxPointsPerEvent: 0,
      });
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to create accrual rule",
      );
    } finally {
      setIsCreatingRule(false);
    }
  };

  // Benefit row helpers
  const addBenefitRow = () =>
    setBenefitRows((rows) => [...rows, { key: "", value: "" }]);
  const removeBenefitRow = (index: number) =>
    setBenefitRows((rows) => rows.filter((_, i) => i !== index));
  const updateBenefitRow = (
    index: number,
    field: "key" | "value",
    val: string,
  ) => {
    setBenefitRows((rows) =>
      rows.map((row, i) => (i === index ? { ...row, [field]: val } : row)),
    );
  };

  if (isLoading) {
    return (
      <div>
        <h1 className={pageTitleClassName}>Loyalty Settings</h1>
        <LoadingSpinner
          centered={true}
          text="Loading loyalty rules and tiers..."
        />
      </div>
    );
  }

  if (error && !tiers.length && !rules.length) {
    return (
      <ErrorState
        title="Failed to load loyalty settings"
        message={error}
        onRetry={() => void loadConfig()}
        showRetryButton={true}
      />
    );
  }

  const sortedTiers = [...tiers].sort((a, b) => a.rank - b.rank);

  return (
    <div>
      <div className={headerRowClassName}>
        <div>
          <h1 className={pageTitleClassName}>Loyalty Settings</h1>
          <p className={subtitleClassName}>
            Tune tier thresholds and prediction-settlement accrual rules without
            leaving the backoffice.
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Link href="/loyalty" className={`${buttonClassName()} no-underline`}>
            Back to Loyalty
          </Link>
          <button
            className={buttonClassName()}
            onClick={() => void loadConfig()}
          >
            Refresh
          </button>
        </div>
      </div>

      <div className={metricsGridClassName}>
        <MetricCard
          label="Tier Ladder"
          value={tierSummary || "No active tiers"}
        />
        <MetricCard label="Rules" value={rules.length.toLocaleString()} />
        <MetricCard
          label="Referral Bonus"
          value={`${referralBonusPoints.toLocaleString()} pts`}
        />
      </div>

      {/* Tier Ladder Visual */}
      {sortedTiers.length > 0 && (
        <div className={tierLadderContainerClassName}>
          <h3 className="m-0 mb-3 text-sm font-bold text-[var(--t1,#1a1a1a)]">
            Tier Ladder
          </h3>
          <div className={tierLadderRowClassName}>
            {sortedTiers.map((tier, idx) => (
              <div key={tier.tierCode} className="flex items-end gap-0">
                <div
                  className={tierStepClassName(tier.active)}
                  style={tierStepVars(idx, sortedTiers.length)}
                >
                  <div
                    className={
                      tier.active
                        ? "text-[13px] font-bold text-[#39ff14]"
                        : "text-[13px] font-bold text-[var(--t3,#8b8378)]"
                    }
                  >
                    {tier.displayName}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--t3,#8b8378)]">
                    {tier.minLifetimePoints.toLocaleString()} pts
                  </div>
                  <div
                    className={
                      tier.active
                        ? "mt-1 text-[10px] text-[var(--accent,#2be480)]"
                        : "mt-1 text-[10px] text-[#475569]"
                    }
                  >
                    {tier.active ? "Active" : "Inactive"}
                  </div>
                </div>
                {idx < sortedTiers.length - 1 && (
                  <div className={tierLadderConnectorClassName} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {feedback ? (
        <div className={successBannerClassName}>{feedback}</div>
      ) : null}
      {error ? <div className={errorBannerClassName}>{error}</div> : null}

      <div className={settingsGridClassName}>
        <div className={surfaceCardClassName}>
          <h2 className={sectionTitleClassName}>Tier Management</h2>
          <div className={pillRowClassName}>
            {tiers.map((tier) => (
              <button
                key={tier.tierCode}
                type="button"
                className={pillClassName(selectedTierCode === tier.tierCode)}
                onClick={() => setSelectedTierCode(tier.tierCode)}
              >
                {tier.displayName}
              </button>
            ))}
          </div>

          {tierDraft ? (
            <form className={formClassName} onSubmit={saveTier}>
              <div className={formColumnsClassName}>
                <label className={labelClassName}>
                  Display Name
                  <input
                    className={inputClassName}
                    value={tierDraft.displayName}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setTierDraft((current) =>
                        current
                          ? { ...current, displayName: event.target.value }
                          : current,
                      )
                    }
                  />
                </label>
                <label className={labelClassName}>
                  Rank
                  <input
                    className={inputClassName}
                    type="number"
                    value={tierDraft.rank}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setTierDraft((current) =>
                        current
                          ? { ...current, rank: Number(event.target.value) }
                          : current,
                      )
                    }
                  />
                </label>
              </div>
              <div className={formColumnsClassName}>
                <label className={labelClassName}>
                  Min Lifetime Points
                  <input
                    className={inputClassName}
                    type="number"
                    value={tierDraft.minLifetimePoints}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setTierDraft((current) =>
                        current
                          ? {
                              ...current,
                              minLifetimePoints: Number(event.target.value),
                            }
                          : current,
                      )
                    }
                  />
                </label>
                <label className={labelClassName}>
                  Min Rolling 30D Points
                  <input
                    className={inputClassName}
                    type="number"
                    value={tierDraft.minRolling30dPoints || 0}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setTierDraft((current) =>
                        current
                          ? {
                              ...current,
                              minRolling30dPoints: Number(event.target.value),
                            }
                          : current,
                      )
                    }
                  />
                </label>
              </div>
              <label className={checkboxLabelClassName}>
                <input
                  type="checkbox"
                  checked={tierDraft.active}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setTierDraft((current) =>
                      current
                        ? { ...current, active: event.target.checked }
                        : current,
                    )
                  }
                />
                Tier is active
              </label>

              {/* Benefits Editor */}
              <div className={benefitsSectionClassName}>
                <div className="mb-2.5 flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-[#cbd5e1]">
                    Tier Benefits
                  </span>
                  <button
                    type="button"
                    className={smallButtonClassName}
                    onClick={addBenefitRow}
                  >
                    + Add Benefit
                  </button>
                </div>
                {benefitRows.length === 0 ? (
                  <div className={helperTextClassName}>
                    No benefits configured. Click &quot;Add Benefit&quot; to
                    define key-value pairs.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {benefitRows.map((row, idx) => (
                      <div key={idx} className={benefitRowClassName}>
                        <input
                          className={`${inputClassName} flex-[1_1_40%]`}
                          value={row.key}
                          onChange={(event: ChangeEvent<HTMLInputElement>) =>
                            updateBenefitRow(idx, "key", event.target.value)
                          }
                          placeholder="e.g. point_bonus_rate"
                        />
                        <input
                          className={`${inputClassName} flex-[1_1_40%]`}
                          value={row.value}
                          onChange={(event: ChangeEvent<HTMLInputElement>) =>
                            updateBenefitRow(idx, "value", event.target.value)
                          }
                          placeholder="e.g. 5%"
                        />
                        <button
                          type="button"
                          className={removeBenefitBtnClassName}
                          onClick={() => removeBenefitRow(idx)}
                          title="Remove benefit"
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="submit"
                className={buttonClassName(isSavingTier)}
                disabled={isSavingTier}
              >
                {isSavingTier ? "Saving Tier..." : "Save Tier"}
              </button>
            </form>
          ) : (
            <div className={helperTextClassName}>No tier selected.</div>
          )}
        </div>

        <div className={surfaceCardClassName}>
          <h2 className={sectionTitleClassName}>Accrual Rules</h2>

          {/* Mode toggle: Edit Existing / Create New */}
          <div className={pillRowTightClassName}>
            <button
              type="button"
              className={pillClassName(ruleMode === "edit")}
              onClick={() => setRuleMode("edit")}
            >
              Edit Existing
            </button>
            <button
              type="button"
              className={pillClassName(ruleMode === "create")}
              onClick={() => setRuleMode("create")}
            >
              + Create Rule
            </button>
          </div>

          {ruleMode === "edit" ? (
            <>
              <div className={pillRowClassName}>
                {rules.map((rule) => (
                  <button
                    key={rule.ruleId}
                    type="button"
                    className={pillClassName(selectedRuleId === rule.ruleId)}
                    onClick={() => setSelectedRuleId(rule.ruleId)}
                  >
                    <span className={statusDotClassName(rule.active)} />
                    {rule.name}
                  </button>
                ))}
              </div>

              {ruleDraft ? (
                <form className={formClassName} onSubmit={saveRule}>
                  <label className={labelClassName}>
                    Rule Name
                    <input
                      className={inputClassName}
                      value={ruleDraft.name}
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        setRuleDraft((current) =>
                          current
                            ? { ...current, name: event.target.value }
                            : current,
                        )
                      }
                    />
                  </label>
                  <div className={formColumnsClassName}>
                    <label className={labelClassName}>
                      Source Type
                      <input
                        className={inputClassName}
                        value={toLaunchLoyaltySourceType(ruleDraft.sourceType)}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          setRuleDraft((current) =>
                            current
                              ? { ...current, sourceType: event.target.value }
                              : current,
                          )
                        }
                      />
                    </label>
                    <label className={labelClassName}>
                      Multiplier
                      <input
                        className={inputClassName}
                        type="number"
                        step="0.1"
                        value={ruleDraft.multiplier}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          setRuleDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  multiplier: Number(event.target.value),
                                }
                              : current,
                          )
                        }
                      />
                    </label>
                  </div>
                  <div className={formColumnsClassName}>
                    <label className={labelClassName}>
                      Min Qualified Points (point units)
                      <input
                        className={inputClassName}
                        type="number"
                        value={ruleDraft.minQualifiedStakePoints}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          setRuleDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  minQualifiedStakePoints: Number(
                                    event.target.value,
                                  ),
                                }
                              : current,
                          )
                        }
                      />
                    </label>
                    <label className={labelClassName}>
                      Max Points / Event
                      <input
                        className={inputClassName}
                        type="number"
                        value={ruleDraft.maxPointsPerEvent || 0}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          setRuleDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  maxPointsPerEvent: Number(event.target.value),
                                }
                              : current,
                          )
                        }
                      />
                    </label>
                  </div>

                  {/* Effective Date Range */}
                  <div className={formColumnsClassName}>
                    <label className={labelClassName}>
                      Effective From
                      <input
                        className={inputClassName}
                        type="datetime-local"
                        value={rfc3339ToLocal(ruleDraft.effectiveFrom)}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          setRuleDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  effectiveFrom:
                                    localToRfc3339(event.target.value) ||
                                    undefined,
                                }
                              : current,
                          )
                        }
                      />
                    </label>
                    <label className={labelClassName}>
                      Effective To
                      <input
                        className={inputClassName}
                        type="datetime-local"
                        value={rfc3339ToLocal(ruleDraft.effectiveTo)}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          setRuleDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  effectiveTo:
                                    localToRfc3339(event.target.value) ||
                                    undefined,
                                }
                              : current,
                          )
                        }
                      />
                    </label>
                  </div>

                  <label className={checkboxLabelClassName}>
                    <input
                      type="checkbox"
                      checked={ruleDraft.active}
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        setRuleDraft((current) =>
                          current
                            ? { ...current, active: event.target.checked }
                            : current,
                        )
                      }
                    />
                    Rule is active
                  </label>
                  <div className={helperTextClassName}>
                    This MVP applies the first active prediction-settlement
                    rule. Use one active default rule at a time until multi-rule
                    evaluation is expanded.
                  </div>
                  <button
                    type="submit"
                    className={buttonClassName(isSavingRule)}
                    disabled={isSavingRule}
                  >
                    {isSavingRule ? "Saving Rule..." : "Save Rule"}
                  </button>
                </form>
              ) : (
                <div className={helperTextClassName}>No rule selected.</div>
              )}
            </>
          ) : (
            <form className={formClassName} onSubmit={createRule}>
              <label className={labelClassName}>
                Rule Name
                <input
                  className={inputClassName}
                  value={newRuleDraft.name}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setNewRuleDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="e.g. Double Points Weekend"
                  required
                />
              </label>
              <div className={formColumnsClassName}>
                <label className={labelClassName}>
                  Source Type
                  <input
                    className={inputClassName}
                    value={toLaunchLoyaltySourceType(newRuleDraft.sourceType)}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setNewRuleDraft((current) => ({
                        ...current,
                        sourceType: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className={labelClassName}>
                  Multiplier
                  <input
                    className={inputClassName}
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={newRuleDraft.multiplier}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setNewRuleDraft((current) => ({
                        ...current,
                        multiplier: Number(event.target.value),
                      }))
                    }
                  />
                </label>
              </div>
              <div className={formColumnsClassName}>
                <label className={labelClassName}>
                  Min Qualified Points (point units)
                  <input
                    className={inputClassName}
                    type="number"
                    min="0"
                    value={newRuleDraft.minQualifiedStakePoints}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setNewRuleDraft((current) => ({
                        ...current,
                        minQualifiedStakePoints: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label className={labelClassName}>
                  Max Points / Event (0 = unlimited)
                  <input
                    className={inputClassName}
                    type="number"
                    min="0"
                    value={newRuleDraft.maxPointsPerEvent || 0}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setNewRuleDraft((current) => ({
                        ...current,
                        maxPointsPerEvent: Number(event.target.value),
                      }))
                    }
                  />
                </label>
              </div>
              <label className={checkboxLabelClassName}>
                <input
                  type="checkbox"
                  checked={newRuleDraft.active}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setNewRuleDraft((current) => ({
                      ...current,
                      active: event.target.checked,
                    }))
                  }
                />
                Rule is active
              </label>
              <div className={helperTextClassName}>
                Creates a new accrual rule. You can set effective dates after
                creation by editing the rule.
              </div>
              <button
                type="submit"
                className={buttonClassName(isCreatingRule)}
                disabled={isCreatingRule}
              >
                {isCreatingRule ? "Creating Rule..." : "Create Rule"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={surfaceCardClassName}>
      <div className={metricLabelClassName}>{label}</div>
      <div className={metricValueClassName}>{value}</div>
    </div>
  );
}

/* ── Style constants ── */

const pageTitleClassName =
  "mb-2 text-[28px] font-bold text-[var(--t1,#1a1a1a)]";
const subtitleClassName = "m-0 text-sm text-[var(--t2,#4a4a4a)]";
const headerRowClassName = "mb-5 flex items-end justify-between gap-4";
const metricsGridClassName =
  "mb-5 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4";
const settingsGridClassName =
  "grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-5";
const surfaceCardClassName =
  "rounded-xl border border-[var(--border-1,#e5dfd2)] bg-[var(--surface-1,var(--t1,#1a1a1a))] p-5";
const metricLabelClassName =
  "mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--t3,#8b8378)]";
const metricValueClassName = "text-2xl font-extrabold text-[var(--t1,#1a1a1a)]";
const sectionTitleClassName =
  "m-0 mb-4 text-lg font-bold text-[var(--t1,#1a1a1a)]";
const formClassName = "flex flex-col gap-[14px]";
const formColumnsClassName =
  "grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3";
const labelClassName =
  "flex flex-col gap-1.5 text-[13px] font-semibold text-[#cbd5e1]";
const inputClassName =
  "w-full rounded-lg border border-[var(--border-1,#e5dfd2)] bg-[var(--surface-1,#ffffff)] px-3 py-2.5 text-sm text-[var(--t1,#1a1a1a)]";
const checkboxLabelClassName =
  "flex items-center gap-2.5 text-[13px] font-semibold text-[#cbd5e1]";
const helperTextClassName = "text-xs leading-[1.5] text-[var(--t3,#8b8378)]";
const pillRowClassName = "mb-4 flex flex-wrap gap-2";
const pillRowTightClassName = "mb-3 flex flex-wrap gap-2";

function pillClassName(active: boolean): string {
  return [
    "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-bold",
    active
      ? "border-[var(--focus-ring,#0e7a53)] bg-[var(--focus-ring,#0e7a53)] text-[#0b1020]"
      : "border-[#1e3a5f] bg-[#0f172a] text-[#cbd5e1]",
  ].join(" ");
}

function statusDotClassName(active: boolean): string {
  return `inline-block h-2 w-2 shrink-0 rounded-full ${
    active ? "bg-[#39ff14]" : "bg-[#475569]"
  }`;
}

function buttonClassName(disabled = false): string {
  return [
    "rounded-lg border-0 px-4 py-2.5 text-sm font-bold text-[var(--bg-deep,#f7f3ed)]",
    disabled
      ? "cursor-not-allowed bg-[#3b4c7a]"
      : "cursor-pointer bg-[var(--focus-ring,#0e7a53)]",
  ].join(" ");
}

const smallButtonClassName =
  "cursor-pointer rounded-md border border-[var(--focus-ring,#0e7a53)] bg-transparent px-2.5 py-1 text-xs font-semibold text-[var(--focus-ring,#0e7a53)]";
const successBannerClassName =
  "mb-4 rounded-[10px] border border-[rgba(34,197,94,0.24)] bg-[rgba(34,197,94,0.14)] px-[14px] py-3 text-[#dcfce7]";
const errorBannerClassName =
  "mb-4 rounded-[10px] border border-[rgba(248,113,113,0.24)] bg-[rgba(248,113,113,0.14)] px-[14px] py-3 text-[#fee2e2]";

/* Benefits editor styles */

const benefitsSectionClassName =
  "rounded-lg border border-[#1e3a5f] bg-[rgba(15,23,42,0.5)] p-[14px]";
const benefitRowClassName = "flex items-center gap-2";
const removeBenefitBtnClassName =
  "flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-[#7f1d1d] bg-[rgba(127,29,29,0.3)] text-base font-bold text-[var(--no-text,#a8472d)]";

/* Tier Ladder Visual styles */

const tierLadderContainerClassName =
  "mb-5 rounded-xl border border-[var(--border-1,#e5dfd2)] bg-[var(--surface-1,var(--t1,#1a1a1a))] p-5";
const tierLadderRowClassName = "flex items-end gap-0 overflow-x-auto";

function tierStepHeight(idx: number, total: number): number {
  const minH = 48;
  const maxH = 110;
  return total > 1 ? minH + ((maxH - minH) * idx) / (total - 1) : maxH;
}

function tierStepVars(idx: number, total: number): CssVars {
  return { "--tier-step-height": `${tierStepHeight(idx, total)}px` };
}

function tierStepClassName(active: boolean): string {
  return [
    "flex h-[var(--tier-step-height)] min-w-[100px] flex-col items-center justify-center rounded-lg px-3 py-2 text-center",
    active
      ? "border border-[var(--focus-ring,#0e7a53)] bg-[rgba(74,126,255,0.12)]"
      : "border border-[#1e3a5f] bg-[rgba(15,23,42,0.6)]",
  ].join(" ");
}

const tierLadderConnectorClassName =
  "h-0.5 w-6 shrink-0 self-center bg-[#1e3a5f]";

export default function LoyaltySettingsPage() {
  return (
    <ErrorBoundary>
      <LoyaltySettingsPageContent />
    </ErrorBoundary>
  );
}
