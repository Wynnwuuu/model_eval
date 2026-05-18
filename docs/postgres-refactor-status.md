# PostgreSQL 重构状态

## 已完成

- HTTP/PostgreSQL 核心链路：projects、datasets、templates、tasks、votes、generation jobs。
- 本地一键启动：`npm run dev:full`。
- API smoke test：`npm run test:api:smoke`。
- 迁移系统标准化：`schema_migrations` + `npm run db:migrate`。
- API 错误结构统一：`{ error: { code, message, details? } }`。
- API 基础参数校验：项目、评测集、模板、任务、投票、生产任务的写接口。
- 用户与权限模型第一版：
  - HTTP 请求通过 `X-User-*` / `X-Organization-Id` 识别当前用户和组织。
  - 后端自动写入 `users`、`organizations`、`organization_members`。
  - 新建项目自动写入 `project_members.owner`。
  - 项目更新需要 `owner/editor`，项目删除需要 `owner`。
  - 前端 HTTP API 和 smoke test 已带用户身份头。
  - smoke test 已覆盖非项目成员更新项目返回 `403 FORBIDDEN`。
- 数据迁移工具第一版：
  - 新增 `npm run migrate:postgres`。
  - 支持 localStorage/localPlatform JSON 和 Firestore 同构 JSON。
  - 支持 dry-run 计数和基础 warning。
  - 覆盖项目、评测集、模板、任务、任务 items、投票、生产任务、生产任务 items。

## 进行中

- 权限模型深化：当前完成项目级写权限基础版；后续需要补项目成员管理接口/UI，以及数据集、模板、任务、投票、生产任务的项目归属权限收敛。
- API 参数校验和错误规范：已完成第一版轻量校验；后续可按接口补更细的字段枚举、长度限制和业务约束。

## 未完成

- 部署方案：阿里云 RDS/DMS、后端部署、生产环境变量、CI/CD。
- Firestore fallback 策略：明确长期保留还是逐步删除。

## 当前建议顺序

1. 部署方案。
2. 权限模型深化：成员管理、更多数据域鉴权。
3. Firestore fallback 决策与清理。
