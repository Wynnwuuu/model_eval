# ManuEval 评测集直接导入

## 目标与边界

“直接导入”是新建评测集的默认方式。它把来源表的每个业务列按原始列名、顺序和值保存为评测集根级列，不把未知列丢进 `_originalData`，也不重命名成旧中文标准字段。

旧“兼容字段映射”仍可显式选择，继续支持标准字段映射、自定义字段、结果列添加和字段重命名。向已有评测集追加内容仍使用兼容流程；结构化版本维护继续使用“同步更新”。

## 支持的来源

- 飞书多维表格 Base：仅 ManuEval dev 服务模式可用。服务端读取链接中的 `table` 对应整张表，忽略 `view` 筛选。
- CSV、TSV、TXT、JSON 文件。
- 粘贴的 CSV、TSV、飞书表格或 JSON。

JSON 可以是对象数组，也可以是 `{ "items": [...] }`。CSV/TSV 不裁剪单元格值；空表头、重复表头、额外无表头单元格、超过 10,000 行及 `__` 前缀列会阻断。飞书富文本、链接、多选和数组沿用 Base 客户端的规范化规则，并保持数组顺序。

飞书来源只用于本次读取。创建的数据集不保存 Base URL、app token、table ID 或 `syncSource`，也不回写飞书。

## 预览与应用

直接导入采用两阶段接口：

1. `POST /api/datasets/import-previews` 读取来源并返回完整表头、数据行、快照哈希、列用途、身份模式、警告和阻断问题。
2. 用户确认全部 `N/N` 列，并可勾选已有模型结果列。所有列始终导入；复选框只改变列在 ManuEval 中的结果角色和预览类型。
3. `POST /api/datasets/imports` 重新读取来源并比较快照哈希，再原子创建评测集。
4. 来源在预览后变化时返回 `DATASET_IMPORT_SOURCE_CHANGED`，要求重新预览。

结果列必须来自当前源表。`case_id`、`variant_label` 等身份列以及 `__` 保留列不能标记为结果。结果列顺序始终遵循源表顺序，不受勾选先后影响。

## 列用途

共享编译器只对精确列名添加内部用途，不做模糊语义猜测：

- 身份：`case_id`、`variant_label`。
- 生成内容：`prompt`、`full_prompt`、`zh_prompt`、`lyrics_or_dialogue`。
- 参考素材：`image_urls`、`images`、`elements`、`audio_url`、`audios` 及明确的参考/首尾帧列。
- 生成参数：`duration`、`aspect_ratio`、`resolution`、`generate_audio`、`negative_prompt`。
- 评测字段：`cell_id`、`effects`、`intent`、`eval_dimension`、Rubric 和证据相关字段。
- 其他列：普通元数据。

这些标注写入同名 `inputSchema` 和 `columnMappings.standard`，因此后续生成流程可以继续按精确 MCP 字段读取 `prompt`、`elements`、`duration` 等列。业务值本身不会被转换。

## Case 身份

- 来源包含精确 `case_id` 时，使用 `case_id + variant_label` 作为业务身份。`case_id` 不得为空，组合不得重复。
- 来源没有 `case_id` 时允许创建，平台只生成隐藏 `__datasetItemId`，不增加可见业务列。
- 无 `case_id` 的直接导入集记录 `importMetadata.identityMode=internal`，前端和服务端都禁止其进入版本化同步。补充精确 `case_id` 后应重新直接导入。
- 直接导入的副本继承该身份模式，避免副本绕过同步限制。

## 存储与兼容

直接导入使用现有数据集、版本和 JSONB manifest，不新增数据库迁移。`importMetadata` 随版本快照和副本保存。Worker、生成回填、人工评测、Arena 和历史版本结构不变。

历史评测集、历史预检和兼容字段映射仍按原合同执行；新默认只影响“新建/导入评测集”。

