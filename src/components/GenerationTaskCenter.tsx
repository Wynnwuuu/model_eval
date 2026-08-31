import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  Image,
  Loader2,
  RefreshCw,
  Search,
  Video,
  Wand2,
} from 'lucide-react';

import type {
  DatasetGenerationJob,
  EvalDataset,
  GenerationJobSortField,
  GenerationJobStatus,
  GenerationQueueLane,
  GenerationQueueState,
} from '../types';
import {
  getGenerationQueue,
  listExecutionJobs,
  type GenerationJobListFilters,
} from '../features/generation/executionApi';
import { nextGenerationJobSort } from '../features/generation/generationJobSorting';

type GenerationTaskCenterProps = {
  datasets: EvalDataset[];
  onOpenBatch: (job: DatasetGenerationJob) => void;
  onNewGeneration: () => void;
};

const STATUS_OPTIONS: Array<{ value: GenerationJobStatus | ''; label: string }> = [
  { value: '', label: '\u5168\u90e8\u72b6\u6001' },
  { value: 'queued', label: '\u6392\u961f\u4e2d' },
  { value: 'running', label: '\u8fd0\u884c\u4e2d' },
  { value: 'partial', label: '\u90e8\u5206\u6210\u529f' },
  { value: 'failed', label: '\u5931\u8d25' },
  { value: 'completed', label: '\u5df2\u5b8c\u6210' },
  { value: 'cancelled', label: '\u5df2\u53d6\u6d88' },
  { value: 'writeback_conflict', label: '\u56de\u586b\u51b2\u7a81' },
];

const statusLabel = (status: DatasetGenerationJob['status']) => ({
  draft: '\u8349\u7a3f',
  queued: '\u6392\u961f\u4e2d',
  running: '\u8fd0\u884c\u4e2d',
  completed: '\u5df2\u5b8c\u6210',
  partial: '\u90e8\u5206\u6210\u529f',
  failed: '\u5931\u8d25',
  cancelled: '\u5df2\u53d6\u6d88',
  writeback_conflict: '\u56de\u586b\u51b2\u7a81',
}[status] || status);

const statusClass = (status: DatasetGenerationJob['status']) => {
  if (status === 'running' || status === 'queued') return 'border-blue-400/30 bg-blue-500/10 text-blue-200';
  if (status === 'completed') return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200';
  if (status === 'failed' || status === 'writeback_conflict') return 'border-red-400/30 bg-red-500/10 text-red-200';
  if (status === 'partial') return 'border-amber-400/30 bg-amber-500/10 text-amber-200';
  return 'border-white/15 bg-white/5 text-slate-300';
};

const formatTime = (value?: number) => value
  ? new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
  : '-';

const STATUS_SORT_DESCRIPTION = '\u8fd0\u884c\u4e2d\u3001\u6392\u961f\u4e2d\u3001\u56de\u586b\u51b2\u7a81\u3001\u5931\u8d25\u3001\u90e8\u5206\u6210\u529f\u3001\u5df2\u5b8c\u6210\u3001\u5df2\u53d6\u6d88\u3001\u8349\u7a3f';

