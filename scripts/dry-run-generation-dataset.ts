import {
  buildAionGenerationRequest,
  generationRequestProjectionDiff,
  preflightGenerationCase,
  type NormalizedGenerationModel,
} from '../server/generation/generationPlanning.ts';
import {
  buildGenerationCasesForPreflight,
  type GenerationPreflightRequest,
} from '../server/generation/generationPreflightService.ts';
import { generationValidationForModel } from '../server/generation/generationValidationPolicy.ts';
import { getDatasetColumnMappings } from '../src/datasetManifest.ts';
import { DATASET_ITEM_ID_KEY } from '../src/datasetSync.ts';
import {
  defaultGenerationInputMapping,
  defaultVidMuseEvaluationParameterColumns,
  generationRowMatchesModality,
  resolveVidMuseEvaluationPresetColumns,
} from '../src/features/generation/inputMapping.ts';
import type {
  EvalDataset,
  GenerationParameterBinding,
  GenerationPreflightIssue,
} from '../src/types.ts';

type Modality = 'image' | 'video';

type DryRunLane = {
  modality: Modality;
  modelName: string;
  selectedCases: number;
  validCases: number;
  invalidCases: number;
  errorCasesByCode: Record<string, number>;
  errorOccurrencesByCode: Record<string, number>;
  warningCasesByCode: Record<string, number>;
  generationTypes: Record<string, number>;
  mediaReferences: number;
  mediaReferencesWithSpaces: number;
  normalizedUrlsWithWhitespace: number;
  projectionDiffCases: number;
  requestBuildFailures: number;
};

const option = (name: string, fallback = '') => {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length) || fallback;
};

const baseUrl = option('base-url', 'http://localhost:8787').replace(/\/+$/, '');
const datasetId = option('dataset');
const userId = option('user-id', process.env.AION_EVAL_USER_ID || '796854911166661');
const requestedModels: Record<Modality, string> = {
  video: option('video-model', 'seedance-2.5'),
  image: option('image-model', 'gemini-3-pro-image-preview'),
};

if (!datasetId) {
  throw new Error('Usage: tsx scripts/dry-run-generation-dataset.ts --dataset=<dataset-id> [--video-model=<name>] [--image-model=<name>]');
}

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

const increment = (target: Record<string, number>, key: string) => {
  target[key] = (target[key] || 0) + 1;
};

const countIssueCases = (
  target: Record<string, number>,
  issues: GenerationPreflightIssue[],
) => {
  new Set(issues.map(issue => issue.code)).forEach(code => increment(target, code));
};

const defaultParameterBindings = (
  dataset: EvalDataset,
  headers: string[],
  model: NormalizedGenerationModel,
): Record<string, GenerationParameterBinding> => ({
  ...Object.fromEntries([
    ...model.controls
      .filter(control => control.key !== 'duration' && control.key !== 'seed')
      .map(control => [control.key, { source: 'unused' as const }]),
    ...(model.advancedParameters || [])
      .map(parameter => [parameter.key, { source: 'unused' as const }]),
  ]),
  ...defaultVidMuseEvaluationParameterColumns(
    headers,
    model.controls.map(control => control.key),
    dataset.inputSchema || [],
  ),
});

