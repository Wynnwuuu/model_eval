import {
  DATASET_HISTORICAL_CASE_ID_KEY,
  DATASET_ITEM_ID_KEY,
  createDatasetItemStableId,
  getDatasetItemStableId,
} from './datasetSync.ts';
import type {
  DatasetSchemaField,
  DatasetSyncCaseChange,
  DatasetSyncOutputPolicy,
  DatasetSyncPreviewSummary,
  EvalDataset,
} from './types.ts';

export const DATASET_RESULT_META_KEY = '__generationResultMeta';

export interface DatasetResultFreshnessEntry {
  source: 'generation' | 'source' | 'restored';
  stale: boolean;
  inputFingerprint?: string;
  dependencyColumns?: string[];
  generatedAt?: number;
  staleSinceVersion?: number;
}

export type DatasetResultFreshnessMap = Record<string, DatasetResultFreshnessEntry>;

export interface DatasetSyncSourceIssue {
  code: 'MISSING_CASE_ID_COLUMN' | 'MISSING_CASE_ID' | 'DUPLICATE_CASE_IDENTITY' | 'DUPLICATE_CURRENT_CASE_IDENTITY';
  rowIndexes: number[];
  identity: string;
}

export interface DatasetVersionedSyncPlan {
  valid: boolean;
  issues: DatasetSyncSourceIssue[];
  rows: Record<string, any>[];
  schema: DatasetSchemaField[];
  outputColumns: string[];
  cases: DatasetSyncCaseChange[];
  summary: DatasetSyncPreviewSummary;
}

const cleanIdentityPart = (value: unknown) => String(value ?? '').trim();

export const datasetSyncIdentity = (row: Record<string, unknown>) =>
  JSON.stringify([cleanIdentityPart(row.case_id), cleanIdentityPart(row.variant_label)]);

const datasetRowSyncIdentity = (dataset: EvalDataset, row: Record<string, unknown>) => {
  const caseIdColumns = [...new Set([
    'case_id',
    dataset.columnMappings?.caseId,
    dataset.columnMappings?.standard?.case_id,
    ...dataset.inputSchema
      .filter(field => field.role === 'case_id' || field.canonicalKey === 'case_id')
      .map(field => field.key),
  ].filter((column): column is string => Boolean(column)))];
  const caseId = caseIdColumns
    .map(column => cleanIdentityPart(row[column]))
    .find(Boolean)
    || cleanIdentityPart(row[DATASET_HISTORICAL_CASE_ID_KEY]);
  const variantColumn = dataset.inputSchema.find(field =>
    field.key === 'variant_label' || field.canonicalKey === 'variant_label'
  )?.key || 'variant_label';
  return JSON.stringify([caseId, cleanIdentityPart(row[variantColumn])]);
};

const parseDatasetSyncIdentity = (identity: string): [string, string] => {
  const parsed = JSON.parse(identity);
  return [String(parsed[0] || ''), String(parsed[1] || '')];
};

export const formatDatasetSyncIdentity = (identity: string) => {
  const [caseId, variantLabel = ''] = parseDatasetSyncIdentity(identity);
  return `${caseId || '(blank)'} / ${variantLabel || '(blank)'}`;
};

export const validateDatasetSyncSource = (rows: Record<string, unknown>[]) => {
  const issueByIdentity = new Map<string, DatasetSyncSourceIssue>();
  const rowIndexesByIdentity = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const identity = datasetSyncIdentity(row);
    const [caseId] = parseDatasetSyncIdentity(identity);
    if (!caseId) {
      issueByIdentity.set(`missing:${index}`, {
        code: 'MISSING_CASE_ID',
        rowIndexes: [index],
        identity: `(row ${index + 1})`,
      });
      return;
    }
    const indexes = rowIndexesByIdentity.get(identity) || [];
    indexes.push(index);
    rowIndexesByIdentity.set(identity, indexes);
  });
  rowIndexesByIdentity.forEach((rowIndexes, identity) => {
    if (rowIndexes.length < 2) return;
    issueByIdentity.set(identity, {
      code: 'DUPLICATE_CASE_IDENTITY',
      rowIndexes,
      identity: formatDatasetSyncIdentity(identity),
    });
  });
  const issues = [...issueByIdentity.values()];
  return { valid: issues.length === 0, issues };
};

