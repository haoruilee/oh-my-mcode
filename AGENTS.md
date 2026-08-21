# AGENTS.md

**IMPORTANT:** This file is the source of truth for agent instructions. Update it (or a nested `AGENTS.md`) when adding guidance. Do not add a parallel `CLAUDE.md` / Cursor rules dump.

## Commands

| Gate | Command |
| --- | --- |
| hermetic | `npm test` |
| hermetic eval | `npm run eval` (fixture harness; not live `mcode`) |
| CI | `.github/workflows/hermetic.yml` runs the two hermetic gates on push/PR to `main`. No live `mcode`, no MiniMax secrets. |
| live rematch | `oh-my-mcode plan` or `oh-my-mcode max` on a **copy** of `test/fixtures/hello-pkg` |

This repo uses **npm**. Do **not** use bun or pnpm — those rewrite the lockfile. Do not run a production publish or `npm publish` in an agent session.

Contributor operating manual for **oh-my-mcode**. Not a skill-pack blurb. This file does not become the orchestrator.

North star: **Not more agents. Ship with evidence. The TypeScript harness owns the loop. `mcode` is the host.**

## Default context

This repo is a **verified-delivery harness** that drives `mcode exec`. The plugin / TUI is a window. `src/orchestrator.ts` owns verify, repair, resume, and evidence. CLI and MCP share one core (`src/harness.ts` `submit`).

Unless the user says otherwise, assume work is this package — not a new host product, not a second runtime.

**Terminology** — when the user says **agent**, they mean **this product** (the MiniMax host process + our harness), not you (the assistant in this session).

| Term | Means |
| --- | --- |
| **max** | Hero command `oh-my-mcode max` (alias `omm`). Owns DISCOVER → PLAN → PLAN_REVIEW → EXECUTE → VERIFY → ACCEPT. |
| **plan** | `oh-my-mcode plan`. Stops at PLAN_REVIEW. Does **not** Accept. |
| **worker** | One role contract in `agents/*.md` for the **same** MiniMax host process. One `mcode exec`. No grandchildren. |
| **mcode** | Host binary (`@minimax-ai/code`). We do not wrap it as `mmx` / `mavis`. |
| **run store** | `<workspace>/.minimax/runs/<run_id>/` — `run.json`, `plan.md`, `tasks.json`, `events.jsonl`, `evidence/`, `findings.json`, `summary.md`. |

Host already has explore / plan / team. Role files do **not** register new host agents. Do not pretend we spawned Sisyphus.

## Layout

| Path | What it is |
| --- | --- |
| `src/orchestrator.ts` | Phase machine. `plan` stops at PLAN_REVIEW. `max` continues to ACCEPT. |
| `dist/` | Generated `tsc` output. Edit `src/`, then `npm test`. Do not hand-edit compiled JS. |
| `src/harness.ts` | One core: `submit` / subscribe / bind. CLI and MCP call this. |
| `src/subagent.ts` | One role worker per `mcode exec`. Depth ≥ 1 throws. |
| `src/yield.ts` | `schemaMode=strict`. Parent parses `exec.result.answer` / assistant JSON / `structuredOutput.data`. |
| `src/mcode.ts` | Host argv + exit map. Default omits `--output-schema`. |
| `agents/*.md` | Five role contracts for the same host process. |
| `skills/*/SKILL.md` | TUI phrasing (`max` / `plan` / `verify` / …). Not a second loop. |
| `schemas/*.schema.json` | On-disk schemas. TypeScript validates. |
| `docs/host-reality.md` | Observed mcode 0.2.1 contract. Read this; do not invent. |
| `docs/design-check.md` | Eight questions after each cut. Fail → change the cut. |
| `docs/harness.md` | Codex-as-platform map. |
| `test/host-contract.test.mjs` | Locked host argv / stream / yield contract. |
| `test/fixtures/hello-pkg` | Live rematch / plan-max fixture (`hello()` imported, `placeholder()` exported). Keep plan/max tests pointed here. |
| `test/fixtures/hello-repair` | Two-export fixture (`hello()` + `greet()` imported, only `placeholder()` exported). Hermetic `npm test` in the fixture must fail. |
| `test/fixtures/fake-mcode.mjs` | Hermetic stub. **Not** live QA. |
| `examples/AGENTS.max-mode.md` | Opt-in template for a **user** product repo. |

