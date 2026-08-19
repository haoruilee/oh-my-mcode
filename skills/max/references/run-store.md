# Run store CLI

Prefer `oh-my-mcode` / `omm` when installed. Plugin-manager duties otherwise live in `scripts/run-store.mjs`, not in prompt memory.

Workspace is the **user project**. Runs are created at:

`<workspace>/.minimax/runs/<run_id>/`

`run_id` looks like `run_` + Crockford-base32 timestamp + random.

## Commands

```bash
node <plugin-root>/scripts/run-store.mjs create --workspace <ws> --goal "..."
node <plugin-root>/scripts/run-store.mjs show --workspace <ws> --run-id <id>
node <plugin-root>/scripts/run-store.mjs list --workspace <ws>
node <plugin-root>/scripts/run-store.mjs set-phase --workspace <ws> --run-id <id> --phase PLAN
node <plugin-root>/scripts/run-store.mjs append-event --workspace <ws> --run-id <id> --type task_started --task-id T2 --payload '{}'
node <plugin-root>/scripts/run-store.mjs write-plan --workspace <ws> --run-id <id> --file /tmp/plan.md
node <plugin-root>/scripts/run-store.mjs write-tasks --workspace <ws> --run-id <id> --file /tmp/tasks.json
node <plugin-root>/scripts/run-store.mjs write-findings --workspace <ws> --run-id <id> --file /tmp/findings.json
node <plugin-root>/scripts/run-store.mjs add-evidence --workspace <ws> --run-id <id> --kind test --path /tmp/out.log --command "npm test" --exit-code 0
node <plugin-root>/scripts/run-store.mjs evidence-report --workspace <ws> --run-id <id>
```

Writes are temp-file + rename. One writer at a time (`.lock`).

`write-findings` is the only command that may set `accepted` or `rejected`. Call it only from the `verify` skill.

Event types: `run_created`, `phase_changed`, `task_started`, `task_completed`, `tool_called`, `test_ran`, `finding_emitted`, `repair_requested`, `run_accepted`, `run_rejected`, `run_resumed`.

Schemas: `schemas/*.schema.json`.
