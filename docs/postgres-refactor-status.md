# PostgreSQL 重构状态

## 已完成

- HTTP/PostgreSQL 核心链路：projects、datasets、templates、tasks、votes、generation jobs。
- 本地一键启动：`npm run dev:full`。
- API smoke test：`npm run test:api:smoke`。
- 迁移系统标准化：`schema_migrations` + `npm run db:migrate`。
- API 错误结构统一：`{ error: { code, message, details? } }`。
- API 基础参数校验：项目、评测集、模板、任务、投票、生产任务的写接口。

## 进行中

- API 参数校验和错误规范：已完成第一版轻量校验；后续可按接口补更细的字段枚举、长度限制和业务约束。

## 未完成

- 用户与权限模型：认证中间件、组织成员、项目成员、角色权限。
- 数据迁移工具：Firestore/localStorage 导出、PostgreSQL 导入、dry-run、数据校验。
- 部署方案：阿里云 RDS/DMS、后端部署、生产环境变量、CI/CD。
- Firestore fallback 策略：明确长期保留还是逐步删除。

## 当前建议顺序

1. 用户与权限模型。
2. 数据迁移工具。
3. 部署方案。
4. Firestore fallback 决策与清理。
