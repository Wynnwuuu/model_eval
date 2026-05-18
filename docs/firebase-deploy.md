# Firebase 自动部署

本项目通过 GitHub Actions 在 `main` 分支更新后自动部署 Firebase Hosting。

## GitHub 配置

进入 GitHub 仓库：

`Settings -> Secrets and variables -> Actions`

添加 Repository secret：

```text
VITE_FIREBASE_API_KEY
FIREBASE_SERVICE_ACCOUNT_JSON
```

添加 Repository variables：

```text
VITE_FIREBASE_AUTH_DOMAIN=evalstudiocopygit-125148.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=evalstudiocopygit-125148
VITE_FIREBASE_STORAGE_BUCKET=<你的 storageBucket>
VITE_FIREBASE_MESSAGING_SENDER_ID=<你的 messagingSenderId>
VITE_FIREBASE_APP_ID=<你的 appId>
```

`FIREBASE_SERVICE_ACCOUNT_JSON` 是 Firebase 部署用服务账号 JSON 的完整内容。

## Firebase 控制台配置

1. `Authentication -> Sign-in method`：启用 Google 登录。
2. `Authentication -> Settings -> Authorized domains`：加入线上域名。
3. `Project settings -> Service accounts`：创建/下载服务账号 JSON，填入 GitHub secret `FIREBASE_SERVICE_ACCOUNT_JSON`。
4. 服务账号至少需要这些角色：
   - Firebase Hosting Admin
   - Service Usage Viewer

如果 Firebase Hosting API 还没启用，先由项目 Owner 在控制台启用，或临时给服务账号加 `Service Usage Admin` 完成首次部署后再移除。

## 部署触发

推送到 `main` 后自动执行：

```text
npm ci
npm run lint
npm run build
firebase deploy --only hosting
```

也可以在 GitHub Actions 页面手动运行 `Deploy Firebase`。
