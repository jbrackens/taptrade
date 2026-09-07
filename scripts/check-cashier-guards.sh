#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT/apps/taptrade-platform/frontend/packages/app/app"
NONCUSTODIAL_CLIENT="$APP_DIR/lib/api/noncustodial-cashier-client.ts"
GATEWAY_DIR="$ROOT/apps/taptrade-platform/go-platform/services/gateway"
FRONTEND_CASHIER_PATHS=("$APP_DIR/lib/api")
[ -d "$APP_DIR/cashier" ] && FRONTEND_CASHIER_PATHS+=("$APP_DIR/cashier")

if rg -n "getCryptoDepositAddress|DEPOSIT_ADDRESS_PATH" "$APP_DIR"; then
  echo "legacy crypto deposit-address client helper is exposed in the frontend"
  exit 1
fi

if rg -n '"/api/v1/payments/crypto/deposit-address"' "${FRONTEND_CASHIER_PATHS[@]}"; then
  echo "legacy crypto deposit-address endpoint is called from user-facing frontend code"
  exit 1
fi

if [ -f "$NONCUSTODIAL_CLIENT" ]; then
  if ! rg -n '"/v1/cashier/' "$NONCUSTODIAL_CLIENT" >/dev/null; then
    echo "non-custodial cashier client must target /v1/cashier"
    exit 1
  fi

  if rg -n '"/api/v1/payments' "$NONCUSTODIAL_CLIENT"; then
    echo "non-custodial cashier client must not call legacy payments endpoints"
    exit 1
  fi

  if ! rg -n '"Idempotency-Key"' "$NONCUSTODIAL_CLIENT" >/dev/null; then
    echo "non-custodial cashier mutations must send Idempotency-Key headers"
    exit 1
  fi
else
  echo "non-custodial cashier frontend client absent; Tap Trade launch has no user-facing cashier"
fi

for key in CRYPTO_RPC_URL CRYPTO_ASSET_CONTRACT CRYPTO_DEPOSIT_ADDRESS_SOURCE; do
  if ! rg -n "$key" "$GATEWAY_DIR/cmd/gateway/main.go" >/dev/null; then
    echo "production runtime guard does not mention $key"
    exit 1
  fi
  if ! rg -n "$key" "$GATEWAY_DIR/cmd/gateway/main_test.go" >/dev/null; then
    echo "production runtime guard test does not cover $key"
    exit 1
  fi
done

if ! rg -n '"/v1/provider-callbacks/"' "$GATEWAY_DIR/cmd/gateway/main.go" >/dev/null; then
  echo "gateway must expose signed non-custodial provider callback prefix outside session auth"
  exit 1
fi

if ! rg -n "TestCashierProviderCallbackBypassesAuthAndCSRFOnlyWhenLegacyMoneyRoutesOptIn" "$GATEWAY_DIR/cmd/gateway/main_test.go" >/dev/null; then
  echo "gateway auth/csrf bypass test must cover non-custodial provider callbacks"
  exit 1
fi

echo "cashier guard checks passed"
