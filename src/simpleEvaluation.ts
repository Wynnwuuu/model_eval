export interface SimpleVariant {
  id: string;
  name: string;
  modelName: string;
  promptName?: string | null;
  isBaseline: boolean;
}

export interface SimpleCase {
  id: string;
  category: string;
  audioUrl: string;
  durationSeconds: number;
  outputs: Record<string, string>;
}

export interface SimpleDataset {
  id: string;
  title: string;
  variants: SimpleVariant[];
  cases: SimpleCase[];
}

export interface SimpleReview {
  status: 'ranked' | 'skipped';
  order: string[];
  optionOrder: string[];
  savedAt: string;
}

export interface SimpleSession {
  version: 1;
  revision: number;
  datasetId: string;
  reviewerId: string;
  currentIndex: number;
  reviews: Record<string, SimpleReview>;
}

type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>;
const REVIEWER_KEY = 'model_eval_reviewer_v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const simpleStorageKey = (datasetId: string) => `model_eval_reviews_v1:${datasetId}`;
export class SimpleStorageConflictError extends Error {
  constructor() { super('另一个页面已更新本地进度，当前排序尚未保存。请重新读取本地进度后再评审，避免覆盖其他页面的评价。'); }
}

export function isCompleteOrder(order: unknown, variantIds: string[]): order is string[] {
  return Array.isArray(order) && order.length === variantIds.length && new Set(order).size === variantIds.length
    && order.every(id => typeof id === 'string' && variantIds.includes(id));
}

export function validateSimpleDataset(value: unknown): SimpleDataset {
  const dataset = value as SimpleDataset;
  if (!dataset || typeof dataset.id !== 'string' || !dataset.id || typeof dataset.title !== 'string'
    || !Array.isArray(dataset.variants) || dataset.variants.length !== 5 || !Array.isArray(dataset.cases) || !dataset.cases.length) {
    throw new Error('内置评测数据不完整，需要 5 个方案和至少 1 条音频。');
  }
  const ids = dataset.variants.map(variant => variant?.id);
  if (new Set(ids).size !== ids.length || dataset.variants.some(variant => !variant || !variant.id || typeof variant.name !== 'string'
    || typeof variant.modelName !== 'string' || typeof variant.isBaseline !== 'boolean')) throw new Error('内置方案定义无效。');
  if (new Set(dataset.cases.map(item => item?.id)).size !== dataset.cases.length || dataset.cases.some(item => !item || typeof item.id !== 'string'
    || !item.id || typeof item.audioUrl !== 'string' || !item.audioUrl.startsWith('/audio/') || !item.outputs
    || Object.keys(item.outputs).length !== ids.length || ids.some(id => typeof item.outputs[id] !== 'string' || !item.outputs[id].trim()))) {
    throw new Error('内置音频或分析结果缺失，请使用完整的数据包。');
  }
  return dataset;
}

