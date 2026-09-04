import { useMemo, useState } from 'react';
import {
  collectDimensionOptionCatalog,
  getDimensionValuesForItem,
  hasDimensionOptionSelection,
  itemMatchesDimensionOptions,
  type DimensionOptionSelection,
} from './dimensionUtils';
import type { AggregatedResult, EvaluationItem, VoteRecord } from './types';

const collectScopeIds = (items: Array<Partial<EvaluationItem> & { id: string }>) => {
  const ids = new Set<string>();
  items.forEach(item => {
    ids.add(item.id);
    if (item.originalItemId) ids.add(item.originalItemId);
  });
  return ids;
};

export const useDimensionOptionScope = <T extends Partial<EvaluationItem> & { id: string }>(
  items: T[],
  votes: VoteRecord[] = [],
  aggregatedData: AggregatedResult[] = [],
) => {
  const [selected, setSelected] = useState<DimensionOptionSelection>({});
  const catalog = useMemo(
    () => collectDimensionOptionCatalog(items.map(item => ({
      dimensionValues: getDimensionValuesForItem(item),
    }))),
    [items],
  );
  const scopedItems = useMemo(
    () => hasDimensionOptionSelection(selected)
      ? items.filter(item => itemMatchesDimensionOptions(getDimensionValuesForItem(item), selected))
      : items,
    [items, selected],
  );
  const scopedItemIds = useMemo(() => collectScopeIds(scopedItems), [scopedItems]);
  const scopedVotes = useMemo(
    () => hasDimensionOptionSelection(selected)
      ? votes.filter(vote => scopedItemIds.has(vote.itemId) || Boolean(vote.pairContext?.originalItemId && scopedItemIds.has(vote.pairContext.originalItemId)))
      : votes,
    [scopedItemIds, selected, votes],
  );
  const scopedAggregatedData = useMemo(
    () => hasDimensionOptionSelection(selected)
      ? aggregatedData.filter(item => scopedItemIds.has(item.itemId))
      : aggregatedData,
    [aggregatedData, scopedItemIds, selected],
  );

  return {
    catalog,
    selected,
    setSelected,
    active: hasDimensionOptionSelection(selected),
    items: scopedItems,
    votes: scopedVotes,
    aggregatedData: scopedAggregatedData,
    itemIds: scopedItemIds,
  };
};
