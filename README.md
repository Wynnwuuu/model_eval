# Eval Studio

**线上环境（生产部署）：** [https://evalstudiocopygit-125148-927e8.web.app/](https://evalstudiocopygit-125148-927e8.web.app/)

---

评测工作台（界面品牌为 **EvalTrack**）。业务数据通过 `src/datastore.ts` 统一接入：

- **本地开发**（`npm run dev`）：默认使用 `localPlatform`，数据在浏览器 **`localStorage`**（键名 `evaltrack_local_platform_v1`），内置本地测试用户，**不**强制 Google 登录，便于单机调试。
- **生产构建**（`npm run build`）：默认使用 **Firebase Authentication + Cloud Firestore**，同一 Firebase 项目内的已登录用户共享项目、评测集、模板、任务与投票等数据。

是否走云端由 `src/firebase.ts` 中的 `shouldUseFirebase` 决定；默认规则为 `import.meta.env.PROD`（生产包为 `true`），也可用环境变量 **`VITE_USE_FIREBASE`** 显式覆盖（见 `.env.example`）。

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

生产包需要 **Vite 环境变量** 中的 Firebase Web 配置（`VITE_FIREBASE_*`）。构建完成后由 **Firebase Hosting** 等渠道托管静态资源；Firestore 安全规则见仓库根目录 **`firestore.rules`**。

GitHub Actions 自动部署、Secrets/Variables 清单见 [docs/firebase-deploy.md](docs/firebase-deploy.md)。

## 环境变量

复制 **`.env.example`** 为 **`.env.local`**（不要提交到 Git），按需填写：

| 变量 | 作用 |
|------|------|
| `VITE_FIREBASE_*` | Firebase Web 应用配置；生产构建读写 Firestore / Auth 时必需。 |
| `VITE_USE_FIREBASE` | `true`：即使 `vite dev` 也走 Firebase；`false`：即使生产包也走本地 `localStorage`；不设则跟随 `import.meta.env.PROD`。 |
| `GEMINI_API_KEY` | 若使用 Gemini 相关能力时在构建或运行环境中注入（见 `.env.example` 说明）。 |
| `APP_URL` | 部署站点自身 URL（OAuth、回调等场景，见 `.env.example`）。 |

默认 Firebase 工程 ID 与 CLI 默认项目见 **`.firebaserc`**（当前 `default` 为 `evalstudiocopygit-125148`）。

## Firebase 与权限

- **Authentication**：生产环境需启用 **Google** 等登录方式，并把线上域名加入 Authorized domains。
- **Firestore**：规则文件为 **`firestore.rules`**；修改后需部署（例如 `firebase deploy --only firestore:rules`，或由 CI 执行，见 [docs/firebase-deploy.md](docs/firebase-deploy.md)）。
- 项目、数据集等 **读取** 对同项目内已登录用户开放范围以规则为准；**写入** 多与 `initiatorUid` / `creatorUid` 绑定，详见规则内注释。

## 常见问题

- **`localhost` 无法连接**：先执行 `npm run dev` 或 Windows 下的 `start-local.cmd`。
- **开发数据「换浏览器就没了」**：开发模式主数据在 **`localStorage`**，换浏览器或清除站点数据会重置。
- **线上多人要看到同一批项目**：需使用 **同一 Firebase 项目** 的 `VITE_FIREBASE_*` 打生产包并部署；浏览器 Network 里出现 **`firestore.googleapis.com` … `Listen/channel`** 多为实时监听长连接，属正常现象。
- **非项目发起人打开大盘仍看到他人项目**：列表来自 Firestore 查询；若监听器内曾对他人项目误触发 `updateDoc`，会导致权限错误与频繁重试——当前已在 **`DashboardScreen`** 中对自动迁移 / 自动改步骤状态增加 **仅发起人可写** 的守卫。
- **页面内视频慢、新标签可开**：评测/结果页已对媒体加载做兜底；部分预览使用较轻的预加载策略。

## 相关文档

- [docs/local-backend.md](docs/local-backend.md) — Windows 本机启动与维护。
- [docs/firebase-deploy.md](docs/firebase-deploy.md) — CI 部署与 GitHub Secrets。