## Max Mode

An agent in **this** repo, or in a user project that installed the plugin, must drive the real loop — not re-implement phases in prose.

```bash
oh-my-mcode max "<goal>" --workspace <project> --permission smart
# alias:
omm max "<goal>" --workspace <project> --permission smart
```

| Command | Stops at | Accepts? | Edits product code? |
| --- | --- | --- | --- |
| `oh-my-mcode plan "<goal>"` | PLAN_REVIEW | No | No (run artifacts only) |
| `oh-my-mcode max "<goal>"` | ACCEPT | Only via verifier + evidence files | Yes, in EXECUTE |
| TUI phrasing `max mode: …` | same as `max` | same | same |
| TUI phrasing `make a verified plan` | PLAN_REVIEW | No | No |

`--workspace` is the project being changed (default: cwd). `--permission smart` is the usual builder mode (`ask|smart|full|off`). `--no-llm-verify` skips the optional read-only LLM judge; deterministic verify still runs.

Run store: `<workspace>/.minimax/runs/<run_id>/`. If there is no folder, the loop did not run.

User-project copy-paste: [`examples/AGENTS.max-mode.md`](examples/AGENTS.max-mode.md). `oh-my-mcode install` does **not** write that file over a project `AGENTS.md`.

## Workers

Five roles. Same host process. One exec each. Point at the contract file — do not invent a sixth.

| Who | File | Mode | May | Must not | Yield |
| --- | --- | --- | --- | --- | --- |
| explorer | [`agents/explorer.md`](agents/explorer.md) | read-only discover | Read/search; diagnostic commands | Edit product files; Accept; spawn | Tiny JSON after the map. Greenfield is `ok` + notes, not `blocked`. |
| planner | [`agents/planner.md`](agents/planner.md) | plan artifacts only | Write `plan.md` / `tasks.json` via the run store | Edit product code; start EXECUTE; Accept | Schema-valid yield. DAG + `acceptance[]` a verifier can run. |
| builder | [`agents/builder.md`](agents/builder.md) | configured permission (default smart) | Edit the current task; run cheap tests | Accept; spawn grandchildren; second task / scope-creep | Files + commands + leftover risk. Writer never grades the writer. |
| verifier | [`agents/verifier.md`](agents/verifier.md) | read-only judge | Read diffs; write findings / evidence | Edit product code; Accept without evidence files | **Only this role** may set Accepted / Rejected. |
| release | [`agents/release.md`](agents/release.md) | ask / user git | git/PR **after** `status=accepted` | Ship a non-accepted run; force-push unless asked; Accept | Stop if the run is not Accepted. |

Flat `team` is TypeScript scheduling of sibling builders (`src/team.ts`). Still no grandchildren.

## Host contract

Do not copy this file into a user template. Facts live in [`docs/host-reality.md`](docs/host-reality.md) and are locked in [`test/host-contract.test.mjs`](test/host-contract.test.mjs). Resist bloating `src/orchestrator.ts` / `src/mcode.ts`. New host-contract facts go in `docs/host-reality.md` + a test, not another prompt paragraph.

Observed on **mcode 0.2.1** (2026-08-21), then rematched:

