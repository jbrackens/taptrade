#!/bin/bash

###############################################################################
# Tap Trade Office (Back-Office) - Automated Quality Gates
#
# Sibling of packages/app/gate.sh, adapted for the office package. Office is
# NOT a pages->app migration: it is a back-office forked from a sportsbook and
# partially re-pointed at the prediction domain. So "complete" here means:
#   - zero TypeScript errors (office next.config.js has ignoreBuildErrors:true,
#     so `next build` will NOT catch TS errors — `tsc` is the real gate)
#   - zero sportsbook-domain leftovers (CLAUDE.md rule #2)
#   - zero SAMPLE_/MOCK_ data in production routes
#   - FEATURE_MANIFEST.json has no STUBBED/MISSING routes
#
# The gate is intentionally RED today: office carries known sportsbook debt.
# It exists to drive that to zero and to prevent regressions, exactly like
# packages/app/gate.sh Gate 5 fails until the migration is complete.
###############################################################################

set +e            # grep returns 1 on no-match — expected, not an error
set -o pipefail   # so `tsc | tee` reflects tsc's exit, not tee's

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; RESET='\033[0m'
PASS_COUNT=0; FAIL_COUNT=0; WARN_COUNT=0
TOTAL_GATES=7

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Production source roots (exclude tests, mocks, build output, deps)
SRC_DIRS="app pages containers components lib"
GREP_EXCLUDES="--exclude-dir=node_modules --exclude-dir=.next --exclude-dir=__tests__ --exclude-dir=__mocks__"

print_header() {
    echo ""
    echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${RESET}"
    echo -e "${BLUE}║      Tap Trade Office Quality Gates - $(date '+%Y-%m-%d %H:%M:%S')   ║${RESET}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${RESET}"
    echo ""
}
print_gate_start() { echo -e "${BLUE}[GATE $1]${RESET} $2"; }
print_pass() { echo -e "  ${GREEN}✓ PASS${RESET}"; ((PASS_COUNT++)); }
print_fail() { echo -e "  ${RED}✗ FAIL${RESET}"; [ -n "$1" ] && echo -e "  ${RED}→ $1${RESET}"; ((FAIL_COUNT++)); }
print_warn() { echo -e "  ${YELLOW}⚠ WARN${RESET}"; [ -n "$1" ] && echo -e "  ${YELLOW}→ $1${RESET}"; ((WARN_COUNT++)); }

print_summary() {
    echo ""
    echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${RESET}"
    echo -e "${BLUE}║                        GATE RESULTS                            ║${RESET}"
    echo -e "${BLUE}╠════════════════════════════════════════════════════════════════╣${RESET}"
    if [ "$FAIL_COUNT" -eq 0 ]; then
        echo -e "${BLUE}║${RESET} ${GREEN}✓ ALL GATES PASSED (${PASS_COUNT}/${TOTAL_GATES})${RESET}"
    else
        echo -e "${BLUE}║${RESET} ${RED}✗ FAILURES DETECTED (${PASS_COUNT}/${TOTAL_GATES} passed)${RESET}"
    fi
    [ "$WARN_COUNT" -gt 0 ] && echo -e "${BLUE}║${RESET} ${YELLOW}⚠ ${WARN_COUNT} warning(s)${RESET}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${RESET}"
    echo ""
}

###############################################################################
# GATE 1: TypeScript Zero Errors (the real gate — build ignores TS)
###############################################################################
gate_typescript() {
    print_gate_start "1" "TypeScript Zero Errors (next.config ignoreBuildErrors:true → tsc is authoritative)"
    if npx tsc --noEmit --pretty 2>&1 | tee /tmp/office_tsc.log; then
        print_pass
    else
        local n=$(grep -c "error TS" /tmp/office_tsc.log 2>/dev/null || echo "?")
        print_fail "$n TypeScript error(s) — next build will NOT catch these"
    fi
}

