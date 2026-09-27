"use client";

/**
 * Market images — review what the cover resolver chose.
 *
 * Imports whose source ships no picture get one from an open repository
 * (a Wikimedia Commons photo of the person named, an openly licensed topic
 * photo) or a generated matchup tile. A namesake's photo is the failure
 * that matters, so every auto-chosen cover lands here with one-click
 * Replace or Remove. A hand-set image is never overwritten by the sync.
 *
 * Metadata only: PATCH /api/v1/admin/market-images/{id} never moves points
 * or changes market state.
 */

import { useEffect, useMemo, useState } from "react";
import { Button, Input } from "../../../components/shared";
import { adminFetch } from "../../../lib/admin-fetch";

interface ResolvedCover {
  marketId: string;
  ticker: string;
  title: string;
  imagePath: string;
  credit?: string;
  origin: "entity" | "topic" | "tile" | "manual";
  updatedAt: string;
}

const ORIGIN_LABEL: Record<ResolvedCover["origin"], string> = {
  entity: "Photo of the person or thing named",
  topic: "Topic photo",
  tile: "Matchup tile",
  manual: "Set by hand",
};

const pageTitleClassName =
  "m-0 mb-1 text-[22px] font-semibold tracking-[-0.02em] text-[var(--t1,#111114)]";
const cardClassName =
  "flex gap-3 rounded-xl border border-[var(--border-1,#e5dfd2)] bg-[var(--surface-1,#ffffff)] p-3";

function bannerClassName(kind: "loading" | "error" | "empty" | "info") {
  const base = "rounded-lg px-3 py-2 text-sm";
  if (kind === "error") return `${base} bg-[#fdecec] text-[#8a1f1f]`;
  return `${base} bg-[var(--surface-2,#f5f5f7)] text-[var(--t2,#4a4a4a)]`;
}

function imageProblem(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (v.startsWith("/")) {
    return v.startsWith("/images/") && !v.includes("..") ? null : "Paths must live under /images/";
  }
  return /^https:\/\/[^\s]+$/.test(v) ? null : "Use an https URL or a /images/ path";
}

export default function MarketImagesPage() {
  const [covers, setCovers] = useState<ResolvedCover[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [originFilter, setOriginFilter] = useState<"all" | ResolvedCover["origin"]>("all");
  const [reloadKey, setReloadKey] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey is the manual refresh signal
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await adminFetch("/api/v1/admin/markets/images?limit=300");
        if (!res.ok) throw new Error(`images request failed (${res.status})`);
        const payload = (await res.json()) as { data?: ResolvedCover[] };
        if (cancelled) return;
        setCovers(payload.data ?? []);
        setDrafts({});
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return covers.filter(
      (c) =>
        (originFilter === "all" || c.origin === originFilter) &&
        (!q || c.title.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q)),
    );
  }, [covers, originFilter, query]);

  async function apply(cover: ResolvedCover, imagePath: string) {
    setSavingId(cover.marketId);
    setNotice(null);
    setError(null);
    try {
      const res = await adminFetch(`/api/v1/admin/market-images/${encodeURIComponent(cover.marketId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagePath }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `save failed (${res.status})`);
      }
      setCovers((prev) =>
        prev.map((c) =>
          c.marketId === cover.marketId
            ? { ...c, imagePath, credit: undefined, origin: "manual", updatedAt: new Date().toISOString() }
            : c,
        ),
      );
      setNotice(imagePath ? `Image replaced for “${cover.title}”.` : `Image removed from “${cover.title}”.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-5 p-6">
      <header>
        <h1 className={pageTitleClassName}>Market images</h1>
        <p className="m-0 max-w-[760px] text-sm text-[var(--t2,#4a4a4a)]">
          Imports whose source ships no picture get one automatically: a photo of the
          person or thing the market names (Wikimedia Commons, free licences only), an
          openly licensed topic photo, or a matchup tile. Check them here; replace with a
          path under /images/ or an https URL, or remove. Hand-set images are never
          overwritten.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          placeholder="Search markets"
          aria-label="Search markets"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-[280px]"
        />
        <label className="flex items-center gap-2 text-sm text-[var(--t2,#4a4a4a)]">
          Source
          <select
            value={originFilter}
            onChange={(e) => setOriginFilter(e.target.value as typeof originFilter)}
            className="rounded-md border border-[var(--border-1,#e5dfd2)] bg-[var(--surface-1,#ffffff)] px-2 py-1 text-sm"
          >
            <option value="all">All</option>
            <option value="entity">Photo of the person or thing named</option>
            <option value="topic">Topic photo</option>
            <option value="tile">Matchup tile</option>
            <option value="manual">Set by hand</option>
          </select>
        </label>
        <Button variant="secondary" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
          Refresh
        </Button>
      </div>

      {notice && <div className={bannerClassName("info")}>{notice}</div>}
      {error && (
        <div role="alert" className={bannerClassName("error")}>
          {error}
        </div>
      )}

      {loading ? (
        <div className={bannerClassName("loading")}>Loading images…</div>
      ) : visible.length === 0 ? (
        <div className={bannerClassName("empty")}>No resolved images match.</div>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((cover) => {
            const draft = drafts[cover.marketId] ?? "";
            const problem = imageProblem(draft);
            const busy = savingId === cover.marketId;
            return (
              <li key={cover.marketId} className={cardClassName}>
                {cover.imagePath ? (
                  // biome-ignore lint/performance/noImgElement: review thumbnails come from the player app's public folder or an https URL
                  <img
                    src={cover.imagePath}
                    alt=""
                    width={72}
                    height={72}
                    className="h-[72px] w-[72px] shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <div className="h-[72px] w-[72px] shrink-0 rounded-lg bg-[var(--surface-2,#f5f5f7)]" />
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="text-sm font-semibold leading-snug text-[var(--t1,#111114)]">{cover.title}</div>
                  <div className="text-xs text-[var(--t2,#4a4a4a)]">
                    {ORIGIN_LABEL[cover.origin]} · {cover.ticker}
                    {cover.credit ? ` · ${cover.credit}` : ""}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      type="text"
                      placeholder="/images/… or https://…"
                      aria-label={`Replacement image for ${cover.title}`}
                      value={draft}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [cover.marketId]: e.target.value }))
                      }
                      className="min-w-[200px] flex-1"
                    />
                    <Button
                      size="sm"
                      disabled={busy || !draft.trim() || problem !== null}
                      onClick={() => apply(cover, draft.trim())}
                    >
                      Replace
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy || !cover.imagePath}
                      onClick={() => apply(cover, "")}
                    >
                      Remove
                    </Button>
                  </div>
                  {problem && <div className="text-xs text-[#8a1f1f]">{problem}</div>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