- `--timeout` needs a unit (`180s`). A bare `180` is 180ms (exit 6).
- `--session` XOR `--continue`. Together → invocation, exit 2.
- `--permission off` is legal (`ask|smart|full|off`).
- Exit 1 is crash / incomplete stream, not timeout.
- Session id is `mvs_…` (also `cursor: sse1:session%3Amvs_…`, `YOUR SESSION ID: mvs_…`).
- Stitch assistant `delta.content`. Persist a typed snapshot. Do **not** dump raw host JSONL into the next prompt.
- Coerce artifact objects with `path` / `file` to strings. Ignore unknown yield keys. Do **not** invent a WorkerYield from prose.
- Default argv **omits** `--output-schema` (live host exit 70). `OMM_HOST_OUTPUT_SCHEMA=1` is opt-in only. `schemaMode=strict` stays in TypeScript.
- Cap: one schema reminder + at most one native-crash retry (sqlite / assert / SIGABRT in stderr).
- Node 24 + better-sqlite3 can GC-abort (`Statement::~Statement`). Live rematch used Node 22, then rebuilt the addon back to 24. That is host reality — not “we cannot use Node 22”.
- Rematch on a copy of `test/fixtures/hello-pkg`: `plan` reached PLAN_REVIEW; `max --no-llm-verify` reached ACCEPT / `accepted` and wrote `hello()`.

## QA

`npm test` is the **hermetic gate**. Typecheck is **not** QA. `bun test` is not a command here.

A change that touches spawn / yield / host argv / orchestrator **must** also name a **live rematch** and leave evidence on disk:

```bash
# copy the fixture — do not mutate the tree copy
oh-my-mcode plan "<goal>" --workspace <hello-pkg-copy> --permission smart
# or the hero:
oh-my-mcode max "<goal>" --workspace <hello-pkg-copy> --permission smart --no-llm-verify
```

Evidence is `<hello-pkg-copy>/.minimax/runs/<run_id>/` (`run.json` phase/status, snapshots, `discover.md` / `plan.md`, evidence files). **If there is no evidence file, QA did not happen.**

`test/fixtures/fake-mcode.mjs` is the stub. Stub green is not live QA. `doctor --smoke` / `--tps` against a real `mcode` are host health, not a rematch of the loop.

## Testing contract

Test the contract the system exposes — not the easiest internal detail to assert.

- **Name the failure mode** or do not add the test. What does a consumer observe if this regresses?
- **No source-grep tests.** Do not read `src/*.ts` and `expect(src).toContain(...)`.
- **No invented yield in tests.** Use `test/helpers/yield.mjs`. Do not synthesize a WorkerYield from prose.
- Good: argv / exit / stream / yield transform, phase stop (`plan` ≠ PLAN_REVIEW on failed yield), Accept refused without evidence, install does not write a project `AGENTS.md`.
- Bad: “file contains this string”, success passthrough, prompt-boilerplate asserts.

## DESIGN CHECK

After each cut, answer the eight questions in [`docs/design-check.md`](docs/design-check.md). **Fail a check → change the cut.** Do not keep a failing check as a footnote.

## Always / Ask / Never

**Always**
- Drive `max` / `plan`. Leave evidence under `.minimax/runs/`.
- `npm test` before claiming hermetic green.
- DESIGN CHECK fail → change the cut.

**Ask**
- Commit, merge, `npm publish`, force-push.
- Live rematch that would rebuild better-sqlite3 on the user’s daily Node 24 `mcode`.

**Never**
- Hooks. Registered host agents. Fake host `/max`.
- Hashline / `[PATH#TAG]` / PUT/CUT (content-hash stale-reject stays in `src/hash.ts`).
- Grandchildren. Sisyphus / Prometheus / 32-agent catalog.
- Invent a WorkerYield from prose. Do not loosen `validateWorkerYield`.
- `--output-schema` by default. Dump raw host JSONL into the next prompt.
- Overwrite a user project `AGENTS.md` on install. Clone other repos into this one.
- Run live `mcode` under Node 22 while the better-sqlite3 addon is compiled for 137 (or vice versa) without an explicit rebuild.
