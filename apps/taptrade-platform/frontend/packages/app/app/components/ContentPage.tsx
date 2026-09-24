"use client";

/**
 * ContentPage — the editorial reading column for legal/info pages
 * (about, terms, privacy, responsible gaming). Kilig chrome (DESIGN.md
 * §6): a plain left-aligned column, ~720px measure, poster-type title,
 * comfortable 16px body. The underlying `.content-page*` classes in
 * globals.css still carry the ink text tokens, spacing and mobile gutter
 * for both this shell and any raw CMS HTML rendered inside it; the
 * inline styles below narrow the measure, drop the legacy boxed-card
 * chrome (no resting shadow, no card fill) and swap the title onto
 * poster type without touching that shared stylesheet.
 */

import type React from "react";
import { useEffect, useState } from "react";
import DOMPurify from "isomorphic-dompurify";
import { useTranslation } from "react-i18next";
import {
  getPage,
  type ContentPage as ContentPageType,
} from "../lib/api/content-client";

interface ContentPageProps {
  slug: string;
  fallbackContent?: string;
}

function ContentArticle({ children }: { children: React.ReactNode }) {
  return (
    <article className="content-page">
      {children}
    </article>
  );
}

function ContentBody({ html }: { html: string }) {
  return (
    <div
      className="content-page-body"
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
    />
  );
}

/**
 * Renders a CMS-driven content page by slug.
 * Falls back to provided static content if the CMS page is not found.
 */
export const ContentPageRenderer: React.FC<ContentPageProps> = ({
  slug,
  fallbackContent,
}) => {
  const { t } = useTranslation("content");
  const [page, setPage] = useState<ContentPageType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPage(slug)
      .then((data) => {
        if (!cancelled) {
          setPage(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (loading) {
    return (
      <ContentArticle>
        <div className="h-8 w-64 rounded-md animate-pulse mb-4 bg-[var(--surface-2)]" />
        <div className="h-4 w-full rounded-md animate-pulse mb-2 bg-[var(--surface-2)]" />
        <div className="h-4 w-3/4 rounded-md animate-pulse mb-2 bg-[var(--surface-2)]" />
        <div className="h-4 w-1/2 rounded-md animate-pulse bg-[var(--surface-2)]" />
      </ContentArticle>
    );
  }

  // CMS page loaded — render it
  if (page) {
    return (
      <ContentArticle>
        <h1 className="content-page-title">
          {page.title}
        </h1>

        {/* Render flat content if no blocks */}
        {(!page.blocks || page.blocks.length === 0) && page.content && (
          <ContentBody html={page.content} />
        )}

        {/* Render blocks */}
        {page.blocks && page.blocks.length > 0 && (
          <div className="flex flex-col gap-6">
            {page.blocks.map((block) => {
              switch (block.blockType) {
                case "text":
                  return (
                    <ContentBody
                      key={block.blockId}
                      html={
                        (block.content as Record<string, string>).body || ""
                      }
                    />
                  );
                case "html":
                  return (
                    <div
                      key={block.blockId}
                      className="content-page-body"
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(
                          (block.content as Record<string, string>).html || "",
                        ),
                      }}
                    />
                  );
                case "faq": {
                  const faqItems = (block.content as Record<string, unknown>)
                    .items as
                    | Array<{ question: string; answer: string }>
                    | undefined;
                  if (!faqItems) return null;
                  return (
                    <div key={block.blockId} className="flex flex-col gap-3">
                      {faqItems.map((item, idx) => (
                        <details
                          // biome-ignore lint/suspicious/noArrayIndexKey: static CMS FAQ list — never reordered or partially updated client-side
                          key={idx}
                          className="rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] p-4"
                        >
                          <summary className="cursor-pointer font-semibold text-[var(--t1)]">
                            {item.question}
                          </summary>
                          <p className="mt-2 text-sm leading-6 text-[var(--t2)]">
                            {item.answer}
                          </p>
                        </details>
                      ))}
                    </div>
                  );
                }
                default:
                  return null;
              }
            })}
          </div>
        )}
      </ContentArticle>
    );
  }

  // Fallback — use static content if CMS page not found
  if (error && fallbackContent) {
    return (
      <ContentArticle>
        <ContentBody html={fallbackContent} />
      </ContentArticle>
    );
  }

  // No CMS page and no fallback
  return (
    <ContentArticle>
      <p className="text-center text-[var(--t2)]">{t("contentUnavailable")}</p>
    </ContentArticle>
  );
};
