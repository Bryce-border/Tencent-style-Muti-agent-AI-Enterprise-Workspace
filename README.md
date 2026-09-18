# AI Enterprise Workspace

基于 CrewAI 的企业多智能体工作空间，采用 React + Java 21 + Python 双服务架构，提供会话规划、智能体协作、知识检索与成果交付。当前 GUI 基线为 [GUI 设计要求](开发文档/AI_Enterprise_Workspace_GUI_设计要求.md) 和 [界面参考图](开发文档/front.png)。

当前已完成会话式 GUI、预计输出与批准执行、模型/API 配置、桌面入口、动态协作流程图、个人会话记忆，以及分章文档生成、共享事实、定向修订和检查点续作。产品优化参照 [项目优化方案](开发文档/项目优化方案.md)，记忆设计见 [Agent 记忆与工作台](开发文档/Agent记忆与工作台.md)。SQLBot 已拉取为参考，按当前要求暂停接入；真实数据计算、OCR 与外部 MCP 写入仍属后续能力。

## AI 工作台与记忆

登录后默认进入 **会话**。左侧保留会话、知识库、记忆和设置四个入口，主页面无需选择员工或模型。桌面宽屏可展开右侧任务详情，手机宽度下详情占满页面。

1. 在首页输入目标并发送（支持 `Ctrl + Enter`），系统新建私人会话并生成 **预计输出**。
2. 检查目录、目标篇幅、格式与风格。点击 **修改输出** 可编辑标题、章节和额外要求，保存后再点击 **确认执行**；也可以在输入框用自然语言调整方案。
3. 批准前不创建执行任务。生成失败时保留输入，检查 **设置 → 模型与 API** 后重试。
4. 执行进度直接显示在会话中。点击 **查看执行详情** 展开节点状态和协作流程图，点击节点查看具体内容。
5. 成果回到当前会话，可打开侧面板或下载 Markdown；审核要求人工确认时先检查成果，再接受交付或停止任务。
6. 完成后继续输入补充要求，下一轮重新生成预计输出；左侧支持搜索、改名入口在会话标题旁，归档会话可从归档列表恢复。

当前交付格式为 Markdown，支持整体生成和逐章生成；自动批准、PDF/Word 导出尚未实现。预计篇幅是目标，受模型输出上限影响。

### 多章节文档

在预计输出的 **修改输出 → 生成方式** 选择 **逐章生成**，调整目录后确认执行。长文目标也会由规划器建议该模式。

- 按批准目录生成 1–10 章，先提取共享事实、术语、约束和待确认事项；后章读取前章摘要。
- 审核读取全部章节正文，最多进行一轮定向修订（最多 3 章）后复核。需要更多修改或审核故障时保留正文并转人工确认，不自动声称通过。
- 全文按目录直接组装，成果面板可展开各章及共享文档记忆，下载完整 Markdown。
- 章节生成失败时保留草稿；在当前批准任务点击 **重试并复用已完成章节**。只复用同一任务且目录、有效上下文、检索证据及模型配置一致的检查点。已修改方案、已归档或非失败任务不支持此操作。
- 执行详情展示章节、定向修订、复核和组装节点；可点击查看内容。统计本轮 Agent 调用、耗时与模型回报的 Token，不包含规划预览和历史轮次，不估算费用。
- 分章任务默认总时限 1200 秒（`MAX_DOCUMENT_SECONDS`），每次调用等待上限 100 秒；建议每章 300–800 字。停止后不再调度下一章，已发出的模型请求可能仍在供应商侧结束或计费。

实现与验收记录见 [分章文档流水线](开发文档/分章文档流水线.md)。

### 会话与记忆