###############################################################################
# GATE 2: No Sportsbook-Domain Leftovers (CLAUDE.md rule #2)
###############################################################################
gate_no_sportsbook() {
    print_gate_start "2" "No Sportsbook-Domain Code (CLAUDE.md rule #2)"
    # Whole-word-ish domain terms that must not exist in a prediction back-office.
    # 'match' excluded (too generic — String.match etc.); 'odds' word-bounded.
    local pat='fixture|betslip|punter_bets|freebet|odds_boost|match_tracker|sport_key|\bselections?\b|\bBTTS\b'
    local hits
    hits=$(grep -rEl "$pat" $SRC_DIRS $GREP_EXCLUDES 2>/dev/null | sort -u)
    local n=0
    [ -n "$hits" ] && n=$(echo "$hits" | wc -l | tr -d ' ')
    if [ "$n" -eq 0 ]; then
        print_pass
    else
        print_fail "$n file(s) with sportsbook-domain code (see FEATURE_MANIFEST.json sportsbook_leftovers_to_remove)"
        echo "$hits" | head -20 | while read -r f; do [ -n "$f" ] && echo -e "  ${RED}  - $f${RESET}"; done
        [ "$n" -gt 20 ] && echo -e "  ${RED}  … and $((n-20)) more${RESET}"
    fi
}

###############################################################################
# GATE 3: No SAMPLE_/MOCK_ Data in Production Routes
###############################################################################
gate_no_mock_data() {
    print_gate_start "3" "No SAMPLE_/MOCK_ Hardcoded Data in Production Routes"
    local hits
    hits=$(grep -rEl 'SAMPLE_[A-Z]|MOCK_[A-Z]|class Mock' app pages containers $GREP_EXCLUDES 2>/dev/null | sort -u)
    local n=0
    [ -n "$hits" ] && n=$(echo "$hits" | wc -l | tr -d ' ')
    if [ "$n" -eq 0 ]; then
        print_pass
    else
        print_fail "$n file(s) render hardcoded SAMPLE_/MOCK_ data (STUBBED, not done)"
        echo "$hits" | head -20 | while read -r f; do [ -n "$f" ] && echo -e "  ${RED}  - $f${RESET}"; done
        [ "$n" -gt 20 ] && echo -e "  ${RED}  … and $((n-20)) more${RESET}"
    fi
}

###############################################################################
# GATE 4: No Suppressed TypeScript (@ts-nocheck / @ts-ignore / as any)
###############################################################################
gate_no_ts_suppression() {
    print_gate_start "4" "No @ts-nocheck / @ts-ignore / 'as any' in Production Routes"
    local hits
    hits=$(grep -rEl '@ts-nocheck|@ts-ignore|as any\b' $SRC_DIRS $GREP_EXCLUDES 2>/dev/null | sort -u)
    local n=0
    [ -n "$hits" ] && n=$(echo "$hits" | wc -l | tr -d ' ')
    if [ "$n" -eq 0 ]; then
        print_pass
    else
        print_fail "$n file(s) suppress TypeScript (CLAUDE.md: fix the types, don't suppress)"
        echo "$hits" | head -20 | while read -r f; do [ -n "$f" ] && echo -e "  ${RED}  - $f${RESET}"; done
        [ "$n" -gt 20 ] && echo -e "  ${RED}  … and $((n-20)) more${RESET}"
    fi
}

