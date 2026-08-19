# Oh My MiniMax Code

**不是更多 agent。而是带证据的验收完成。**

`oh-my-mcode` 是 MiniMax Code 的验证交付层：**描述 → 规划 → 实现 → 独立验收 → 发布**，带可落盘的 run，以及作者不能给自己打分的检查。

它对标的是 Oh My OpenCode 那一类**真正有用的交付层**：一个主入口、默认工作流、持久状态、独立验收、修复循环、doctor、看得见的证据。它**不是** Claude 风格的多智能体提示词包，也**不是** MiniMax-AI 官方产品。作者：[haoruilee](https://github.com/haoruilee)。许可证：MIT。

```bash
oh-my-mcode max "fix auth and prove tests pass"
```

你只需要记住 `max`。

## 为什么做这个

MiniMax Code 已经有 agent、Plan Mode、Goal、会话恢复、`mcode exec` 和插件市场。Superpowers 一类包装的是方法论。那不是缺口。

缺口是**真正拥有交付闭环**：可以 resume 的 run、不是写在散文里的测试、不能改产品代码的 verifier、可以贴进 PR 的目录。

v0 是 **OMM Lite** —— 一个宿主 agent + 本工作流。角色文件是契约，不是被拉起的人格。等宿主公开 spawn/cancel/resume API，再做 Team。

## 安装（mcode 0.1.6）

需要 Node 22+ 和 MiniMax Code CLI `mcode` 0.1.6（`@minimax-ai/code`）。

```bash
git clone https://github.com/haoruilee/oh-my-mcode
cd oh-my-mcode
npm install && npm link
oh-my-mcode install       # 复制插件到 ~/.minimax/plugins/oh-my-mcode
oh-my-mcode doctor
oh-my-mcode max "..."
```

`install` 是**复制**，不是符号链接。在 0.1.6 上，把文件夹放进 `~/.minimax/plugins` 会自动安装并启用。确认：

```bash
mcode --version
mcode plugin list -m local
mcode plugin list -m local --json
```

也可用 `scripts/install.sh` / `scripts/install.ps1`。官方目录是另一套注册表，本仓库不声称已上架。

## 怎么用

**CLI（拥有循环）：**

```bash
oh-my-mcode max "fix auth and prove tests pass"
oh-my-mcode plan "migrate mysql to postgres"
oh-my-mcode verify [run_id]
oh-my-mcode resume [run_id]
oh-my-mcode doctor
oh-my-mcode install
```

别名：`omm`。

**TUI（同一契约）：** 在 MiniMax Code 桌面端或 `mcode` 里说：

> max mode: 修失败的 auth 测试并证明它们通过

这会触发名为 `max` 的 **Skill**。它不是已注册的 `/max` 命令。宿主已有 `/plan` `/goal` `/resume`，我们与之共存。

没有 CLI 时，Skill 仍会写入 `<workspace>/.minimax/runs/<run_id>/`。

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

VERIFY 先在进程内跑检测到的测试/构建。作者不能给自己的工作打分。

## 这不是什么

- 不是 Superpowers 克隆
- 不是 20 个 agent / Agent Team
- 不是第二条 `mavis max` 命令行
- 不是 MiniMax-AI 官方项目
- 不是「已经在官方市场上架」

## 兼容性

| 宿主 | 包 | 状态 |
| --- | --- | --- |
| MiniMax Code CLI / 桌面 | `@minimax-ai/code` **0.1.6** | 按此版本核实 |
| 公开插件面 | 仅 Skills + MCP | v0 只发布 Skills |
| Hooks / Commands / 自定义 Agents | 未公开 | 不宣传为已可用 |

## 路线

- **Lite（现在）：** CLI 编排器 + Skill 插件 + run store + 确定性验收
- **Team：** 等宿主公开派生 API
- **斜杠命令：** 等 Commands 成为公开插件能力

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
