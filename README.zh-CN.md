# Oh My MiniMax Code

**不是更多 agent。而是带证据的验收完成。**

`oh-my-mcode`（别名 `omm`）是 MiniMax Code 的验证交付层：**描述 → 规划 → 实现 → 独立验收 → 发布**，带可落盘的 run，以及作者不能给自己打分的检查。

它**不是** Claude 风格的多智能体提示词包，也**不是** MiniMax-AI 官方产品。作者：[haoruilee](https://github.com/haoruilee)。许可证：MIT。

```bash
oh-my-mcode max "fix the failing auth tests and prove they pass"
```

你只需要记住 `max`。别名：`omm`。这不是已注册的宿主命令 `/max`。

## 为什么做这个

MiniMax Code 已经有 Plan Mode、Goal、会话恢复、`mcode exec` 和插件市场。Superpowers 一类包装的是方法论。那不是缺口。

缺口是**真正拥有交付闭环**：可以继续的 run、不是写在散文里的测试、不能改产品代码的 verifier、可以贴进 PR 的目录。

v0 是 **OMM Lite** —— 一个宿主 agent + 本工作流。角色文件是契约，不是被拉起的人格。

我们与宿主的 `/plan`、`/goal`、`/resume` 以及桌面 `/team` **共存**。那些仍是宿主功能。我们补上可落盘的 run/证据，**不替换** Plan Mode。本插件的 `plan` / `resume` Skill **没有**注册这些斜杠命令。

## 安装（mcode 0.1.6）

需要 Node 22+ 和 MiniMax Code CLI **`mcode`** 0.1.6（`@minimax-ai/code`）。

```bash
git clone https://github.com/haoruilee/oh-my-mcode
cd oh-my-mcode
npm install
npm link
oh-my-mcode doctor
oh-my-mcode install
```

`oh-my-mcode install` 会把插件**复制**到 `~/.minimax/plugins/oh-my-mcode`（不是符号链接）。在 0.1.6 上这样放置会自动安装并启用。用宿主确认：

```bash
mcode --version
mcode plugin list -m local
mcode plugin list -m local --json
```

**不要**从 [MiniMax-AI/skills](https://github.com/MiniMax-AI/skills) 安装本插件。那个仓库是 Claude / Cursor / Codex / OpenCode 的 skill 包，不是 MiniMax Code 插件。

官方目录是另一套注册表。本仓库不声称已上架。

## 怎么用

**CLI（拥有循环）：**

```bash
oh-my-mcode max "fix the failing auth tests and prove they pass"
oh-my-mcode plan "migrate mysql to postgres"
oh-my-mcode verify [run_id]
oh-my-mcode resume [run_id]
oh-my-mcode doctor
oh-my-mcode install
```

**TUI（同一契约）：** 插件安装之后，也可以说 `max mode: …`、`make a verified plan`、`re-verify this run`。Skill 靠措辞触发，**不会**注册 `/max`、`/plan`、`/resume`。

宿主 `/plan` 是 Plan Mode。宿主 `/resume` 是会话恢复。宿主 `/goal` 是 Goal。桌面 `/team` 是 Agent Team。要用宿主功能就用那些斜杠命令。要带证据的 durable run，用 `oh-my-mcode`。

## 证据长什么样

```
<workspace>/.minimax/runs/<run_id>/
  run.json
  plan.md
  tasks.json
  events.jsonl
  evidence/
  findings.json
  summary.md
```

Accepted **必须**有磁盘上的证据文件。LLM 评判若启用，只读，且不是唯一信号。示例见 `examples/sample-run/`。

## 工作流

`INTAKE → DISCOVER → PLAN → PLAN_REVIEW → EXECUTE → VERIFY → (REPAIR)×≤3 → ACCEPT → RELEASE`

VERIFY 优先跑仓库里真实的测试/构建命令。作者不能给自己的工作打分。

## 这不是什么

- 不是 Superpowers 克隆
- 不是 20 个 agent / Agent Team
- 不是替换宿主 `/plan` / `/goal` / `/resume` / `/team`
- 不是 `mavis max`，也不是 `mmx` 包装器——宿主命令仍是 `mcode`
- 不是通过 MiniMax-AI/skills 安装
- 不是 MiniMax-AI 官方项目
- 不是「已经在官方市场上架」

## 兼容性

| 宿主 | 包 | 状态 |
| --- | --- | --- |
| MiniMax Code CLI / 桌面 | `@minimax-ai/code` **0.1.6** | 按此版本核实 |
| 公开插件面 | 仅 Skills + MCP | v0 只发布 Skills |
| 宿主斜杠命令 | `/plan` `/goal` `/resume` `/team` | 共存；我们不注册它们 |
| Hooks / Commands / 自定义 Agents | 未公开 | 不宣传为已可用 |

## 路线

- **Lite（现在）：** CLI 编排器 + Skill 插件 + run store + 独立验收
- **Team：** 等宿主向插件公开派生 API
- **斜杠命令：** 等 Commands 成为公开插件能力；在此之前用 CLI + 自然语言

## 开发

```bash
npm test
node scripts/doctor.mjs
oh-my-mcode doctor --package-only
```

无安装时联网、无遥测、无密钥、包内无符号链接。

## 文档

- [宿主现状](docs/host-reality.zh-CN.md)
- [架构](docs/architecture.zh-CN.md)
- [English](README.md)