export function blindVariantOrder(dataset: SimpleDataset, reviewerId: string, caseId: string): string[] {
  const text = JSON.stringify([dataset.id, reviewerId, caseId]);
  let seed = 2166136261;
  for (let i = 0; i < text.length; i++) seed = Math.imul(seed ^ text.charCodeAt(i), 16777619) >>> 0;
  const random = () => {
    seed += 0x6D2B79F5;
    let value = seed;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
  const order = dataset.variants.map(variant => variant.id).sort();
  for (let i = order.length - 1; i > 0; i--) {
    const target = Math.floor(random() * (i + 1));
    [order[i], order[target]] = [order[target], order[i]];
  }
  return order;
}

export function moveSimpleVariant(order: string[], variantId: string, target: number): string[] {
  const from = order.indexOf(variantId);
  if (from < 0 || !Number.isInteger(target) || target < 0 || target >= order.length) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(target, 0, variantId);
  return next;
}

export function emptySimpleSession(dataset: SimpleDataset, reviewerId: string = crypto.randomUUID()): SimpleSession {
  return { version: 1, revision: 0, datasetId: dataset.id, reviewerId, currentIndex: 0, reviews: {} };
}

function validateSession(dataset: SimpleDataset, value: unknown): SimpleSession {
  const state = value as SimpleSession;
  const variantIds = dataset.variants.map(variant => variant.id);
  const caseIds = new Set(dataset.cases.map(item => item.id));
  if (!state || state.version !== 1 || state.datasetId !== dataset.id || !UUID.test(state.reviewerId)
    || (state.revision !== undefined && (!Number.isInteger(state.revision) || state.revision < 0))
    || !Number.isInteger(state.currentIndex) || state.currentIndex < 0 || state.currentIndex >= dataset.cases.length
    || !state.reviews || typeof state.reviews !== 'object' || Array.isArray(state.reviews)
    || Object.entries(state.reviews).some(([caseId, review]) => !caseIds.has(caseId) || !review
      || !['ranked', 'skipped'].includes(review.status) || !Number.isFinite(Date.parse(review.savedAt))
      || !isCompleteOrder(review.optionOrder, variantIds)
      || (review.status === 'ranked' ? !isCompleteOrder(review.order, variantIds) : !Array.isArray(review.order) || review.order.length !== 0))) {
    throw new Error('当前数据集的本地进度无法读取，未覆盖已有记录。请保留浏览器数据并检查源码版本。');
  }
  return state.revision === undefined ? { ...state, revision: 0 } : state;
}

export function loadSimpleSession(dataset: SimpleDataset, storage: StorageAccess): SimpleSession {
  const stored = storage.getItem(simpleStorageKey(dataset.id));
  if (stored) return validateSession(dataset, JSON.parse(stored));
  let reviewerId = storage.getItem(REVIEWER_KEY);
  if (!reviewerId || !UUID.test(reviewerId)) {
    reviewerId = crypto.randomUUID();
    storage.setItem(REVIEWER_KEY, reviewerId);
  }
  const state = emptySimpleSession(dataset, reviewerId);
  storage.setItem(simpleStorageKey(dataset.id), JSON.stringify(state));
  return state;
}

export function persistSimpleSession(dataset: SimpleDataset, state: SimpleSession, storage: StorageAccess): SimpleSession {
  validateSession(dataset, state);
  const raw = storage.getItem(simpleStorageKey(dataset.id));
  if (!raw) throw new SimpleStorageConflictError();
  let current: SimpleSession;
  try { current = validateSession(dataset, JSON.parse(raw)); }
  catch { throw new SimpleStorageConflictError(); }
  if (current.revision !== state.revision || current.reviewerId !== state.reviewerId) throw new SimpleStorageConflictError();
  const next = { ...state, revision: state.revision + 1 };
  // No React state changes until this write succeeds: failed saves remain retryable.
  storage.setItem(simpleStorageKey(dataset.id), JSON.stringify(next));
  return next;
}

export function buildSimpleResultsCsv(dataset: SimpleDataset, state: SimpleSession): string {
  validateSession(dataset, state);
  const rows: (string | number | boolean)[][] = [[
    'DatasetID', 'ReviewerID', 'SourceID', 'Category', 'AudioFile', 'Status', 'SavedAt',
    'VariantID', 'ModelName', 'PromptName', 'IsBaseline', 'BlindLabel', 'Rank',
  ]];
  for (const item of dataset.cases) {
    const review = state.reviews[item.id];
    if (!review) continue;
    const prefix = [dataset.id, state.reviewerId, item.id, item.category, item.audioUrl, review.status, review.savedAt];
    if (review.status === 'skipped') {
      rows.push([...prefix, '', '', '', '', '', '']);
      continue;
    }
    review.order.forEach((id, index) => {
      const variant = dataset.variants.find(entry => entry.id === id)!;
      rows.push([...prefix, id, variant.modelName, variant.promptName || '', variant.isBaseline,
        String.fromCharCode(65 + review.optionOrder.indexOf(id)), index + 1]);
    });
  }
  return '\uFEFF' + rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n';
}
