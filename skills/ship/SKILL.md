---
name: ship
description: |
  Prepare release notes from an Accepted Oh My MiniMax Code run and print suggested git/PR commands. Role = Release. Triggers: "ship this run", "write release notes", "oh-my-mcode ship", "prepare the PR from accepted evidence". Do not trigger for non-accepted runs, verify/Accept, implementing leftover fixes, host /plan /goal /team, or "just push it" when status is not accepted. This skill is not a slash command.
license: MIT
compatibility: Requires MiniMax Code 0.1.6+ with Agent Plugin Skills. Not a host slash command.
metadata:
  version: "0.1.0"
  author: haoruilee
  displayName: Ship
  displayName_zhHans: 发布准备
---

# Ship

Load `agents/release.md`. Only if `run.json` `status === accepted`. Default is notes + command list. Do not `git push` unless the user asked for `--commit` and git is clean enough.

中文名：发布准备。

## Inputs

- Accepted `run_id`.
- `summary.md` and evidence.

## Procedure

1. `show` the run. If status is not `accepted`, stop. Do not invent a green verdict.
2. Prefer `oh-my-mcode ship [run_id]`. That writes `release.md` and prints git/PR commands.
3. Do not mark Accepted. Verify already did that.
4. Host `/team` is unrelated. This is Release on a durable run.

## Output contract

- Release notes in the run store.
- Suggested commands. Push only when explicitly requested and the tree is clean enough.

## Failure handling

- Rejected / active / cancelled: refuse.
- Dirty unrelated git state: print commands, do not force-push.

## Examples

User: `ship this run`

Write notes and print commands if Accepted.

User: `max mode: ship the auth fix`

Wrong skill if the work is not yet Accepted. That is `max` then this skill.
