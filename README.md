# Oh My MiniMax Code

**Not more agents. Verified completion with evidence.**

A Skill-first plugin for MiniMax Code: **Describe → Plan → Build → Verify → Ship**, with a durable run on disk and an independent check that the writer cannot grade.

It is **not** a Claude-style multi-agent prompt pack, **not** an official MiniMax-AI product, and **not** a second CLI. Author: [haoruilee](https://github.com/haoruilee). License: MIT.

In MiniMax Code (desktop or `mcode` TUI), say:

> max mode: fix the failing auth tests and prove they pass

That is the hero entry. There is no registered `/max`.

## Why this exists

MiniMax Code already has Plan Mode, Goal, session resume, `mcode exec`, and a plugin marketplace. Superpowers-style packs add methodology. That is not the gap.

The gap is **owning the delivery loop**: a run you can continue, tests you did not invent in prose, a verifier that cannot edit the product, and a folder you can attach to a PR.

v0 is **OMM Lite** — one host agent + this workflow. Role files are contracts, not spawned personas.

We **coexist** with host `/plan`, `/goal`, `/resume`, and desktop `/team`. Those stay the host's. We add durable run/evidence. We do not replace Plan Mode, and our `plan` / `resume` skills do not register those slash commands.

## Install (mcode 0.1.6)

Requires MiniMax Code CLI **`mcode`** 0.1.6 (`@minimax-ai/code`). User install steps mention only `mcode`.

```bash
git clone https://github.com/haoruilee/oh-my-mcode
cd oh-my-mcode
./scripts/install.sh          # copies into ~/.minimax/plugins/oh-my-mcode
# Windows: powershell -File scripts/install.ps1
```

On 0.1.6, dropping a folder into `~/.minimax/plugins` auto-installs and enables it (copy, not symlink). Confirm with the host you already use:

```bash
mcode --version
mcode plugin list -m local
mcode plugin list -m local --json
```

Do **not** install this from [MiniMax-AI/skills](https://github.com/MiniMax-AI/skills). That repository is a Claude / Cursor / Codex / OpenCode pack, not a MiniMax Code plugin.

Official MiniMax catalog listing is a separate registry — this repo does not claim to be listed there.

## Invoke (natural language)

After the plugin is visible, talk to the agent. Skills trigger on phrasing, not slash commands:

| Say this | Skill |
| --- | --- |
| `max mode: <task>` / `verified mode` / `run this to accepted evidence` | `max` — full loop to Accepted evidence |
| `make a verified plan for …` / `make a plan only` | `plan` — discover + plan + review, no edits |
| `re-verify this run` | `verify` — independent acceptance |
| `continue the last oh-my-mcode run` | `resume` — restore a **run store** phase |
| `is the oh-my-mcode plugin installed?` | `doctor` |

Host `/plan` is Plan Mode. Host `/resume` is session resume. Host `/goal` is Goal. Desktop `/team` is Agent Team. Use those when you want the host feature. Use the sentences above when you want an oh-my-mcode run with evidence.

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
- Not a second user-facing CLI (`omm`, `mavis max`, `mmx` wrappers)
- Not a replacement for host `/plan` / `/goal` / `/resume` / `/team`
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

- **Lite (now):** Skill plugin + run store + independent verify
- **Team:** when the host exposes spawn/cancel/resume APIs for plugins
- **Slash commands:** when Commands are a public plugin capability — until then, natural language only

## Development

```bash
npm test
node scripts/doctor.mjs
```

No install-time network, no telemetry, no secrets, no package symlinks.

## Docs

- [Host reality](docs/host-reality.md)
- [Architecture](docs/architecture.md)
- [中文说明](README.zh-CN.md)
