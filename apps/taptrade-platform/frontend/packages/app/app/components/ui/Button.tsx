"use client";

/**
 * Button — the app's one button primitive (P1). Variants are the
 * canonical token recipes previously pasted per-file (the audit's
 * "*_CLASS" slop signature); every surface migrates onto these instead
 * of re-declaring them.
 *
 * Polymorphism uses Base UI's render prop (the layer's standard —
 * Dialog.Trigger etc. use the same mechanism): pass render={<Link …/>}
 * to keep link semantics under button styling.
 */

import { useRender } from "@base-ui-components/react/use-render";
import { cloneElement, useEffect, useRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { logger } from "../../lib/logger";
import { cx, variants } from "./variants";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "cta";
export type ButtonSize = "sm" | "md" | "lg" | "none";

// transition-*, font-weight, and radius live in the VARIANT, not the
// base: same-property Tailwind classes resolve by generated-CSS order,
// not class order, so the base must never set a property a variant
// overrides (every variant uses r-rh-md + font-semibold today).
const BUTTON_FOCUS_CLASS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)]";
const BUTTON_INERT_CLASS =
  "disabled:border disabled:border-[var(--inert-border)] disabled:bg-[var(--inert-fill)] disabled:text-[var(--inert-label)] disabled:opacity-100 disabled:filter-none";

const buttonVariant = variants<ButtonVariant>(
  `inline-flex cursor-pointer select-none items-center justify-center gap-1.5 disabled:cursor-not-allowed ${BUTTON_FOCUS_CLASS}`,
  {
    // Kilig: ink is the action colour. Hover lifts the ink toward the
    // surface (a brightness filter does nothing on near-black); press is a
    // 1px drop with a 1% squash.
    primary:
      `rounded-[var(--r-rh-md)] border-0 bg-[var(--accent)] font-semibold tracking-[-0.005em] text-[var(--ticket-cta-text)] transition-[background-color,transform] duration-150 [&:not(:disabled):hover]:bg-[color-mix(in_srgb,var(--accent)_86%,var(--surface-1))] [&:not(:disabled):active]:translate-y-px [&:not(:disabled):active]:scale-[0.99] ${BUTTON_INERT_CLASS}`,
    // White on a strong hairline; hover darkens the stroke only.
    secondary:
      `rounded-[var(--r-rh-md)] border border-[var(--border-2)] bg-[var(--surface-1)] font-semibold tracking-[-0.005em] text-[var(--t1)] transition-[background-color,border-color,transform] duration-150 [&:not(:disabled):hover]:border-[var(--t3)] [&:not(:disabled):active]:translate-y-px [&:not(:disabled):active]:scale-[0.99] ${BUTTON_INERT_CLASS}`,
    // Toolbar/inline affordances: no chrome until hover.
    ghost:
      `rounded-[var(--r-rh-md)] border border-transparent bg-transparent font-semibold tracking-[-0.005em] text-[var(--t2)] transition-[background-color,color,transform] duration-150 [&:not(:disabled):hover]:bg-[var(--surface-2)] [&:not(:disabled):hover]:text-[var(--t1)] [&:not(:disabled):active]:translate-y-px ${BUTTON_INERT_CLASS}`,
    // Destructive confirms use the system danger colour. YES/NO colours
    // stay reserved for market direction.
    danger:
      `rounded-[var(--r-rh-md)] border-0 bg-[var(--danger)] font-semibold tracking-[-0.005em] text-[var(--on-ink)] transition-[filter,transform] duration-150 [&:not(:disabled):hover]:brightness-[1.08] [&:not(:disabled):active]:translate-y-px [&:not(:disabled):active]:scale-[0.99] ${BUTTON_INERT_CLASS}`,
    // The commit button (trade ticket / store checkout): full-width,
    // self-sized — pair with size="none".
    //
    // Disabled uses the neutral inert treatment: explicit surface —
    // --inert-fill / --inert-border / --inert-label — with NO opacity and
    // NO filter, so a blocked state stays readable. The disabled: classes
    // beat the base border-0/bg/text by :disabled specificity, not by
    // class order.
    cta: "w-full min-h-[52px] rounded-[var(--r-rh-md)] border-0 bg-[var(--accent)] px-4 py-[14px] text-[15px] font-semibold tracking-[-0.005em] text-[var(--ticket-cta-text)] no-underline transition-[background-color,transform] duration-150 [&:not(:disabled):hover]:bg-[color-mix(in_srgb,var(--accent)_86%,var(--surface-1))] [&:not(:disabled):active]:translate-y-px [&:not(:disabled):active]:scale-[0.99] disabled:border disabled:border-[var(--inert-border)] disabled:bg-[var(--inert-fill)] disabled:text-[var(--inert-label)] disabled:opacity-100 disabled:filter-none disabled:transform-none",
  },
);

// The inert cta recipe for the CUSTOM-RENDER path. A non-button render
// target (e.g. <a>) never matches :disabled, so the disabled: classes in
// the variant string are dead there — and appending same-property
// arbitrary-value utilities (bg-[…] over bg-[…]) would resolve by
// generated-CSS order, not class order. So the disabled custom cta
// REPLACES the variant recipe outright with the inert surface. Layout
// classes mirror the cta variant; state classes carry the §3 treatment.
const CTA_INERT_CUSTOM =
  "w-full rounded-md border border-[var(--inert-border)] bg-[var(--inert-fill)] px-4 py-[14px] text-[15px] font-semibold text-[var(--inert-label)] no-underline";

