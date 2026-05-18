# 本地 PostgreSQL 开发环境

本阶段只建立本地数据库基座，还没有把前端数据读写切到 PostgreSQL。

当前数据路径仍是：

```text
前端 -> features/*/api.ts -> datastore.ts -> localStorage 或 Firestore
```

后续目标路径是：

```text
前端 -> features/*/api.ts -> 后端 HTTP API -> PostgreSQL
```

当前本地后端已提供数据库连通性检查：

```bash
npm run api:dev
curl http://localhost:8787/api/health
curl http://localhost:8787/api/db/health
```

项目数据链路已支持切换到本地后端：

```env
VITE_USE_API_BACKEND=true
VITE_API_BASE_URL=http://localhost:8787
```

开启后，项目列表、新建项目、更新项目、删除项目会走：

```text
前端 -> features/projects/api.ts -> /api/projects -> PostgreSQL
```

其他数据域仍沿用当前的 localStorage 或 Firestore 路径。

## 启动数据库

```bash
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
- 增量迁移也放在 `server/db/migrations/`，本地执行 `npm run db:migrate` 会按文件名顺序重放这些 SQL。
- Docker 官方 PostgreSQL 镜像只会在数据卷首次创建时执行 `/docker-entrypoint-initdb.d` 下的初始化 SQL。
- 如果修改了初始化 SQL 并希望重新初始化本地数据库，需要删除 volume：

```bash
docker compose down -v
npm run db:up
```

这会清空本地 PostgreSQL 数据，仅适合本地开发环境。
