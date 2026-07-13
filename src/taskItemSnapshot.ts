import { EvaluationItem, VoteItemSnapshot, VoteRecord } from './types';

export const createVoteItemSnapshot = (item?: EvaluationItem): VoteItemSnapshot | undefined => {
  if (!item) return undefined;
  return {
    itemId: item.id,
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
  };
};

export const itemFromVoteSnapshot = (vote?: Pick<VoteRecord, 'itemId' | 'itemSnapshot'>): EvaluationItem | undefined => {
  if (!vote?.itemSnapshot) return undefined;
  const snapshot = vote.itemSnapshot;
  return {
    id: snapshot.itemId || vote.itemId,
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
  };
};

export const resolveVoteDisplayItem = <T extends Partial<EvaluationItem> & { id: string }>(
  vote: Pick<VoteRecord, 'itemId' | 'itemSnapshot'>,
  currentItem?: T
): (T | EvaluationItem) | undefined => {
  return itemFromVoteSnapshot(vote) || currentItem;
};
