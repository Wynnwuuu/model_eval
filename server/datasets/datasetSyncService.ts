import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import {
  buildDatasetVersionedSyncPlan,
  type DatasetVersionedSyncPlan,
} from '../../src/datasetVersionedSync.ts';
import type {
  DatasetColumnMappings,
  DatasetSyncOutputPolicy,
  DatasetSyncPreview,
  DatasetSyncSourceBinding,
  EvalDataset,
} from '../../src/types.ts';
import type { RequestUser } from '../auth/context.ts';
import { getFeishuTenantAccessToken } from '../auth/feishuOAuth.ts';
import { dbPool } from '../db/client.ts';
import { ApiError, badRequest, conflict, notFound } from '../http/errors.ts';
import { readFeishuBaseSnapshot } from './feishuBaseClient.ts';
import {
  getDataset,
  listDatasetHistoricalRows,
  saveDataset,
} from './datasetRepository.ts';

const PREVIEW_TTL_MS = 60 * 60 * 1000;
const MAX_SYNC_ROWS = 10_000;
const OUTPUT_POLICIES = new Set<DatasetSyncOutputPolicy>([
  'preserve_platform',
  'fill_platform_blanks',
  'source_overwrite',
]);

type ManualSource = {
  kind: 'manual';
  headers: string[];
  rows: Record<string, unknown>[];
  label?: string;
};

type FeishuSource = {
  kind: 'feishu_base';
  url: string;
};

export type DatasetSyncSourceRequest = ManualSource | FeishuSource;

interface DatasetSyncDecisions {
  outputPolicies: Record<string, DatasetSyncOutputPolicy>;
  newColumnRoles: Record<string, 'source' | 'output'>;
}

interface StoredPreviewRow {
  id: string;
  dataset_id: string;
  expected_version: number;
  source_kind: 'manual' | 'feishu_base';
  snapshot_hash: string;
  payload_json: {
    sourceRequest: DatasetSyncSourceRequest;
    headers: string[];
    rows: Record<string, unknown>[];
    sourceBinding: DatasetSyncSourceBinding;
  };
  decisions_json: DatasetSyncDecisions;
  result_json: DatasetSyncPreview;
  status: string;
  created_by: string | null;
  expires_at: Date;
}

const normalizeHeaders = (headers: unknown) => {
  if (!Array.isArray(headers) || !headers.length) throw badRequest('同步源必须包含列名。');
  const normalized = headers.map(header => String(header ?? ''));
  if (normalized.some(header => !header.trim())) throw badRequest('同步源包含空列名。');
  if (new Set(normalized).size !== normalized.length) throw badRequest('同步源包含重复列名。');
  if (normalized.some(header => header.startsWith('__'))) throw badRequest('以 __ 开头的列名由 ManuEval 保留，不能从同步源写入。');
  return normalized;
};

const normalizeRows = (headers: string[], rows: unknown) => {
  if (!Array.isArray(rows)) throw badRequest('同步源 rows 必须是对象数组。');
  if (rows.length > MAX_SYNC_ROWS) throw badRequest(`单次最多同步 ${MAX_SYNC_ROWS} 条 case。`);
  return rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw badRequest(`第 ${index + 1} 行不是有效对象。`);
    const record = row as Record<string, unknown>;
    return Object.fromEntries(headers.map(header => [
      header,
      Object.prototype.hasOwnProperty.call(record, header) ? record[header] : '',
    ]));
  });
};

const snapshotHash = (headers: string[], rows: Record<string, unknown>[]) => createHash('sha256')
  .update(JSON.stringify({ headers, rows }))
  .digest('hex');

const loadSourceSnapshot = async (source: DatasetSyncSourceRequest) => {
  if (!source || !['manual', 'feishu_base'].includes(source.kind)) {
    throw badRequest('同步来源必须是手动数据或飞书 Base。');
  }
  if (source.kind === 'manual') {
    const headers = normalizeHeaders(source.headers);
    const rows = normalizeRows(headers, source.rows);
    return {
      headers,
      rows,
      binding: {
        version: 1 as const,
        kind: 'manual' as const,
        sourceLabel: source.label?.trim() || '手动导入',
        columnOrder: headers,
        snapshotHash: snapshotHash(headers, rows),
        lastSyncedAt: Date.now(),
      },
    };
  }
  if (!source.url?.trim()) throw badRequest('请输入飞书多维表格链接。');
  const token = await getFeishuTenantAccessToken();
  const snapshot = await readFeishuBaseSnapshot({ sourceUrl: source.url.trim(), tenantAccessToken: token });
  const headers = normalizeHeaders(snapshot.headers);
  const rows = normalizeRows(headers, snapshot.rows);
  return {
    headers,
    rows,
    binding: {
      version: 1 as const,
      kind: 'feishu_base' as const,
      sourceUrl: source.url.trim(),
      sourceLabel: '飞书多维表格',
      tableId: snapshot.tableId,
      columnOrder: headers,
      snapshotHash: snapshotHash(headers, rows),
      lastSyncedAt: Date.now(),
    },
  };
};

