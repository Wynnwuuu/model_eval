import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  parseAuditedEvaluationImportEnvelope,
  parsePreservedEvaluationImportEnvelope,
} from '../src/features/datasets/preservedSourceImport.ts';
import type { EvalDataset } from '../src/types.ts';

const option = (name: string, fallback = '') => {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length) || fallback;
};

const sourceFile = option('source-file');
const auditFile = option('audit-file');
const baseUrl = new URL(option('base-url', 'http://localhost:8787'));
if (!sourceFile || !auditFile) {
  throw new Error('Use --source-file=<dataset-import.json> --audit-file=<audit-dataset.json>.');
}
if (!['localhost', '127.0.0.1', '::1'].includes(baseUrl.hostname)) {
  throw new Error('Dataset publication is restricted to a loopback ManuEval dev API.');
}

const sourceEnvelope = parsePreservedEvaluationImportEnvelope(readFileSync(resolve(sourceFile), 'utf8'));
if (!sourceEnvelope || !sourceEnvelope.verification.ok) {
  throw new Error('The source artifact is not a verified preserved-source import.');
}
const auditArtifact = parseAuditedEvaluationImportEnvelope(readFileSync(resolve(auditFile), 'utf8'));
if (!auditArtifact) throw new Error('The audit artifact is not a verified audited-dataset import.');

const requestJson = async <T>(pathname: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(new URL(pathname, baseUrl), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init?.method || 'GET'} ${pathname} failed (${response.status}): ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) as T : {} as T;
};

const loadExisting = async (datasetId: string) => {
  const response = await fetch(new URL(`/api/datasets/${encodeURIComponent(datasetId)}`, baseUrl));
  if (response.status === 404) return undefined;
  const text = await response.text();
  if (!response.ok) throw new Error(`GET dataset failed (${response.status}): ${text.slice(0, 500)}`);
  return (JSON.parse(text) as { dataset: EvalDataset }).dataset;
};

const schemaKeys = (dataset: EvalDataset) => dataset.inputSchema.map(field => field.key);
const sourceHash = (dataset: EvalDataset) => String(
  dataset.items[0]?.__sourceSnapshotHash
  || dataset.description?.match(/sha256:[a-f0-9]{64}/i)?.[0]
  || '',
);
const sameShape = (left: EvalDataset, right: EvalDataset) =>
  left.items.length === right.items.length
  && JSON.stringify(schemaKeys(left)) === JSON.stringify(schemaKeys(right));
const comparableItems = (dataset: EvalDataset) => dataset.items.map(item => Object.fromEntries(
  Object.entries(item).filter(([key]) => key !== '__datasetItemId'),
));
const sameContent = (left: EvalDataset, right: EvalDataset) =>
  sameShape(left, right)
  && JSON.stringify(left.inputSchema) === JSON.stringify(right.inputSchema)
  && JSON.stringify(comparableItems(left)) === JSON.stringify(comparableItems(right));

const publish = async (dataset: EvalDataset, expectedSourceHash: string) => {
  const existing = await loadExisting(dataset.id);
  if (existing) {
    if (sourceHash(existing) !== expectedSourceHash || !sameContent(existing, dataset)) {
      throw new Error(`Refusing to overwrite ${dataset.id}: the existing dev dataset has different source evidence.`);
    }
    return { dataset: existing, action: 'already_present' as const };
  }
  const created = await requestJson<{ dataset: EvalDataset }>('/api/datasets', {
    method: 'POST',
    body: JSON.stringify({ dataset }),
  });
  const roundTrip = await loadExisting(dataset.id);
  if (!roundTrip || !sameShape(roundTrip, dataset) || sourceHash(roundTrip) !== expectedSourceHash) {
    throw new Error(`Round-trip verification failed for ${dataset.id}.`);
  }
  return { dataset: created.dataset, action: 'created' as const };
};

const snapshotHash = String(sourceEnvelope.verification.sourceSnapshotHash || '');
const source = await publish(sourceEnvelope.dataset, snapshotHash);
const audit = await publish(auditArtifact.dataset, snapshotHash);

console.log(JSON.stringify({
  baseUrl: baseUrl.origin,
  source: {
    id: source.dataset.id,
    action: source.action,
    items: source.dataset.items.length,
    schema: schemaKeys(source.dataset),
    url: `${baseUrl.origin}/datasets/${source.dataset.id}`,
  },
  audit: {
    id: audit.dataset.id,
    action: audit.action,
    items: audit.dataset.items.length,
    schema: schemaKeys(audit.dataset),
    url: `${baseUrl.origin}/datasets/${audit.dataset.id}`,
  },
  sourceSnapshotHash: snapshotHash,
}, null, 2));
