import { MenuItem, MenuItemGroupEnum, MenuItemGroupedIcons } from "types/menu";
import { DashboardOutlined, ReconciliationOutlined } from "@ant-design/icons";
import { PunterRoleEnum } from "@taptrade-ui/utils";
import defaultMenuStructure from "./structure";
import { MenuModulesPathEnum } from "./structure";

const OfficeRole = {
  ADMIN: PunterRoleEnum.ADMIN,
  TRADER: PunterRoleEnum.TRADER,
  OPERATOR: PunterRoleEnum.OPERATOR,
} as const;

// Pages Router top-nav menu items.
//
// Pruned 2026-05-03: removed USERS (admin/punters endpoint not wired
// for predict — page errors on every visit) and the entire
// RISK_MANAGEMENT submenu (retired pre-Tap Trade operations pages already
// redirected to /dashboard via next.config.js redirects()). The
// PREDICTION risk leaf was the only useful entry under RISK_MANAGEMENT
// but PR #48 (feat/risk-dashboard-v1) supersedes it with a proper
// /prediction-admin/risk dashboard.
//
// What's left: TERMS_AND_CONDITIONS (static page). The MenuModulesPathEnum
// keeps USERS and RISK_MANAGEMENT for backwards compatibility with legacy
// components that still reference them for path generation.
export const defaultMenuItems: MenuItem[] = [
  {
    key: "terms-and-conditions",
    path: defaultMenuStructure
      .get(MenuModulesPathEnum.TERMS_AND_CONDITIONS)
      .path(),
    label: "TERMS_AND_CONDITIONS",
    roles: [OfficeRole.ADMIN, OfficeRole.OPERATOR],
  },
];

export const defaultGroupIcons: MenuItemGroupedIcons = {
  [MenuItemGroupEnum.DASHBOARD]: DashboardOutlined,
  [MenuItemGroupEnum.TRADING]: ReconciliationOutlined,
};
