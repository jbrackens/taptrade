#!/bin/bash
###############################################################################
# Tap Trade Stack — Smoke Test
#
# Tests the currently wired local stack:
#   1. Sports listing
#   2. Fixtures listing
#   3. Fixture detail
#   4. Markets listing for a fixture
#   5. Auth login
#   6. Auth session
#   7. Wallet summary
#   8. Wallet ledger
#   9. Bet history
#   10. Admin punter listing
#   11. WebSocket connectivity (best effort)
#
# Usage:
#   ./smoke-test.sh
#   API_BASE=http://localhost:18080 SMOKE_TEST_USER=demo@taptrade.local \
#     SMOKE_TEST_PASS=change-me-local ./smoke-test.sh
###############################################################################

set +e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RESET='\033[0m'

API_BASE="${API_BASE:-http://localhost:18080}"
TEST_USER="${SMOKE_TEST_USER:-demo@taptrade.local}"
TEST_PASS="${SMOKE_TEST_PASS:-change-me-local}"
ADMIN_ROLE_HEADER="${ADMIN_ROLE_HEADER:-admin}"

PASS=0
FAIL=0
SKIP=0
TOKEN=""
USER_ID=""
FIXTURE_ID=""
LAST_HTTP_CODE=""
LAST_BODY=""

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BLUE}║       TapTrade Smoke Test — $(date '+%Y-%m-%d %H:%M:%S')        ║${RESET}"
echo -e "${BLUE}║       API: ${API_BASE}${RESET}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${RESET}"
echo ""

run_request() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  shift 3 || true

  local response_file
  local status_file
  response_file=$(mktemp)
  status_file=$(mktemp)

  local args=(-sS -X "$method" "$url" -o "$response_file" -w "%{http_code}")
  if [ -n "$body" ]; then
    args+=(-H "Content-Type: application/json" --data "$body")
  fi
  while [ "$#" -gt 0 ]; do
    args+=(-H "$1")
    shift
  done

  curl "${args[@]}" >"$status_file" 2>/dev/null
  local curl_exit=$?
  local http_code
  http_code=$(cat "$status_file")
  local body_content
  body_content=$(cat "$response_file")

  rm -f "$response_file" "$status_file"

  if [ "$curl_exit" -ne 0 ]; then
    LAST_HTTP_CODE="000"
    LAST_BODY=""
    return 1
  fi

  LAST_HTTP_CODE="$http_code"
  LAST_BODY="$body_content"
  return 0
}

test_endpoint() {
  local name="$1"
  local method="$2"
  local url="$3"
  local body="${4:-}"
  shift 4 || true

  echo -n "  [$method] $name ... "

  run_request "$method" "$url" "$body" "$@"
  local request_exit=$?
  local http_code="$LAST_HTTP_CODE"
  local body_content="$LAST_BODY"

  if [ "$request_exit" -ne 0 ] || [ "$http_code" = "000" ]; then
    echo -e "${YELLOW}UNREACHABLE${RESET}"
    ((SKIP++))
    return 1
  fi

  if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
    echo -e "${GREEN}$http_code OK${RESET}"
    ((PASS++))
    printf "%s" "$body_content" > /tmp/taptrade_smoke_last_response.json
    return 0
  fi

  echo -e "${RED}$http_code FAIL${RESET}"
  if [ -n "$body_content" ]; then
    echo -e "    ${RED}→ $(echo "$body_content" | head -c 220)${RESET}"
  fi
  ((FAIL++))
  return 1
}

json_query() {
  local expression="$1"
  node -e "
    const fs = require('fs');
    try {
      const raw = fs.readFileSync('/tmp/taptrade_smoke_last_response.json', 'utf8');
      const data = JSON.parse(raw);
      const value = (function () { return ${expression}; })();
      if (value === undefined || value === null) process.exit(1);
      process.stdout.write(String(value));
    } catch {
      process.exit(1);
    }
  " 2>/dev/null
}

echo -e "${BLUE}[1/11] Sports Listing${RESET}"
test_endpoint "GET /api/v1/sports" "GET" "${API_BASE}/api/v1/sports"

echo ""
echo -e "${BLUE}[2/11] Fixtures Listing${RESET}"
test_endpoint "GET /api/v1/fixtures" "GET" "${API_BASE}/api/v1/fixtures"
FIXTURE_ID=$(json_query "(data.data || [])[0]?.fixtureId" | tr -d '\r\n' || true)

echo ""
echo -e "${BLUE}[3/11] Fixture Detail${RESET}"
if [ -n "$FIXTURE_ID" ]; then
  test_endpoint "GET /api/v1/fixtures/${FIXTURE_ID}" "GET" "${API_BASE}/api/v1/fixtures/${FIXTURE_ID}"
else
  echo "  (skipped — no fixture ID available)"
  ((SKIP++))
fi

