# Eval Studio 重构执行记录

## 阶段 1：URL 路由化

状态：进行中，第一批路由壳已落地。

本阶段目标：

- 让核心页面具备独立 URL，可直接访问、刷新和分享。
- 暂不改业务数据层，仍沿用现有 Firebase/localPlatform 数据访问。
- 对动态资源先完成 URL 参数传递，后续阶段再继续拆分为真正的详情页。

已完成：

- 引入 `react-router-dom`。
- 新增 `src/app/router.tsx` 作为路由配置入口。
- `src/App.tsx` 改为 `BrowserRouter + AppRouter`。
- `ModelEvalApp` 支持接收 URL 上下文，并在应用内导航时同步浏览器地址。
- `AppRouter` 使用单个稳定宿主组件读取 URL，避免从准备页进入评测页时卸载评测状态。
- `/tasks/:taskId/evaluate` 与 `/tasks/:taskId/results` 支持直接打开 URL 后按 `taskId` 加载任务配置、case、模板和当前用户进度。
- `/tasks/:taskId` 支持直接打开 URL 后自动进入对应物料详情弹层，并加载该物料的 case 数据。
- `/projects/:projectId` 会把 `projectId` 传给项目页面并自动选中项目。
- `/datasets/:datasetId` 会把 `datasetId` 传给数据集页面并自动选中数据集。
- `/projects/:projectId/tasks`、`/projects/:projectId/insights`、`/tasks/:taskId/evaluate`、`/tasks/:taskId/results` 等路径已建立。
- 建立 `src/pages/*` 页面壳，`ModelEvalApp` 开始通过 page 层渲染核心模块，后续再逐步把业务逻辑从 screen 组件迁入 page/feature 结构。

## 阶段 2：数据访问层抽象

状态：已起步。

本阶段目标：

- 页面组件不再直接承载复杂的数据加载拼装逻辑。
- 先从评测任务读取链路开始抽取，后续再扩展到项目、数据集、模板和洞察。

已完成：

- 新增 `src/features/tasks/loadTaskEvaluation.ts`。
- 将 `/tasks/:taskId/evaluate` 和 `/tasks/:taskId/results` 所需的任务、模板、case、用户进度加载逻辑从 `ModelEvalApp` 抽到 feature 层。
- `ModelEvalApp` 只负责路由状态和评测执行状态写入，不再直接拼装任务评测数据。
- 项目大盘中的“开始评测”也复用 `loadTaskEvaluation`，点击进入评测和 URL 直达评测走同一套任务加载逻辑。
- 新增 `src/features/tasks/loadTaskItems.ts`，任务详情弹层和评测执行入口共享同一套 case 加载逻辑。
- 新增 `src/features/tasks/api.ts` 作为 task feature 的统一导出入口，并提供 `subscribeTasks`；`TaskBuilderScreen` 的任务列表订阅改为走 feature API。
- 新增 `src/features/datasets/api.ts` 和 `src/features/templates/api.ts`，评测集和 Rubric 模板列表订阅开始从页面组件收口到 feature API。
- `TemplateRepositoryScreen`、`DatasetRepositoryScreen`、`TaskBuilderScreen`、`DashboardScreen` 的评测集/模板读路径已接入对应 feature API。
- 新增 `src/features/projects/api.ts`，项目列表订阅开始收口到 feature API；项目旧 steps 自动迁移逻辑暂保留在 `DashboardScreen`，避免数据副作用与读取抽象同时迁移。
- 模板保存/删除写路径已收口到 `features/templates/api.ts` 的 `saveTemplate` / `deleteTemplate`。
- 数据集创建/保存/删除写路径已收口到 `features/datasets/api.ts` 的 `createDataset` / `saveDataset` / `deleteDataset`。
- 项目创建、步骤更新、链接更新、删除写路径已收口到 `features/projects/api.ts`；旧项目 steps 自动迁移副作用仍暂留页面组件中。

