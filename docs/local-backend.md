# 本地后端 / localhost 启动说明

## 这套本地服务是什么

当前 `evals_studio` 没有单独的 Express 后端进程。浏览器访问的 `http://localhost:3000/` 就是 Vite 本地开发服务；本地免登录数据层写在浏览器 `localStorage` 里。

所以电脑重启后看到“localhost 拒绝连接”，通常不是权限或数据库问题，而是本地 Vite 服务没有启动。

## 最推荐的启动方式

在 `evals_studio` 目录里双击：

```text
start-local.cmd
```

它会自动做这些事：

- 如果 `http://localhost:3000/` 已经可访问，直接打开浏览器。
- 如果服务没启动，后台运行 `npm.cmd run dev`。
- 如果缺少 `node_modules`，先执行 `npm.cmd install`。
- 等待服务可访问后打开浏览器。
- 日志写到 `.codex-vite.out.log` 和 `.codex-vite.err.log`。

命令行方式等价：

```powershell
npm.cmd run local:start
```

检查当前是否正常：

```powershell
npm.cmd run local:check
```

停止本项目的本地服务：

```powershell
npm.cmd run local:stop
```

## 重启电脑后的固定流程

1. 进入 `evals_studio` 目录。
2. 双击 `start-local.cmd`。
3. 浏览器打开 `http://localhost:3000/` 后即可继续本地测试。

如果希望开机自动出现入口，可以把 `start-local.cmd` 的快捷方式放到 Windows 启动文件夹：

```powershell
shell:startup
```

打开后，把快捷方式拖进去即可。这样每次登录 Windows 后会自动启动本地服务并打开浏览器。

## 常见问题

- `localhost:3000 refused to connect`：服务没启动，运行 `start-local.cmd`。
- 端口被别的程序占用：运行 `npm.cmd run local:check` 看 PID 和命令行；如果是本项目旧进程，运行 `npm.cmd run local:stop` 后再启动。
- 页面能打开但数据为空：本地数据保存在当前浏览器的 `localStorage`，换浏览器或清缓存会看起来像新环境。
- 需要 Gemini API 的功能：复制 `.env.example` 为 `.env.local`，并填入 `GEMINI_API_KEY`；普通本地评测、数据集、模板、Arena-rank 流程不依赖线上 local platform。
