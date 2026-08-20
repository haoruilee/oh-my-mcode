# Host reality (mcode 0.1.6, verified 2026-08-20)

This is a community project by **haoruilee**. It is not an official MiniMax-AI product and does not claim MiniMax ownership.

## What the host already is

The product this plugin targets is MiniMax Code CLI **`mcode`** 0.1.6 (`@minimax-ai/code`). Data directory is `~/.minimax`.

Three different CLIs exist in the MiniMax universe. Do not mix them in user install steps:

| Binary | What it is | Mention in user install? |
| --- | --- | --- |
| `mcode` | MiniMax Code (`@minimax-ai/code`) — this plugin's host | **Yes — only this** |
| `mmx` | Multimodal platform CLI | No |
| `mavis` | Legacy name; on current hosts `~/.mavis` may symlink to `~/.minimax` | No |

The host already has agents `explore`, `mavis`, `verifier`, `worker`, plus Plan Mode, Goal, session resume, `mcode exec`, ACP, an official plugin marketplace, TUI slash commands `/plan`, `/goal`, `/resume`, and desktop `/team`.

Our `agents/*.md` files reuse some of those names as **role contracts** the same host agent must obey. We do not register new host agents. Public Agent Plugins cannot do that today.

## Slash commands we do not own

The official TUI already has `/plan`, `/goal`, `/resume`, plus desktop `/team`.

Our skills `plan` and `resume` **must not** claim to register those commands. They trigger on natural language only (`make a verified plan`, `continue the last oh-my-mcode run`).

We **coexist** with host `/plan` / `/goal` / `/resume` / `/team`. We add durable run/evidence. We do **not** replace host Plan Mode. Host `/resume` is session resume; our `resume` skill restores a `.minimax/runs/<run_id>` phase.

There is no registered `/max`. Say `max mode: …`.

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

Hero entry is `oh-my-mcode max` / alias `omm`, plus the `max` **Skill** via natural language. This is not `mavis max` or an `mmx` wrapper. The host binary remains `mcode`.

## Local marketplace (empirically on 0.1.6)

- Local plugin dir: `~/.minimax/plugins`
- Dropping a folder there auto-installs and enables it. No `plugin add` required.
- `mcode plugin list -m local --json` then shows installed+enabled.
- `displayName` from `.minimax-plugin/plugin.json` was ignored in a probe; catalog label came from portable `plugin.json` `name`. We still ship both manifests.
- Official catalog is a **separate** registry. This plugin does not claim to be listed there.

Official desktop submit format lives at `.minimax-plugin/plugin.json`. Portable Agent Plugins 1.0 lives at repo-root `plugin.json`. Skills are auto-discovered from `skills/` for the portable package.

Official submit checklists sometimes reject install scripts, symlinks, and executable-bit-dependent files. `scripts/install.sh` / `install.ps1` are for **local** drop-in. If you ZIP for the official catalog, omit them if the reviewer requires it.

## Not MiniMax-AI/skills

[MiniMax-AI/skills](https://github.com/MiniMax-AI/skills) (the large Claude / Cursor / Codex / OpenCode pack) is **not** a MiniMax Code plugin marketplace. Do not tell users to install oh-my-mcode via that path.

## Marketplace neighbors

Official marketplace plugins today are mostly domain Skills (Office, finance, legal) plus methodology packs such as Superpowers. Superpowers is the closest competitor. We do not differentiate by shipping more methodology prose or twenty agents. We differentiate on independent verification and a durable run / evidence store.

## Headless later — still `mcode`, not a wrapper product

`mcode exec` already has `--session`, `--continue`, `--output-format json|stream-json`, `--output-schema`, `--permission`, `--cwd`.

On **mcode 0.2.1** (`~/.minimax-code/bin/mcode`), `--output-schema <json>` is a JSON object string, not a filesystem path. Passing `schemas/worker-yield.schema.json` fails with:

```
mcode exec failed: --output-schema requires a JSON object.
```

Live follow-up on 0.2.1 / Node 24.19.0: passing the JSON object still fails. Every worker `mcode exec` returned **exit 70** (`Sw.internal = 70` — "MCode encountered an internal error"). The same prompt **without** `--output-schema` exited 0 in 19.1s with `exec.result.status=succeeded` and a valid yield in `exec.result.answer`.

Default argv therefore omits `--output-schema`. Schemas stay on disk. Yield is validated in TypeScript (`schemaMode: strict`) from `exec.result.answer`, assistant JSON, or `structuredOutput.data`. Set `OMM_HOST_OUTPUT_SCHEMA=1` only for experiments; `readOutputSchemaArg` still serializes the object (never a path).

On the same 0.2.1 host, `--timeout` is parsed by `chm`: `/^(\d+)(ms|s|m|h)?$/i`. A bare integer is **milliseconds**, not seconds. After PR #9, `oh-my-mcode plan` bound a real session (`mvs_…`, `host_session_source: host`) then discover failed with **exit 6** (`Sw.timeout = 6`) because we sent `--timeout 180` for a 3-minute explorer default (180ms). Live first_token_ms was ~6030, then timeout. `doctor --smoke` omits `--timeout` and succeeded in 18s; `mcode exec --timeout 45s` succeeded. Worker argv therefore sends a unit suffix (`180s`), never a bare integer. Role defaults stay milliseconds internally.

Max mode can be driven headless later by `mcode exec` plus a prompt that loads the `max` skill. That is not a second product CLI.

```bash
mcode exec --cwd . --output-format stream-json --permission smart \
  "Follow the oh-my-mcode max skill: fix the failing auth tests and prove they pass"
```

Flat `oh-my-mcode team` is a TypeScript scheduler (no grandchild agents). It does **not** implement host Agent Team or recursive spawn. Desktop `/team` remains the host's. App panels, registered `/max`, and hooks wait on a public Extension API.

## Honest inspect surface

Exists:

- `mcode --version`
- `mcode plugin list --json`
- `mcode plugin list -m local --json`

Does not exist as a public API: "list indexed Skills" / "was this skill dropped?". `doctor` will not pretend otherwise.
