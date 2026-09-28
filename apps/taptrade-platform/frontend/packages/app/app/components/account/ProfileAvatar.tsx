/**
 * ProfileAvatar — a player's identity disc: initials on a Kilig gradient.
 * Pink is the identity colour (DESIGN.md), so the one gradient in the app
 * lives here; the top bar's small disc stays ink.
 */

import { profileInitials } from "./profile-data";

const SIZE_CLASS = {
  48: "h-12 w-12 text-[17px]",
  64: "h-16 w-16 text-[22px]",
} as const;

export function ProfileAvatar({
  name,
  size = 64,
}: {
  name: string;
  size?: keyof typeof SIZE_CLASS;
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--kilig-bright)_0%,var(--kilig)_45%,var(--ink-2)_100%)] font-semibold tracking-[-0.01em] text-[var(--on-kilig)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)] ${SIZE_CLASS[size]}`}
    >
      {profileInitials(name)}
    </span>
  );
}
