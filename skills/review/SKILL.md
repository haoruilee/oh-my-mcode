---
name: review
description: |
  Read-only review of an Oh My MiniMax Code run: diff, evidence, and findings. Writes review notes. Triggers: "review this run", "review the diff and evidence", "read-only review of run_", "oh-my-mcode review". Do not trigger for Accept/verify (that is the verify skill), shipping/release, implementing fixes, plan-only work, host /plan /goal, or starting a new max-mode goal. This skill is not a slash command. Review cannot Accept.
license: MIT
compatibility: Requires MiniMax Code 0.1.6+ with Agent Plugin Skills. Not a host slash command.
metadata:
  version: "0.1.0"
  author: haoruilee
  displayName: Review
  displayName_zhHans: 只读评审
---

# Review

Read-only overlay on an existing run. Load `agents/verifier.md` posture for reading, but **do not Accept**. Only the `verify` skill may set Accepted.

中文名：只读评审。

## Inputs

- Existing `run_id` or latest run.
- State tool: `node <plugin-root>/scripts/run-store.mjs` or `oh-my-mcode review`.

## Procedure

1. `show` the run. Refuse if none exists. Do not create a new goal.
2. Read `plan.md`, `tasks.json`, `evidence/`, `findings.json`, and the workspace diff.
3. Write `review.md` / `review.json` via the CLI (`oh-my-mcode review`) when available. Append `review_completed`.
4. **Never** call `write-findings` with `verdict: accepted`. Review cannot Accept.

## Output contract

- Findings as notes. First sentence says this is a review, not acceptance.
- Run status is unchanged except for the review artifacts.

## Failure handling

- No evidence: say so. Still do not Accept.
- Urge to merge or ship: hand off to `ship` only if status is already `accepted`.

## Examples

User: `review this run`

Load latest run, write review notes, do not Accept.

User: `re-verify this run against acceptance`

Wrong skill. That is `verify`.
