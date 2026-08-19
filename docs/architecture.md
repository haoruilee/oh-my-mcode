# Architecture

v0 is **OMM Lite**: one host agent + this workflow, owned by a TypeScript orchestrator. Role files are contracts, not spawned personas. No empty monorepo of fake packages.

## Promise

Not more agents, more skills, or longer memory. Verified completion with evidence.

## Two windows, one store

| Surface | Entry | Who drives the loop |
| --- | --- | --- |
| CLI (the product) | `oh-my-mcode max "..."` | `src/orchestrator.ts` via `mcode exec` |
| TUI (the plugin) | "max mode: ..." | the `max` Skill, writing the same run store |

State is never "prompt only":

```
<workspace>/.minimax/runs/<run_id>/
  run.json
  plan.md
  tasks.json
  events.jsonl
  evidence/
  findings.json
  summary.md
```

`run_id` is `run_` + Crockford-base32 timestamp + random. Writes are temp + rename. Single writer (`.lock`).

## Phase machine

```
INTAKE → DISCOVER → PLAN → PLAN_REVIEW → EXECUTE → VERIFY → (REPAIR)* → ACCEPT → RELEASE
```

- PLAN_REVIEW defaults to auto-continue after writing the plan. `--approve-plan` waits on a TTY.
- EXECUTE sends a **tight Task Contract** (objective, allowed files, acceptance). It does not dump this document into every `mcode exec`.
- VERIFY is deterministic first (`src/verify.ts` detects and runs test/build). An optional second `mcode exec` may judge leftovers, read-only. The LLM is never the only acceptance signal and must not edit files.
- Only VERIFY may set Accepted / Rejected. Accepted is refused without evidence files.
- REPAIR turns findings into one new Builder task. Bound by `--max-repairs` (default 3). Repeated failure signatures stop the loop.
- RELEASE is git/PR **after** Accepted, and only if asked (`--release` still does not invent a second VCS CLI).

## Code map

```
src/cli.ts            argv → commands
src/orchestrator.ts   phase machine
src/mcode.ts          spawn mcode exec, parse stream-json
src/verify.ts         detect + run tests/build
src/store.ts          atomic run store
src/doctor.ts         host + package checks
src/install.ts        copy plugin to ~/.minimax/plugins
scripts/run-store.mjs no-build fallback for TUI-only users
scripts/doctor.mjs    static tree + smoke (CI)
```

`OMM_MCODE` overrides the `mcode` binary (tests inject `test/fixtures/fake-mcode.mjs`).

## Schemas

`schemas/*.schema.json` describe events, task DAGs, findings, and evidence records. Event types: `run_created`, `phase_changed`, `task_started`, `task_completed`, `tool_called`, `test_ran`, `finding_emitted`, `repair_requested`, `run_accepted`, `run_rejected`, `run_resumed`.

## What v0 will not do

- Agent Team / recursive spawn
- Register hooks, slash commands, or custom host agents
- Telemetry, install-time network, secrets
- Symlinks inside the package
