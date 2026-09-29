# 2026-09-29 documentation consolidation

These documents were retired when `docs/` became the single source of truth
(see [the documentation map](../../README.md)). Each file starts with a banner
saying what replaced it. They are kept for their history and reasoning, not as
descriptions of the current system.

| File | Formerly | Replaced by |
|---|---|---|
| `CURRENT_STATE.md` | root `CURRENT_STATE.md` | [SPEC_CURRENT.md](../../SPEC_CURRENT.md) (what is live and what is off) and [TASKS.md](../../TASKS.md) (open items and parked decisions) |
| `PRODUCT-USER-JOURNEYS.md` | root `PRODUCT-USER-JOURNEYS.md` | [SPEC_CURRENT.md](../../SPEC_CURRENT.md) for the flows that exist. This was persona research written for a cent-priced, cash-deposit product with a crypto category; none of that is the current product |
| `DEMO_DEPLOYMENT.md` | `docs/DEMO_DEPLOYMENT.md` | [DEPLOYMENT.md](../../DEPLOYMENT.md) |
| `licensability-gaps.md` | `docs/licensability-gaps.md` | [TECH_DEBT.md](../../TECH_DEBT.md) (TD-005, TD-006, TD-007, TD-013 – TD-016), which re-verified each gap on 2026-09-29 |
| `PLATFORM-ARCHITECTURE.md` | `apps/taptrade-platform/ARCHITECTURE.md` | [ARCHITECTURE.md](../../ARCHITECTURE.md) |
| `PLATFORM-DEVELOPMENT.md` | `apps/taptrade-platform/DEVELOPMENT.md` | [ENVIRONMENT.md](../../ENVIRONMENT.md) |
| `FRONTEND-PHASE_A_COMPLETE.md` | `apps/taptrade-platform/frontend/PHASE_A_COMPLETE.md` | nothing — a 2026-04-02 completion note from before the prediction-market migration |
| `FRONTEND-E2E_TEST_SUITE_SUMMARY.md` | `apps/taptrade-platform/frontend/E2E_TEST_SUITE_SUMMARY.md` | [ENVIRONMENT.md](../../ENVIRONMENT.md#4-commands) for the current test suites |
| `FRONTEND-E2E-README.md` | `apps/taptrade-platform/frontend/e2e/README.md` | [ENVIRONMENT.md](../../ENVIRONMENT.md#4-commands); the live suite is `frontend/e2e/prediction/` run by `playwright.prediction.config.ts` |
| `OFFICE-COMPONENTS.md` | `office/app/COMPONENTS.md` | nothing — already a retired pointer |
| `OFFICE-IMPLEMENTATION_SUMMARY.md` | `office/app/IMPLEMENTATION_SUMMARY.md` | nothing — already a retired pointer |
| `OFFICE-INTEGRATION_GUIDE.md` | `office/app/INTEGRATION_GUIDE.md` | nothing — already a retired pointer |
