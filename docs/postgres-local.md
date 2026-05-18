# 本地 PostgreSQL 开发环境

本地数据库基座和核心 HTTP/PostgreSQL 数据链路已经落地。

未开启 HTTP 后端时：

```text
前端 -> features/*/api.ts -> datastore.ts -> localStorage
```

开启 HTTP 后端时：

```text
前端 -> features/*/api.ts -> 后端 HTTP API -> PostgreSQL
```

当前本地后端已提供数据库连通性检查：

```bash
npm run dev:full
```

这会按顺序执行：

```text
npm run db:up -> npm run db:migrate -> npm run api:dev + npm run dev
```

`dev:full` 会优先复用本机已经存在的 `eval-studio-postgres` 容器；如果该容器已停止，会先执行 `docker start eval-studio-postgres`。只有容器不存在时才会执行 `npm run db:up` 创建新容器。

默认地址：

```text
API: http://localhost:8787
Web: http://localhost:3000
```

也可以单独启动 API 后做连通性检查：

```bash
npm run api:dev
curl http://localhost:8787/api/health
curl http://localhost:8787/api/db/health
```

项目、评测集、模板、评测物料、评测投票、生产任务数据链路已支持切换到本地后端：

```env
VITE_USE_API_BACKEND=true
VITE_API_BASE_URL=http://localhost:8787
```

开启后，项目、评测集、模板、评测物料、评测投票/进度、生产任务会走：

```text
前端 -> features/{projects,datasets,templates,tasks}/api.ts -> /api/* -> PostgreSQL
```

当前仍有少量账号/用户列表等辅助数据沿用 localStorage fallback 路径。

## Smoke Test

启动 API 后运行：

```bash
npm run test:api:smoke
```

该脚本会通过 HTTP API 创建并清理一组临时数据，覆盖：

- project
- dataset / dataset items
- template / dimensions
- task / task items
- votes / progress
- generation job / generation job items

## 启动数据库

```bash
npm run db:up
```

如果提示容器名冲突：

```text
Conflict. The container name "/eval-studio-postgres" is already in use
```

通常表示本地已有同名 PostgreSQL 容器。先查看状态：

```bash
docker ps -a --filter name=eval-studio-postgres
```

如果容器健康运行，可直接执行迁移和启动服务：

```bash
npm run db:migrate
npm run api:dev
npm run dev
```

如果容器已停止，启动它：

```bash
docker start eval-studio-postgres
```

如需重建容器但保留数据卷：

```bash
docker rm -f eval-studio-postgres
npm run db:up
```

如果已有本地 volume，需要执行增量迁移：

```bash
npm run db:migrate
```

默认连接信息：

```text
host=localhost
port=5432
database=eval_studio
user=eval_studio
password=eval_studio_dev
```

`DATABASE_URL`：

```text
postgresql://eval_studio:eval_studio_dev@localhost:5432/eval_studio
```

## 检查状态

```bash
npm run db:psql
```

进入 psql 后可执行：

```sql
\dt
select id, name from organizations;
```

## 停止数据库

```bash
npm run db:down
```

## 重要说明

- 初始 schema 位于 `server/db/migrations/001_initial_schema.sql`。
- 增量迁移也放在 `server/db/migrations/`，本地执行 `npm run db:migrate` 会按文件名顺序执行尚未记录到 `schema_migrations` 的 SQL。
- Docker 官方 PostgreSQL 镜像只会在数据卷首次创建时执行 `/docker-entrypoint-initdb.d` 下的初始化 SQL。
- 如果修改了初始化 SQL 并希望重新初始化本地数据库，需要删除 volume：

```bash
docker compose down -v
npm run db:up
```

这会清空本地 PostgreSQL 数据，仅适合本地开发环境。
