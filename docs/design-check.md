# Design checks

North star: **Not more agents. Ship with evidence. The harness owns the loop. `mcode` is the host. We are the verified-delivery layer.**

After each cut, eight questions. A failing check is a change, not a footnote.

## 1. Install (`npx oh-my-mcode install`)

1. **Verified delivery?** Yes — install is how the verified loop becomes visible to the host (local plugin drop-in). It is not a second product; it copies this package from `import.meta.url` / `OMM_PACKAGE_ROOT`, never cwd.
2. **Harness not prompt pack?** Yes — TypeScript `installPlugin`. No new SKILL.md for install.
3. **One core, many surfaces?** Install is a packaging surface. CLI `install` is the only writer. MCP does not duplicate copy logic.
4. **Subagents are workers not trees?** N/A — no spawn.
5. **MiniMax-native?** Yes — drop-in `~/.minimax/plugins/oh-my-mcode`. No `mmx` / `mavis` / MiniMax-AI/skills. No registered slash command.
6. **Host honesty?** Yes — logs say local marketplace drop-in; official catalog is separate. README still refuses `/max` / hooks / App panels.
7. **Hero stays `max`?** Yes — `npx oh-my-mcode install` is the first TL;DR row; the hero command is still `oh-my-mcode max`.
8. **Codex-as-platform fit?** Install is distribution of the harness, not a second core.

## 2. Interview

1. **Verified delivery?** Yes — derived acceptance is written to `tasks.json` before any builder. Interview cannot Accept. That makes later Accepted-with-evidence more likely, not another chat log.
2. **Harness not prompt pack?** Yes — questions, answers, and PLAN_REVIEW stop live in `src/interview.ts`. `skills/interview/SKILL.md` is a short TUI pointer.
3. **One core, many surfaces?** Yes — CLI `interview` and MCP `omm_interview` both `Harness.submit({ op: "interview" })`.
4. **Subagents are workers not trees?** Yes — interview does not spawn `mcode` and does not expose spawn.
5. **MiniMax-native?** Yes — four questions, not Prometheus-the-mythology or 32 agents. Not a registered command.
6. **Host honesty?** Yes — skill says it is not a slash command. Doctor lists the skill on disk.
7. **Hero stays `max`?** Yes — power tool. `max --interview` is intake then the existing loop.
8. **Codex-as-platform fit?** Interview is a submission. The run is the thread. `interview_completed` is an EQ event. Stop at PLAN_REVIEW is an explicit approval gate.

## 3. Doctor `--smoke`

1. **Verified delivery?** Yes — a real host exec (`pong`) is evidence the loop can talk to `mcode`. Package-only CI still does not pretend the host is present.
2. **Harness not prompt pack?** Yes — TypeScript `runDoctorSmoke`. Skill `doctor` stayed short.
3. **One core, many surfaces?** CLI doctor only. One implementation.
4. **Subagents are workers not trees?** N/A — one tiny `mcode exec`, no role worker API.
5. **MiniMax-native?** Yes — uses `mcode exec --max-steps 1`. Tests use `OMM_MCODE` / `fake-mcode.mjs`.
6. **Host honesty?** Missing host: warn and skip unless `--smoke` was required (then fail). `--package-only` still skips host.
7. **Hero stays `max`?** Yes — doctor is a power tool.
8. **Codex-as-platform fit?** Smoke is a health submission against the host runtime, not a second product.

## 4. Harness core

1. **Verified delivery?** Yes — create / status / verify / interview share the run store that Accepted still requires evidence files for.
2. **Harness not prompt pack?** Yes — `submit` / `subscribe` / `bind` are TypeScript. No new long SKILL.
3. **One core, many surfaces?** Yes — CLI status/verify/interview/cancel and MCP create/show/list/status/verify/interview call `Harness.submit`.
4. **Subagents are workers not trees?** Harness does not spawn workers. Orchestrator does, through `subagent.ts`.
5. **MiniMax-native?** Yes — no second RPC. MCP JSON-RPC is the app-server-shaped surface.
6. **Host honesty?** `docs/harness.md` says we are not Codex and not `/max`.
7. **Hero stays `max`?** Yes — harness is the module, not a user-facing brand.
8. **Codex-as-platform fit?** Thread = run, EQ = events.jsonl + subscribe, SQ = submit, approvals stay `--permission` / `--approve-plan` / verifier-only Accepted.

## 5. Subagent

1. **Verified delivery?** Yes — builders still cannot mark Accepted; one Task Contract per exec; evidence still comes from the existing verify path.
2. **Harness not prompt pack?** Yes — spawn + grandchild assert are TypeScript. Role files stayed short contracts.
3. **One core, many surfaces?** Spawn is not exposed on MCP or to workers. Orchestrator team/max call it.
4. **Subagents are workers not trees?** **Pass, enforced.** `AsyncLocalStorage` depth ≥ 1 throws. Tests call spawn from inside a worker exec and expect failure. No grandchild API.
5. **MiniMax-native?** Five roles. No Sisyphus tree.
6. **Host honesty?** One `mcode exec` per worker. Host sessions still come from `session.ts`.
7. **Hero stays `max`?** Yes — implementation detail of `max` / `team`.
8. **Codex-as-platform fit?** Worker = harness-spawned role with a contract. Orchestrator remains the only scheduler.

