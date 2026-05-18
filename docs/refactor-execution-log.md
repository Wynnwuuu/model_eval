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
