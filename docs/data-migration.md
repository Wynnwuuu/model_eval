# 数据迁移工具

目标：把旧的 localStorage/localPlatform 或 Firestore 导出数据迁移到本地/线上 PostgreSQL。

## 迁移命令

```bash
npm run migrate:postgres -- --source ./local-export.json --dry-run
npm run migrate:postgres -- --source ./local-export.json
```

可选参数：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--source` | 必填 | JSON 导出文件路径 |
| `--dry-run` | `false` | 只解析、计数和校验，不写数据库 |
| `--user-id` | `migration-user` | 迁移动作用户 |
| `--user-email` | `migration-user@local.eval` | 迁移动作用户邮箱 |
| `--user-name` | `Migration User` | 迁移动作用户名 |
| `--organization-id` | `default` | 目标组织 |

## localStorage 导出

在旧页面浏览器控制台执行：

```js
copy(localStorage.getItem('evaltrack_local_platform_v1'))
```

把复制内容保存为 `local-export.json`，再执行 dry-run：

```bash
npm run migrate:postgres -- --source ./local-export.json --dry-run
```

## Firestore 导出格式

迁移脚本不直接绑定 Firebase Admin 凭据。Firestore 可以先导出为同构 JSON：

```json
{
  "collections": {
    "projects": {
      "project-id": {}
    },
    "evalDatasets": {
      "dataset-id": {}
    },
    "evalTemplates": {
      "template-id": {}
    },
    "evalTasks": {
      "task-id": {}
    },
    "evalTasks/task-id/items": {
      "item-id": {}
    },
    "evalTasks/task-id/userVotes": {
      "user@example.com": {
        "votes": []
      }
    },
    "evalGenerationJobs": {
      "job-id": {}
    },
    "evalGenerationJobs/job-id/items": {
      "case-id": {}
    }
  }
}
```

localPlatform 的原始 `collections` 结构可直接使用。

## 当前覆盖范围

| 数据域 | 状态 |
| --- | --- |
| `projects` | 支持导入，已存在项目会更新 |
| `evalDatasets` | 支持导入，数据集 items 会写入当前版本 |
| `evalTemplates` | 支持导入 |
| `evalTasks` | 支持导入，任务 items 会随任务重写 |
| `evalTasks/{taskId}/userVotes` | 支持导入 |
| `evalGenerationJobs` | 支持导入 |
| `evalGenerationJobs/{jobId}/items` | 支持导入 |

## 验证步骤

1. `npm run db:up`
2. `npm run db:migrate`
3. `npm run migrate:postgres -- --source ./local-export.json --dry-run`
4. 确认输出的 source counts 和 warning。
5. `npm run migrate:postgres -- --source ./local-export.json`
6. `npm run test:api:smoke`
