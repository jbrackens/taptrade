"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { adminFetch } from "../lib/admin-fetch";

// Sidebar navigation. Only entries whose backend is wired for the
// prediction platform are shown, and restored as each backend lands.
//
// /users is wired: admin/punters (GW-1) returns prediction-native punter
// identity + point-account state (wallet balance, portfolio result, positions,
// accuracy), so the list + detail render real data. /access-control (RBAC),
// /disputes, /social-moderation, /content, /loyalty, /leaderboards, and
// /audit-logs are also wired to mounted /api/v1/admin/* gateway routes.
//
// Retired shells stay redirects only:
// /campaigns and /reports -> /dashboard, /risk-management ->
// /prediction-admin/risk.
//
// P2-12: `requiredPermission` mirrors the RBAC permission the gateway enforces
// on that section's API (rbac_admin_handlers.go / migration 027). Items without
// one are gated by the coarse admin-session check only (requireAdminRole) and so
// are shown to every signed-in admin. The list is filtered from
// GET /api/v1/admin/me purely as a UX hint — the gateway stays the authorization
// boundary, so the filter fails OPEN (full menu) while permissions load or if
// the lookup fails; an over-shown item just 403s when its API is called.
interface NavItem {
  href: string;
  label: string;
  icon: string;
  requiredPermission?: string;
}

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "layout-dashboard" },
  {
    href: "/users",
    label: "Users",
    icon: "users",
    requiredPermission: "users:read",
  },
  {
    href: "/access-control",
    label: "Access Control",
    icon: "shield-check",
    requiredPermission: "roles:read",
  },
  {
    href: "/prediction-admin/markets",
    label: "Markets",
    icon: "trending-up",
    requiredPermission: "markets:read",
  },
  {
    href: "/prediction-admin/taxonomy",
    label: "Taxonomy",
    icon: "tags",
    requiredPermission: "markets:edit",
  },
  {
    href: "/prediction-admin/moments",
    label: "Featured Moments",
    icon: "trending-up",
    requiredPermission: "markets:edit",
  },
  {
    href: "/prediction-admin/settlements",
    label: "Settlements",
    icon: "check-square",
    requiredPermission: "settlements:resolve",
  },
  {
    href: "/prediction-admin/reward-clusters",
    label: "Reward Clusters",
    icon: "shield-alert",
  },
  {
    href: "/prediction-admin/store-packs",
    label: "Point Packs",
    icon: "check-square",
    requiredPermission: "finances:view",
  },
  {
    href: "/prediction-admin/activity",
    label: "Activity Export",
    icon: "scroll-text",
  },
  {
    href: "/disputes",
    label: "Disputes",
    icon: "shield-alert",
  },
  {
    href: "/social-moderation",
    label: "Social Reports",
    icon: "message-square-warning",
  },
  { href: "/content", label: "Content", icon: "file-text" },
  { href: "/loyalty", label: "Loyalty", icon: "gift" },
  { href: "/leaderboards", label: "Leaderboards", icon: "trophy" },
  { href: "/audit-logs", label: "Audit Logs", icon: "scroll-text" },
];

/* Lucide icon SVG paths — inlined to avoid a runtime dependency in the office package */
const lucideIcons: Record<string, string> = {
  "layout-dashboard":
    '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  "trending-up":
    '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  tags: '<path d="M13.172 2a2 2 0 0 1 1.414.586l6.71 6.71a2.4 2.4 0 0 1 0 3.408l-8.592 8.592a2.4 2.4 0 0 1-3.408 0l-6.71-6.71A2 2 0 0 1 2 13.172V4a2 2 0 0 1 2-2z"/><path d="M7 7h.01"/><path d="m9 15 6-6"/>',
  "shield-alert":
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  "shield-check":
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  "message-square-warning":
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v4"/><path d="M12 15h.01"/>',
  "check-square":
    '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  trophy:
    '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  medal:
    '<path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15"/><path d="M11 12 5.12 2.2"/><path d="m13 12 5.88-9.8"/><path d="M8 7h8"/><circle cx="12" cy="17" r="5"/><path d="M12 18v-2h-.5"/>',
  "scroll-text":
    '<path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2"/>',
  "file-text":
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>',
  "log-out":
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
};

function LucideIcon({
  name,
  size = 18,
  color = "currentColor",
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  const paths = lucideIcons[name] || "";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: paths }}
    />
  );
}

const navItemClassName = [
  "flex cursor-pointer items-center gap-[10px] rounded-[8px] border-0 border-l-[3px] border-l-transparent bg-transparent px-[14px] py-[9px]",
  "text-[13px] font-medium text-[color:var(--t2)] no-underline transition-all duration-150 ease-[ease]",
  "hover:bg-[var(--surface-2)] hover:text-[color:var(--t1)]",
  "max-[768px]:min-w-max max-[768px]:border-l-0 max-[768px]:px-3 max-[768px]:py-2.5",
].join(" ");

const activeNavItemClassName = [
  "border-l-[color:var(--focus-ring)] bg-[var(--accent-soft)] font-semibold text-[color:var(--focus-ring)] [&_svg]:stroke-[var(--focus-ring)]",
  "max-[768px]:border-l-0 max-[768px]:border-b-2 max-[768px]:border-b-[color:var(--focus-ring)]",
].join(" ");