const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 text-[13px]",
  md: "min-h-10 px-4 text-sm",
  lg: "min-h-12 px-5 text-[15px]",
  none: "",
};

export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className"
> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  /**
   * Replace the underlying element, e.g. render={<Link href=…/>}.
   * Element form only (not Base UI's function form): the disabled
   * contract below is enforced by cloning the element, which requires
   * owning its props.
   *
   * COOPERATIVE CONTRACT (inherent to React composition — the same
   * holds for Radix asChild and Base UI render everywhere): when the
   * render target is a COMPONENT, it must forward received props to its
   * underlying element. React cannot force a component to honor props
   * it discards; a dev-mode runtime check below detects and reports
   * violations against the rendered DOM node.
   */
  render?: React.ReactElement<Record<string, unknown>>;
  ref?: React.Ref<HTMLButtonElement>;
}

export function Button({
  variant = "secondary",
  size = "md",
  type = "button",
  className,
  render,
  ref,
  disabled,
  onClick,
  ...rest
}: ButtonProps) {
  // Custom render targets (e.g. render={<Link/>}) are not <button>s: the
  // `disabled` attribute is invalid there, so it translates to
  // aria-disabled + removal from the tab order + activation blocking.
  // Enforcement is by CLONING the render element with those props forced
  // (Codex re-review 2026-07-19 round 3): Base UI merges the render
  // element's own props over the hook's, so semantics attached only at
  // the hook layer could be overridden by props on the render element
  // itself — clone props replace the element's own, including its
  // original onClick, which the guard supersedes entirely while
  // disabled. The guard still preventDefault()s for any handler Base UI
  // composes around it (Next <Link> bails on defaultPrevented).
  const isCustomElement = render != null;
  const blockActivation = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const disabledCustomProps =
    isCustomElement && disabled
      ? ({
          "aria-disabled": true,
          tabIndex: -1,
          onClick: blockActivation,
        } as const)
      : null;
  const effectiveRender =
    render != null && disabledCustomProps
      ? cloneElement(render, { ...disabledCustomProps })
      : render;

  // Dev-mode cooperative-contract check: cloning seals HOST render
  // elements, but a render COMPONENT could drop the forced props on the
  // floor before they reach its DOM. That cannot be prevented in
  // React's model — so it is detected. Two violation shapes (Codex
  // re-review round 4): a component that drops the REF leaves the node
  // null — the contract requires forwarding the ref, so null-while-
  // mounted IS the violation, not a blind spot; a component that
  // forwards the ref but cherry-picks props is caught by checking BOTH
  // enforced attributes on the real DOM node.
  const nodeRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (!isCustomElement || !disabled) return;
    const violation = checkDisabledRenderContract(nodeRef.current);
    if (violation) {
      logger.error("ui/Button", violation.message, violation.data);
    }
    // render?.type keeps the check live across TARGET SWAPS (a compliant
    // target replaced by a violating one while still disabled) without
    // re-running on every render — element objects are new each render,
    // but the target's component identity is stable until it changes.
  }, [isCustomElement, disabled, render?.type]);

  return useRender({
    // The default element is a real <button> with an explicit type;
    // custom render elements own their own semantics (Link needs none).
    render: effectiveRender ?? <button type={type} />,
    ref: ref != null ? [ref, nodeRef] : nodeRef,
    props: {
      className: cx(
        // Disabled custom cta swaps to the inert recipe (see
        // CTA_INERT_CUSTOM); other variants keep the opacity treatment
        // until their spec lands.
        isCustomElement && disabled && variant === "cta"
          ? CTA_INERT_CUSTOM
          : buttonVariant(variant),
        SIZE[size],
        isCustomElement && disabled
          ? variant === "cta"
            ? "pointer-events-none cursor-not-allowed"
            : "pointer-events-none cursor-not-allowed opacity-55"
          : undefined,
        className,
      ),
      onClick,
      ...(isCustomElement ? {} : { disabled }),
      ...rest,
      ...(disabledCustomProps ?? {}),
    },
  });
}

/**
 * Pure contract check behind the dev-mode detector (exported for direct
 * unit coverage — react-test-renderer cannot attach Base UI's composed
 * refs to mock hosts, so the logic is verified here and the effect
 * wiring is verified through the null path).
 */
export function checkDisabledRenderContract(
  node: Pick<HTMLElement, "getAttribute" | "tagName"> | null,
): { message: string; data: Record<string, unknown> } | null {
  if (node == null) {
    return {
      message:
        "disabled render component did not forward its ref — the cooperative render contract requires spreading received props AND ref onto the underlying element",
      data: {},
    };
  }
  if (
    node.getAttribute("aria-disabled") !== "true" ||
    node.getAttribute("tabindex") !== "-1"
  ) {
    return {
      message:
        "disabled render component dropped required props — its underlying element lacks aria-disabled/tabindex; forward received props to the DOM element",
      data: { element: node.tagName },
    };
  }
  return null;
}
