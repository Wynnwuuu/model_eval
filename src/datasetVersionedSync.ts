import {
  DATASET_HISTORICAL_CASE_ID_KEY,
  DATASET_ITEM_ID_KEY,
  createDatasetItemStableId,
  getDatasetItemStableId,
} from './datasetSync.ts';
import {
  findGenerationOutputCompanion,
  isGenerationOutputCompanionColumn,
} from './datasetOutputColumns.ts';
import type {
  DatasetSchemaField,
  DatasetSyncCaseChange,
  DatasetSyncMode,
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
  ignoredSourceColumns: string[];
  outputColumnsPromoted: string[];
  outputColumnsDemoted: string[];
  cases: DatasetSyncCaseChange[];
  summary: DatasetSyncPreviewSummary;
  hasChanges: boolean;
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

const datasetGenerationInputValue = (
  dataset: EvalDataset,
  row: Record<string, unknown>,
  column: string,
) => {
  const field = dataset.inputSchema.find(item => item.key === column);
  const canonicalKeys = Object.entries(dataset.columnMappings?.standard || {})
    .filter(([, mappedColumn]) => mappedColumn === column)
    .map(([canonicalKey]) => canonicalKey);
  const candidates = [...new Set([
    column,
    field?.sourceKey,
    field?.canonicalKey,
    ...canonicalKeys,
  ].filter((candidate): candidate is string => Boolean(candidate)))];
  const original = row._originalData && typeof row._originalData === 'object' && !Array.isArray(row._originalData)
    ? row._originalData as Record<string, unknown>
    : undefined;
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, candidate)) return row[candidate];
    if (original && Object.prototype.hasOwnProperty.call(original, candidate)) return original[candidate];
  }
  return undefined;
};

const resolvedDatasetGenerationInputFingerprint = (
  dataset: EvalDataset,
  row: Record<string, unknown>,
  columns: string[],
) => fingerprint(Object.fromEntries(columns.map(column => [
  column,
  datasetGenerationInputValue(dataset, row, column),
])));

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
  const canonical = header.toLowerCase();
  const isOutput = outputColumns.has(header);
  const role = isOutput
    ? 'output'
    : canonical === 'case_id'
      ? 'case_id'
      : ['prompt', 'image_urls', 'images', 'elements', 'audio_url', 'audios'].includes(canonical)
        ? (canonical === 'prompt' ? 'input' : 'reference')
        : 'metadata';
  if (existing) return {
    ...existing,
    role: isOutput || existing.role === 'output' ? role : existing.role,
  };
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

const outputCompanionColumns = (row: Record<string, unknown>, outputColumn: string) =>
  Object.keys(row).filter(key => isGenerationOutputCompanionColumn(key, outputColumn) || key === DATASET_RESULT_META_KEY);

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

const emptyPreviewSummary = (input: {
  sourceResultOverwrites?: number;
  sourceResultFills?: number;
  sourceResultReplacements?: number;
  sourceResultClears?: number;
  outputColumnsPromoted?: number;
  outputColumnsDemoted?: number;
} = {}): DatasetSyncPreviewSummary => ({
  added: 0,
  updated: 0,
  deleted: 0,
  restored: 0,
  unchanged: 0,
  staleResults: 0,
  sourceResultOverwrites: input.sourceResultOverwrites || 0,
  sourceResultFills: input.sourceResultFills || 0,
  sourceResultReplacements: input.sourceResultReplacements || 0,
  sourceResultClears: input.sourceResultClears || 0,
  outputColumnsPromoted: input.outputColumnsPromoted || 0,
  outputColumnsDemoted: input.outputColumnsDemoted || 0,
});

