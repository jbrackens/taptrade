"use client";

/**
 * SocialAuthButtons — provider buttons for the login + sign-up flows.
 *
 * Each button targets the auth service's OAuth start route
 * (`/api/v1/auth/oauth/<provider>/start`), proxied same-origin via the Next
 * rewrite of `/api/v1/*`. Two variants:
 *   "grid"    — compact 3-column grid (login page, six providers).
 *   "stacked" — full-width "Continue with X" rows (register page, reference
 *               layout order).
 *
 * Clicks probe the start route first (redirect: manual) and follow the
 * provider redirect when it exists; a provider the deployment hasn't
 * configured degrades to an honest inline notice instead of navigating to
 * raw JSON. Every slug in this registry MUST have a matching backend
 * registration in services/auth/internal/http/oauth.go (X is slug
 * "twitter") — step 7 (2026-07-26) dropped Apple and SSO, which had no
 * backend on any deployment: a tile that can only fail is not an option.
 * Kilig (2026-09-24): the buttons themselves are secondary/outline —
 * neutral hairline, ink hover — never coloured chrome. Each provider's
 * icon keeps its own authentic mark (Google's four colours, Facebook
 * blue, etc.) since that's the provider's identity, not ours.
 */

import { useState, type MouseEvent, type ReactNode } from "react";

interface Provider {
  slug: string;
  name: string;
  icon: ReactNode;
}

const PROVIDERS: Provider[] = [
  {
    slug: "google",
    name: "Google",
    icon: <GoogleIcon />,
  },
  {
    slug: "twitter",
    name: "X",
    icon: <XIcon />,
  },
  {
    slug: "facebook",
    name: "Facebook",
    icon: <FacebookIcon />,
  },
  {
    slug: "tiktok",
    name: "TikTok",
    icon: <TikTokIcon />,
  },
  {
    slug: "reddit",
    name: "Reddit",
    icon: <RedditIcon />,
  },
  {
    slug: "discord",
    name: "Discord",
    icon: <DiscordIcon />,
  },
];

// Secondary/outline everywhere — neutral hairline at rest, ink stroke on
// hover/focus (the ui/Button "secondary" recipe). Never provider-coloured
// chrome; the icon glyph alone carries each brand's identity.
const GRID_CLASS = "grid grid-cols-3 gap-2.5";
const STACK_CLASS = "flex flex-col gap-2.5";
const STACK_BUTTON_CLASS =
  "flex min-h-[46px] w-full items-center justify-center gap-2.5 rounded-[var(--r-rh-md)] border border-[var(--border-2)] bg-[var(--surface-1)] px-4 text-sm font-semibold text-[var(--t1)] no-underline transition-[border-color,transform] duration-150 ease-[ease] hover:border-[var(--t3)] hover:-translate-y-px active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)]";
const NOTICE_CLASS =
  "rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--t2)]";
const DEFAULT_GRID_SLUGS = [
  "google",
  "twitter",
  "facebook",
  "tiktok",
  "reddit",
  "discord",
];
const BUTTON_BASE_CLASS =
  "flex min-h-[46px] items-center justify-center gap-2 rounded-[var(--r-rh-md)] border border-[var(--border-2)] bg-[var(--surface-1)] px-2 py-0 text-[13px] font-semibold text-[var(--t2)] no-underline transition-[border-color,color,transform] duration-150 ease-[ease] hover:border-[var(--t3)] hover:-translate-y-px hover:text-[var(--t1)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] max-[460px]:px-0";
const ICON_CLASS = "inline-flex";
const NAME_CLASS = "whitespace-nowrap max-[460px]:hidden";

export interface SocialAuthButtonsProps {
  /** Provider slugs to render, in order. Defaults to the six-provider grid set. */
  providers?: string[];
  variant?: "grid" | "stacked";
}

export default function SocialAuthButtons({
  providers,
  variant = "grid",
}: SocialAuthButtonsProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const slugs = providers ?? DEFAULT_GRID_SLUGS;
  const list = slugs
    .map((slug) => PROVIDERS.find((p) => p.slug === slug))
    .filter((p): p is Provider => Boolean(p));

  // Probe the start route before navigating: configured providers answer
  // with a 3xx redirect to the IdP; unconfigured/unknown ones answer with
  // an error JSON that must never be rendered as a page.
  async function startOAuth(e: MouseEvent<HTMLAnchorElement>, p: Provider) {
    e.preventDefault();
    setNotice(null);
    // Trailing slash matters: without it Next's trailingSlash 308 redirect
    // masquerades as a provider redirect and the probe follows it into a
    // raw 404 page.
    const startUrl = `/api/v1/auth/oauth/${p.slug}/start/`;
    try {
      const res = await fetch(startUrl, { redirect: "manual" });
      if (
        res.type === "opaqueredirect" ||
        (res.status >= 300 && res.status < 400)
      ) {
        window.location.href = startUrl;
        return;
      }
      setNotice(
        `${p.name} sign-in isn't configured for this deployment yet. Use email below.`,
      );
    } catch {
      setNotice(
        `${p.name} sign-in isn't reachable right now. Use email below.`,
      );
    }
  }

  const stacked = variant === "stacked";
  return (
    // biome-ignore lint/a11y/useSemanticElements: labeled control group; fieldset/legend swap is queued for the P2 primitives pass (fieldset layout quirks)
    <div
      className={stacked ? STACK_CLASS : GRID_CLASS}
      role="group"
      aria-label="Social login options"
    >
      {list.map((p) => (
        <a
          key={p.slug}
          className={stacked ? STACK_BUTTON_CLASS : BUTTON_BASE_CLASS}
          href={`/api/v1/auth/oauth/${p.slug}/start/`}
          onClick={(e) => startOAuth(e, p)}
          title={`Continue with ${p.name}`}
          aria-label={`Continue with ${p.name}`}
          rel="nofollow"
        >
          <span className={ICON_CLASS} aria-hidden="true">
            {p.icon}
          </span>
          <span className={stacked ? "whitespace-nowrap" : NAME_CLASS}>
            {stacked ? `Continue with ${p.name}` : p.name}
          </span>
        </a>
      ))}
      {notice && (
        <p className={NOTICE_CLASS} role="status">
          {notice}
        </p>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      className="block size-5"
      focusable="false"
      aria-hidden="true"
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      className="block size-5"
      focusable="false"
      aria-hidden="true"
    >
      <path
        fill="var(--t1)"
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"
      />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      className="block size-5"
      focusable="false"
      aria-hidden="true"
    >
      <path
        fill="#1877F2"
        d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
      />
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      className="block size-5"
      focusable="false"
      aria-hidden="true"
    >
      <path
        fill="var(--t1)"
        d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"
      />
    </svg>
  );
}

function RedditIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      className="block size-5"
      focusable="false"
      aria-hidden="true"
    >
      <path
        fill="#FF4500"
        d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"
      />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      className="block size-5"
      focusable="false"
      aria-hidden="true"
    >
      <path
        fill="#5865F2"
        d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"
      />
    </svg>
  );
}
