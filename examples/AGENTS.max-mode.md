# AGENTS.md — Max Mode (opt-in)

Copy this file to the **root** of a product repo as `AGENTS.md` if you want Codex / Cursor / MiniMax Code to drive verified delivery through **oh-my-mcode**. Once copied, it is the source of truth for agent instructions in that user repo.

`oh-my-mcode install` copies the plugin into `~/.minimax/plugins/oh-my-mcode`. It does **not** write or overwrite a project `AGENTS.md`. This template is opt-in.

## Hero

```bash
oh-my-mcode max "<goal>" --workspace . --permission smart
# alias:
omm max "<goal>" --workspace . --permission smart
```

That is the full loop: DISCOVER → PLAN → PLAN_REVIEW → EXECUTE → VERIFY → ACCEPT. Evidence lands in `.minimax/runs/<run_id>/`. No evidence folder → the loop did not run. The run persists a runnable acceptance command (from the goal or a detected test/build) before the first host exec. Concrete `max` may skip DISCOVER; `plan` always discovers. `--discover` forces the explorer exec.

`oh-my-mcode plan "<goal>"` stops at PLAN_REVIEW and does not Accept.

## Plugin skills (TUI)

If the oh-my-mcode plugin is installed, natural-language phrasing is enough. These are **not** host slash commands.

| Say | Skill | Does |
| --- | --- | --- |
| `max mode: <goal>` | `max` | Full verified-delivery loop |
| `make a verified plan` | `plan` | Discover + plan; stop at PLAN_REVIEW |
| `re-verify this run` | `verify` | Independent accept / reject. Writer never grades the writer. |

Host `/plan` `/goal` `/resume` `/team` stay the host’s. There is no registered `/max`.
