import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileAudio, Image as ImageIcon, Search, Video } from 'lucide-react';

import { DATASET_ITEM_ID_KEY, getDatasetRowCaseId } from '../datasetSync';
import { extractMediaUrls } from '../mediaUrlUtils';
import { inferReferenceMediaType } from '../mediaTypeUtils';
import type { EvalDataset, GenerationInputMapping } from '../types';
import MediaRenderer from './MediaRenderer';

interface GenerationCaseSelectorProps {
  dataset: EvalDataset;
  inputMapping: GenerationInputMapping;
  targetColumn: string;
  selectedDatasetItemIds: string[];
  maxBatchSize: number;
  onSelectionChange: (ids: string[]) => void;
}

interface SelectableCase {
  rowIndex: number;
  datasetItemId: string;
  caseId: string;
  prompt: string;
  mediaUrls: string[];
  targetFilled: boolean;
  eligible: boolean;
}

const text = (value: unknown) => String(value ?? '').trim();

const LazyCaseMedia: React.FC<{ url: string }> = ({ url }) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const mediaType = inferReferenceMediaType(url);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '160px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const placeholder = mediaType === 'audio'
    ? <FileAudio size={18} />
    : mediaType === 'video'
      ? <Video size={18} />
      : <ImageIcon size={18} />;

  return (
    <div ref={rootRef} className="h-14 w-24 shrink-0 overflow-hidden border border-white/10 bg-black/30">
      {visible ? (
        <MediaRenderer
          url={url}
          isActive={false}
          forceType={mediaType}
          videoPreload="none"
          className="rounded-none border-0 shadow-none"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-slate-500">{placeholder}</div>
      )}
    </div>
  );
};

const mappedMediaColumns = (mapping: GenerationInputMapping) => Array.from(new Set([
  ...(mapping.referenceImageColumns || []),
  ...(mapping.startImageColumn ? [mapping.startImageColumn] : []),
  ...(mapping.endImageColumn ? [mapping.endImageColumn] : []),
  ...(mapping.referenceAudioColumns || []),
]));

