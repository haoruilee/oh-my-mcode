# Architecture

The public product is a **Skill-first plugin** plus the `oh-my-mcode` / `omm` CLI that owns the loop. Role files are contracts, not spawned personas. No empty monorepo of fake packages (`workflow-engine`, `sdk`, `app-widgets`).

## Promise

Not more agents, more skills, or longer memory. Verified completion with evidence.

## One window, one store

| Surface | Entry | Who drives the loop |
| --- | --- | --- |
| TUI | "max mode: …" / "make a verified plan" / "re-verify this run" | Skills `max` / `plan` / `verify` / `resume` / `review` / `ship` / `research` / `team` / `interview` |
| CLI (owns the loop) | `oh-my-mcode max` / `omm` | TypeScript harness + orchestrator |
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

- PLAN_REVIEW writes the plan; default is auto-continue unless the user asked for a plan only. Failed discover/plan yields stay in that phase as rejected — `plan` does not sit in PLAN_REVIEW as if a plan was written.
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
src/harness.ts        one core: submit / subscribe / bind a run
src/subagent.ts       one role worker, no grandchildren; schema-validated yield
src/yield.ts          strict worker yield (parent parses exec.result.answer / assistant JSON / structuredOutput.data)
src/tps.ts            doctor --tps (unmeasured on stub)
src/hash.ts           content-hash evidence; stale hash refuses Accept
src/*.ts              store/verify machine; CLI and MCP call submit
schemas/*.schema.json events, tasks, findings, evidence, worker-yield
docs/harness.md       Codex-as-platform map (host-honest)
```

## Schemas

Event types: `run_created`, `phase_changed`, `task_started`, `task_completed`, `tool_called`, `test_ran`, `finding_emitted`, `repair_requested`, `run_accepted`, `run_rejected`, `run_resumed`, plus `review_completed`, `ship_prepared`, `research_completed`, `task_cancelled`, `team_spawned`, `worktree_created`, `hud_attached`, `run_cancelled`, `host_session_bound`, `interview_completed`, `subagent_spawned`.

`src/harness.ts` is the one core: `submit(op)` / subscribe / bind a run (thread). CLI and MCP are surfaces. `src/subagent.ts` spawns one role worker (`mcode exec`) with a Task Contract. No grandchildren. See [harness.md](harness.md).

One host session per run (`run.json.host_session_id`) after the host returns a real id — first exec does not send a synthesized `omm_<runId>` token. `extractHostSessionId` also reads `cursor: sse1:session%3Amvs_…` and `YOUR SESSION ID: mvs_…`. The one yield reminder reuses that `--session` (not `--continue`; 0.2.1 treats them as mutually exclusive / invocation exit 2) with `--max-steps 1` and `--permission off` (no tool loop). Parallel team worktrees may use their own session because cwd differs. Default worker exec does **not** pass `--output-schema` (mcode 0.2.1 returns exit 70 on that path). Schemas stay on disk; TypeScript validates the yield. `OMM_HOST_OUTPUT_SCHEMA=1` opts back into the JSON-object flag. Host `--timeout` must carry a unit (`180s`); a bare `180` is 180ms on 0.2.1 and exits 6. Role `--max-steps` / `--permission` defaults reach argv. Assistant `delta.content` is stitched; evidence is a typed snapshot, not raw JSONL. Verifier/review attach evidence via `--file`. TUI should call MCP `omm_*` tools when present (`mcp/server.mjs`).

Workflow YAML under `workflows/` is parsed by `src/workflows.ts` and drives stop-after / phase lists.

Flat team (`src/team.ts`) schedules independent builders via `spawnSubagent` with one `{ context, tasks[] }` packet. Optional worktrees: `src/worktree.ts`. HUD: `src/hud.ts`. Config: `src/config.ts`. Tool repair: `src/tool-repair.ts`. Interview intake: `src/interview.ts`. Worker prompts are contract-only (`src/prompts.ts`).

## What we will not do

- Recursive spawn / Sisyphus orchestrator (project-manager duties stay in TypeScript)
- Register hooks, slash commands, or custom host agents
- Replace host Plan Mode or host `/team`
- Ship `mavis max` / `mmx` wrappers — the host binary remains `mcode`
- Tell anyone to install via MiniMax-AI/skills
- Telemetry, install-time network, secrets
- Symlinks inside the package
- Advertise App panels or registered `/max` as shipped (see `docs/roadmap.md`)
