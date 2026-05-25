# ManuEval

ManuEval 是一个面向模型与生成内容评测的协作平台。当前工程形态是标准 React 前端 + Express HTTP API + PostgreSQL 数据库，支持项目管理、数据集仓库、评测模板、评测任务、评测执行、结果洞察、生产数据管理，以及仅用于快速查看数据的 Benchmark 预览模式。

标准数据路径：

```text
React frontend -> HTTP API -> PostgreSQL
```

生产部署形态：

```text
single Docker image -> Express serves /api/* and Vite dist
```

线上评测用户只需要访问部署站点并使用飞书登录；Docker、PostgreSQL 和 `local:start` 仅面向开发、CI 或部署维护。

## 核心能力

- 项目、数据集、模板、任务、结果洞察的独立路由和可分享 URL。
- A/B 偏好、Pairwise、MOS、Rubric、Arena-rank 等评测方式。
- Benchmark 数据预览：上传 CSV，选择输入列和输出预览列，逐条查看文本、图片、视频、音频并记录评论。
- PostgreSQL 作为业务主存储，前端通过 HTTP API 访问，不再依赖 Firestore。
- 本地 Docker PostgreSQL、API smoke test、迁移脚本和一键开发脚本。
- dev 环境 CI/CD：main push 后自动测试、构建镜像、迁移数据库并部署 ACK dev。

## 本地开发

推荐完整本地模式，也是默认多人协作模式：

```bash
npm install
npm.cmd run local:start
```

该脚本会启动 PostgreSQL、执行迁移、启动 API 和 Vite，并检查 `http://localhost:3000/`、`http://localhost:8787/api/health`、`http://localhost:8787/api/db/health`。

如果本机已经存在 `eval-studio-postgres` 容器，`dev:full` 会直接复用或启动该容器，避免重复创建导致容器名冲突。

也可以前台分步运行：

```bash
npm run db:up
npm run db:migrate
npm run api:dev
npm run dev
```

如确实只需要单机 demo，可以显式运行离线模式：

```bash
npm.cmd run dev:offline
```

离线模式只读取当前浏览器 localStorage，不能用于多人评测或全员结果洞察。

默认地址：

- 前端：`http://localhost:3000`
- API：`http://localhost:8787`
- PostgreSQL：`localhost:5432`

## 环境变量

复制 `.env.example` 为 `.env.local`，按需配置。

常用变量：

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | API 连接 PostgreSQL 的连接串 |
| `API_PORT` | API 监听端口，默认 `8787` |
| `CORS_ORIGIN` | 本地跨域来源，默认可设为 `http://localhost:3000` |
| `VITE_STORAGE_MODE` | 仅设置为 `local` 时进入离线 localStorage demo |
| `VITE_USE_API_BACKEND` | 兼容旧开关；设置为 `false` 时进入离线 localStorage demo |
| `VITE_API_BASE_URL` | 默认留空走同源 `/api`；只有前后端分域部署时才填写 API 域名 |
| `VITE_API_PROXY_TARGET` | Vite 本地代理目标，默认 `http://localhost:8787` |
| `GEMINI_API_KEY` | 可选，生成相关能力需要时配置 |

## 数据库

本地 PostgreSQL：

```bash
npm run db:up
npm run db:migrate
```

进入 psql：

```bash
npm run db:psql
```

迁移脚本位于 `server/db/migrations`，执行状态由 `schema_migrations` 表记录。

## 验证

```bash
npm run lint
npm run build
npm run server:build
npm run test:api:smoke
```

Docker 构建：

```bash
docker build -t manueval:local .
```

## Dev CI/CD

当前只启用 dev 自动部署，staging/prod 暂不部署。

main push 后执行：

```text
test -> build Docker image -> deploy dev -> migration job -> rollout status
```

相关工作流：

- `.github/workflows/eval-studio-test.yml`
- `.github/workflows/eval-studio-build.yml`
- `.github/workflows/eval-studio-deploy.yml`
- `.github/workflows/eval-studio-cicd.yml`

部署文档见：

- [docs/dev-cicd-deployment.md](docs/dev-cicd-deployment.md)

dev 部署默认启用飞书登录。需要在 GitHub Actions Secrets 配置飞书 App ID、App Secret、回调地址和 JWT 签名密钥，并在飞书开放平台放通同一个 `/feishu-callback` 回调地址。

## 重要文档

- [docs/react-standardization-refactor-plan.md](docs/react-standardization-refactor-plan.md) — React 标准化重构规划。
- [docs/refactor-execution-log.md](docs/refactor-execution-log.md) — 分阶段执行记录。
- [docs/postgres-local.md](docs/postgres-local.md) — 本地 PostgreSQL 说明。
- [docs/deployment-postgres.md](docs/deployment-postgres.md) — PostgreSQL 线上部署说明。
- [docs/benchmark-data-preview-plan.md](docs/benchmark-data-preview-plan.md) — Benchmark 数据预览功能规划。
- [docs/dev-cicd-deployment.md](docs/dev-cicd-deployment.md) — dev CI/CD 部署说明。

## 远端仓库

```text
https://github.com/world-sim-dev/ManuEval.git
```
