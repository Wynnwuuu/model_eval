# Eval Studio

**线上环境（生产部署）：** [https://evalstudiocopygit-125148-927e8.web.app/](https://evalstudiocopygit-125148-927e8.web.app/)
**本测试环境**
PR 自动预览：
https://evalstudiocopygit-125148-927e8--pr-1-066v89he.web.app

手动稳定预览：
https://evalstudiocopygit-125148-927e8--eval-method-rubric-ins-swxqwuoq.web.app
---

评测工作台（界面品牌为 **EvalTrack**）。标准协作数据路径为：

```text
前端 -> HTTP API -> PostgreSQL
```

- **完整本地开发**：执行 `npm run dev:full`，会启动 PostgreSQL、执行迁移、启动 API 和 Vite。
- **单机 demo/offline**：直接执行 `npm run dev` 时，未开启 HTTP API 的 feature fallback 会使用 `localPlatform`，数据保存在浏览器 `localStorage`（键名 `evaltrack_local_platform_v1`）。
- **线上登录**：可选使用 cloud authentication 作为登录身份来源；业务数据不使用 local platform 持久化。

## 功能概览

- 项目工作台、评测集仓库、模板仓库、任务编排与执行、结果与分析。
- 支持 GSB / MOS / Arena / Arena-rank 等评测范式。
- Arena-rank：逐 case prompt、排名视频预览、CSV 导出视频链接等。
- Analysis：平台任务结果汇总、外部 CSV 上传、分析结果导出。
- 浏览器内仍会使用少量 **`localStorage`**（例如评测进行中的会话 `modeleval_session`、历史 `modeleval_history`），与业务主库分离。

## 环境要求

- Node.js 20 LTS，或较新的 Node.js 18
- npm
- 推荐浏览器：Chrome / Edge

## 快速启动（开发）

```bash
npm install
npm run dev
```

浏览器打开：`http://localhost:3000/`（端口以终端输出为准；仓库脚本里常用 `3000`）。

### Windows 可选入口

- 双击根目录 **`start-local.cmd`**，或执行 `npm run local:start`（见 `scripts/start-local.ps1`）。
- 停止与自检：`npm run local:stop`、`npm run local:check`；或双击 **`stop-local.cmd`**。

更细的 Windows 本机说明见 [docs/local-backend.md](docs/local-backend.md)。

## 生产构建与校验

```bash
npm run lint
npm run build
```

生产包需要配置 API 地址：

```env
VITE_USE_API_BACKEND=true
VITE_API_BASE_URL=https://<api-domain>
```

如需 Google 登录，再配置 cloud auth 相关变量和 `VITE_USE_AUTH_PROVIDER=true`。构建完成后可由 static hosting、OSS/CDN 或其他静态托管渠道发布。

GitHub Actions 自动部署、Secrets/Variables 清单见 [docs/local-platform-deploy.md](docs/local-platform-deploy.md)。

## 环境变量

复制 **`.env.example`** 为 **`.env.local`**（不要提交到 Git），按需填写：

| 变量 | 作用 |
|------|------|
| `VITE_USE_API_BACKEND` | `true` 时业务数据走 HTTP API -> PostgreSQL。 |
| `VITE_API_BASE_URL` | HTTP API 地址。 |
| `DATABASE_URL` | 后端连接 PostgreSQL 的连接串。 |
| `VITE_AUTH_*` | 可选 cloud auth Web 应用配置。 |
| `VITE_USE_AUTH_PROVIDER` | `true` 时使用 cloud auth；不设时使用内置本地测试用户。 |
| `GEMINI_API_KEY` | 若使用 Gemini 相关能力时在构建或运行环境中注入（见 `.env.example` 说明）。 |
| `APP_URL` | 部署站点自身 URL（OAuth、回调等场景，见 `.env.example`）。 |

默认 local platform 工程 ID 与 CLI 默认项目见 **`.local-platformrc`**（当前 `default` 为 `evalstudiocopygit-125148`）。

## 登录与权限

- 可选使用 **cloud authentication**：生产环境需启用 **Google** 等登录方式，并把线上域名加入 Authorized domains。
- 业务权限由后端 API 和 PostgreSQL 表控制，项目成员角色包括 `owner`、`editor`、`viewer`。

## 常见问题

- **`localhost` 无法连接**：先执行 `npm run dev` 或 Windows 下的 `start-local.cmd`。
- **开发数据「换浏览器就没了」**：开发模式主数据在 **`localStorage`**，换浏览器或清除站点数据会重置。
- **线上多人要看到同一批项目**：前端需配置同一个 `VITE_API_BASE_URL`，后端连接同一个 PostgreSQL 数据库。
- **非项目成员不能修改项目**：后端会基于 `project_members` 校验角色权限。
- **页面内视频慢、新标签可开**：评测/结果页已对媒体加载做兜底；部分预览使用较轻的预加载策略。

## 相关文档

- [docs/local-backend.md](docs/local-backend.md) — Windows 本机启动与维护。
- [docs/local-platform-deploy.md](docs/local-platform-deploy.md) — CI 部署与 GitHub Secrets。