const validateCurrentDatasetIdentities = (dataset: EvalDataset) => {
  const rowIndexesByIdentity = new Map<string, number[]>();
  dataset.items.forEach((row, index) => {
    const identity = datasetRowSyncIdentity(dataset, row);
    const indexes = rowIndexesByIdentity.get(identity) || [];
    indexes.push(index);
    rowIndexesByIdentity.set(identity, indexes);
  });
  return [...rowIndexesByIdentity.entries()].flatMap(([identity, rowIndexes]) => rowIndexes.length > 1
    ? [{
      code: 'DUPLICATE_CURRENT_CASE_IDENTITY' as const,
      rowIndexes,
      identity: formatDatasetSyncIdentity(identity),
    }]
    : []);
};

const isBlank = (value: unknown) => value == null || (typeof value === 'string' && value.trim() === '');

const stableSerialize = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key =>
    `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`
  ).join(',')}}`;
};

const fingerprint = (value: unknown) => {
  const text = stableSerialize(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

export const getDatasetGenerationInputColumns = (dataset: EvalDataset) => {
  const columns = new Set<string>([
    ...(dataset.columnMappings?.inputColumns || []),
    ...(dataset.columnMappings?.referenceColumns || []),
  ]);
  dataset.inputSchema.forEach(field => {
    if (['input', 'reference', 'media'].includes(field.role || '')) columns.add(field.key);
    if ([
      'prompt', 'image_urls', 'images', 'elements', 'audio_url', 'audios',
      'duration', 'aspect_ratio', 'resolution', 'generate_audio', 'negative_prompt',
    ].includes(field.canonicalKey || field.key)) columns.add(field.key);
  });
  return [...columns].filter(column => column && !column.startsWith('__'));
};

export const datasetGenerationInputFingerprint = (
  row: Record<string, unknown>,
  columns: string[],
) => fingerprint(Object.fromEntries(columns.map(column => [column, row[column]])));

export const collectGenerationDependencyColumns = (
  values: unknown[],
  candidateColumns: string[],
) => {
  const candidates = new Set(candidateColumns);
  const result = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      if (candidates.has(value)) result.add(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach(visit);
  };
  values.forEach(visit);
  return [...result];
};

const fieldKind = (dataset: EvalDataset, field: string, outputColumns: Set<string>): DatasetSyncCaseChange['fieldChanges'][number]['kind'] => {
  if (outputColumns.has(field)) return 'output';
  const schema = dataset.inputSchema.find(item => item.key === field);
  if (schema && ['input', 'reference', 'media'].includes(schema.role || '')) return 'input';
  return 'metadata';
};

const sourceField = (header: string, dataset: EvalDataset, outputColumns: Set<string>): DatasetSchemaField => {
  const existing = dataset.inputSchema.find(field => field.key === header);
  if (existing) return {
    ...existing,
    key: header,
    label: header,
    sourceKey: header,
    ...(outputColumns.has(header) ? { role: 'output' as const } : {}),
  };
  const canonical = header.toLowerCase();
  const isOutput = outputColumns.has(header);
  const role = isOutput
    ? 'output'
    : canonical === 'case_id'
      ? 'case_id'
      : ['prompt', 'image_urls', 'images', 'elements', 'audio_url', 'audios'].includes(canonical)
        ? (canonical === 'prompt' ? 'input' : 'reference')
        : 'metadata';
  const type = isOutput && dataset.modality === 'image'
    ? 'image_url'
    : /image/.test(canonical)
    ? 'image_url'
    : /video/.test(canonical) || isOutput
      ? 'video_url'
      : /audio/.test(canonical)
        ? 'audio_url'
        : 'text';
  return {
    key: header,
    label: header,
    sourceKey: header,
    canonicalKey: canonical,
    role,
    type,
    previewType: type === 'image_url' ? 'image' : type === 'video_url' ? 'video' : type === 'audio_url' ? 'audio' : 'text',
    required: canonical === 'case_id',
  };
};

const OUTPUT_COMPANION_SUFFIXES = ['_status', '_seed', '_request_id', '_error', '_params_json'];

const isOutputCompanionColumn = (column: string, outputColumn: string) =>
  OUTPUT_COMPANION_SUFFIXES.some(suffix => column === `${outputColumn}${suffix}`);

const outputCompanionColumns = (row: Record<string, unknown>, outputColumn: string) =>
  Object.keys(row).filter(key => isOutputCompanionColumn(key, outputColumn) || key === DATASET_RESULT_META_KEY);

const mergeResultValue = (
  policy: DatasetSyncOutputPolicy,
  sourceValue: unknown,
  platformValue: unknown,
  hasHistoricalPlatformRow: boolean,
) => {
  if (!hasHistoricalPlatformRow) return sourceValue;
  if (policy === 'source_overwrite') return sourceValue;
  if (policy === 'fill_platform_blanks' && isBlank(platformValue)) return sourceValue;
  return platformValue;
};

const cloneResultMeta = (row?: Record<string, unknown>): DatasetResultFreshnessMap => {
  const value = row?.[DATASET_RESULT_META_KEY];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? JSON.parse(JSON.stringify(value))
    : {};
};

export const buildDatasetVersionedSyncPlan = (input: {
  dataset: EvalDataset;
  sourceHeaders: string[];
  sourceRows: Record<string, any>[];
  historicalRows: Record<string, any>[];
  outputColumns: string[];
  outputPolicies: Record<string, DatasetSyncOutputPolicy>;
}): DatasetVersionedSyncPlan => {
  const sourceValidation = validateDatasetSyncSource(input.sourceRows);
  const validationIssues = [
    ...(!input.sourceHeaders.includes('case_id') ? [{
      code: 'MISSING_CASE_ID_COLUMN' as const,
      rowIndexes: [],
      identity: 'case_id',
    }] : []),
    ...sourceValidation.issues,
    ...validateCurrentDatasetIdentities(input.dataset),
  ];
  const outputColumns = [...new Set(input.outputColumns)];
  const outputSet = new Set(outputColumns);
  const currentByIdentity = new Map(input.dataset.items.map(row => [datasetRowSyncIdentity(input.dataset, row), row]));
  const historicalByIdentity = new Map<string, Record<string, any>>();
  input.historicalRows.forEach(row => {
    const identity = datasetRowSyncIdentity(input.dataset, row);
    if (!historicalByIdentity.has(identity)) historicalByIdentity.set(identity, row);
  });
  const dependencyFallback = getDatasetGenerationInputColumns(input.dataset);
  const cases: DatasetSyncCaseChange[] = [];
  let sourceResultOverwrites = 0;

  if (validationIssues.length) {
    return {
      valid: false,
      issues: validationIssues,
      rows: [],
      schema: [],
      outputColumns,
      cases: [],
      summary: { added: 0, updated: 0, deleted: 0, restored: 0, unchanged: 0, staleResults: 0, sourceResultOverwrites: 0 },
    };
  }

  const rows = input.sourceRows.map(sourceRow => {
    const identity = datasetSyncIdentity(sourceRow);
    const [caseId, variantLabel = ''] = parseDatasetSyncIdentity(identity);
    const currentRow = currentByIdentity.get(identity);
    const historicalRow = currentRow || historicalByIdentity.get(identity);
    const stableItemId = getDatasetItemStableId(historicalRow)
      || createDatasetItemStableId(input.dataset.id, caseId, variantLabel);
    const nextRow: Record<string, any> = Object.fromEntries(input.sourceHeaders.map(header => [
      header,
      Object.prototype.hasOwnProperty.call(sourceRow, header) ? sourceRow[header] : '',
    ]));
    const resultMeta = cloneResultMeta(historicalRow);

    outputColumns.forEach(outputColumn => {
      const policy = input.outputPolicies[outputColumn] || 'preserve_platform';
      const sourceHasColumn = input.sourceHeaders.includes(outputColumn);
      const sourceValue = sourceHasColumn ? sourceRow[outputColumn] : undefined;
      const platformValue = historicalRow?.[outputColumn];
      if (sourceHasColumn) {
        nextRow[outputColumn] = mergeResultValue(policy, sourceValue, platformValue, Boolean(historicalRow));
        if (policy === 'source_overwrite' && historicalRow && stableSerialize(sourceValue) !== stableSerialize(platformValue)) {
          sourceResultOverwrites += 1;
        }
      } else if (historicalRow && Object.prototype.hasOwnProperty.call(historicalRow, outputColumn)) {
        nextRow[outputColumn] = platformValue;
      }
      if (historicalRow) {
        outputCompanionColumns(historicalRow, outputColumn).forEach(column => {
          if (column !== DATASET_RESULT_META_KEY && !Object.prototype.hasOwnProperty.call(nextRow, column)) nextRow[column] = historicalRow[column];
        });
      }
      if (!isBlank(nextRow[outputColumn])) {
        const priorMeta = resultMeta[outputColumn];
        const dependencyColumns = priorMeta?.dependencyColumns?.length ? priorMeta.dependencyColumns : dependencyFallback;
        const sourceWon = !historicalRow
          || policy === 'source_overwrite'
          || (policy === 'fill_platform_blanks' && isBlank(platformValue) && !isBlank(sourceValue));
        const dependenciesChanged = Boolean(historicalRow) && dependencyColumns.some(column =>
          stableSerialize(historicalRow[column]) !== stableSerialize(nextRow[column])
        );
        resultMeta[outputColumn] = sourceWon
          ? {
            source: 'source',
            stale: false,
            dependencyColumns,
            inputFingerprint: datasetGenerationInputFingerprint(nextRow, dependencyColumns),
          }
          : {
            ...(priorMeta || { source: currentRow ? 'generation' : 'restored' }),
            dependencyColumns,
            inputFingerprint: priorMeta?.inputFingerprint || datasetGenerationInputFingerprint(historicalRow || nextRow, dependencyColumns),
            stale: Boolean(priorMeta?.stale || dependenciesChanged),
            ...(dependenciesChanged ? { staleSinceVersion: (input.dataset.version || 0) + 1 } : {}),
          };
      } else {
        delete resultMeta[outputColumn];
      }
    });
    if (historicalRow) {
      Object.keys(historicalRow).forEach(column => {
        if (
          column.startsWith('__')
          && column !== DATASET_ITEM_ID_KEY
          && column !== DATASET_RESULT_META_KEY
          && column !== DATASET_HISTORICAL_CASE_ID_KEY
          && !Object.prototype.hasOwnProperty.call(nextRow, column)
        ) {
          nextRow[column] = historicalRow[column];
        }
      });
    }
    if (Object.keys(resultMeta).length) nextRow[DATASET_RESULT_META_KEY] = resultMeta;
    nextRow[DATASET_ITEM_ID_KEY] = stableItemId;

    const comparisonFields = new Set([
      ...input.sourceHeaders,
      ...outputColumns,
      ...Object.keys(historicalRow || {}).filter(key => !key.startsWith('__')),
    ]);
    const fieldChanges = historicalRow
      ? [...comparisonFields].flatMap(field => stableSerialize(historicalRow[field]) === stableSerialize(nextRow[field])
        ? []
        : [{ field, before: historicalRow[field], after: nextRow[field], kind: fieldKind(input.dataset, field, outputSet) }])
      : [];
    const staleOutputColumns = Object.entries(resultMeta).filter(([, meta]) => meta.stale).map(([column]) => column);
    const action = currentRow
      ? (fieldChanges.length ? 'updated' : 'unchanged')
      : historicalRow ? 'restored' : 'added';
    cases.push({ identity, caseId, variantLabel, stableItemId, action, fieldChanges, staleOutputColumns });
    return nextRow;
  });

  const sourceIdentities = new Set(input.sourceRows.map(datasetSyncIdentity));
  input.dataset.items.forEach(row => {
    const identity = datasetRowSyncIdentity(input.dataset, row);
    if (sourceIdentities.has(identity)) return;
    const [caseId, variantLabel = ''] = parseDatasetSyncIdentity(identity);
    cases.push({
      identity,
      caseId,
      variantLabel,
      stableItemId: getDatasetItemStableId(row),
      action: 'deleted',
      fieldChanges: [],
      staleOutputColumns: [],
    });
  });

  const summary = cases.reduce<DatasetSyncPreviewSummary>((acc, item) => {
    acc[item.action] += 1;
    acc.staleResults += item.staleOutputColumns.length;
    return acc;
  }, { added: 0, updated: 0, deleted: 0, restored: 0, unchanged: 0, staleResults: 0, sourceResultOverwrites });

  const sourceSchema = input.sourceHeaders.map(header => sourceField(header, input.dataset, outputSet));
  const sourceHeaderSet = new Set(input.sourceHeaders);
  const retainedSchema = input.dataset.inputSchema.filter(field =>
    !sourceHeaderSet.has(field.key) && (
      outputSet.has(field.key)
      || field.role === 'system'
      || outputColumns.some(output => isOutputCompanionColumn(field.key, output))
    )
  );
  return {
    valid: true,
    issues: [],
    rows,
    schema: [...sourceSchema, ...retainedSchema],
    outputColumns,
    cases,
    summary,
  };
};
