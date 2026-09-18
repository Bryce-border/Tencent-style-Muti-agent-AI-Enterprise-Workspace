# Agent 记忆与工作台

日期：2026-09-18。依据《项目优化方案.md》优先推进统一工作入口、Memory、执行可视化和成果交付。SQLBot 已克隆至 `F:/project/fix/4/SQLBot`，按用户要求暂停接入，本阶段未添加其服务、依赖或问数功能。

## 参考与兼容决策

参考 `F:/project/fix/1/TencentDB-Agent-Memory` 的 L0 会话、L1 原子记忆分层思路，以及 Python SDK v3 的 team/agent/user 严格作用域与来源追溯设计。该项目为 MIT 许可。这里是基于其公开设计独立实现的 Java/MySQL 适配，没有复制上游源码，也没有引入 MemoryCore/Hub/Proxy 服务。

保留项目锁定的 CrewAI 0.86。官方本地 design-agent 技能强调明确专业分工与上下文控制；新版技能中的 Memory API 与当前版本不同，因此记忆由业务服务持有，通过执行上下文传入 Planner、Worker、Reviewer，不开启 CrewAI 默认记忆存储。Elasticsearch 继续承担知识 RAG；本阶段个人记忆使用 MySQL 最新记录，不宣称实现了向量召回或 TencentMemory 完整层次体系。

## 请求与执行链路

1. React 创建私人会话，Java 从登录身份确定空间和用户，客户端不能指定归属。
2. 提交一轮工作：锁定会话、检查未完成轮次及幂等键，在同一事务写入任务、会话关联和 Outbox。
3. Worker 领取租约，通过内部 `/context` API 获取最近成功轮次和当前员工的个人记忆。无有效租约不能读取。
4. Python 再次裁剪上下文：6 轮，每轮用户输入 1200 字符、回答 2000 字符；8 条长期记忆，每条最多 1000 字符。这是字符预算，不是精确 Token 预算。
5. 历史标注为不可信资料，保留来源任务 ID，当前用户要求优先。用户明确限定本次输入时不加载历史。
6. `memory.loaded` 只记录数量、字符数和作用域，不把原始记忆复制到任务事件或快照。模型可能在成果中引用历史，因此同一权限限制也覆盖任务、报告、事件、SSE、导出和操作接口。
7. 工作台持续读取任务和事件，显示可点击的记忆召回、规划、专业工作、审核、修订、人工处理及归档节点。

每个会话最多 200 轮；列表显示最近 100 个会话。长期记忆仅由用户确认保存，类型为 preference/fact/decision，精确内容与类型去重，同一员工最多 100 条。删除会停止后续召回，不改写已经生成的结果。任务正在执行时删除的记忆可能已进入该次模型上下文。

## 数据与接口

Flyway V4 增加 conversations、conversation_turns、agent_memories，以及 tasks.owner_user_id。旧任务 owner 为空，保留空间共享；会话任务 owner 为提交者，成员和管理员均不能经公共接口读取他人的私人任务内容。空间总览的任务数量仍是空间汇总指标。

| 接口 | 用途 |
| --- | --- |
| GET/POST `/v1/conversations` | 列表、新建私人会话 |
| GET `/v1/conversations/{id}` | 会话及有序轮次 |
| POST `/v1/conversations/{id}/turns` | 带 Idempotency-Key 提交一轮 |
| GET `/v1/memories?employee_id=...` | 当前用户指定员工的记忆 |
| POST `/v1/memories` | 保存确认后的内容，可绑定个人会话来源任务 |
| DELETE `/v1/memories/{id}` | 忘记一条记忆 |
| GET `/internal/tasks/{id}/context` | 服务令牌＋执行租约保护的上下文读取 |

前端从 App.tsx 提取 `features/assistant/AssistantWorkbench.tsx`，包含会话选择、ConversationView、Execution 和 MemoryPanel。复用已有 Workflow 与鉴权请求封装。未重写其他业务页面，也未改变 Electron 桌面入口。

## 验收与后续

- Java 18 项通过，新增同空间跨用户全链路隔离、幂等提交、串行轮次、租约保护、员工隔离、来源校验、删除停止召回、成功历史进入下一轮验证。
- Python 35 项通过，新增上下文预算、来源标识、仅本次输入排除历史、Worker/Reviewer 实际获得记忆而任务快照及事件不存储原始记忆验证。
- 流程图 11 项通过，新增记忆节点及重试不沿用上轮记忆事件验证。TypeScript 与 Vite 构建通过。
- 本机 Docker 已应用 V4 迁移和新页面。浏览器真实模型验收：会话 `C-afd9ac82-b59b-4ae0-adab-aaf4665a3b91` 的首轮 `T-6fd6bd7df8cf` 保存模拟项目“星舟／林舟／10月15日内测”；第二轮 `T-4c9ac615e960` 未重复背景，仍准确复述三项信息并完成审核归档。节点显示 `turn_count=1`、`memory_count=1`、`characters=491`。以上为测试账户的模拟数据，不代表真实业务事实或普遍模型准确率。

后续按优化方案推进：相关性召回与可编辑记忆、明确共享授权的 Workspace Memory、计划确认、分章节长文档与一致性审核、结构化 Artifact、质量与成本评估。自动提取记忆须先作为候选让用户确认，避免把模型推测写成用户事实。SQLBot 保持暂停，恢复时再核对许可证、数据源权限及只读执行边界。
