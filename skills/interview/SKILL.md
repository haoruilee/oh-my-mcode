---
name: interview
description: |
  Capture a short verified-delivery interview (goal, constraints, acceptance, out of scope) and stop at PLAN_REVIEW. No builder. Triggers: "oh-my-mcode interview", "interview this goal", "ask me the acceptance questions", "deep interview before we build". Do not trigger for max mode / execute, host /plan, re-verify, doctor/install, or casual Q&A. This skill is not a slash command.
license: MIT
compatibility: Requires MiniMax Code 0.1.6+ with Agent Plugin Skills. Not a host slash command.
metadata:
  version: "0.1.0"
  author: haoruilee
  displayName: Interview
  displayName_zhHans: 交付访谈
---

# Interview

TypeScript intake. Four short questions. Writes `interview.md` + `interview.json` with derived acceptance. Stops at PLAN_REVIEW. No builder. No Accepted.

中文名：交付访谈。

## Inputs

- Goal. Optional constraints the user already stated.
- Workspace root.
- **MCP first:** `omm_interview` when present. Else CLI: `oh-my-mcode interview "<goal>"`.
- Non-interactive: `--answers answers.json` or `--constraint` (repeatable).

## Procedure

1. Create or load the run. Do not start EXECUTE.
2. Ask only: goal, constraints, acceptance, out of scope. Do not invent a long form.
3. Persist interview artifacts via the harness / run store. Seed `tasks.json` acceptance from the answers.
4. Stop at PLAN_REVIEW. Point the user at `max` (or `max --interview` if they want the loop after intake).

## Output contract

- `interview.md` and `interview.json` on disk.
- Phase `PLAN_REVIEW`. Status is not Accepted.
- No product edits.

## Failure handling

- Non-TTY without answers/constraints: stop and ask for `--answers` or `--constraint`.
- User says "just do it": switch to the `max` skill.

## Examples

User: `interview this: fix the failing auth tests`

Ask four questions (or load answers), write artifacts, stop.

User: `max mode: fix the failing auth tests`

Wrong skill. That is the full loop (`max`).
