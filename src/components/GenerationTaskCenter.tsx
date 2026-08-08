import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
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
  GenerationJobStatus,
  GenerationQueueLane,
  GenerationQueueState,
} from '../types';
import {
  getGenerationQueue,
  listExecutionJobs,
  type GenerationJobListFilters,
} from '../features/generation/executionApi';

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
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
  : '-';

const modelPolicyLabel = (mode: NonNullable<GenerationQueueLane['models']>[number]['mode']) => ({
  initial: '\u65e0\u8fd1\u671f\u5bb9\u91cf\u6837\u672c\uff0c\u4f7f\u7528\u521d\u59cb\u5e76\u53d1',
  ramping: '\u6309\u8fde\u7eed\u6210\u529f\u9010\u7ea7\u6062\u590d\u5e76\u53d1',
  maximum: '\u5df2\u6062\u590d\u5230\u6a21\u578b\u4e0a\u9650',
  minimum: '\u6700\u8fd1\u5bb9\u91cf\u5931\u8d25\u540e\u56de\u5230\u6700\u5c0f\u5e76\u53d1',
}[mode]);

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
      const modelQueue = queue?.video.models?.find(item => item.modelName.toLowerCase() === modelName);
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

  const page = Number(filters.page || 1);
  const limit = Number(filters.limit || 20);
  const pages = Math.max(1, Math.ceil(total / limit));
  const datasetOptions = useMemo(
    () => datasets.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    [datasets],
  );

  return (
    <section className="border border-white/10 bg-black/20">
      <header className="flex justify-end border-b border-white/10 px-4 py-4">
        <div className="grid w-full grid-cols-2 border border-white/10 bg-black/20 sm:w-auto sm:min-w-[360px]">
          <QueueLane icon={<Image size={14} />} label={'\u56fe\u7247\u5bb9\u91cf'} lane={queue?.image} />
          <QueueLane icon={<Video size={14} />} label={'\u89c6\u9891\u5bb9\u91cf'} lane={queue?.video} />
        </div>
      </header>
      {!!queue?.video.models?.length && (
        <div className="border-b border-white/10">
          <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs text-slate-400">
            <span>{'\u89c6\u9891\u6a21\u578b\u81ea\u9002\u5e94\u5bb9\u91cf'}</span>
            <span>{'\u8fd1 24 \u5c0f\u65f6 / \u6700\u8fd1 24 \u6761\u6709\u6548\u7ed3\u679c'}</span>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              {queue.video.models.map(modelQueue => (
                <div key={modelQueue.modelName} className="grid grid-cols-[minmax(220px,1.4fr)_100px_120px_minmax(300px,1.8fr)] items-center gap-4 border-t border-white/10 px-4 py-2 text-xs">
                  <span className="truncate font-medium text-slate-200" title={modelQueue.modelName}>{modelQueue.modelName}</span>
                  <span className="tabular-nums text-slate-300">
                    {'\u5728\u9014'} {modelQueue.active}/{modelQueue.effectiveLimit}
                  </span>
                  <span className="tabular-nums text-slate-400">
                    {'\u7b49\u5f85'} {modelQueue.organizationPending}
                  </span>
                  <span className={modelQueue.mode === 'minimum' ? 'text-red-300' : modelQueue.mode === 'ramping' ? 'text-amber-300' : 'text-slate-400'}>
                    {modelPolicyLabel(modelQueue.mode)}
                    {' \u00b7 '}
                    {'\u8fde\u80dc'} {modelQueue.successStreak}
                    {' \u00b7 '}
                    {modelQueue.minLimit}/{modelQueue.initialLimit}/{modelQueue.maxLimit}
                    {' \u00b7 '}
                    {'\u5f53\u524d'} {modelQueue.effectiveLimit}
                    {modelQueue.reconciling ? ` \u00b7 \u5f85\u6838\u5bf9 ${modelQueue.reconciling}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}



      <div className="grid gap-3 border-b border-white/10 p-4 md:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_minmax(150px,0.7fr)_minmax(150px,0.7fr)_minmax(160px,0.7fr)_auto]">
        <label className="relative">
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
          className="glass-input h-10 rounded-md px-3 text-sm text-slate-200"
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
          className="glass-input h-10 rounded-md px-3 text-sm text-slate-200"
          aria-label={'\u7b5b\u9009\u4efb\u52a1\u72b6\u6001'}
        >
          {STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <label>
          <span className="sr-only">{'\u7b5b\u9009\u521b\u5efa\u8005'}</span>
          <input
            value={creatorSearch}
            onChange={event => setCreatorSearch(event.target.value)}
            placeholder={'\u521b\u5efa\u8005\u59d3\u540d / ID'}
            className="glass-input h-10 w-full rounded-md px-3 text-sm text-slate-100"
          />
        </label>
        <div className="flex items-center justify-end gap-2">
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
        <table className="w-full min-w-[1040px] text-left text-sm">
          <thead className="border-b border-white/10 bg-white/[0.03] text-xs text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">{'\u8bc4\u6d4b\u96c6 / \u76ee\u6807\u5217'}</th>
              <th className="px-4 py-3 font-medium">{'\u6a21\u578b'}</th>
              <th className="px-4 py-3 font-medium">{'\u72b6\u6001'}</th>
              <th className="px-4 py-3 font-medium">Case</th>
              <th className="px-4 py-3 font-medium">{'\u961f\u5217\u539f\u56e0'}</th>
              <th className="px-4 py-3 font-medium">{'\u521b\u5efa\u8005'}</th>
              <th className="px-4 py-3 font-medium">{'\u6700\u8fd1\u6d3b\u52a8'}</th>
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
                  {!!job.retryOfJobId && <div className="mt-1 text-slate-500">Retry {'\u5b50\u6279\u6b21'}</div>}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">{job.createdBy || job.createdByUid || '-'}</td>
                <td className="px-4 py-3 text-xs text-slate-400">{formatTime(job.updatedAt)}</td>
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
