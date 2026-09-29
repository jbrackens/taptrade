# ADR-0011: Single `main` branch deploys the demo; docker-compose on one Hetzner box

**Status:** Accepted — both parts executed. Branch consolidation: 2026-06-14 (P2-06). Deployment-doc correction: 2026-06-13 (P2-04).
**Date:** P2-04 commit `f51442d4`, 2026-06-13. P2-06 report `docs/audit/P2-06-BRANCH-TRIAGE.md`, written and executed 2026-06-14.
**Deciders:** P2-06 was "written 2026-06-14 as an owner-decision report; independently reviewed by Codex (verdict: endorse-with-changes, folded in)." No individual owner name recorded for either.

> **Scope:** two related but separable deployment-topology facts: (1) `main`
> is the single trunk that deploys the demo (not a separate deploy branch);
> (2) the demo runs as docker-compose on one Hetzner box, not Kubernetes.
> **Authoritative for:** why these are the current shape and what changed to
> reach it. **Not for:** the day-to-day deploy pipeline mechanics — see
> `apps/taptrade-platform/DEPLOYMENT.md`.

## Context — two distinct histories folded into one decision record

**Branch consolidation (P2-06).** By 2026-06-14, `main` and the actual
deploy branch (`origin/feat/binary-exchange-engine`) had diverged for ~5
weeks: `docs/audit/P2-06-BRANCH-TRIAGE.md` records "`git rev-list
--left-right --count main...origin/feat/binary-exchange-engine` = 35 416:
35 commits unique to `main`, 416 unique to the deploy line." The deploy
line was live at Hetzner (demo.99rtp.io / office.99rtp.io); `main` was
stale and carried an independent, superseded cashier scaffold.

**Deployment-doc correction (P2-04).** Separately, `apps/taptrade-platform/DEPLOYMENT.md`
records that the *operational documentation* — not the actual
infrastructure — described "a fictional Kubernetes/Cloud-SQL/Memorystore
guide" that "was fiction; it was retired in the P2-04 cleanup." Commit
`f51442d4` (2026-06-13, "docs(P2-04): rewrite architecture/runbooks/deployment
to match reality") states this explicitly: "The operational docs described
the SPORTSBOOK (fixtures/betslips/freebets) and a fictional
Kubernetes/Cloud-SQL/Prometheus/ELK topology that never existed (audit
ARCH-05 / ORG-02)." **This means P2-04 was a documentation correction, not
an infrastructure migration** — the real deployment target has apparently
always been Hetzner + docker-compose + Caddy; the stale docs (inherited
from the pre-fork sportsbook project, per the commit's own framing) simply
described something else. No commit or document in this repository records
an actual decision to run on Kubernetes and then move off it.

## Decision and scope

1. **Branch:** adopt the deploy line's history as `main` (not a merge — the
   histories had diverged non-fast-forward). `.github/workflows/deploy-demo.yml`
   triggers on `push: branches: [main]`, annotated inline: "P2-06:
   consolidated onto main; feat/binary-exchange-engine retired 2026-06-14."
   `CLAUDE.md` records the same outcome under "Agent Branch / Deploy
   Policy": "Active development and demo deployment happen from the
   primary checkout... Branch: main (pushing to it IS the production
   deploy)."
2. **Topology:** the demo runs as a single Hetzner box (2 vCPU) running
   docker-compose behind Caddy, driven by GitHub Actions over SSH —
   `docker-compose.yml` (postgres, redis, gateway, auth) plus
   `docker-compose.demo.yml` (overlay: player, office, Caddy, Rocket.Chat,
   backups). Both compose files pin fixed `container_name` values, so "only
   one stack can run on a box" (`DEPLOYMENT.md`).

## Alternatives considered

**Branch (P2-06):** three explicitly rejected in the report:
- *A real 3-way merge* — rejected: "the lines diverged 35/416 — not a fast-forward. A 3-way merge would fight the deliberate cashier replacement (re-introducing the removed BSC-USDT watcher next to alphacashier) and produce a misleading merge commit."
- *`git branch -m`/rename* — rejected: the local stale branch was checked out in another worktree and couldn't be moved; a remote rename "doesn't solve workflow retargeting or protection."
- *Keep shipping from the `feat/*` branch indefinitely* — rejected: "leaves a misleading branch name, a frozen default branch, and no protected trunk."

**Topology (P2-04):** not applicable in the usual sense — there is no
recorded decision point choosing Hetzner+compose over Kubernetes, because
(per the evidence above) Kubernetes was never actually built; the "choice"
was between correcting the docs and leaving them wrong.

## Rationale and trade-offs

**Branch:** recorded directly in the P2-06 report — adopting the deploy
line preserves the live, working history and avoids a merge that would
reintroduce already-deliberately-removed code (the old BSC-USDT watcher).
The cost (35 commits' worth of `main`-only work, mostly CI fixes plus an
older cashier scaffold) was evaluated and accepted: "the deploy fixes are
superseded by the deploy line's own working `deploy-demo.yml`," and the
older cashier scaffold's ~22 commits were explicitly **not** cherry-picked
("They were not cherry-picked").

**Topology:** rationale not recorded, because (as established above) there
was no infrastructure decision to weigh trade-offs on — only a
documentation-accuracy fix. Why the project runs on a single Hetzner box
with docker-compose in the first place (cost, simplicity, team familiarity,
or something else) is not written down anywhere in the repository.

## Consequences and constraints

- **Verified at `4924a670`:** `.github/workflows/deploy-demo.yml` still triggers on `push: branches: [main]` with the P2-06 comment; `apps/taptrade-platform/DEPLOYMENT.md` still describes the Hetzner/compose/Caddy topology as current.
- P2-06's own report carries a **later correction notice** at its top (dated after 2026-06-14, exact date not given): "RESOLVED... this report describes a decision that has since been executed. Do not run anything in it," and states §3 (the force-push execution runbook) "has been deleted rather than left in place" because it contained a destructive `--force-with-lease` push against production `main` seeded from a ref that no longer resolves — a live copy of that command would now be dangerous. This is a **Discrepancy-avoidance note**, not a discrepancy: the report's editors removed the executable-looking runbook precisely so it can't be replayed.
- Branch protection status is explicitly **unverified as current** by the report itself: "Not re-verified. Branch protection is a GitHub setting, not repo content — check the repository settings rather than trusting this section." This ADR does not verify it either — **Open question:** is `main` currently protected (PR + required checks, no force-push)? The report names this as the P2-06 follow-up that "was to be set."
- Of the ~20 branches P2-06 listed for pruning, the report's own later annotation states only `feat/hula-na-cashier` still existed on the remote as of its update — that branch was subsequently merged ([ADR-0012](./0012-cashier-merged-dark-behind-flags.md)).
- **Reversibility:** the pre-cleanup snapshot exists on branch `archive/2026-06-pre-cleanup` (per P2-06 and the related `3ec79f0a` sportsbook-tree cleanup) — nothing was destructively lost, only archived.

## Evidence

- `docs/audit/P2-06-BRANCH-TRIAGE.md` — full branch-consolidation report, rationale, and rejected alternatives.
- `.github/workflows/deploy-demo.yml` — `branches: [main]` trigger with the P2-06 inline comment.
- `CLAUDE.md`, "Agent Branch / Deploy Policy" — current-state confirmation.
- Commit `f51442d4` (2026-06-13) — P2-04 doc rewrite and its "fictional... topology that never existed" framing.
- `apps/taptrade-platform/DEPLOYMENT.md` — current Hetzner/compose/Caddy topology description, citing commit `3ec79f0a` for where the old fictional guide survives (in git history only).
- `docs/audit/IMPROVEMENT_PLAN.md` — P2-04/P2-06 item numbering (audit findings ARCH-05, ORG-02 for P2-04).

## Related

- [ADR-0012](./0012-cashier-merged-dark-behind-flags.md) — disposition of `feat/hula-na-cashier`, the one branch P2-06 left un-pruned.
- `apps/taptrade-platform/DEPLOYMENT.md` — living deployment-pipeline document.
