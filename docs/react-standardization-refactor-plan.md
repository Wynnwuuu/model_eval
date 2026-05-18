# Eval Studio 标准化重构规划

## 1. 背景与目标

当前项目已经具备评测项目管理、评测集仓库、Rubric 模板、评测任务、评测执行、结果洞察、批量生产等核心能力，但工程形态仍偏 Demo / 原型：

- 页面路由由 `ModelEvalApp` 内部 `currentRoute` 状态驱动，URL 无法表达具体页面、项目、数据集、任务。
- 组件直接访问 `datastore.ts` 暴露的 legacy document store 风格 API，数据请求、权限、缓存、错误处理分散在页面组件中。
- 开发环境依赖 `localStorage`，线上依赖 PostgreSQL API；协作能力可用，但与标准企业级关系型数据、审计、备份、权限治理存在距离。
- 多个业务实体已经成型，但缺少稳定的后端 API、数据库迁移、领域分层、测试体系和持续迭代流程。

本次重构目标：

1. 将项目改造成标准 React 项目：每个核心页面拥有可直接访问、可分享、可回放的 URL 路由。
2. 将业务模块拆分为稳定边界：项目、数据集、模板、任务、执行、洞察、生产分别拥有独立页面、数据服务和类型模型。
3. 将线上数据层从 PostgreSQL API 迁移到更标准的后端 API + 关系型数据库方案。阿里云 DMS 建议作为数据库治理、权限审批、SQL 审核和变更管理平台；真实业务数据库建议使用阿里云 RDS MySQL 或 PostgreSQL。
4. 建立可持续迭代的工程化体系：目录规范、API 契约、数据库迁移、权限模型、测试、CI/CD、观测、发布治理。

## 2. 现状判断

### 2.1 当前技术栈

| 层级 | 当前实现 | 问题 |
| --- | --- | --- |
| 前端框架 | Vite + React 19 + TypeScript + Tailwind CSS | 基础可用，但页面/业务/数据层混在组件内 |
| 路由 | `ModelEvalApp` 内部状态 `currentRoute` | URL 不可分享，刷新丢页面上下文，深链能力弱 |
| 数据访问 | `src/datastore.ts` 在 local platform 与 `localPlatform` 间切换 | UI 依赖 legacy document store 调用形态，未来迁移成本高 |
| 本地数据 | `localStorage` | 适合单机调试，不适合多人协作和长期数据管理 |
| 线上数据 | PostgreSQL API | 已支持基础协作，但不利于关系型查询、审计、SQL 治理 |
| 部署 | static hosting + GitHub Actions | 静态前端部署可保留或替换，后端需要新增部署链路 |

### 2.2 当前主要业务实体

| 实体 | 当前集合/位置 | 说明 |
| --- | --- | --- |
| 用户 | `users` | 本地模式内置 `local-user`；线上来自 cloud auth |
| 项目 | `projects` | 包含项目目标、优先级、协作人、步骤、结果摘要 |
| 评测集 | `evalDatasets` | 包含 schema、items、版本信息、验证摘要 |
| Rubric 模板 | `evalTemplates` | 包含范式、维度、打分配置 |
| 评测任务 | `evalTasks` | 绑定项目、数据集、模板、模型、执行状态 |
| 任务样本 | `evalTasks/{taskId}/items` | 任务执行时的 case 快照 |
| 用户投票 | `evalTasks/{taskId}/userVotes/{userName}` | 按用户保存 votes 数组 |
| 生产任务 | `evalGenerationJobs` | 数据集批量生产状态与结果 |

### 2.3 核心问题

