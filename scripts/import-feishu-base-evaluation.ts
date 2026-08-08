import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildPreservedEvaluationDataset,
  verifyPreservedEvaluationDataset,
} from '../src/features/datasets/preservedSourceImport.ts';
import { fetchFeishuBaseSnapshot } from './lib/feishuBaseSnapshot.ts';

const option = (name: string, fallback = '') => {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length) || fallback;
};

const sourceUrl = option('source-url');
const expectedCount = Number(option('expected-count', '188'));
const datasetName = option('dataset-name', 'VidMuse 效果模型结构化评测集 / cases / Grid View');
if (!sourceUrl) throw new Error('Use --source-url=<Feishu Base URL>.');
if (!Number.isInteger(expectedCount) || expectedCount < 1) throw new Error('--expected-count must be a positive integer.');

const first = fetchFeishuBaseSnapshot(sourceUrl);
const second = fetchFeishuBaseSnapshot(sourceUrl);
if (first.snapshotHash !== second.snapshotHash) {
  throw new Error(`The source Base changed during import (${first.snapshotHash} -> ${second.snapshotHash}). Run the import again.`);
}
if (second.records.length !== expectedCount) {
  throw new Error(`Expected ${expectedCount} source records, received ${second.records.length}.`);
}

const shortHash = second.snapshotHash.replace(/^sha256:/, '').slice(0, 12);
const datasetId = option('dataset-id', `ds-vidmuse-base-${shortHash}`);
const outputDir = resolve(option('output-dir', `task_state/base-audit/${shortHash}`));
const dataset = buildPreservedEvaluationDataset(second, {
  id: datasetId,
  name: datasetName,
  description: [
    '从领导维护的飞书 Base cases / Grid View 精确保真导入。',
    '16 个可见字段保持原名与原顺序；只解码飞书传输层单选数组和 Markdown URL 包装。',
    `来源快照：${second.snapshotHash}`,
  ].join('\n'),
  now: Date.parse(second.fetchedAt),
});
const verification = verifyPreservedEvaluationDataset(second, dataset);
if (!verification.ok) throw new Error(`Preserved import verification failed:\n${verification.errors.join('\n')}`);

mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, 'source-snapshot.json'), `${JSON.stringify(second, null, 2)}\n`, 'utf8');
writeFileSync(resolve(outputDir, 'dataset-import.json'), `${JSON.stringify({
  importMode: 'preserve_source_schema_v1',
  dataset,
  verification: {
    sourceSnapshotHash: second.snapshotHash,
    ...verification,
  },
}, null, 2)}\n`, 'utf8');
writeFileSync(resolve(outputDir, 'import-verification.json'), `${JSON.stringify({
  sourceUrl,
  sourceSnapshotHash: second.snapshotHash,
  firstFetchAt: first.fetchedAt,
  secondFetchAt: second.fetchedAt,
  datasetId,
  datasetName,
  ...verification,
}, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  datasetId,
  datasetName,
  sourceSnapshotHash: second.snapshotHash,
  recordCount: second.records.length,
  visibleColumns: second.fields,
  transportNormalizations: verification.transportNormalizations,
  outputDir,
  files: ['source-snapshot.json', 'dataset-import.json', 'import-verification.json'],
}, null, 2));
