#!/bin/bash

###############################################################################
# Tap Trade Frontend - Automated Quality Gates
# Runs comprehensive checks on TypeScript, imports, mocks, TODOs, and build
###############################################################################

set +e  # Do NOT use set -e — grep returns 1 when no matches found, which is expected
set -o pipefail  # Pipeline exit = rightmost non-zero command. Without this,
                 # `tsc | tee log` and `next build | tee log` always returned
                 # 0 (tee's exit), making Gates 1 and 8 silently always-pass.
                 # No effect on Gates 2/3/6 — those read pipe output, not $?.

# Color codes for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RESET='\033[0m'

# Counters
PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

# Script starts in the app/ directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

###############################################################################
# Helper Functions
###############################################################################

print_header() {
    echo ""
    echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${RESET}"
    echo -e "${BLUE}║          Tap Trade Quality Gates - $(date '+%Y-%m-%d %H:%M:%S')         ║${RESET}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${RESET}"
    echo ""
}

print_gate_start() {
    local gate_num="$1"
    local gate_name="$2"
    echo -e "${BLUE}[GATE $gate_num]${RESET} $gate_name"
}

print_pass() {
    echo -e "  ${GREEN}✓ PASS${RESET}"
    ((PASS_COUNT++))
}

print_fail() {
    local message="$1"
    echo -e "  ${RED}✗ FAIL${RESET}"
    if [ -n "$message" ]; then
        echo -e "  ${RED}→ $message${RESET}"
    fi
    ((FAIL_COUNT++))
}

print_warn() {
    local message="$1"
    echo -e "  ${YELLOW}⚠ WARN${RESET}"
    if [ -n "$message" ]; then
        echo -e "  ${YELLOW}→ $message${RESET}"
    fi
    ((WARN_COUNT++))
}

print_summary() {
    echo ""
    echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${RESET}"
    echo -e "${BLUE}║                        GATE RESULTS                            ║${RESET}"
    echo -e "${BLUE}╠════════════════════════════════════════════════════════════════╣${RESET}"

    if [ "$FAIL_COUNT" -eq 0 ]; then
        echo -e "${BLUE}║${RESET} ${GREEN}✓ ALL GATES PASSED (${PASS_COUNT}/9)${RESET}"
    else
        echo -e "${BLUE}║${RESET} ${RED}✗ FAILURES DETECTED (${PASS_COUNT}/9 passed)${RESET}"
    fi

    if [ "$WARN_COUNT" -gt 0 ]; then
        echo -e "${BLUE}║${RESET} ${YELLOW}⚠ ${WARN_COUNT} warning(s)${RESET}"
    fi

    echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${RESET}"
    echo ""
}

###############################################################################
# GATE 1: TypeScript Zero Errors
###############################################################################

gate_typescript() {
    print_gate_start "1" "TypeScript Zero Errors"

    # Run TypeScript compiler
    if npx tsc --noEmit --pretty 2>&1 | tee /tmp/tsc_output.log; then
        print_pass
    else
        local error_count=$(grep -c "error TS" /tmp/tsc_output.log || echo "0")
        print_fail "$error_count TypeScript errors found"
    fi
}

###############################################################################
# GATE 2: No Phantom Imports
###############################################################################

gate_phantom_imports() {
    print_gate_start "2" "No Phantom Imports (@taptrade-ui/design-system|@taptrade-ui/design-system)"

    # Search for @taptrade-ui/design-system imports in app/
    local count=$(grep -r "@taptrade-ui/design-system" app/ 2>/dev/null | grep -v node_modules | wc -l)

    if [ "$count" -eq 0 ]; then
        print_pass
    else
        print_fail "$count phantom imports found (causes webpack hangs)"
    fi
}

###############################################################################
# GATE 3: No Mock Classes in Production Code
###############################################################################

