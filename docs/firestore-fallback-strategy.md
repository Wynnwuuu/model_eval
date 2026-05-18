# Firestore Fallback 策略

推荐默认模式：

```env
VITE_USE_API_BACKEND=true
VITE_API_BASE_URL=https://<api-domain>
```

在该模式下，已迁移的数据域走：

```text
前端 -> features/*/api.ts -> HTTP API -> PostgreSQL
```

## 数据域边界

| 数据域 | PostgreSQL 模式 | Fallback 模式 |
| --- | --- | --- |
| 项目 `projects` | HTTP API | Firestore/localStorage |
| 评测集 `evalDatasets` | HTTP API | Firestore/localStorage |
| Rubric 模板 `evalTemplates` | HTTP API | Firestore/localStorage |
| 评测任务 `evalTasks` | HTTP API | Firestore/localStorage |
| 任务 items | HTTP API | Firestore/localStorage |
| 投票/进度 | HTTP API | Firestore/localStorage |
| 生产任务 `evalGenerationJobs` | HTTP API | Firestore/localStorage |
| 用户列表等辅助数据 | 仍可能读取当前 Firebase/localPlatform | 当前 Firebase/localPlatform |

## 开关语义

| 开关 | 作用 |
| --- | --- |
| `VITE_USE_API_BACKEND=true` | 业务数据使用 HTTP/PostgreSQL |
| `VITE_API_BASE_URL` | HTTP API 地址 |
| `VITE_USE_FIREBASE=true` | 使用 Firebase Auth/Firestore 作为 auth 与 fallback 数据源 |
| `VITE_USE_FIREBASE=false` | 使用 localStorage localPlatform 作为 auth 与 fallback 数据源 |

`VITE_USE_API_BACKEND=true` 时，业务数据以 PostgreSQL 为准；Firestore/localStorage 只作为未迁移辅助数据和本地/demo fallback。

## 建议

- 标准协作环境固定开启 `VITE_USE_API_BACKEND=true`。
- demo/offline 环境可以关闭 `VITE_USE_API_BACKEND`，继续使用 localStorage。
- 不建议同一批用户在同一环境里频繁切换 PostgreSQL 与 Firestore 写入路径，否则会产生双写不一致。
- 如果确认线上全面切 PostgreSQL，后续清理顺序应为：
  1. 补齐用户/成员管理 API。
  2. 清理页面中对 Firestore 用户列表等辅助数据的直接读取。
  3. 删除业务数据域的 Firestore 写路径。
  4. 保留 localStorage demo 模式或单独拆成 mock provider。