## 6. Structured worker yield

1. **Verified delivery?** Yes — the parent reads a schema-validated object (`status`, `summary`, `findings`, `artifacts`, optional `file_hashes`). Invalid yield fails the worker, retries once with the validator error, then becomes a finding. That is typed delivery, not another chat log.
2. **Harness not prompt pack?** Yes — `src/yield.ts` + `schemas/worker-yield.schema.json`. `schemaMode: strict`. Role files stayed short.
3. **One core, many surfaces?** Parent (`orchestrator` / `harness` consumers) reads `structuredOutput.data` only. CLI and MCP do not parse worker prose.
4. **Subagents are workers not trees?** Yield does not add a spawn API. One reminder, then fail. No grandchild channel.
5. **MiniMax-native?** Yes — schemas stay on disk (`worker-yield.schema.json`, `planner-output.schema.json`). Yield is validated in TypeScript (`schemaMode: strict`). Host `--output-schema` is opt-in only (`OMM_HOST_OUTPUT_SCHEMA=1`); live 0.2.1 exits 70 on that path.
6. **Host honesty?** We do not dump raw host JSONL into the next prompt (the Claude Code leak Oh My Pi called out). JSONL may be stored as evidence. Parent parses `exec.result.answer`, assistant JSON, or `structuredOutput.data` if the host ever sends it.
7. **Hero stays `max`?** Yes — implementation detail of workers inside `max` / `team`.
8. **Codex-as-platform fit?** Worker turn returns a typed object. EQ can record the artifact. SQ does not change.

## 7. Batch fan-out / team packet

1. **Verified delivery?** Yes — one `{ context, tasks[] }` packet. Shared context is injected; workers still cannot Accept.
2. **Harness not prompt pack?** Yes — `buildTeamPacket` in `src/team.ts`. Existing `drainBuilderWaves` / semaphore stay.
3. **One core, many surfaces?** Orchestrator is the only scheduler. No new MCP spawn.
4. **Subagents are workers not trees?** **Pass.** Workers do not spawn workers. No FUSE/overlay isolation.
5. **MiniMax-native?** Flat team, five roles. Not Agent Hub.
6. **Host honesty?** Host still owns edit/read/bash. We schedule; we do not replace tools.
7. **Hero stays `max`?** Yes — `team` remains a power tool.
8. **Codex-as-platform fit?** One packet per wave. Thread stays the run.

## 8. Content-hash evidence (hashline idea, not the edit language)

1. **Verified delivery?** Yes — evidence and findings carry sha256 of artifact bytes. If a recorded hash no longer matches the live file, Accept is refused and deterministic tests re-run. Stale = reject/repair.
2. **Harness not prompt pack?** Yes — `src/hash.ts` + store/verify TypeScript.
3. **One core, many surfaces?** `run://<id>/findings` is inspect/MCP addressing to store files, not a VFS.
4. **Subagents are workers not trees?** N/A — hashes do not spawn.
5. **MiniMax-native?** Yes — no `[PATH#TAG]`, no PUT/CUT, no `@oh-my-pi/hashline`. Hashline stays their edit tool.
6. **Host honesty?** We do not teach `mcode` an edit DSL. Host edit tool stays host-owned.
7. **Hero stays `max`?** Yes.
8. **Codex-as-platform fit?** Evidence records are store artifacts. Stale hash is an approval failure.

## 9. Minimal worker prompts

1. **Verified delivery?** Yes — contract-only prompts (role, goal, packet, allowed files, acceptance, yield schema) reduce wasted tokens that hide real failures. Point at paths; host already has read.
2. **Harness not prompt pack?** Yes — this *removes* the old role-file dump. Speed copy from Oh My Pi issue #4991 (inheriting the full harness prompt burns unused tokens).
3. **One core, many surfaces?** Same `src/prompts.ts` for CLI and workers.
4. **Subagents are workers not trees?** Prompts say do not spawn.
5. **MiniMax-native?** No OMO mythology, no ultrathink/orchestrate, no 32 agents.
6. **Host honesty?** We measure prompt chars + rough tokens in `--tps` so the harness tax is visible.
7. **Hero stays `max`?** Yes.
8. **Codex-as-platform fit?** Smaller turn payload. Model quality stays the host's.

## 10. Real TPS measurement