- 可以连续提出修改要求，每轮仍是独立任务，保留审核、人工确认、取消和 Markdown 导出入口。
- 最近 6 轮成功任务参与续问；失败、取消、待确认的结果不作为已完成历史。同一会话一次执行一轮，待确认任务须先接受或取消。
- 在 **记忆** 保存偏好、用户确认的事实或决策，支持编辑、启用/禁用、去重、来源任务追溯和忘记。每位用户的每个员工最多 100 条，执行时取最新 8 条；尚未做语义召回、自动提取、TTL 或重要度排序。
- 会话、记忆及其任务／事件／报告按空间和用户隔离；指定员工的记忆不自动传给其他会话员工。总智能体会把本次授权上下文交给本任务内的工作节点。
- 记忆删除后不参与后续召回；已经读取它的运行任务与已生成成果不会被追溯删除。用户明确限定仅使用本次资料时会跳过历史上下文。
- 旧的普通任务仍保持空间共享。模型由所在空间配置，历史和记忆在任务执行时也会发送到该模型供应商；不要在记忆中存 API 密钥。

数据库升级由 Flyway 自动应用 V4 会话记忆及 V5 GUI 迁移，增加输出方案、版本、批准任务、归档和记忆启用状态。已有本机环境更新需先按下文构建前端和 Java，再执行 `docker compose ... up -d --build`；只刷新网页不会更新容器内代码。

## 快速启动：本机已有部署

先打开 **Docker Desktop**，等待引擎运行，再任选一种方式启动。

### 桌面应用

双击桌面的 **Enterprise Workspace** 快捷方式，或在 PowerShell 中执行：

```powershell
Set-Location 'F:\project\Tencent-style Muti-agent AI Enterprise Workspace'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File '.\启动工作空间.ps1'
```

脚本会启动现有 Docker 服务、等待接口就绪，再打开独立窗口。日志位于 `.tools/desktop-startup.log`；后端未就绪时，窗口显示重新连接提示。

桌面程序位于 `apps/desktop/dist/EnterpriseWorkspace-win32-x64/EnterpriseWorkspace.exe`，需保留整个程序目录。它连接本机 `http://localhost:8080`，仍需要 Docker 后端。关闭窗口不会停止后端服务。

### 浏览器

在项目根目录执行：

```powershell
docker compose --env-file deploy/.env.r2 -f deploy/docker-compose.yml -f deploy/docker-compose.r2.yml up -d
```

