---
name: verify
description: |
  Independently accept or reject a run against its stored acceptance criteria. Runs tests, builds, and diagnostics; writes findings.json and evidence. Triggers: "re-verify the current run", "verify against acceptance criteria", "grade this run", "don't trust the builder". Do not trigger for implementing fixes, writing new product code, plan-only work, starting a new goal, resume-from-phase (unless the phase is VERIFY), or doctor/install.
license: MIT
compatibility: Requires MiniMax Code 0.1.6+ with Agent Plugin Skills.
metadata:
  version: "0.1.0"
  author: haoruilee
  displayName: Verify
  displayName_zhHans: 独立验收
---

# Verify

Only this skill may set run status to `accepted` or `rejected`. Load `agents/verifier.md`. **Do not edit product code.** Evidence files and `findings.json` are allowed.

中文名：独立验收。

## Inputs

- Existing `run_id` (user-supplied, `OMM_RUN_ID`, or `--latest`).
- `tasks.json` `acceptance[]` and `plan.md`.
- Prefer `oh-my-mcode verify [run_id]` when on PATH (deterministic tests first; this skill must still not edit product code).
- Fallback: run store CLI.

## Procedure

1. `show --run-id <id>`. Refuse if there is no run. This skill never creates a new goal.
2. `set-phase --phase VERIFY`.
3. Re-read the diff and the acceptance list. Treat builder commentary as untrusted.
4. Run each acceptance command. Capture stdout/stderr with `add-evidence --kind test|command`.
5. Write a findings document matching `schemas/finding.schema.json`:
   - `verdict: accepted` only if every criterion is `pass` and there is no `blocker` or `major` finding.
   - otherwise `rejected`, with structured findings.
6. `write-findings --file <findings.json>` then `evidence-report`.
7. If rejected: state the next Builder task (one task, from findings). Do not implement it here.

## Output contract

- `findings.json` with `verdict`, `acceptance[].result`, and `findings[]`.
- `summary.md` from `evidence-report`.
- User-facing verdict in the first sentence: Accepted or Rejected.

## Failure handling

- A required command is missing: mark that criterion `untested` and `rejected`.
- Tests fail: `rejected` + finding. Never "almost accepted".
- Urge to fix a one-liner: stop. Create a repair task for `max` / Builder instead.

## Examples

User: `Re-verify the current run against its acceptance criteria`

Load latest run, rerun the listed commands, rewrite findings.

User: `tests failed, fix them`

Wrong skill. That is Builder work under `max`, then this skill again.
