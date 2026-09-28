/**
 * IconTile — the account area's icon mark: a Phosphor icon in its duotone
 * weight on a softly rounded square (the thin line icons in grey circles
 * read as unfinished, 2026-09-28). Ink on a raised well, per the palette:
 * no colour of its own.
 */

import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

const TILE = {
  36: { box: "h-9 w-9 rounded-[9px]", icon: 18 },
  40: { box: "h-10 w-10 rounded-[10px]", icon: 22 },
} as const;

export function IconTile({
  icon: Icon,
  size = 40,
  tone = "well",
}: {
  icon: PhosphorIcon;
  size?: keyof typeof TILE;
  /** "ink" inverts the tile for an earned or active state. */
  tone?: "well" | "ink";
}) {
  const t = TILE[size];
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center ${t.box} ${
        tone === "ink" ? "bg-[var(--ink)] text-[var(--on-ink)]" : "bg-[var(--surface-2)] text-[var(--t1)]"
      }`}
    >
      <Icon size={t.icon} weight="duotone" />
    </span>
  );
}
