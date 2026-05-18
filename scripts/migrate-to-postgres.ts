import { readFile } from 'node:fs/promises';

import type {
  DatasetGenerationJob,
  DatasetGenerationJobItem,
  EvalDataset,
  EvalTask,
  EvalTemplate,
  EvaluationItem,
  EvaluationProject,
  VoteRecord,
} from '../src/types.ts';
import { ensureUserMembership, type RequestUser } from '../server/auth/context.ts';
import { saveDataset } from '../server/datasets/datasetRepository.ts';
import { saveGenerationJob, saveGenerationJobItem } from '../server/generation/generationRepository.ts';
import { createProject, getProject, updateProject } from '../server/projects/projectRepository.ts';
import { createTask, saveTaskUserVotes } from '../server/tasks/taskRepository.ts';
import { saveTemplate } from '../server/templates/templateRepository.ts';
import { closeDatabase } from '../server/db/client.ts';

const LOCAL_PLATFORM_STORAGE_KEY = 'evaltrack_local_platform_v1';

type CollectionStore = Record<string, Record<string, any>>;

type MigrationCounts = {
  projects: number;
  datasets: number;
  templates: number;
  tasks: number;
  taskItems: number;
  voteUsers: number;
  generationJobs: number;
  generationJobItems: number;
};

type MigrationArgs = {
  source?: string;
  dryRun: boolean;
  userId: string;
  userEmail: string;
  userName: string;
  organizationId: string;
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

const usage = () => `
Usage:
  npm run migrate:postgres -- --source ./local-export.json --dry-run
  npm run migrate:postgres -- --source ./local-export.json

Options:
  --source <path>             JSON export file from localStorage/localPlatform or Firestore-shaped export.
  --dry-run                   Parse and validate without writing PostgreSQL.
  --user-id <id>              Migration actor user id. Default: migration-user.
  --user-email <email>        Migration actor email. Default: migration-user@local.eval.
  --user-name <name>          Migration actor display name. Default: Migration User.
  --organization-id <id>      Organization id. Default: default.
`;

const parseArgs = (): MigrationArgs => {
  const args = process.argv.slice(2);
  const parsed: MigrationArgs = {
    dryRun: false,
    userId: 'migration-user',
    userEmail: 'migration-user@local.eval',
    userName: 'Migration User',
    organizationId: 'default',
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => args[++index];
    if (arg === '--source') parsed.source = next();
    else if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--user-id') parsed.userId = next() || parsed.userId;
    else if (arg === '--user-email') parsed.userEmail = next() || parsed.userEmail;
    else if (arg === '--user-name') parsed.userName = next() || parsed.userName;
    else if (arg === '--organization-id') parsed.organizationId = next() || parsed.organizationId;
    else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!parsed.source) {
    throw new Error(`Missing --source.\n${usage()}`);
  }
  return parsed;
};

const parseJson = (raw: string) => {
  const first = JSON.parse(raw);
  if (typeof first === 'string') return JSON.parse(first);
  if (first?.[LOCAL_PLATFORM_STORAGE_KEY]) {
    const nested = first[LOCAL_PLATFORM_STORAGE_KEY];
    return typeof nested === 'string' ? JSON.parse(nested) : nested;
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

const extractCollections = (raw: any): CollectionStore => {
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

const readMigrationData = async (source: string) => {
  const raw = parseJson(await readFile(source, 'utf8'));
  return extractCollections(raw);
};

const collectCounts = (collections: CollectionStore): MigrationCounts => {
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

const validateCollections = (collections: CollectionStore) => {
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

const main = async () => {
  const args = parseArgs();
  const collections = await readMigrationData(args.source!);
  const warnings = validateCollections(collections);
  const counts = collectCounts(collections);

  console.log('[migrate:postgres] source counts:', JSON.stringify(counts, null, 2));
  warnings.forEach(warning => console.warn(`[migrate:postgres] warning: ${warning}`));

  if (args.dryRun) {
    console.log('[migrate:postgres] dry-run completed, no database writes performed.');
    return;
  }

  const user = await ensureUserMembership({
    id: args.userId,
    email: args.userEmail,
    displayName: args.userName,
    organizationId: args.organizationId,
  });

  await importProjects(collections, user);
  await importDatasets(collections);
  await importTemplates(collections);
  await importTasks(collections);
  await importGeneration(collections);

  console.log('[migrate:postgres] import completed:', JSON.stringify(counts, null, 2));
};

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