const SortableHeader: React.FC<{
  field: GenerationJobSortField;
  label: string;
  sortBy?: GenerationJobSortField;
  sortDirection?: GenerationJobListFilters['sortDirection'];
  onSort: (field: GenerationJobSortField) => void;
  ascendingDescription?: string;
}> = ({ field, label, sortBy, sortDirection, onSort, ascendingDescription }) => {
  const activeDirection = sortBy === field ? sortDirection : undefined;
  const action = activeDirection === 'asc'
    ? '\u5207\u6362\u4e3a\u5012\u5e8f'
    : activeDirection === 'desc'
      ? '\u6062\u590d\u9ed8\u8ba4\u6392\u5e8f'
      : '\u6309\u8be5\u5217\u5347\u5e8f\u6392\u5217';
  const description = ascendingDescription ? `\uff0c\u5347\u5e8f\u4e3a ${ascendingDescription}` : '';
  const accessibleLabel = `${label}\uff1a${action}${description}`;
  return (
    <th
      className="p-0 font-medium"
      aria-sort={activeDirection === 'asc' ? 'ascending' : activeDirection === 'desc' ? 'descending' : undefined}
      data-sort-field={field}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`group flex w-full items-center gap-2 px-4 py-3 text-left outline-none transition-colors hover:bg-white/[0.03] hover:text-slate-200 focus-visible:bg-white/[0.05] focus-visible:text-slate-100 ${activeDirection ? 'text-slate-200' : 'text-slate-400'}`}
        aria-label={accessibleLabel}
        title={accessibleLabel}
      >
        <span>{label}</span>
        <span className="flex h-5 w-3 shrink-0 flex-col items-center justify-center" aria-hidden="true">
          <ChevronUp
            size={10}
            strokeWidth={2.5}
            className={activeDirection === 'asc' ? 'text-amber-300' : 'text-slate-600 group-hover:text-slate-500'}
            data-sort-indicator="asc"
          />
          <ChevronDown
            size={10}
            strokeWidth={2.5}
            className={activeDirection === 'desc' ? 'text-amber-300' : 'text-slate-600 group-hover:text-slate-500'}
            data-sort-indicator="desc"
          />
        </span>
      </button>
    </th>
  );
};

const modelPolicyLabel = (mode: NonNullable<GenerationQueueLane['models']>[number]['mode']) => ({
  initial: '\u65e0\u8fd1\u671f\u5bb9\u91cf\u6837\u672c\uff0c\u4f7f\u7528\u521d\u59cb\u5e76\u53d1',
  ramping: '\u5df2\u63a5\u6536\u4efb\u52a1\u6b63\u5728\u6253\u5f00\u4e0b\u4e00\u6ce2',
  maximum: '\u5df2\u8fbe\u5230\u6700\u5927\u6ce2\u6b21',
  minimum: '\u5bb9\u91cf\u53cd\u9988\u540e\u5df2\u9000\u8ba9',
}[mode]);

const capacityPhaseLabel = (phase: NonNullable<GenerationQueueLane['phase']>) => ({
  slow_start: '\u4e50\u89c2\u6269\u5bb9',
  stable: '\u7a33\u5b9a',
  congestion_avoidance: '\u62e5\u585e\u907f\u514d',
  rate_limited: '\u63d0\u4ea4\u9650\u901f',
  cooling: '\u51b7\u5374',
  circuit_open: '\u7194\u65ad',
}[phase]);

const queueReason = (job: DatasetGenerationJob, queue?: GenerationQueueState) => {
  if ((job.unresolved || 0) > 0) return `${job.unresolved} \u4e2a case \u5f85\u5904\u7406`;
  if ((job.statusCounts?.reconciling || 0) > 0) {
    return `${job.statusCounts?.reconciling || 0} \u4e2a case \u72b6\u6001\u5f85\u6838\u5bf9\uff0c\u5df2\u91ca\u653e\u751f\u6210\u69fd\u4f4d`;
  }
  const active = (job.statusCounts?.processing || 0) + (job.statusCounts?.submitted || 0) + (job.statusCounts?.submitting || 0);
  if (active > 0) {
    const modality = job.modelConfig?.outputModality === 'video' ? '\u89c6\u9891' : '\u56fe\u7247';
    return `\u5360\u7528 ${active} \u4e2a${modality}\u69fd\u4f4d`;
  }
  if ((job.statusCounts?.archiving || 0) > 0) return '\u6b63\u5728\u5f52\u6863\u751f\u6210\u7ed3\u679c';
  if ((job.statusCounts?.pending || 0) > 0) {
    const lane = job.modelConfig?.outputModality === 'video' ? queue?.video : queue?.image;
    if (job.modelConfig?.outputModality === 'video') {
      const modelName = String(job.modelConfig?.modelName || job.modelConfig?.id || '').toLowerCase();
      const modelQueue = queue?.video.models?.find(item =>
        item.modelName.toLowerCase() === modelName
        || item.modelNames?.some(name => name.toLowerCase() === modelName));
      if (modelQueue && modelQueue.active >= modelQueue.effectiveLimit) {
        return `\u7b49\u5f85\u6a21\u578b\u5bb9\u91cf ${modelQueue.active}/${modelQueue.effectiveLimit}`;
      }
    }
    if (lane && lane.active >= lane.limit) {
      return `\u7b49\u5f85\u5168\u5c40${job.modelConfig?.outputModality === 'video' ? '\u89c6\u9891' : '\u56fe\u7247'}\u5bb9\u91cf ${lane.active}/${lane.limit}`;
    }
    return '\u7b49\u5f85\u516c\u5e73\u8f6e\u8f6c';
  }
  if (job.writebackStatus === 'pending' || job.writebackStatus === 'running') return '\u7b49\u5f85\u6570\u636e\u96c6\u56de\u586b';
  return '-';
};
const QueueLane: React.FC<{
  icon: React.ReactNode;
  label: string;
  lane?: GenerationQueueLane;
}> = ({ icon, label, lane }) => {
  const limit = lane?.limit || 0;
  const active = lane?.active || 0;
  const percentage = limit ? Math.min(100, Math.round((active / limit) * 100)) : 0;
  return (
    <div className="min-w-0 border-l border-white/10 px-4 py-3 first:border-l-0">
      <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
        <span className="flex items-center gap-2">{icon}{label}</span>
        <span className="font-medium text-slate-200">{active}/{limit}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-sm bg-white/10">
        <div className="h-full bg-amber-400 transition-[width]" style={{ width: `${percentage}%` }} />
      </div>
      <div className="mt-2 text-xs text-slate-500">
        {'\u7b49\u5f85'} {lane?.pending || 0}
        {' / \u5f85\u6838\u5bf9'} {lane?.reconciling || 0}
      </div>
    </div>
  );
};

