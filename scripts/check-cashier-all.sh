#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$ROOT/scripts/check-cashier-guards.sh"
node "$ROOT/scripts/check-cashier-schema.mjs"
node "$ROOT/scripts/check-cashier-sql-artifacts.mjs"
node "$ROOT/scripts/check-cashier-observability.mjs"
node "$ROOT/scripts/check-cashier-openapi.mjs"
node "$ROOT/scripts/check-cashier-doc-links.mjs"
node "$ROOT/scripts/check-cashier-contracts.mjs"
node "$ROOT/scripts/check-cashier-provider-scenarios.mjs"
node "$ROOT/scripts/check-cashier-launch-readiness.mjs"
"$ROOT/scripts/check-cashier-frontend-types.sh"

(cd "$ROOT/apps/taptrade-platform/go-platform/services/gateway" && go test ./cmd/gateway ./internal/payments ./internal/webhookauth)

node --test "$ROOT/services/cashier-api/test/"*.test.mjs

PATH="$ROOT/apps/taptrade-platform/frontend/node_modules/.bin:$PATH" \
  npm --prefix "$ROOT/packages/cashier-sdk" test

PATH="$ROOT/apps/taptrade-platform/frontend/node_modules/.bin:$PATH" \
  npm --prefix "$ROOT/packages/cashier-sdk" run build >/dev/null
node "$ROOT/scripts/check-cashier-service-stubs.mjs"
node "$ROOT/scripts/replay-cashier-mock-e2e.mjs" >/dev/null
rm -rf "$ROOT/packages/cashier-sdk/.tmp-test-dist"

echo "cashier checks passed"
