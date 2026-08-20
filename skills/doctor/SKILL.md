---
name: doctor
description: |
  Inspect whether oh-my-mcode is visible to MiniMax Code, skills are on disk, manifests match, and the run store can write. Triggers: "oh-my-mcode doctor", "is the plugin installed", "why isn't max mode showing up", "check local marketplace plugin". Do not trigger for product implementation, planning a feature, verifying a run's acceptance criteria, or general mcode troubleshooting unrelated to this plugin.
license: MIT
compatibility: Requires MiniMax Code 0.1.6+ with Agent Plugin Skills.
metadata:
  version: "0.1.0"
  author: haoruilee
  displayName: Doctor
  displayName_zhHans: 插件自检
---

# Doctor

Honest install and package checks. No telemetry. No network.

中文名：插件自检。

## Inputs

- Plugin root (repo checkout or `~/.minimax/plugins/oh-my-mcode`).
- Optional workspace, to test run-store writability.

## Procedure

1. Run the package checker (this is the real test):
   `node <plugin-root>/scripts/doctor.mjs`
   Doctor requires `mcp.json`, a non-empty `mcpServers` list, and `mcp/server.mjs`. If MCP tools `omm_*` exist, prefer them over hand-writing run files.
2. Suggest host commands that **exist** on mcode 0.1.6:
   - `mcode --version`
   - `mcode plugin list --json`
   - `mcode plugin list -m local`
   - `mcode plugin list -m local --json`
3. Check the drop-in path `~/.minimax/plugins/oh-my-mcode`. If the folder is missing, point at `scripts/install.sh` or `scripts/install.ps1`. Do not send the user to MiniMax-AI/skills.
4. Confirm both manifests exist and list every packaged skill path (max, plan, verify, resume, doctor, review, ship, research, team, interview). Missing listed skills are an error, not a silent drop. Optional host smoke: `oh-my-mcode doctor --smoke` (tiny `mcode exec` pong). Optional host TPS: `oh-my-mcode doctor --tps` — real stream-json usage, or `unmeasured` if the host is missing/stubbed (non-zero unless `--allow-stub`). Do not invent tok/s.
5. Confirm `<workspace>/.minimax/runs/` is creatable by `run-store.mjs create` if the user wants a write probe.

## Output contract

- Pass / fail from `doctor.mjs`.
- What was actually observed (`plugin list` JSON if the command ran).
- What **cannot** be proven: MiniMax Code has no public "is this Skill indexed?" inspect API. If the plugin is installed+enabled in `plugin list` and `SKILL.md` files exist, say so. Do not claim the model will definitely trigger `max`.

## Failure handling

- `mcode` not on PATH: say so. Check the folder layout anyway.
- Plugin present but disabled: tell the user to enable it in the marketplace UI; this repo does not invent a `plugin add` requirement for local drop-in (0.1.6 auto-enables copies under `~/.minimax/plugins`).
- `displayName` from `.minimax-plugin/plugin.json` may be ignored; the local catalog may show portable `plugin.json` `name` (`oh-my-mcode`). Report whichever string the host printed.

## Examples

User: `oh-my-mcode doctor`

Run `node scripts/doctor.mjs`, then `mcode plugin list -m local --json` if available.

User: `doctor the auth tests`

Wrong skill. That is `verify` or `max`.
