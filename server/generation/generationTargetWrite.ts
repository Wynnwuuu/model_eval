import { DATASET_RESULT_META_KEY } from '../../src/datasetVersionedSync.ts';
import type { GenerationTargetWriteAction, GenerationTargetWriteIntent } from '../../src/types.ts';
import { fingerprintConfig } from './generationPlanning.ts';

const TARGET_COMPANION_SUFFIXES = ['status', 'seed', 'request_id', 'error', 'params_json'] as const;

const snapshotValue = (value: unknown) => value === undefined ? null : value;

export const generationTargetHasResult = (row: Record<string, any>, targetColumn: string) =>
  Boolean(String(row[targetColumn] ?? '').trim());

export const generationTargetSnapshot = (row: Record<string, any>, targetColumn: string) => {
  const resultMeta = row[DATASET_RESULT_META_KEY];
  const freshness = resultMeta && typeof resultMeta === 'object' && !Array.isArray(resultMeta)
    ? resultMeta[targetColumn]
    : undefined;
  return {
    result: snapshotValue(row[targetColumn]),
    companions: Object.fromEntries(TARGET_COMPANION_SUFFIXES.map(suffix => [
      suffix,
      snapshotValue(row[`${targetColumn}_${suffix}`]),
    ])),
    freshness: snapshotValue(freshness),
  };
};

export const generationTargetSnapshotFingerprint = (
  row: Record<string, any>,
  targetColumn: string,
) => fingerprintConfig(generationTargetSnapshot(row, targetColumn));

export const buildGenerationTargetWriteIntent = (
  row: Record<string, any>,
  targetColumn: string,
  action: GenerationTargetWriteAction,
): GenerationTargetWriteIntent => ({
  action,
  expectedSnapshotFingerprint: generationTargetSnapshotFingerprint(row, targetColumn),
});