function getNavItemClassName(isActive: boolean) {
  return isActive
    ? `${navItemClassName} ${activeNavItemClassName}`
    : navItemClassName;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  // Permission-aware menu (P2-12). `perms === null` means "not loaded yet"; the
  // filter below treats that — plus the dev anonymous bypass — as fail-open so
  // the full menu renders. The gateway enforces every route regardless, so an
  // over-shown item simply 403s on click; an under-shown item would strand a
  // legitimate admin, which is the worse failure. Hence: hide an item only once
  // we positively know the signed-in admin lacks its permission.
  const [perms, setPerms] = useState<string[] | null>(null);
  const [unconstrained, setUnconstrained] = useState(false);

  useEffect(() => {
    let cancelled = false;
    adminFetch("/api/v1/admin/me")
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (data: { permissions?: string[]; unconstrained?: boolean } | null) => {
          if (cancelled || !data) return;
          setPerms(Array.isArray(data.permissions) ? data.permissions : []);
          setUnconstrained(Boolean(data.unconstrained));
        },
      )
      .catch(() => {
        // Fail open: leave perms === null so the full menu renders.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleNavItems = navItems.filter((item) => {
    if (!item.requiredPermission) return true;
    if (perms === null || unconstrained) return true;
    return perms.includes(item.requiredPermission);
  });

  return (
    <div className="flex min-h-screen max-[768px]:flex-col">
      <aside className="fixed bottom-0 left-0 top-0 z-10 flex w-[240px] flex-col border-r border-[color:var(--border-1)] bg-[var(--surface-1)] max-[768px]:relative max-[768px]:bottom-auto max-[768px]:left-auto max-[768px]:top-auto max-[768px]:w-full max-[768px]:border-b max-[768px]:border-r-0">
        <div className="flex items-center gap-3 border-b border-[color:var(--border-1)] px-5 pb-5 pt-6 max-[768px]:min-w-max max-[768px]:border-b-0 max-[768px]:border-r max-[768px]:px-4 max-[768px]:py-[14px]">
          <div
            aria-hidden="true"
            className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] border border-[color:var(--border-1)] bg-[var(--surface-1)] text-[var(--focus-ring)]"
          >
            <svg
              className="h-5 w-6 overflow-visible"
              viewBox="0 0 32 24"
              fill="none"
            >
              <path
                d="M3 16 L12 10 L21 14 L29 6"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {[3, 12, 21, 29].map((cx, index) => (
                <circle
                  key={cx}
                  cx={cx}
                  cy={[16, 10, 14, 6][index]}
                  r="2.5"
                  fill="var(--surface-1)"
                  stroke="currentColor"
                  strokeWidth="3"
                />
              ))}
            </svg>
          </div>
          <span className="text-[14px] font-semibold text-[color:var(--t1)]">
            Backoffice
          </span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2 max-[768px]:flex-row max-[768px]:gap-1 max-[768px]:overflow-x-auto max-[768px]:p-3">
          <div className="px-4 pb-[6px] pt-4 text-[11px] font-semibold uppercase tracking-[0.04em] text-[color:var(--t3)] max-[768px]:hidden">
            Operations
          </div>
          {visibleNavItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={getNavItemClassName(
                Boolean(pathname?.startsWith(item.href)),
              )}
            >
              <span className="h-[18px] w-[18px] shrink-0">
                <LucideIcon name={item.icon} />
              </span>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="border-t border-t-[#1a1f3a] px-3 py-4 max-[768px]:border-l max-[768px]:border-l-[color:var(--border-1)] max-[768px]:border-t-0 max-[768px]:p-3">
          <a
            href="/auth/login"
            className={`${navItemClassName} !text-[13px] !text-[color:var(--no-text)] hover:!bg-[var(--no-soft)]`}
          >
            <span className="h-[18px] w-[18px] shrink-0">
              <LucideIcon name="log-out" />
            </span>
            Sign Out
          </a>
        </div>
      </aside>

      <div className="ml-[240px] flex min-h-screen min-w-0 flex-1 flex-col overflow-x-hidden max-[768px]:ml-0">
        <header className="sticky top-0 z-[5] flex items-center justify-between border-b border-[color:var(--border-1)] bg-[var(--surface-1)] px-7 py-[18px] max-[768px]:flex-wrap max-[768px]:gap-[10px] max-[768px]:px-4 max-[768px]:py-[14px]">
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-[color:var(--t1)]">
            {navItems.find((i) => pathname?.startsWith(i.href))?.label ||
              "Dashboard"}
          </span>
          <div className="flex items-center gap-[10px] rounded-[8px] border border-[color:var(--border-1)] bg-[var(--surface-2)] py-[6px] pl-2 pr-[14px]">
            <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[8px] bg-[var(--accent)] text-[13px] font-bold text-[#003827]">
              A
            </div>
            <span className="text-[13px] font-semibold text-[color:var(--t1,#1a1a1a)]">
              Admin
            </span>
          </div>
        </header>
        <div className="min-w-0 flex-1 overflow-x-hidden p-7 max-[768px]:p-4">
          {children}
        </div>
      </div>
    </div>
  );
}