打开 [工作空间](http://localhost:8080)。此方式适用于已有配置和构建产物的环境；首次拉取项目请先完成下一节。

### 登录

默认管理员用户名为 `admin`，初始化密码见本地 `deploy/.env.r2` 中的 `BOOTSTRAP_PASSWORD`。若初始化前设置了 `BOOTSTRAP_USER`，则使用相应用户名。页面也支持注册账户并创建独立工作空间。

已有数据库中的账户密码不会因编辑初始化环境变量而自动重置。

## 首次构建与部署

### 环境要求

| 工具 | 要求 |
| --- | --- |
| Docker Desktop | Linux 容器模式，Compose v2.24.4+（配置使用 `!override`） |
| PowerShell | 首次构建、环境初始化使用 PowerShell 7.2+；日常桌面启动可用 Windows PowerShell |
| Java / Maven | JDK 21、Maven 3.6.3+，终端可调用 `mvn` |
| Node.js / npm | 推荐 Node.js 24 LTS；桌面打包至少需要 Node.js 22.12 |
| Python | Docker 已包含 Python 3.12 和 CrewAI 0.86.0，启动无需宿主机安装 Python |

首次构建需要下载 Maven/npm 依赖和 Docker 镜像。先启动 Docker Desktop，在 **PowerShell 7** 中切换到项目根目录。

### 1. 准备配置

```powershell
Set-Location 'F:\project\Tencent-style Muti-agent AI Enterprise Workspace'

# 仅在配置不存在时复制，保留已有 API 配置。
if (!(Test-Path 'deploy/.env')) {
    Copy-Item 'deploy/.env.example' 'deploy/.env'
}
./deploy/init-r2-env.ps1
```

编辑 `deploy/.env`，填写 `LLM_BASE_URL`、`LLM_API_KEY` 和 `LLM_MODEL`。Elasticsearch、RabbitMQ 等容器地址可沿用示例。未配置可用模型时，AI 任务会明确失败。

初始化脚本生成 `deploy/.env.r2`，包含数据库、会话、内部服务、MinIO、模型加密和管理员初始化凭据。已有文件会保留。两份环境文件均留在本地，不提交真实密钥。

### 2. 构建前端和 Java 服务

如果 `JAVA_HOME` 已指向 JDK 21：

```powershell
./deploy/build-r2.ps1 -JdkHome $env:JAVA_HOME
```

本机已有 JDK 的路径示例：

```powershell
./deploy/build-r2.ps1 -JdkHome 'D:/intellij/IntelliJ IDEA 2025.3.4/jbr'
```

其他机器请替换为自己的 JDK 21 目录。脚本在当前进程中选择 JDK，结束后恢复环境；Maven/npm 缓存放在项目 `.tools` 下。

**此步骤不可省略：**当前 Dockerfile 会复制 `services/java/*/target` 中的 JAR 和 `apps/workspace/dist`，因此首次部署必须先生成这些产物。

### 3. 构建镜像并启动

```powershell
docker compose --env-file deploy/.env.r2 -f deploy/docker-compose.yml -f deploy/docker-compose.r2.yml up -d --build
```

首次初始化可能需要数分钟。检查服务状态与接口：

```powershell
docker compose --env-file deploy/.env.r2 -f deploy/docker-compose.yml -f deploy/docker-compose.r2.yml ps
Invoke-RestMethod 'http://localhost:8080/health'
```

打开 [http://localhost:8080](http://localhost:8080) 登录。首次打包桌面程序见后文。

## 模型与 API 配置

管理员进入 **设置 → 模型与 API**，可修改模型、HTTPS API 地址、密钥、温度及输出上限，并测试连接、保存或恢复部署默认。

- 已确认可调用 `qwen3.7-flash`、`kimi-k3`、`qwen3.8-27b`，实际可用性取决于供应商账户。
- 空间密钥在 MySQL 中加密保存，页面不回显。空密钥可保留已有配置，更换地址需要重新提供密钥。
- API 地址受服务端 `MODEL_API_ALLOWED_HOSTS` 白名单限制；需要新增域名时，在 `deploy/.env.r2` 设置白名单并应用新配置。
- Kimi K3 不传温度参数，界面会禁用温度输入。
- Embedding 独立使用部署配置，当前为 `qwen3.7-text-embedding-flash`、1024 维；更改维度需重建索引。

修改部署环境文件后，在项目根目录执行以下命令应用新环境变量：

```powershell
docker compose --env-file deploy/.env.r2 -f deploy/docker-compose.yml -f deploy/docker-compose.r2.yml up -d agent-runtime agent-worker workspace-service
```

保留 `.env.r2` 中的 `WORKSPACE_CONFIG_KEY`，已有空间密钥需要用同一加密主密钥解密。

## 前端开发与代码更新

先启动 Docker 后端，然后从项目根目录运行：

```powershell
Set-Location apps/workspace
npm ci --cache ../../.tools/npm-cache
npm run dev
```

打开 [http://localhost:5173](http://localhost:5173)。Vite 将 `/auth`、`/v1` 和 `/health` 代理到 `127.0.0.1:8090` 的网关，前端修改可热更新。桌面客户端使用 8080 生产入口，不直接连接 Vite。

更新 Docker 中的前端页面，回到项目根目录执行：

```powershell
Push-Location apps/workspace
npm run build
Pop-Location
docker compose --env-file deploy/.env.r2 -f deploy/docker-compose.yml -f deploy/docker-compose.r2.yml up -d --no-deps --build workspace
```

Java 修改后重新运行 `deploy/build-r2.ps1`，再执行完整的 `up -d --build`。仅修改 Python 运行时代码时：

```powershell
docker compose --env-file deploy/.env.r2 -f deploy/docker-compose.yml -f deploy/docker-compose.r2.yml up -d --no-deps --build agent-runtime agent-worker
```

## 桌面客户端打包（可选）

更新 `images/application icon.png` 后，先运行 `./deploy/sync-icons.ps1` 同步网页图标和 Windows 多分辨率图标，再构建前端、更新容器并重新打包桌面程序。图标同步脚本适用于 Windows。

本机已有客户端可直接使用；新机器需在 Node.js 22.12+ 环境下打包。以下命令从项目根目录执行：

```powershell
New-Item -ItemType Directory -Force '.tools/electron-cache' | Out-Null
curl.exe -f -L --retry 1 -o '.tools/electron-cache/electron-v44.3.0-win32-x64.zip' 'https://github.com/electron/electron/releases/download/v44.3.0/electron-v44.3.0-win32-x64.zip'

Push-Location apps/desktop
npm ci --cache ../../.tools/npm-cache
npm run package
Pop-Location
```

已有完整压缩包时可跳过下载。打包脚本校验官方 SHA-256，缓存、临时文件与产物均放在项目内。重打包前关闭桌面程序；脚本会将产物目录中的 `profile` 备份到项目 `.tools/desktop-profile-*`，打包成功后恢复桌面会话。备份保留在本机，包含会话信息，不要提交或分享。

产物为 `apps/desktop/dist/EnterpriseWorkspace-win32-x64/EnterpriseWorkspace.exe`。之后运行根目录 `启动工作空间.ps1` 即可打开。本机快捷方式已创建，新机器打包不会自动创建快捷方式。当前是未签名的 Windows x64 便携客户端，尚无安装器与自动升级。

## 日常管理与排错

以下命令均从项目根目录执行：

```powershell
# 查看服务状态。
docker compose --env-file deploy/.env.r2 -f deploy/docker-compose.yml -f deploy/docker-compose.r2.yml ps

# 查看近期业务日志；Ctrl+C 退出日志跟踪。
docker compose --env-file deploy/.env.r2 -f deploy/docker-compose.yml -f deploy/docker-compose.r2.yml logs --tail=100 -f workspace-service agent-runtime agent-worker

# 停止服务，保留容器和数据。
docker compose --env-file deploy/.env.r2 -f deploy/docker-compose.yml -f deploy/docker-compose.r2.yml stop
```

再次执行快速启动命令即可恢复。数据库、原文件和检索索引保存在 Docker 命名卷；需要保留数据时不要使用 `down -v`。Docker 实际存储位置由 Docker Desktop 设置决定。

| 现象 | 处理方式 |
| --- | --- |
| 无法连接 Docker 引擎 | 打开 Docker Desktop，确认 `docker info` 正常，并使用 Linux 容器模式 |
| Compose 无法识别 `!override` | 更新 Compose 至 v2.24.4+ |
| 构建提示找不到 JAR 或 `dist` | 先运行 `deploy/build-r2.ps1`，检查构建是否成功 |
| 初始化提示 `ToHexString` 不存在 | 用 PowerShell 7.2+ 运行初始化和构建脚本 |
| 桌面提示服务未启动 | 查看 Docker 状态和 `.tools/desktop-startup.log`，服务就绪后点击重新连接 |
| 8080 暂时返回 502 | Java 或网关可能仍在启动；检查 `ps` 和服务日志 |
| 端口被占用 | 停止占用端口的其他服务；桌面固定使用 8080，Vite 代理固定使用 8090 |
| 页面修改未在桌面生效 | 构建前端、更新 workspace 容器，再关闭并重新打开桌面窗口 |
| 任务停在规划或执行节点 | 点击节点查看耗时与事件，检查模型连接及 Worker 日志；可取消任务 |
| 任务待人工处理 | 检查审核意见和成果，再决定接受或取消；审核超时不会自动归档 |
| 局部重建后入口 500，但 Java 服务健康 | 旧连接或容器 DNS 缓存可能仍指向旧地址；使用同一组 Compose 文件执行 `restart gateway agent-runtime agent-worker`，等待服务就绪再刷新 |
| 文档处理失败 | 点击文档查看错误并重试；单文件限 5 MB，扫描 PDF 需要尚未接入的 OCR |

## 服务入口

| 服务 | 本机地址 | 用途 |
| --- | --- | --- |
| Workspace | [localhost:8080](http://localhost:8080) | 页面和桌面客户端入口 |
| Vite | [localhost:5173](http://localhost:5173) | 手动启动的前端开发服务器 |
| Gateway | `127.0.0.1:8090` | Java 网关，Vite 代理目标 |
| Workspace Service | `127.0.0.1:8081` | Java 业务服务 |
| Agent Runtime | `127.0.0.1:8000` | Python 内部执行、知识与文档服务，需内部认证 |
| Elasticsearch | `127.0.0.1:9200` | 知识索引与向量检索 |
| MySQL / Redis | `127.0.0.1:3307` / `127.0.0.1:6380` | 业务数据与会话 |
| RabbitMQ 控制台 | [localhost:15672](http://localhost:15672) | 消息队列管理 |
| MinIO 控制台 | [localhost:9001](http://localhost:9001) | 原文件管理，凭据见 `.env.r2` 的 MinIO 配置 |

当前 Compose 用于本机开发。业务请求通过登录会话确定工作空间，8000 端口不是用户工作台入口。

## 已实现功能与技术栈

- React / TypeScript / Vite 会话工作空间、蓝白 GUI 与 Electron 桌面入口。
- Java 21 / Spring Boot 3.5.16 / Spring Cloud 2025.0.3，登录、空间隔离、ADMIN/MEMBER/VIEWER、成员管理及审计。
- Python 3.12 / CrewAI 0.86.0，Supervisor 规划、依赖执行、最多两个并行 Worker、汇总、审核修订和人工确认。
- 动态流程图：中文节点名称、依赖连线、实时状态、输入输出、异常、耗时、缩放展开与重试轮次回看。
- MySQL 业务持久化、Redis 会话、RabbitMQ 事务 Outbox、执行租约与恢复。
- MinIO 文档原件、六种格式文本解析、版本预览/下载、失败重试、归档恢复；Elasticsearch 检索与来源追溯。
- 空间模型/API 配置、密钥加密、真实成果归档与 Markdown 导出。

模型审核仍可能漏检字数或内容问题；历史任务缺失的流程事件会标注未记录。流程图用于观察执行，不支持拖拽修改计划或重放单节点。

## 验证与开发资料

前端验证，从项目根目录执行：

```powershell
Push-Location apps/workspace
npm run test:workflow
npm run build
Pop-Location
```

后端验证使用已启动的容器：

```powershell
docker compose --env-file deploy/.env.r2 -f deploy/docker-compose.yml -f deploy/docker-compose.r2.yml cp services/agent-runtime/tests/. agent-runtime:/app/tests
docker compose --env-file deploy/.env.r2 -f deploy/docker-compose.yml -f deploy/docker-compose.r2.yml exec -T agent-runtime python -m unittest discover -s tests -v
```

Java 测试包含在 `build-r2.ps1` 的 Maven 构建中。2026-09-18 GUI 阶段回归：Java 21 项、Python 39 项、前端流程图 11 项通过，TypeScript/Vite 构建通过；详细场景和限制见以下文档。

- [GUI 重构验收与功能边界](开发文档/GUI重构验收.md)
- [R2 企业基础：认证、迁移与故障恢复](docs/R2企业基础验收.md)
- [R3 文档、模型与桌面验收](docs/R3文档与模型验收.md)
- [动态协作流程图验收](docs/动态协作流程图验收.md)
- [知识库检索修复验收](docs/知识库检索修复验收.md)

旧 SQLite 原型与迁移备份仅供历史对照。当前启动统一使用 `.env.r2` 和两份 Compose 配置。