当前可验证 URL：

| URL | 预期 |
| --- | --- |
| `/` | 打开运营总览 |
| `/projects` | 打开项目列表 |
| `/projects/:projectId` | 打开项目页并选中指定项目 |
| `/projects/:projectId/tasks` | 打开指定项目下的评测物料页 |
| `/projects/:projectId/insights` | 打开指定项目洞察 |
| `/datasets` | 打开评测集仓库 |
| `/datasets/:datasetId` | 打开评测集仓库并选中指定评测集 |
| `/datasets/:datasetId/generation` | 打开指定评测集的生产视图 |
| `/generation` | 打开生产视图 |
| `/templates` | 打开 Rubric 库 |
| `/tasks` | 打开评测物料列表 |
| `/tasks/new` | 打开新建评测物料 |
| `/tasks/:taskId` | 打开评测物料列表并自动进入指定物料详情 |
| `/tasks/:taskId/evaluate` | 打开指定任务的评测入口 |
| `/tasks/:taskId/results` | 打开指定任务结果页 |
| `/insights` | 打开结果洞察 |
| `/history` | 打开历史记录 |

验证命令：

```bash
npm run lint
npm run build
```

已验证：

- `npm run lint` 通过。
- `npm run build` 通过。

下一步：

- 用浏览器检查核心 URL 的直达和刷新行为。
- 继续把旧 `currentRoute` 分支逐步拆成 `pages/*` 页面组件。

## 阶段 3：PostgreSQL 数据基座

状态：已起步，本地 PostgreSQL 基座已落地。

本阶段目标：

- 先建立可本地启动、可验证、可重置的 PostgreSQL 开发环境。
- 设计第一版关系型 schema，覆盖项目、数据集、模板、评测任务、评测条目、评测结果、生产任务和审计记录。
- 暂不直接把前端读写切到 PostgreSQL，避免在没有后端 API 的情况下让浏览器直连数据库。

已完成：