const GenerationCaseSelector: React.FC<GenerationCaseSelectorProps> = ({
  dataset,
  inputMapping,
  targetColumn,
  selectedDatasetItemIds,
  maxBatchSize,
  onSelectionChange,
}) => {
  const [query, setQuery] = useState('');
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const selectedSet = useMemo<Set<string>>(() => new Set(selectedDatasetItemIds), [selectedDatasetItemIds]);
  const mediaColumns = useMemo(() => mappedMediaColumns(inputMapping), [inputMapping]);

  const cases = useMemo<SelectableCase[]>(() => (dataset.items || []).map((row, rowIndex) => {
    const datasetItemId = text(row[DATASET_ITEM_ID_KEY]);
    const targetFilled = Boolean(text(row[targetColumn]));
    return {
      rowIndex,
      datasetItemId,
      caseId: getDatasetRowCaseId(row, rowIndex),
      prompt: inputMapping.promptColumn ? text(row[inputMapping.promptColumn]) : '',
      mediaUrls: Array.from(new Set(mediaColumns.flatMap(column => extractMediaUrls(row[column])))),
      targetFilled,
      eligible: Boolean(datasetItemId) && !targetFilled,
    };
  }), [dataset.items, inputMapping.promptColumn, mediaColumns, targetColumn]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredCases = useMemo(() => cases.filter(item => !normalizedQuery
    || item.caseId.toLowerCase().includes(normalizedQuery)
    || item.prompt.toLowerCase().includes(normalizedQuery)), [cases, normalizedQuery]);
  const eligibleIds = useMemo(() => cases.filter(item => item.eligible).map(item => item.datasetItemId), [cases]);
  const filteredEligibleIds = useMemo(() => filteredCases.filter(item => item.eligible).map(item => item.datasetItemId), [filteredCases]);
  const allFilteredSelected = filteredEligibleIds.length > 0 && filteredEligibleIds.every(id => selectedSet.has(id));
  const someFilteredSelected = filteredEligibleIds.some(id => selectedSet.has(id));

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someFilteredSelected && !allFilteredSelected;
    }
  }, [allFilteredSelected, someFilteredSelected]);

  const applySelection = (next: Set<string>) => {
    onSelectionChange(cases.filter(item => next.has(item.datasetItemId)).map(item => item.datasetItemId));
  };

  const toggleCase = (datasetItemId: string) => {
    const next = new Set<string>(selectedSet);
    if (next.has(datasetItemId)) next.delete(datasetItemId);
    else next.add(datasetItemId);
    applySelection(next);
  };

  const toggleFiltered = (checked: boolean) => {
    const next = new Set<string>(selectedSet);
    filteredEligibleIds.forEach(id => checked ? next.add(id) : next.delete(id));
    applySelection(next);
  };

  const overLimit = selectedDatasetItemIds.length > maxBatchSize;

  return (
    <section className="border-t border-white/10 pt-5" data-testid="generation-case-selector">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">{'\u751f\u6210\u8303\u56f4'}</h3>
          <p className="mt-1 text-xs text-slate-400">{'\u53ea\u6709\u5df2\u52fe\u9009\u4e14\u76ee\u6807\u5217\u4e3a\u7a7a\u7684 case \u4f1a\u8fdb\u5165\u9884\u68c0\uff1b\u672a\u9009\u884c\u4e0d\u4f1a\u5199\u5165\u4efb\u4f55\u751f\u4ea7\u5143\u6570\u636e\u3002'}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="border border-white/10 bg-white/5 px-2 py-1 text-slate-300">{'\u603b\u6570'} {cases.length}</span>
          <span className="border border-emerald-400/20 bg-emerald-500/10 px-2 py-1 text-emerald-200">{'\u53ef\u751f\u6210'} {eligibleIds.length}</span>
          <span className={`border px-2 py-1 ${overLimit ? 'border-red-400/30 bg-red-500/10 text-red-200' : 'border-amber-400/20 bg-amber-500/10 text-amber-200'}`}>
            {'\u5df2\u9009'} {selectedDatasetItemIds.length} / {'\u4e0a\u9650'} {maxBatchSize}
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={'\u641c\u7d22 Case ID \u6216 Prompt'}
            className="w-full border border-white/10 bg-slate-900 py-2 pl-9 pr-3 text-sm text-slate-100"
          />
        </label>
        <button type="button" onClick={() => onSelectionChange(eligibleIds)} className="border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10">{'\u5168\u9009\u6240\u6709\u53ef\u751f\u6210\u9879'}</button>
        <button type="button" onClick={() => onSelectionChange([])} className="border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 hover:bg-white/10">{'\u6e05\u7a7a\u9009\u62e9'}</button>
      </div>

      {overLimit && <p className="mt-2 text-xs text-red-300">{'\u5df2\u9009\u6570\u91cf\u8d85\u8fc7\u670d\u52a1\u7aef\u6279\u6b21\u4e0a\u9650\uff0c\u8bf7\u51cf\u5c11 case \u540e\u518d\u9884\u68c0\u3002'}</p>}
      {!selectedDatasetItemIds.length && <p className="mt-2 text-xs text-amber-300">{'\u8bf7\u81f3\u5c11\u9009\u62e9\u4e00\u4e2a\u53ef\u751f\u6210 case\u3002'}</p>}

      <div className="mt-3 max-h-80 overflow-auto border border-white/10">
        <div className="sticky top-0 z-10 grid min-w-[760px] grid-cols-[150px_minmax(240px,1fr)_150px_110px_56px] items-center gap-3 border-b border-white/10 bg-slate-950 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
          <span>Case ID</span>
          <span>Prompt</span>
          <span>{'\u53c2\u8003\u7d20\u6750'}</span>
          <span>{'\u76ee\u6807\u5217\u72b6\u6001'}</span>
          <label className="flex justify-end" title={'\u9009\u62e9\u5f53\u524d\u7b5b\u9009\u7ed3\u679c'}>
            <input
              ref={selectAllRef}
              type="checkbox"
              aria-label={'\u9009\u62e9\u5f53\u524d\u7b5b\u9009\u7ed3\u679c'}
              checked={allFilteredSelected}
              disabled={!filteredEligibleIds.length}
              onChange={event => toggleFiltered(event.target.checked)}
            />
          </label>
        </div>
        {filteredCases.map(item => (
          <div key={item.datasetItemId || `missing-${item.rowIndex}`} className={`grid min-w-[760px] grid-cols-[150px_minmax(240px,1fr)_150px_110px_56px] items-center gap-3 border-b border-white/5 px-3 py-3 text-xs last:border-0 ${selectedSet.has(item.datasetItemId) ? 'bg-amber-500/5' : ''}`}>
            <div className="min-w-0 truncate text-slate-200" title={item.caseId}>{item.caseId}</div>
            <div className="min-w-0 line-clamp-2 text-slate-400" title={item.prompt}>{item.prompt || '-'}</div>
            <div className="flex items-center gap-2">
              {item.mediaUrls[0] ? <LazyCaseMedia url={item.mediaUrls[0]} /> : <span className="text-slate-600">-</span>}
              {item.mediaUrls.length > 1 && <span className="text-[11px] text-slate-500">+{item.mediaUrls.length - 1}</span>}
            </div>
            <div>
              {item.targetFilled ? <span className="text-sky-300">{'\u5df2\u6709\u7ed3\u679c'}</span>
                : item.datasetItemId ? <span className="text-emerald-300">{'\u53ef\u751f\u6210'}</span>
                  : <span className="text-red-300">{'\u7f3a\u5c11\u7a33\u5b9a ID'}</span>}
            </div>
            <label className="flex justify-end">
              <input
                type="checkbox"
                aria-label={`${'\u9009\u62e9'} ${item.caseId}`}
                checked={item.eligible && selectedSet.has(item.datasetItemId)}
                disabled={!item.eligible}
                onChange={() => toggleCase(item.datasetItemId)}
              />
            </label>
          </div>
        ))}
        {!filteredCases.length && <div className="px-4 py-10 text-center text-sm text-slate-500">{'\u6ca1\u6709\u5339\u914d\u7684 case\u3002'}</div>}
      </div>
    </section>
  );
};

export default GenerationCaseSelector;
