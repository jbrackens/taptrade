"use client";

/**
 * Toasts — sonner underneath, the app's existing useToast() API on top.
 * The hand-rolled queue/timer/exit-animation provider is deleted; sonner
 * owns scheduling, stacking, swipe-dismiss, pause-on-hover, and
 * reduced-motion. The Kilig card (white surface, hairline border, a 3px
 * left edge in the system colour for the kind, --shadow-pop since this
 * is a floating layer) and the a11y contract (errors interrupt, the
 * rest stay polite) live in the custom card below.
 */

import type React from "react";
import { createContext, useContext, useMemo } from "react";
import { Toaster, toast as sonnerToast } from "sonner";
import { Check, X, Info, AlertTriangle } from "lucide-react";

// ── Types (public API, unchanged) ──
export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number; // ms, default 4000
}

// Handoff spec §3-07: duration is per-toast. Receipts with numbers to
// reconcile (partial fills, rejections, settlements) pass a longer one;
// the 4s default is for acknowledgements.
interface ToastOpts {
  duration?: number;
}

interface ToastContextValue {
  addToast: (toast: Omit<Toast, "id">) => string;
  removeToast: (id: string) => void;
  success: (title: string, message?: string, opts?: ToastOpts) => string;
  error: (title: string, message?: string, opts?: ToastOpts) => string;
  info: (title: string, message?: string, opts?: ToastOpts) => string;
  warning: (title: string, message?: string, opts?: ToastOpts) => string;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
};

// ── Icons ──
const icons: Record<ToastType, React.ReactNode> = {
  success: <Check size={14} strokeWidth={2} />,
  error: <X size={14} strokeWidth={2} />,
  info: <Info size={14} strokeWidth={2} />,
  warning: <AlertTriangle size={14} strokeWidth={2} />,
};

// Toasts are system cards, not tinted glass — white --surface-1 card,
// hairline --border-1, --shadow-pop (a floating layer). Status speaks
// through a 3px left edge plus a matching icon glyph in the system
// colour for the kind — never through the card surface, and never
// through Kilig pink (identity/liveness only, reserved elsewhere).
const toastClasses: Record<ToastType, { edge: string; icon: string }> = {
  success: {
    edge: "border-l-[var(--success)]",
    icon: "text-[var(--success)]",
  },
  error: { edge: "border-l-[var(--danger)]", icon: "text-[var(--danger)]" },
  // Info stays neutral ink; pink and gold are reserved for identity/liveness.
  info: { edge: "border-l-[var(--ink)]", icon: "text-[var(--t2)]" },
  warning: {
    edge: "border-l-[var(--warning)]",
    icon: "text-[var(--warning)]",
  },
};

// ── The P9 card, rendered through sonner's custom slot ──
function ToastCard({
  toast,
  sonnerId,
}: {
  toast: Omit<Toast, "id">;
  sonnerId: string | number;
}) {
  const c = toastClasses[toast.type];
  return (
    <div
      // Errors interrupt (role=alert/assertive); informational toasts stay
      // polite. A single polite role previously under-announced failures.
      role={toast.type === "error" ? "alert" : "status"}
      aria-live={toast.type === "error" ? "assertive" : "polite"}
      className={`pointer-events-auto flex min-w-[300px] max-w-[400px] items-start gap-3 rounded-[var(--r-rh-md)] border border-[var(--border-1)] border-l-[3px] bg-[var(--surface-1)] px-4 py-3.5 shadow-[var(--shadow-pop)] ${c.edge}`}
    >
      <div className="flex shrink-0 items-center pt-[3px]">
        <span className={`flex items-center ${c.icon}`}>
          {icons[toast.type]}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold leading-[1.4] text-[var(--t1)]">
          {toast.title}
        </div>
        {toast.message && (
          <div className="mt-0.5 text-xs leading-normal text-[var(--t2)]">
            {toast.message}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => sonnerToast.dismiss(sonnerId)}
        className="shrink-0 cursor-pointer border-0 bg-transparent p-0.5 text-base leading-none text-[var(--t3)] transition-colors duration-150 hover:text-[var(--t1)]"
      >
        ×
      </button>
    </div>
  );
}

function show(toast: Omit<Toast, "id">): string {
  const id = sonnerToast.custom(
    (sonnerId) => <ToastCard toast={toast} sonnerId={sonnerId} />,
    { duration: toast.duration ?? 4000 },
  );
  return String(id);
}

// ── Provider ──
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const value = useMemo<ToastContextValue>(
    () => ({
      addToast: show,
      removeToast: (id) => sonnerToast.dismiss(id),
      success: (title, message, opts) =>
        show({ type: "success", title, message, ...opts }),
      error: (title, message, opts) =>
        show({ type: "error", title, message, ...opts }),
      info: (title, message, opts) =>
        show({ type: "info", title, message, ...opts }),
      warning: (title, message, opts) =>
        show({ type: "warning", title, message, ...opts }),
    }),
    [],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* Fixed top-right, BELOW the 64px header so notifications never
          cover the nav/balance controls (76px contract). zIndex mirrors
          OVERLAY_Z.toast (z-[300]) — sonner takes a numeric style, not a
          class. ToastProvider mounts inside AppShell's themed wrapper, so
          cards resolve route-native tokens (html[data-theme] mirror). */}
      <Toaster
        position="top-right"
        offset={{ top: 76, right: 16 }}
        mobileOffset={{ top: 76, right: 16 }}
        gap={8}
        style={{ zIndex: 300 }}
      />
    </ToastContext.Provider>
  );
};

export default ToastProvider;
