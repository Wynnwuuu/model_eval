import type {
  DatasetGenerationJob,
  DatasetGenerationJobItem,
  EvalDataset,
  EvalTask,
  EvalTemplate,
  EvaluationItem,
  EvaluationProject,
  VoteRecord,
} from '../../src/types.ts';
import { ensureUserMembership, type RequestUser } from '../auth/context.ts';
import { saveDataset } from '../datasets/datasetRepository.ts';
import { saveGenerationJob, saveGenerationJobItem } from '../generation/generationRepository.ts';
import { createProject, getProject, updateProject } from '../projects/projectRepository.ts';
import { createTask, saveTaskUserVotes } from '../tasks/taskRepository.ts';
import { saveTemplate } from '../templates/templateRepository.ts';

export const LOCAL_PLATFORM_STORAGE_KEY = 'evaltrack_local_platform_v1';

export type CollectionStore = Record<string, Record<string, any>>;

export type MigrationCounts = {
  projects: number;
  datasets: number;
  templates: number;
  tasks: number;
  taskItems: number;
  voteUsers: number;
  generationJobs: number;
  generationJobItems: number;
};

export type LocalPlatformMigrationResult = {
  counts: MigrationCounts;
  warnings: string[];
  imported: boolean;
};

const emptyCounts = (): MigrationCounts => ({
  projects: 0,
  datasets: 0,
  templates: 0,
  tasks: 0,
  taskItems: 0,
  voteUsers: 0,
  generationJobs: 0,
  generationJobItems: 0,
});

const parseJsonText = (value: string) => JSON.parse(value.replace(/^\uFEFF/, ''));

const parseJson = (input: unknown) => {
  const first = typeof input === 'string' ? parseJsonText(input) : input;
  if (typeof first === 'string') return parseJsonText(first);
  if ((first as any)?.[LOCAL_PLATFORM_STORAGE_KEY]) {
    const nested = (first as any)[LOCAL_PLATFORM_STORAGE_KEY];
    return typeof nested === 'string' ? parseJsonText(nested) : nested;
  }
  return first;
};

const toRecord = (value: any): Record<string, any> => {
  if (!value) return {};
  if (Array.isArray(value)) {
    return Object.fromEntries(value.map((item, index) => [item.id || item.uid || `row-${index}`, item]));
  }
  if (Array.isArray(value.documents)) {
    return Object.fromEntries(value.documents.map((item: any, index: number) => [item.id || item.name || `row-${index}`, item]));
  }
  if (typeof value === 'object') return value;
  return {};
};

export const extractCollections = (input: unknown): CollectionStore => {
  const raw = parseJson(input);
  if (raw?.collections) return raw.collections;
  const collections: CollectionStore = {};
  [
    'projects',
    'evalDatasets',
    'evalTemplates',
    'evalTasks',
    'evalGenerationJobs',
    'users',
  ].forEach(name => {
    if (raw?.[name]) collections[name] = toRecord(raw[name]);
  });
  return collections;
};

const rowsWithIds = <T>(collection: Record<string, any>): T[] =>
  Object.entries(collection).map(([id, value]) => ({ id, ...(value || {}) }) as T);

const subcollectionRows = <T>(collections: CollectionStore, path: string): T[] =>
  rowsWithIds<T>(toRecord(collections[path]));

export const collectMigrationCounts = (collections: CollectionStore): MigrationCounts => {
  const counts = emptyCounts();
  const tasks = rowsWithIds<EvalTask>(toRecord(collections.evalTasks));
  const jobs = rowsWithIds<DatasetGenerationJob>(toRecord(collections.evalGenerationJobs));

  counts.projects = rowsWithIds<EvaluationProject>(toRecord(collections.projects)).length;
  counts.datasets = rowsWithIds<EvalDataset>(toRecord(collections.evalDatasets)).length;
  counts.templates = rowsWithIds<EvalTemplate>(toRecord(collections.evalTemplates)).length;
  counts.tasks = tasks.length;
  counts.taskItems = tasks.reduce((sum, task) => (
    sum + ((task as any).items?.length || subcollectionRows(collections, `evalTasks/${task.id}/items`).length)
  ), 0);
  counts.voteUsers = tasks.reduce((sum, task) => (
    sum + Object.keys((task as any).userVotes || collections[`evalTasks/${task.id}/userVotes`] || {}).length
  ), 0);
  counts.generationJobs = jobs.length;
  counts.generationJobItems = jobs.reduce((sum, job) => (
    sum + ((job as any).items?.length || subcollectionRows(collections, `evalGenerationJobs/${job.id}/items`).length)
  ), 0);
  return counts;
};

