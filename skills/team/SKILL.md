---
name: team
description: |
  Flat Oh My MiniMax Code team mode: planner emits a DAG; independent builder tasks may run in parallel via separate mcode exec processes. Orchestrator is the only scheduler. Triggers: "oh-my-mcode team", "flat team mode", "run independent builders in parallel", "max --team". Do not trigger for host desktop /team (that is MiniMax Agent Team — coexist, we do not register it), recursive Sisyphus/orchestrator trees, grandchild agents, plan-only, or verify-only. This skill is not a slash command.
license: MIT
compatibility: Requires MiniMax Code 0.1.6+ with Agent Plugin Skills. Not a host slash command.
metadata:
  version: "0.1.0"
  author: haoruilee
  displayName: Team
  displayName_zhHans: 扁平团队
---

# Team

Explicit flat team. Sequential `max` stays the default. Project-manager duties stay in TypeScript. **Do not spawn grandchild agents.**

This skill does **not** register host `/team`. Desktop `/team` remains the host's Agent Team.

中文名：扁平团队。

## Inputs

- Task / goal.
- Prefer `oh-my-mcode team "<task>"` or `oh-my-mcode max --team "<task>"`.
- Optional `--worktree` (git worktree per parallel builder under `.minimax/worktrees/<run>/<task>`).
- Concurrency default 2.

## Procedure

1. Same INTAKE → DISCOVER → PLAN as `max`, but the planner DAG may include independent builders.
2. The CLI orchestrator schedules ready builders (no unsatisfied deps) in parallel `mcode exec` workers. You do not spawn children.
3. Optional worktree: merge back only after that task's verify slice passes. Clean up on cancel.
4. VERIFY remains a separate phase. Builders never mark Accepted.
5. Bound concurrency. No 1100-line Sisyphus loop.

## Output contract

- Same run store as `max`. `team_spawned` events when a parallel wave starts.
- Verifier writes Accepted / Rejected.

## Failure handling

- Shared-file conflicts without `--worktree`: stop and ask for worktrees or a sequential `max`.
- Host `/team` requested: explain coexistence; use this skill only for a durable oh-my-mcode run.

## Examples

User: `oh-my-mcode team: implement logging and docs if they do not share files`

Use the team CLI. Independent builders may run in parallel.

User: `/team` in the MiniMax desktop

Host feature. Do not claim we registered it.
