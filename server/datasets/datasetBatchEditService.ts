import {
  applyDatasetBatchEdit,
  buildBatchEditedDataset,
  type DatasetAppendedRow,
  type DatasetCellEdit,
} from '../../src/datasetGridEditing.ts';
import type { RequestUser } from '../auth/context.ts';
import { conflict, unprocessableEntity } from '../http/errors.ts';
import { getDataset, saveDataset } from './datasetRepository.ts';

export interface DatasetBatchEditRequest {
  expectedVersion: number;
  edits: DatasetCellEdit[];
  appendedRows: DatasetAppendedRow[];
  acceptWarnings: boolean;
}

export const updateDatasetItemsBatch = async (
  datasetId: string,
  input: DatasetBatchEditRequest,
  user: RequestUser,
) => {
  const current = await getDataset(datasetId);
  if (!current) return null;
  if ((current.version || 1) !== input.expectedVersion) {
    throw conflict('评测集已被其他人更新，请刷新后重新检查草稿。', {
      expectedVersion: input.expectedVersion,
      currentVersion: current.version || 1,
    });
  }

  const outcome = applyDatasetBatchEdit(current, {
    edits: input.edits,
    appendedRows: input.appendedRows,
  });
  if (outcome.errors.length) {
    throw unprocessableEntity(
      'DATASET_BATCH_EDIT_INVALID',
      '批量修改包含不可保存的问题，请按提示修正。',
      { issues: outcome.errors },
    );
  }
  if (outcome.warnings.length && !input.acceptWarnings) {
    throw unprocessableEntity(
      'DATASET_BATCH_EDIT_WARNINGS',
      '批量修改包含需要确认的数据质量警告。',
      { issues: outcome.warnings },
    );
  }
  if (!outcome.changedCellCount && !outcome.appendedRowCount) {
    return { dataset: current, warnings: outcome.warnings, outcome };
  }

  const next = buildBatchEditedDataset(current, outcome, {
    actorName: user.displayName || user.email || user.id,
  });
  const dataset = await saveDataset(next, user.id, {
    expectedVersion: input.expectedVersion,
  });
  return { dataset, warnings: outcome.warnings, outcome };
};
