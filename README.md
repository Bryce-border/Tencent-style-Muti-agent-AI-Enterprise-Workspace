# Tencent-style AI Enterprise Workspace

面向企业员工的多智能体智能工作台：用户只提出目标，Supervisor 自动组织 AI 员工完成工作。

## v1 已完成

- 工作台 Dashboard：任务概览、AI 团队状态、协作趋势；
- Supervisor-Worker 演示运行时：动态任务分类、计划生成、并行 Agent、结果聚合；
- Writer → Reviewer 反馈闭环：首次审核发现证据不足时自动补充并复审；
- 结构化 `AgentResult` 交付卡片：摘要、关键结论、指标和可信度；
- AI 团队、任务中心、知识库、文档、数据分析、会议和通讯助手页面骨架；
- 模型与连接设置：无需命令行即可切换第三方 OpenAI-compatible 的 Base URL、API Key、Model Name；
- 可选本地 API 代理：API Key 服务端保存和脱敏返回，支持 `/api/chat` 与连接测试。

## 快速开始

需要 Node.js 20+。

```powershell
npm install
npm run dev
```

打开终端提示的地址即可体验本地确定性演示，不填写任何模型密钥也可以运行。

如果需要在 UI 中测试并代理真实模型请求，再启动 API：

```powershell
python server/main.py
```

然后在右上角设置中填写：

```text
Base URL:   https://api.openai.com/v1
Model Name: gpt-4o-mini
API Key:    你的密钥
```

也可以使用任何兼容 `/chat/completions` 的自建网关或第三方模型服务。密钥配置会写入被 Git 忽略的 `server/.data/`，不会提交到仓库。

## 生产化路线

当前 v1 使用浏览器内的确定性 Supervisor 运行时保证开箱即用，API 代理已经将 provider 配置和真实模型调用边界固定下来。下一步可以把任务状态迁移到 MySQL/Redis，把 Agent Worker 接到 RabbitMQ，并把知识检索、微信/企业微信适配器接入同一套 `AgentResult` 契约。

## 构建检查

```powershell
npm run build
```