| 问题 | 影响 | 重构方向 |
| --- | --- | --- |
| URL 不表达业务对象 | 无法直接分享某个项目/数据集/任务/洞察页面 | 引入 React Router，使用参数路由 |
| 组件直接访问数据库 | 后端迁移会触发大量 UI 改动 | 建立 API Client + Repository/Service 层 |
| legacy document store 文档模型不适合复杂分析 | 跨项目、跨任务、跨维度统计成本高 | 使用关系型表 + JSON 字段组合 |
| 投票以数组存在一个用户文档中 | 难以做增量、审计、并发、按 case 统计 | 拆成 `evaluation_votes` 行级记录 |
| 权限逻辑分散在前端和 backend permission rules | 迁移后需要后端统一鉴权 | 引入组织、成员、角色、资源权限 |
| 缺少迁移与版本管理 | 数据结构变动风险高 | 引入 SQL migration 与 seed 数据 |
| 缺少测试分层 | 迭代容易回归 | 建立单测、组件测试、E2E、契约测试 |

## 3. 目标架构

### 3.1 推荐架构

```text
Browser
  |
  | React Router + API Client
  v
Frontend App: Vite / React / TypeScript
  |
  | HTTPS JSON API
  v
Backend API: Node.js / Fastify or NestJS
  |
  | ORM / SQL migrations
  v
Alibaba Cloud RDS: PostgreSQL or MySQL
  |
  | governance / approval / SQL audit / permission
  v
Alibaba Cloud DMS
```

补充服务：

| 能力 | 建议 |
| --- | --- |
| 媒体文件 | 使用 OSS 存储视频、图片、音频，数据库只存 URL、metadata、checksum |
| 登录认证 | 优先保留 Google 登录能力时，可接入 OIDC/JWT；国内团队也可换企业 SSO |
| 后端部署 | 阿里云 ECS、ACK、函数计算或容器服务均可；早期建议 ECS/容器单服务 |
| 定时任务 | 生产任务轮询、过期会话清理、汇总指标计算可放后端 worker |
| 数据分析 | 先用 RDS 查询支撑；数据量变大后再同步到 Hologres/MaxCompute |

### 3.2 DMS 的准确定位

DMS 不是业务运行时数据库。建议定位为：

- 数据库实例接入、账号权限、SQL 窗口、变更审批。
- 表结构变更、数据订正、审计留痕。
- 生产库查询权限控制、敏感字段脱敏。
- 数据库备份、跨库查询、数据资产治理的管理入口。

业务应用不应从浏览器直接连接 DMS 或 RDS。前端只调用后端 API，后端通过安全网络访问 RDS。

## 4. 前端标准化方案

### 4.1 目录结构

建议从“按技术类型堆组件”调整为“按业务模块组织”，保留共享 UI 和基础设施层。

```text
src/
  app/
    App.tsx
    router.tsx
    providers.tsx
    layouts/
      AppLayout.tsx
      FocusLayout.tsx
      AuthLayout.tsx
  pages/
    overview/
      OverviewPage.tsx
    projects/
      ProjectListPage.tsx
      ProjectDetailPage.tsx
      ProjectSettingsPage.tsx
    datasets/
      DatasetListPage.tsx
      DatasetDetailPage.tsx
      DatasetVersionPage.tsx
      DatasetGenerationPage.tsx
    templates/
      TemplateListPage.tsx
      TemplateDetailPage.tsx
    tasks/
      TaskListPage.tsx
      TaskCreatePage.tsx
      TaskDetailPage.tsx
    evaluation/
      EvaluationEntryPage.tsx
      EvaluationRunPage.tsx
      EvaluationResultPage.tsx
    insights/
      InsightDashboardPage.tsx
      TaskInsightPage.tsx
    history/
      HistoryPage.tsx
  features/
    projects/
      api.ts
      hooks.ts
      types.ts
      components/
    datasets/
    templates/
    tasks/
    evaluation/
    insights/
    generation/
  shared/
    api/
      httpClient.ts
      errors.ts
    auth/
      AuthProvider.tsx
      permissions.ts
    ui/
    utils/
    constants/
```

迁移原则：

