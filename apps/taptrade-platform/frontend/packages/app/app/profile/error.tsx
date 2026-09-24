"use client";

import { useEffect } from "react";
import { logger } from "../lib/logger";
import { Button } from "../components/ui";

const shellClass =
  "flex min-h-[50vh] flex-col items-center justify-center px-5 py-10 text-center";
const titleClass = "mb-2 text-xl font-bold text-[var(--t1)]";
const copyClass = "mb-6 max-w-[400px] text-sm leading-[1.6] text-[var(--t2)]";
const actionRowClass = "flex gap-3";

export default function ProfileError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error("ProfileError", "Profile page error", error);
  }, [error]);

  return (
    <div className={shellClass}>
      <svg
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="mb-4 text-[var(--t3)]"
      >
        <circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M12 7.5v5.25M12 16v.01"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <h2 className={titleClass}>Profile error</h2>
      <p className={copyClass}>
        {error.message ||
          "We couldn't load your profile. Please check your connection and try again."}
      </p>
      <div className={actionRowClass}>
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
        <Button variant="secondary" render={<a href="/" />}>
          Back to home
        </Button>
      </div>
    </div>
  );
}
