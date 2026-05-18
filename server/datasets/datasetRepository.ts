import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import type { EvalDataset } from '../../src/types.ts';
import { dbPool } from '../db/client.ts';

type DatasetRow = {
  id: string;
  name: string;
  description: string | null;
  modality: EvalDataset['modality'] | null;
  input_type: EvalDataset['inputType'] | null;
  tags_json: string[] | null;
  category_path_json: string[] | null;
  current_version: number;
  dataset_card_json: EvalDataset['datasetCard'] | null;
  validation_summary_json: EvalDataset['validationSummary'] | null;
  created_at: Date;
  updated_at: Date;
};

type DatasetVersionRow = {
  id: string;
  dataset_id: string;
  version: number;
  schema_json: EvalDataset['inputSchema'] | null;
  column_mappings_json: EvalDataset['columnMappings'] | null;
  change_summary: string | null;
  item_count_before: number;
  item_count_after: number;
  changed_by: string | null;
  created_at: Date;
};

type DatasetItemRow = {
  dataset_id: string;
  version_id: string;
  row_index: number;
  payload_json: Record<string, any>;
  dimension_values_json: Record<string, any> | null;
};

const toTimestamp = (date: Date | string | number | null | undefined) => {
  if (!date) return Date.now();
  return date instanceof Date ? date.getTime() : new Date(date).getTime();
};

const toVersionHistory = (versions: DatasetVersionRow[]) =>
  versions
    .sort((a, b) => a.version - b.version)
    .map(version => ({
      version: version.version,
      changedAt: toTimestamp(version.created_at),
      changedBy: version.changed_by || 'Unknown',
      changeSummary: version.change_summary || '',
      itemCountBefore: version.item_count_before,
      itemCountAfter: version.item_count_after,
    }));

const mapDataset = (
  row: DatasetRow,
  versions: DatasetVersionRow[],
  items: DatasetItemRow[]
): EvalDataset => {
  const currentVersion = versions.find(version => version.version === row.current_version) || versions.at(-1);
  const currentItems = currentVersion
    ? items
      .filter(item => item.dataset_id === row.id && item.version_id === currentVersion.id)
      .sort((a, b) => a.row_index - b.row_index)
      .map(item => item.payload_json)
    : [];

  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    tags: row.tags_json || [],
    inputSchema: currentVersion?.schema_json || [],
    items: currentItems,
    inputType: row.input_type || undefined,
    modality: row.modality || undefined,
    categoryPath: row.category_path_json || [],
    columnMappings: currentVersion?.column_mappings_json || undefined,
    datasetCard: row.dataset_card_json || undefined,
    version: row.current_version,
    versionHistory: toVersionHistory(versions.filter(version => version.dataset_id === row.id)),
    validationSummary: row.validation_summary_json || undefined,
    createdAt: toTimestamp(row.created_at),
    updatedAt: toTimestamp(row.updated_at),
  };
};

const loadDatasetRows = async (datasetId?: string) => {
  const datasetResult = await dbPool.query<DatasetRow>(
    `
      SELECT *
      FROM datasets
      WHERE deleted_at IS NULL
      ${datasetId ? 'AND id = $1' : ''}
      ORDER BY created_at DESC
    `,
    datasetId ? [datasetId] : []
  );
  const datasetIds = datasetResult.rows.map(row => row.id);
  if (datasetIds.length === 0) {
    return { datasets: [], versions: [], items: [] };
  }

  const [versionResult, itemResult] = await Promise.all([
    dbPool.query<DatasetVersionRow>(
      `
        SELECT *
        FROM dataset_versions
        WHERE dataset_id = ANY($1)
        ORDER BY dataset_id, version
      `,
      [datasetIds]
    ),
    dbPool.query<DatasetItemRow>(
      `
        SELECT dataset_id, version_id, row_index, payload_json, dimension_values_json
        FROM dataset_items
        WHERE dataset_id = ANY($1)
        ORDER BY dataset_id, version_id, row_index
      `,
      [datasetIds]
    ),
  ]);

  return {
    datasets: datasetResult.rows,
    versions: versionResult.rows,
    items: itemResult.rows,
  };
};

export const listDatasets = async (): Promise<EvalDataset[]> => {
  const rows = await loadDatasetRows();
  return rows.datasets.map(dataset => mapDataset(
    dataset,
    rows.versions.filter(version => version.dataset_id === dataset.id),
    rows.items
  ));
};

