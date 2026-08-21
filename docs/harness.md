# Harness (Codex-as-platform map)

Host-honest mapping. MiniMax `mcode` is the host model+tools runtime. `oh-my-mcode` is the verified-delivery harness on top. We do not ship a second protocol, registered `/max`, hooks, or App panels.

North star: **Not more agents. Ship with evidence. The harness owns the loop. `mcode` is the host. We are the verified-delivery layer.**

## Codex blog term → oh-my-mcode

| Codex (open agent harness) | oh-my-mcode | Host note |
| --- | --- | --- |
| Core runtime | `mcode` (`mcode exec`, sessions, tools, permission) | We do not replace this binary |
| Open harness | this package: TypeScript store + orchestrator + `src/harness.ts` | Conversation state, evidence, verify, approvals |
| Surface | CLI (`oh-my-mcode` / `omm`) and portable MCP JSON-RPC | Same `submit` path. Skills are TUI phrasing, not a third loop |
| Thread | one run (`<workspace>/.minimax/runs/<run_id>/`) | One core session per thread (`run.json.host_session_id`) |
| Turn | one phase step or one role `mcode exec` | Planner / builder / verifier are turns, not new products |
| Submission queue (SQ) | CLI commands + MCP tools → `Harness.submit(op)` | `create` `show` `status` `verify` `interview` `cancel` |
| Event queue (EQ) | `events.jsonl` + in-process `subscribe` | Append-only. HUD / `status` read the same file |
| App-server JSON-RPC | `mcp/server.mjs` (stdio JSON-RPC) | Not a second wire format. MCP is the app-server-shaped surface |
| Approval | `--permission`, `--approve-plan`, verifier-only Accepted | Explicit. Host permission modes stay host-owned |
| Exec vs app-server | `mcode exec` (worker) vs MCP/CLI (surfaces) | Surfaces never spawn their own loop |
| Subagent | `spawnSubagent({ role, contract, session, permission, cwd })` | One `mcode exec`. Orchestrator is the only scheduler. **No grandchildren.** |

## What a run is

A thread is a folder, not a prompt:

```
<workspace>/.minimax/runs/<run_id>/
  run.json
  interview.md          # optional intake
  interview.json
  plan.md
  tasks.json
  events.jsonl          # EQ
  evidence/
  findings.json
  summary.md
```

## Workers, not trees

Roles (`explorer` / `planner` / `builder` / `verifier` / `release`) are harness-spawned workers with a Task Contract. A worker callback cannot call `spawnSubagent`. Flat `team` is sibling builders scheduled in TypeScript, not a recursive prompt tree.

## Structured worker yield

A worker must finish with schema-validated JSON (`schemas/worker-yield.schema.json`, `schemaMode: strict`):

```json
{ "status": "ok|blocked|failed", "summary": "...", "findings": [], "artifacts": [], "file_hashes": {} }
```

The parent validates yield in TypeScript (`schemaMode: strict`) from `exec.result.answer`, assistant JSON, or `structuredOutput.data` if the host ever sends it. It does not dump raw host JSONL into the next prompt. Assistant `delta.content` chunks (and final `message.content` when role=assistant) are stitched into `result.text`; user-role messages are ignored. Invalid yield: one reminder on the same `mvs_` session, then fail and surface as a finding that still keeps assistant text. Schema-valid `blocked` is a valid yield (not "invalid"); DISCOVER/PLAN stop with `blocked_worker_yield`. Default `mcode exec` omits `--output-schema` (live 0.2.1 exits 70 on that path). `OMM_HOST_OUTPUT_SCHEMA=1` is opt-in only. Host `--timeout` always includes a unit suffix (`180s`); a bare integer is milliseconds on 0.2.1 and times out (exit 6). Evidence for an exec is a typed snapshot (`assistant_text` / `exec.result.answer` / hashes), not raw JSONL.

## Team packet

Flat team is one `{ context, tasks[] }` packet. `context` is injected into every builder. Workers do not spawn workers. Orchestrator remains the only scheduler (`drainBuilderWaves`).

## Content hashes

Evidence records store sha256 of artifact bytes. Verifier compares recorded hashes to live files. Stale hash → re-run deterministic tests and refuse Accept. This is the hashline *idea* (reject a stale anchor), not their edit language.

Inspect/MCP can address store files as `run://<run_id>/findings` (and `evidence`, `events`, `plan`, `summary`).

## Token / cost / TPS

If host `stream-json` includes usage fields, we parse them and show them on `status`. Otherwise the HUD prints `Cache/cost: n/a if unknown`. We do not invent numbers.

`oh-my-mcode doctor --tps` runs a real tiny host exec (`--permission off`, no `--model` default) and reports this shape: `host_binary`, `host_version`, `wall_ms`, `input_tokens`, `output_tokens`, `total_tokens`, `cache_read_tokens`, `request_duration_ms`, `exec_duration_ms`, `thinking_duration_ms`, `output_tps`, `wall_tps`, `first_token_ms`, `model`, plus our prompt size (probe and a typical builder). `output_tps` uses `message.usage.requestDurationMs` (generation). `wall_tps` uses spawn-to-close. Missing usage, missing host, or fake host: print `unmeasured` and exit non-zero unless `--allow-stub`. We do not invent tok/s. Last report: `~/.minimax/oh-my-mcode/tps.json`.

Parser fixtures live under `test/fixtures/stream-json-mcode-0.2.1.jsonl` (captured mcode 0.2.1 MiniMax-M3 thinking, prose redacted). That local capture reported **16816 input tokens** for a ~20-word no-tools prompt (`message.usage`: input 16816 / output 261 / cache-read 3271 / requestDurationMs 7598; `exec.result.durationMs` 10911; wall 20.71s). Almost all of that input is host system/tools. `src/prompts.ts` is only a few thousand characters. If we paste files, dump JSONL, or ship a Sisyphus essay, we add tax on top of ~16.8k. The speed problem is that input tax, not the ~34 tok/s generation clock.

Oh My Pi feels fast mostly because of fewer wasted tokens and fewer retries. We copy yield / minimal-prompt / no-JSONL-leak / hash-stale-reject / `--tps` so `input_tokens` is visible every run. We do not copy hashline-as-edit-tool, 31 tools, or grandchild agents. We do not default `--model highspeed`.

## What this is not

- Not a registered `/max` and not a Sisyphus 1100-line orchestrator
- Not 32 agents. Five role contracts for the same host agent
- Not App panels. `attach` / `status` read the run folder
- Not a competing RPC next to MCP
