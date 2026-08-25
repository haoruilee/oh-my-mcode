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

## 13. Host `--timeout` needs a unit suffix (mcode 0.2.1)

1. **Verified delivery?** Yes — after PR #9, `oh-my-mcode plan` bound a real host session (`mvs_…`, `host_session_source: host`) then discover failed: `invalid worker yield (exit 6)`. In `@minimax-ai/code` cli.js, `Sw.timeout = 6`. Host parser `chm` is `/^(\d+)(ms|s|m|h)?$/i` — no unit → multiplier 1 → milliseconds. We sent `--timeout 180` for a 3-minute explorer default; host treated it as 180ms. Live: first_token_ms ~6030, then timeout. `doctor --smoke` omits `--timeout` and succeeded in 18s. Manual `mcode exec --timeout 45s` succeeded.
2. **Harness not prompt pack?** Yes — `formatHostTimeout` in `src/mcode.ts`. Role files unchanged.
3. **One core, many surfaces?** Same `buildExecArgs` for `plan` / `max` / `team`. Role defaults stay milliseconds internally.
4. **Subagents are workers not trees?** Unchanged. One `mcode exec` per worker.
5. **MiniMax-native?** Yes — we follow the live host parser, not our assumption that a bare integer is seconds.
6. **Host honesty?** **Pass, enforced.** `--timeout` always has a unit (`180s` or `180000ms`), never `180`. Tests + fake-mcode require `/^\d+(ms|s|m|h)$/`.
7. **Hero stays `max`?** Yes — implementation detail of workers inside `max` / `plan` / `team`.
8. **Codex-as-platform fit?** We did not add hashline, invent TPS, or npm publish.

## 14. Host contract honesty after the 2026-08-21 live 0.2.1 Mac run

1. **Verified delivery?** Yes — we locked the live argv/stream contract in unit tests and stopped discarding assistant text. `formatHostTimeout` emits a unit (`180s`). Default exec still omits `--output-schema`. Role `--max-steps` / `--permission` reach argv. Explorer greenfield is `ok` + notes, not `blocked`. Schema-valid `blocked` is a valid yield (stop DISCOVER/PLAN with `blocked_worker_yield`, never "invalid worker yield"). `doctor --tps` prints `unmeasured` when `message.usage` is missing.
2. **Harness not prompt pack?** Yes — stitch / session / snapshot / TPS live in TypeScript. Role files stayed short contracts.
3. **One core, many surfaces?** Same `buildExecArgs` / `collectAssistantText` / `extractHostSessionId` / `parseWorkerYield` for CLI and MCP.
4. **Subagents are workers not trees?** Unchanged. One `mcode exec` per worker. The one yield reminder reuses the extracted `mvs_` `--session`.
5. **MiniMax-native?** Yes — `delta.content` stitch, `cursor: sse1:session%3Amvs_…`, `YOUR SESSION ID: mvs_…`, `message.usage`, `exec.result.answer`. No synthesized `omm_run_…`.
6. **Host honesty?** **Pass, enforced.** We do not depend on host `--output-schema`. We do not invent tok/s. We do not dump raw JSONL into the next prompt. We persist a typed snapshot (assistant text / `exec.result.answer` / hashes), not the raw stream. Exit 1 is crash / incomplete stream, not timeout. Plan tests use `test/fixtures/hello-pkg`, not an empty `.minimax/runs` dir.
7. **Hero stays `max`?** Yes — implementation detail of workers inside `max` / `plan` / `team`.
8. **Codex-as-platform fit?** Typed yield and evidence stay harness concerns. We did not add hashline, hooks, `/max`, or npm publish.

## 15. Explorer last message is yield JSON; reminder cannot start a tool loop

