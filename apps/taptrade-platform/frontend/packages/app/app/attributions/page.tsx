"use client";

/**
 * Photo credits — every market cover that came from an openly licensed
 * source, with the attribution its licence asks for. Linked from the
 * footer and from the credit mark beside a market's image.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface Attribution {
  ticker: string;
  title: string;
  imagePath: string;
  credit: string;
  license?: string;
  sourceUrl?: string;
}

export default function AttributionsPage() {
  const { t } = useTranslation("prediction");
  const [items, setItems] = useState<Attribution[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/attributions?limit=500", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((payload: { data?: Attribution[] }) => {
        if (!cancelled) setItems(payload.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto max-w-[880px] px-4 py-10">
      <h1 className="m-0 text-[28px] font-semibold tracking-[-0.03em] text-[var(--t1)]">
        {t("ATTRIBUTIONS_TITLE", "Photo credits")}
      </h1>
      <p className="mt-2 max-w-[640px] text-[15px] text-[var(--t2)]">
        {t(
          "ATTRIBUTIONS_INTRO",
          "Some market images come from openly licensed sources such as Wikimedia Commons and Openverse. Each is credited here as its licence asks.",
        )}
      </p>

      {failed && (
        <p className="mt-8 text-[14px] text-[var(--t3)]">
          {t("ATTRIBUTIONS_UNAVAILABLE", "Credits are unavailable right now.")}
        </p>
      )}
      {items && items.length === 0 && (
        <p className="mt-8 text-[14px] text-[var(--t3)]">
          {t("ATTRIBUTIONS_EMPTY", "No credited images yet.")}
        </p>
      )}
      {items && items.length > 0 && (
        <ul className="m-0 mt-8 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
          {items.map((item) => (
            <li
              key={item.ticker}
              className="flex gap-3 rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] p-3"
            >
              {/* biome-ignore lint/performance/noImgElement: covers are served from our own public folder */}
              <img src={item.imagePath} alt="" width={56} height={56} className="h-14 w-14 shrink-0 rounded-[8px] object-cover" />
              <div className="min-w-0">
                <Link href={`/market/${item.ticker}`} className="line-clamp-2 text-[14px] font-semibold text-[var(--t1)] no-underline hover:underline">
                  {item.title}
                </Link>
                <p className="m-0 mt-1 text-[12.5px] text-[var(--t2)]">
                  {item.sourceUrl ? (
                    <a href={item.sourceUrl} rel="noopener noreferrer" target="_blank" className="text-inherit underline">
                      {item.credit}
                    </a>
                  ) : (
                    item.credit
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