const defaultDecisions = (dataset: EvalDataset, headers: string[]): DatasetSyncDecisions => {
  const knownColumns = new Set(dataset.inputSchema.map(field => field.key));
  const outputColumns = dataset.columnMappings?.outputColumns || [];
  return {
    outputPolicies: Object.fromEntries(outputColumns.map(column => [column, 'preserve_platform'])),
    newColumnRoles: Object.fromEntries(headers.filter(header => !knownColumns.has(header)).map(header => [header, 'source'])),
  };
};

const resolveOutputColumns = (dataset: EvalDataset, decisions: DatasetSyncDecisions) => [...new Set([
  ...(dataset.columnMappings?.outputColumns || []),
  ...Object.entries(decisions.newColumnRoles).filter(([, role]) => role === 'output').map(([column]) => column),
])];

const validationMessage = (issue: DatasetVersionedSyncPlan['issues'][number]) => issue.code === 'MISSING_CASE_ID_COLUMN'
  ? '同步源必须包含名称精确为 case_id 的列；平台不会自动修改飞书或文件列名。'
  : issue.code === 'MISSING_CASE_ID'
  ? `第 ${issue.rowIndexes.map(index => index + 1).join('、')} 行缺少 case_id。`
  : issue.code === 'DUPLICATE_CURRENT_CASE_IDENTITY'
    ? `当前评测集已存在重复的 case_id + variant_label：${issue.identity}（当前第 ${issue.rowIndexes.map(index => index + 1).join('、')} 行）。请先消除重复项再同步。`
  : `case_id + variant_label 重复：${issue.identity}（第 ${issue.rowIndexes.map(index => index + 1).join('、')} 行）。`;

const collectColumnReferences = (value: unknown, candidates: Set<string>, output: Set<string>) => {
  if (typeof value === 'string') {
    if (candidates.has(value)) output.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectColumnReferences(item, candidates, output));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(item => collectColumnReferences(item, candidates, output));
  }
};

type Queryable = Pick<PoolClient, 'query'>;

export const findDatasetSyncGenerationBlockers = async (
  queryable: Queryable,
  dataset: EvalDataset,
  plan: DatasetVersionedSyncPlan,
) => {
  const result = await queryable.query<{
    id: string;
    target_column: string;
    input_mapping_json: Record<string, unknown>;
    controls_json: Record<string, unknown>;
    stable_item_ids: string[] | null;
  }>(
    `
      SELECT job.id, job.target_column, job.input_mapping_json, job.controls_json,
             array_remove(array_agg(item.stable_dataset_item_id), NULL) AS stable_item_ids
      FROM generation_jobs job
      LEFT JOIN generation_job_items item ON item.job_id = job.id
      WHERE job.dataset_id = $1
        AND (
          job.status IN ('queued', 'running')
          OR job.writeback_status IN ('pending', 'running')
        )
      GROUP BY job.id
    `,
    [dataset.id],
  );
  if (!result.rows.length) return [];
  const candidateColumns = new Set(dataset.inputSchema.map(field => field.key));
  const changesByStableId = new Map(plan.cases.map(item => [item.stableItemId, item]));
  return result.rows.flatMap(job => {
    const dependencies = new Set<string>();
    collectColumnReferences(job.input_mapping_json, candidateColumns, dependencies);
    collectColumnReferences(job.controls_json, candidateColumns, dependencies);
    const caseIds: string[] = [];
    const reasons = new Set<string>();
    (job.stable_item_ids || []).forEach(stableItemId => {
      const change = changesByStableId.get(stableItemId);
      if (!change || change.action === 'unchanged' || change.action === 'added' || change.action === 'restored') return;
      if (change.action === 'deleted') {
        caseIds.push(change.caseId);
        reasons.add('运行中的生成 case 将被删除');
        return;
      }
      const changedFields = new Set(change.fieldChanges.map(field => field.field));
      if (changedFields.has(job.target_column)) {
        caseIds.push(change.caseId);
        reasons.add(`运行批次的目标结果列 ${job.target_column} 将被修改`);
      }
      const changedInputs = [...dependencies].filter(column => changedFields.has(column));
      if (changedInputs.length) {
        caseIds.push(change.caseId);
        reasons.add(`运行批次使用的输入列将被修改：${changedInputs.join('、')}`);
      }
    });
    return caseIds.length ? [{ jobId: job.id, caseIds: [...new Set(caseIds)], reasons: [...reasons] }] : [];
  });
};

