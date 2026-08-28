# Host reality (CLI 0.2.7 as of 2026-08-28)

This is a community project by **haoruilee**. It is not an official MiniMax-AI product and does not claim MiniMax ownership.

Official changelog: [https://agent.minimax.io/docs/changelog](https://agent.minimax.io/docs/changelog). Official exec flags: [https://agent.minimax.io/docs/cli/features.md](https://agent.minimax.io/docs/cli/features.md). Last live rematch of this harness was **mcode 0.2.1** (2026-08-21). 0.2.2–0.2.7 facts below are from that changelog plus our closed alias table — we did not scrape a live 0.2.7 host.

## What the host already is

The product this plugin targets is MiniMax Code CLI **`mcode`** (`@minimax-ai/code`), documented through **0.2.7**. Data directory is `~/.minimax`.

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

## Local marketplace (empirically on 0.1.6; still the drop-in path on 0.2.7)

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

`mcode exec` already has `--session`, `--continue`, `--output-format json|stream-json`, `--output-schema`, `--permission`, `--cwd`. Official 0.2.4+ docs list `--output-schema` as a real exec flag. We still **omit** it by default: live 0.2.1 exited 70, and we have no live rematch proving 0.2.4+ does not. `OMM_HOST_OUTPUT_SCHEMA=1` remains the probe.

## What we consume on 0.2.4–0.2.7 (hermetic)

We stay a verified-delivery harness on `mcode exec`. We do not become the host, ACP, Desktop Goal, or a second Goal product.

**Consume**

- Structured stream-json events already parsed by `parseStreamLine` / `ExecResult`: `assistant` / `delta` / `tool` / `stderr` / `exec.result` / `usage` / `session`.
- Closed aliases for 0.2.4+ kinds whose exact `type` strings were not in-repo: `goal` / `goal_settled` / `goal_budget` (and `goal.settled` / `goal.budget` / `host_goal`), `model`, plus record-only `compaction` / `tool_trim` / `queue` / `steer`. `classifyHostEvent` maps these to `session | usage | yield | goal | model | tool | noise`. Unknown types stay `noise`. We store `type` as-is.
- `extractStructuredExec` pulls `{ sessionId, model, goal, usage }` only from `exec.result` / `metadata` / typed events. Never from assistant prose.
- Host session bind: `mvs_[A-Za-z0-9]+` from `exec.result` / `metadata` / a session-like event / host `cursor` (`sse1:session%3Amvs_…`). User `--session` still wins. Synthesized `omm_*` is still never sent. `--session` XOR `--continue` is unchanged.
- `model` on the final json object (present since 0.1.3; locked on the 0.2.1 fixture).
- Host version from `mcode --version` (`0.2.7` / `@minimax-ai/code@0.2.7` / extra text) → `{ major, minor, patch }`. `hostCapabilities`: `structuredExec` and `outputSchemaDocumented` if ≥ 0.2.4; `legacyOutputSchemaCrash` for 0.2.1 (exit 70). `doctor` / `inspect model-policy` report these flags. Missing `mcode` still fails doctor honestly.
- Optional `RunRecord.host_goal` `{ budget?, settled?, phase? }` copied from structured goal events. Logged as `host_event`. Our VERIFY / REPAIR / guard remains the acceptance authority.

**Omit (do not act)**

- `--output-schema` until a live rematch proves it is not exit 70. Documented since 0.2.4; default argv still omits it.
- Plugin Hooks. TUI `/sessions` `/history` `/checkin` `/changelog`.
- ACP as the hero transport (`mcode acp` Session fork / queue / Steer / Goal / delegation stays host-owned).
- Desktop Browser / Computer Use / Remote Control. FAQ: those exist only when the host explicitly provides them.
- Host `/goal` loop, pause/resume host goals, grandchild agents, a second Goal runtime.

On **mcode 0.2.1** (`~/.minimax-code/bin/mcode`), `--output-schema <json>` is a JSON object string, not a filesystem path. Passing `schemas/worker-yield.schema.json` fails with:

```
mcode exec failed: --output-schema requires a JSON object.
```

Live follow-up on 0.2.1 / Node 24.19.0: passing the JSON object still fails. Every worker `mcode exec` returned **exit 70** (`Sw.internal = 70` — "MCode encountered an internal error"). The same prompt **without** `--output-schema` exited 0 in 19.1s with `exec.result.status=succeeded` and a valid yield in `exec.result.answer`.

Default argv therefore omits `--output-schema`. Schemas stay on disk. Yield is validated in TypeScript (`schemaMode: strict`) from `exec.result.answer`, assistant JSON, or `structuredOutput.data`. Set `OMM_HOST_OUTPUT_SCHEMA=1` only for experiments; `readOutputSchemaArg` still serializes the object (never a path).

On the same 0.2.1 host, `--timeout` is parsed by `chm`: `/^(\d+)(ms|s|m|h)?$/i`. A bare integer is **milliseconds**, not seconds. After PR #9, `oh-my-mcode plan` bound a real session (`mvs_…`, `host_session_source: host`) then discover failed with **exit 6** (`Sw.timeout = 6`) because we sent `--timeout 180` for a 3-minute explorer default (180ms). Live first_token_ms was ~6030, then timeout. `doctor --smoke` omits `--timeout` and succeeded in 18s; `mcode exec --timeout 45s` succeeded. Worker argv therefore sends a unit suffix (`180s`), never a bare integer. Role defaults stay milliseconds internally.

Later the same day (2026-08-21), a live Mac run against 0.2.1 showed more host facts we now lock in tests:

- `--output-schema` is a JSON object string, not a path. Live host still exits **70** if we pass it. Default: do not pass it.
- `--max-steps` is a positive integer. `--permission` is `ask|smart|full|off` (host default `ask`). Role defaults must reach argv.
- Documented host exits: success=0, invocation=2, config=3, runtime=4, blocked=5, timeout=6, limit=7, internal=70, cancelled=130. Exit **1** has been observed on crash / incomplete stream; it is not timeout.
- Node `child.on("close", (code, signal))` after **our** `SIGTERM` often has `code=null` and `signal=SIGTERM`. Treating that as `code ?? 1` lies that a timeout was a crash. `finalizeHostExit` reports `exitCode` 6 when we killed by timer and `code` is null, sets `timedOut` if our timer fired **or** `classifyHostExit(exitCode)==="timeout"` (host can also exit 6 without our timer), and keeps `signal` as an orthogonal fact. A child that exits 0 after trapping the signal is still `timedOut`. SIGTERM-from-our-timer is not `isHostNativeCrash`.
- Stream-json: `{type:"delta", role:"assistant", content:"chunk"}` and/or `thinking`; `{type:"message", message:{role, content, finishReason, usage}}`. Session id lives in `exec.result.sessionId` and in `cursor` as `sse1:session%3Amvs_…` (URL-encoded). `YOUR SESSION ID: mvs_…` in assistant/user prose is **not** a bind source (model-controlled). Usage lives on `message.usage` and `exec.result` (`durationMs`, `model`). A probe that gets no usage is **unmeasured**.
- Explorer writing a schema-valid yield as `delta.content` chunks can die mid-JSON (exit 1). We stitch assistant deltas into `result.text` and persist a typed snapshot. User-role messages are ignored so the prompt example cannot win a greedy `{...}` match.
- A later live `plan` against `hello-pkg` (2026-08-21, mcode 0.2.1): explorer read the fixture, understood `hello()` vs `placeholder()`, then the process ended on toolUse (exit **1**, not timeout 6 / limit 7). No yield JSON. The reminder reused `mvs_…` but hashed files because it still allowed tools. Reminder argv after PR #12 sent `--session <mvs_>` **and** `--continue` (plus `--max-steps 1` and `--permission off`). Host `cli.js` rejects that pair: `--session and --continue are mutually exclusive` → invocation, exit **2**. Reminder is now `--session <mvs_>` without `--continue`. `--permission off` is legal on 0.2.1. The reminder prompt forbids tools and asks for only the yield JSON. We do not invent a WorkerYield from the prose. An empty reminder must not overwrite the first exec snapshot.
- After PR #13 the reminder argv XOR held (no exit 2) and the reminder **did** write schema-shaped yield JSON as assistant text. Then the host aborted: Node 24.19.0 + better-sqlite3 `Statement::~Statement` during GC, `RemoveEnvironmentCleanupHook` assert `(env) != nullptr`, exit **1**. JSON was cut mid-string (`"Node version may be <18 so`). Node 24 + better-sqlite3 **can** GC-abort; that is observed, not a ban on Node 22. Live rematch the same day used Node 22 for the host exec, then rebuilt the addon back to 24. Reminder / last message now demand a **tiny** yield so a ~300-byte object can finish before sqlite GC abort. Native crash + no valid yield: one extra text-only exec, not a second schema reminder. Cap: one reminder + one crash retry. `discover.md` must not contain `dyld` / better-sqlite3 stacks.
- Rematch (2026-08-21, mcode 0.2.1, copy of `test/fixtures/hello-pkg`): `oh-my-mcode plan` reached PLAN_REVIEW; `oh-my-mcode max --no-llm-verify` reached ACCEPT / `accepted` and wrote `hello()`.
- An empty workspace (only `.minimax/runs`) is a dead fixture. Greenfield is `status: ok` with note findings, not `blocked`. `blocked` is missing permission or missing tools. Plan tests use `test/fixtures/hello-pkg`.

Host ceilings (not a product). A ~20-word `mcode exec` still pays **17–20k input tokens** — almost all of that is host system/tools (`message.usage` fixture: 16816 input / 261 output). Node 24 + better-sqlite3 can GC-abort (`Statement::~Statement`). Those are `mcode` limits. We shrink prompts and lock the argv/stream/yield contract. Hashline, LSP, or a browser tool would be changing the host, not catching Oh-My-Pi / Oh-My-OpenCode. This package stays the verified-delivery layer. Hero stays `oh-my-mcode max`.

## We do not become Senpi / OMP

OMP is one install because it **is** the host (`curl omp.sh/install`). OMO Ultimate still needs OpenCode first; Senpi is a bundled host (`npm i -g omo-ai@beta`). We learn the one-command *look*, not the product shape.

`npx oh-my-mcode install --yes` may `npm i -g @minimax-ai/code` if `mcode` is missing. That is the official npm package. We do not curl unknown scripts. We do not install MiniMax desktop. We do not claim we own `mcode` or that we are marketplace-listed. `--skip-host` is plugin-only. `doctor --package-only` stays valid for CI.

Concrete `max` may skip the explorer `mcode exec` when the goal already names a file, function, or test command and the workspace has a detected test/build. That is a token-tax cut, not a fused host. `plan` still discovers. Finding classes are `command_failed` / `no_test` / `stale_workspace` / `host_crash`. We do not invent HTTP 413; `mcode` is not OMP's transport.

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