const GenerationTaskCenter: React.FC<GenerationTaskCenterProps> = ({
  datasets,
  onOpenBatch,
  onNewGeneration,
}) => {
  const [jobs, setJobs] = useState<DatasetGenerationJob[]>([]);
  const [queue, setQueue] = useState<GenerationQueueState>();
  const [filters, setFilters] = useState<GenerationJobListFilters>({ page: 1, limit: 20 });
  const [modelSearch, setModelSearch] = useState('');
  const [creatorSearch, setCreatorSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [expandedCapacityModels, setExpandedCapacityModels] = useState<Set<string>>(() => new Set());

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const [jobResponse, queueResponse] = await Promise.all([
        listExecutionJobs(filters),
        getGenerationQueue(),
      ]);
      setJobs(jobResponse.jobs);
      setTotal(jobResponse.total);
      setQueue(queueResponse);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => { void load(true); }, 5000);
    return () => window.clearInterval(interval);
  }, [load]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setFilters(current => ({
        ...current,
        model: modelSearch.trim() || undefined,
        createdBy: creatorSearch.trim() || undefined,
        page: 1,
      }));
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [creatorSearch, modelSearch]);

  const handleSort = useCallback((field: GenerationJobSortField) => {
    setFilters(current => {
      const nextSort = nextGenerationJobSort(current, field);
      const nextFilters = { ...current, page: 1 };
      delete nextFilters.sortBy;
      delete nextFilters.sortDirection;
      return { ...nextFilters, ...nextSort };
    });
  }, []);

  const page = Number(filters.page || 1);
  const limit = Number(filters.limit || 20);
  const pages = Math.max(1, Math.ceil(total / limit));
  const datasetOptions = useMemo(
    () => datasets.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    [datasets],
  );

  return (
    <section className="min-w-0 max-w-full overflow-hidden border border-white/10 bg-black/20">
      <header className="flex justify-end border-b border-white/10 px-4 py-4">
        <div className="grid w-full grid-cols-2 border border-white/10 bg-black/20 sm:w-auto sm:min-w-[360px]">
          <QueueLane icon={<Image size={14} />} label={'\u56fe\u7247\u5bb9\u91cf'} lane={queue?.image} />
          <QueueLane
            icon={<Video size={14} />}
            label={queue?.video.strategy === 'optimistic_waves' ? '\u89c6\u9891\u4e50\u89c2\u6ce2\u6b21\u5bb9\u91cf' : '\u89c6\u9891\u5bb9\u91cf'}
            lane={queue?.video}
          />
        </div>
      </header>
      {!!queue?.video.models?.length && (
        <div className="border-b border-white/10">
          <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs text-slate-400">
            <span>
              {'\u89c6\u9891\u5bb9\u91cf\u63a7\u5236'}
              {' \u00b7 '}
              {queue.video.adaptiveEnforced
                ? '\u5df2\u63a5\u7ba1'
                : '\u5e94\u6025\u56de\u9000'}
              {queue.video.phase ? ` \u00b7 ${capacityPhaseLabel(queue.video.phase)}` : ''}
            </span>
            <span>
              {queue.video.optimisticWaves?.length
                ? `${queue.video.optimisticWaves.join(' \u2192 ')} \u00b7 `
                : ''}
              {'\u5168\u5c40\u7a97\u53e3'} {queue.video.recommendedLimit || queue.video.limit}
              {' / \u786c\u4e0a\u9650'} {queue.video.hardLimit || queue.video.limit}
              {' \u00b7 \u63d0\u4ea4'} {queue.video.submitWorkers || 0}
              {' / \u8f6e\u8be2'} {queue.video.pollWorkers || 0}
            </span>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
              {queue.video.models.map(modelQueue => {
                const expanded = expandedCapacityModels.has(modelQueue.modelName);
                return (
                  <React.Fragment key={modelQueue.modelName}>
                    <div className="grid grid-cols-[28px_minmax(210px,1.4fr)_100px_120px_minmax(300px,1.8fr)] items-center gap-3 border-t border-white/10 px-4 py-2 text-xs">
                      <button
                        type="button"
                        className="inline-flex h-7 w-7 items-center justify-center text-slate-400 hover:text-slate-100 disabled:opacity-30"
                        disabled={!modelQueue.buckets?.length}
                        title={expanded ? '\u6536\u8d77\u751f\u6210\u6a21\u5f0f' : '\u5c55\u5f00\u751f\u6210\u6a21\u5f0f'}
                        onClick={() => setExpandedCapacityModels(current => {
                          const next = new Set(current);
                          if (next.has(modelQueue.modelName)) next.delete(modelQueue.modelName);
                          else next.add(modelQueue.modelName);
                          return next;
                        })}
                      >
                        <ChevronDown size={15} className={expanded ? 'rotate-180 transition-transform' : 'transition-transform'} />
                      </button>
                      <span className="truncate font-medium text-slate-200" title={modelQueue.modelName}>{modelQueue.modelName}</span>
                      <span className="tabular-nums text-slate-300">
                        {'\u5728\u9014'} {modelQueue.active}/{modelQueue.effectiveLimit}
                      </span>
                      <span className="tabular-nums text-slate-400">
                        {'\u7b49\u5f85'} {modelQueue.organizationPending}
                      </span>
                      <span className={modelQueue.mode === 'minimum' ? 'text-red-300' : modelQueue.mode === 'ramping' ? 'text-amber-300' : 'text-slate-400'}>
                        {modelQueue.phase ? capacityPhaseLabel(modelQueue.phase) : modelPolicyLabel(modelQueue.mode)}
                        {' \u00b7 '}
                        {modelQueue.buckets?.length || 0} {'\u4e2a\u751f\u6210\u6a21\u5f0f'}
                        {' \u00b7 '}
                        {'\u5f53\u524d'} {modelQueue.effectiveLimit}
                        {modelQueue.reconciling ? ` \u00b7 \u5f85\u6838\u5bf9 ${modelQueue.reconciling}` : ''}
                      </span>
                    </div>
                    {expanded && modelQueue.buckets?.map(bucket => (
                      <div key={bucket.capacityKey} className="grid grid-cols-[minmax(260px,1.4fr)_100px_140px_minmax(300px,1.8fr)] items-center gap-4 border-t border-white/5 bg-white/[0.02] py-2 pl-12 pr-4 text-xs text-slate-400">
                        <span className="truncate" title={`${bucket.modelConfigId} / ${bucket.generationType}`}>
                          {bucket.generationType}
                        </span>
                        <span className="tabular-nums">
                          {bucket.active}/{bucket.currentLimit}
                        </span>
                        <span className="tabular-nums">
                          {'\u5f53\u524d'} {bucket.currentLimit}
                          {bucket.nextLimit ? ` \u2192 ${bucket.nextLimit}` : ''}
                        </span>
                        <span className={bucket.phase === 'circuit_open' || bucket.phase === 'cooling' ? 'text-red-300' : bucket.phase === 'rate_limited' || bucket.phase === 'slow_start' ? 'text-amber-300' : 'text-slate-400'}>
                          {bucket.phase === 'slow_start' && bucket.currentLimit <= (modelQueue.initialLimit || 8)
                            ? '\u4e50\u89c2\u8d77\u6b65'
                            : capacityPhaseLabel(bucket.phase)}
                          {bucket.nextLimit
                            ? ` \u00b7 \u5df2\u63a5\u6536 ${bucket.acceptedInWave || 0}/${bucket.requiredAcceptances || 0}`
                            : ''}
                          {bucket.lastEvidence ? ` \u00b7 ${bucket.lastEvidence}` : ''}
                        </span>
                      </div>
                    ))}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>
      )}



      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 border-b border-white/10 p-4 md:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_minmax(150px,0.7fr)_minmax(150px,0.7fr)_minmax(160px,0.7fr)_auto]">
        <label className="relative min-w-0">
          <span className="sr-only">{'\u641c\u7d22\u6a21\u578b'}</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={modelSearch}
            onChange={event => setModelSearch(event.target.value)}
            placeholder={'\u641c\u7d22\u6a21\u578b'}
            className="glass-input h-10 w-full rounded-md pl-9 pr-3 text-sm text-slate-100"
          />
        </label>
        <select
          value={filters.datasetId || ''}
          onChange={event => setFilters(current => ({ ...current, datasetId: event.target.value || undefined, page: 1 }))}
          className="glass-input h-10 min-w-0 w-full rounded-md px-3 text-sm text-slate-200"
          aria-label={'\u7b5b\u9009\u6570\u636e\u96c6'}
        >
          <option value="">{'\u5168\u90e8\u6570\u636e\u96c6'}</option>
          {datasetOptions.map(dataset => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}
        </select>
        <select
          value={filters.status || ''}
          onChange={event => setFilters(current => ({
            ...current,
            status: event.target.value as GenerationJobStatus | '',
            page: 1,
          }))}
          className="glass-input h-10 min-w-0 w-full rounded-md px-3 text-sm text-slate-200"
          aria-label={'\u7b5b\u9009\u4efb\u52a1\u72b6\u6001'}
        >
          {STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <label className="min-w-0">
          <span className="sr-only">{'\u7b5b\u9009\u521b\u5efa\u8005'}</span>
          <input
            value={creatorSearch}
            onChange={event => setCreatorSearch(event.target.value)}
            placeholder={'\u521b\u5efa\u8005\u59d3\u540d / ID'}
            className="glass-input h-10 w-full rounded-md px-3 text-sm text-slate-100"
          />
        </label>
        <div className="flex min-w-0 items-center justify-end gap-2">
          <button type="button" onClick={() => { void load(true); }} disabled={refreshing} className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-white/10 text-slate-300 hover:bg-white/5 disabled:opacity-50" title={'\u5237\u65b0'}>
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <button type="button" onClick={onNewGeneration} className="inline-flex h-10 items-center gap-2 rounded-md bg-amber-400 px-4 text-sm font-medium text-black hover:bg-amber-300">
            <Wand2 size={16} /> {'\u65b0\u5efa\u751f\u4ea7'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 border-b border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1180px] text-left text-sm">
          <thead className="border-b border-white/10 bg-white/[0.03] text-xs text-slate-400">
            <tr>
              <SortableHeader field="dataset" label={'\u8bc4\u6d4b\u96c6 / \u76ee\u6807\u5217'} sortBy={filters.sortBy} sortDirection={filters.sortDirection} onSort={handleSort} />
              <SortableHeader field="model" label={'\u6a21\u578b'} sortBy={filters.sortBy} sortDirection={filters.sortDirection} onSort={handleSort} />
              <SortableHeader field="status" label={'\u72b6\u6001'} sortBy={filters.sortBy} sortDirection={filters.sortDirection} onSort={handleSort} ascendingDescription={STATUS_SORT_DESCRIPTION} />
              <th className="px-4 py-3 font-medium">Case</th>
              <th className="px-4 py-3 font-medium">{'\u961f\u5217\u539f\u56e0'}</th>
              <SortableHeader field="creator" label={'\u521b\u5efa\u8005'} sortBy={filters.sortBy} sortDirection={filters.sortDirection} onSort={handleSort} />
              <SortableHeader field="createdAt" label={'\u521b\u5efa\u65f6\u95f4'} sortBy={filters.sortBy} sortDirection={filters.sortDirection} onSort={handleSort} />
              <SortableHeader field="updatedAt" label={'\u6700\u8fd1\u6d3b\u52a8'} sortBy={filters.sortBy} sortDirection={filters.sortDirection} onSort={handleSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {jobs.map(job => (
              <tr key={job.id} onClick={() => onOpenBatch(job)} className="cursor-pointer text-slate-300 hover:bg-white/[0.04]">
                <td className="px-4 py-3">
                  <div className="max-w-[260px] truncate font-medium text-slate-100" title={job.datasetName}>{job.datasetName || job.datasetId}</div>
                  <div className="mt-1 max-w-[260px] truncate text-xs text-slate-500" title={job.targetColumn}>{job.targetColumn}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="max-w-[220px] truncate text-slate-200" title={job.modelConfig?.displayName}>{job.modelConfig?.displayName || job.modelConfig?.modelName || '-'}</div>
                  <div className="mt-1 text-xs text-slate-500">{job.modelConfig?.outputModality === 'video' ? '\u89c6\u9891' : '\u56fe\u7247'}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-sm border px-2 py-1 text-xs ${statusClass(job.status)}`}>{statusLabel(job.status)}</span>
                  {(job.unresolved || 0) > 0 && <div className="mt-1 text-xs text-amber-300">{job.unresolved} {'\u5f85\u5904\u7406'}</div>}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  <div><span className="text-emerald-300">{job.succeeded || 0}</span> / {job.total || 0}</div>
                  {!!job.failed && <div className="mt-1 text-xs text-red-300">{'\u5931\u8d25'} {job.failed}</div>}
                </td>
                <td className="px-4 py-3 text-xs">
                  <div className="flex items-center gap-1.5 text-slate-300"><Clock3 size={13} /> {queueReason(job, queue)}</div>
                  {(job.physicalBatchCount || 1) > 1 && (
                    <div className="mt-1 text-slate-500">
                      {'\u5df2\u5408\u5e76'} {job.physicalBatchCount} {'\u6b21\u751f\u6210\u5c1d\u8bd5'}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">{job.createdBy || job.createdByUid || '-'}</td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-400">{formatTime(job.createdAt)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-400">{formatTime(job.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {loading && (
        <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-400">
          <Loader2 size={18} className="animate-spin" /> {'\u52a0\u8f7d\u751f\u4ea7\u4efb\u52a1'}
        </div>
      )}
      {!loading && !jobs.length && !error && (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-slate-400">
          <Wand2 size={28} />
          <div className="text-sm">{'\u6ca1\u6709\u7b26\u5408\u7b5b\u9009\u6761\u4ef6\u7684\u751f\u4ea7\u4efb\u52a1'}</div>
        </div>
      )}

      <footer className="flex items-center justify-between border-t border-white/10 px-4 py-3 text-xs text-slate-400">
        <span>{'\u5171'} {total} {'\u4e2a\u4efb\u52a1'}</span>
        <div className="flex items-center gap-2">
          <button type="button" disabled={page <= 1} onClick={() => setFilters(current => ({ ...current, page: page - 1 }))} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 disabled:opacity-30" title={'\u4e0a\u4e00\u9875'}>
            <ChevronLeft size={15} />
          </button>
          <span>{page} / {pages}</span>
          <button type="button" disabled={page >= pages} onClick={() => setFilters(current => ({ ...current, page: page + 1 }))} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 disabled:opacity-30" title={'\u4e0b\u4e00\u9875'}>
            <ChevronRight size={15} />
          </button>
        </div>
      </footer>
    </section>
  );
};

export default GenerationTaskCenter;