- `pages` 只负责路由级编排，不放复杂业务计算。
- `features/*/api.ts` 封装后端 API，不直接暴露数据库实现。
- `features/*/hooks.ts` 封装 React Query 数据获取、缓存、刷新、乐观更新。
- `shared/ui` 放真正通用的按钮、弹窗、表格、空状态，不放业务语义。
- 现有大组件先迁移入口，不强行一次性拆完；每个迭代只拆一条业务链路。

### 4.2 路由设计

引入 `react-router-dom`，使用嵌套路由和参数路由。

| 页面 | 推荐 URL | 说明 |
| --- | --- | --- |
| 运营总览 | `/` | 平台级指标 |
| 项目列表 | `/projects` | 全部项目、筛选、创建入口 |
| 项目详情 | `/projects/:projectId` | 项目概览、步骤、关联任务 |
| 项目任务 | `/projects/:projectId/tasks` | 当前项目下任务列表 |
| 项目洞察 | `/projects/:projectId/insights` | 当前项目结果汇总 |
| 数据集列表 | `/datasets` | 数据集仓库 |
| 数据集详情 | `/datasets/:datasetId` | schema、样本、版本、验证 |
| 数据集版本 | `/datasets/:datasetId/versions/:versionId` | 固定版本快照 |
| 数据集生产 | `/datasets/:datasetId/generation` | 批量生产与回填 |
| 模板列表 | `/templates` | Rubric 库 |
| 模板详情 | `/templates/:templateId` | Rubric 配置 |
| 任务列表 | `/tasks` | 跨项目任务物料 |
| 新建任务 | `/tasks/new?projectId=xxx` | 从项目或全局创建 |
| 任务详情 | `/tasks/:taskId` | 任务配置、样本、分配、状态 |
| 参与评测 | `/tasks/:taskId/evaluate` | 执行入口，支持断点续评 |
| 单次结果 | `/tasks/:taskId/results` | 当前任务结果 |
| 洞察总览 | `/insights` | 跨任务洞察 |
| 历史 | `/history` | 本人参与/导入历史 |

兼容策略：

- 第一阶段保留旧 `currentRoute` 内部导航，但新增 URL 路由壳。
- 第二阶段每个旧 route 对应一个 page，并把 `navigate('projects')` 改成 `navigate('/projects')`。
- 第三阶段把 `routeContext` 替换成 URL params 和 search params。

### 4.3 前端状态与数据请求

建议引入：

| 能力 | 建议选型 | 用法 |
| --- | --- | --- |
| 路由 | `react-router-dom` | URL 深链、嵌套路由、loader 可选 |
| 服务端状态 | `@tanstack/react-query` | 项目、数据集、任务、投票、洞察请求 |
| 本地 UI 状态 | React state 或 Zustand | 侧栏、筛选器、弹窗、评测执行临时状态 |
| 表格 | 已有 `@tanstack/react-table` | 数据集样本、任务样本、洞察明细 |
| 表单 | 可引入 `react-hook-form` + `zod` | 创建项目、任务、模板、数据集导入 |

需要明确的边界：

- 业务主数据从 `localStorage` 移出。
- `localStorage` 只保留 UI 偏好、未提交草稿、评测执行断点缓存。
- 断点缓存也要定期同步到后端，避免换设备丢失。

### 4.4 数据访问层重构

当前 `datastore.ts` 模拟 legacy document store API。迁移后应拆成：

```text
shared/api/httpClient.ts
features/projects/api.ts
features/datasets/api.ts
features/templates/api.ts
features/tasks/api.ts
features/evaluation/api.ts
features/insights/api.ts
```

示例接口：

```ts
export async function listProjects(params: ProjectQuery): Promise<ProjectListResponse>;
export async function getProject(projectId: string): Promise<Project>;
export async function createProject(input: CreateProjectInput): Promise<Project>;
export async function updateProject(projectId: string, input: UpdateProjectInput): Promise<Project>;
export async function deleteProject(projectId: string): Promise<void>;
```

React 页面只调用 hook：

```ts
const { data, isLoading, error } = useProject(projectId);
const createProject = useCreateProject();
```

