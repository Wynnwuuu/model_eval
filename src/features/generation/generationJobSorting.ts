import type {
  GenerationJobSortDirection,
  GenerationJobSortField,
  GenerationJobStatus,
} from '../../types.js';

export const GENERATION_JOB_SORT_FIELDS = [
  'dataset',
  'model',
  'status',
  'creator',
  'createdAt',
  'updatedAt',
] as const satisfies readonly GenerationJobSortField[];

export const GENERATION_JOB_SORT_DIRECTIONS = [
  'asc',
  'desc',
] as const satisfies readonly GenerationJobSortDirection[];

export const GENERATION_JOB_STATUS_SORT_ORDER = [
  'running',
  'queued',
  'writeback_conflict',
  'failed',
  'partial',
  'completed',
  'cancelled',
  'draft',
] as const satisfies readonly GenerationJobStatus[];

export const isGenerationJobSortField = (value: unknown): value is GenerationJobSortField =>
  typeof value === 'string'
  && (GENERATION_JOB_SORT_FIELDS as readonly string[]).includes(value);

export const isGenerationJobSortDirection = (value: unknown): value is GenerationJobSortDirection =>
  typeof value === 'string'
  && (GENERATION_JOB_SORT_DIRECTIONS as readonly string[]).includes(value);

export type GenerationJobSortState = {
  sortBy?: GenerationJobSortField;
  sortDirection?: GenerationJobSortDirection;
};

export const nextGenerationJobSort = (
  current: GenerationJobSortState,
  selectedField: GenerationJobSortField,
): GenerationJobSortState => {
  if (current.sortBy !== selectedField) {
    return { sortBy: selectedField, sortDirection: 'asc' };
  }
  if (current.sortDirection === 'asc') {
    return { sortBy: selectedField, sortDirection: 'desc' };
  }
  return {};
};