export const validateMigrationCollections = (collections: CollectionStore) => {
  const warnings: string[] = [];
  const requiredCollections = ['projects', 'evalDatasets', 'evalTemplates', 'evalTasks', 'evalGenerationJobs'];
  requiredCollections.forEach(name => {
    if (!collections[name]) warnings.push(`Missing collection "${name}", treated as empty.`);
  });

  rowsWithIds<EvalTask>(toRecord(collections.evalTasks)).forEach(task => {
    const itemCount = ((task as any).items?.length || subcollectionRows(collections, `evalTasks/${task.id}/items`).length);
    if (!itemCount) warnings.push(`Task "${task.id}" has no items.`);
  });

  rowsWithIds<DatasetGenerationJob>(toRecord(collections.evalGenerationJobs)).forEach(job => {
    if (!job.datasetId) warnings.push(`Generation job "${job.id}" has no datasetId.`);
  });

  return warnings;
};

const importProjects = async (collections: CollectionStore, user: RequestUser) => {
  for (const project of rowsWithIds<EvaluationProject>(toRecord(collections.projects))) {
    const existing = await getProject(project.id);
    if (existing) {
      await updateProject(project.id, project);
    } else {
      await createProject(project, user);
    }
  }
};

const importDatasets = async (collections: CollectionStore) => {
  for (const dataset of rowsWithIds<EvalDataset>(toRecord(collections.evalDatasets))) {
    await saveDataset({
      ...dataset,
      items: dataset.items || [],
      version: dataset.version || 1,
      versionHistory: dataset.versionHistory || [],
    });
  }
};

const importTemplates = async (collections: CollectionStore) => {
  for (const template of rowsWithIds<EvalTemplate>(toRecord(collections.evalTemplates))) {
    await saveTemplate({
      ...template,
      dimensions: template.dimensions || [],
      createdAt: template.createdAt || Date.now(),
    });
  }
};

const importTasks = async (collections: CollectionStore) => {
  for (const task of rowsWithIds<EvalTask>(toRecord(collections.evalTasks))) {
    const items = ((task as any).items || subcollectionRows<EvaluationItem>(collections, `evalTasks/${task.id}/items`))
      .map((item: EvaluationItem, index: number) => ({ ...item, id: item.id || `${task.id}:item:${index}` }));
    await createTask(task, items);

    const voteDocs = toRecord((task as any).userVotes || collections[`evalTasks/${task.id}/userVotes`]);
    for (const [userName, voteDoc] of Object.entries(voteDocs)) {
      const votes = (Array.isArray(voteDoc) ? voteDoc : voteDoc?.votes || []) as VoteRecord[];
      const progress = voteDoc?.progress ?? task.progress?.[userName] ?? votes.length;
      await saveTaskUserVotes(task.id, userName, votes, progress);
    }
  }
};

const importGeneration = async (collections: CollectionStore) => {
  for (const job of rowsWithIds<DatasetGenerationJob>(toRecord(collections.evalGenerationJobs))) {
    await saveGenerationJob(job);
    const items = ((job as any).items || subcollectionRows<DatasetGenerationJobItem>(collections, `evalGenerationJobs/${job.id}/items`))
      .map((item: DatasetGenerationJobItem) => ({ ...item, jobId: item.jobId || job.id }));
    for (const item of items) {
      await saveGenerationJobItem(item);
    }
  }
};

export const migrateLocalPlatformState = async (
  input: unknown,
  params: { dryRun?: boolean; user: RequestUser }
): Promise<LocalPlatformMigrationResult> => {
  const collections = extractCollections(input);
  const warnings = validateMigrationCollections(collections);
  const counts = collectMigrationCounts(collections);

  if (params.dryRun) {
    return { counts, warnings, imported: false };
  }

  const user = await ensureUserMembership(params.user);
  await importProjects(collections, user);
  await importDatasets(collections);
  await importTemplates(collections);
  await importTasks(collections);
  await importGeneration(collections);

  return { counts, warnings, imported: true };
};