这样后端从 local platform 换成 RDS 时，页面不需要知道数据库变化。

## 5. 后端与数据库方案

### 5.1 后端服务边界

新增 `server/` 或独立仓库均可。当前阶段建议先放同仓库，便于前后端契约同步。

```text
server/
  src/
    main.ts
    app.ts
    config/
    auth/
    modules/
      projects/
      datasets/
      templates/
      tasks/
      evaluation/
      insights/
      generation/
    db/
      client.ts
      migrations/
      seeds/
    common/
      errors.ts
      pagination.ts
      audit.ts
```

推荐技术：

| 层级 | 建议 |
| --- | --- |
| API 框架 | Fastify 或 NestJS。若团队偏标准分层和依赖注入，选 NestJS；若希望轻量快速，选 Fastify |
| ORM/SQL | Prisma 或 Drizzle。若重视迁移和类型生成，选 Prisma；若希望 SQL 可控，选 Drizzle |
| 数据库 | RDS PostgreSQL 优先；团队 MySQL 更熟可选 RDS MySQL |
| API 文档 | OpenAPI/Swagger，CI 校验前后端契约 |
| 鉴权 | JWT/OIDC，后端解析用户身份与角色 |

### 5.2 数据库设计原则

- 使用多租户模型：`organizations` / `workspaces` 隔离不同团队或业务线。
- 所有核心表保留 `id`, `created_at`, `created_by`, `updated_at`, `updated_by`, `deleted_at`。
- 大 JSON 内容可放 `jsonb`，但查询高频字段要拆成列。
- 评测集 item、任务 item、投票记录必须行级存储，方便统计、审计和增量更新。
- 媒体文件只存元数据和 URL，不把二进制放数据库。
- 所有写操作进入 `audit_logs`。

### 5.3 核心表设计

以下以 PostgreSQL 表达，MySQL 可用 `json` 替换 `jsonb`。

| 表 | 作用 | 关键字段 |
| --- | --- | --- |
| `organizations` | 组织/租户 | `id`, `name`, `status` |
| `users` | 用户 | `id`, `email`, `display_name`, `avatar_url`, `external_auth_id` |
| `organization_members` | 组织成员 | `organization_id`, `user_id`, `role` |
| `projects` | 评测项目 | `id`, `organization_id`, `name`, `category`, `priority`, `type`, `goal`, `cycle`, `status`, `progress` |
| `project_members` | 项目协作人 | `project_id`, `user_id`, `role` |
| `project_steps` | 项目步骤 | `id`, `project_id`, `name`, `owner_user_id`, `status`, `execution_type`, `result_note` |
| `datasets` | 评测集主表 | `id`, `organization_id`, `name`, `description`, `modality`, `input_type`, `current_version` |
| `dataset_versions` | 评测集版本 | `id`, `dataset_id`, `version`, `schema_json`, `validation_summary_json`, `change_summary` |
| `dataset_items` | 评测集 case | `id`, `dataset_id`, `version_id`, `case_key`, `row_index`, `payload_json`, `dimension_values_json` |
| `templates` | Rubric 模板 | `id`, `organization_id`, `name`, `description`, `paradigm`, `config_json` |
| `template_dimensions` | 模板维度 | `id`, `template_id`, `name`, `type`, `weight`, `required`, `options_json`, `scale_json` |
| `eval_tasks` | 评测任务 | `id`, `project_id`, `dataset_id`, `dataset_version_id`, `template_id`, `name`, `status`, `output_type`, `evaluation_config_json` |
| `eval_task_models` | 任务模型 | `id`, `task_id`, `model_key`, `model_name`, `provider`, `metadata_json` |
| `eval_task_items` | 任务样本快照 | `id`, `task_id`, `dataset_item_id`, `row_index`, `payload_json` |
| `eval_task_assignees` | 任务分配 | `task_id`, `user_id`, `status`, `progress_count`, `completed_at` |
| `evaluation_votes` | 评测投票/打分 | `id`, `task_id`, `task_item_id`, `user_id`, `method`, `choice`, `ranking_json`, `scores_json`, `reason`, `submitted_at` |
| `generation_jobs` | 批量生产任务 | `id`, `dataset_id`, `dataset_version_id`, `status`, `model_config_json`, `total`, `succeeded`, `failed` |
| `generation_job_items` | 批量生产 case | `id`, `job_id`, `dataset_item_id`, `status`, `request_json`, `result_json`, `error_json` |
| `audit_logs` | 审计日志 | `id`, `actor_user_id`, `resource_type`, `resource_id`, `action`, `before_json`, `after_json`, `created_at` |