const buildPreview = async (input: {
  id: string;
  dataset: EvalDataset;
  headers: string[];
  rows: Record<string, unknown>[];
  binding: DatasetSyncSourceBinding;
  decisions: DatasetSyncDecisions;
  createdAt: number;
  expiresAt: number;
}) => {
  const historicalRows = await listDatasetHistoricalRows(input.dataset.id);
  const outputColumns = resolveOutputColumns(input.dataset, input.decisions);
  const plan = buildDatasetVersionedSyncPlan({
    dataset: input.dataset,
    sourceHeaders: input.headers,
    sourceRows: input.rows,
    historicalRows,
    outputColumns,
    outputPolicies: input.decisions.outputPolicies,
  });
  const blockers = plan.valid
    ? await findDatasetSyncGenerationBlockers(dbPool, input.dataset, plan)
    : [];
  const preview: DatasetSyncPreview = {
    id: input.id,
    datasetId: input.dataset.id,
    expectedVersion: input.dataset.version || 1,
    source: input.binding,
    sourceHeaders: input.headers,
    outputColumns,
    outputPolicies: Object.fromEntries(outputColumns.map(column => [column, input.decisions.outputPolicies[column] || 'preserve_platform'])),
    newColumnRoles: input.decisions.newColumnRoles,
    summary: plan.summary,
    cases: plan.cases,
    blockers,
    validationIssues: plan.issues.map(issue => ({ code: issue.code, message: validationMessage(issue), rowIndexes: issue.rowIndexes })),
    requiresOverwriteConfirmation: outputColumns.some(column => input.decisions.outputPolicies[column] === 'source_overwrite'),
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
  };
  return { preview, plan };
};

const savePreview = async (input: {
  preview: DatasetSyncPreview;
  sourceRequest: DatasetSyncSourceRequest;
  headers: string[];
  rows: Record<string, unknown>[];
  decisions: DatasetSyncDecisions;
  userId: string;
}) => {
  await dbPool.query(
    `
      INSERT INTO dataset_sync_previews (
        id, dataset_id, expected_version, source_kind, snapshot_hash,
        payload_json, decisions_json, result_json, created_by, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, to_timestamp($10 / 1000.0))
      ON CONFLICT (id) DO UPDATE SET
        decisions_json = EXCLUDED.decisions_json,
        result_json = EXCLUDED.result_json,
        updated_at = now()
    `,
    [
      input.preview.id,
      input.preview.datasetId,
      input.preview.expectedVersion,
      input.preview.source.kind,
      input.preview.source.snapshotHash,
      JSON.stringify({
        sourceRequest: input.sourceRequest,
        headers: input.headers,
        rows: input.rows,
        sourceBinding: input.preview.source,
      }),
      JSON.stringify(input.decisions),
      JSON.stringify(input.preview),
      input.userId,
      input.preview.expiresAt,
    ],
  );
};

const getStoredPreview = async (previewId: string, user: RequestUser) => {
  const result = await dbPool.query<StoredPreviewRow>(
    `
      SELECT * FROM dataset_sync_previews
      WHERE id = $1 AND status = 'ready' AND expires_at > now()
    `,
    [previewId],
  );
  const row = result.rows[0];
  if (!row) throw notFound('Dataset sync preview');
  if (row.created_by && row.created_by !== user.id) throw new ApiError(403, 'FORBIDDEN', '不能使用其他用户创建的同步预览。');
  return row;
};

export const createDatasetSyncPreview = async (
  datasetId: string,
  expectedVersion: number,
  sourceRequest: DatasetSyncSourceRequest,
  user: RequestUser,
) => {
  const dataset = await getDataset(datasetId);
  if (!dataset) throw notFound('Dataset');
  if ((dataset.version || 1) !== expectedVersion) throw conflict('评测集版本已变化，请刷新后重试。', {
    expectedVersion,
    currentVersion: dataset.version || 1,
  });
  const source = await loadSourceSnapshot(sourceRequest);
  const decisions = defaultDecisions(dataset, source.headers);
  const id = `ds-sync-${randomUUID()}`;
  const createdAt = Date.now();
  const expiresAt = createdAt + PREVIEW_TTL_MS;
  const { preview } = await buildPreview({ id, dataset, ...source, decisions, createdAt, expiresAt });
  await savePreview({ preview, sourceRequest, headers: source.headers, rows: source.rows, decisions, userId: user.id });
  return preview;
};

