import { createHash } from 'node:crypto';

import type { DatasetSyncSourceBinding } from '../../src/types.ts';
import { getFeishuTenantAccessToken } from '../auth/feishuOAuth.ts';
import { badRequest } from '../http/errors.ts';
import { readFeishuBaseSnapshot } from './feishuBaseClient.ts';

export const MAX_DATASET_SOURCE_ROWS = 10_000;

export type ManualDatasetSourceRequest = {
  kind: 'manual';
  headers: string[];
  rows: Record<string, unknown>[];
  label?: string;
};

export type FeishuDatasetSourceRequest = {
  kind: 'feishu_base';
  url: string;
};

export type DatasetSourceRequest = ManualDatasetSourceRequest | FeishuDatasetSourceRequest;

export interface LoadedDatasetSourceSnapshot {
  headers: string[];
  rows: Record<string, unknown>[];
  binding: DatasetSyncSourceBinding;
}

export const normalizeDatasetSourceHeaders = (headers: unknown) => {
  if (!Array.isArray(headers) || !headers.length) throw badRequest('数据源必须包含列名。');
  const normalized = headers.map(header => String(header ?? ''));
  if (normalized.some(header => !header.trim())) throw badRequest('数据源包含空列名。');
  if (new Set(normalized).size !== normalized.length) throw badRequest('数据源包含重复列名。');
  if (normalized.some(header => header.startsWith('__'))) {
    throw badRequest('以 __ 开头的列名由 ManuEval 保留，不能从数据源写入。');
  }
  return normalized;
};

export const normalizeDatasetSourceRows = (headers: string[], rows: unknown) => {
  if (!Array.isArray(rows)) throw badRequest('数据源 rows 必须是对象数组。');
  if (rows.length > MAX_DATASET_SOURCE_ROWS) throw badRequest(`单次最多读取 ${MAX_DATASET_SOURCE_ROWS} 条 case。`);
  return rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw badRequest(`第 ${index + 1} 行不是有效对象。`);
    const record = row as Record<string, unknown>;
    return Object.fromEntries(headers.map(header => [
      header,
      Object.prototype.hasOwnProperty.call(record, header) ? record[header] : '',
    ]));
  });
};

export const hashDatasetSourceSnapshot = (headers: string[], rows: Record<string, unknown>[]) => createHash('sha256')
  .update(JSON.stringify({ headers, rows }))
  .digest('hex');

export const loadDatasetSourceSnapshot = async (
  source: DatasetSourceRequest,
  dependencies: {
    getTenantAccessToken?: typeof getFeishuTenantAccessToken;
    readFeishuSnapshot?: typeof readFeishuBaseSnapshot;
  } = {},
): Promise<LoadedDatasetSourceSnapshot> => {
  if (!source || !['manual', 'feishu_base'].includes(source.kind)) {
    throw badRequest('数据源必须是手动数据或飞书 Base。');
  }
  if (source.kind === 'manual') {
    const headers = normalizeDatasetSourceHeaders(source.headers);
    const rows = normalizeDatasetSourceRows(headers, source.rows);
    return {
      headers,
      rows,
      binding: {
        version: 1,
        kind: 'manual',
        sourceLabel: source.label?.trim() || '手动导入',
        columnOrder: headers,
        snapshotHash: hashDatasetSourceSnapshot(headers, rows),
        lastSyncedAt: Date.now(),
      },
    };
  }

  if (!source.url?.trim()) throw badRequest('请输入飞书多维表格链接。');
  const token = await (dependencies.getTenantAccessToken || getFeishuTenantAccessToken)();
  const snapshot = await (dependencies.readFeishuSnapshot || readFeishuBaseSnapshot)({
    sourceUrl: source.url.trim(),
    tenantAccessToken: token,
  });
  const headers = normalizeDatasetSourceHeaders(snapshot.headers);
  const rows = normalizeDatasetSourceRows(headers, snapshot.rows);
  return {
    headers,
    rows,
    binding: {
      version: 1,
      kind: 'feishu_base',
      sourceUrl: source.url.trim(),
      sourceLabel: '飞书多维表格',
      tableId: snapshot.tableId,
      columnOrder: headers,
      snapshotHash: hashDatasetSourceSnapshot(headers, rows),
      lastSyncedAt: Date.now(),
    },
  };
};

