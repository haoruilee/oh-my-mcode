# 宿主现状（mcode 0.1.6，2026-08-20 核实）

这是 **haoruilee** 的社区项目，不是 MiniMax-AI 官方产品，也不主张 MiniMax 所有权。

## 宿主已经有什么

本地 CLI 是 `mcode` 0.1.6（`@minimax-ai/code`），**不是** `mavis`。数据目录是 `~/.minimax`。当前宿主上 `~/.mavis` 是指向它的符号链接。

宿主已有 `explore`、`mavis`、`verifier`、`worker` 等 agent，以及 Plan Mode、Goal、会话恢复、`mcode exec`、ACP、官方插件市场。本仓库 `agents/*.md` 只是**角色契约**，复用这些名字；我们没有注册新的宿主 agent。公开 Agent Plugin 今天做不到这一点。

## 公开插件能力

根据 MiniMax-AI/MiniMax-Code-Plugins `docs/plugin-compatibility.md`：

- 可以：Skills、MCP（stdio / streamable-http / sse）
- 不可以：hooks、自定义 Agents、Commands / 斜杠命令、LSP、Apps/UI、通用 OAuth、TUI 扩展

因此我们**不会**把 `/max` 说成已注册的宿主命令。宿主已有 `/plan` `/goal` `/resume`，我们与之共存。入口是：

- CLI：`oh-my-mcode max "..."`（别名 `omm`）
- TUI：对代理说 `max mode: ...`，触发名为 `max` 的 **Skill**

## 本地市场（0.1.6 实测）

- 目录：`~/.minimax/plugins`
- 把插件文件夹放进去会自动安装并启用，不需要 `plugin add`
- `mcode plugin list -m local --json` 会显示 installed+enabled
- 探测中 `.minimax-plugin/plugin.json` 的 `displayName` 被忽略，目录显示名来自便携 `plugin.json` 的 `name`。两份清单仍然都发布
- 官方目录是另一套注册表。本插件不声称已上架

官方提交格式在 `.minimax-plugin/plugin.json`。便携 Agent Plugins 1.0 在仓库根 `plugin.json`。

## 和市场里别人的差别

官方市场目前主要是领域 Skills（办公、金融、法律）外加 Superpowers 这类方法论包。Superpowers 是最接近的竞品。我们不靠「更多方法论」或「20 个 agent」取胜，而靠：**编排器真正拥有交付闭环**、独立的确定性验收、可落盘的 run/证据。

## 无界面驱动

`mcode exec` 已有 `--session`、`--continue`、`--output-format`、`--output-schema`、`--permission`。`oh-my-mcode max` 驱动 `mcode exec --output-format stream-json`。这不是第二条 `mavis max` 产品线。

v0 不做 Agent Team / 递归派生。等宿主公开 spawn/cancel/resume API 再说。

## 能检查什么

存在：`mcode --version`、`mcode plugin list --json`、`mcode plugin list -m local --json`。

不存在公开的「Skill 是否已建索引」API。`doctor` 不会假装有。
