# Firebase 预览部署

本项目的正式站由 `Deploy Firebase` workflow 部署到 Firebase Hosting live channel。为了在线上测试新分支而不覆盖正式站，可以使用 `Deploy Firebase Preview` workflow 部署到 Firebase Hosting preview channel。

## 适用场景

- 想在线访问某个功能分支，但暂时不合并到 `main`。
- 想把预览链接发给其他人试用。
- 想保留正式站不变，随时切回 `main` 对应版本。

## 重要区别

| 部署方式 | 是否影响正式站 | 是否需要合并功能代码到 main | 用途 |
| --- | --- | --- | --- |
| `Deploy Firebase Preview` | 否 | 否 | 分支预览、PR 评审、线上试用 |
| `Deploy Firebase` | 是 | 通常是 | 正式发布 |

Preview channel 只部署 Hosting 内容和 Hosting 配置，不部署 Firestore rules。应用仍会连接同一个 Firebase 项目，因此登录、Firestore 数据和权限规则仍是线上真实环境。

## 首次启用

GitHub 的 `workflow_dispatch` 手动运行要求 workflow 文件存在于默认分支 `main`。因此需要先把 `.github/workflows/firebase-preview.yml` 作为一个基础设施改动合入 `main`。这个改动不会修改应用页面，也不会自动发布正式站。

仓库需要已有这些 Actions 配置：

Repository secret:

```text
VITE_FIREBASE_API_KEY
FIREBASE_SERVICE_ACCOUNT_JSON
```

Repository variables:

```text
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

这些配置与正式部署 workflow 共用。

## 手动部署某个分支

在 GitHub 网页操作：

1. 打开仓库 `Actions`。
2. 选择 `Deploy Firebase Preview`。
3. 点击 `Run workflow`。
4. Branch 选择要预览的分支，例如 `codex/eval-method-rubric-insights`。
5. `channel_id` 填一个稳定名称，例如 `eval-method-rubric-insights`。
6. `expires` 填 `30d`。
7. 运行完成后，在 workflow summary 里复制 Preview URL。

也可以用 GitHub CLI：

```powershell
gh workflow run firebase-preview.yml `
  --repo world-sim-dev/eval_studio `
  --ref codex/eval-method-rubric-insights `
  -f channel_id=eval-method-rubric-insights `
  -f expires=30d
```

查看运行结果：

```powershell
gh run list --repo world-sim-dev/eval_studio --workflow "Deploy Firebase Preview" --limit 5
gh run watch --repo world-sim-dev/eval_studio
```

## PR 自动预览

当该 workflow 已存在于 `main` 后，PR 打开、重新打开或推送新提交时，会自动部署到 `pr-<PR编号>` preview channel，并在 PR 下评论预览链接。

## 切换版本

- 使用新版：访问 preview URL。
- 回到正式版：访问 Firebase Hosting 正式域名。
- 将新版正式发布：确认无误后 merge PR 到 `main`，再由 `Deploy Firebase` 正式部署。

## 有效期

Firebase preview channel 有过期时间，本 workflow 默认 `30d`。需要延长时，重新运行同一个 channel_id 即可刷新预览部署。