export const getDataset = async (datasetId: string): Promise<EvalDataset | null> => {
  const rows = await loadDatasetRows(datasetId);
  const dataset = rows.datasets[0];
  return dataset ? mapDataset(dataset, rows.versions, rows.items) : null;
};

const replaceCurrentVersion = async (client: PoolClient, dataset: EvalDataset) => {
  const version = dataset.version || 1;
  const versionId = `${dataset.id}:v${version}`;
  const latestHistory = dataset.versionHistory?.find(entry => entry.version === version)
    || dataset.versionHistory?.at(-1);

  await client.query('DELETE FROM dataset_items WHERE dataset_id = $1', [dataset.id]);
  await client.query('DELETE FROM dataset_versions WHERE dataset_id = $1', [dataset.id]);
  await client.query(
    `
      INSERT INTO dataset_versions (
        id,
        dataset_id,
        version,
        schema_json,
        column_mappings_json,
        validation_summary_json,
        change_summary,
        item_count_before,
        item_count_after,
        changed_by,
        created_at
      )
      VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, $9, $10, to_timestamp($11 / 1000.0))
    `,
    [
      versionId,
      dataset.id,
      version,
      JSON.stringify(dataset.inputSchema || []),
      JSON.stringify(dataset.columnMappings || {}),
      JSON.stringify(dataset.validationSummary || {}),
      latestHistory?.changeSummary || '',
      latestHistory?.itemCountBefore || 0,
      latestHistory?.itemCountAfter || dataset.items.length,
      null,
      latestHistory?.changedAt || dataset.updatedAt || Date.now(),
    ]
  );

  for (const [index, item] of dataset.items.entries()) {
    await client.query(
      `
        INSERT INTO dataset_items (
          id,
          dataset_id,
          version_id,
          case_key,
          row_index,
          payload_json,
          dimension_values_json
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
      `,
      [
        `${dataset.id}:v${version}:row${index}`,
        dataset.id,
        versionId,
        item.case_id || item.caseId || item.id || null,
        index,
        JSON.stringify(item),
        JSON.stringify({}),
      ]
    );
  }
};

export const saveDataset = async (dataset: EvalDataset): Promise<EvalDataset> => {
  const now = Date.now();
  const nextDataset = {
    ...dataset,
    id: dataset.id || `ds-${randomUUID()}`,
    createdAt: dataset.createdAt || now,
    updatedAt: dataset.updatedAt || now,
  };

  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `
        INSERT INTO datasets (
          id,
          organization_id,
          name,
          description,
          modality,
          input_type,
          tags_json,
          category_path_json,
          current_version,
          dataset_card_json,
          validation_summary_json,
          created_at,
          updated_at
        )
        VALUES (
          $1, 'default', $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8,
          $9::jsonb, $10::jsonb, to_timestamp($11 / 1000.0), to_timestamp($12 / 1000.0)
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          modality = EXCLUDED.modality,
          input_type = EXCLUDED.input_type,
          tags_json = EXCLUDED.tags_json,
          category_path_json = EXCLUDED.category_path_json,
          current_version = EXCLUDED.current_version,
          dataset_card_json = EXCLUDED.dataset_card_json,
          validation_summary_json = EXCLUDED.validation_summary_json,
          updated_at = EXCLUDED.updated_at,
          deleted_at = NULL
      `,
      [
        nextDataset.id,
        nextDataset.name,
        nextDataset.description || '',
        nextDataset.modality || null,
        nextDataset.inputType || null,
        JSON.stringify(nextDataset.tags || []),
        JSON.stringify(nextDataset.categoryPath || []),
        nextDataset.version || 1,
        JSON.stringify(nextDataset.datasetCard || {}),
        JSON.stringify(nextDataset.validationSummary || {}),
        nextDataset.createdAt,
        nextDataset.updatedAt,
      ]
    );
    await replaceCurrentVersion(client, nextDataset);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const saved = await getDataset(nextDataset.id);
  if (!saved) throw new Error('Saved dataset was not found');
  return saved;
};

export const deleteDataset = async (datasetId: string): Promise<boolean> => {
  const result = await dbPool.query(
    `
      UPDATE datasets
      SET deleted_at = now(), updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL
    `,
    [datasetId]
  );
  return (result.rowCount || 0) > 0;
};
