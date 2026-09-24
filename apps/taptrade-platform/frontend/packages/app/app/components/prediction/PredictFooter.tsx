"use client";

/**
 * PredictFooter — the Kilig anchor (DESIGN.md §6 chrome).
 *
 * Chrome is ink + white + hairlines: every page ends on a plain white
 * footer under a hairline, the ink Tap Trade lockup, quiet ink links, and
 * a small muted legal line. No brand-color slab — Kilig pink stays
 * reserved for identity and liveness, never a footer ground.
 */

import Link from "next/link";
import { FEATURE_RG } from "../../lib/features";
import { brand } from "../../lib/brand";
import BrandMark from "../BrandMark";

const YEAR = new Date().getFullYear();

const LINKS = [
  { href: "/about", label: "About" },
  { href: "/tos", label: "Terms of Use" },
  { href: "/privacy", label: "Privacy" },
  ...(FEATURE_RG
    ? [{ href: "/responsible-gaming", label: "Responsible Gaming" }]
    : []),
  { href: "/contact-us", label: "Contact" },
];

export function PredictFooter() {
  return (
    <footer className="mt-10 border-t border-[var(--border-1)] bg-[var(--surface-1)] px-7 py-6 text-xs max-[640px]:px-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <span className="inline-flex items-center gap-2.5 text-[19px] font-semibold leading-none tracking-[-0.025em] text-[var(--t1)]">
          <BrandMark size={28} tone="ink" />
          <span>{brand.name}</span>
        </span>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="font-medium text-[var(--t2)] no-underline transition-colors duration-[120ms] hover:text-[var(--t1)]"
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>
      <div className="mt-5 border-t border-[var(--border-1)] pt-4 text-[var(--t3)]">
        <span className="font-bold text-[var(--t2)]">{brand.name}</span>
        {" · "}© {YEAR} {brand.legalEntity}
        {" · "}Non-redeemable point prediction markets
      </div>
    </footer>
  );
}