1. **Verified delivery?** Yes — a real tiny `mcode exec --output-format stream-json --permission off`. If the host is missing or fake, print `unmeasured` and exit non-zero unless `--allow-stub`. We do not invent live tok/s.
2. **Harness not prompt pack?** Yes — `src/tps.ts` + `src/usage.ts`. Persist last report at `~/.minimax/oh-my-mcode/tps.json`.
3. **One core, many surfaces?** CLI `doctor --tps` only. Tests parse the captured mcode 0.2.1 shapes (`delta`, `message.usage`, `exec.result`), not a live CI run.
4. **Subagents are workers not trees?** N/A — one probe exec.
5. **MiniMax-native?** Parses host camelCase: `inputTokens`, `outputTokens`, `totalTokens`, `requestDurationMs`, `cacheReadTokens`, `durationMs`, `thinkingDurationMs`, `model`.
6. **Host honesty?** **Pass, enforced.** Stub host cannot report a fake `output_tps`. `output_tps` uses `requestDurationMs`, not wall and not `exec.result.durationMs`. Docs cite the local capture (16816 input / 261 output) only as that fixture. We do not default `--model highspeed`. The feel problem is host input tax (~16.8k on a 20-word prompt), not generation tok/s.
7. **Hero stays `max`?** Yes — doctor is a power tool.
8. **Codex-as-platform fit?** Health submission against the host runtime.

## 11. Host `--output-schema` JSON object (mcode 0.2.1)

1. **Verified delivery?** Passing a filesystem path made every worker `mcode exec` exit 2 (`--output-schema requires a JSON object`). `readOutputSchemaArg` still serializes the on-disk schema to a JSON object for the opt-in path.
2. **Harness not prompt pack?** Yes — `ProcessMcode` can read `schemas/*.schema.json` and pass the serialized object. Yield semantics stay `schemaMode: strict` in TypeScript.
3. **One core, many surfaces?** Same exec argv for `plan` / `max` / `team`. CLI and MCP do not invent a second schema flag.
4. **Subagents are workers not trees?** Unchanged. One `mcode exec` per worker.
5. **MiniMax-native?** Yes — matches `mcode exec --help` on 0.2.1: `--output-schema <json>  validate the final JSON result against a JSON Schema`.
6. **Host honesty?** **Pass, enforced.** Reproduced host error: `mcode exec failed: --output-schema requires a JSON object.` When the flag is sent, argv is a JSON object (starts with `{`), never a `.json` path. Missing schema file omits the flag.
7. **Hero stays `max`?** Yes — implementation detail of workers inside `max` / `plan` / `team`.
8. **Codex-as-platform fit?** We keep the reader. We do not depend on the host flag for correctness.

## 12. Do not send host `--output-schema` on mcode 0.2.1 (live follow-up)

1. **Verified delivery?** Yes — this is what made verified delivery actually talk to the live host. With `--output-schema` still set (JSON object, PR #8), every worker `mcode exec` returned **exit 70** (`Sw.internal = 70` — "MCode encountered an internal error") on mcode 0.2.1 / Node 24.19.0. Also saw better-sqlite3 + Node 24 abort 134. **Without** the flag, the same prompt exits 0 in 19.1s: `exec.result.status=succeeded`, answer `{"status":"ok","summary":"pong","findings":[],"artifacts":[]}`, `message.usage` present (inputTokens 470, outputTokens 47, cacheReadTokens 21497, requestDurationMs 4226).
2. **Harness not prompt pack?** Yes — schemas stay on disk. `schemaMode: strict` validates `exec.result.answer` / assistant JSON / `structuredOutput.data` in TypeScript. Invalid → one reminder retry → failed yield.
3. **One core, many surfaces?** Default argv omits `--output-schema`. `OMM_HOST_OUTPUT_SCHEMA=1` is the only opt-in. `plan` / `max` / `team` share the same gate.
4. **Subagents are workers not trees?** Unchanged. One `mcode exec` per worker.
5. **MiniMax-native?** Yes — we follow the live host, not the help text. Current 0.2.1 output-schema path is not reliable.
6. **Host honesty?** **Pass, enforced.** We do not depend on host `--output-schema` for correctness. Failed discover/plan yields stay in that phase as `rejected`; `plan` does not sit in PLAN_REVIEW or auto-continue as if a plan was written. Parent never dumps raw JSONL into the next prompt.
7. **Hero stays `max`?** Yes — implementation detail of workers inside `max` / `plan` / `team`.
8. **Codex-as-platform fit?** Typed yield is a harness concern. We do not invent TPS numbers or add hashline.

## Failures we refused

- Did not add a second JSON-RPC next to MCP.
- Did not register `/max` or host hooks.
- Did not let interview or research Accept.
- Did not give workers a `spawn` handle.
- Did not port hashline as an edit language or teach `[PATH#TAG]` / PUT/CUT to `mcode`.
- Did not add LSP, DAP, browser, memory bank, magic keywords, advisor TUI, or 31 tools.
- Did not clone Agent Hub or spawn grandchildren.
- Did not invent live TPS numbers when the host was stubbed.