1. **Verified delivery?** Yes — live `plan` on hello-pkg (mcode 0.2.1) mapped the fixture (`hello()` imported, `placeholder()` exported) then died on toolUse (exit 1, not timeout 6 / limit 7). Reminder reused the `mvs_` session but hashed files instead of writing yield JSON. Parent still requires `validateWorkerYield` / `schemaMode=strict`. We did not invent a WorkerYield from the assistant prose.
2. **Harness not prompt pack?** Yes — reminder argv (`--session` XOR `--continue`, `--max-steps 1`, `--permission off`) is TypeScript in `yieldReminderRequest`. Role file stayed a short contract. Explorer prompt forbids post-map tools.
3. **One core, many surfaces?** Same spawn / reminder path for `plan` / `max` / `team`. CLI and MCP do not parse worker prose.
4. **Subagents are workers not trees?** Unchanged. One `mcode exec` per worker, one reminder, no grandchild. Reminder is a continuation of the same session, not a second explorer.
5. **MiniMax-native?** Yes — host `--permission off` + `--max-steps 1` so the only legal assistant message is text. We still do not send `--output-schema` (exit 70).
6. **Host honesty?** **Pass, enforced.** Exit 1 after toolUse stays crash / incomplete, not timeout. First explorer exec still sends role `--max-steps` (20). Reminder prompt is the yield reminder only — no raw JSONL, no first-exec transcript, no re-sent explore contract. Parent never synthesizes yield JSON from prose.
7. **Hero stays `max`?** Yes — implementation detail of workers inside `max` / `plan` / `team`.
8. **Codex-as-platform fit?** Typed yield is still a harness concern. One reminder. No second retry. No hashline.

## 16. Reminder argv is a legal 0.2.1 combination (session XOR continue)

1. **Verified delivery?** Yes — live rematch after PR #12 (`plan` hello-pkg, mcode 0.2.1) bound `mvs_…` (`host_continue: false`) then the reminder died in ~1s with **exit 2 (invocation)**. Snapshot was empty (`assistant_text: ""`) and overwrote `discover.md` with only `invalid worker yield`. Host `cli.js` (`@minimax-ai/code` 0.2.1): `if (e.session && e.continue) throw o_("--session and --continue are mutually exclusive.")` and `o_` constructs `vp("invocation", …)` → `Sw.invocation = 2`. `--permission off` is in the host enum (`ask|smart|full|off`); it is not the exit-2 cause. Reminder now sends `--session <mvs_>` without `--continue`, keeps `--max-steps 1` and `--permission off`. First snapshot stays in `exec-snapshot-discover.json`; reminder writes `exec-snapshot-discover-reminder.json` and keeps stderr on exit 2. `discover.md` still shows first-exec prose when the reminder is empty. Parent still requires `validateWorkerYield` / `schemaMode=strict`. We do not invent a WorkerYield from prose.
2. **Harness not prompt pack?** Yes — `sessionXorContinue` / `buildExecArgs` / `yieldReminderRequest` / snapshot persist live in TypeScript. Role file unchanged.
3. **One core, many surfaces?** Same argv builder for `plan` / `max` / `team`. CLI and MCP do not parse worker prose.
4. **Subagents are workers not trees?** Unchanged. One `mcode exec` per worker, one reminder, no grandchild.
5. **MiniMax-native?** Yes — we follow the live host parser, not our assumption that `--session` + `--continue` continues a named session. `--permission off` stays because the host accepts it; tools are still forbidden in the reminder prompt.
6. **Host honesty?** **Pass, enforced.** We read the 0.2.1 exclusive check instead of guessing. Exit 2 is invocation. Stderr is persisted so the next live fail is readable. We still do not send `--output-schema` (exit 70). We do not dump raw JSONL into the reminder prompt.
7. **Hero stays `max`?** Yes — implementation detail of workers inside `max` / `plan` / `team`.
8. **Codex-as-platform fit?** Typed yield and evidence stay harness concerns. One reminder. No second retry. No hashline. No npm publish.

## 17. Tiny yield + one native-crash retry (Node 24 sqlite abort)

