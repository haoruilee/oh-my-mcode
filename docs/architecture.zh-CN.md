# 架构

v0 是 **OMM Lite**：一个宿主 agent + 本工作流，由 TypeScript 编排器拥有。角色文件是契约，不是被拉起的人格。没有空壳 monorepo。

## 承诺

不是更多 agent、更多 skill、更长记忆。而是带证据的验收完成。

## 两个窗口，一份状态

| 表面 | 入口 | 谁驱动循环 |
| --- | --- | --- |
| CLI（产品） | `oh-my-mcode max "..."` | `src/orchestrator.ts` 调用 `mcode exec` |
| TUI（插件） | 「max mode: ...」 | `max` Skill，写入同一 run store |

状态不只活在 prompt 里：`<workspace>/.minimax/runs/<run_id>/`。

阶段：`INTAKE → DISCOVER → PLAN → PLAN_REVIEW → EXECUTE → VERIFY → (REPAIR)* → ACCEPT → RELEASE`。

VERIFY 先跑代码里的测试/构建。LLM 可以只读评判残余问题，但不能改文件，也不能作为唯一验收信号。没有证据文件就不能 Accepted。REPAIR 最多 3 轮，重复失败签名会停。

`scripts/run-store.mjs` 是无构建回退，给只使用 TUI 的用户。`OMM_MCODE` 可覆盖 `mcode` 二进制，供测试注入假宿主。
