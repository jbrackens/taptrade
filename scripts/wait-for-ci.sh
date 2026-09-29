#!/usr/bin/env bash
# wait-for-ci.sh — block until the CI workflows for one commit have finished,
# and fail unless every one that ran succeeded. The demo deploy runs this
# first so a commit that fails its tests or guards is never deployed (TD-018).
#
# Usage: scripts/wait-for-ci.sh <commit-sha> [owner/repo]
# Needs: gh (authenticated; GH_TOKEN in Actions) and jq.
#
# Workflows are matched by file, not display name. Path-filtered guards only
# run on some commits, so the script waits for the ones that were triggered:
# it first waits for test.yml (which runs on every push to main) and a short
# settle period for the others to register, then for all of them to finish.
set -euo pipefail

SHA="${1:?usage: wait-for-ci.sh <commit-sha> [owner/repo]}"
REPO="${2:-${GITHUB_REPOSITORY:-}}"
[ -n "$REPO" ] || REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"

REQUIRED=(
  ".github/workflows/test.yml"
  ".github/workflows/guard-money-path.yml"
  ".github/workflows/guard-db-migrations.yml"
  ".github/workflows/guard-openapi-drift.yml"
)
ALWAYS=".github/workflows/test.yml"
TIMEOUT_SECONDS="${CI_WAIT_TIMEOUT_SECONDS:-3000}"
SETTLE_SECONDS="${CI_WAIT_SETTLE_SECONDS:-90}"
POLL_SECONDS="${CI_WAIT_POLL_SECONDS:-20}"

required_json="$(printf '%s\n' "${REQUIRED[@]}" | jq -R . | jq -s .)"
started="$(date +%s)"

# One line per required workflow that ran on this commit (latest run each):
# "<path>\t<status>\t<conclusion>\t<run url>"
latest_runs() {
  gh api "repos/$REPO/actions/runs?head_sha=$SHA&per_page=100" --paginate \
    --jq '.workflow_runs[] | [.path, .status, (.conclusion // ""), .html_url, .id] | @tsv' |
    jq -R -r --argjson req "$required_json" '
      split("\t") | {path: .[0], status: .[1], conclusion: .[2], url: .[3], id: (.[4] | tonumber)}
      | select(.path as $p | $req | index($p))' |
    jq -s -r 'group_by(.path) | map(max_by(.id)) | .[] | [.path, .status, .conclusion, .url] | @tsv'
}

echo "Waiting for CI on $SHA in $REPO"
while :; do
  elapsed=$(( $(date +%s) - started ))
  if [ "$elapsed" -gt "$TIMEOUT_SECONDS" ]; then
    echo "::error::CI did not finish within ${TIMEOUT_SECONDS}s for $SHA"
    exit 1
  fi

  runs="$(latest_runs)"
  if ! grep -q "^$ALWAYS"$'\t' <<<"$runs"; then
    echo "  $ALWAYS has not started yet (${elapsed}s)"
    sleep "$POLL_SECONDS"; continue
  fi

  failed="$(awk -F'\t' '$2=="completed" && $3!="success"' <<<"$runs")"
  if [ -n "$failed" ]; then
    echo "::error::CI failed for $SHA — not deploying:"
    awk -F'\t' '{printf "  %s: %s (%s)\n", $1, $3, $4}' <<<"$failed"
    exit 1
  fi

  pending="$(awk -F'\t' '$2!="completed"' <<<"$runs")"
  if [ -z "$pending" ] && [ "$elapsed" -ge "$SETTLE_SECONDS" ]; then
    echo "CI passed for $SHA:"
    awk -F'\t' '{printf "  %s: %s\n", $1, $3}' <<<"$runs"
    exit 0
  fi

  [ -n "$pending" ] && awk -F'\t' '{printf "  waiting: %s (%s)\n", $1, $2}' <<<"$pending"
  sleep "$POLL_SECONDS"
done