1. **Verified delivery?** Yes — live `plan` after PR #13 wrote a schema-shaped yield as assistant text, then mcode 0.2.1 / Node 24.19.0 aborted (`Statement::~Statement`, `RemoveEnvironmentCleanupHook` assert `(env) != nullptr`). JSON was cut mid-string (`"Node version may be <18 so`). Parent refused the truncated object. A 300-byte yield can finish before sqlite GC abort. Reminder + explorer last-message now demand a **tiny** object (summary ≤80 chars, at most 2 short findings). If `classifyHostExit === "crash"` **and** stderr has sqlite/assert/SIGABRT **and** there is no valid yield, we allow **one** extra text-only exec (same session XOR continue, maxSteps 1, permission off, tiny yield prompt). That is not a second schema reminder. Cap: at most one schema reminder + at most one crash retry. Two native crashes fail honest. A complete `looksLikeYield` object (closed `}`) in assistant text is parsed even if more text follows. We do not invent a closing brace. `plan` on hello-pkg can reach PLAN_REVIEW with `validateWorkerYield` passing.
2. **Harness not prompt pack?** Yes — tiny-yield copy, `isHostNativeCrash`, `yieldCrashRetryRequest`, snapshot stderr cap (400), and `discover.md` crash notes live in TypeScript. Role file stayed a short contract.
3. **One core, many surfaces?** Same spawn path for `plan` / `max` / `team`. CLI and MCP do not parse worker prose.
4. **Subagents are workers not trees?** Unchanged. One `mcode exec` per worker. At most one reminder and one crash retry. No grandchild.
5. **MiniMax-native?** Yes — we follow the live host abort. Node 24 + better-sqlite3 can GC-abort; that is observed, not a ban on Node 22. Still no `--output-schema` (exit 70). First explorer exec keeps `--max-steps 20` and tools.
6. **Host honesty?** **Pass, enforced.** Exit 1 without sqlite/assert/SIGABRT is still crash / incomplete, not a crash-retry. Native stacks stay out of `discover.md` (yield summary / assistant JSON / short crash note). Snapshot may keep a 400-char stderr excerpt. We do not dump raw JSONL into the next prompt. We do not invent a WorkerYield from prose. Schema stays strict.
7. **Hero stays `max`?** Yes — implementation detail of workers inside `max` / `plan` / `team`.
8. **Codex-as-platform fit?** Typed yield is still a harness concern. One reminder. One crash retry. No hashline. No npm publish.

## 18. Coerce artifact paths the model already wrote (live reminder on Node 22)

1. **Verified delivery?** Yes — live rematch after PR #13 under Node 22 (no sqlite abort) wrote a **complete** reminder yield (~3.2k) then the parent rejected `artifacts must be string[]`. The model wrote `artifacts: [{path, role, note}, …]` plus `file_hashes`. Status/summary/findings were valid. We now read the `path` (or `file`) string the model already wrote and drop invented fields (`role`, `note`) and unknown yield keys. Missing artifacts, or items with no path, still fail. Prose is still not a yield. Truncated JSON is still not repaired. `schemaMode=strict` on the typed object: required fields and finding shape unchanged.
2. **Harness not prompt pack?** Yes — `coerceWorkerYield` / `artifactPathOf` are TypeScript. Tiny-yield copy now says `artifacts` is `string[]` of paths, not objects.
3. **One core, many surfaces?** Same `validateWorkerYield` for `plan` / `max` / `team`. CLI and MCP do not parse worker prose.
4. **Subagents are workers not trees?** Unchanged. One reminder + one crash retry cap stays.
5. **MiniMax-native?** Yes — we follow the live reminder JSON, not a second host schema flag.
6. **Host honesty?** **Pass, enforced.** We do not invent artifacts when the key is missing or an item has no path. We do not invent a WorkerYield from "I'll explore the workspace...". We do not close truncated JSON. Extra keys are ignored, not copied onto the typed yield.
7. **Hero stays `max`?** Yes.
8. **Codex-as-platform fit?** Typed yield stays a harness concern. No hashline. No npm publish.

## Failures we refused

