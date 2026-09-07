#!/usr/bin/env bash
# Tap Trade — Unit Test Runner
# Uses Node.js built-in test runner (node:test) with tsx for TS support.
# Zero additional dependencies beyond tsx (which ships with the project).
#
# Usage: bash run-tests.sh

set -euo pipefail

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║           TapTrade Unit Tests — $(date '+%Y-%m-%d %H:%M:%S')          ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_DIR="$SCRIPT_DIR/app/__tests__"
PASS=0
FAIL=0

# Check for tsx (TypeScript executor)
if ! command -v npx &>/dev/null; then
  echo "ERROR: npx not found. Install Node.js 18+ first."
  exit 1
fi

# Run from /tmp to avoid workspace resolution issues with frontend
for test_file in "$TEST_DIR"/*.test.ts; do
  test_name="$(basename "$test_file")"
  echo "▸ Running $test_name ..."
  if (cd /tmp && npx tsx --test "$test_file") 2>&1; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    echo "  ✗ FAILED: $test_name"
  fi
  echo ""
done

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  Results: $PASS passed, $FAIL failed                              ║"
echo "╚════════════════════════════════════════════════════════════════╝"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
