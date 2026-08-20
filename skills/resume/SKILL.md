---
name: resume
description: |
  Load an existing Oh My MiniMax Code run, restore its phase and current task, and continue that goal. Triggers: "continue the last oh-my-mcode run", "continue run_…", "pick up max mode where we left off", "restore the last verified run". Do not trigger for host /resume (that is MiniMax session resume — coexist, do not claim we registered it), a new goal, plan-only from scratch, doctor/install, or when the user has not named or implied an existing run. This skill is not a slash command.
license: MIT
compatibility: Requires MiniMax Code 0.1.6+ with Agent Plugin Skills.
metadata:
  version: "0.1.0"
  author: haoruilee
  displayName: Resume Run
  displayName_zhHans: 恢复运行
---

# Resume Run

Never start a new goal. If there is no run to load, stop and tell the user to say `max mode: <task>`.

This skill does **not** register host `/resume`. Host `/resume` continues a MiniMax session. This skill restores `<workspace>/.minimax/runs/<run_id>/`.

中文名：恢复运行。

## Inputs

- `run_id` or "latest run in this workspace".
- Workspace root.
- On-disk artifacts under `.minimax/runs/<run_id>/`.
- State tool: `node <plugin-root>/scripts/run-store.mjs`.
- **MCP first:** if `omm_run_show` / `omm_run_list` / `omm_status` exist, use them instead of hand-writing run files. Host `/resume` is still session resume — this skill restores `.minimax/runs/<run_id>/`. Reuse `run.json.host_session_id` when opening the TUI (`mcode --session <id>` or `mcode --continue`).

## Procedure

1. `list --workspace <ws>` or `show --latest`. Identify the run. If multiple and the user did not choose, ask — do not guess a different goal.
2. Read `run.json`, `plan.md`, `tasks.json`, last `findings.json`, and the tail of `events.jsonl`.
3. `append-event --type run_resumed --payload '{"from_phase":"<phase>"}'`.
4. Continue **the stored phase**, not a restart:
   - PLAN / PLAN_REVIEW → `plan` rules (no product edits).
   - EXECUTE / REPAIR → `max` Builder for the current unfinished task only.
   - VERIFY → `verify`.
   - ACCEPT → show `summary.md`; RELEASE only if asked.
5. Keep the same `run_id`. Do not call `create`.

## Output contract

- Confirmation of `run_id`, restored phase, current task, and the next action.
- Subsequent writes go to the same run directory.

## Failure handling

- Corrupt `run.json`: report the parse error. Do not invent state.
- Goal in the user's message disagrees with `run.json.goal`: refuse to silently switch; they must start a new max-mode run.

## Examples

User: `resume run_01K3H7WQ0R8SAMPLEAUTH`

Load that directory and continue its phase.

User: `resume our work — actually also add billing`

New goal. Do not fold it into the old run.
