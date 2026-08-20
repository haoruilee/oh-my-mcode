# Oh My MiniMax Code

**Not more agents. Verified completion with evidence.**

`oh-my-mcode` (alias `omm`) is MiniMax Code's verified-delivery layer: **Describe → Plan → Build → Verify → Ship**, with a durable run on disk and an independent check that the writer cannot grade.

It is **not** a Claude-style multi-agent prompt pack, and it is **not** an official MiniMax-AI product. Author: [haoruilee](https://github.com/haoruilee). License: MIT.

```bash
oh-my-mcode max "fix the failing auth tests and prove they pass"
```

`max` is the only command you must remember. Alias: `omm`. This is not a registered `/max` host command.

## Why this exists

MiniMax Code already has Plan Mode, Goal, session resume, `mcode exec`, and a plugin marketplace. Superpowers-style packs add methodology. That is not the gap.

The gap is **owning the delivery loop**: a run you can continue, tests you did not invent in prose, a verifier that cannot edit the product, and a folder you can attach to a PR.

Role files are contracts, not spawned personas. Flat `team` is TypeScript scheduling of independent builders — not a Sisyphus tree and not host desktop `/team`.

We **coexist** with host `/plan`, `/goal`, `/resume`, and desktop `/team`. Those stay the host's. We add durable run/evidence. We do not replace Plan Mode, and our `plan` / `resume` / `team` skills do not register those slash commands.

## Install (mcode 0.1.6)

Requires Node 22+ and MiniMax Code CLI **`mcode`** 0.1.6 (`@minimax-ai/code`).

```bash
git clone https://github.com/haoruilee/oh-my-mcode
cd oh-my-mcode
npm install
npm link
oh-my-mcode doctor
oh-my-mcode install
```

`oh-my-mcode install` **copies** the plugin into `~/.minimax/plugins/oh-my-mcode` (no symlinks). On 0.1.6 that drop-in auto-installs and enables it. Confirm with the host:

```bash
mcode --version
mcode plugin list -m local
mcode plugin list -m local --json
```

Do **not** install this from [MiniMax-AI/skills](https://github.com/MiniMax-AI/skills). That repository is a Claude / Cursor / Codex / OpenCode pack, not a MiniMax Code plugin.

Official MiniMax catalog listing is a separate registry — this repo does not claim to be listed there.

## Invoke

**CLI (owns the loop):**

```bash
oh-my-mcode max "fix the failing auth tests and prove they pass"
oh-my-mcode plan "migrate mysql to postgres"
oh-my-mcode verify [run_id]
oh-my-mcode resume [run_id]
oh-my-mcode review [run_id]
oh-my-mcode ship [run_id]
oh-my-mcode research "how auth tokens rotate"
oh-my-mcode attach [run_id]
oh-my-mcode status [run_id]
oh-my-mcode cancel [run_id]
oh-my-mcode inspect skills
oh-my-mcode team "split independent builder tasks"
oh-my-mcode doctor
oh-my-mcode install
```

**TUI (same contract):** after the plugin is installed, you can also say `max mode: …`, `make a verified plan`, `re-verify this run`, `review this run`, or `research …`. Skills trigger on phrasing. They do not register `/max`, `/plan`, `/resume`, or `/team`.

Host `/plan` is Plan Mode. Host `/resume` is session resume. Host `/goal` is Goal. Desktop `/team` is Agent Team. Use those when you want the host feature. Use `oh-my-mcode` when you want a durable run with evidence.

## Commands

| Command | What it does |
| --- | --- |
| `max <goal>` | Full loop to Accepted evidence. Optional `--team`, `--worktree`, `--ralph` |
| `plan <goal>` | DISCOVER + PLAN + PLAN_REVIEW. No product edits |
| `verify [run_id]` | Independent acceptance (deterministic first) |
| `resume [run_id]` | Continue the saved run. Never invents a new goal |
| `review [run_id]` | Read-only review of diff + evidence. Writes findings. **Cannot Accept** |
| `ship [run_id]` | Accepted only. Release notes + suggested git/PR commands. Role = Release |
| `research <topic>` | DISCOVER-only (Explorer). No builder. Writes `research.md` |
| `attach [run_id]` | HUD. `--watch` tails events |
| `status [run_id]` | One-shot HUD |
| `cancel [run_id]` | Mark cancelled; persist `run_cancelled` |
| `inspect <topic>` | `tools` \| `skills` \| `agents` \| `context` \| `runs` \| `model-policy` (context includes `host_session_id`) |
| `team <task>` | Flat team mode (explicit). Sequential `max` stays the default |
| `doctor` | Host + package health (requires MCP manifest + server) |
| `install` | Copy plugin into `~/.minimax/plugins/oh-my-mcode` |

`max` / `plan` / `team` accept `--session <id>` (attach an existing host session) and `--no-session` (cold-start every `mcode exec`). Default is one host session per run.

`ship` does not `git push` unless you pass `--commit` and git is clean enough. Default is notes + a command list.

## HUD

`attach` / `status` read the same `.minimax/runs/<id>/` folder the TUI skills use:

```
Run: run_...  Phase: VERIFY  Status: running
Goal: ...
Explorer ✓  Planner ✓  Builder ◉  Verifier ...
Tasks:
  ✓ inspect auth
  ◉ implement rotation
  ○ security review
Evidence: 8 files  Repairs: 1/3  Cache/cost: n/a if unknown
```

That is the App/CLI unification until the host exposes a daemon API. We do not ship App panels.

## Session continuity

Each oh-my-mcode run binds **one host `mcode` session** and persists `host_session_id` (and optional `host_continue`) on `run.json`. The first `mcode exec` of a run is a cold start (or `--continue` if you passed that flag). After it returns, we take a session id from stream-json (`session` / `session_id` / `sessionId`, or `id` on `exec.result` / `metadata`). If the host does not echo one, we synthesize a stable `omm_<run_id>` token and still pass `--session` plus `--continue` on later calls so the host can resume latest-in-cwd as fallback.

Later phases of **that** run (plan, build, verify-llm, review, research, team builders in the same workspace) pass `--session <id>`. Parallel team worktrees are the exception: they use a different cwd, so they may open their own session instead of inheriting the parent run's.

After `max` / `team` / `plan`, the CLI prints:

```
mcode --session <id>
mcode --continue
```

so the TUI/App can open the same host session. `oh-my-mcode inspect context` shows `host_session_id`. `--no-session` is the tests / escape hatch.

## MCP tools

The plugin ships a dependency-free stdio MCP server (`mcp/server.mjs`, listed from `mcp.json`). Workspace is cwd or `OMM_WORKSPACE`. If the TUI exposes `omm_*` tools, use them instead of hand-writing run files.

| Tool | What it does |
| --- | --- |
| `omm_run_create` | Create a run (`{ goal }`) |
| `omm_run_show` | Show one run (`{ run_id? }`) |
| `omm_run_list` | List runs |
| `omm_status` | Same HUD text as `oh-my-mcode status` |
| `omm_verify` | Deterministic verify only (no builder) |
| `omm_inspect` | `inspect` topics (`{ topic, run_id? }`) |

This is not a registered `/max` host command. Host `/plan` `/goal` `/resume` `/team` stay the host's.

## Team

`oh-my-mcode team` and `max --team`:

- Planner emits a DAG with roles explorer / planner / builder / verifier / release
- Independent builder tasks (no unsatisfied deps) may run in parallel via separate `mcode exec` processes
- Optional git worktree per parallel builder (`--worktree`) under `.minimax/worktrees/<run>/<task>`; merge back only after that task's verify slice passes; cleaned up on cancel
- Sub-agents do **not** spawn grandchildren. The TypeScript orchestrator is the only scheduler
- Verifier remains a separate phase; builders never mark Accepted
- Concurrency default 2
- Sequential `max` stays the default; team is explicit

This is **not** host desktop `/team` and **not** a recursive agent tree.

## inspect

`oh-my-mcode inspect skills` lists packaged skills and whether they exist on disk. A skill listed in the manifest but missing on disk is an **error** (configured but invisible), never a silent drop.

| Topic | Output |
| --- | --- |
| `tools` | `mcode` on PATH + `mcode plugin list --json` if available |
| `skills` | Packaged skills vs disk |
| `agents` | The 5 role contracts and their permissions |
| `context` | One run: goal, phases, files/evidence (`--run id`) |
| `runs` | `.minimax/runs` |
| `model-policy` | What we send to `mcode exec` (permission, role, stable prompt prefix) |

## Config

Flags override files. Files, in order: `~/.minimax/oh-my-mcode.json` then `<workspace>/.minimax/oh-my-mcode.json`.

```json
{
  "permission": "smart",
  "maxRepairs": 3,
  "team": { "concurrency": 2, "worktree": false },
  "llmVerify": true
}
```

`--ralph` continues until Accepted using the existing repair bound. Repeated failure signatures stop the loop and escalate in `summary.md`. Resume never invents a new goal; `tasks.json` is the source of truth.

## What evidence looks like

```
<workspace>/.minimax/runs/<run_id>/
  run.json         phase + status
  plan.md          DAG in prose
  tasks.json       tasks + acceptance[]
  events.jsonl     append-only machine log
  evidence/        command logs, test output, diffs
  findings.json    verifier verdict (only Verify writes Accepted)
  review.json      read-only review (cannot Accept)
  research.md      DISCOVER-only note
  release.md       ship notes
  summary.md       human report
```

Accepted requires **evidence files on disk**. An LLM judge, if used, is optional and read-only. It is never the only signal.

See `examples/sample-run/` for a finished Accepted snapshot.

## Workflow

`INTAKE → DISCOVER → PLAN → PLAN_REVIEW → EXECUTE → VERIFY → (REPAIR)×≤3 → ACCEPT → RELEASE`

Phase lists come from `workflows/*.yaml` (including `review`, `ship`, `research`, `team`). VERIFY prefers real test/build commands from the repo. The writer never grades their own work.

## Evals

```bash
npm run eval
```

`evals/` is a **fixture harness** (pass, fail-then-repair, plan-only) plus a checked-in baseline. It uses StubMcode / fake-mcode. It does **not** claim production ΔY statistics.

## What this is not

- Not a Superpowers clone (more methodology is not the product)
- Not twenty agents / host Agent Team / a Sisyphus orchestrator
- Not a replacement for host `/plan` / `/goal` / `/resume` / `/team`
- Not `mavis max` or an `mmx` wrapper — the host binary remains `mcode`
- Not installable via MiniMax-AI/skills
- Not official MiniMax-AI ownership
- Not listed on the official marketplace unless MiniMax later accepts a submission
- Not App panels, registered `/max`, or hooks — those need a public MiniMax Extension API. See [docs/roadmap.md](docs/roadmap.md)

## Compatibility

| Host | Package | Status |
| --- | --- | --- |
| MiniMax Code CLI / desktop | `@minimax-ai/code` **0.1.6** | Tested against this version |
| Public plugin surface | Skills + MCP only | We ship Skills + portable MCP (`mcp.json`) |
| Host slash commands | `/plan` `/goal` `/resume` `/team` | Coexist; we do not register them |
| Hooks, Commands, custom Agents, LSP, Apps | Not public | Not advertised as working |

## Development

```bash
npm test
npm run eval
node scripts/doctor.mjs
oh-my-mcode doctor --package-only
```

No install-time network, no telemetry, no secrets, no package symlinks.

## Docs

- [Host reality](docs/host-reality.md)
- [Architecture](docs/architecture.md)
- [Roadmap](docs/roadmap.md)
- [中文说明](README.zh-CN.md)
