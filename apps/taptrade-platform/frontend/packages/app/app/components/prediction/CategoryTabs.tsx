"use client";

/**
 * CategoryTabs — the topic strip under the top bar on discovery pages
 * (the pattern Kalshi and Polymarket use). Text tabs on a hairline, the
 * current topic in ink with an ink underline; scrolls sideways on phones.
 */

import Link from "next/link";
import { TrendUpIcon as TrendUp } from "@phosphor-icons/react/dist/csr/TrendUp";
import { useTranslation } from "react-i18next";
import type { Category } from "@taptrade-ui/api-client/src/prediction-types";
import { categoryName } from "./market-content";

const TAB_CLASS =
  "relative inline-flex h-12 shrink-0 items-center gap-1.5 whitespace-nowrap px-1 text-[14px] font-medium no-underline transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:rounded-full";

function tabClass(active: boolean): string {
  return `${TAB_CLASS} ${
    active
      ? "text-[var(--t1)] after:bg-[var(--t1)]"
      : "text-[var(--t3)] after:bg-transparent hover:text-[var(--t1)]"
  }`;
}

export function CategoryTabs({
  categories,
  activeCategorySlug,
  basePath = "/predict",
}: {
  categories: Category[];
  activeCategorySlug?: string;
  basePath?: string;
}) {
  const { t } = useTranslation("prediction");
  const { t: contentT } = useTranslation("market-content");
  const allActive = !activeCategorySlug;

  return (
    <nav
      aria-label={t("WORKSPACE_EXPLORE_TOPICS_LABEL", "Explore topics")}
      className="sticky top-16 z-30 border-b border-[var(--border-1)] bg-[color-mix(in_srgb,var(--surface-1)_92%,transparent)] backdrop-blur-md"
    >
      <div className="mx-auto flex max-w-[1280px] gap-6 overflow-x-auto px-6 [scrollbar-width:none] max-[640px]:gap-5 max-[640px]:px-4 [&::-webkit-scrollbar]:hidden">
        <Link
          href={basePath}
          aria-current={allActive ? "page" : undefined}
          className={tabClass(allActive)}
        >
          <TrendUp size={16} weight="bold" aria-hidden="true" />
          {t("SORT_ACTIVITY", "Trending")}
        </Link>
        {categories.map((category) => {
          const slug = category.slug.toLowerCase();
          const active = activeCategorySlug === slug;
          return (
            <Link
              key={category.id}
              href={`${basePath}?category=${encodeURIComponent(slug)}`}
              aria-current={active ? "page" : undefined}
              className={tabClass(active)}
            >
              {categoryName(contentT, category)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
