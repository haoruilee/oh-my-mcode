# 宿主现状（mcode 0.1.6，2026-08-20 核实）

这是 **haoruilee** 的社区项目，不是 MiniMax-AI 官方产品，也不主张 MiniMax 所有权。

## 宿主已经有什么

本插件对应的宿主是 MiniMax Code CLI **`mcode`** 0.1.6（`@minimax-ai/code`）。数据目录是 `~/.minimax`。

MiniMax 生态里有三个不同的 CLI。用户安装步骤里不要混写：

| 命令 | 是什么 | 写进用户安装步骤？ |
| --- | --- | --- |
| `mcode` | MiniMax Code（`@minimax-ai/code`）—— 本插件的宿主 | **只提这个** |
| `mmx` | 多模态平台 CLI | 否 |
| `mavis` | 旧名；当前宿主上 `~/.mavis` 可能指向 `~/.minimax` | 否 |

宿主已有 `explore`、`mavis`、`verifier`、`worker` 等 agent，以及 Plan Mode、Goal、会话恢复、`mcode exec`、ACP、官方插件市场、TUI 斜杠命令 `/plan` `/goal` `/resume`，以及桌面 `/team`。

本仓库 `agents/*.md` 只是**角色契约**，复用这些名字；我们没有注册新的宿主 agent。公开 Agent Plugin 今天做不到这一点。

## 我们不拥有的斜杠命令

官方 TUI 已有 `/plan`、`/goal`、`/resume`，桌面还有 `/team`。

我们的 `plan`、`resume` Skill **不得**声称注册了这些命令。它们只靠自然语言触发（「make a verified plan」「继续上一次 oh-my-mcode run」）。

我们与宿主 `/plan` / `/goal` / `/resume` / `/team` **共存**。我们补上可落盘的 run/证据，**不替换** Plan Mode。宿主 `/resume` 是会话恢复；我们的 `resume` Skill 恢复的是 `.minimax/runs/<run_id>` 阶段。

没有已注册的 `/max`。请说 `max mode: …`。

## 公开插件能力

根据 MiniMax-AI/MiniMax-Code-Plugins `docs/plugin-compatibility.md`：

- 可以：Skills、MCP（stdio / streamable-http / sse）
- 不可以：hooks、自定义 Agents、Commands / 斜杠命令、LSP、Apps/UI、通用 OAuth、TUI 扩展

主入口是 `oh-my-mcode max` / 别名 `omm`，加上名为 `max` 的 **Skill**（自然语言）。这不是 `mavis max`，也不是 `mmx` 包装器。宿主命令仍是 `mcode`。

## 本地市场（0.1.6 实测）

- 目录：`~/.minimax/plugins`
- 把插件文件夹放进去会自动安装并启用，不需要 `plugin add`
- `mcode plugin list -m local --json` 会显示 installed+enabled
- 探测中 `.minimax-plugin/plugin.json` 的 `displayName` 被忽略，目录显示名来自便携 `plugin.json` 的 `name`。两份清单仍然都发布
- 官方目录是另一套注册表。本插件不声称已上架

## 不是 MiniMax-AI/skills

[MiniMax-AI/skills](https://github.com/MiniMax-AI/skills) 是面向 Claude / Cursor / Codex / OpenCode 的大 skill 包，**不是** MiniMax Code 插件市场。不要让用户从那条路径安装 oh-my-mcode。

## 和市场里别人的差别

官方市场目前主要是领域 Skills（办公、金融、法律）外加 Superpowers 这类方法论包。Superpowers 是最接近的竞品。我们不靠「更多方法论」或「20 个 agent」取胜，而靠独立验收和可落盘的 run/证据。

## 无界面驱动

`mcode exec` 已有 `--session`、`--continue`、`--output-format`、`--output-schema`、`--permission`。以后可以用 `mcode exec` + 加载 max skill 的提示词做无界面驱动。这不是第二条产品 CLI。

**mcode 0.2.1** 的 `--output-schema <json>` 要的是 JSON 对象字符串，不是文件路径。传 `schemas/worker-yield.schema.json` 会失败：

```
mcode exec failed: --output-schema requires a JSON object.
```

后续实测（0.2.1 / Node 24.19.0）：即使传 JSON 对象，每个 worker `mcode exec` 仍会 **exit 70**（`Sw.internal = 70`，宿主内部错误）。同一条 prompt **不带** `--output-schema` 则 exit 0，`exec.result.answer` 是合法 yield JSON。

默认 argv 因此不传 `--output-schema`。Schema 仍落在磁盘上。Yield 由 TypeScript 在 exec 之后校验（`schemaMode: strict`），从 `exec.result.answer` / assistant JSON / `structuredOutput.data` 解析。实验可设 `OMM_HOST_OUTPUT_SCHEMA=1`；`readOutputSchemaArg` 仍会序列化对象（从不传路径）。

同一套 0.2.1 宿主里，`--timeout` 由 `chm` 解析：`/^(\d+)(ms|s|m|h)?$/i`。裸整数是**毫秒**，不是秒。PR #9 之后，`oh-my-mcode plan` 绑定了真实 session（`mvs_…`，`host_session_source: host`），随后 discover 以 **exit 6**（`Sw.timeout = 6`）失败：我们给 3 分钟 explorer 默认值传了 `--timeout 180`，宿主当成 180ms。实测 first_token_ms ~6030，然后超时。`doctor --smoke` 不传 `--timeout`，18s 成功；手动 `mcode exec --timeout 45s` 也成功。因此 worker argv 必须带单位后缀（`180s`），从不传裸整数。角色默认值对内仍用毫秒。

扁平 `oh-my-mcode team` 是 TypeScript 调度器（不派生孙 agent）。它**不是**宿主 Agent Team，也不是递归派生。桌面 `/team` 仍是宿主的。App 面板、已注册的 `/max`、hooks 要等公开 Extension API。

## 能检查什么

存在：`mcode --version`、`mcode plugin list --json`、`mcode plugin list -m local --json`。

不存在公开的「Skill 是否已建索引」API。`doctor` 不会假装有。
