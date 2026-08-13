import type {
  GenerationCaseReview,
  GenerationDurationSource,
} from '../../src/types.ts';

export type GenerationRetryScopedControls = {
  caseReviews?: Record<string, GenerationCaseReview>;
  durationSource?: GenerationDurationSource;
};

const pickStableIdEntries = <T>(
  values: Record<string, T> | undefined,
  selectedIds: Set<string>,
) => values
  ? Object.fromEntries(Object.entries(values).filter(([id]) => selectedIds.has(id)))
  : undefined;

export const scopeGenerationRetryControls = <T extends GenerationRetryScopedControls>(
  controls: T,
  selectedDatasetItemIds: string[],
): GenerationRetryScopedControls => {
  const selectedIds = new Set(selectedDatasetItemIds);
  const caseReviews = pickStableIdEntries(controls.caseReviews, selectedIds);
  const referenceAudio = pickStableIdEntries(
    controls.durationSource?.referenceAudio,
    selectedIds,
  );
  return {
    ...(caseReviews && Object.keys(caseReviews).length ? { caseReviews } : {}),
    ...(controls.durationSource
      ? {
          durationSource: {
            ...controls.durationSource,
            ...(controls.durationSource.referenceAudio
              ? { referenceAudio: referenceAudio || {} }
              : {}),
          },
        }
      : {}),
  };
};