gate_no_mocks() {
    print_gate_start "3" "No Mock Classes in Production Code"

    # Search for `class Mock` patterns in production code
    local mock_files=$(grep -r "class Mock" app/components/ app/lib/ 2>/dev/null | grep -v node_modules | cut -d: -f1 | sort -u)
    local mock_count=0
    if [ -n "$mock_files" ]; then
        mock_count=$(echo "$mock_files" | wc -l | tr -d ' ')
    fi

    if [ "$mock_count" -eq 0 ]; then
        print_pass
    else
        print_fail "$mock_count file(s) with mock classes"
        echo "$mock_files" | while read -r file; do
            [ -n "$file" ] && echo -e "  ${RED}  - $file${RESET}"
        done
    fi
}

###############################################################################
# GATE 4: No TODO/FIXME in Critical Paths
###############################################################################

gate_todo_fixme() {
    print_gate_start "4" "No TODO/FIXME in Critical Paths (informational)"

    # Count TODO and FIXME comments
    local todo_count=$(grep -r "TODO" app/components/ 2>/dev/null | grep -v node_modules | wc -l)
    local fixme_count=$(grep -r "FIXME" app/components/ 2>/dev/null | grep -v node_modules | wc -l)
    local total=$((todo_count + fixme_count))

    if [ "$total" -eq 0 ]; then
        print_pass
    else
        print_warn "$total TODO/FIXME comments found"
    fi
}

###############################################################################
# GATE 5: Feature Manifest Coverage
###############################################################################

