#!/usr/bin/env bash
set -euo pipefail

# P2-06 consolidated development + deploy onto `main` in the primary checkout;
# the old worktree and its deploy branch are retired. This preflight now
# guards that consolidated flow.
required_root="/Users/john/Sandbox/taptrade-workspace/taptrade"
required_branch="main"
remote_ref="origin/${required_branch}"

root="$(git rev-parse --show-toplevel)"
if [[ "${root}" != "${required_root}" ]]; then
  echo "ERROR: wrong checkout."
  echo "Expected: ${required_root}"
  echo "Actual:   ${root}"
  exit 1
fi

branch="$(git branch --show-current)"
if [[ "${branch}" != "${required_branch}" ]]; then
  echo "ERROR: wrong branch."
  echo "Expected: ${required_branch}"
  echo "Actual:   ${branch:-detached HEAD}"
  exit 1
fi

git fetch origin --prune

if ! git rev-parse --verify --quiet "${remote_ref}" >/dev/null; then
  echo "ERROR: missing remote ref ${remote_ref}."
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: tracked changes are present."
  echo "Review and commit/stash them before using this preflight as a clean start."
  git status --short
  exit 1
fi

if ! git merge-base --is-ancestor "${remote_ref}" HEAD; then
  echo "ERROR: local branch is behind ${remote_ref}. Pull/rebase before editing."
  exit 1
fi

if ! git merge-base --is-ancestor HEAD "${remote_ref}"; then
  echo "ERROR: local branch has unpushed commits. Push or resolve before proceeding."
  exit 1
fi

echo "OK: ${required_branch} is clean and synced in ${required_root}."
