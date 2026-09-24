"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function ResetPasswordRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const token = searchParams.get("token") || "";
    router.replace(`/auth/reset-password?token=${token}`);
  }, [router, searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-10 text-sm text-[var(--t3)]">
      Redirecting…
    </div>
  );
}
