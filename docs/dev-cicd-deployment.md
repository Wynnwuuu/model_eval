# Eval Studio Dev CI/CD 部署说明

## 部署目标

当前只启用 dev 自动部署：

- `main` 分支 push 后自动执行 `test -> build -> deploy_dev`。
- staging/prod 暂不配置自动部署，也不提供部署入口。
- 镜像部署到阿里云 ACR，运行在阿里云 ACK。

## 应用形态

生产镜像是单容器应用：

- Express API 提供 `/api/*`。
- Express 同时托管 Vite 构建产物 `dist`。
- 前端构建时启用 `VITE_USE_API_BACKEND=true`。
- `VITE_API_BASE_URL` 默认留空，生产环境走同源 `/api`。

## GitHub Actions

新增工作流：

- `.github/workflows/eval-studio-test.yml`
  - TypeScript 检查
  - 前端构建
  - 服务端构建
  - PostgreSQL migration
  - API smoke test

- `.github/workflows/eval-studio-build.yml`
  - 登录阿里云 ACR
  - 构建 Docker 镜像
  - 推送镜像 tag：`github.sha`

- `.github/workflows/eval-studio-deploy.yml`
  - 设置 ACK context
  - Kustomize 设置镜像
  - 删除旧 migration job
  - 应用 dev manifests
  - 等待 migration job 完成
  - 等待 Deployment rollout

- `.github/workflows/eval-studio-cicd.yml`
  - `main` push 后串联执行 test、build、deploy_dev

## GitHub Secrets

必须配置：

| Secret | 说明 |
| --- | --- |
| `ALIYUN_ACCESS_KEY_ID` | 阿里云 AK |
| `ALIYUN_ACCESS_KEY_SECRET` | 阿里云 SK |

可选配置：

| Secret | 说明 |
| --- | --- |
| `EVAL_STUDIO_DATABASE_URL_DEV` | dev PostgreSQL / PolarDB PostgreSQL 连接串 |
| `EVAL_STUDIO_JWT_SECRET_DEV` | dev 登录 JWT 签名密钥，建议使用长随机字符串 |
| `EVAL_STUDIO_FEISHU_APP_ID_DEV` | 飞书应用 App ID |
| `EVAL_STUDIO_FEISHU_APP_SECRET_DEV` | 飞书应用 App Secret |
| `EVAL_STUDIO_FEISHU_REDIRECT_URI_DEV` | 飞书 OAuth 回调地址，例如 `https://<dev-domain>/feishu-callback` |
| `FEISHU_WEBHOOK_URL` | 飞书通知 webhook |

## 飞书登录配置

dev 镜像构建时会固定启用飞书认证：

```text
VITE_AUTH_MODE=feishu
```

API Pod 运行时会使用：

```text
AUTH_MODE=feishu
FEISHU_APP_ID
FEISHU_APP_SECRET
FEISHU_REDIRECT_URI
JWT_SECRET
```

这些值由 GitHub Actions Secret 注入，不需要手动进入 ACK 配置 Kubernetes Secret。

飞书开放平台里需要把回调地址配置为 `EVAL_STUDIO_FEISHU_REDIRECT_URI_DEV` 的值，例如：

```text
https://<dev-domain>/feishu-callback
```

如果 dev 暂时还没有外部访问域名，需要先接入 Ingress/网关后再配置飞书回调。飞书 OAuth 回调必须是浏览器可以访问到的前端地址。

## GitHub Variables

dev 部署已按 `vidmuse-admin` 的方式在 workflow 内固定 ACK 集群和命名空间：

| 配置 | 当前值 |
| --- | --- |
| ACK 集群 ID | `c8537cc4bdbe246968912d1aaefa38832` |
| ACK 命名空间 | `default` |
| Region | `cn-hongkong` |

可选配置：

| Variable | 默认值 | 说明 |
| --- | --- | --- |
| `ACR_EE_REGISTRY` | `sandai-registry.cn-hongkong.cr.aliyuncs.com` | ACR registry |
| `ACR_EE_INSTANCE_ID` | `cri-ygtpwto064tjuv5o` | ACR 企业版实例 ID |
| `ACR_EE_NAMESPACE` | `vidmuse` | ACR namespace |
| `EVAL_STUDIO_IMAGE` | `eval-studio` | 镜像名 |
| `EVAL_STUDIO_PUBLIC_API_BASE_URL` | 空 | 生产默认同源，通常不需要设置 |

## Dev 数据库配置

dev 数据库连接串不需要手动进入 ACK 创建 Kubernetes Secret。当前 workflow 会从 GitHub Actions Secret 读取 `EVAL_STUDIO_DATABASE_URL_DEV`，并在部署时注入到 Deployment 和 migration Job。

