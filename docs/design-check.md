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

## Failures we refused

- Did not add a second JSON-RPC next to MCP.
- Did not register `/max` or host hooks.
- Did not let interview or research Accept.
- Did not give workers a `spawn` handle.