###############################################################################
# GATE 5: Feature Manifest Coverage
###############################################################################
gate_feature_manifest() {
    print_gate_start "5" "Feature Manifest Coverage"
    if [ ! -f "FEATURE_MANIFEST.json" ]; then
        print_fail "FEATURE_MANIFEST.json not found"
        return
    fi
    local stats
    stats=$(node -e "
        const m = JSON.parse(require('fs').readFileSync('FEATURE_MANIFEST.json','utf8'));
        const rows = m.pages || [];
        const s = { real:0, stubbed:0, missing:0, unverified:0 };
        rows.forEach(r => {
            if (r.status === 'STUBBED') s.stubbed++;
            else if (r.status === 'MISSING') s.missing++;
            else if (r.status === 'REAL') s.real++;
            if (r.verification && r.verification !== 'verified') s.unverified++;
        });
        console.log(JSON.stringify(s));
    " 2>/dev/null || echo '{"real":0,"stubbed":0,"missing":0,"unverified":0}')
    local stubbed=$(echo "$stats" | grep -o '"stubbed":[0-9]*' | cut -d: -f2)
    local missing=$(echo "$stats" | grep -o '"missing":[0-9]*' | cut -d: -f2)
    local real=$(echo "$stats" | grep -o '"real":[0-9]*' | cut -d: -f2)
    local unver=$(echo "$stats" | grep -o '"unverified":[0-9]*' | cut -d: -f2)
    stubbed=${stubbed:-0}; missing=${missing:-0}; real=${real:-0}; unver=${unver:-0}
    if [ "$stubbed" -eq 0 ] && [ "$missing" -eq 0 ]; then
        print_pass
        echo -e "  ${GREEN}→ $real REAL, 0 STUBBED, 0 MISSING${RESET}"
    else
        print_fail "Incomplete: $real REAL, $stubbed STUBBED, $missing MISSING"
    fi
    # Honest-status guard: a status the manifest itself labels not-'verified'
    # must never read as done. This is the safeguard against the 2026-05-18
    # head-truncation false call.
    if [ "$unver" -gt 0 ]; then
        print_warn "$unver route(s) carry verification != 'verified' — audit + promote before trusting status"
    fi
}

###############################################################################
# GATE 6: Dual-Router Coexistence (informational — office runs both by design)
###############################################################################
gate_router_coexistence() {
    print_gate_start "6" "Pages/App Router Coexistence (informational)"
    if [ -d pages ] && [ -d app ]; then
        # Office intentionally runs Pages Router + a parallel app/ tree. This is
        # NOT a conflict to fail on (unlike packages/app, which is migrating).
        # Just surface any route name colliding across both routers.
        local dup
        dup=$( { find pages -type f \( -name '*.tsx' -o -name '*.ts' \) 2>/dev/null \
                   | grep -vE '_app|_document|/api/' | sed -E 's#pages/##; s#/index\.(tsx|ts)$##; s#\.(tsx|ts)$##';
                 find "app" -type d 2>/dev/null | sed -E 's#app/\([^)]*\)/##; s#app/##'; } \
               | sort | uniq -d )
        if [ -z "$dup" ]; then
            print_pass
            echo -e "  ${GREEN}→ both routers present, no overlapping route names${RESET}"
        else
            print_warn "route name(s) present in both routers — confirm intended: $(echo "$dup" | tr '\n' ' ')"
        fi
    else
        print_pass
        echo -e "  ${GREEN}→ single router${RESET}"
    fi
}

###############################################################################
# GATE 7: Next.js Build
###############################################################################
gate_next_build() {
    print_gate_start "7" "Next.js Build (package build script; Gate 1 remains authoritative for TS)"
    if timeout 420 yarn build 2>&1 | tee /tmp/office_next_build.log; then
        print_pass
    else
        local ec=$?
        if [ "$ec" -eq 124 ]; then print_fail "Build timeout (7 min exceeded)"
        else print_fail "Build failed (exit $ec)"; fi
    fi
}

main() {
    print_header
    gate_typescript;        echo ""
    gate_no_sportsbook;     echo ""
    gate_no_mock_data;      echo ""
    gate_no_ts_suppression; echo ""
    gate_feature_manifest;  echo ""
    gate_router_coexistence;echo ""
    gate_next_build;        echo ""
    print_summary
    [ "$FAIL_COUNT" -eq 0 ] && return 0 || return 1
}

main
exit $?
