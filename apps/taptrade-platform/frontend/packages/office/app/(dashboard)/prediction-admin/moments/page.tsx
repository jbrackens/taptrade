"use client";

/**
 * Featured moments — curates the player app's photo-led home rail ("This
 * week in the Philippines"). Each moment is an event: flag it featured and
 * give it a cover photo (a /images/ path or an https URL). The rail shows
 * on the home page once at least MIN_RAIL_MOMENTS featured events are open.
 *
 * Metadata only: PATCH /api/v1/admin/events/{id} never moves points or
 * changes lifecycle/settlement state.
 */

import { useEffect, useMemo, useState } from "react";
import { Button, Input } from "../../../components/shared";
import { adminFetch } from "../../../lib/admin-fetch";

interface AdminEvent {
  id: string;
  title: string;
  categoryId: string;
  status: string;
  featured: boolean;
  coverImageUrl?: string;
  closeAt: string;
}

interface EventsResponse {
  data: AdminEvent[];
  meta: { total: number; hasNext: boolean };
}

interface RowDraft {
  featured: boolean;
  cover: string;
}

// Mirrors the player app's ThisWeekRail threshold.
const MIN_RAIL_MOMENTS = 4;

// Licensed topic covers shipped with the player app
// (public/images/covers/, credited in CREDITS.md).
const TOPIC_COVERS: { label: string; path: string }[] = [
  { label: "Basketball", path: "/images/covers/basketball.jpg" },
  { label: "Esports", path: "/images/covers/esports.jpg" },
  { label: "Pageants", path: "/images/covers/pageants.jpg" },
  { label: "Showbiz & music", path: "/images/covers/showbiz.jpg" },
  { label: "Politics", path: "/images/covers/politics.jpg" },
  { label: "Economy", path: "/images/covers/economy.jpg" },
  { label: "Culture", path: "/images/covers/culture.jpg" },
];

const pageTitleClassName =
  "mb-1 text-[28px] font-bold text-[var(--t1,#1a1a1a)]";
const tableHeaderClassName =
  "border-b border-[var(--border-1,#e5dfd2)] bg-[var(--surface-2,#fcfaf5)] p-3 text-left text-xs font-semibold text-[var(--t2,#4a4a4a)]";
const tableCellClassName =
  "border-b border-[var(--border-1,#e5dfd2)] p-3 align-middle text-sm text-[var(--t1,#1a1a1a)]";

function bannerClassName(kind: "loading" | "error" | "empty" | "info") {
  return `rounded-xl border border-[var(--border-1,#e5dfd2)] bg-[var(--surface-1,#ffffff)] px-5 py-4 text-sm ${
    kind === "error"
      ? "text-[var(--no-text,#b4321f)]"
      : "text-[var(--t2,#4a4a4a)]"
  }`;
}

function formatClose(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}

// Client-side mirror of the gateway's normalizeCoverImageURL, so the
// curator sees the problem before saving. The gateway re-validates.
function coverProblem(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (v.startsWith("/")) {
    if (v.startsWith("//") || !v.startsWith("/images/") || v.includes("..")) {
      return "Paths must live under /images/";
    }
    return null;
  }
  try {
    const url = new URL(v);
    return url.protocol === "https:" ? null : "Use an https URL";
  } catch {
    return "Not a valid URL";
  }
}

