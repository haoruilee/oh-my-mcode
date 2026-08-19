# Architecture

v0 is **OMM Lite**: one host agent + this workflow. The public product is a **Skill-first plugin**. Role files are contracts, not spawned personas. No empty monorepo of fake packages. No second user-facing CLI.

## Promise

Not more agents, more skills, or longer memory. Verified completion with evidence.

## One window, one store

| Surface | Entry | Who drives the loop |
| --- | --- | --- |
| TUI (the product) | "max mode: …" / "make a verified plan" / "re-verify this run" | Skills `max` / `plan` / `verify` / `resume` |
| Headless later | `mcode exec` + a prompt that loads the max skill | still `mcode`, not a wrapper binary |

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

`scripts/run-store.mjs` is the no-build tool skills should call for state changes. TypeScript under `src/` is the same contract used by tests/CI. It is not advertised as `omm` or `mavis max`.

## Phase machine

```
INTAKE → DISCOVER → PLAN → PLAN_REVIEW → EXECUTE → VERIFY → (REPAIR)* → ACCEPT → RELEASE
```

- PLAN_REVIEW writes the plan; default is auto-continue unless the user asked for a plan only.
- EXECUTE follows a **tight Task Contract** (objective, allowed files, acceptance).
- VERIFY is independent. Only the `verify` skill may set Accepted / Rejected. Accepted is refused without evidence files.
- REPAIR turns findings into one new Builder task. Bound the loop. Repeated failure signatures stop it.
- RELEASE is git/PR **after** Accepted, and only if asked.

Host `/plan` / `/goal` / `/resume` / `/team` are unchanged. This machine is the oh-my-mcode run, not Plan Mode.

## Code map

```
skills/*/SKILL.md     TUI contracts (natural language only)
agents/*.md           role contracts for the same host agent
scripts/run-store.mjs atomic run store (TUI-safe, no extra CLI)
scripts/doctor.mjs    package + sample-run checks
src/*.ts              same store/verify machine for tests
schemas/*.schema.json events, tasks, findings, evidence
```

## Schemas

Event types: `run_created`, `phase_changed`, `task_started`, `task_completed`, `tool_called`, `test_ran`, `finding_emitted`, `repair_requested`, `run_accepted`, `run_rejected`, `run_resumed`.

## What v0 will not do

- Agent Team / recursive spawn
- Register hooks, slash commands, or custom host agents
- Replace host Plan Mode
- Ship `omm` / `mavis max` / `mmx` as a user-facing wrapper
- Tell anyone to install via MiniMax-AI/skills
- Telemetry, install-time network, secrets
- Symlinks inside the package
