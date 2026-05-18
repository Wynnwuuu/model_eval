import type { DatasetGenerationJob, DatasetGenerationJobItem } from '../../src/types.ts';
import { dbPool } from '../db/client.ts';

type GenerationJobRow = {
  id: string;
  dataset_id: string;
  dataset_version_id: string | null;
  status: DatasetGenerationJob['status'];
  model_config_json: DatasetGenerationJob['modelConfig'];
  target_column: string | null;
  input_mapping_json: DatasetGenerationJob['inputMapping'];
  controls_json: {
    defaultControls?: DatasetGenerationJob['defaultControls'];
    perCaseControlColumns?: DatasetGenerationJob['perCaseControlColumns'];
    seedMode?: DatasetGenerationJob['seedMode'];
    fixedSeed?: number;
    seedColumn?: string;
    datasetName?: string;
    datasetVersion?: number;
    createdByUid?: string;
    createdBy?: string;
  } | null;
  total: number;
  succeeded: number;
  failed: number;
  created_at: Date;
  updated_at: Date;
};

type GenerationJobItemRow = {
  id: string;
  job_id: string;
  dataset_item_id: string | null;
  row_index: number;
  case_key: string | null;
  status: DatasetGenerationJobItem['status'];
  request_json: any;
  result_json: any;
  error_json: DatasetGenerationJobItem['error'] | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

const toTimestamp = (date: Date | string | number | null | undefined) => {
  if (!date) return undefined;
  return date instanceof Date ? date.getTime() : new Date(date).getTime();
};

const mapJob = (row: GenerationJobRow): DatasetGenerationJob => {
  const controls = row.controls_json || {};
  return {
    id: row.id,
    datasetId: row.dataset_id,
    datasetName: controls.datasetName,
    datasetVersion: controls.datasetVersion,
    modelConfig: row.model_config_json,
    targetColumn: row.target_column || '',
    inputMapping: row.input_mapping_json,
    defaultControls: controls.defaultControls || {},
    perCaseControlColumns: controls.perCaseControlColumns || {},
    seedMode: controls.seedMode || 'derive_from_case',
    fixedSeed: controls.fixedSeed,
    seedColumn: controls.seedColumn,
    status: row.status,
    total: row.total,
    succeeded: row.succeeded,
    failed: row.failed,
    createdByUid: controls.createdByUid,
    createdBy: controls.createdBy,
    createdAt: toTimestamp(row.created_at) || Date.now(),
    updatedAt: toTimestamp(row.updated_at) || Date.now(),
  };
};

const mapJobItem = (row: GenerationJobItemRow): DatasetGenerationJobItem => ({
  id: row.id,
  jobId: row.job_id,
  datasetId: row.request_json?.datasetId || '',
  rowIndex: row.row_index,
  caseId: row.case_key || row.request_json?.caseId || row.id,
  status: row.status,
  requestId: row.request_json?.requestId,
  providerJobId: row.request_json?.providerJobId,
  resolvedInputs: row.request_json?.resolvedInputs || {},
  resolvedControls: row.request_json?.resolvedControls || {},
  seed: row.request_json?.seed,
  resultUrl: row.result_json?.resultUrl,
  resultText: row.result_json?.resultText,
  mediaType: row.result_json?.mediaType,
  error: row.error_json || undefined,
  startedAt: toTimestamp(row.started_at),
  finishedAt: toTimestamp(row.finished_at),
});

export const listGenerationJobs = async (params: { datasetId?: string } = {}): Promise<DatasetGenerationJob[]> => {
  const result = await dbPool.query<GenerationJobRow>(
    `
      SELECT *
      FROM generation_jobs
      WHERE ($1::text IS NULL OR dataset_id = $1)
      ORDER BY created_at DESC
    `,
    [params.datasetId || null]
  );
  return result.rows.map(mapJob);
};

export const listGenerationJobItems = async (jobId: string): Promise<DatasetGenerationJobItem[]> => {
  const result = await dbPool.query<GenerationJobItemRow>(
    `
      SELECT *
      FROM generation_job_items
      WHERE job_id = $1
      ORDER BY row_index, id
    `,
    [jobId]
  );
  return result.rows.map(mapJobItem);
};

export const saveGenerationJob = async (job: DatasetGenerationJob): Promise<DatasetGenerationJob> => {
  const controls = {
    defaultControls: job.defaultControls || {},
    perCaseControlColumns: job.perCaseControlColumns || {},
    seedMode: job.seedMode,
    fixedSeed: job.fixedSeed,
    seedColumn: job.seedColumn,
    datasetName: job.datasetName,
    datasetVersion: job.datasetVersion,
    createdByUid: job.createdByUid,
    createdBy: job.createdBy,
  };

  await dbPool.query(
    `
      INSERT INTO generation_jobs (
        id,
        dataset_id,
        status,
        model_config_json,
        target_column,
        input_mapping_json,
        controls_json,
        total,
        succeeded,
        failed,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4::jsonb, $5, $6::jsonb, $7::jsonb, $8, $9, $10,
        to_timestamp($11 / 1000.0), to_timestamp($12 / 1000.0)
      )
      ON CONFLICT (id) DO UPDATE SET
        dataset_id = EXCLUDED.dataset_id,
        status = EXCLUDED.status,
        model_config_json = EXCLUDED.model_config_json,
        target_column = EXCLUDED.target_column,
        input_mapping_json = EXCLUDED.input_mapping_json,
        controls_json = EXCLUDED.controls_json,
        total = EXCLUDED.total,
        succeeded = EXCLUDED.succeeded,
        failed = EXCLUDED.failed,
        updated_at = EXCLUDED.updated_at
    `,
    [
      job.id,
      job.datasetId,
      job.status,
      JSON.stringify(job.modelConfig || {}),
      job.targetColumn,
      JSON.stringify(job.inputMapping || {}),
      JSON.stringify(controls),
      job.total || 0,
      job.succeeded || 0,
      job.failed || 0,
      job.createdAt || Date.now(),
      job.updatedAt || Date.now(),
    ]
  );
  return job;
};

export const saveGenerationJobItem = async (item: DatasetGenerationJobItem): Promise<DatasetGenerationJobItem> => {
  await dbPool.query(
    `
      INSERT INTO generation_job_items (
        id,
        job_id,
        row_index,
        case_key,
        status,
        request_json,
        result_json,
        error_json,
        started_at,
        finished_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb,
        CASE WHEN $9::bigint IS NULL THEN NULL ELSE to_timestamp($9 / 1000.0) END,
        CASE WHEN $10::bigint IS NULL THEN NULL ELSE to_timestamp($10 / 1000.0) END,
        now()
      )
      ON CONFLICT (id) DO UPDATE SET
        row_index = EXCLUDED.row_index,
        case_key = EXCLUDED.case_key,
        status = EXCLUDED.status,
        request_json = EXCLUDED.request_json,
        result_json = EXCLUDED.result_json,
        error_json = EXCLUDED.error_json,
        started_at = EXCLUDED.started_at,
        finished_at = EXCLUDED.finished_at,
        updated_at = now()
    `,
    [
      item.id,
      item.jobId,
      item.rowIndex,
      item.caseId,
      item.status,
      JSON.stringify({
        datasetId: item.datasetId,
        caseId: item.caseId,
        requestId: item.requestId,
        providerJobId: item.providerJobId,
        resolvedInputs: item.resolvedInputs || {},
        resolvedControls: item.resolvedControls || {},
        seed: item.seed,
      }),
      JSON.stringify({
        resultUrl: item.resultUrl,
        resultText: item.resultText,
        mediaType: item.mediaType,
      }),
      JSON.stringify(item.error || {}),
      item.startedAt || null,
      item.finishedAt || null,
    ]
  );
  return item;
};
