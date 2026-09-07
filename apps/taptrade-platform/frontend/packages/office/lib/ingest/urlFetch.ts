// SSRF-guarded server-side article fetch + readable-text extraction
// (plan §7.1, locked decision 2 — in-process boundary for dev/Phase B).
//
// Layers: (1) assertSafeRequestURL pre-check (scheme + literal-IP);
// (2) request-filtering-agent validates the RESOLVED IP at socket-connect time
// for the initial request AND every redirect (defeats DNS rebinding);
// (3) a beforeRedirect hook re-validates each hop's URL. got is used (not native
// fetch/undici) precisely because request-filtering-agent is an http(s).Agent.
//
// RELEASE GATE (Codex / plan §16): this is NOT production egress isolation.
// In production, URL fetch must be blocked/degraded until an isolated egress
// proxy exists, and the redirect/DNS-pinning paths need an integration test
// against a live server. got + the agent are dynamic-imported so the pure
// pre-check and extractArticle stay unit-testable offline.

import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { assertSafeRequestURL, SSRFError } from "./ssrfGuard";

// Production egress gate (plan §16 / §17b). Server-side URL fetch is OFF by
// default in production: the in-process SSRF guard is a best-effort boundary,
// not network egress isolation. An operator enables it (AI_URL_FETCH_ENABLED)
// only once the deploy egresses through an isolated/allowlisted proxy. The kill
// switch (AI_URL_FETCH_DISABLED) blocks it everywhere.
export function assertUrlFetchAllowed(): void {
  if (process.env.AI_URL_FETCH_DISABLED === "true") {
    throw new SSRFError("server-side URL fetch is disabled");
  }
  if (
    process.env.NODE_ENV === "production" &&
    process.env.AI_URL_FETCH_ENABLED !== "true"
  ) {
    throw new SSRFError(
      "server-side URL fetch is disabled in production — paste the article text, " +
        "or set AI_URL_FETCH_ENABLED=true once egress isolation is in place",
    );
  }
}

export interface ExtractionMeta {
  title?: string;
  publisher?: string;
  domain?: string;
  author?: string;
  publishedAt?: string;
  updatedAt?: string;
  canonicalUrl?: string;
  language?: string;
  charCount: number;
  /** 0-1 heuristic: how confident we are the readable body IS the article. */
  extractionConfidence: number;
  warnings: string[];
}

export interface ExtractedArticle {
  title?: string;
  byline?: string;
  excerpt?: string;
  text: string;
  meta: ExtractionMeta;
}

export interface FetchOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  maxChars?: number;
}

