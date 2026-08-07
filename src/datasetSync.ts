import type { DatasetColumnMappings, DatasetTaskBinding, EvalTask, EvaluationItem, VoteItemSnapshot, VoteRecord } from './types.ts';

export const DATASET_ITEM_ID_KEY = '__datasetItemId';

const CASE_ID_KEYS = ['用例ID', 'case_id', 'caseId', 'Case_ID', 'ItemID', 'item_id', 'id'];

const extractMediaUrls = (value: unknown): string[] => {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(extractMediaUrls);
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.flatMap(extractMediaUrls);
      if (parsed && typeof parsed === 'object') {
        return extractMediaUrls((parsed as Record<string, unknown>).url || (parsed as Record<string, unknown>).src);
      }
    } catch {
      // Fall through to URL extraction.
    }
  }
  return (trimmed.match(/https?:\/\/[^\s"'<>]+/g) || [])
    .map(url => url.replace(/[)\],;，；。]+$/g, ''))
    .filter(Boolean);
};

const resolvePlaybackUrl = (value: unknown) => {
  const urls = extractMediaUrls(value);
  return urls[0] || (typeof value === 'string' ? value.trim() : '');
};

const sortReferenceUrls = (urls: string[]) => [...urls].sort((left, right) => {
  const isAudio = (value: string) => /\.(mp3|wav|ogg|m4a|aac|flac)(\?|#|$)/i.test(value);
  return Number(isAudio(left)) - Number(isAudio(right));
});

const getDimensionValuesFromRecord = (row: Record<string, any>, columns: string[]) =>
  Object.fromEntries(columns
    .map(column => [column, String(row[column] ?? '').trim()] as const)
    .filter(([, value]) => value));

const buildPairwisePairs = (models: EvalTask['models'], mode: 'all_pairs' | 'adjacent_pairs' | 'arena_sampled' = 'all_pairs') => {
  const pairs: Array<{ pairId: string; modelA: EvalTask['models'][number]; modelB: EvalTask['models'][number] }> = [];
  if (mode === 'adjacent_pairs') {
    for (let index = 0; index < models.length - 1; index += 1) {
      pairs.push({ pairId: `${models[index].id}__${models[index + 1].id}`, modelA: models[index], modelB: models[index + 1] });
    }
    return pairs;
  }
  for (let left = 0; left < models.length; left += 1) {
    for (let right = left + 1; right < models.length; right += 1) {
      pairs.push({ pairId: `${models[left].id}__${models[right].id}`, modelA: models[left], modelB: models[right] });
    }
  }
  return pairs;
};

const createVoteItemSnapshot = (item: EvaluationItem): VoteItemSnapshot => ({
  itemId: item.id,
  prompt: item.prompt,
  inputs: item.inputs ? { ...item.inputs } : undefined,
  dimensionValues: item.dimensionValues ? { ...item.dimensionValues } : undefined,
  modelOutputs: item.modelOutputs?.map(output => ({ ...output })),
  modelA_Url: item.modelA_Url,
  modelB_Url: item.modelB_Url,
  startImageUrl: item.startImageUrl,
  referenceUrls: item.referenceUrls ? [...item.referenceUrls] : undefined,
  type: item.type,
  pairContext: item.pairContext ? { ...item.pairContext } : undefined,
  originalItemId: item.originalItemId,
  originalData: item.originalData ? { ...item.originalData } : undefined,
  sourceDatasetItemId: item.sourceDatasetItemId,
  sourceDatasetVersion: item.sourceDatasetVersion,
});

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

export const getDatasetRowCaseId = (row: Record<string, any>, fallbackIndex = 0) => {
  const key = CASE_ID_KEYS.find(candidate => String(row[candidate] ?? '').trim());
  return key ? String(row[key]).trim() : `case-${fallbackIndex + 1}`;
};

export const getDatasetItemStableId = (row?: Record<string, any>) =>
  typeof row?.[DATASET_ITEM_ID_KEY] === 'string' ? row[DATASET_ITEM_ID_KEY] : '';

export const ensureStableDatasetItemIds = (
  datasetId: string,
  rows: Record<string, any>[]
): Record<string, any>[] => {
  const occurrenceByIdentity = new Map<string, number>();
  return rows.map((row, index) => {
    if (getDatasetItemStableId(row)) return { ...row };
    const caseId = getDatasetRowCaseId(row, index);
    const variantLabel = String(row.variant_label ?? '').trim();
    const identity = `${caseId}|${variantLabel}`;
    const occurrence = occurrenceByIdentity.get(identity) || 0;
    occurrenceByIdentity.set(identity, occurrence + 1);
    return {
      ...row,
      [DATASET_ITEM_ID_KEY]: `${datasetId}:item:${hashString(`${identity}|${occurrence}`)}`,
    };
  });
};

export const stripDatasetInternalFields = (row: Record<string, any>) => {
  const next = { ...row };
  delete next[DATASET_ITEM_ID_KEY];
  return next;
};

export const inferTaskDatasetBinding = (
  task: EvalTask,
  taskItems: EvaluationItem[] = [],
  sourceMappings?: DatasetColumnMappings
): DatasetTaskBinding => {
  if (task.datasetBinding) return task.datasetBinding;
  const firstItem = taskItems[0];
  const mappedOutputs = sourceMappings?.outputColumns || [];
  return {
    datasetId: task.datasetId,
    datasetVersion: firstItem?.sourceDatasetVersion || 1,
    inputColumns: Object.keys(firstItem?.inputs || {}).length ? Object.keys(firstItem?.inputs || {}) : sourceMappings?.inputColumns || [],
    dimensionColumns: task.dimensionColumns?.length ? task.dimensionColumns : Object.keys(firstItem?.dimensionValues || {}).length ? Object.keys(firstItem?.dimensionValues || {}) : sourceMappings?.dimensionColumns || [],
    referenceColumns: sourceMappings?.referenceColumns || [],
    modelColumns: Object.fromEntries(task.models.map((model, index) => [model.id, mappedOutputs[index] || model.name])),
  };
};

const comparableColumnValue = (value: unknown) => JSON.stringify(value ?? null);

export const detectDatasetColumnRenames = (
  previousRows: Record<string, any>[],
  nextRows: Record<string, any>[],
  previousMappings?: DatasetColumnMappings,
  nextMappings?: DatasetColumnMappings
): Record<string, string> => {
  const previousByStableId = new Map(previousRows
    .map(row => [getDatasetItemStableId(row), row] as const)
    .filter(([stableId]) => stableId));
  const commonRows = nextRows
    .map(nextRow => ({ nextRow, previousRow: previousByStableId.get(getDatasetItemStableId(nextRow)) }))
    .filter((pair): pair is { nextRow: Record<string, any>; previousRow: Record<string, any> } => Boolean(pair.previousRow));
  if (!commonRows.length) return {};

  const previousColumns = new Set(previousRows.flatMap(row => Object.keys(row)).filter(key => !key.startsWith('__')));
  const nextColumns = new Set(nextRows.flatMap(row => Object.keys(row)).filter(key => !key.startsWith('__')));
  const removedColumns = [...previousColumns].filter(column => !nextColumns.has(column));
  const addedColumns = [...nextColumns].filter(column => !previousColumns.has(column));
  const candidates = new Map<string, string[]>();
  const mappingRoles = (column: string, mappings?: DatasetColumnMappings) => {
    const roles = new Set<string>();
    if (mappings?.caseId === column) roles.add('case_id');
    if (mappings?.inputColumns?.includes(column)) roles.add('input');
    if (mappings?.outputColumns?.includes(column)) roles.add('output');
    if (mappings?.dimensionColumns?.includes(column)) roles.add('dimension');
    if (mappings?.referenceColumns?.includes(column)) roles.add('reference');
    return roles;
  };

  removedColumns.forEach(previousColumn => {
    const previousRoles = mappingRoles(previousColumn, previousMappings);
    const hasMeaningfulValue = commonRows.some(({ previousRow }) => previousRow[previousColumn] != null && previousRow[previousColumn] !== '');
    if (!hasMeaningfulValue) return;
    const matches = addedColumns.filter(nextColumn => {
      const nextRoles = mappingRoles(nextColumn, nextMappings);
      const roleCompatible = !previousRoles.size || !nextRoles.size || [...previousRoles].some(role => nextRoles.has(role));
      return roleCompatible && commonRows.every(({ previousRow, nextRow }) =>
        comparableColumnValue(previousRow[previousColumn]) === comparableColumnValue(nextRow[nextColumn])
      );
    });
    if (matches.length) candidates.set(previousColumn, matches);
  });

  const renameMap: Record<string, string> = {};
  candidates.forEach((matches, previousColumn) => {
    if (matches.length !== 1) return;
    const nextColumn = matches[0];
    const reverseMatches = [...candidates.values()].filter(candidateMatches => candidateMatches.includes(nextColumn));
    if (reverseMatches.length === 1) renameMap[previousColumn] = nextColumn;
  });
  return renameMap;
};

export const remapTaskDatasetBinding = (
  binding: DatasetTaskBinding,
  _previousMappings?: DatasetColumnMappings,
  nextMappings?: DatasetColumnMappings,
  nextColumnKeys: string[] = [],
  columnRenameMap: Record<string, string> = {}
): DatasetTaskBinding => {
  const next = {
    input: nextMappings?.inputColumns || [],
    output: nextMappings?.outputColumns || [],
    dimension: nextMappings?.dimensionColumns || [],
    reference: nextMappings?.referenceColumns || [],
  };
  const availableKeys = new Set([
    ...nextColumnKeys,
    ...next.input,
    ...next.output,
    ...next.dimension,
    ...next.reference,
  ]);
  const remap = (column: string) => {
    if (availableKeys.has(column)) return column;
    const renamedColumn = columnRenameMap[column];
    return renamedColumn && availableKeys.has(renamedColumn) ? renamedColumn : column;
  };
  const remapExisting = (columns: string[]) => columns.map(remap).filter(column => availableKeys.has(column));
  return {
    ...binding,
    inputColumns: remapExisting(binding.inputColumns),
    dimensionColumns: remapExisting(binding.dimensionColumns),
    referenceColumns: remapExisting(binding.referenceColumns),
    modelColumns: Object.fromEntries(Object.entries(binding.modelColumns).map(([modelId, column]) => [
      modelId,
      remap(column),
    ])),
  };
};

const resolveSourceMedia = (row: Record<string, any>, inputColumns: string[]) => {
  let startImageUrl: string | undefined;
  const referenceUrls: string[] = [];
  inputColumns.forEach(column => {
    const urls = extractMediaUrls(row[column]);
    if (!urls.length) return;
    const lowerColumn = column.toLowerCase();
    const isAudio = /music|audio|bgm|配乐|音乐|音频/.test(lowerColumn);
    const isStart = /start|首帧|first/.test(lowerColumn);
    const isReference = /ref|reference|参考|image_json|music_json/.test(lowerColumn) || isAudio;
    urls.forEach(url => {
      if (isAudio || (isReference && !isStart)) {
        referenceUrls.push(url);
      } else if (isStart && !startImageUrl) {
        startImageUrl = url;
      } else if (!startImageUrl) {
        startImageUrl = url;
      } else {
        referenceUrls.push(url);
      }
    });
  });
  return {
    startImageUrl,
    referenceUrls: referenceUrls.length ? sortReferenceUrls(referenceUrls) : undefined,
  };
};

const buildSourceItem = (
  task: EvalTask,
  binding: DatasetTaskBinding,
  row: Record<string, any>,
  nextVersion: number,
  pair?: { modelA: { id: string; name: string }; modelB: { id: string; name: string }; pairId: string }
): Omit<EvaluationItem, 'id'> => {
  const inputs = Object.fromEntries(binding.inputColumns.map(column => [column, row[column]]));
  const prompt = binding.inputColumns.length === 1
    ? row[binding.inputColumns[0]]
    : binding.inputColumns.map(column => `[${column}]: ${String(row[column] ?? '')}`).join('\n');
  const selectedModels = pair ? [pair.modelA, pair.modelB] : task.models;
  const modelOutputs = selectedModels.map(model => ({
    modelId: model.id,
    modelName: model.name,
    url: resolvePlaybackUrl(row[binding.modelColumns[model.id] || model.name]),
  }));
  const media = resolveSourceMedia(row, [...binding.inputColumns, ...binding.referenceColumns]);
  const originalItemId = getDatasetRowCaseId(row);

  return {
    modelA_Url: modelOutputs[0]?.url || '',
    modelB_Url: modelOutputs[1]?.url || '',
    modelOutputs,
    prompt: String(prompt ?? ''),
    inputs,
    dimensionValues: getDimensionValuesFromRecord(row, binding.dimensionColumns),
    type: task.outputType || 'text',
    originalData: stripDatasetInternalFields(row),
    originalItemId,
    sourceDatasetItemId: getDatasetItemStableId(row),
    sourceDatasetVersion: nextVersion,
    ...(media.startImageUrl ? { startImageUrl: media.startImageUrl } : {}),
    ...(media.referenceUrls ? { referenceUrls: media.referenceUrls } : {}),
    ...(pair ? {
      pairContext: {
        pairId: pair.pairId,
        originalItemId,
        modelAId: pair.modelA.id,
        modelAName: pair.modelA.name,
        modelBId: pair.modelB.id,
        modelBName: pair.modelB.name,
      },
    } : {}),
  };
};

const makeTaskItemId = (taskId: string, stableItemId: string, suffix = '') =>
  `${taskId}:source:${hashString(stableItemId)}${suffix ? `:${suffix}` : ''}`;

export const createTaskItemsForDatasetRow = (
  task: EvalTask,
  binding: DatasetTaskBinding,
  row: Record<string, any>,
  nextVersion: number,
  startingOrder = 0
): EvaluationItem[] => {
  const stableItemId = getDatasetItemStableId(row);
  const config = task.evaluationConfig;
  if (config?.method === 'pairwise' && config.pairwiseMode !== 'arena_sampled') {
    return buildPairwisePairs(task.models, config.pairwiseMode).map((pair, index) => ({
      id: makeTaskItemId(task.id, stableItemId, pair.pairId),
      ...buildSourceItem(task, binding, row, nextVersion, pair),
      itemOrder: startingOrder + index,
      isSwapped: config.blind !== false ? hashString(`${task.id}|${stableItemId}|${pair.pairId}`).charCodeAt(0) % 2 === 0 : false,
    }));
  }

  return [{
    id: makeTaskItemId(task.id, stableItemId),
    ...buildSourceItem(task, binding, row, nextVersion),
    itemOrder: startingOrder,
    isSwapped: config?.method === 'ab_preference' && config.blind !== false
      ? hashString(`${task.id}|${stableItemId}`).charCodeAt(0) % 2 === 0
      : false,
  }];
};

const resolveExistingStableId = (
  item: EvaluationItem,
  previousRows: Record<string, any>[],
  previousByCaseId: Map<string, Record<string, any>[]>
) => item.sourceDatasetItemId
  || (() => {
    const rowMatch = item.id.match(/(?:^|:)row-(\d+)(?:__|$)/);
    const rowIndex = rowMatch ? Number(rowMatch[1]) : NaN;
    if (Number.isInteger(rowIndex) && previousRows[rowIndex]) {
      return getDatasetItemStableId(previousRows[rowIndex]);
    }
    const sourceCaseId = item.originalItemId || item.pairContext?.originalItemId || '';
    const candidates = previousByCaseId.get(sourceCaseId) || [];
    return candidates.length === 1 ? getDatasetItemStableId(candidates[0]) : '';
  })();

export interface DatasetTaskSyncPlan {
  binding: DatasetTaskBinding;
  updates: Array<{ itemId: string; item: EvaluationItem }>;
  additions: EvaluationItem[];
  archives: Array<{ itemId: string; item: EvaluationItem }>;
  warnings: string[];
}

export const planDatasetTaskSync = ({
  task,
  previousRows,
  nextRows,
  taskItems,
  nextVersion,
}: {
  task: EvalTask;
  previousRows: Record<string, any>[];
  nextRows: Record<string, any>[];
  taskItems: EvaluationItem[];
  nextVersion: number;
}): DatasetTaskSyncPlan => {
  const binding = inferTaskDatasetBinding(task, taskItems);
  const normalizedPrevious = ensureStableDatasetItemIds(task.datasetId, previousRows);
  const normalizedNext = ensureStableDatasetItemIds(task.datasetId, nextRows);
  const previousByCaseId = new Map<string, Record<string, any>[]>();
  normalizedPrevious.forEach((row, index) => {
    const caseId = getDatasetRowCaseId(row, index);
    previousByCaseId.set(caseId, [...(previousByCaseId.get(caseId) || []), row]);
  });
  const nextByStableId = new Map(normalizedNext.map(row => [getDatasetItemStableId(row), row]));
  const existingStableIds = new Set<string>();
  const updates: DatasetTaskSyncPlan['updates'] = [];
  const archives: DatasetTaskSyncPlan['archives'] = [];
  const warnings: string[] = [];
  let hasUnmatchedLegacyItems = false;

  taskItems.forEach(existing => {
    const stableItemId = resolveExistingStableId(existing, normalizedPrevious, previousByCaseId);
    if (!stableItemId) {
      hasUnmatchedLegacyItems = true;
      warnings.push(`任务 ${task.name} 的 item ${existing.id} 无法匹配来源 case`);
      return;
    }
    existingStableIds.add(stableItemId);
    const nextRow = nextByStableId.get(stableItemId);
    if (!nextRow) {
      if (task.status !== 'completed') {
        archives.push({
          itemId: existing.id,
          item: { ...existing, archivedReason: `来源评测集 v${nextVersion} 已移除`, sourceDatasetVersion: nextVersion },
        });
      }
      return;
    }

    const modelNameById = new Map(task.models.map(model => [model.id, model.name]));
    const usesFixedPairItems = task.evaluationConfig?.method === 'pairwise'
      && task.evaluationConfig.pairwiseMode !== 'arena_sampled';
    const pair = usesFixedPairItems && existing.pairContext ? {
      pairId: existing.pairContext.pairId || `${existing.pairContext.modelAId}__${existing.pairContext.modelBId}`,
      modelA: { id: existing.pairContext.modelAId, name: modelNameById.get(existing.pairContext.modelAId) || existing.pairContext.modelAName },
      modelB: { id: existing.pairContext.modelBId, name: modelNameById.get(existing.pairContext.modelBId) || existing.pairContext.modelBName },
    } : undefined;
    const sourceItem = buildSourceItem(task, binding, nextRow, nextVersion, pair);
    updates.push({
      itemId: existing.id,
      item: {
        ...existing,
        ...sourceItem,
        id: existing.id,
        itemOrder: existing.itemOrder,
        isSwapped: existing.isSwapped,
        pairContext: existing.pairContext ? {
          ...existing.pairContext,
          ...sourceItem.pairContext,
          assignmentId: existing.pairContext.assignmentId,
          leftModelId: existing.pairContext.leftModelId,
          rightModelId: existing.pairContext.rightModelId,
          samplingPhase: existing.pairContext.samplingPhase,
          samplingProbability: existing.pairContext.samplingProbability,
          eligiblePairCount: existing.pairContext.eligiblePairCount,
          schedulerVersion: existing.pairContext.schedulerVersion,
        } : sourceItem.pairContext,
      },
    });
  });

  const additions: EvaluationItem[] = [];
  if (task.status !== 'completed' && !hasUnmatchedLegacyItems) {
    let nextOrder = taskItems.reduce((max, item) => Math.max(max, item.itemOrder ?? 0), -1) + 1;
    normalizedNext.forEach(row => {
      if (existingStableIds.has(getDatasetItemStableId(row))) return;
      const created = createTaskItemsForDatasetRow(task, binding, row, nextVersion, nextOrder);
      additions.push(...created);
      nextOrder += created.length;
    });
  }

  Object.entries(binding.modelColumns).forEach(([modelId, column]) => {
    if (!normalizedNext.some(row => Object.prototype.hasOwnProperty.call(row, column))) {
      warnings.push(`Task ${task.name}: model ${modelId} is bound to missing column ${column}`);
    }
  });

  return {
    binding: { ...binding, datasetVersion: nextVersion },
    updates,
    additions,
    archives,
    warnings,
  };
};

export const synchronizeVoteSnapshot = (
  vote: VoteRecord,
  latestItem: EvaluationItem,
  currentVersion: number
): VoteRecord => {
  const latestSnapshot = createVoteItemSnapshot(latestItem);
  const evaluatedItemSnapshot = vote.evaluatedItemSnapshot || vote.itemSnapshot || latestSnapshot;
  const evaluatedVersion = vote.datasetVersionEvaluated
    || vote.itemSnapshot?.sourceDatasetVersion
    || vote.datasetVersionCurrent
    || Math.max(1, currentVersion - 1);
  const comparableSnapshot = (snapshot?: VoteItemSnapshot) => {
    if (!snapshot) return '';
    const { sourceDatasetVersion: _sourceDatasetVersion, ...content } = snapshot;
    return JSON.stringify(content);
  };
  return {
    ...vote,
    evaluatedItemSnapshot,
    itemSnapshot: latestSnapshot,
    datasetVersionEvaluated: evaluatedVersion,
    datasetVersionCurrent: currentVersion,
    contentUpdatedAfterVote: comparableSnapshot(evaluatedItemSnapshot) !== comparableSnapshot(latestSnapshot),
  };
};
