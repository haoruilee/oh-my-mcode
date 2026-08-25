---
name: max
description: |
  Run the full Oh My MiniMax Code loop to independently Accepted evidence (INTAKE → DISCOVER → PLAN → PLAN_REVIEW → EXECUTE → VERIFY → REPAIR → ACCEPT, optional RELEASE). Triggers: "max mode", "verified mode", "run this to accepted evidence", "oh-my-mcode", "ship with evidence", "prove it passes". Do not trigger for plan-only work, host /plan /goal /team, re-verify of an existing run, resume, doctor/install, casual Q&A, or Agent Team / spawn requests. This skill is not a slash command.
license: MIT
compatibility: Requires MiniMax Code 0.1.6+ with Agent Plugin Skills. Not a host slash command.
metadata:
  version: "0.1.0"
  author: haoruilee
  displayName: Max Mode
  displayName_zhHans: 验证交付模式
---

# Max Mode

Full verified-delivery loop on **one host agent**. Role files in `agents/` are contracts this same agent must obey, not spawned personas. Never mark Accepted here. Hand acceptance to the `verify` skill.

中文名：验证交付模式。

## Inputs

- User goal, constraints, and any files they named.
- Workspace root (project being changed). Plugin root is the installed copy, often `~/.minimax/plugins/oh-my-mcode`.
- State tool: `node <plugin-root>/scripts/run-store.mjs` (see [references/run-store.md](references/run-store.md)). Always write the same `.minimax/runs` layout. There is no second user-facing CLI to hand off to.
- **MCP first:** if tools `omm_run_create`, `omm_run_show`, `omm_run_list`, `omm_status`, `omm_verify`, or `omm_inspect` exist, use them instead of hand-writing run files or inventing a second store. Do not set PLUGIN_ROOT / PLUGIN_DATA.

## Procedure

1. **INTAKE.** Restate the goal in one sentence plus out-of-scope. Create the run:
   `node <plugin-root>/scripts/run-store.mjs create --workspace <ws> --goal "<goal>"`
   Persist `run_id` and the seeded acceptance list (goal-named command or detected test/build) **before** any host exec. Tell the user the path `<ws>/.minimax/runs/<run_id>/` and how we will know we are done.
2. **DISCOVER.** CLI `max` may skip this host exec when the goal already names a file, function, or test command and the workspace has a detected test/build (`--discover` forces it). `plan` always discovers. When the explorer does run: `set-phase --phase DISCOVER`. Load `agents/explorer.md`. Read-only search and diagnostic commands only. Record risks and test entry points in notes, not in product files.
3. **PLAN.** `set-phase --phase PLAN`. Load `agents/planner.md`. Write `plan.md` and `tasks.json` via `write-plan` / `write-tasks`. Every task has one role and `depends_on`. Acceptance criteria must be commands or diffs a verifier can run without trusting the builder.
4. **PLAN_REVIEW.** `set-phase --phase PLAN_REVIEW`. Show the DAG and acceptance list. If the user asked for a plan only, **stop** and point them at the `plan` skill next time. If they asked to ship, continue unless they objected.
5. **EXECUTE.** `set-phase --phase EXECUTE`. Load `agents/builder.md`. Do **one** ready task. No scope creep. After the task: `append-event --type task_completed --task-id T<n>` and capture command output with `add-evidence`.
6. **VERIFY.** `set-phase --phase VERIFY`. Stop building. Follow `skills/verify/SKILL.md` and `agents/verifier.md`. The writer does not grade their own work.
7. **REPAIR.** If findings are `rejected`, a new Builder task is created from structured findings. Return to EXECUTE for that task only, then VERIFY again. Loop until Accepted or the user stops.
8. **ACCEPT.** Only the verify skill may leave `status=accepted`. After that, write `evidence-report`.
9. **RELEASE.** Only if the user asked to commit/PR **and** status is `accepted`. Load `agents/release.md`. Otherwise stop and present `summary.md`.

## Output contract

- A run directory with `run.json`, `plan.md`, `tasks.json`, `events.jsonl`, `evidence/`, and after verify: `findings.json` + `summary.md`.
- User-facing close: goal, `run_id`, verdict, commands that were run, remaining risks.
- After CLI `max` / `team` / `plan`, tell the user they can reopen the same host session with `mcode --session <host_session_id>` or `mcode --continue`. Parallel team worktrees may use their own session (different cwd).
- If the run is not Accepted, say so. Do not euphemize.

## Failure handling

- Run store write fails: stop. Do not continue from memory.
- Tests cannot be run: verifier records `untested` / `rejected`, never Accepted.
- User changes the goal: do not silently mutate this run. Finish or ask them to start a new max-mode run.
- Host has no Skill inspect API: still persist the run; use `doctor` only if install is in doubt.

## Examples

User: `max mode: fix the failing auth tests and prove they pass`

Create a run, discover the test command, plan one builder task, implement, then invoke verify. Close only after `findings.json` says `accepted`.

User: `max mode this weekend, just think about Postgres`

Wrong skill. Hand off to `plan` (discover + plan + review, no edits).
