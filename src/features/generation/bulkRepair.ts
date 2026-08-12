import type {
  DatasetSchemaField,
  GenerationCaseInputOverrideV1,
  GenerationCaseReview,
  GenerationPreflightCase,
  GenerationPreflightIssue,
  GenerationPreflightRepairAction,
} from '../../types.js';

type ContentField = keyof NonNullable<GenerationCaseInputOverrideV1['content']>;

export type GenerationBulkRepairAction =
  | { kind: 'set_parameter'; field: string; value: unknown }
  | { kind: 'use_parameter_column'; field: string; column: string }
  | { kind: 'omit_parameter'; field: string }
  | { kind: 'keep_keyframes'; omitFields: Array<'elements' | 'audios'> }
  | { kind: 'keep_references'; omitFields: ['image_urls'] }
  | { kind: 'trim_content'; field: 'image_urls' | 'images' | 'elements' | 'audios'; maximum: number }
  | {
      kind: 'remove_content_item';
      field: 'image_urls' | 'images' | 'elements' | 'audios';
      index: number;
    };

export interface GenerationBulkRepairCaseSummary {
  datasetItemId: string;
  caseId: string;
  rawValue?: unknown;
  normalizedValue?: unknown;
  sourceColumn?: string;
  expertConflict: boolean;
}

export interface GenerationBulkRepairWorkspace {
  severity: 'error' | 'warning';
  code: string;
  field: string;
  targetIds: string[];
  eligibleIds: string[];
  expertConflictIds: string[];
  missingStableIdCount: number;
  valueDistribution: Array<{ value: string; count: number }>;
  commonActions: GenerationPreflightRepairAction[];
  cases: GenerationBulkRepairCaseSummary[];
}

const clone = <T>(value: T): T => (
  value === undefined ? value : JSON.parse(JSON.stringify(value)) as T
);

const compactReview = (review: GenerationCaseReview): GenerationCaseReview => {
  const next = clone(review);
  if (next.inputOverride) {
    if (!Object.keys(next.inputOverride.content || {}).length) delete next.inputOverride.content;
    if (!Object.keys(next.inputOverride.parameters || {}).length) delete next.inputOverride.parameters;
    if (!next.inputOverride.content && !next.inputOverride.parameters) delete next.inputOverride;
  }
  if (next.parameterColumnOverrides && !Object.keys(next.parameterColumnOverrides).length) {
    delete next.parameterColumnOverrides;
  }
  delete next.force;
  return next;
};

const issueMatches = (
  issue: GenerationPreflightIssue,
  code: string,
  field: string,
) => issue.code === code && String(issue.field || '') === field;

const issueFor = (
  item: GenerationPreflightCase,
  severity: 'error' | 'warning',
  code: string,
  field: string,
) => (severity === 'error' ? item.errors : item.warnings)
  .find(issue => issueMatches(issue, code, field));

const actionIdentity = (action: GenerationPreflightRepairAction) => {
  if (action.kind === 'set_parameter' || action.kind === 'use_parameter_column' || action.kind === 'omit_parameter') {
    return `${action.kind}:${action.field}`;
  }
  if (action.kind === 'trim_content') return `${action.kind}:${action.field}:${action.maximum}`;
  if (action.kind === 'remove_content_item') return `${action.kind}:${action.field}:${action.index}`;
  return action.kind;
};

const stableDisplay = (value: unknown) => {
  if (value === undefined) return '未提供';
  if (value === null) return 'null';
  if (typeof value === 'string') return value || '空字符串';
  return JSON.stringify(value);
};

