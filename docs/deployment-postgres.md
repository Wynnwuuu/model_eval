# PostgreSQL 模式部署方案

目标架构：

```text
Browser -> Frontend static hosting -> HTTP API -> PostgreSQL
                                      |
                                      -> DMS/RDS 管理与审计
```

前端只访问 HTTP API，不直连数据库。

## 线上数据库

推荐使用阿里云 RDS PostgreSQL，DMS 作为数据库管理、审计和数据操作入口。

| 项 | 建议 |
| --- | --- |
| 数据库引擎 | PostgreSQL 16 或兼容版本 |
| 数据库名 | `eval_studio` |
| 应用账号 | 单独创建最小权限账号，例如 `eval_studio_app` |
| 管理方式 | 通过 DMS 纳管实例 |
| 网络 | 后端 API 与 RDS 在同 VPC，或配置固定出口 IP 白名单 |
| 备份 | 开启自动备份与至少 7 天保留 |

应用账号需要对目标 schema 具备表读写和迁移权限。生产稳定后建议把迁移权限和运行时权限拆成两个账号。

## 后端 API

后端服务入口：

```bash
npm run api:start
```

生产环境变量：

```env
DATABASE_URL=postgresql://eval_studio_app:<password>@<rds-host>:5432/eval_studio
API_PORT=8787
CORS_ORIGIN=https://<frontend-domain>
```

源码部署流程：

```bash
npm install
npm run server:build
npm run db:migrate:prod
npm run api:start
```

Docker 部署：

```bash
docker build -t eval-studio-api .
docker run --env-file .env.production -p 8787:8787 eval-studio-api
```

上线检查：

```bash
curl https://<api-domain>/api/health
curl https://<api-domain>/api/db/health
```

## 前端

前端构建变量：

```env
VITE_USE_API_BACKEND=true
VITE_API_BASE_URL=https://<api-domain>
```

构建：

```bash
npm run build
```

部署 `dist/` 到静态站点服务、OSS/CDN、Firebase Hosting 或其他前端托管服务。

## 发布顺序

1. 创建 RDS PostgreSQL 和应用账号。
2. 在 DMS 中纳管实例，确认可以连接目标库。
3. 配置后端 `DATABASE_URL`、`API_PORT`、`CORS_ORIGIN`。
4. 后端执行 `npm run db:migrate`。
5. 启动后端 API 并检查 `/api/health`、`/api/db/health`。
6. 前端配置 `VITE_USE_API_BACKEND=true`、`VITE_API_BASE_URL`。
7. 构建并部署前端。
8. 跑 smoke test 指向线上 API 做上线前验证：

```bash
API_BASE_URL=https://<api-domain> npm run test:api:smoke
```

## 回滚策略

| 层 | 回滚方式 |
| --- | --- |
| 前端 | 回滚静态资源版本，或关闭 `VITE_USE_API_BACKEND` 后重新构建 |
| API | 回滚服务镜像/代码版本 |
| 数据库 | 优先使用向前兼容迁移；破坏性迁移必须先备份并设计反向脚本 |

## 当前限制

- 已提供 `server:build`、`api:start` 和 API Dockerfile；后续需要按实际云厂商补镜像推送和发布流水线。
- 线上权限模型已具备项目级写权限基础版，但成员管理 UI/API 仍需继续补齐。
- 标准协作环境应固定使用 HTTP/PostgreSQL；localStorage 仅保留为本地 demo/offline fallback。