- 新增 `docker-compose.yml`，提供 `postgres:16-alpine` 本地数据库服务。
- 新增 `server/db/migrations/001_initial_schema.sql`，作为第一版初始化 schema。
- 新增 `db:migrate`，用于对已经存在的本地 PostgreSQL volume 执行增量迁移。
- 新增 `docs/postgres-local.md`，记录启动、连接、验证和重置方式。
- `.env.example` 增加 PostgreSQL 本地开发环境变量。
- `package.json` 增加 `db:up`、`db:down`、`db:logs`、`db:psql` 脚本。
- 新增最小本地后端入口 `server/index.ts`，提供 `/api/health` 和 `/api/db/health`。
- 新增 PostgreSQL 连接池 `server/db/client.ts`，后续项目/数据集/模板 API 会从这里接入数据库。
- 新增 `/api/projects` 后端接口，支持项目列表、详情、新建、更新和删除。
- `features/projects/api.ts` 支持通过 `VITE_USE_API_BACKEND=true` 和 `VITE_API_BASE_URL` 切换到 HTTP/PostgreSQL 链路。
- `DashboardScreen` 中旧项目 steps 自动迁移写入已改走 project feature API，避免切换后仍绕回 legacy document store。
- 新增 `/api/datasets` 后端接口，支持评测集列表、详情、保存和删除；数据落到 `datasets`、`dataset_versions`、`dataset_items`。
- 新增 `/api/templates` 后端接口，支持模板列表、详情、保存和删除；维度落到 `template_dimensions`。
- `features/datasets/api.ts` 和 `features/templates/api.ts` 支持同一个 HTTP/PostgreSQL 开关。
- 新增 `/api/tasks` 后端接口，支持评测物料列表、详情、创建、更新、删除，以及物料 items 读取和编辑。
- `features/tasks/api.ts` 支持同一个 HTTP/PostgreSQL 开关；`TaskBuilderScreen` 的任务创建、删除、状态更新、名称/负责人更新、item 编辑已收口到 task feature API。
- `/tasks/:taskId/evaluate` 的任务配置和 items 加载已支持从 HTTP/PostgreSQL 读取；投票进度仍暂未迁移。
- 新增 `/api/tasks/:taskId/votes` 和 `/api/tasks/:taskId/votes/:userName`，评测投票落到 `evaluation_votes`，用户进度写回 `eval_tasks.progress_json`。
- `ModelEvalApp` 的评测保存/回退保存已优先走 task feature API；结果洞察页导入平台结果时可从 HTTP/PostgreSQL 读取 task items 和 votes。
- 新增 `/api/generation/jobs` 和 `/api/generation/jobs/:jobId/items`，生产任务落到 `generation_jobs` 和 `generation_job_items`。
- 新增 `features/generation/api.ts`，`DatasetGenerationModal`、数据集仓库和总览页的生产任务读写已收口到 generation feature API。
- `DatasetGenerationModal` 中生产结果回写评测集已改走 `features/datasets/api.ts`，开启 HTTP 后会写入 PostgreSQL。
- 新增 `npm run dev:full`，一键启动 PostgreSQL、执行迁移、启动 API 和 Vite 前端。
- 新增 `npm run test:api:smoke`，通过 HTTP API 验证项目、评测集、模板、任务、投票、生产任务的 PostgreSQL 链路。
- `db:migrate` 改为 TypeScript 迁移执行器，使用 `schema_migrations` 记录已执行 SQL，避免每次重放全部迁移。
- 新增 `docs/postgres-refactor-status.md` 记录 PostgreSQL 重构完成状态、进行中事项和剩余任务。
- API 写接口加入第一版参数校验，并统一错误响应结构为 `{ error: { code, message, details? } }`。
- 新增请求用户上下文中间件，HTTP API 通过 `X-User-Id`、`X-User-Email`、`X-User-Name`、`X-Organization-Id` 写入 `users`、`organizations`、`organization_members`。
- 新建项目会同步写入 `project_members.owner`；项目更新要求 `owner/editor`，项目删除要求 `owner`。
- 前端 HTTP/PostgreSQL 模式的 projects、datasets、templates、tasks、generation 请求已统一携带当前用户身份头。
- API smoke test 增加权限负例：非项目成员更新项目会返回 `403 FORBIDDEN`。
- 新增 `npm run migrate:postgres` 数据迁移脚本，支持 localStorage/localPlatform JSON 和 legacy collection-shaped JSON 迁移到 PostgreSQL。
- 新增 `docs/data-migration.md`，记录导出格式、dry-run、导入和验证步骤。
- 新增 `docs/deployment-postgres.md`，记录阿里云 RDS PostgreSQL/DMS、后端 API、前端静态部署、验证和回滚方案。
- 明确 PostgreSQL 模式与 localStorage demo/offline fallback 的边界。
- 新增后端生产构建脚本、API Dockerfile 和 `.github/workflows/postgres-api-ci.yml`，CI 会跑 lint、前端 build、server build、迁移和 API smoke test。
- 项目权限继续深化：新增项目成员管理 API，并对任务创建/更新/删除、任务 item 更新、投票保存增加项目角色校验。

当前数据路径仍是：

```text
未迁移数据域：前端 -> datastore.ts -> localStorage
已迁移数据域：前端 -> features/{projects,datasets,templates,tasks}/api.ts -> /api/* -> PostgreSQL（开启 VITE_USE_API_BACKEND 后）
```

目标数据路径是：

```text
前端 -> features/*/api.ts -> 后端 HTTP API -> PostgreSQL
```

验证命令：

```bash
npm run db:up
npm run db:migrate
npm run db:psql
npm run api:dev
npm run lint
npm run build
npm run test:api:smoke
npm run migrate:postgres -- --source ./local-export.json --dry-run
```