### 5.4 关键索引

| 表 | 索引 |
| --- | --- |
| `projects` | `(organization_id, status, updated_at desc)`, `(organization_id, priority)` |
| `project_members` | `(project_id, user_id) unique`, `(user_id)` |
| `datasets` | `(organization_id, updated_at desc)` |
| `dataset_items` | `(dataset_id, version_id, row_index)`, `(dataset_id, version_id, case_key)` |
| `eval_tasks` | `(project_id, status, created_at desc)`, `(organization_id, status, created_at desc)` |
| `eval_task_items` | `(task_id, row_index)`, `(task_id, dataset_item_id)` |
| `eval_task_assignees` | `(task_id, user_id) unique`, `(user_id, status)` |
| `evaluation_votes` | `(task_id, task_item_id)`, `(task_id, user_id)`, `(task_item_id, user_id) unique` |
| `generation_jobs` | `(dataset_id, created_at desc)`, `(status, updated_at desc)` |

### 5.5 API 设计

| 模块 | Endpoint |
| --- | --- |
| Auth | `GET /api/me`, `POST /api/auth/logout` |
| Projects | `GET /api/projects`, `POST /api/projects`, `GET /api/projects/:id`, `PATCH /api/projects/:id`, `DELETE /api/projects/:id` |
| Project members | `GET /api/projects/:id/members`, `PUT /api/projects/:id/members/:userId`, `DELETE /api/projects/:id/members/:userId` |
| Datasets | `GET /api/datasets`, `POST /api/datasets`, `GET /api/datasets/:id`, `PATCH /api/datasets/:id`, `DELETE /api/datasets/:id` |
| Dataset versions | `GET /api/datasets/:id/versions`, `POST /api/datasets/:id/versions`, `GET /api/datasets/:id/versions/:versionId/items` |
| Templates | `GET /api/templates`, `POST /api/templates`, `GET /api/templates/:id`, `PATCH /api/templates/:id`, `DELETE /api/templates/:id` |
| Tasks | `GET /api/tasks`, `POST /api/tasks`, `GET /api/tasks/:id`, `PATCH /api/tasks/:id`, `POST /api/tasks/:id/activate` |
| Evaluation | `GET /api/tasks/:id/evaluation-session`, `POST /api/tasks/:id/votes`, `PATCH /api/tasks/:id/votes/:voteId`, `POST /api/tasks/:id/complete` |
| Insights | `GET /api/insights/overview`, `GET /api/projects/:id/insights`, `GET /api/tasks/:id/insights` |
| Generation | `GET /api/generation/models`, `POST /api/generation/jobs`, `GET /api/generation/jobs/:id`, `POST /api/generation/jobs/:id/cancel` |

### 5.6 权限模型

| 角色 | 权限 |
| --- | --- |
| `owner` | 组织配置、成员、删除项目、数据库级高危操作审批 |
| `admin` | 管理项目、数据集、模板、任务、成员 |
| `editor` | 创建和编辑项目、数据集、模板、任务 |
| `evaluator` | 查看被分配任务、提交评测、查看允许范围内结果 |
| `viewer` | 只读查看项目、数据集、洞察 |

权限判断放后端：