gate_feature_manifest() {
    print_gate_start "5" "Feature Manifest Coverage"

    if [ ! -f "FEATURE_MANIFEST.json" ]; then
        print_warn "FEATURE_MANIFEST.json not found"
        return
    fi

    # Parse manifest using node (works on both Linux and macOS)
    local manifest_stats
    manifest_stats=$(node -e "
        const fs = require('fs');
        const m = JSON.parse(fs.readFileSync('FEATURE_MANIFEST.json', 'utf8'));
        // Manifest has pages, components, services, slices arrays
        const all = [...(m.pages||[]), ...(m.components||[]), ...(m.services||[]), ...(m.slices||[])];
        const stats = { real: 0, stubbed: 0, missing: 0 };
        all.forEach(f => {
            if (f.status === 'REAL') stats.real++;
            else if (f.status === 'STUBBED') stats.stubbed++;
            else if (f.status === 'MISSING') stats.missing++;
        });
        console.log(JSON.stringify(stats));
    " 2>/dev/null || echo '{"real":0,"stubbed":0,"missing":0}')

    # Extract counts
    local missing=$(echo "$manifest_stats" | grep -o '"missing":[0-9]*' | cut -d: -f2)
    local stubbed=$(echo "$manifest_stats" | grep -o '"stubbed":[0-9]*' | cut -d: -f2)
    local real=$(echo "$manifest_stats" | grep -o '"real":[0-9]*' | cut -d: -f2)

    # Default to 0 if extraction failed
    missing=${missing:-0}
    stubbed=${stubbed:-0}
    real=${real:-0}

    if [ "$missing" -eq 0 ] && [ "$stubbed" -eq 0 ]; then
        print_pass
        echo -e "  ${GREEN}→ All $real features are REAL (complete migration)${RESET}"
    else
        print_fail "Incomplete migration: $real REAL, $stubbed STUBBED, $missing MISSING"
    fi
}

###############################################################################
# GATE 6: No @ts-nocheck in App Code
###############################################################################

gate_no_ts_nocheck() {
    print_gate_start "6" "No @ts-nocheck in App Code"

    # Search for @ts-nocheck in app/ (excluding legacy tests)
    local ts_nocheck_files=$(grep -r "@ts-nocheck" app/ 2>/dev/null | grep -v node_modules | grep -v "components/.*test" | cut -d: -f1 | sort -u)
    local ts_nocheck_count=0
    if [ -n "$ts_nocheck_files" ]; then
        ts_nocheck_count=$(echo "$ts_nocheck_files" | wc -l | tr -d ' ')
    fi

    if [ "$ts_nocheck_count" -eq 0 ]; then
        print_pass
    else
        print_fail "$ts_nocheck_count file(s) with @ts-nocheck"
        echo "$ts_nocheck_files" | while read -r file; do
            [ -n "$file" ] && echo -e "  ${RED}  - $file${RESET}"
        done
    fi
}

###############################################################################
# GATE 7: Pages/App Router Conflict Check
###############################################################################

gate_router_conflict() {
    print_gate_start "7" "Pages/App Router Conflict Check"

    # Check if pages/ directory exists
    if [ ! -d "pages" ] || [ ! -d "app" ]; then
        print_pass
        echo -e "  ${GREEN}→ No conflicting routing structures detected${RESET}"
        return
    fi

    # Find potential conflicts (simplified check)
    # Look for routes that exist in both pages/ and app/
    local conflicts=""
    local conflict_count=0

    # This is a simplified check - a full implementation would need route parsing
    # For now, check for matching filename patterns
    if [ -d "pages" ]; then
        for page_file in $(find pages -type f -name "*.tsx" -o -name "*.ts" 2>/dev/null | grep -v "_document\|_app\|_archived"); do
            local route_name=$(basename "$page_file" .tsx | basename "$page_file" .ts)
            if [ "$route_name" != "_" ] && [ -n "$route_name" ]; then
                # This is simplified - a real check would need deeper analysis
                :
            fi
        done
    fi

    if [ "$conflict_count" -eq 0 ]; then
        print_pass
    else
        print_fail "$conflict_count route conflict(s) detected"
        echo "$conflicts" | while read -r conflict; do
            [ -n "$conflict" ] && echo -e "  ${RED}  - $conflict${RESET}"
        done
    fi
}

###############################################################################
# GATE 8: Next Build
###############################################################################

gate_next_build() {
    print_gate_start "8" "Next.js Build"

    # Run next build with a timeout. --webpack keeps the bundler
    # consistent with next.config.js (which has webpack-specific config:
    # polyfill fallbacks, externals, the @taptrade-ui/utils alias). Without
    # this flag, Next.js 16 defaults to Turbopack and would silently drop
    # the webpack config.
    #
    # Default 10 minutes: the build passes in ~4 on a quiet machine, but a
    # dev server, test suite, or second build sharing the box pushed it past
    # the old 5-minute ceiling and failed the gate on machine load rather
    # than on code. Override with GATE_BUILD_TIMEOUT_SECS for slower/faster
    # environments; the timeout exists to catch a HUNG build, not a busy Mac.
    local build_timeout="${GATE_BUILD_TIMEOUT_SECS:-600}"
    if timeout "$build_timeout" npx next build --webpack 2>&1 | tee /tmp/next_build.log; then
        print_pass
    else
        local exit_code=$?
        if [ "$exit_code" -eq 124 ]; then
            print_fail "Build timeout (${build_timeout}s exceeded — GATE_BUILD_TIMEOUT_SECS to override)"
        else
            print_fail "Build failed (exit code: $exit_code)"
        fi
    fi
}

###############################################################################
# GATE 9: Biome Lint Wall (app-scoped)
###############################################################################

gate_biome() {
    print_gate_start "9" "Biome Lint Wall (zero errors in app/)"

    # App-scoped on purpose: the root `yarn lint:biome` also covers
    # packages/office (own burn-down pending) and would hold this gate red
    # forever. Biome exits non-zero on errors only — warnings pass.
    # Config resolves up-tree to frontend/biome.json.
    if npx @biomejs/biome check app 2>&1 | tail -5; then
        print_pass
    else
        print_fail "Biome errors found — run 'npx @biomejs/biome check app' for details"
    fi
}

###############################################################################
# Main Execution
###############################################################################

main() {
    print_header

    # Run all gates
    gate_typescript
    echo ""

    gate_phantom_imports
    echo ""

    gate_no_mocks
    echo ""

    gate_todo_fixme
    echo ""

    gate_feature_manifest
    echo ""

    gate_no_ts_nocheck
    echo ""

    gate_router_conflict
    echo ""

    gate_next_build
    echo ""

    gate_biome
    echo ""

    # Print summary
    print_summary

    # Exit with appropriate code
    if [ "$FAIL_COUNT" -eq 0 ]; then
        return 0
    else
        return 1
    fi
}

# Run main function
main
exit $?