export const buildDatasetVersionedSyncPlan = (input: {
  dataset: EvalDataset;
  sourceHeaders: string[];
  sourceRows: Record<string, any>[];
  historicalRows: Record<string, any>[];
  outputColumns: string[];
  outputPolicies: Record<string, DatasetSyncOutputPolicy>;
  syncMode?: DatasetSyncMode;
}): DatasetVersionedSyncPlan => {
  const syncMode = input.syncMode || 'snapshot';
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
  const previousOutputColumns = [...new Set(input.dataset.columnMappings?.outputColumns || [])];
  const outputColumnsPromoted = outputColumns.filter(column => !previousOutputColumns.includes(column));
  const outputColumnsDemoted = previousOutputColumns.filter(column => !outputColumns.includes(column));
  const knownOutputColumns = [...new Set([...previousOutputColumns, ...outputColumns])];
  const ignoredSourceColumns = input.sourceHeaders.filter(header => Boolean(
    findGenerationOutputCompanion(header, knownOutputColumns),
  ));
  const ignoredSourceSet = new Set(ignoredSourceColumns);
  const sourceHeaders = input.sourceHeaders.filter(header => !ignoredSourceSet.has(header));
  const outputSet = new Set(outputColumns);
  const promotedOutputSet = new Set(outputColumnsPromoted);
  const demotedOutputSet = new Set(outputColumnsDemoted);
  const currentByIdentity = new Map(input.dataset.items.map(row => [datasetRowSyncIdentity(input.dataset, row), row]));
  const historicalByIdentity = new Map<string, Record<string, any>>();
  input.historicalRows.forEach(row => {
    const identity = datasetRowSyncIdentity(input.dataset, row);
    if (!historicalByIdentity.has(identity)) historicalByIdentity.set(identity, row);
  });
  const dependencyFallback = getDatasetGenerationInputColumns(input.dataset);
  const cases: DatasetSyncCaseChange[] = [];
  let sourceResultOverwrites = 0;
  let sourceResultFills = 0;
  let sourceResultReplacements = 0;
  let sourceResultClears = 0;

  if (validationIssues.length) {
    return {
      valid: false,
      issues: validationIssues,
      rows: [],
      schema: [],
      outputColumns,
      ignoredSourceColumns,
      outputColumnsPromoted,
      outputColumnsDemoted,
      cases: [],
      summary: emptyPreviewSummary({
        outputColumnsPromoted: outputColumnsPromoted.length,
        outputColumnsDemoted: outputColumnsDemoted.length,
      }),
      hasChanges: false,
    };
  }

  const compileRow = (
    sourceRow: Record<string, any> | undefined,
    currentRow: Record<string, any> | undefined,
    restoredRow: Record<string, any> | undefined,
  ) => {
    const identity = sourceRow
      ? datasetSyncIdentity(sourceRow)
      : datasetRowSyncIdentity(input.dataset, currentRow || {});
    const [caseId, variantLabel = ''] = parseDatasetSyncIdentity(identity);
    const historicalRow = currentRow || restoredRow;
    const stableItemId = getDatasetItemStableId(historicalRow)
      || createDatasetItemStableId(input.dataset.id, caseId, variantLabel);
    const nextRow: Record<string, any> = syncMode === 'merge' && currentRow
      ? { ...currentRow }
      : Object.fromEntries(sourceHeaders.map(header => [
        header,
        sourceRow && Object.prototype.hasOwnProperty.call(sourceRow, header) ? sourceRow[header] : '',
      ]));
    if (sourceRow) {
      sourceHeaders.forEach(header => {
        nextRow[header] = Object.prototype.hasOwnProperty.call(sourceRow, header) ? sourceRow[header] : '';
      });
      if (
        syncMode === 'merge'
        && currentRow?._originalData
        && typeof currentRow._originalData === 'object'
        && !Array.isArray(currentRow._originalData)
      ) {
        nextRow._originalData = {
          ...currentRow._originalData,
          ...Object.fromEntries(sourceHeaders.map(header => [header, nextRow[header]])),
        };
      }
    }
    const resultMeta = cloneResultMeta(historicalRow);

    outputColumnsDemoted.forEach(outputColumn => {
      delete resultMeta[outputColumn];
      Object.keys(nextRow).forEach(column => {
        if (isGenerationOutputCompanionColumn(column, outputColumn)) delete nextRow[column];
      });
    });

    outputColumns.forEach(outputColumn => {
      const policy = input.outputPolicies[outputColumn] || 'preserve_platform';
      const sourceHasColumn = Boolean(sourceRow && sourceHeaders.includes(outputColumn));
      const sourceValue = sourceHasColumn ? sourceRow?.[outputColumn] : undefined;
      const platformValue = historicalRow?.[outputColumn];
      if (sourceHasColumn) {
        nextRow[outputColumn] = mergeResultValue(policy, sourceValue, platformValue, Boolean(historicalRow));
      } else if (historicalRow && Object.prototype.hasOwnProperty.call(historicalRow, outputColumn)) {
        nextRow[outputColumn] = platformValue;
      }
      const resultChanged = Boolean(historicalRow)
        && !(
          (isBlank(nextRow[outputColumn]) && isBlank(platformValue))
          || stableSerialize(nextRow[outputColumn]) === stableSerialize(platformValue)
        );
      const sourceApplied = sourceHasColumn && (
        !historicalRow
        || policy === 'source_overwrite'
        || (policy === 'fill_platform_blanks' && isBlank(platformValue))
      );
      if (sourceApplied && resultChanged) {
        if (isBlank(platformValue) && !isBlank(nextRow[outputColumn])) {
          sourceResultFills += 1;
        } else if (!isBlank(platformValue) && isBlank(nextRow[outputColumn])) {
          sourceResultClears += 1;
          sourceResultOverwrites += 1;
        } else if (!isBlank(platformValue)) {
          sourceResultReplacements += 1;
          sourceResultOverwrites += 1;
        }
      }
      if (resultChanged) {
        Object.keys(nextRow).forEach(column => {
          if (isGenerationOutputCompanionColumn(column, outputColumn)) delete nextRow[column];
        });
      } else if (historicalRow) {
        outputCompanionColumns(historicalRow, outputColumn).forEach(column => {
          if (column !== DATASET_RESULT_META_KEY && !Object.prototype.hasOwnProperty.call(nextRow, column)) nextRow[column] = historicalRow[column];
        });
      }
      if (!isBlank(nextRow[outputColumn])) {
        const priorMeta = resultMeta[outputColumn];
        const dependencyColumns = priorMeta?.dependencyColumns?.length ? priorMeta.dependencyColumns : dependencyFallback;
        const dependenciesChanged = Boolean(historicalRow) && dependencyColumns.some(column =>
          stableSerialize(datasetGenerationInputValue(input.dataset, historicalRow, column))
            !== stableSerialize(datasetGenerationInputValue(input.dataset, nextRow, column))
        );
        const sourceIntroducedOrReplacedResult = sourceApplied && (!historicalRow || resultChanged);
        resultMeta[outputColumn] = sourceIntroducedOrReplacedResult
          ? {
            source: 'source',
            stale: false,
            dependencyColumns,
            inputFingerprint: resolvedDatasetGenerationInputFingerprint(input.dataset, nextRow, dependencyColumns),
          }
          : priorMeta && !dependenciesChanged
            ? priorMeta
          : {
            ...(priorMeta || {
              source: promotedOutputSet.has(outputColumn)
                ? 'source'
                : currentRow ? 'generation' : 'restored',
            }),
            dependencyColumns,
            inputFingerprint: priorMeta?.inputFingerprint
              || resolvedDatasetGenerationInputFingerprint(input.dataset, historicalRow || nextRow, dependencyColumns),
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
    else delete nextRow[DATASET_RESULT_META_KEY];
    nextRow[DATASET_ITEM_ID_KEY] = stableItemId;
    delete nextRow[DATASET_HISTORICAL_CASE_ID_KEY];

    const comparisonFields = new Set([
      ...sourceHeaders,
      ...outputColumns,
      ...outputColumnsDemoted,
      ...Object.keys(historicalRow || {}).filter(key => key !== '_originalData' && !key.startsWith('__')),
    ]);
    const fieldChanges = historicalRow
      ? [...comparisonFields].filter(field => !findGenerationOutputCompanion(field, knownOutputColumns)).flatMap(field => (
        outputSet.has(field) && isBlank(historicalRow[field]) && isBlank(nextRow[field])
          ? true
          : stableSerialize(historicalRow[field]) === stableSerialize(nextRow[field])
      )
        ? []
        : [{ field, before: historicalRow[field], after: nextRow[field], kind: fieldKind(input.dataset, field, outputSet) }])
      : [];
    const staleOutputColumns = Object.entries(resultMeta).filter(([, meta]) => meta.stale).map(([column]) => column);
    const action = currentRow
      ? (fieldChanges.length ? 'updated' : 'unchanged')
      : historicalRow ? 'restored' : 'added';
    cases.push({ identity, caseId, variantLabel, stableItemId, action, fieldChanges, staleOutputColumns });
    return nextRow;
  };

  const sourceByIdentity = new Map(input.sourceRows.map(row => [datasetSyncIdentity(row), row]));
  const rows = syncMode === 'merge'
    ? [
      ...input.dataset.items.map(currentRow => {
        const identity = datasetRowSyncIdentity(input.dataset, currentRow);
        return compileRow(sourceByIdentity.get(identity), currentRow, undefined);
      }),
      ...input.sourceRows
        .filter(sourceRow => !currentByIdentity.has(datasetSyncIdentity(sourceRow)))
        .map(sourceRow => compileRow(sourceRow, undefined, historicalByIdentity.get(datasetSyncIdentity(sourceRow)))),
    ]
    : input.sourceRows.map(sourceRow => {
      const identity = datasetSyncIdentity(sourceRow);
      return compileRow(sourceRow, currentByIdentity.get(identity), historicalByIdentity.get(identity));
    });

  const sourceIdentities = new Set(input.sourceRows.map(datasetSyncIdentity));
  if (syncMode === 'snapshot') input.dataset.items.forEach(row => {
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
  }, emptyPreviewSummary({
    sourceResultOverwrites,
    sourceResultFills,
    sourceResultReplacements,
    sourceResultClears,
    outputColumnsPromoted: outputColumnsPromoted.length,
    outputColumnsDemoted: outputColumnsDemoted.length,
  }));

  const sourceHeaderSet = new Set(sourceHeaders);
  const schema = syncMode === 'merge'
    ? [
      ...input.dataset.inputSchema
        .filter(field => !outputColumnsDemoted.some(output => isGenerationOutputCompanionColumn(field.key, output)))
        .map(field => sourceField(field.key, input.dataset, outputSet)),
      ...sourceHeaders
        .filter(header => !input.dataset.inputSchema.some(field => field.key === header))
        .map(header => sourceField(header, input.dataset, outputSet)),
    ]
    : [
      ...sourceHeaders.map(header => sourceField(header, input.dataset, outputSet)),
      ...input.dataset.inputSchema.filter(field =>
        !sourceHeaderSet.has(field.key)
        && !demotedOutputSet.has(field.key)
        && (
          outputSet.has(field.key)
          || field.role === 'system'
          || outputColumns.some(output => isGenerationOutputCompanionColumn(field.key, output))
        )
      ),
    ];
  const hasChanges = stableSerialize(rows) !== stableSerialize(input.dataset.items)
    || stableSerialize(schema) !== stableSerialize(input.dataset.inputSchema)
    || stableSerialize(outputColumns) !== stableSerialize(previousOutputColumns);
  return {
    valid: true,
    issues: [],
    rows,
    schema,
    outputColumns,
    ignoredSourceColumns,
    outputColumnsPromoted,
    outputColumnsDemoted,
    cases,
    summary,
    hasChanges,
  };
};
