[![Oh My MiniMax Code](./.github/assets/hero.png)](https://github.com/haoruilee/oh-my-mcode#oh-my-minimax-code)

[![Preview](./.github/assets/preview.png)](https://github.com/haoruilee/oh-my-mcode#oh-my-minimax-code)

> *Not more agents. Ship with evidence. One `max`. A run you can paste into a PR.*

[![GitHub Release](https://img.shields.io/github/v/release/haoruilee/oh-my-mcode?color=369eff&labelColor=black&logo=github&style=flat-square)](https://github.com/haoruilee/oh-my-mcode/releases)
[![License](https://img.shields.io/badge/license-MIT-white?labelColor=black&style=flat-square)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/haoruilee/oh-my-mcode?color=ffcb47&labelColor=black&style=flat-square)](https://github.com/haoruilee/oh-my-mcode/stargazers)
[![GitHub Issues](https://img.shields.io/github/issues/haoruilee/oh-my-mcode?color=ff80eb&labelColor=black&style=flat-square)](https://github.com/haoruilee/oh-my-mcode/issues)
[![Node](https://img.shields.io/badge/node-%3E%3D22-3c873a?labelColor=black&logo=node.js&logoColor=white&style=flat-square)](package.json)
[![mcode](https://img.shields.io/badge/mcode-0.1.6-39c5bb?labelColor=black&style=flat-square)](https://www.npmjs.com/package/@minimax-ai/code)

[English](README.md) | [简体中文](README.zh-CN.md)

# Oh My MiniMax Code

You're juggling Plan Mode, Goal, and a pile of skill packs. Prompting. Hoping the tests go green.

We did the work. Durable run on disk. A verifier that cannot grade its own homework.

Install. Type `max`. Done.

```bash
oh-my-mcode max "fix the failing auth tests and prove they pass"
```

## Installation

Requires Node 22+ and MiniMax Code CLI **`mcode` 0.1.6** (`@minimax-ai/code`).

### TL;DR

| You want | Run | What lands |
| :--- | :--- | :--- |
| **Plugin + CLI** | `npx oh-my-mcode install` | Copy into `~/.minimax/plugins/oh-my-mcode` |
| **Health check** | `npx oh-my-mcode doctor` | Package + host checks. No network. |
| **Host smoke** | `oh-my-mcode doctor --smoke` | One tiny `mcode exec` (`pong`) + latency |
| **Host TPS** | `oh-my-mcode doctor --tps` | Real `mcode exec` stream-json usage (`input_tokens` included). Stub, missing host, or omitted `message.usage` prints `unmeasured` and exits non-zero unless `--allow-stub` |
| **From git (until npm publish)** | `npx github:haoruilee/oh-my-mcode install --yes` | Same drop-in, no registry publish required |

```bash
npx oh-my-mcode install --yes
npx oh-my-mcode doctor
```

Interim one-liner while this package is not on the public npm registry:

```bash
npx github:haoruilee/oh-my-mcode install --yes
```

Power-user (clone + link):

```bash
git clone https://github.com/haoruilee/oh-my-mcode
cd oh-my-mcode
npm install
npm link
oh-my-mcode doctor
oh-my-mcode install
```

On 0.1.6 that drop-in auto-installs and enables. Confirm with `mcode --version` and `mcode plugin list -m local`.

Do **not** install this from [MiniMax-AI/skills](https://github.com/MiniMax-AI/skills). That repo is a Claude / Cursor / Codex pack, not a MiniMax Code plugin.

## Highlights

| | Feature | What it does |
| :---: | :--- | :--- |
| ⚡ | **`max`** | One command. Plan → build → verify → ship. Doesn't Accept without evidence files. |
| ✅ | **`verify`** | Independent acceptance. Deterministic tests first. The writer never grades the writer. |
| 🔗 | **Session** | One host `mcode` session per run. Resume the same conversation. `--no-session` is the escape hatch. |
| 🔌 | **MCP** | Dependency-free stdio tools on the same harness: create / show / list / status / verify / interview / inspect. |
| 👥 | **`team`** | Flat TypeScript scheduling of independent builders. Explicit. Sequential `max` stays the default. |
| 🖥️ | **HUD** | `attach` / `status` read the same `.minimax/runs/<id>/` folder. No fake App panels. Tokens/cost when the host stream has them. |
| 🩺 | **`doctor`** | Host + package honesty. `--smoke` is a real pong exec. `--tps` measures host tok/s or prints `unmeasured` — it will not invent numbers on fake-mcode. |
| 🧪 | **Evals** | Fixture harness (pass / fail-then-repair / plan-only). Not a production ΔY claim. |

## Power commands

`max` is the only one you must remember. Alias: `omm`. The rest are power tools.

```bash
oh-my-mcode interview "migrate mysql to postgres"
oh-my-mcode max --interview "fix auth and prove tests pass"
oh-my-mcode plan "migrate mysql to postgres"
oh-my-mcode verify
oh-my-mcode resume
oh-my-mcode review          # read-only; cannot Accept
oh-my-mcode ship            # Accepted only
oh-my-mcode team "split independent builder tasks"
oh-my-mcode attach --watch
oh-my-mcode inspect skills
oh-my-mcode doctor --smoke
oh-my-mcode doctor --tps
```

In the TUI, say `max mode: …` or `interview this goal`. Skills trigger on phrasing.

`interview` asks four short questions (goal, constraints, acceptance, out of scope) and stops at PLAN_REVIEW. Non-TTY: `--answers answers.json` or `--constraint` (repeatable). No builder.

`max` / `plan` / `team` take `--session <id>` and `--no-session`. `ship` does not `git push` unless you pass `--commit`.

## Host honesty

`max` is not a registered `/max`. We coexist with host `/plan` `/goal` `/resume` `/team`. We do not replace Plan Mode. Official catalog listing is a separate registry — this repo does not claim to be on it.

## Uninstall

```bash
npm unlink -g oh-my-mcode
rm -rf ~/.minimax/plugins/oh-my-mcode
```

## Author's note

I'm [haoruilee](https://github.com/haoruilee). MIT license. Not an official MiniMax-AI product.

I wanted a delivery loop I could trust: a run that survives a crash, a verifier that cannot mark its own homework, a folder I can paste into a PR.

That's the product. PRs welcome.

[Host reality](docs/host-reality.md) · [Architecture](docs/architecture.md) · [Harness](docs/harness.md) · [Roadmap](docs/roadmap.md)
