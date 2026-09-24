/**
 * Card — the app's surface-section primitive (P1): rounded r-rh-lg,
 * border-1, surface-1. Replaces the per-file SECTION_CLASS/CARD_CLASS
 * recipes. Server-component-safe (no hooks, no "use client").
 *
 * Step 4 (2026-07-26, States.dc.html 18b/18c): two structural variants —
 *   variant="dashed"  — the empty-state frame (dashed strong hairline);
 *   edge="no|info|pending" — the error/notice card's 3px left edge.
 * Both compose with padding and each other.
 */

import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { cx, variants } from "./variants";

export type CardPadding = "none" | "md" | "lg";
export type CardVariant = "solid" | "dashed";
/** Left-edge accent tone for notice, error, and brand-status cards (States 18c). */
export type CardEdge = "brand" | "no" | "info" | "pending";

const cardPadding = variants<CardPadding>(
  "rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)]",
  {
    none: "",
    md: "p-5",
    lg: "px-6 py-6 max-[720px]:px-5",
  },
);

const VARIANT_CLASS: Record<CardVariant, string> = {
  solid: "",
  dashed: "border-dashed border-[var(--border-2)]",
};

// `no` is the error/notice edge: it uses the system danger colour, not
// market-NO orange, so a failed action never reads as a NO outcome.
const EDGE_CLASS: Record<CardEdge, string> = {
  brand: "border-l-[3px] border-l-[var(--ink)] !bg-[var(--surface-2)]",
  no: "border-l-[3px] border-l-[var(--danger)]",
  info: "border-l-[3px] border-l-[var(--info-dot)]",
  pending: "border-l-[3px] border-l-[var(--pending-border)]",
};

export interface CardProps extends HTMLAttributes<HTMLElement> {
  padding?: CardPadding;
  variant?: CardVariant;
  edge?: CardEdge;
  /** Render as <section> (default) or a plain <div>. */
  as?: "section" | "div" | "article" | "aside";
}

export const Card = forwardRef<HTMLElement, CardProps>(function Card(
  {
    padding = "lg",
    variant = "solid",
    edge,
    as: Tag = "section",
    className,
    ...rest
  },
  ref,
) {
  return (
    <Tag
      // eslint-free repo: the ref cast is safe — all four tags are HTMLElement.
      ref={ref as React.Ref<never>}
      className={cx(
        cardPadding(padding),
        VARIANT_CLASS[variant],
        edge && EDGE_CLASS[edge],
        className,
      )}
      {...rest}
    />
  );
});