export const updateDatasetSyncPreview = async (
  previewId: string,
  patch: Partial<DatasetSyncDecisions>,
  user: RequestUser,
) => {
  const stored = await getStoredPreview(previewId, user);
  const dataset = await getDataset(stored.dataset_id);
  if (!dataset) throw notFound('Dataset');
  if ((dataset.version || 1) !== stored.expected_version) throw conflict('评测集版本已变化，请重新创建同步预览。');
  const headers = stored.payload_json.headers;
  const knownColumns = new Set(dataset.inputSchema.map(field => field.key));
  const newColumnRoles = { ...stored.decisions_json.newColumnRoles };
  Object.entries(patch.newColumnRoles || {}).forEach(([column, role]) => {
    if (!headers.includes(column) || knownColumns.has(column) || !['source', 'output'].includes(role)) {
      throw badRequest(`无效的新列角色：${column}`);
    }
    newColumnRoles[column] = role;
  });
  const outputPolicies = { ...stored.decisions_json.outputPolicies };
  Object.entries(patch.outputPolicies || {}).forEach(([column, policy]) => {
    if (!headers.includes(column) && !(dataset.columnMappings?.outputColumns || []).includes(column)) {
      throw badRequest(`未知结果列：${column}`);
    }
    if (!OUTPUT_POLICIES.has(policy)) throw badRequest(`无效的结果保留策略：${column}`);
    outputPolicies[column] = policy;
  });
  const decisions = { outputPolicies, newColumnRoles };
  const { preview } = await buildPreview({
    id: stored.id,
    dataset,
    headers,
    rows: stored.payload_json.rows,
    binding: stored.payload_json.sourceBinding,
    decisions,
    createdAt: stored.result_json.createdAt,
    expiresAt: stored.result_json.expiresAt,
  });
  await savePreview({
    preview,
    sourceRequest: stored.payload_json.sourceRequest,
    headers,
    rows: stored.payload_json.rows,
    decisions,
    userId: user.id,
  });
  return preview;
};

const nextMappings = (dataset: EvalDataset, plan: DatasetVersionedSyncPlan): DatasetColumnMappings => {
  const available = new Set(plan.schema.map(field => field.key));
  const standard = Object.fromEntries(Object.entries(dataset.columnMappings?.standard || {}).filter(([, column]) => available.has(column)));
  ['case_id', 'prompt', 'image_urls', 'images', 'elements', 'audio_url', 'audios', 'duration', 'aspect_ratio', 'resolution', 'generate_audio']
    .forEach(column => {
      if (available.has(column)) standard[column] = column;
    });
  return {
    caseId: 'case_id',
    inputColumns: plan.schema.filter(field => field.role === 'input').map(field => field.key),
    outputColumns: plan.outputColumns,
    dimensionColumns: plan.schema.filter(field => field.role === 'dimension').map(field => field.key),
    referenceColumns: plan.schema.filter(field => field.role === 'reference' || field.role === 'media').map(field => field.key),
    standard,
  };
};

const nextDatasetCard = (
  dataset: EvalDataset,
  rows: Record<string, unknown>[],
  mappings: DatasetColumnMappings,
  latestChange: string,
  updatedAt: number,
) => {
  const tagDistribution: Record<string, number> = {};
  const tagColumn = mappings.standard.tags;
  rows.forEach(row => {
    const value = tagColumn ? row[tagColumn] : undefined;
    const tags = Array.isArray(value)
      ? value.map(item => String(item).trim()).filter(Boolean)
      : String(value ?? '').split(/[,，;；\n|]/).map(item => item.trim()).filter(Boolean);
    tags.forEach(tag => { tagDistribution[tag] = (tagDistribution[tag] || 0) + 1; });
  });
  (dataset.tags || []).forEach(tag => { if (!(tag in tagDistribution)) tagDistribution[tag] = 0; });
  const dimensionDistribution = Object.fromEntries(mappings.dimensionColumns.map(column => {
    const counts: Record<string, number> = {};
    rows.forEach(row => {
      const value = String(row[column] ?? '').trim();
      if (value) counts[value] = (counts[value] || 0) + 1;
    });
    return [column, counts];
  }));
  return {
    applicableTasks: dataset.datasetCard?.applicableTasks || [],
    applicableStages: dataset.datasetCard?.applicableStages || [],
    source: dataset.datasetCard?.source || '',
    sampleSize: rows.length,
    modality: dataset.datasetCard?.modality || dataset.modality || 'other' as const,
    tagDistribution,
    dimensionDistribution,
    rubricBinding: dataset.datasetCard?.rubricBinding || '',
    coverageGaps: dataset.datasetCard?.coverageGaps || [],
    latestChange,
    updatedAt,
  };
};

