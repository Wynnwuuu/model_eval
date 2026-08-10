import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { auditDatasetAgainstModels } from '../server/generation/generationDatasetAudit.ts';
import { serverConfig } from '../server/config.ts';
import type { NormalizedGenerationModel } from '../server/generation/generationPlanning.ts';
import type { EvalDataset } from '../src/types.ts';

const option = (name: string, fallback = '') => {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length) || fallback;
};

const hasFlag = (name: string) => process.argv.includes(`--${name}`);
const baseUrl = option('base-url', 'http://localhost:8787').replace(/\/+$/, '');
const datasetId = option('dataset');
const datasetFile = option('dataset-file');
const modelsFile = option('models-file');
const outputFile = option('output');
const userId = option('user-id', process.env.AION_EVAL_USER_ID || '796854911166661');
const requestedModels = option('models').split(',').map(value => value.trim()).filter(Boolean);
const legacyModels = [
  option('video-model', 'seedance-2.5'),
  option('image-model', 'gemini-3-pro-image-preview'),
].filter(Boolean);

if (!datasetFile && !datasetId) {
  throw new Error('Use --dataset-file=<json> or --dataset=<dataset-id>.');
}
if (Boolean(datasetFile) !== Boolean(modelsFile)) {
  throw new Error('--dataset-file and --models-file must be used together.');
}

const readEnvelope = <T>(path: string, key: string): T => {
  const parsed = JSON.parse(readFileSync(resolve(path), 'utf8'));
  return (parsed?.[key] ?? parsed) as T;
};

const getJson = async <T>(path: string): Promise<T> => {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'x-auth-user-id': userId },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`GET ${path} failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return body as T;
};

const loadInputs = async () => {
  if (datasetFile && modelsFile) {
    return {
      dataset: readEnvelope<EvalDataset>(datasetFile, 'dataset'),
      models: readEnvelope<NormalizedGenerationModel[]>(modelsFile, 'models'),
      source: 'authenticated_browser_export' as const,
    };
  }
  const [{ dataset }, { models }] = await Promise.all([
    getJson<{ dataset: EvalDataset }>(`/api/datasets/${encodeURIComponent(datasetId)}`),
    getJson<{ models: NormalizedGenerationModel[] }>('/api/generation/models'),
  ]);
  return { dataset, models, source: 'manueval_api' as const };
};

const { dataset, models, source } = await loadInputs();
const selectedModels = hasFlag('all-models')
  ? models.filter(model => model.outputModality === 'image' || model.outputModality === 'video')
  : models.filter(model => (requestedModels.length ? requestedModels : legacyModels).includes(model.modelName));

if (!selectedModels.length) throw new Error('No matching live image/video models were found.');
const audit = auditDatasetAgainstModels(
  dataset,
  selectedModels,
  serverConfig.generationModelValidationOverrides,
);
const output = {
  ...audit,
  source,
  auditedAt: new Date().toISOString(),
};

if (outputFile) {
  const absolute = resolve(outputFile);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify({
  dryRun: output.dryRun,
  generationPostRequests: output.generationPostRequests,
  source,
  auditedAt: output.auditedAt,
  dataset: output.dataset,
  modelCount: output.summary.modelCount,
  totalEvaluations: output.summary.totalEvaluations,
  byStatus: output.summary.byStatus,
  outputFile: outputFile ? resolve(outputFile) : null,
}, null, 2));