如果使用阿里云 PolarDB PostgreSQL，连接串示例：

```bash
postgresql://USER:PASSWORD@HOST:5432/DB_NAME
```

如 PolarDB PostgreSQL 要求 SSL，可以追加：

```bash
postgresql://USER:PASSWORD@HOST:5432/DB_NAME?sslmode=require
```

当前 dev 部署命名空间固定为 `default`。如后续要切换命名空间，需要同步修改 workflow 内的 `ACK_NAMESPACE`。

## Kubernetes 资源

部署清单位置：

- `deploy/base/deployment.yml`
- `deploy/base/service.yml`
- `deploy/base/migration-job.yml`
- `deploy/overlays/dev/kustomization.yml`

dev 部署包含：

- `eval-studio-deployment`
- `eval-studio-service`
- `eval-studio-migrate`

当前 service 是 `ClusterIP`，对外暴露可按集群现有网关/Ingress 规范另行接入。

## VidMuse 直连生成（dev）

当前 dev 部署使用 `GENERATION_ASSET_MODE=temporary_url`，无需等待 OSS 管理员配置即可执行生成。
该模式直接回填供应商临时链接、不支持本地素材上传，链接可能过期。切回持久化模式时，把配置
改为 `GENERATION_ASSET_MODE=oss`，并补齐下方最小权限 OSS RAM 配置。

dev 部署会同时启动 PostgreSQL 租约 Worker，直接读取 Aion 实时模型配置并调用图片/视频生成接口，不安装 VidMuse CLI，也不需要修改 Aion。

以下配置分为已自动完成项和管理员 OSS 必填项：

已自动完成：

- `EVAL_STUDIO_AION_MANAGER_BASE_URL_DEV` 已指向同集群 `default` namespace 的 `http://dev-vidmuse-manager-service:443`。
- `EVAL_STUDIO_AION_EVAL_USER_ID_DEV` 已配置为专用 VidMuse dev 评测账号。
- `EVAL_STUDIO_PUBLIC_BASE_URL_DEV` 为可选覆盖项；未配置时，workflow 会从现有 `EVAL_STUDIO_FEISHU_REDIRECT_URI_DEV` 去掉末尾 `/feishu-callback` 后得到公网基址。

以下 OSS GitHub Actions Secrets 在临时链接模式下为可选；切回持久化模式时必须由管理员提供：

| Secret | 说明 |
| --- | --- |
| `EVAL_STUDIO_OSS_ACCESS_KEY_ID_DEV` | 仅允许 dev bucket 指定前缀读写的 RAM AK |
| `EVAL_STUDIO_OSS_ACCESS_KEY_SECRET_DEV` | 上述 RAM SK |
| `EVAL_STUDIO_OSS_ENDPOINT_DEV` | OSS 上传/服务 endpoint |
| `EVAL_STUDIO_OSS_REGION_DEV` | OSS region，例如 `oss-cn-hongkong` |
| `EVAL_STUDIO_OSS_BUCKET_DEV` | dev 归档 bucket |

组织仓库中可以确认 `vidmuse-playground`、`athena-artifacts-dev` 等既有 bucket，但没有可证明适用于 ManuEval 的 RAM 权限、保留策略或 CORS 配置，因此不会自动复用，也不会使用 ACR/ACK 的高权限部署密钥代替。

OSS CORS 必须允许 ManuEval dev 域名执行 `PUT`、`GET`、`HEAD`，允许 `Content-Type` 请求头，并把 `ETag` 加入 exposed headers；否则大文件分片上传无法完成。

默认每批最多 500 个有效 case，图片并发 4、视频并发 2。任务状态和租约都保存在 PostgreSQL；滚动部署或进程重启后会继续轮询和归档。Aion POST 响应丢失时任务会进入 `submission_unknown`，不会自动重发。

完整接口和状态语义见 [generation-backend-contract.md](generation-backend-contract.md)。
### 临时链接模式验收

五个 `EVAL_STUDIO_OSS_*_DEV` Secret 在当前 `temporary_url` 模式下均为可选，可留空，不会阻塞 dev 部署。共享 dev 明确使用 `AION_EXECUTION_TRANSPORT=model_api`；本地无法访问 ClusterIP 时才使用 `task_worker` 兼容通路。

2026-08-01 已在 ManuEval 网页完成一条真实图片冒烟：`xai/grok-imagine-image`、`720p`、`1:1`，批次 `gen-97c0abef-5726-4a87-98c9-a09b94351444` 成功 1/1，数据集回填至 v4，结果通过 VidMuse dev CDN 以 1024x1024 图片正常预览。