export const applyDatasetSyncPreview = async (
  previewId: string,
  input: { confirmSourceOverwrite?: boolean },
  user: RequestUser,
) => {
  const stored = await getStoredPreview(previewId, user);
  const dataset = await getDataset(stored.dataset_id);
  if (!dataset) throw notFound('Dataset');
  if ((dataset.version || 1) !== stored.expected_version) throw conflict('评测集版本已变化，请重新创建同步预览。');

  let headers = stored.payload_json.headers;
  let rows = stored.payload_json.rows;
  let binding = stored.payload_json.sourceBinding;
  if (stored.source_kind === 'feishu_base') {
    const refreshed = await loadSourceSnapshot(stored.payload_json.sourceRequest);
    if (refreshed.binding.snapshotHash !== stored.snapshot_hash) {
      throw new ApiError(409, 'DATASET_SYNC_SOURCE_CHANGED', '飞书 Base 已在预览后发生变化，请重新预览。');
    }
    headers = refreshed.headers;
    rows = refreshed.rows;
    binding = refreshed.binding;
  }
  const historicalRows = await listDatasetHistoricalRows(dataset.id);
  const outputColumns = resolveOutputColumns(dataset, stored.decisions_json);
  const plan = buildDatasetVersionedSyncPlan({
    dataset,
    sourceHeaders: headers,
    sourceRows: rows,
    historicalRows,
    outputColumns,
    outputPolicies: stored.decisions_json.outputPolicies,
  });
  if (!plan.valid) throw new ApiError(422, 'DATASET_SYNC_INVALID_SOURCE', '同步源校验失败，请重新预览。', plan.issues);
  if (outputColumns.some(column => stored.decisions_json.outputPolicies[column] === 'source_overwrite') && !input.confirmSourceOverwrite) {
    throw badRequest('源表覆盖平台结果需要二次确认。');
  }
  const blockers = await findDatasetSyncGenerationBlockers(dbPool, dataset, plan);
  if (blockers.length) throw new ApiError(409, 'DATASET_SYNC_GENERATION_BLOCKED', '运行中的生成任务使用了将被修改的 case 或字段。', blockers);

  const now = Date.now();
  const version = (dataset.version || 1) + 1;
  const changeSummary = `同步评测集：新增 ${plan.summary.added}，更新 ${plan.summary.updated}，删除 ${plan.summary.deleted}，恢复 ${plan.summary.restored}`;
  const mappings = nextMappings(dataset, plan);
  const next: EvalDataset = {
    ...dataset,
    items: plan.rows,
    inputSchema: plan.schema,
    columnMappings: mappings,
    syncSource: { ...binding, lastSyncedAt: now },
    version,
    versionHistory: [
      ...(dataset.versionHistory || []),
      {
        version,
        changedAt: now,
        changedBy: user.displayName || user.email || user.id,
        changeSummary,
        itemCountBefore: dataset.items.length,
        itemCountAfter: plan.rows.length,
      },
    ],
    datasetCard: nextDatasetCard(dataset, plan.rows, mappings, changeSummary, now),
    updatedAt: now,
  };
  const saved = await saveDataset(next, user.id, {
    expectedVersion: stored.expected_version,
    forcePropagation: true,
    beforePersist: async client => {
      const lockedBlockers = await findDatasetSyncGenerationBlockers(client, dataset, plan);
      if (lockedBlockers.length) {
        throw new ApiError(409, 'DATASET_SYNC_GENERATION_BLOCKED', '运行中的生成任务使用了将被修改的 case 或字段。', lockedBlockers);
      }
    },
  });
  await dbPool.query(
    `UPDATE dataset_sync_previews SET status = 'applied', updated_at = now() WHERE id = $1`,
    [previewId],
  );
  return saved;
};
