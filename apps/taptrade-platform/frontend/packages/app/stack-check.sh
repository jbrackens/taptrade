#!/bin/bash
###############################################################################
# Tap Trade — Full Stack Health Check
#
# Verifies all backend services are reachable before QA or testing.
# Exit 0 = all services up. Exit 1 = one or more down.
#
# Usage:
#   ./stack-check.sh          # Check all services
#   ./stack-check.sh --quick  # Check gateway + auth only (skip infra)
###############################################################################

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RESET='\033[0m'

UP_COUNT=0
DOWN_COUNT=0
QUICK_MODE=false

[ "$1" = "--quick" ] && QUICK_MODE=true

check_http() {
  local name="$1"
  local url="$2"
  local response
  response=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 "$url" 2>/dev/null)
  if [ "$response" -ge 200 ] && [ "$response" -lt 500 ] 2>/dev/null; then
    echo -e "  ${GREEN}✓${RESET} $name — ${GREEN}UP${RESET} (HTTP $response)"
    ((UP_COUNT++))
    return 0
  else
    echo -e "  ${RED}✗${RESET} $name — ${RED}DOWN${RESET} (${response:-no response})"
    ((DOWN_COUNT++))
    return 1
  fi
}

check_tcp() {
  local name="$1"
  local host="$2"
  local port="$3"
  if nc -z -w 3 "$host" "$port" 2>/dev/null; then
    echo -e "  ${GREEN}✓${RESET} $name — ${GREEN}UP${RESET} (port $port open)"
    ((UP_COUNT++))
    return 0
  else
    echo -e "  ${RED}✗${RESET} $name — ${RED}DOWN${RESET} (port $port closed)"
    ((DOWN_COUNT++))
    return 1
  fi
}

echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BLUE}║           Stack Health Check — $(date '+%Y-%m-%d %H:%M:%S')            ║${RESET}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${RESET}"
echo ""

echo -e "${BLUE}[Services]${RESET}"
check_http "Go Gateway        (18080)" "http://localhost:18080/healthz"
GATEWAY_UP=$?
check_http "Auth Service       (18081)" "http://localhost:18081/healthz"
AUTH_UP=$?

if [ "$QUICK_MODE" = false ]; then
  echo ""
  echo -e "${BLUE}[Infrastructure]${RESET}"
  check_tcp  "PostgreSQL         (5432)"  "localhost" "5432"
  check_tcp  "Redis              (6379)"  "localhost" "6379"
fi

echo ""
echo -e "${BLUE}[Frontend]${RESET}"
check_http "Next.js Dev Server (3000)"  "http://localhost:3000"

# Summary
echo ""
echo -e "${BLUE}────────────────────────────────────────${RESET}"
TOTAL=$((UP_COUNT + DOWN_COUNT))
if [ "$DOWN_COUNT" -eq 0 ]; then
  echo -e "${GREEN}✓ All $TOTAL services UP${RESET}"
  echo ""
  exit 0
else
  echo -e "${RED}✗ $DOWN_COUNT/$TOTAL services DOWN${RESET}"
  echo ""

  # Actionable hints
  if [ "$GATEWAY_UP" -ne 0 ]; then
    echo -e "${YELLOW}  → Start gateway:  cd go-platform && go run ./services/gateway/cmd/gateway${RESET}"
  fi
  if [ "$AUTH_UP" -ne 0 ]; then
    echo -e "${YELLOW}  → Start auth:     cd go-platform && AUTH_COOKIE_SECURE=false go run ./services/auth/cmd/auth${RESET}"
  fi
  if [ "$QUICK_MODE" = false ]; then
    echo -e "${YELLOW}  → Start infra:    docker compose up -d postgres redis${RESET}"
  fi
  echo ""
  exit 1
fi