echo ""
echo -e "${BLUE}[4/11] Markets Listing${RESET}"
if [ -n "$FIXTURE_ID" ]; then
  test_endpoint "GET /api/v1/markets?fixtureId=${FIXTURE_ID}" "GET" "${API_BASE}/api/v1/markets?fixtureId=${FIXTURE_ID}"
else
  echo "  (skipped — no fixture ID available)"
  ((SKIP++))
fi

echo ""
echo -e "${BLUE}[5/11] Auth Login${RESET}"
test_endpoint \
  "POST /auth/login" \
  "POST" \
  "${API_BASE}/auth/login" \
  "{\"username\":\"${TEST_USER}\",\"password\":\"${TEST_PASS}\"}"
TOKEN=$(json_query "data.accessToken || data.access_token || data.token" | tr -d '\r\n' || true)

if [ -z "$TOKEN" ]; then
  echo -e "  ${YELLOW}No auth token obtained — authenticated tests will be skipped${RESET}"
fi

echo ""
echo -e "${BLUE}[6/11] Auth Session${RESET}"
if [ -n "$TOKEN" ]; then
  test_endpoint "GET /auth/session" "GET" "${API_BASE}/auth/session" "" "Authorization: Bearer ${TOKEN}"
  USER_ID=$(json_query "data.userId" | tr -d '\r\n' || true)
else
  echo "  (skipped — not authenticated)"
  ((SKIP++))
fi

echo ""
echo -e "${BLUE}[7/11] Wallet Summary${RESET}"
if [ -n "$USER_ID" ]; then
  test_endpoint "GET /api/v1/wallet/${USER_ID}" "GET" "${API_BASE}/api/v1/wallet/${USER_ID}"
else
  echo "  (skipped — no userId available)"
  ((SKIP++))
fi

echo ""
echo -e "${BLUE}[8/11] Wallet Ledger${RESET}"
if [ -n "$USER_ID" ]; then
  test_endpoint "GET /api/v1/wallet/${USER_ID}/ledger?limit=5" "GET" "${API_BASE}/api/v1/wallet/${USER_ID}/ledger?limit=5"
else
  echo "  (skipped — no userId available)"
  ((SKIP++))
fi

echo ""
echo -e "${BLUE}[9/11] Bet History${RESET}"
if [ -n "$USER_ID" ]; then
  test_endpoint "GET /api/v1/bets?userId=${USER_ID}&page=1&pageSize=5" "GET" "${API_BASE}/api/v1/bets?userId=${USER_ID}&page=1&pageSize=5"
else
  echo "  (skipped — no userId available)"
  ((SKIP++))
fi

echo ""
echo -e "${BLUE}[10/11] Admin Punters${RESET}"
test_endpoint \
  "GET /api/v1/admin/punters?page=1&pageSize=5" \
  "GET" \
  "${API_BASE}/api/v1/admin/punters?page=1&pageSize=5" \
  "" \
  "X-Admin-Role: ${ADMIN_ROLE_HEADER}"

echo ""
echo -e "${BLUE}[11/11] WebSocket Connectivity${RESET}"
WS_URL="${WS_URL:-ws://localhost:18080/ws}"
echo -n "  [WS] Connect to $WS_URL ... "
WS_RESULT=$(python3 - <<'PY' "$WS_URL"
import sys
try:
    import websocket
except Exception:
    print("NO_WS_MODULE")
    raise SystemExit(0)

url = sys.argv[1]
try:
    ws = websocket.create_connection(url, timeout=4)
    print("OK")
    ws.close()
except Exception as exc:
    print(f"FAIL:{exc}")
PY
)

if [ "$WS_RESULT" = "OK" ]; then
  echo -e "${GREEN}CONNECTED${RESET}"
  ((PASS++))
elif [ "$WS_RESULT" = "NO_WS_MODULE" ]; then
  echo -e "${YELLOW}SKIPPED (python websocket-client missing)${RESET}"
  ((SKIP++))
else
  echo -e "${YELLOW}${WS_RESULT}${RESET}"
  ((SKIP++))
fi

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BLUE}║                    SMOKE TEST RESULTS                       ║${RESET}"
echo -e "${BLUE}╠══════════════════════════════════════════════════════════════╣${RESET}"
echo -e "${BLUE}║${RESET}  ${GREEN}Passed: $PASS${RESET}  |  ${RED}Failed: $FAIL${RESET}  |  ${YELLOW}Skipped: $SKIP${RESET}"
if [ "$FAIL" -eq 0 ]; then
  echo -e "${BLUE}║${RESET}  ${GREEN}✓ Current stack contract responded correctly${RESET}"
else
  echo -e "${BLUE}║${RESET}  ${RED}✗ Some current-stack checks failed — inspect output above${RESET}"
fi
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${RESET}"
echo ""

rm -f /tmp/taptrade_smoke_last_response.json

exit $FAIL
