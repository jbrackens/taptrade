#!/usr/bin/env bash
# releases.sh — keep recent release images on the demo box and roll back to
# one of them. Runs ON THE BOX; the workflows pipe it over SSH:
#
#   ssh … 'bash -s -- <command> [args]' < apps/taptrade-platform/scripts/releases.sh
#
# Commands:
#   record <id>           append a successful deploy of release <id> to the log
#   list                  print the release log (newest last)
#   prune                 delete release image tags beyond the newest $KEEP releases
#   rollback [id]         re-point the running tags at release <id> (default: the
#                         release before the current one) and recreate the app
#                         containers. DRY_RUN=1 prints what would happen.
#
# A release id is the first 12 characters of the deployed commit. The deploy
# tags each image it loads as <repo>:rel-<id> (front ends: app-rel-<id>,
# office-rel-<id>) next to the tag compose runs. Rollback restores images only:
# it does not revert migrations or the rsynced config (see docs/DEPLOYMENT.md).
set -euo pipefail

LOG_DIR="${RELEASES_LOG_DIR:-/var/lib/taptrade}"
LOG="$LOG_DIR/releases.log"
KEEP="${KEEP:-3}"
APP_DIR=/opt/phoenix
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.demo.yml)

# "<release tag> <running tag> <compose service>" for every app image.
image_map() {
  local id="$1"
  printf '%s\n' \
    "taptrade-auth:rel-$id taptrade-auth:latest auth" \
    "taptrade-gateway:rel-$id taptrade-gateway:latest gateway" \
    "predict-frontend:app-rel-$id predict-frontend:app-slim player" \
    "predict-frontend:office-rel-$id predict-frontend:office-slim office"
}

# Distinct release ids, newest first.
recent_ids() {
  [ -s "$LOG" ] || return 0
  tac "$LOG" | awk '{print $2}' | awk '!seen[$0]++'
}

wait_healthy() {
  local name="$1" url="$2"
  for _ in $(seq 1 24); do
    if curl -fsS -o /dev/null "$url"; then echo "  $name healthy"; return 0; fi
    sleep 5
  done
  echo "::error::$name did not become healthy at $url"
  return 1
}

cmd="${1:-}"
shift || true
case "$cmd" in
  record)
    id="${1:?record needs a release id}"
    mkdir -p "$LOG_DIR"
    echo "$(date -u +%FT%TZ) $id deploy" >>"$LOG"
    echo "recorded release $id"
    ;;

  list)
    if [ -s "$LOG" ]; then cat "$LOG"; else echo "no releases recorded yet"; fi
    ;;

  prune)
    keep="$(recent_ids | head -n "$KEEP" | tr '\n' ' ')"
    echo "keeping releases: ${keep:-none recorded}"
    docker images --format '{{.Repository}}:{{.Tag}}' |
      grep -E ':(app-|office-)?rel-[0-9a-f]{12}$' |
      while read -r tag; do
        id="${tag##*rel-}"
        case " $keep " in
          *" $id "*) ;;
          *) docker rmi "$tag" >/dev/null && echo "  removed $tag" ;;
        esac
      done || true
    ;;

  rollback)
    current="$(recent_ids | head -n 1)"
    target="${1:-$(recent_ids | sed -n 2p)}"
    echo "release log:"; cat "$LOG" 2>/dev/null || true
    [ -n "$current" ] || { echo "::error::no release history at $LOG"; exit 1; }
    [ -n "$target" ] || { echo "::error::no earlier release to roll back to"; exit 1; }
    [ "$target" != "$current" ] || { echo "::error::$target is already the current release"; exit 1; }
    while read -r src _ _; do
      docker image inspect "$src" >/dev/null 2>&1 || {
        echo "::error::$src is not on the box — release $target is not retained"
        exit 1
      }
    done < <(image_map "$target")

    echo "rolling back $current -> $target (images only; migrations are not reverted)"
    services=()
    while read -r src dst svc; do
      echo "  $dst <- $src"
      services+=("$svc")
      [ "${DRY_RUN:-0}" = 1 ] || docker tag "$src" "$dst"
    done < <(image_map "$target")
    if [ "${DRY_RUN:-0}" = 1 ]; then
      echo "dry run: would recreate ${services[*]}"
      exit 0
    fi
    cd "$APP_DIR"
    JWT_SECRET=unused "${COMPOSE[@]}" up -d --no-deps --force-recreate "${services[@]}"
    wait_healthy auth http://127.0.0.1:18081/healthz
    wait_healthy gateway http://127.0.0.1:18080/healthz
    echo "$(date -u +%FT%TZ) $target rollback-from-$current" >>"$LOG"
    echo "rolled back to $target"
    ;;

  *)
    echo "usage: releases.sh {record <id>|list|prune|rollback [id]}" >&2
    exit 2
    ;;
esac
