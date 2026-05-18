import { badRequest } from './errors.ts';

export const isRecord = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const requireObject = (value: unknown, fieldName: string) => {
  if (!isRecord(value)) {
    throw badRequest(`${fieldName} must be an object`);
  }
  return value;
};

export const requireBodyObject = (body: unknown, fieldName: string) => {
  const payload = requireObject(body, 'request body');
  return requireObject(payload[fieldName], fieldName);
};

export const requireArray = (value: unknown, fieldName: string) => {
  if (!Array.isArray(value)) {
    throw badRequest(`${fieldName} must be an array`);
  }
  return value;
};

export const optionalArray = (value: unknown, fieldName: string) => {
  if (value === undefined) return [];
  return requireArray(value, fieldName);
};

export const requireNonEmptyString = (value: unknown, fieldName: string) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw badRequest(`${fieldName} is required`);
  }
  return value.trim();
};

export const optionalNumber = (value: unknown, fieldName: string, fallback = 0) => {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw badRequest(`${fieldName} must be a number`);
  }
  return parsed;
};

export const validateProjectPayload = (project: Record<string, any>) => {
  requireNonEmptyString(project.name, 'project.name');
};

export const validateDatasetPayload = (dataset: Record<string, any>) => {
  requireNonEmptyString(dataset.name, 'dataset.name');
  requireArray(dataset.items, 'dataset.items');
  requireArray(dataset.inputSchema, 'dataset.inputSchema');
};

export const validateTemplatePayload = (template: Record<string, any>) => {
  requireNonEmptyString(template.name, 'template.name');
  requireNonEmptyString(template.paradigm, 'template.paradigm');
  requireArray(template.dimensions, 'template.dimensions');
};

export const validateTaskPayload = (task: Record<string, any>) => {
  requireNonEmptyString(task.name, 'task.name');
  requireNonEmptyString(task.datasetId, 'task.datasetId');
  requireArray(task.models, 'task.models');
};

export const validateGenerationJobPayload = (job: Record<string, any>) => {
  requireNonEmptyString(job.datasetId, 'job.datasetId');
  requireNonEmptyString(job.targetColumn, 'job.targetColumn');
  requireObject(job.modelConfig, 'job.modelConfig');
};

export const validateGenerationJobItemPayload = (item: Record<string, any>) => {
  requireNonEmptyString(item.datasetId, 'item.datasetId');
  requireNonEmptyString(item.caseId, 'item.caseId');
  requireNonEmptyString(item.status, 'item.status');
};
