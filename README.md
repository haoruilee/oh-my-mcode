# Oh My MiniMax Code

**Not more agents. Verified completion with evidence.**

`oh-my-mcode` is MiniMax Code's verified-delivery layer: **Describe → Plan → Build → Verify → Ship**, with a durable run and an independent check that the writer cannot grade.

It is the OMX-shaped product for `mcode`: one hero entry, a default workflow, disk state, deterministic verification, a repair loop, doctor, and visible evidence. It is **not** a Claude-style multi-agent prompt pack, and it is **not** an official MiniMax-AI product. Author: [haoruilee](https://github.com/haoruilee). License: MIT.

```bash
oh-my-mcode max "fix auth and prove tests pass"
```

`max` is the only command you must remember.

## Why this exists

MiniMax Code already has agents, Plan Mode, Goal, session resume, `mcode exec`, and a plugin marketplace. Superpowers-style packs add methodology. That is not the gap.

The gap is **owning the delivery loop**: a run you can resume, tests you did not invent in prose, a verifier that cannot edit the product, and a folder you can attach to a PR.

v0 is **OMM Lite** — one host agent + this workflow. Role files are contracts, not spawned personas. Agent Team comes later, when the host exposes spawn/cancel/resume APIs.

## Install (mcode 0.1.6)

Requires Node 22+ and MiniMax Code CLI `mcode` 0.1.6 (`@minimax-ai/code`).

```bash
git clone https://github.com/haoruilee/oh-my-mcode
cd oh-my-mcode
npm install && npm link   # or npm pack / npx
oh-my-mcode install       # copies plugin into ~/.minimax/plugins/oh-my-mcode
oh-my-mcode doctor
oh-my-mcode max "..."
```

`oh-my-mcode install` is a **copy**, not a symlink (packages cannot contain symlinks). On 0.1.6, dropping a folder into `~/.minimax/plugins` auto-installs and enables it. Confirm:

```bash
mcode --version
mcode plugin list -m local
mcode plugin list -m local --json
```

You can also run `scripts/install.sh` or `scripts/install.ps1`. Official catalog listing is a separate registry — this repo does not claim to be listed there.

## Invoke

**CLI (owns the loop):**

```bash
oh-my-mcode max "fix auth and prove tests pass"
oh-my-mcode plan "migrate mysql to postgres"
oh-my-mcode verify [run_id]
oh-my-mcode resume [run_id]
oh-my-mcode doctor
oh-my-mcode install
```

Alias: `omm`.

**TUI (same contract):** in MiniMax Code desktop or `mcode`, say:

> max mode: fix the failing auth tests and prove they pass

That triggers the `max` **Skill**. It is not a registered `/max` command. The host already has `/plan`, `/goal`, `/resume`. We coexist.

If the CLI is missing, the Skill still writes `<workspace>/.minimax/runs/<run_id>/` so TUI-only users get a real run.

## What evidence looks like

```
<workspace>/.minimax/runs/<run_id>/
  run.json         phase + status
  plan.md          DAG in prose
  tasks.json       tasks + acceptance[]
  events.jsonl     append-only machine log
  evidence/        command logs, test output, diffs
  findings.json    verifier verdict (only Verify writes Accepted)
  summary.md       human report
```

Accepted requires **evidence files on disk**. An LLM judge, if used, is optional and read-only. It is never the only signal.

See `examples/sample-run/` for a finished Accepted snapshot.

## Workflow

`INTAKE → DISCOVER → PLAN → PLAN_REVIEW → EXECUTE → VERIFY → (REPAIR)×≤3 → ACCEPT → RELEASE`

VERIFY runs detected project tests/builds in process (`package.json` scripts, `go test`, `pytest`, `cargo test`, …), then may ask `mcode exec` for leftover judgment with writes forbidden. The writer never grades their own work.

## What this is not

- Not a Superpowers clone (more methodology is not the product)
- Not twenty agents / Agent Team / a Sisyphus orchestrator
- Not a second MiniMax CLI wrapping `mavis` (`mavis max` does not exist here)
- Not official MiniMax-AI ownership
- Not listed on the official marketplace unless MiniMax later accepts a submission

## Compatibility

| Host | Package | Status |
| --- | --- | --- |
| MiniMax Code CLI / desktop | `@minimax-ai/code` **0.1.6** | Tested against this version |
| Public plugin surface | Skills + MCP only | We ship Skills, no MCP in v0 |
| Hooks, Commands, custom Agents, LSP, Apps | Not public | Not advertised as working |

## Roadmap

- **Lite (now):** CLI orchestrator + Skill plugin + run store + deterministic verify
- **Team:** when the host exposes spawn/cancel/resume APIs
- **Slash commands:** when Commands are a public plugin capability

## Development

```bash
npm test              # tsc + node:test (mocked mcode)
node scripts/doctor.mjs
oh-my-mcode doctor --package-only
```

No install-time network, no telemetry, no secrets, no package symlinks.

## Docs

- [Host reality](docs/host-reality.md)
- [Architecture](docs/architecture.md)
- [中文说明](README.zh-CN.md)
