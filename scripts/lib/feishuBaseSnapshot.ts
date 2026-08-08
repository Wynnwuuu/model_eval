import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import type { FeishuBaseSnapshot } from '../../src/features/datasets/preservedSourceImport.ts';

type LarkEnvelope<T> = {
  ok: boolean;
  data: T;
};

type ResolvedBaseUrl = {
  base_token: string;
  table_id: string;
  view_id: string;
};

type RecordListPage = {
  data: unknown[][];
  fields: string[];
  field_id_list: string[];
  field_type_list: string[];
  record_id_list: string[];
  has_more: boolean;
};

const cliInvocation = (args: string[]) => {
  if (process.platform !== 'win32') return { command: 'lark-cli', args };
  const appData = process.env.APPDATA;
  if (!appData) throw new Error('APPDATA is required to locate lark-cli on Windows.');
  return {
    command: 'powershell.exe',
    args: [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(appData, 'npm', 'lark-cli.ps1'),
      ...args,
    ],
  };
};

const runLarkJson = <T>(args: string[]): T => {
  const invocation = cliInvocation(args);
  const output = execFileSync(invocation.command, invocation.args, {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  });
  const envelope = JSON.parse(output) as LarkEnvelope<T>;
  if (!envelope.ok) throw new Error(`lark-cli failed: ${output}`);
  return envelope.data;
};

const snapshotDigest = (snapshot: Omit<FeishuBaseSnapshot, 'snapshotHash' | 'fetchedAt'>) =>
  `sha256:${createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')}`;

export const fetchFeishuBaseSnapshot = (sourceUrl: string): FeishuBaseSnapshot => {
  const resolved = runLarkJson<ResolvedBaseUrl>([
    'base', '+url-resolve', '--url', sourceUrl, '--as', 'user',
  ]);
  if (!resolved.base_token || !resolved.table_id || !resolved.view_id) {
    throw new Error('The Feishu Base URL did not resolve to a base, table, and view.');
  }

  const records: FeishuBaseSnapshot['records'] = [];
  let offset = 0;
  let fields: string[] = [];
  let fieldIds: string[] = [];
  let fieldTypes: string[] = [];
  while (true) {
    const page = runLarkJson<RecordListPage>([
      'base', '+record-list',
      '--base-token', resolved.base_token,
      '--table-id', resolved.table_id,
      '--view-id', resolved.view_id,
      '--offset', String(offset),
      '--limit', '200',
      '--format', 'json',
      '--as', 'user',
    ]);
    if (!fields.length) {
      fields = page.fields;
      fieldIds = page.field_id_list;
      fieldTypes = page.field_type_list;
    } else if (JSON.stringify(fields) !== JSON.stringify(page.fields)
      || JSON.stringify(fieldIds) !== JSON.stringify(page.field_id_list)
      || JSON.stringify(fieldTypes) !== JSON.stringify(page.field_type_list)) {
      throw new Error('The Feishu Base visible schema changed during pagination.');
    }
    if (page.data.length !== page.record_id_list.length) {
      throw new Error(`Record values and record IDs are misaligned at offset ${offset}.`);
    }
    page.data.forEach((values, index) => records.push({
      recordId: page.record_id_list[index],
      values,
    }));
    offset += page.data.length;
    if (!page.has_more) break;
    if (!page.data.length) throw new Error('Feishu pagination returned has_more=true with an empty page.');
  }

  const digestInput = {
    sourceUrl,
    baseToken: resolved.base_token,
    tableId: resolved.table_id,
    viewId: resolved.view_id,
    fields,
    fieldIds,
    fieldTypes,
    records,
  };
  return {
    ...digestInput,
    fetchedAt: new Date().toISOString(),
    snapshotHash: snapshotDigest(digestInput),
  };
};