// Pure: extract readable text + provenance metadata from already-fetched HTML
// (no network). Metadata quality drives the extraction-preview panel in the
// draft modal — bad extraction must be visible, not silent.
export function extractArticle(html: string, url?: string): ExtractedArticle {
  const dom = new JSDOM(html, url ? { url } : undefined);
  const doc = dom.window.document;

  const metaContent = (selector: string): string | undefined =>
    doc.querySelector(selector)?.getAttribute("content")?.trim() || undefined;

  const publisher =
    metaContent('meta[property="og:site_name"]') ??
    metaContent('meta[name="application-name"]');
  const author =
    metaContent('meta[name="author"]') ??
    metaContent('meta[property="article:author"]');
  const publishedAt =
    metaContent('meta[property="article:published_time"]') ??
    metaContent('meta[name="date"]') ??
    doc.querySelector("time[datetime]")?.getAttribute("datetime") ??
    undefined;
  const updatedAt =
    metaContent('meta[property="article:modified_time"]') ??
    metaContent('meta[property="og:updated_time"]');
  const canonicalUrl =
    doc.querySelector('link[rel="canonical"]')?.getAttribute("href") ??
    metaContent('meta[property="og:url"]');
  const language =
    doc.documentElement.getAttribute("lang")?.trim() || undefined;

  const parsed = new Readability(doc).parse();
  const text = parsed?.textContent?.trim() ?? "";

  // Confidence + noise heuristics. Everything is advisory: warnings surface
  // in the modal; the route separately enforces the hard min-length gate.
  const warnings: string[] = [];
  const htmlTextLen = (doc.body?.textContent ?? "").trim().length;
  const ratio = htmlTextLen > 0 ? text.length / htmlTextLen : 0;
  let confidence = 0.5;
  if (text.length >= 800) confidence += 0.2;
  if (parsed?.title) confidence += 0.15;
  if (ratio >= 0.25 && ratio <= 0.98) confidence += 0.15;

  if (text.length < 800) {
    warnings.push(
      "extracted body is short — possible paywall, teaser, or blocked content",
    );
    confidence -= 0.2;
  }
  if (/(subscribe|sign in) to (read|continue)|paywall|metered/i.test(html)) {
    warnings.push("page shows paywall/subscription markers");
    confidence -= 0.15;
  }
  const liveBlog =
    /live.?blog|liveblog|\/live\/|minute.?by.?minute/i.test(
      `${url ?? ""} ${parsed?.title ?? ""}`,
    ) || doc.querySelectorAll("[data-liveblog], .live-blog").length > 0;
  if (liveBlog) {
    warnings.push(
      "looks like a live blog — content updates continuously; timestamps inside may be stale or future",
    );
    confidence -= 0.1;
  }
  const links = doc.querySelectorAll("a").length;
  if (links > 0 && text.length > 0 && links / (text.length / 100) > 6) {
    warnings.push(
      "high link density — extraction may include navigation/recommended stories",
    );
    confidence -= 0.1;
  }
  if (doc.querySelectorAll("[class*='comment'], #comments").length > 3) {
    warnings.push("page carries a large comment section — verify it was excluded");
  }

  return {
    title: parsed?.title ?? undefined,
    byline: parsed?.byline ?? undefined,
    excerpt: parsed?.excerpt ?? undefined,
    text,
    meta: {
      title: parsed?.title ?? undefined,
      publisher,
      domain: url ? safeDomain(url) : undefined,
      author: author ?? parsed?.byline ?? undefined,
      publishedAt,
      updatedAt,
      canonicalUrl: canonicalUrl ?? undefined,
      language,
      charCount: text.length,
      extractionConfidence: Math.max(0, Math.min(1, confidence)),
      warnings,
    },
  };
}

function safeDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

export async function fetchAndExtractArticle(
  rawUrl: string,
  opts: FetchOptions = {},
): Promise<ExtractedArticle & { finalUrl: string }> {
  // (0) Production egress gate — off by default in production.
  assertUrlFetchAllowed();
  // (1) Synchronous pre-check — throws before any network I/O for blocked URLs.
  assertSafeRequestURL(rawUrl);

  const [
    { default: got },
    { RequestFilteringHttpAgent, RequestFilteringHttpsAgent },
  ] = await Promise.all([import("got"), import("request-filtering-agent")]);

  const filterOpts = {
    allowPrivateIPAddress: false,
    allowMetaIPAddress: false,
  };
  const res = await got(rawUrl, {
    agent: {
      http: new RequestFilteringHttpAgent(filterOpts),
      https: new RequestFilteringHttpsAgent(filterOpts),
    },
    followRedirect: true,
    maxRedirects: opts.maxRedirects ?? 3,
    timeout: { request: opts.timeoutMs ?? 8000 },
    responseType: "text",
    // UA token, not prose: no space, so the compact "TapTrade" spelling.
    headers: { "user-agent": "TapTrade-MarketBot/1.0 (+article-ingest)" },
    hooks: {
      // (3) Re-validate every redirect target (scheme + literal IP).
      beforeRedirect: [
        (options) => {
          if (options.url) assertSafeRequestURL(options.url.toString());
        },
      ],
    },
  });

  const contentType = res.headers["content-type"] ?? "";
  if (!/text\/html|application\/xhtml/i.test(contentType)) {
    throw new SSRFError(
      `unexpected content-type for an article: ${contentType}`,
    );
  }

  const maxChars = opts.maxChars ?? 2_000_000;
  const body =
    res.body.length > maxChars ? res.body.slice(0, maxChars) : res.body;
  return { ...extractArticle(body, res.url), finalUrl: res.url };
}
