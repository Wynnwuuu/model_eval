# 本地共享后端启动说明

ManuEval 默认是多人协作平台。本地开发也应使用共享数据源：

```text
Browser -> Vite frontend -> Express API -> PostgreSQL
```

## 推荐启动

```bash
npm.cmd run local:start
```

该命令会启动完整共享栈：

1. 启动或复用 Docker PostgreSQL 容器。
2. 执行数据库 migration。
3. 启动 Express API：`http://localhost:8787`。
4. 启动 Vite 前端：`http://localhost:3000`，并把同源 `/api` 代理到 `http://localhost:8787`。
5. 检查 web、API、DB health 全部可用。

检查状态：

```bash
npm.cmd run local:check
```

停止本项目本地进程：

```bash
npm.cmd run local:stop
```

## 离线 demo

只有在明确不需要多人共享时才使用：

```bash
npm.cmd run dev:offline
```

离线模式会把项目、任务和投票写入当前浏览器 localStorage。不同电脑、不同浏览器之间不会共享数据，因此不能用于团队结果洞察。

## 局域网成员访问

只有运行共享栈的机器需要 Docker。其他评测成员不需要启动 Docker，也不需要启动后端，只要访问运行机器的 Vite Network 地址即可，例如：

```text
http://192.168.x.x:3000/
```

前端 API 默认走同源 `/api`，所以其他成员的浏览器会请求 `http://192.168.x.x:3000/api/*`，再由 Vite 代理到运行机器本地的 `http://localhost:8787`。

## 迁移旧本地数据

切到共享后端后，如果浏览器里仍有 `evaltrack_local_platform_v1` 旧数据，页面会提示“迁移本机旧数据到共享后端”。流程是：

1. 自动 dry-run，展示项目、任务、投票用户等数量。
2. 先下载本机 JSON 备份。
3. 点击迁移，把数据导入 PostgreSQL。

也可以手动导出并迁移：

```js
copy(localStorage.getItem('evaltrack_local_platform_v1'))
```

保存为 `local-export.json` 后执行：

```bash
npm.cmd run migrate:postgres -- --source ./local-export.json --dry-run
npm.cmd run migrate:postgres -- --source ./local-export.json
```
