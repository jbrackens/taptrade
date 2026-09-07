# Root convenience targets.
#
# Day-to-day dev targets (seed, demo-data, wipe-demo, migrate-*) live in the
# gateway Makefile:
#   apps/taptrade-platform/go-platform/services/gateway/Makefile
#
# The old apps/taptrade-platform/Makefile was removed in the 2026-09 cleanup.
# Its 66 targets drove the Phoenix-era revival trees (JVM baselines, preservation
# gates, sportsbook smoke), which that same cleanup deleted. Historical note only:
# none of those trees or targets are tracked in this repo today.

.PHONY: cashier-check
cashier-check: ## Validate the dormant real-money trees still build and stay unmounted
	scripts/check-cashier-all.sh
