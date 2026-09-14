# AI Enterprise Workspace

## 当前入口：R2 企业基础

主入口：<http://localhost:8080>。已接入 Java 21、Spring Boot 3.5.16、Spring Cloud 2025.0.3、MySQL、Redis，以及登录/空间权限、成员管理、任务执行租约和故障恢复。React、网关、Java/Python 服务均可 Docker 部署。Vite 联调入口仍为 <http://localhost:5173>。

```powershell
./deploy/build-r2.ps1 -JdkHome 'D:/intellij/IntelliJ IDEA 2025.3.4/jbr'
docker compose --env-file deploy/.env.r2 -f deploy/docker-compose.yml -f deploy/docker-compose.r2.yml up -d --build
```

首次构建会生成独立的 `deploy/.env.r2`，已有 LLM 配置 `deploy/.env` 保留。默认管理员为 `admin`，随机密码见 `.env.r2` 的 `BOOTSTRAP_PASSWORD`；也可在页面注册新的独立空间。不要提交密钥或覆盖现有环境文件。

原有 30 条任务、274 条事件和 1 份报告已迁入 MySQL，原 SQLite 备份保留。完整范围、测试、迁移和回滚说明见 [R2 企业基础验收](docs/R2企业基础验收.md)；后续路线见 [重开发路线](docs/重开发路线.md)。下方 R1 启动与接口说明仅作为历史迁移参考；当前请使用上述两份 Compose 配置。

知识库已修复低相关性强制召回、重复/占位片段和候选误当引用问题，加入 5 份明确标注的模拟业务制度。修复范围、15 个真实检索场景和复验命令见 [知识库检索修复验收](docs/知识库检索修复验收.md)。

## 新开发入口（2026-09-14）

项目正在按《AI Enterprise Workspace 项目描述.md》重建。当前开发基线、14 周路线、模块边界与验收条件见 [重开发路线](docs/重开发路线.md)。下方原型说明保留作迁移参考；新运行时不再使用无密钥的固定模板成功路径，未接入的外部写操作也不能确认成成功。

新前端位于 `apps/workspace`，已实现 React / TypeScript / Vite / Tailwind Workspace；新执行入口为 `app/execution.py`。文本员工使用实际 CrewAI 调用，成果审核后进入报告归档。Java 企业业务层、文件管理、会议联动、数据计算与权限仍按路线开发。

完整 Docker 部署（需能够访问 Docker Hub）：

```powershell
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
```

新 Workspace：<http://localhost:8080>；运行时 API：<http://localhost:8000>。已有 `.env` 不要用示例覆盖。

本地前端联调（后端使用 Docker）：

```powershell
cd apps/workspace
npm ci
npm run dev
```

开发入口：<http://localhost:5173>，Vite 将 `/v1` 和 `/health` 代理到后端。`npm run build` 执行 TypeScript 与生产构建。

后端验证：在 `services/agent-runtime` 执行 `py -3 -m unittest discover -s tests -v`。测试使用项目内独立临时数据库，不覆盖现有数据卷。

新增接口：`GET /v1/messages`、`GET /v1/reports`、`GET /v1/reports/{task_id}`；创建任务可传 `employee_id`。报告只归档新运行时通过审核或人工接受的真实成果，历史模板记录仍可从任务中心查看。

## 历史原型说明

当前仓库包含可运行的第一版。它提供内置 Web 工作台、健康检查、任务提交、持久化任务状态、事件流、Supervisor 计划生成、结构化任务结果 API 和 Elasticsearch 知识库接口。未配置模型密钥时使用 deterministic 模式，便于本地联调；配置 LLM 后进入 CrewAI 适配路径。

当前工作台已增加基础 Workspace 导航、Dashboard 汇总和预置 AI 员工目录。Dashboard 可查看任务总数、执行中任务、待确认任务和知识库文档数；AI 员工目录包含 AI 管家、数据分析师、文档专家、会议秘书、HR 助手、CRM 助手、企业知识专家、产品设计师和 AI 开发工程师。

## 启动

```powershell
Copy-Item deploy/.env.example deploy/.env
# 编辑 deploy/.env，填写 LLM_API_KEY 和 LLM_MODEL
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up --build
```

打开 <http://localhost:8000> 即可使用工作台。

## API 示例

```powershell
Invoke-RestMethod http://localhost:8000/health
Invoke-RestMethod -Method Post http://localhost:8000/v1/tasks -ContentType 'application/json' -Body '{"prompt":"整理本周项目进展并生成周报","workspace_id":"default"}'
```

Workspace 汇总和预置员工接口：

```powershell
Invoke-RestMethod 'http://localhost:8000/v1/dashboard?workspace_id=default'
Invoke-RestMethod http://localhost:8000/v1/employees
```

任务当前使用 SQLite 持久化，数据保存在 Compose 的 `runtime_data` 命名卷中。API 将任务发布到 RabbitMQ，由 `agent-worker` 消费后执行；任务会先进入 `RUNNING`，完成后写入 `SUCCESS` 或 `FAILED`，失败最多自动重试 2 次。可通过 `/v1/tasks/{task_id}/cancel` 取消尚未完成的任务。

完成任务可通过 `GET /v1/tasks/{task_id}/export` 下载 Markdown 结果；工作台中的“导出 Markdown”按钮会调用该接口。

## 模型配置

部署使用阿里云百炼 OpenAI 兼容接口。当前业务空间已确认可调用 `qwen3.7-flash`、`kimi-k3`、`qwen3.8-27b`，默认配置为 `qwen3.7-flash`；向量模型为 `qwen3.7-text-embedding-flash`，维度 1024。真实密钥只放在本地 `deploy/.env`，不要提交到 Git 或写入镜像。

```dotenv
LLM_BASE_URL=https://ws-fhr1u2m9mysymhf3.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
LLM_MODEL=qwen3.7-flash
EMBEDDING_MODEL=qwen3.7-text-embedding-flash
EMBEDDING_DIM=1024
```

## 知识库接口

```powershell
Invoke-RestMethod -Method Post http://localhost:8000/v1/knowledge/documents -ContentType 'application/json' -Body '{"workspace_id":"default","document_id":"doc-1","title":"报销制度","content":"差旅报销需在30天内提交。"}'
Invoke-RestMethod 'http://localhost:8000/v1/knowledge/search?workspace_id=default&q=报销'
```

涉及发送、删除或 CRM 写入的任务会进入 `PENDING_CONFIRMATION`；确认接口：

```powershell
Invoke-RestMethod -Method Post http://localhost:8000/v1/tasks/{task_id}/confirm
```

## 验证

```powershell
Invoke-RestMethod http://localhost:8000/health
docker compose -f deploy/docker-compose.yml ps
```
