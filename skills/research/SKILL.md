---
name: research
description: |
  DISCOVER-only exploration that writes a research note into the Oh My MiniMax Code run store. Explorer role. No product edits. Triggers: "research this topic", "oh-my-mcode research", "explore only, don't implement", "write a research note". Do not trigger for max mode / execute / builder work, plan-only DAGs that should stop at PLAN_REVIEW (use plan), verify, ship, host /plan /goal, or Agent Team spawn. This skill is not a slash command.
license: MIT
compatibility: Requires MiniMax Code 0.1.6+ with Agent Plugin Skills. Not a host slash command.
metadata:
  version: "0.1.0"
  author: haoruilee
  displayName: Research
  displayName_zhHans: 仅调研
---

# Research

Explorer only. Load `agents/explorer.md`. Stop after DISCOVER. No builder. No EXECUTE.

中文名：仅调研。

## Inputs

- Topic / question.
- Workspace root.
- Prefer `oh-my-mcode research "<topic>"` so the note lands in `.minimax/runs/<id>/research.md`.

## Procedure

1. Create a run for the topic (or load the named run).
2. `set-phase --phase DISCOVER`. Search read-only. Diagnostic commands only.
3. Write `research.md` via the CLI or `write-plan` is the wrong file — use the research artifact. Append `research_completed`.
4. **Do not** start PLAN/EXECUTE. **Do not** edit product files.

## Output contract

- A research note on disk. Paths, commands, risks.
- Phase remains DISCOVER.

## Failure handling

- Missing tests: record that as a risk. Do not invent coverage.
- User says "just implement it": hand off to `max`.

## Examples

User: `research how auth tokens are rotated`

Discover, write a note, stop.

User: `max mode: rotate tokens and prove tests pass`

Wrong skill. That is the full loop.
