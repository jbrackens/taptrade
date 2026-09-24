"use client";

import { useEffect } from "react";
import { logger } from "./lib/logger";
import { Button } from "./components/ui";

// Named AppError, not Error: shadowing the global Error inside a
// component whose props reference the real Error type is asking for the
// annotation to silently resolve to the component (Next only cares that
// the default export is a component, not its name).
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error("App", "Unhandled app error", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-5 py-10 text-center">
      <p className="m-0 text-[12px] font-semibold text-[var(--danger)]">
        Error
      </p>
      <h2 className="type-poster m-0 mt-3 text-[28px] text-[var(--t1)]">
        Something went wrong
      </h2>
      <p className="mb-6 mt-3 max-w-[400px] text-sm leading-relaxed text-[var(--t2)]">
        Something went wrong. Please try again or contact support.
        {process.env.NODE_ENV === "development" && error.message && (
          <span className="mt-2 block font-mono text-xs text-[var(--t3)]">
            {error.message}
          </span>
        )}
      </p>
      <Button variant="primary" onClick={reset}>
        Try Again
      </Button>
    </div>
  );
}
