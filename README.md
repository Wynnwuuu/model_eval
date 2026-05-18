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

## 核心能力

- 项目、数据集、模板、任务、结果洞察的独立路由和可分享 URL。
- A/B 偏好、Pairwise、MOS、Rubric、Arena-rank 等评测方式。
- Benchmark 数据预览：上传 CSV，选择输入列和输出预览列，逐条查看文本、图片、视频、音频并记录评论。
- PostgreSQL 作为业务主存储，前端通过 HTTP API 访问，不再依赖 Firestore。
- 本地 Docker PostgreSQL、API smoke test、迁移脚本和一键开发脚本。
- dev 环境 CI/CD：main push 后自动测试、构建镜像、迁移数据库并部署 ACK dev。

## 本地开发

推荐完整本地模式：

```bash
npm install
npm run dev:full
```

该脚本会启动 PostgreSQL、执行迁移、启动 API 和 Vite。

也可以分步运行：

```bash
npm run db:up
npm run db:migrate
npm run api:dev
npm run dev
```

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
| `VITE_USE_API_BACKEND` | `true` 时前端使用 HTTP API |
| `VITE_API_BASE_URL` | 本地开发通常为 `http://localhost:8787`；生产单容器部署可留空走同源 `/api` |
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
