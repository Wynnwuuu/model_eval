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
| `FEISHU_WEBHOOK_URL` | 飞书通知 webhook |

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