const runLane = (
  dataset: EvalDataset,
  model: NormalizedGenerationModel,
): DryRunLane => {
  const headers = (dataset.inputSchema || []).map(field => field.key);
  const mapping = defaultGenerationInputMapping(
    dataset,
    headers,
    getDatasetColumnMappings(dataset, headers),
    model.outputModality,
  );
  const presetColumns = resolveVidMuseEvaluationPresetColumns(headers, dataset.inputSchema || []);
  const durationColumn = model.controls.some(control => control.key === 'duration')
    ? presetColumns.duration
    : undefined;
  const selectedRows = (dataset.items || []).flatMap((row, rowIndex) => {
    if (!generationRowMatchesModality(row, model.outputModality)) return [];
    const datasetItemId = String(row[DATASET_ITEM_ID_KEY] || '').trim();
    if (!datasetItemId) throw new Error(`Dataset row ${rowIndex + 1} has no stable item ID.`);
    return [{ row, rowIndex, datasetItemId }];
  });
  const request: GenerationPreflightRequest = {
    datasetId: dataset.id,
    datasetVersion: dataset.version || 1,
    datasetName: dataset.name,
    modelName: model.modelName,
    targetColumn: `dry_run_${model.outputModality}`,
    targetMode: 'new',
    inputMapping: mapping,
    defaultControls: {},
    perCaseControlColumns: {},
    parameterBindings: defaultParameterBindings(dataset, headers, model),
    ...(durationColumn ? { durationSource: { mode: 'column', column: durationColumn } } : {}),
    seedMode: 'unused',
    seedPolicyVersion: 2,
  };
  const prepared = buildGenerationCasesForPreflight(dataset, request, model, selectedRows);
  const report: DryRunLane = {
    modality: model.outputModality,
    modelName: model.modelName,
    selectedCases: prepared.length,
    validCases: 0,
    invalidCases: 0,
    errorCasesByCode: {},
    errorOccurrencesByCode: {},
    warningCasesByCode: {},
    generationTypes: {},
    mediaReferences: 0,
    mediaReferencesWithSpaces: 0,
    normalizedUrlsWithWhitespace: 0,
    projectionDiffCases: 0,
    requestBuildFailures: 0,
  };

  prepared.forEach(item => {
    const validation = preflightGenerationCase(model, item.resolvedCase, generationValidationForModel(model, {}));
    const errors = [...item.preparationIssues, ...validation.errors];
    const warnings = [...item.preparationWarnings, ...validation.warnings];
    countIssueCases(report.errorCasesByCode, errors);
    countIssueCases(report.warningCasesByCode, warnings);
    errors.forEach(issue => increment(report.errorOccurrencesByCode, issue.code));
    increment(report.generationTypes, validation.generationType);
    const references = validation.resolvedCase.compilerAudit?.mediaReferences || [];
    report.mediaReferences += references.length;
    report.mediaReferencesWithSpaces += references.filter(reference => /\s/.test(reference.originalUrl)).length;
    report.normalizedUrlsWithWhitespace += references.filter(reference => /\s/.test(reference.normalizedUrl)).length;

    try {
      const mcpToolInput = validation.resolvedCase.compilerAudit?.mcpToolInput;
      const aionRequest = buildAionGenerationRequest(model, validation.resolvedCase).body;
      if (mcpToolInput && generationRequestProjectionDiff(model, mcpToolInput, aionRequest).length) {
        report.projectionDiffCases += 1;
      }
    } catch {
      report.requestBuildFailures += 1;
    }

    if (errors.length) report.invalidCases += 1;
    else report.validCases += 1;
  });
  return report;
};

const [{ dataset }, { models }] = await Promise.all([
  getJson<{ dataset: EvalDataset }>(`/api/datasets/${encodeURIComponent(datasetId)}`),
  getJson<{ models: NormalizedGenerationModel[] }>('/api/generation/models'),
]);

const lanes = (['video', 'image'] as const).map(modality => {
  const model = models.find(candidate => candidate.modelName === requestedModels[modality]);
  if (!model) throw new Error(`Live model configuration was not found: ${requestedModels[modality]}`);
  if (model.outputModality !== modality) {
    throw new Error(`Model ${model.modelName} produces ${model.outputModality}, not ${modality}.`);
  }
  return runLane(dataset, model);
});

const summary = {
  dryRun: true,
  generationPostRequests: 0,
  dataset: {
    id: dataset.id,
    name: dataset.name,
    version: dataset.version,
    totalCases: dataset.items.length,
  },
  lanes,
  totals: {
    selectedCases: lanes.reduce((sum, lane) => sum + lane.selectedCases, 0),
    validCases: lanes.reduce((sum, lane) => sum + lane.validCases, 0),
    invalidCases: lanes.reduce((sum, lane) => sum + lane.invalidCases, 0),
    mediaReferences: lanes.reduce((sum, lane) => sum + lane.mediaReferences, 0),
    mediaReferencesWithSpaces: lanes.reduce((sum, lane) => sum + lane.mediaReferencesWithSpaces, 0),
    normalizedUrlsWithWhitespace: lanes.reduce((sum, lane) => sum + lane.normalizedUrlsWithWhitespace, 0),
    projectionDiffCases: lanes.reduce((sum, lane) => sum + lane.projectionDiffCases, 0),
    requestBuildFailures: lanes.reduce((sum, lane) => sum + lane.requestBuildFailures, 0),
  },
};

console.log(JSON.stringify(summary, null, 2));