- Did not add a second JSON-RPC next to MCP.
- Did not register `/max` or host hooks.
- Did not let interview or research Accept.
- Did not give workers a `spawn` handle.
- Did not port hashline as an edit language or teach `[PATH#TAG]` / PUT/CUT to `mcode`.
- Did not add LSP, DAP, browser, memory bank, magic keywords, advisor TUI, or 31 tools.
- Did not clone Agent Hub or spawn grandchildren.
- Did not invent live TPS numbers when the host was stubbed.
- Did not invent a WorkerYield from explorer prose or stitch file hashes into a fake yield.
- Did not loosen `validateWorkerYield` or depend on host `--output-schema`.
- Did not dump raw host JSONL into the reminder prompt.
- Did not map host exit 1 (toolUse crash / incomplete) to timeout.
- Did not keep sending `--session` and `--continue` together after the host named that pair invocation.
- Did not drop `--permission off` after the host enum confirmed it is legal.
- Did not let an empty reminder snapshot wipe first-exec assistant text.
- Did not invent a closing brace or fields for truncated yield JSON.
- Did not loosen `validateWorkerYield` to accept prose or a long essay object.
- Did not treat every exit 1 as a native-crash retry (need sqlite/assert/SIGABRT in stderr).
- Did not dump `dyld` / better-sqlite3 stacks into `discover.md`.
- Did not add a second schema reminder or a crash-retry storm.
- Did not drop tools or `--max-steps 20` on the first explorer exec.
- Did not send host `--output-schema`. Node 24 sqlite abort is documented as observed; a later rematch used Node 22 then rebuilt the addon back to 24.
- Did not invent artifact paths when the model omitted `path` / `file`.
- Did not invent a WorkerYield from blocked-explorer prose.
- Did not treat object artifacts as a schema loosen — we keep the path string the model already wrote.
- Did not add a parallel `CLAUDE.md` / Cursor rules dump (pointer file only).
- Did not copy Codex Clippy / a 300-line lint brief into `AGENTS.md`.
- Did not run live `mcode` in CI or add MiniMax secrets.
- Did not claim official marketplace listing or open a community-registry PR.
- Did not invent a WorkerYield or source-grep `hello-repair`.
- Did not npm publish.
- Did not treat a rewritten `evidence/A1-test.log` as a builder REPAIR. Index upserts by path; only leftover / workspace hashes stay blockers.
- Did not drop the one-rerun on stale workspace source hashes.
- Did not pretend Hashline / LSP / browser would catch Oh-My-Pi / Oh-My-OpenCode. Those are host ceilings.
- Did not become DeepSeek Harness (Cordis, plugin-everything, goal-round-driver, model-facing Goal tools, LLM compaction, remind-and-repair extra host exec).

## 19. Root AGENTS.md (contributor operating manual)

1. **Verified delivery?** Yes — AGENTS.md tells agents to drive `max`/`plan` and demand live evidence, which is how the loop actually closed (`plan` → PLAN_REVIEW; `max --no-llm-verify` → ACCEPT / `hello()`).
2. **Harness not prompt pack?** Yes — this file describes the TypeScript harness; it does not become the orchestrator.
3. **One core, many surfaces?** Unchanged. CLI and MCP still `submit`. The user-repo template (`examples/AGENTS.max-mode.md`) is opt-in copy; `install` does not overwrite a project `AGENTS.md`.
4. **Subagents are workers not trees?** Stated. Five workers. One exec each. No grandchildren.
5. **MiniMax-native?** Yes — host stays `mcode`; no fake `/max`. Role files stay contracts for the same host process.
6. **Host honesty?** Yes — Node 24 sqlite abort and session XOR continue are documented as observed, not wished. Rematch used Node 22 then rebuilt the addon back to 24.
7. **Hero stays `max`?** Yes. `plan` is the PLAN_REVIEW stop. The user template's hero command is `oh-my-mcode max` / `omm`.
8. **Codex-as-platform fit?** AGENTS.md is the Codex/Cursor entry; typed yield stays in TypeScript.

## 20. Fold production AGENTS.md bits (source of truth / Commands / Always-Ask-Never)

1. **Verified delivery?** Yes — still a contributor operating manual. Agents still drive `max`/`plan` and leave evidence. The Commands table names the hermetic gate and live rematch fixture. No new loop.
2. **Harness not prompt pack?** Yes — we did not copy Codex's 300-line lint brief. New host-contract facts still go in `docs/host-reality.md` + a test. `CLAUDE.md` is `@AGENTS.md`, not a second dump.
3. **One core, many surfaces?** Unchanged. CLI and MCP still `submit`. User template stayed opt-in; one source-of-truth line added.
4. **Subagents are workers not trees?** Stated. Never: grandchildren / Sisyphus catalog.
5. **MiniMax-native?** Yes — npm only (no bun/pnpm lockfile rewrite). Hero stays `max`.
6. **Host honesty?** Yes — Ask before a rematch that rebuilds better-sqlite3 on daily Node 24 `mcode`. Never run live `mcode` under Node 22 with an addon compiled for 137 (or vice versa) without an explicit rebuild. Host contract unchanged.
7. **Hero stays `max`?** Yes.
8. **Codex-as-platform fit?** AGENTS.md remains the entry. Typed yield stays in TypeScript. Resist bloating `orchestrator.ts` / `mcode.ts`.