export const buildGenerationBulkRepairWorkspace = ({
  cases,
  reviews,
  severity,
  code,
  field,
}: {
  cases: GenerationPreflightCase[];
  reviews: Record<string, GenerationCaseReview>;
  severity: 'error' | 'warning';
  code: string;
  field: string;
}): GenerationBulkRepairWorkspace => {
  const matches = cases.flatMap(item => {
    const issue = issueFor(item, severity, code, field);
    return issue ? [{ item, issue }] : [];
  });
  const expertConflictIds: string[] = [];
  let missingStableIdCount = 0;
  const targetIds: string[] = [];
  const eligibleIds: string[] = [];
  const summaries: GenerationBulkRepairCaseSummary[] = [];
  const distribution = new Map<string, number>();

  matches.forEach(({ item, issue }) => {
    const datasetItemId = String(item.resolvedCase.datasetItemId || '');
    const caseId = String(item.resolvedCase.caseId || datasetItemId || '未命名 case');
    const effectiveReview = reviews[datasetItemId] || item.resolvedCase.compilerAudit?.review || {};
    const expertConflict = Boolean(effectiveReview.finalAionRequest);
    const value = issue.evidence?.rawValue ?? issue.evidence?.normalizedValue;
    const display = stableDisplay(value);
    distribution.set(display, (distribution.get(display) || 0) + 1);
    if (!datasetItemId) missingStableIdCount += 1;
    else {
      targetIds.push(datasetItemId);
      if (expertConflict) expertConflictIds.push(datasetItemId);
      else eligibleIds.push(datasetItemId);
    }
    summaries.push({
      datasetItemId,
      caseId,
      ...(issue.evidence?.rawValue !== undefined ? { rawValue: issue.evidence.rawValue } : {}),
      ...(issue.evidence?.normalizedValue !== undefined
        ? { normalizedValue: issue.evidence.normalizedValue }
        : {}),
      ...(issue.evidence?.sourceColumn ? { sourceColumn: issue.evidence.sourceColumn } : {}),
      expertConflict,
    });
  });

  const eligibleIssues = matches
    .filter(({ item }) => eligibleIds.includes(String(item.resolvedCase.datasetItemId || '')))
    .map(({ issue }) => issue);
  const firstActions = eligibleIssues[0]?.repairActions || [];
  const commonActions = firstActions.filter(action => eligibleIssues.every(issue => (
    (issue.repairActions || []).some(candidate => actionIdentity(candidate) === actionIdentity(action))
  )));

  return {
    severity,
    code,
    field,
    targetIds,
    eligibleIds,
    expertConflictIds,
    missingStableIdCount,
    valueDistribution: Array.from(distribution.entries()).map(([value, count]) => ({ value, count })),
    commonActions,
    cases: summaries,
  };
};

const currentCanonicalInput = (item: GenerationPreflightCase) => {
  const audit = item.resolvedCase.compilerAudit || {};
  return clone(
    audit.caseInputOverride?.effectiveInput
      || audit.compiledInput
      || audit.mcpToolInput
      || {},
  ) as Record<string, unknown>;
};

const setParameterOperation = (
  review: GenerationCaseReview,
  field: string,
  operation: { action: 'set'; value: unknown } | { action: 'omit' },
) => {
  const next = clone(review);
  const parameters = { ...(next.inputOverride?.parameters || {}), [field]: operation };
  next.inputOverride = { version: 1, content: next.inputOverride?.content, parameters };
  if (next.parameterColumnOverrides) delete next.parameterColumnOverrides[field];
  return compactReview(next);
};

const setParameterColumn = (
  review: GenerationCaseReview,
  field: string,
  column: string,
) => {
  const next = clone(review);
  const parameters = { ...(next.inputOverride?.parameters || {}) };
  delete parameters[field];
  next.inputOverride = { version: 1, content: next.inputOverride?.content, parameters };
  next.parameterColumnOverrides = {
    ...(next.parameterColumnOverrides || {}),
    [field]: { version: 1, column },
  };
  return compactReview(next);
};

const setContentOperations = (
  review: GenerationCaseReview,
  operations: Partial<Record<ContentField, { action: 'set'; value: unknown } | { action: 'omit' }>>,
) => {
  const next = clone(review);
  next.inputOverride = {
    version: 1,
    content: { ...(next.inputOverride?.content || {}), ...operations },
    parameters: next.inputOverride?.parameters,
  };
  return compactReview(next);
};

const actionIsDeclared = (
  issue: GenerationPreflightIssue,
  action: GenerationBulkRepairAction,
) => (issue.repairActions || []).some(candidate => {
  if (candidate.kind !== action.kind) return false;
  if ('field' in candidate && 'field' in action && candidate.field !== action.field) return false;
  if (candidate.kind === 'trim_content' && action.kind === 'trim_content') {
    return candidate.maximum === action.maximum;
  }
  if (candidate.kind === 'remove_content_item' && action.kind === 'remove_content_item') {
    return candidate.index === action.index;
  }
  return true;
});