- 组织级资源必须校验 `organization_id`。
- 项目级资源优先校验 `project_members`。
- 任务执行校验 `eval_task_assignees` 或项目成员角色。
- 所有导出、删除、批量更新都写入 `audit_logs`。

## 6. 数据迁移方案

### 6.1 迁移对象

需要从 legacy document store 导出的集合：

- `users`
- `projects`
- `evalDatasets`
- `evalTemplates`
- `evalTasks`
- `evalTasks/{taskId}/items`
- `evalTasks/{taskId}/userVotes`
- `evalGenerationJobs`
- `evalGenerationJobs/{jobId}/items`

本地 `localStorage` 数据不建议作为正式迁移来源，只作为开发调试数据。若用户确实需要，可提供本地导出 JSON 后通过导入脚本写入新库。

### 6.2 迁移步骤

1. 设计并创建 RDS 数据库、DMS 实例接入、账号和白名单。
2. 在后端项目建立 migration，创建第一版 schema。
3. 编写 legacy document store export 脚本，把集合导出成 JSONL。
4. 编写 transform 脚本，将 legacy document store 文档转换成关系型表行。
5. 先导入 staging 数据库，执行校验 SQL：
   - 项目数一致。
   - 数据集数、版本数、item 数一致。
   - 任务数、任务 item 数一致。
   - 投票用户数、投票 case 数一致。
6. 前端接入新 API 的只读模式，进行页面对账。
7. 短冻结窗口内执行最终导出和导入。
8. 切换生产环境 API 地址，保留 local platform 只读备份一段时间。

### 6.3 迁移期间兼容策略

| 阶段 | 前端 | 后端 | 数据 |
| --- | --- | --- | --- |
| Phase A | 仍读 legacy document store | 新 API 开发中 | legacy document store 主库 |
| Phase B | 部分页面读新 API | API 只读 | legacy document store 主库 + RDS 影子库 |
| Phase C | 全页面读新 API，写仍可双写 | API 支持写 | RDS 与 legacy document store 对账 |
| Phase D | 全量读写新 API | API 主库 | RDS 主库，legacy document store 归档 |

不建议长期双写。双写只用于短期迁移对账。

## 7. 工程化与可持续迭代建议

### 7.1 代码质量

| 能力 | 建议 |
| --- | --- |
| TypeScript | 开启更严格配置，逐步收紧 `any` |
| Lint | 将当前 `npm run lint` 从 `tsc --noEmit` 扩展为 ESLint + TypeScript |
| Format | 引入 Prettier，减少样式争论 |
| Commit | 使用 Conventional Commits，便于 changelog |
| PR 检查 | `typecheck`, `lint`, `test`, `build` 必跑 |

### 7.2 测试体系

| 层级 | 工具 | 覆盖对象 |
| --- | --- | --- |
| 单元测试 | Vitest | 维度解析、投票聚合、数据集验证、权限函数 |
| 组件测试 | Testing Library | 创建项目、上传数据集、配置模板 |
| E2E | Playwright | 从创建项目到完成评测再查看洞察 |
| API 测试 | Supertest 或 Fastify inject | 后端权限、分页、写入、错误码 |
| 数据库测试 | Testcontainers 或临时测试库 | migration、事务、索引、聚合查询 |

### 7.3 环境与发布

建议环境：

| 环境 | 用途 | 数据库 |
| --- | --- | --- |
| local | 本地开发 | 本地 PostgreSQL/MySQL 或 mock API |
| dev | 联调 | RDS dev 库 |
| staging | 预发验收 | RDS staging 库，接近生产 |
| production | 正式使用 | RDS production 库 |

发布策略：

- 前端与后端使用同一个 GitHub Actions pipeline，但分 job。
- migration 先在 staging 跑，再由 DMS 审批生产 SQL。
- 生产部署先执行向后兼容 migration，再发后端，再发前端。
- 高风险变更使用 feature flag。

### 7.4 观测与运营

需要补齐：