## 21. Hermetic CI + marketplace doc + hello-repair fixture

1. **Verified delivery?** Yes — CI runs `npm test` and `npm run eval` (fixture harness). `hello-repair` is a real two-export miss (`hello()` / `greet()` imported, only `placeholder()` exported); the hermetic test runs `npm test` in a copy and expects failure. Plan/max tests stay on `hello-pkg`.
2. **Harness not prompt pack?** Yes — workflow YAML + a short doc + a fixture. No new SKILL. No invented WorkerYield.
3. **One core, many surfaces?** Unchanged. CLI and MCP still `submit`. Marketplace doc is how a human submits; it does not add a catalog API.
4. **Subagents are workers not trees?** Unchanged. No grandchildren.
5. **MiniMax-native?** Yes — npm only (no bun/pnpm). Official submit is ZIP or public GitHub with `.minimax-plugin/plugin.json` at repo root. Local install stays `npx oh-my-mcode install --yes`.
6. **Host honesty?** Yes — job is named hermetic; no live `mcode`; no MiniMax secrets. `docs/marketplace.md` does not claim we are listed. Community registry is optional and separate; this cut does not open a PR there. `evals/tasks/fail-then-repair` remains the `.repaired` stub.
7. **Hero stays `max`?** Yes.
8. **Codex-as-platform fit?** CI is a gate, not a second loop. No production ΔY. No `/max`, hooks, or Sisyphus.

## 22. Evidence index upsert (rewritten test log is not a REPAIR)

1. **Verified delivery?** Yes — Accept still requires live evidence bytes matching the current index row. Rewriting `evidence/A1-test.log` updates that row's sha256 instead of appending a ghost row. Workspace source hashes staying stale still refuse Accept. A builder is not sent to "fix" a harness index lie.
2. **Harness not prompt pack?** Yes — `addEvidence` / `staleEvidence` / `refreshEvidenceHashes` are TypeScript. Role files unchanged. No Hashline / LSP / browser.
3. **One core, many surfaces?** Same `RunStore` for CLI and MCP. `scripts/run-store.mjs` upserts the same way so TUI skills cannot recreate the lie.
4. **Subagents are workers not trees?** N/A — hashes do not spawn.
5. **MiniMax-native?** Yes — no `[PATH#TAG]`, no PUT/CUT. Content-hash stale-reject stays in `src/hash.ts` + store. Events still append (`test_ran` per write).
6. **Host honesty?** Yes — 17–20k input tax and Node 24 sqlite abort are documented as `mcode` ceilings, not something we catch by becoming Oh-My-Pi / Oh-My-OpenCode. One re-run remains for stale **workspace** hashes only.
7. **Hero stays `max`?** Yes.
8. **Codex-as-platform fit?** Evidence records remain store artifacts. EQ (`events.jsonl`) still appends. The index upserts. Stale workspace hash is still an approval failure.

## 23. Learnable bits from OMO/OMP (install / goal acceptance / follow-goal / skip-discover)

1. **Verified delivery?** Yes — every `plan` / `max` run persists a runnable acceptance command when the workspace or goal has one, **before** the first host exec. Accept still requires that command to pass plus evidence files. No command → today's `no_test` blocker. follow-goal's `npm test` encodes “export `hello()`, do not add `greet`”. Concrete `max` still writes `discover.md` so resume has a snapshot.
2. **Harness not prompt pack?** Yes — `src/install.ts` `install`, `src/acceptance.ts`, orchestrator skip-discover, `evals/runner.mjs`. Role files stayed short. We did not add Hashline / a sixth worker / a fake `/max`.
3. **One core, many surfaces?** Install is still the only writer of `~/.minimax/plugins/oh-my-mcode`. CLI `--skip-host` / `--yes` / `--discover` call the same TypeScript. MCP did not grow a second installer. TUI `scripts/run-store.mjs` seeds the same acceptance shape on create.
4. **Subagents are workers not trees?** Unchanged. Skipping DISCOVER removes one host exec; it does not spawn grandchildren. follow-goal is a fixture stub, not a new role.
5. **MiniMax-native?** Yes — host install is official `@minimax-ai/code` via npm. We do not curl `omp.sh`. We do not ship `omo-ai@beta`. Hero stays `oh-my-mcode max`.
6. **Host honesty?** **Pass, enforced.** Never hit the npm registry in CI (installer is injected; default installer refuses `CI` / `OMM_HERMETIC`). Never run live `mcode` in GitHub Actions. We do not claim marketplace listing or a production ΔY. Finding classes are `command_failed` / `no_test` / `stale_workspace` / `host_crash` — not HTTP 413. Acceptance `npm test` drops parent `npm_*` / `INIT_CWD` / `NODE_TEST_CONTEXT` so a nested lifecycle or parent `node --test` cannot false-Accept.
7. **Hero stays `max`?** Yes. One-command install is how the harness becomes visible. `plan` still always discovers. `--discover` forces explorer on `max`.
8. **Codex-as-platform fit?** Acceptance list is the first reply (后填充): run id + how we will know we are done, then DISCOVER/PLAN/EXECUTE fill in. Typed yield stays strict. Eval baseline still says “Fixture harness only. Not a production ΔY statistic.”

