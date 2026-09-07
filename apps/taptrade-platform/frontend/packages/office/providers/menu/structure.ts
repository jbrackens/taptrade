import { initMenuBuilder } from "./utils/builder";

// Pages Router top-nav menu structure.
//
// The MenuModulesPathEnum members are kept for backwards compatibility:
// retired pre-Tap Trade Pages Router components still reference
// RISK_MANAGEMENT for path generation. Removing the enum members would
// break those imports. The defaultMenuStructure builder, however, no
// longer registers them, so they don't appear in the rendered top nav.
//
// Pruned 2026-05-03: dropped USERS and RISK_MANAGEMENT from the
// rendered nav. USERS' backing endpoint isn't wired for predict.
// RISK_MANAGEMENT is the retired pre-Tap Trade operations subtree and is
// already redirected to /dashboard in next.config.js redirects(); leaving
// it in the nav would advertise destinations that bounce away on click.
//
// The full Pages Router → App Router shell unification is tracked
// as a multi-day follow-up; this is the surgical interim.
export enum MenuModulesPathEnum {
  USERS = "users",
  RISK_MANAGEMENT = "risk-management",
  LOGS = "logs",
  TERMS_AND_CONDITIONS = "terms-and-conditions",
  ACCOUNT = "account",
}

const defaultMenuStructure = initMenuBuilder().set(
  MenuModulesPathEnum.TERMS_AND_CONDITIONS,
);

export default defaultMenuStructure;