- 前端错误上报：页面崩溃、API 错误、媒体加载失败。
- 后端日志：请求 ID、用户 ID、资源 ID、耗时、错误码。
- 数据库监控：慢 SQL、连接池、锁等待、存储增长。
- 业务指标：活跃项目数、数据集增长、任务完成率、评测人完成率、单 case 平均投票数、生产任务成功率。
- 审计报表：谁修改了项目、谁导入了数据集、谁删除了任务、谁导出了结果。

### 7.5 产品能力建议

| 方向 | 建议 |
| --- | --- |
| 项目共享 | 项目详情页提供可复制链接，支持成员角色和任务分配 |
| 数据集治理 | 数据集版本、schema 校验、质量报告、覆盖率分布 |
| 模板治理 | Rubric 模板版本化，任务绑定固定版本，避免历史结果漂移 |
| 任务执行 | 支持断点续评、多人进度、冲突检测、重复投票策略 |
| 结果洞察 | 支持按项目、任务、模型、维度、case 标签聚合 |
| 导入导出 | CSV/JSON 导入导出标准化，导出任务异步化 |
| 权限审计 | 重要操作需要确认和审计，删除走软删除 |
| 资产管理 | 视频/图片统一走 OSS，记录来源、有效性和 referer 策略 |

## 8. 分阶段执行计划

### 阶段 0：设计冻结与基线整理，2-3 天

目标：冻结重构范围，保证后续改造可验证。

任务：

- 整理当前页面、集合、字段、业务流程清单。
- 补充现有关键流程 E2E 手工验收用例。
- 确认数据库选型：RDS PostgreSQL 或 RDS MySQL。
- 确认认证方案：保留 Google/OIDC，或迁移到企业 SSO。
- 确认部署环境：阿里云 ECS/ACK/函数计算。

交付物：

- 路由清单。
- 数据实体清单。
- 第一版 DB schema。
- 迁移验收标准。

### 阶段 1：前端路由化，5-7 天

目标：每个页面有独立 URL，可直接访问和分享。

任务：

- 安装并接入 `react-router-dom`。
- 新增 `src/app/router.tsx` 和布局组件。
- 将 `overview/projects/datasets/templates/tasks/evaluation/insights/history` 迁移为 page。
- 将 `routeContext` 改为 URL params/search params。
- 保留旧组件内部逻辑，先不大规模拆业务代码。

验收标准：

- 刷新 `/projects/:projectId` 后仍能打开目标项目。
- 从项目详情能跳转到任务、洞察、数据集。
- 旧导航入口全部可用。
- `npm run lint` 和 `npm run build` 通过。

### 阶段 2：前端数据层抽象，4-6 天

目标：页面不再直接调用 legacy document store 风格 API。

任务：

- 新增 `shared/api/httpClient.ts`。
- 建立 `features/projects|datasets|templates|tasks|evaluation|insights` 的 API 与 hooks。
- 先用 adapter 包装现有 `datastore.ts`，保持行为不变。
- 页面逐步改成调用 hooks。

验收标准：

- 页面组件不再直接 import `collection/doc/getDocs/onSnapshot`。
- 数据请求、loading、error 统一处理。
- 后续切换后端 API 时只改 features API 层。

### 阶段 3：后端 API 与数据库，8-12 天

目标：建立可运行的后端 API 和 RDS schema。

任务：

- 新建 `server/`。
- 接入 ORM、migration、OpenAPI。
- 创建核心表：用户、组织、项目、数据集、模板、任务、投票、生产、审计。
- 实现项目、数据集、模板、任务的 CRUD。
- 实现投票提交和洞察聚合 API。
- 建立 RBAC 权限中间件。

验收标准：

- API 可在本地连接 dev 数据库跑通。
- OpenAPI 文档可访问。
- migration 可重复执行。
- 后端测试覆盖核心权限和写入路径。

### 阶段 4：数据迁移与对账，5-8 天

目标：把 legacy document store 数据安全迁移到 RDS。

