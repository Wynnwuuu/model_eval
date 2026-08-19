import { EvaluationItem, VoteItemSnapshot, VoteRecord } from './types.ts';

export const VOTE_AUDIT_CSV_HEADERS = [
  'DatasetVersion_Evaluated',
  'DatasetVersion_Current',
  'ContentUpdatedAfterVote',
  'EvaluatedPrompt',
  'EvaluatedDimensions_JSON',
  'EvaluatedModelOutputs_JSON',
  'EvaluatedItemSnapshot_JSON',
  'CurrentItemSnapshot_JSON',
] as const;

export const createVoteItemSnapshot = (item?: EvaluationItem): VoteItemSnapshot | undefined => {
  if (!item) return undefined;
  return {
    itemId: item.id,
    itemOrder: item.itemOrder,
    prompt: item.prompt,
    inputs: item.inputs ? { ...item.inputs } : undefined,
    dimensionValues: item.dimensionValues ? { ...item.dimensionValues } : undefined,
    modelOutputs: item.modelOutputs?.map(output => ({ ...output })),
    modelA_Url: item.modelA_Url,
    modelB_Url: item.modelB_Url,
    startImageUrl: item.startImageUrl,
    referenceUrls: item.referenceUrls ? [...item.referenceUrls] : undefined,
    type: item.type,
    pairContext: item.pairContext ? { ...item.pairContext } : undefined,
    originalItemId: item.originalItemId,
    originalData: item.originalData ? { ...item.originalData } : undefined,
    sourceDatasetItemId: item.sourceDatasetItemId,
    sourceDatasetVersion: item.sourceDatasetVersion,
  };
};

export const itemFromVoteSnapshot = (vote?: Pick<VoteRecord, 'itemId' | 'itemSnapshot'>): EvaluationItem | undefined => {
  if (!vote?.itemSnapshot) return undefined;
  const snapshot = vote.itemSnapshot;
  return {
    id: snapshot.itemId || vote.itemId,
    itemOrder: snapshot.itemOrder,
    modelA_Url: snapshot.modelA_Url || '',
    modelB_Url: snapshot.modelB_Url || '',
    modelOutputs: snapshot.modelOutputs?.map(output => ({ ...output })),
    prompt: snapshot.prompt,
    inputs: snapshot.inputs ? { ...snapshot.inputs } : undefined,
    dimensionValues: snapshot.dimensionValues ? { ...snapshot.dimensionValues } : undefined,
    startImageUrl: snapshot.startImageUrl,
    referenceUrls: snapshot.referenceUrls ? [...snapshot.referenceUrls] : undefined,
    type: snapshot.type || 'unknown',
    pairContext: snapshot.pairContext ? { ...snapshot.pairContext } : undefined,
    originalItemId: snapshot.originalItemId,
    originalData: snapshot.originalData ? { ...snapshot.originalData } : undefined,
    sourceDatasetItemId: snapshot.sourceDatasetItemId,
    sourceDatasetVersion: snapshot.sourceDatasetVersion,
  };
};

export const getVoteAuditCsvValues = (vote: Partial<Pick<
  VoteRecord,
  'datasetVersionEvaluated' | 'datasetVersionCurrent' | 'contentUpdatedAfterVote' | 'evaluatedItemSnapshot' | 'itemSnapshot'
>>) => {
  const evaluated = vote.evaluatedItemSnapshot;
  return [
    vote.datasetVersionEvaluated ?? evaluated?.sourceDatasetVersion ?? '',
    vote.datasetVersionCurrent ?? vote.itemSnapshot?.sourceDatasetVersion ?? '',
    vote.contentUpdatedAfterVote === undefined ? '' : vote.contentUpdatedAfterVote ? 'true' : 'false',
    evaluated?.prompt || '',
    evaluated?.dimensionValues ? JSON.stringify(evaluated.dimensionValues) : '',
    evaluated?.modelOutputs ? JSON.stringify(evaluated.modelOutputs) : '',
    evaluated ? JSON.stringify(evaluated) : '',
    vote.itemSnapshot ? JSON.stringify(vote.itemSnapshot) : '',
  ];
};

export const resolveVoteDisplayItem = <T extends Partial<EvaluationItem> & { id: string }>(
  vote: Pick<VoteRecord, 'itemId' | 'itemSnapshot'>,
  currentItem?: T
): (T | EvaluationItem) | undefined => {
  return itemFromVoteSnapshot(vote) || currentItem;
};