## 24. Learnable bits from DeepSeek Harness (goal snapshot / loop-hygiene guard / orthogonal host outcomes)

DSH (`deepseek-ai/deepseek-harness`) is a Cordis plugin host: `ctx.goals` event-sourced GoalSnapshot, `repeat-tool-reminder`, tool-result-pruner, `ctx.compaction`, goal-round-driver idle auto-continue, model-facing Goal tools. We read that and copied **three harness facts**, not the architecture.

Learned: (1) a logged goal snapshot makes “why did we stop” reconstructable — `phase` + kebab-case `blockedReason.code` + `roundsStarted`, every mutation a `goal_changed` event. (2) The inline repair-stop belongs in a guard with stable codes (`repeat-finding`, `repair-cap`), not a silent `break` that leaves `rejected`. (3) Node `close(code, signal)` after our SIGTERM is not crash exit 1; `timedOut` and `signal` are orthogonal to `exitCode`.

Refused: Cordis / plugin-everything / profiles / bundles / `--dump-config`. Subagents / agent teams / a sixth worker. LSP, web UI, code mode, creator mode, self-modification. Goal-round-driver idle auto-continue, pause/resume/clear/disarm, Ralph-style independent attempts, model-facing Goal tools. LLM compaction / `ctx.compaction`. Sisyphus, fake `/max`, hooks, Hashline. Marketplace listing or a production ΔY. Live `mcode` in CI. **Advisory remind-and-repair is deferred** — DSH injects a nudge before blocking; an extra host exec here still costs 17–20k input tokens. Stop on first repeat stays one-shot. `pruneInjectedText` is a head+tail clip on the findings string already injected into the next builder prompt, not a compaction seam.

1. **Verified delivery?** Yes — `goal_state` is armed before the first host exec (same moment as acceptance). VERIFY accept completes the goal. Guard block sets `status=blocked` with a machine-routable code and does **not** start another REPAIR / host exec. Accept still requires evidence files. Native-crash planning yield already rejected today; we now also `goal.block` `host-crash`.
2. **Harness not prompt pack?** Yes — `src/goal.ts` + `src/guard.ts` + `finalizeHostExit` in TypeScript. Role files unchanged. No model-facing goal tools. No new SKILL.
3. **One core, many surfaces?** Same `RunStore` / `submit` for CLI and MCP. TUI twin `scripts/run-store.mjs` writes the same `goal_state` shape on create and completes it on accepted findings. Not a second store.
4. **Subagents are workers not trees?** Unchanged. Five roles. One exec each. Guard does not spawn. No grandchild API.
5. **MiniMax-native?** Yes — we stay a thin orchestrator on `mcode`. Not a Cordis host. Hero stays `oh-my-mcode max`.
6. **Host honesty?** **Pass, enforced.** `timedOut` is true if our timer fired **or** host exit 6, even when `exitCode===0`. SIGTERM-from-our-timer is not a native crash. `isHostNativeCrash` still needs crash exit + sqlite/assert/SIGABRT stderr. We do not invent HTTP/OMP block codes. We do not add an extra host exec on the repeat-finding path.
7. **Hero stays `max`?** Yes. Goal/guard/timeout are implementation details of `max` / `plan` / `team`.
8. **Codex-as-platform fit?** Goal snapshot is run-store state (thread). `goal_changed` / `guard_fired` are EQ events. Typed yield stays strict. No compaction channel. No second runtime.