export default function FeaturedMomentsPage() {
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey is the manual refresh signal
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const collected: AdminEvent[] = [];
        for (let page = 1; page <= 5; page += 1) {
          const res = await adminFetch(
            `/api/v1/events?status=open&pageSize=100&page=${page}`,
          );
          if (!res.ok) throw new Error(`events request failed (${res.status})`);
          const payload = (await res.json()) as EventsResponse;
          collected.push(...(payload.data ?? []));
          if (!payload.meta?.hasNext) break;
        }
        if (cancelled) return;
        setEvents(collected);
        const nextDrafts: Record<string, RowDraft> = {};
        for (const event of collected) {
          nextDrafts[event.id] = {
            featured: event.featured,
            cover: event.coverImageUrl ?? "",
          };
        }
        setDrafts(nextDrafts);
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
    return events
      .filter((event) => !featuredOnly || drafts[event.id]?.featured)
      .filter((event) => !q || event.title.toLowerCase().includes(q))
      .sort((a, b) => Number(b.featured) - Number(a.featured));
  }, [drafts, events, featuredOnly, query]);

  const featuredCount = events.filter((event) => event.featured).length;
  const featuredWithCover = events.filter(
    (event) => event.featured && event.coverImageUrl,
  ).length;

  async function save(event: AdminEvent) {
    const draft = drafts[event.id];
    if (!draft) return;
    const problem = coverProblem(draft.cover);
    if (problem) {
      setError(`${event.title}: ${problem}`);
      return;
    }
    setSavingId(event.id);
    setError(null);
    setNotice(null);
    try {
      const res = await adminFetch(`/api/v1/admin/events/${encodeURIComponent(event.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          featured: draft.featured,
          coverImageUrl: draft.cover.trim(),
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`save failed (${res.status}) ${text.slice(0, 160)}`);
      }
      const updated = (await res.json()) as AdminEvent;
      setEvents((current) =>
        current.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)),
      );
      setNotice(`Saved “${event.title}”.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-5 p-6">
      <header>
        <h1 className={pageTitleClassName}>Featured moments</h1>
        <p className="m-0 max-w-[760px] text-sm text-[var(--t2,#4a4a4a)]">
          Curate the photo-led “This week in the Philippines” rail on the player
          home page. Feature an open event and give it a cover photo. The rail
          appears once at least {MIN_RAIL_MOMENTS} featured events are open;
          until then the home page shows the market board. Use photos you have
          the rights to publish.
        </p>
      </header>

      <div className={bannerClassName("info")}>
        {featuredCount} featured · {featuredWithCover} with a cover ·{" "}
        {featuredCount >= MIN_RAIL_MOMENTS
          ? "the rail is live on the home page"
          : `${MIN_RAIL_MOMENTS - featuredCount} more needed before the rail shows`}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          placeholder="Search events"
          aria-label="Search events"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-[280px]"
        />
        <label className="flex items-center gap-2 text-sm text-[var(--t2,#4a4a4a)]">
          <input
            type="checkbox"
            checked={featuredOnly}
            onChange={(e) => setFeaturedOnly(e.target.checked)}
          />
          Featured only
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
        <div className={bannerClassName("loading")}>Loading events…</div>
      ) : visible.length === 0 ? (
        <div className={bannerClassName("empty")}>No open events match.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-1,#e5dfd2)] bg-[var(--surface-1,#ffffff)]">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={tableHeaderClassName}>Event</th>
                <th className={tableHeaderClassName}>Closes</th>
                <th className={tableHeaderClassName}>Featured</th>
                <th className={tableHeaderClassName}>Cover photo</th>
                <th className={tableHeaderClassName} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visible.map((event) => {
                const draft = drafts[event.id] ?? { featured: false, cover: "" };
                const problem = coverProblem(draft.cover);
                const dirty =
                  draft.featured !== event.featured ||
                  draft.cover.trim() !== (event.coverImageUrl ?? "");
                return (
                  <tr key={event.id}>
                    <td className={tableCellClassName}>
                      <div className="font-semibold">{event.title}</div>
                      <div className="text-xs text-[var(--t3,#8b8378)]">{event.id}</div>
                    </td>
                    <td className={tableCellClassName}>{formatClose(event.closeAt)}</td>
                    <td className={tableCellClassName}>
                      <input
                        type="checkbox"
                        aria-label={`Feature ${event.title}`}
                        checked={draft.featured}
                        onChange={(e) =>
                          setDrafts((current) => ({
                            ...current,
                            [event.id]: { ...draft, featured: e.target.checked },
                          }))
                        }
                      />
                    </td>
                    <td className={tableCellClassName}>
                      <div className="flex items-center gap-3">
                        <div className="h-12 w-20 shrink-0 overflow-hidden rounded-md bg-[var(--surface-2,#fcfaf5)]">
                          {draft.cover.trim() && !problem && (
                            // biome-ignore lint/performance/noImgElement: arbitrary curator URL preview
                            <img
                              src={draft.cover.trim()}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          )}
                        </div>
                        <div className="flex min-w-[260px] flex-col gap-1">
                          <Input
                            value={draft.cover}
                            placeholder="/images/covers/… or https://…"
                            aria-label={`Cover photo for ${event.title}`}
                            onChange={(e) =>
                              setDrafts((current) => ({
                                ...current,
                                [event.id]: { ...draft, cover: e.target.value },
                              }))
                            }
                          />
                          <select
                            aria-label={`Topic cover for ${event.title}`}
                            value=""
                            onChange={(e) => {
                              const path = e.target.value;
                              if (!path) return;
                              setDrafts((current) => ({
                                ...current,
                                [event.id]: { ...draft, cover: path },
                              }));
                            }}
                            className="h-8 rounded-md border border-[var(--border-1,#e5dfd2)] bg-[var(--surface-1,#ffffff)] px-2 text-xs text-[var(--t2,#4a4a4a)]"
                          >
                            <option value="">Use a topic cover…</option>
                            {TOPIC_COVERS.map((cover) => (
                              <option key={cover.path} value={cover.path}>
                                {cover.label}
                              </option>
                            ))}
                          </select>
                          {problem && (
                            <span className="text-xs text-[var(--no-text,#b4321f)]">
                              {problem}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className={tableCellClassName}>
                      <Button
                        size="sm"
                        disabled={!dirty || Boolean(problem) || savingId === event.id}
                        onClick={() => save(event)}
                      >
                        {savingId === event.id ? "Saving…" : "Save"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
