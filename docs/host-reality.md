# Host reality (mcode 0.1.6, verified 2026-08-20)

This is a community project by **haoruilee**. It is not an official MiniMax-AI product and does not claim MiniMax ownership.

## What the host already is

Local CLI: `mcode` 0.1.6 (`@minimax-ai/code`), **not** `mavis`. Data directory is `~/.minimax`. `~/.mavis` is a symlink to it on current hosts.

The host already has agents `explore`, `mavis`, `verifier`, `worker`, plus Plan Mode, Goal, session resume, `mcode exec`, ACP, and an official plugin marketplace. Our `agents/*.md` files reuse those names as **role contracts** the same host agent must obey. We do not register new host agents. Public Agent Plugins cannot do that today.

## What a public Agent Plugin can ship

From MiniMax-AI/MiniMax-Code-Plugins `docs/plugin-compatibility.md`:

- Skills
- MCP (`stdio` / `streamable-http` / `sse`)

Not public plugin capabilities:

- Hooks
- Custom Agents
- Commands / slash commands
- LSP
- Apps / UI extensions
- Generic OAuth
- TUI extensions

Therefore this repo does **not** invent `/max` as a registered host command. The host already has `/plan`, `/goal`, `/resume`. We coexist. Hero entry is:

- CLI: `oh-my-mcode max "..."` (alias `omm`)
- TUI: say `max mode: ...` so the `max` **Skill** triggers

## Local marketplace (empirically on 0.1.6)

- Local plugin dir: `~/.minimax/plugins`
- Dropping a folder there auto-installs and enables it. No `plugin add` required.
- `mcode plugin list -m local --json` then shows installed+enabled.
- `displayName` from `.minimax-plugin/plugin.json` was ignored in a probe; catalog label came from portable `plugin.json` `name`. We still ship both manifests.
- Official catalog is a **separate** registry. This plugin does not claim to be listed there.

Official desktop submit format lives at `.minimax-plugin/plugin.json`. Portable Agent Plugins 1.0 lives at repo-root `plugin.json`. Skills are auto-discovered from `skills/` for the portable package.

Official submit checklists sometimes reject install scripts, symlinks, and executable-bit-dependent files. `scripts/install.sh` / `install.ps1` and the `oh-my-mcode` bin are for **local** install. If you ZIP for the official catalog, omit those if the reviewer requires it.

## Marketplace neighbors

Official marketplace plugins today are mostly domain Skills (Office, finance, legal) plus methodology packs such as Superpowers. Superpowers is the closest competitor. We do not differentiate by shipping more methodology prose or twenty agents. We differentiate on:

- a real orchestrator that owns the delivery loop
- independent, deterministic verification
- a durable run / evidence store

## Headless later — not a second product CLI wrapping mcode

`mcode exec` already has `--session`, `--continue`, `--output-format json|stream-json`, `--output-schema`, `--permission`, `--cwd`.

`oh-my-mcode max` **drives** `mcode exec --output-format stream-json`. That is the product. It is not a rebrand of `mcode`, and it is not `mavis max`. The only extra bins are `oh-my-mcode` and `omm`, which own Run / phase / verify / resume / evidence.

Example you can run yourself later:

```bash
mcode exec --cwd . --output-format stream-json --permission smart \
  "Follow the oh-my-mcode max skill: fix the failing auth tests and prove they pass"
```

v0 does not implement Agent Team, recursive spawn, or cancel APIs. Those land when the host exposes them.

## Honest inspect surface

Exists:

- `mcode --version`
- `mcode plugin list --json`
- `mcode plugin list -m local --json`

Does not exist as a public API: "list indexed Skills" / "was this skill dropped?". `doctor` will not pretend otherwise.
