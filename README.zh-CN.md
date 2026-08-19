# Oh My MiniMax Code

**不是更多 agent。而是带证据的验收完成。**

面向 MiniMax Code 的 Skill 优先插件：**描述 → 规划 → 实现 → 独立验收 → 发布**，带可落盘的 run，以及作者不能给自己打分的检查。

它**不是** Claude 风格的多智能体提示词包，**不是** MiniMax-AI 官方产品，也**不是**第二条命令行。作者：[haoruilee](https://github.com/haoruilee)。许可证：MIT。

在 MiniMax Code（桌面或 `mcode` TUI）里说：

> max mode: 修失败的 auth 测试并证明它们通过

这就是主入口。没有已注册的 `/max`。

## 为什么做这个

MiniMax Code 已经有 Plan Mode、Goal、会话恢复、`mcode exec` 和插件市场。Superpowers 一类包装的是方法论。那不是缺口。

缺口是**真正拥有交付闭环**：可以继续的 run、不是写在散文里的测试、不能改产品代码的 verifier、可以贴进 PR 的目录。

v0 是 **OMM Lite** —— 一个宿主 agent + 本工作流。角色文件是契约，不是被拉起的人格。

我们与宿主的 `/plan`、`/goal`、`/resume` 以及桌面 `/team` **共存**。那些仍是宿主功能。我们补上可落盘的 run/证据，**不替换** Plan Mode。本插件的 `plan` / `resume` Skill **没有**注册这些斜杠命令。

## 安装（mcode 0.1.6）

需要 MiniMax Code CLI **`mcode`** 0.1.6（`@minimax-ai/code`）。用户安装步骤只提 `mcode`。

```bash
git clone https://github.com/haoruilee/oh-my-mcode
cd oh-my-mcode
./scripts/install.sh          # 复制到 ~/.minimax/plugins/oh-my-mcode
# Windows: powershell -File scripts/install.ps1
```

在 0.1.6 上，把文件夹放进 `~/.minimax/plugins` 会自动安装并启用（复制，不是符号链接）。用你已经在用的宿主确认：

```bash
mcode --version
mcode plugin list -m local
mcode plugin list -m local --json
```

**不要**从 [MiniMax-AI/skills](https://github.com/MiniMax-AI/skills) 安装本插件。那个仓库是 Claude / Cursor / Codex / OpenCode 的 skill 包，不是 MiniMax Code 插件。

官方目录是另一套注册表。本仓库不声称已上架。

## 怎么用（自然语言）

插件可见之后，对代理说话。Skill 靠措辞触发，不是斜杠命令：

| 这样说 | Skill |
| --- | --- |
| `max mode: <任务>` / `verified mode` / `run this to accepted evidence` | `max` — 完整闭环到 Accepted 证据 |
| `make a verified plan for …` / `只做计划` | `plan` — 发现 + 规划 + 评审，不改产品代码 |
| `re-verify this run` / `按验收标准再验一次` | `verify` — 独立验收 |
| `继续上一次 oh-my-mcode run` | `resume` — 恢复 **run store** 阶段 |
| `oh-my-mcode 插件装好了吗` | `doctor` |

宿主 `/plan` 是 Plan Mode。宿主 `/resume` 是会话恢复。宿主 `/goal` 是 Goal。桌面 `/team` 是 Agent Team。要用宿主功能就用那些斜杠命令。要带证据的 oh-my-mcode run，用上面的句子。

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
- 不是第二条用户命令行（`omm`、`mavis max`、`mmx` 包装器）
- 不是替换宿主 `/plan` / `/goal` / `/resume` / `/team`
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

- **Lite（现在）：** Skill 插件 + run store + 独立验收
- **Team：** 等宿主向插件公开派生 API
- **斜杠命令：** 等 Commands 成为公开插件能力；在此之前只有自然语言

## 开发

```bash
npm test
node scripts/doctor.mjs
```

无安装时联网、无遥测、无密钥、包内无符号链接。

## 文档

- [宿主现状](docs/host-reality.zh-CN.md)
- [架构](docs/architecture.zh-CN.md)
- [English](README.md)
