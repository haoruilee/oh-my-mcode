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

The parent reads `structuredOutput.data` only. It does not parse worker prose and does not dump raw host JSONL into the next prompt. Invalid yield: one reminder, then fail and surface as a finding.

## Team packet

Flat team is one `{ context, tasks[] }` packet. `context` is injected into every builder. Workers do not spawn workers. Orchestrator remains the only scheduler (`drainBuilderWaves`).

## Content hashes

Evidence records store sha256 of artifact bytes. Verifier compares recorded hashes to live files. Stale hash → re-run deterministic tests and refuse Accept. This is the hashline *idea* (reject a stale anchor), not their edit language.

Inspect/MCP can address store files as `run://<run_id>/findings` (and `evidence`, `events`, `plan`, `summary`).

## Token / cost / TPS

If host `stream-json` includes usage fields, we parse them and show them on `status`. Otherwise the HUD prints `Cache/cost: n/a if unknown`. We do not invent numbers.

`oh-my-mcode doctor --tps` runs a real tiny host exec and reports `wall_ms`, token counts, `output_tps` / `wall_tps` when the host reported them, plus our prompt size (probe and a typical builder). Missing or fake host: print `unmeasured` and exit non-zero unless `--allow-stub`. Last report: `~/.minimax/oh-my-mcode/tps.json`.

Oh My Pi feels fast mostly because of fewer wasted tokens and fewer retries, not a higher raw tok/s. We copy the yield / minimal-prompt / no-JSONL-leak pieces. We do not copy hashline-as-edit-tool, 31 tools, or grandchild agents.

## What this is not

- Not a registered `/max` and not a Sisyphus 1100-line orchestrator
- Not 32 agents. Five role contracts for the same host agent
- Not App panels. `attach` / `status` read the run folder
- Not a competing RPC next to MCP