任务：

- 编写 legacy document store export。
- 编写 JSONL 到 SQL 的 transform/import。
- 在 staging 导入并对账。
- 修正字段映射和历史异常数据。
- 生成迁移报告。

验收标准：

- 项目、数据集、任务、投票数量对齐。
- 抽样项目详情、任务结果、洞察结果与旧系统一致。
- 迁移脚本可重复执行到干净数据库。

### 阶段 5：线上切换，3-5 天

目标：生产环境从 local platform 主库切到 RDS 主库。

任务：

- 配置阿里云生产 RDS、DMS、账号、白名单、备份。
- 配置后端生产环境变量和 CI/CD。
- 前端生产环境配置 `VITE_API_BASE_URL`。
- 短冻结窗口执行最终迁移。
- 切流并观察错误率、慢 SQL、业务数据写入。

验收标准：

- 线上创建项目、导入数据集、创建任务、投票、查看洞察全链路可用。
- 新数据只写入 RDS。
- local platform 保留只读备份，不再作为主写入路径。

### 阶段 6：长期工程治理，持续推进

目标：让项目进入稳定迭代状态。

任务：

- 拆分大组件。
- 补齐 E2E 自动化。
- 数据集/模板版本化。
- 结果洞察性能优化。
- 增加审计报表和管理后台。
- 建立发布说明和回滚机制。

## 9. 风险与应对

| 风险 | 应对 |
| --- | --- |
| 一次性重构过大 | 路由、数据层、后端、迁移分阶段，每阶段可独立上线 |
| legacy document store 历史数据形态不一致 | 迁移前做 profiling，transform 脚本容错并输出异常清单 |
| 投票并发覆盖 | 新库投票按 `task_item_id + user_id` 唯一约束，使用事务/upsert |
| 媒体资源跨域或 referer 限制 | 统一迁移到 OSS 或配置 CDN 白名单，前端记录加载失败 |
| 后端权限遗漏 | 所有 API 默认需要组织成员身份，高危操作加角色校验和审计 |
| SQL 变更影响生产 | DMS 审批 + staging 预演 + 向后兼容 migration |
| 洞察查询变慢 | 高频聚合先加索引，后续可做 materialized view 或定时汇总表 |

## 10. 优先级建议

第一优先级：

- React Router 路由化。
- API Client / hooks 抽象。
- 数据库 schema 和后端 API 设计冻结。

第二优先级：

- 后端 CRUD 与投票/洞察 API。
- 迁移脚本和 staging 对账。
- 生产环境 RDS + DMS 管理链路。

第三优先级：

- 大组件拆分。
- 自动化测试补齐。
- 版本化、审计、观测、异步导出、管理后台。

## 11. 推荐的第一批代码改动

建议按以下 PR 拆分，避免单个 PR 过大：

| PR | 内容 | 不做什么 |
| --- | --- | --- |
| PR 1 | 引入 React Router，新增 route config，现有页面挂到 URL | 不改数据层 |
| PR 2 | 把 `ModelEvalApp` 的 route state 拆到页面层，移除大部分 `currentRoute` 判断 | 不改 legacy document store |
| PR 3 | 新增 `features/*/api.ts` 和 hooks，用 adapter 包住现有 datastore | 不接真实后端 |
| PR 4 | 新建 `server/`、migration、基础项目/数据集 API | 不迁移生产 |
| PR 5 | 前端项目/数据集页面切到新 API | 不切任务执行 |
| PR 6 | 任务、投票、洞察 API 与前端切换 | 不删除 local platform 代码 |
| PR 7 | 迁移脚本、staging 对账、生产切换配置 | 不做大 UI 改版 |

## 12. 参考

- Alibaba Cloud Data Management 文档：https://www.alibabacloud.com/help/en/dms/product-overview/basic-architecture
- Alibaba Cloud ApsaraDB RDS 文档：https://www.alibabacloud.com/help/en/rds/
