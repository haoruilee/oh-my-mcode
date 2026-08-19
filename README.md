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

v0 is **OMM Lite** — one host agent + this workflow. Role files are contracts, not spawned personas.

We **coexist** with host `/plan`, `/goal`, `/resume`, and desktop `/team`. Those stay the host's. We add durable run/evidence. We do not replace Plan Mode, and our `plan` / `resume` skills do not register those slash commands.

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
oh-my-mcode doctor
oh-my-mcode install
```

**TUI (same contract):** after the plugin is installed, you can also say `max mode: …`, `make a verified plan`, or `re-verify this run`. Skills trigger on phrasing. They do not register `/max`, `/plan`, or `/resume`.

Host `/plan` is Plan Mode. Host `/resume` is session resume. Host `/goal` is Goal. Desktop `/team` is Agent Team. Use those when you want the host feature. Use `oh-my-mcode` when you want a durable run with evidence.

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

VERIFY prefers real test/build commands from the repo. The writer never grades their own work.

## What this is not

- Not a Superpowers clone (more methodology is not the product)
- Not twenty agents / Agent Team / a Sisyphus orchestrator
- Not a replacement for host `/plan` / `/goal` / `/resume` / `/team`
- Not `mavis max` or an `mmx` wrapper — the host binary remains `mcode`
- Not installable via MiniMax-AI/skills
- Not official MiniMax-AI ownership
- Not listed on the official marketplace unless MiniMax later accepts a submission

## Compatibility

| Host | Package | Status |
| --- | --- | --- |
| MiniMax Code CLI / desktop | `@minimax-ai/code` **0.1.6** | Tested against this version |
| Public plugin surface | Skills + MCP only | We ship Skills, no MCP in v0 |
| Host slash commands | `/plan` `/goal` `/resume` `/team` | Coexist; we do not register them |
| Hooks, Commands, custom Agents, LSP, Apps | Not public | Not advertised as working |

## Roadmap

- **Lite (now):** CLI orchestrator + Skill plugin + run store + independent verify
- **Team:** when the host exposes spawn/cancel/resume APIs for plugins
- **Slash commands:** when Commands are a public plugin capability — until then, CLI + natural language

## Development

```bash
npm test
node scripts/doctor.mjs
oh-my-mcode doctor --package-only
```

No install-time network, no telemetry, no secrets, no package symlinks.

## Docs

- [Host reality](docs/host-reality.md)
- [Architecture](docs/architecture.md)
- [中文说明](README.zh-CN.md)
