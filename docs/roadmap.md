# Roadmap vs original plan

Community project for MiniMax `mcode`. Not official MiniMax-AI.

This maps the original product plan to what this repo ships. Host-honesty: public plugin surface is **Skills + MCP only**. No hooks, registered slash commands, custom plugin agents, or App UI slots.

## Shipped in this repo

| Plan | What shipped |
| --- | --- |
| §7 Command surface | CLI: `max` `plan` `verify` `resume` `review` `ship` `research` `attach` `status` `cancel` `inspect` `team` `interview` `doctor` `install`. Hero remains `oh-my-mcode max` / `omm`. Matching Skills including `interview`. `npx oh-my-mcode install` is the one-liner |
| Persistent run + EventStore | `.minimax/runs/<id>/` with atomic writes. Extra events include `interview_completed`, `subagent_spawned`, `host_session_bound` |
| Session continuity + MCP | One host session per run; CLI + MCP go through `src/harness.ts` `submit`; MCP JSON-RPC is the app-server-shaped surface |
| HUD / App-CLI unification | `attach` / `status` render the same folder TUI skills write. No host daemon API |
| Phase C flat team | `team` / `max --team`: TypeScript scheduler, bounded concurrency (default 2), optional git worktrees. No grandchild agents. Sequential `max` stays default |
| Ralph / todo continuation | `tasks.json` is source of truth. `resume` never invents a goal. `--ralph` continues until Accepted with the existing repair bound. Repeated failure signatures escalate in `summary.md` |
| §8.6 Tool repair | `src/tool-repair.ts`: classify spawn/parse; at most one retry; then block + `repair_requested` |
| Config | `<workspace>/.minimax/oh-my-mcode.json` and `~/.minimax/oh-my-mcode.json`; flags override |
| §9 Doctor + inspect | Packaged skills present + frontmatter; bins resolve; store writable; mcode version; plugin drop-in; `doctor --smoke` pong exec; silent skill drop is an error |
| §13 Evals | `evals/` harness + 4 fixtures (pass / fail-then-repair / plan-only / follow-goal) + checked-in baseline + `npm run eval`. **No production ΔY claim** |
| Workflows | `workflows/*.yaml` parsed by `src/workflows.ts` (max/plan/verify/review/ship/research/team/interview) |
| Harness / subagent | `src/harness.ts` + `src/subagent.ts`: thread=run, EQ=`events.jsonl`, no grandchild spawn. See `docs/harness.md` |
| Host coexistence | We do not claim `/plan` `/goal` `/resume` `/team`. Natural-language Skills only |

## Still needs a MiniMax Extension API

These are **not** shipped and are **not** advertised as working:

| Capability | Why blocked |
| --- | --- |
| App panels / widgets in the MiniMax UI | Apps are not a public Agent Plugin capability |
| Registered `/max` (or `/omm`) slash command | Commands are not a public plugin capability. Host already owns `/plan` `/goal` `/resume` `/team` |
| Hooks (pre/post tool, session lifecycle) | Hooks are not public |
| Custom plugin agents / host Agent Team spawn-cancel-resume APIs | Public plugins cannot register agents. Desktop `/team` stays the host's |
| Skill index inspect ("was this skill dropped by the host?") | No public API. We can only prove manifest ↔ disk and `mcode plugin list` |
| Official marketplace listing | Separate MiniMax registry. This repo does not claim to be listed. How a human submits: [marketplace.md](marketplace.md) |

Do not add empty packages (`workflow-engine`, `sdk`, `app-widgets`) to fake those APIs.

## What we will not do even if the API appears tomorrow

- Recursive agent trees / 1100-line Sisyphus orchestrator
- Builder marking Accepted
- Silent skill drop
- Install via MiniMax-AI/skills
- Claiming official MiniMax-AI ownership