export const applyBulkGenerationRepair = ({
  workspace,
  cases,
  reviews,
  selectedIds,
  action,
}: {
  workspace: GenerationBulkRepairWorkspace;
  cases: GenerationPreflightCase[];
  reviews: Record<string, GenerationCaseReview>;
  selectedIds: string[];
  action: GenerationBulkRepairAction;
}) => {
  const selected = new Set(selectedIds);
  const allowed = new Set(workspace.eligibleIds);
  const next = clone(reviews);
  const appliedIds: string[] = [];
  const unsupportedActionIds: string[] = [];

  cases.forEach(item => {
    const datasetItemId = String(item.resolvedCase.datasetItemId || '');
    if (!datasetItemId || !selected.has(datasetItemId) || !allowed.has(datasetItemId)) return;
    const issue = issueFor(item, workspace.severity, workspace.code, workspace.field);
    if (!issue || !actionIsDeclared(issue, action)) {
      unsupportedActionIds.push(datasetItemId);
      return;
    }
    const review = next[datasetItemId] || item.resolvedCase.compilerAudit?.review || {};
    if (review.finalAionRequest) return;
    if (action.kind === 'set_parameter') {
      next[datasetItemId] = setParameterOperation(review, action.field, {
        action: 'set',
        value: clone(action.value),
      });
    } else if (action.kind === 'use_parameter_column') {
      next[datasetItemId] = setParameterColumn(review, action.field, action.column);
    } else if (action.kind === 'omit_parameter') {
      next[datasetItemId] = setParameterOperation(review, action.field, { action: 'omit' });
    } else if (action.kind === 'keep_keyframes' || action.kind === 'keep_references') {
      next[datasetItemId] = setContentOperations(review, Object.fromEntries(
        action.omitFields.map(field => [field, { action: 'omit' as const }]),
      ));
    } else {
      const input = currentCanonicalInput(item);
      const current = Array.isArray(input[action.field]) ? input[action.field] as unknown[] : [];
      const values = action.kind === 'trim_content'
        ? current.slice(0, action.maximum)
        : current.filter((_value, index) => index !== action.index);
      next[datasetItemId] = setContentOperations(review, {
        [action.field]: values.length
          ? { action: 'set', value: values }
          : { action: 'omit' },
      });
    }
    appliedIds.push(datasetItemId);
  });

  return { reviews: next, appliedIds, unsupportedActionIds };
};

export const generationParameterEditorValue = (
  currentValue: unknown,
  options: string[],
  operation?: { action: 'set'; value: unknown } | { action: 'omit' },
) => {
  if (operation?.action === 'omit') return '';
  if (operation?.action === 'set') return String(operation.value ?? '');
  const current = String(currentValue ?? '');
  return options.includes(current) ? current : '';
};

export const generationParameterReplacementColumns = ({
  headers,
  inputSchema,
  currentColumn,
  outputColumns,
  referenceColumns,
}: {
  headers: string[];
  inputSchema: DatasetSchemaField[];
  currentColumn?: string;
  outputColumns: string[];
  referenceColumns?: string[];
}) => {
  const fields = new Map(inputSchema.map(field => [field.key, field]));
  const excluded = new Set([...(outputColumns || []), ...(referenceColumns || [])]);
  return headers.filter(column => {
    if (!column || column === currentColumn || column === '_originalData' || column.startsWith('__')) return false;
    if (excluded.has(column)) return false;
    const field = fields.get(column);
    if (!field) return true;
    if (field.type !== 'text') return false;
    return !['output', 'system', 'media', 'reference', 'case_id', 'rubric']
      .includes(String(field.role || ''));
  });
};

export const excludeGenerationCaseIds = (currentIds: string[], excludedIds: string[]) => {
  const excluded = new Set(excludedIds);
  return currentIds.filter(id => !excluded.has(id));
};

export const restoreGenerationCaseIds = (
  currentIds: string[],
  restoredIds: string[],
  canonicalOrder: string[],
) => {
  const restored = new Set([...currentIds, ...restoredIds]);
  return canonicalOrder.filter(id => restored.has(id));
};
