import type {
  Category,
  Dimension,
  EvaluationProject,
  EvaluationStep,
  Priority,
  ProjectType,
} from '../../types.ts';

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringValue = (value: unknown, fallback = '') =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const optionalString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const numberValue = (value: unknown, fallback = 0) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const stringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim())
    : [];

const normalizeStep = (value: unknown, index: number): EvaluationStep | null => {
  if (!isRecord(value)) return null;
  const status = value.status === 'completed' || value.status === 'in-progress' || value.status === 'pending'
    ? value.status
    : 'pending';
  const executionType = value.executionType === 'internal' || value.executionType === 'external'
    ? value.executionType
    : undefined;
  const rawId = numberValue(value.id, index + 1);
  const materialFile = isRecord(value.materialFile)
    && typeof value.materialFile.name === 'string'
    && typeof value.materialFile.url === 'string'
    ? { name: value.materialFile.name, url: value.materialFile.url }
    : undefined;

  return {
    id: Number.isInteger(rawId) && rawId > 0 ? rawId : index + 1,
    name: stringValue(value.name, `步骤 ${index + 1}`),
    owner: stringValue(value.owner, '待分配'),
    status,
    executionType,
    resultNote: optionalString(value.resultNote),
    materialFile,
  };
};

const normalizeDimensions = (value: unknown): Dimension[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!isRecord(item)) return [];
    const name = optionalString(item.name);
    const definition = optionalString(item.definition);
    const type = item.type === '主观' || item.type === '客观' || item.type === '混合' ? item.type : undefined;
    return name && definition && type ? [{ name, definition, type }] : [];
  });
};

const timestampValue = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

export const normalizeEvaluationProject = (
  value: unknown,
  fallbackId = '',
): EvaluationProject => {
  const project = isRecord(value) ? value : {};
  const createdAt = timestampValue(project.createdAt);
  const lastUpdated = timestampValue(project.lastUpdated) ?? createdAt ?? 0;

  return {
    id: stringValue(project.id, fallbackId),
    name: stringValue(project.name, '未命名项目'),
    category: stringValue(project.category, '产品上游模型能力评测') as Category,
    priority: stringValue(project.priority, 'P1') as Priority,
    type: stringValue(project.type, '轻度评测 (快速/专项)') as ProjectType,
    initiator: optionalString(project.initiator),
    initiatorUid: optionalString(project.initiatorUid),
    initiatorName: optionalString(project.initiatorName),
    goal: stringValue(project.goal),
    cycle: stringValue(project.cycle),
    support: stringArray(project.support),
    progress: Math.min(100, Math.max(0, numberValue(project.progress))),
    steps: Array.isArray(project.steps)
      ? project.steps.flatMap((step, index) => normalizeStep(step, index) || [])
      : [],
    resultSummary: stringValue(project.resultSummary, '待产出'),
    link: stringValue(project.link),
    datasetIds: stringArray(project.datasetIds),
    dimensions: normalizeDimensions(project.dimensions),
    generatedDataStatus: stringValue(project.generatedDataStatus, '未开始'),
    analysis: stringValue(project.analysis, '暂无'),
    lastUpdated,
    ...(createdAt === undefined ? {} : { createdAt }),
  };
};

export const normalizeEvaluationProjects = (value: unknown): EvaluationProject[] =>
  Array.isArray(value)
    ? value.map(project => normalizeEvaluationProject(project)).filter(project => project.id)
    : [];
