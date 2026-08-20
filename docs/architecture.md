# Architecture

The public product is a **Skill-first plugin** plus the `oh-my-mcode` / `omm` CLI that owns the loop. Role files are contracts, not spawned personas. No empty monorepo of fake packages (`workflow-engine`, `sdk`, `app-widgets`).

## Promise

Not more agents, more skills, or longer memory. Verified completion with evidence.

## One window, one store

| Surface | Entry | Who drives the loop |
| --- | --- | --- |
| TUI | "max mode: …" / "make a verified plan" / "re-verify this run" | Skills `max` / `plan` / `verify` / `resume` / `review` / `ship` / `research` / `team` |
| CLI (owns the loop) | `oh-my-mcode max` / `omm` | TypeScript orchestrator |
| Headless | `mcode exec` + a prompt that loads the max skill | still `mcode`, not an `mmx` / `mavis` wrapper |

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

`scripts/run-store.mjs` is the no-build tool skills should call for state changes. TypeScript under `src/` is the same contract used by the CLI, tests, and CI. Alias `omm` is this binary, not `mavis max`.

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

Event types: `run_created`, `phase_changed`, `task_started`, `task_completed`, `tool_called`, `test_ran`, `finding_emitted`, `repair_requested`, `run_accepted`, `run_rejected`, `run_resumed`, plus `review_completed`, `ship_prepared`, `research_completed`, `task_cancelled`, `team_spawned`, `worktree_created`, `hud_attached`, `run_cancelled`.

Workflow YAML under `workflows/` is parsed by `src/workflows.ts` and drives stop-after / phase lists.

Flat team (`src/team.ts`) schedules independent builders. Optional worktrees: `src/worktree.ts`. HUD: `src/hud.ts`. Config: `src/config.ts`. Tool repair: `src/tool-repair.ts`.

## What we will not do

- Recursive spawn / Sisyphus orchestrator (project-manager duties stay in TypeScript)
- Register hooks, slash commands, or custom host agents
- Replace host Plan Mode or host `/team`
- Ship `mavis max` / `mmx` wrappers — the host binary remains `mcode`
- Tell anyone to install via MiniMax-AI/skills
- Telemetry, install-time network, secrets
- Symlinks inside the package
- Advertise App panels or registered `/max` as shipped (see `docs/roadmap.md`)
