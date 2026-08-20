---
name: plan
description: |
  Discover the codebase and emit a task DAG plus acceptance criteria without editing product code. Triggers: "make a verified plan", "make a plan only", "write a plan for migrating", "don't implement yet", "plan review". Do not trigger for host /plan (that is MiniMax Plan Mode — coexist, do not claim we registered it), max mode / verified delivery to Accepted, resume of an existing run, independent re-verify, doctor/install, or "just implement it". This skill is not a slash command.
license: MIT
compatibility: Requires MiniMax Code 0.1.6+ with Agent Plugin Skills.
metadata:
  version: "0.1.0"
  author: haoruilee
  displayName: Plan Only
  displayName_zhHans: 仅规划
---

# Plan Only

Read-only except run artifacts. Stop at PLAN_REVIEW. No product edits, no commits.

This skill does **not** register host `/plan`. Host `/plan` remains Plan Mode. We add a durable run + acceptance list; we do not replace Plan Mode.

中文名：仅规划。

## Inputs

- Goal and constraints.
- Workspace root.
- State tool: `node <plugin-root>/scripts/run-store.mjs` (see `skills/max/references/run-store.md`).
- **MCP first:** if `omm_run_create` / `omm_status` / `omm_inspect` exist, use them instead of hand-writing run files. After plan, print `mcode --session <id>` and `mcode --continue` so the TUI can reopen the same host session.

## Procedure

1. Create a run if none exists for this goal: `create --goal "<goal>"`. If the user pointed at an existing run, load it (`resume` is for continuing execution — this skill still must not implement).
2. `set-phase --phase DISCOVER`. Load `agents/explorer.md`. Locate the module, tests, and risks. Diagnostic commands only.
3. `set-phase --phase PLAN`. Load `agents/planner.md`. Write `plan.md` (context, DAG, risks, rollback) and `tasks.json` (tasks + `acceptance[]`).
4. `set-phase --phase PLAN_REVIEW`. Present the plan. Ask whether to proceed with max mode. **Do not start EXECUTE.**

## Output contract

- `plan.md` and `tasks.json` on disk via the run store.
- Acceptance criteria a verifier can run later without the planner present.
- A clear stop: "Plan reviewed. Say `max mode` to execute, or edit the plan."

## Failure handling

- Missing tests / unknown verification path: still emit a plan, mark acceptance as `kind: manual` or name the missing command. Do not invent green tests.
- User says "just do it": switch to the `max` skill; do not keep planning in a loop.

## Examples

User: `Make a plan only for migrating this module to Postgres`

Discover the current store, list migration risks, write a DAG, stop.

User: `max mode: migrate this module to Postgres`

Wrong skill. That is the full loop (`max`).
