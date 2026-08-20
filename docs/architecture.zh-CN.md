# 架构

对外产品是 **Skill 优先的插件**，加上拥有循环的 `oh-my-mcode` / `omm` CLI。角色文件是契约，不是被拉起的人格。没有空壳 monorepo。

## 承诺

不是更多 agent、更多 skill、更长记忆。而是带证据的验收完成。

## 一个窗口，一份状态

| 表面 | 入口 | 谁驱动循环 |
| --- | --- | --- |
| TUI | 「max mode: …」/「make a verified plan」/「re-verify this run」 | Skill `max` / `plan` / `verify` / `resume` / `review` / `ship` / `research` / `team` |
| CLI（拥有循环） | `oh-my-mcode max` / `omm` | TypeScript 编排器 |
| 无界面 | `mcode exec` + 加载 max skill 的提示词 | 仍然是 `mcode`，不是 `mmx` / `mavis` 包装器 |

状态不只活在 prompt 里：`<workspace>/.minimax/runs/<run_id>/`。

`scripts/run-store.mjs` 是 Skill 改状态时用的无构建工具。`src/` 下的 TypeScript 是同一套契约，给测试/CI 用。不宣传为 `omm` 或 `mavis max`。

阶段：`INTAKE → DISCOVER → PLAN → PLAN_REVIEW → EXECUTE → VERIFY → (REPAIR)* → ACCEPT → RELEASE`。

只有 `verify` Skill 可以写 Accepted / Rejected。没有证据文件就不能 Accepted。

宿主 `/plan` / `/goal` / `/resume` / `/team` 不变。这台状态机是 oh-my-mcode run，不是 Plan Mode。
