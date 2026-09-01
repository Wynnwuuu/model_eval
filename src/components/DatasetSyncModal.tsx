import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileUp, Link2, RefreshCw, X } from 'lucide-react';

import { parseDatasetSyncManualSource } from '../datasetSyncSourceParser';
import type {
  DatasetSyncColumnRole,
  DatasetSyncMode,
  DatasetSyncOutputPolicy,
  DatasetSyncPreview,
  EvalDataset,
} from '../types';
import {
  applyDatasetSyncPreview,
  createDatasetSyncPreview,
  updateDatasetSyncPreview,
  type DatasetSyncSourceInput,
} from '../features/datasets/api';

interface DatasetSyncModalProps {
  dataset: EvalDataset;
  onClose: () => void;
  onApplied: (dataset: EvalDataset) => void;
}

type SourceMode = 'feishu_base' | 'file' | 'paste';

interface SyncDecisions {
  syncMode: DatasetSyncMode;
  outputPolicies: Record<string, DatasetSyncOutputPolicy>;
  columnRoles: Record<string, DatasetSyncColumnRole>;
}

const outputPolicyLabels: Record<DatasetSyncOutputPolicy, string> = {
  preserve_platform: '平台结果优先',
  fill_platform_blanks: '仅补齐平台空值',
  source_overwrite: '完全以源表为准（含清空）',
};

const actionLabel: Record<string, string> = {
  added: '新增',
  updated: '更新',
  deleted: '删除',
  restored: '恢复',
  unchanged: '无变化',
};

const sortedRecord = <T,>(value?: Record<string, T>) => Object.fromEntries(
  Object.entries(value || {}).sort(([left], [right]) => left.localeCompare(right)),
);

const decisionsSignature = (decisions: SyncDecisions) => {
  const outputPolicies = Object.fromEntries(
    Object.entries(decisions.outputPolicies).filter(([column]) => decisions.columnRoles[column] !== 'source'),
  );
  Object.entries(decisions.columnRoles).forEach(([column, role]) => {
    if (role === 'output' && !outputPolicies[column]) outputPolicies[column] = 'preserve_platform';
  });
  return JSON.stringify({
    syncMode: decisions.syncMode,
    outputPolicies: sortedRecord(outputPolicies),
    columnRoles: sortedRecord(decisions.columnRoles),
  });
};

const previewDecisions = (preview: DatasetSyncPreview): SyncDecisions => ({
  syncMode: preview.syncMode || 'snapshot',
  outputPolicies: preview.outputPolicies || {},
  columnRoles: preview.columnRoles || preview.newColumnRoles || {},
});

const normalizePreview = (preview: DatasetSyncPreview): DatasetSyncPreview => {
  const summary = {
    ...preview.summary,
    sourceResultFills: preview.summary?.sourceResultFills || 0,
    sourceResultReplacements: preview.summary?.sourceResultReplacements || 0,
    sourceResultClears: preview.summary?.sourceResultClears || 0,
    outputColumnsPromoted: preview.summary?.outputColumnsPromoted || 0,
    outputColumnsDemoted: preview.summary?.outputColumnsDemoted || 0,
  };
  const outputSet = new Set(preview.outputColumns || []);
  const columnRoles = preview.columnRoles || preview.newColumnRoles || Object.fromEntries(
    (preview.sourceHeaders || []).map(column => [column, outputSet.has(column) ? 'output' : 'source']),
  );
  const hasChanges = preview.hasChanges ?? Boolean(
    preview.cases?.some(item => item.action !== 'unchanged')
    || summary.outputColumnsPromoted
    || summary.outputColumnsDemoted,
  );
  return {
    ...preview,
    summary,
    syncMode: preview.syncMode || 'snapshot',
    outputPolicies: preview.outputPolicies || {},
    columnRoles,
    newColumnRoles: preview.newColumnRoles || columnRoles,
    ignoredSourceColumns: preview.ignoredSourceColumns || [],
    warnings: preview.warnings || [],
    hasChanges,
    decisionFingerprint: preview.decisionFingerprint || '',
    requiresDeletionConfirmation: preview.requiresDeletionConfirmation ?? Boolean(summary.deleted),
    requiresDemotionConfirmation: preview.requiresDemotionConfirmation ?? Boolean(summary.outputColumnsDemoted),
  };
};

const DatasetSyncModal: React.FC<DatasetSyncModalProps> = ({ dataset, onClose, onApplied }) => {
  const [mode, setMode] = useState<SourceMode>(dataset.syncSource?.kind === 'feishu_base' ? 'feishu_base' : 'file');
  const [feishuUrl, setFeishuUrl] = useState(dataset.syncSource?.sourceUrl || '');
  const [pasteText, setPasteText] = useState('');
  const [manualSource, setManualSource] = useState<DatasetSyncSourceInput | null>(null);
  const [manualLabel, setManualLabel] = useState('');
  const [preview, setPreview] = useState<DatasetSyncPreview | null>(null);
  const [syncMode, setSyncMode] = useState<DatasetSyncMode>('merge');
  const [outputPolicies, setOutputPolicies] = useState<Record<string, DatasetSyncOutputPolicy>>({});
  const [columnRoles, setColumnRoles] = useState<Record<string, DatasetSyncColumnRole>>({});
  const [overwriteConfirmed, setOverwriteConfirmed] = useState(false);
  const [deletionConfirmed, setDeletionConfirmed] = useState(false);
  const [demotionConfirmed, setDemotionConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<DatasetSyncPreview | null>(null);
  const desiredDecisionsRef = useRef<SyncDecisions | null>(null);
  const refreshRunningRef = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failedDecisionSignatureRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  const actionableCases = useMemo(
    () => preview?.cases.filter(item => item.action !== 'unchanged') || [],
    [preview],
  );

  const resetConfirmations = () => {
    setOverwriteConfirmed(false);
    setDeletionConfirmed(false);
    setDemotionConfirmed(false);
  };

  const receivePreview = (next: DatasetSyncPreview, resetDecisions: boolean) => {
    const normalized = normalizePreview(next);
    previewRef.current = normalized;
    setPreview(normalized);
    if (resetDecisions) {
      setSyncMode(normalized.syncMode);
      setOutputPolicies(normalized.outputPolicies);
      setColumnRoles(normalized.columnRoles);
      desiredDecisionsRef.current = previewDecisions(normalized);
    }
    resetConfirmations();
    failedDecisionSignatureRef.current = null;
  };

  const createPreview = async () => {
    try {
      setBusy(true);
      setError('');
      let source: DatasetSyncSourceInput;
      if (mode === 'feishu_base') source = { kind: 'feishu_base', url: feishuUrl.trim() };
      else if (mode === 'paste') source = parseDatasetSyncManualSource(pasteText, '粘贴内容');
      else {
        if (!manualSource) throw new Error('请选择 CSV、TSV 或 JSON 文件。');
        source = manualSource;
      }
      receivePreview(await createDatasetSyncPreview(dataset, source), true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const refreshPreviewQueue = async () => {
    if (refreshRunningRef.current) return;
    refreshRunningRef.current = true;
    setRecalculating(true);
    try {
      while (mountedRef.current) {
        const activePreview = previewRef.current;
        const desired = desiredDecisionsRef.current;
        if (!activePreview || !desired) break;
        const desiredSignature = decisionsSignature(desired);
        if (desiredSignature === decisionsSignature(previewDecisions(activePreview))) break;
        try {
          setError('');
          const next = await updateDatasetSyncPreview(activePreview.id, desired);
          if (!mountedRef.current || previewRef.current?.id !== activePreview.id) break;
          receivePreview(next, false);
        } catch (cause) {
          failedDecisionSignatureRef.current = desiredSignature;
          setError(cause instanceof Error ? cause.message : String(cause));
          break;
        }
      }
    } finally {
      refreshRunningRef.current = false;
      if (mountedRef.current) setRecalculating(false);
    }
  };

  const retryPreview = () => {
    failedDecisionSignatureRef.current = null;
    void refreshPreviewQueue();
  };

  const applyPreview = async () => {
    if (!preview) return;
    try {
      setBusy(true);
      setError('');
      const saved = await applyDatasetSyncPreview(preview.id, {
        decisionFingerprint: preview.decisionFingerprint,
        confirmSourceOverwrite: overwriteConfirmed,
        confirmSourceResultOverwrite: overwriteConfirmed,
        confirmCaseDeletion: deletionConfirmed,
        confirmOutputDemotion: demotionConfirmed,
      });
      onApplied(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const loadFile = async (file?: File) => {
    if (!file) return;
    try {
      const text = await file.text();
      setManualSource(parseDatasetSyncManualSource(text, file.name));
      setManualLabel(file.name);
      previewRef.current = null;
      setPreview(null);
      setError('');
    } catch (cause) {
      setManualSource(null);
      setManualLabel('');
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const resetPreview = () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    previewRef.current = null;
    desiredDecisionsRef.current = null;
    setPreview(null);
    setRecalculating(false);
    setError('');
  };

  const localDecisions = useMemo<SyncDecisions>(() => ({ syncMode, outputPolicies, columnRoles }), [syncMode, outputPolicies, columnRoles]);
  const localDecisionSignature = decisionsSignature(localDecisions);
  const serverDecisionSignature = preview ? decisionsSignature(previewDecisions(preview)) : '';
  const hasDecisionChanges = Boolean(preview && localDecisionSignature !== serverDecisionSignature);

  useEffect(() => {
    desiredDecisionsRef.current = localDecisions;
    if (!preview || !hasDecisionChanges) {
      if (!refreshRunningRef.current) setRecalculating(false);
      return;
    }
    if (failedDecisionSignatureRef.current === localDecisionSignature) return;
    setRecalculating(true);
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => void refreshPreviewQueue(), 300);
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [preview?.id, preview?.decisionFingerprint, localDecisionSignature, hasDecisionChanges]);

  useEffect(() => {
    // React Strict Mode runs an extra setup/cleanup cycle in development.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  const blocked = Boolean(preview?.validationIssues.length || preview?.blockers.length);
  const confirmationMissing = Boolean(
    (preview?.requiresOverwriteConfirmation && !overwriteConfirmed)
    || (preview?.requiresDeletionConfirmation && !deletionConfirmed)
    || (preview?.requiresDemotionConfirmation && !demotionConfirmed)
  );
  const applyDisabled = busy || recalculating || hasDecisionChanges || blocked || confirmationMissing || !preview?.hasChanges;
  const disabledReason = !preview
    ? ''
    : recalculating || hasDecisionChanges
      ? '正在重新计算同步影响…'
      : blocked
        ? '请先解决预览中的阻断项。'
        : confirmationMissing
          ? '请确认下方标出的数据变更。'
          : !preview.hasChanges
            ? '当前数据与平台版本一致，无需生成新版本。'
            : '';

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/75 p-3 sm:p-6">
      <section role="dialog" aria-modal="true" aria-label="同步更新评测集" className="flex max-h-[94vh] w-full max-w-6xl flex-col border border-white/15 bg-slate-950 shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-7">
          <div className="min-w-0">
            <div className="text-xs uppercase text-amber-300">Dataset sync</div>
            <h2 className="mt-1 truncate text-xl font-semibold text-slate-100">同步更新：{dataset.name}</h2>
            <p className="mt-1 text-sm text-slate-400">按 case_id + variant_label 对齐，确认影响后生成一个新版本。</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="inline-flex h-10 w-10 shrink-0 items-center justify-center border border-white/10 text-slate-400 hover:text-white disabled:opacity-40" aria-label="关闭">
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!preview ? (
            <div className="mx-auto max-w-4xl px-5 py-6 sm:px-7">
              <div className="flex flex-wrap border border-white/10 p-1">
                {([
                  ['feishu_base', '飞书 Base', Link2],
                  ['file', '上传文件', FileUp],
                  ['paste', '粘贴内容', FileUp],
                ] as const).map(([value, label, Icon]) => (
                  <button key={value} type="button" onClick={() => { setMode(value); setError(''); }} className={`flex min-h-10 flex-1 items-center justify-center gap-2 px-4 text-sm ${mode === value ? 'bg-amber-400 text-black' : 'text-slate-300 hover:bg-white/5'}`}>
                    <Icon size={16} /> {label}
                  </button>
                ))}
              </div>

              <div className="mt-6 border-t border-white/10 pt-6">
                {mode === 'feishu_base' && (
                  <label className="block">
                    <span className="text-sm font-medium text-slate-200">飞书多维表格链接</span>
                    <input value={feishuUrl} onChange={event => setFeishuUrl(event.target.value)} placeholder="https://...feishu.cn/base/...?...table=tbl..." className="mt-2 w-full border border-white/15 bg-black/25 px-4 py-3 text-sm text-slate-100 outline-none focus:border-amber-400/60" />
                    <span className="mt-2 block text-xs leading-5 text-slate-500">读取整张表，不使用链接中的 view 筛选。</span>
                  </label>
                )}
                {mode === 'file' && (
                  <div>
                    <input ref={fileRef} type="file" accept=".csv,.tsv,.json,text/csv,text/tab-separated-values,application/json" onChange={event => void loadFile(event.target.files?.[0])} className="hidden" />
                    <button type="button" onClick={() => fileRef.current?.click()} className="flex w-full items-center justify-center gap-3 border border-dashed border-white/20 px-5 py-10 text-sm text-slate-300 hover:border-amber-400/50 hover:text-amber-200">
                      <FileUp size={20} /> {manualLabel || '选择 CSV、TSV 或 JSON 文件'}
                    </button>
                  </div>
                )}
                {mode === 'paste' && (
                  <label className="block">
                    <span className="text-sm font-medium text-slate-200">粘贴 CSV、TSV 或 JSON</span>
                    <textarea value={pasteText} onChange={event => setPasteText(event.target.value)} rows={12} className="mt-2 w-full resize-y border border-white/15 bg-black/25 p-4 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-amber-400/60" />
                  </label>
                )}
              </div>

              <div className="mt-6 border-l-2 border-amber-400 bg-amber-500/5 px-4 py-3 text-xs leading-5 text-slate-300">
                必须包含 case_id；variant_label 可为空，同一组合不能重复。
              </div>
            </div>
          ) : (
            <div className="px-5 py-5 sm:px-7">
              <section>
                <h3 className="text-sm font-semibold text-slate-100">同步方式</h3>
                <div className="mt-3 inline-flex border border-white/10 p-1">
                  <button type="button" aria-pressed={syncMode === 'merge'} onClick={() => setSyncMode('merge')} className={`px-4 py-2 text-sm ${syncMode === 'merge' ? 'bg-amber-400 font-semibold text-black' : 'text-slate-300 hover:bg-white/5'}`}>仅更新/新增</button>
                  <button type="button" aria-pressed={syncMode === 'snapshot'} onClick={() => setSyncMode('snapshot')} className={`px-4 py-2 text-sm ${syncMode === 'snapshot' ? 'bg-amber-400 font-semibold text-black' : 'text-slate-300 hover:bg-white/5'}`}>完整快照</button>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {syncMode === 'merge' ? '保留源表未出现的 case 和列。' : '源表未出现的 case 将从新版本移除。'}
                </p>
              </section>

              <div className="mt-5 grid grid-cols-2 border border-white/10 sm:grid-cols-4 lg:grid-cols-8">
                {([
                  ['added', '新增', preview.summary.added],
                  ['updated', '更新', preview.summary.updated],
                  ['deleted', '删除', preview.summary.deleted],
                  ['restored', '恢复', preview.summary.restored],
                  ['staleResults', '待重跑结果', preview.summary.staleResults],
                  ['sourceResultFills', '结果补齐', preview.summary.sourceResultFills],
                  ['sourceResultReplacements', '结果替换', preview.summary.sourceResultReplacements],
                  ['sourceResultClears', '结果清空', preview.summary.sourceResultClears],
                ] as const).map(([key, label, value]) => (
                  <div key={key} className="border-b border-r border-white/10 px-3 py-3 last:border-r-0">
                    <div className="text-[11px] text-slate-500">{label}</div>
                    <div className={`mt-1 text-xl font-semibold ${['deleted', 'sourceResultReplacements', 'sourceResultClears'].includes(key) && value ? 'text-red-300' : key === 'staleResults' && value ? 'text-amber-300' : 'text-slate-100'}`}>{value}</div>
                  </div>
                ))}
              </div>

              {(preview.validationIssues.length > 0 || preview.blockers.length > 0) && (
                <div className="mt-4 border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                  <div className="flex items-center gap-2 font-medium"><AlertTriangle size={16} /> 当前预览不能应用</div>
                  {preview.validationIssues.map(issue => <div key={`${issue.code}-${issue.message}`} className="mt-2 text-xs">{issue.message}</div>)}
                  {preview.blockers.map(item => <div key={item.jobId} className="mt-2 text-xs">批次 {item.jobId}：{item.reasons.join('；')}（{item.caseIds.length} 个 case）</div>)}
                </div>
              )}

              {preview.warnings.map(warning => (
                <div key={warning.code} className="mt-4 border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  <div className="font-medium">{warning.message}</div>
                  {warning.columns?.length ? <div className="mt-1 break-all font-mono text-xs text-amber-200/80">{warning.columns.join('、')}</div> : null}
                </div>
              ))}

              <section className="mt-6 border-t border-white/10 pt-5">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-100">列类型与结果同步规则</h3>
                    <p className="mt-1 text-xs text-slate-500">模型结果列使用结果同步规则；数据字段按所选同步方式更新。</p>
                  </div>
                  {recalculating && <div className="inline-flex items-center gap-2 text-xs text-amber-200"><RefreshCw size={14} className="animate-spin" /> 正在重新计算</div>}
                  {!recalculating && error && hasDecisionChanges && <button type="button" onClick={retryPreview} className="inline-flex items-center gap-2 border border-amber-400/40 px-3 py-2 text-xs text-amber-200 hover:bg-amber-500/10"><RefreshCw size={14} /> 重试计算</button>}
                </div>
                <div className="mt-3 overflow-x-auto border border-white/10">
                  <table className="w-full min-w-[760px] text-left text-xs">
                    <thead className="bg-black/30 text-slate-500"><tr><th className="px-3 py-2">列名</th><th className="px-3 py-2">列状态</th><th className="px-3 py-2">列类型</th><th className="px-3 py-2">模型结果同步规则</th></tr></thead>
                    <tbody className="divide-y divide-white/10">
                      {preview.sourceHeaders.map(column => {
                        const existingField = dataset.inputSchema.find(field => field.key === column);
                        const isNew = !existingField;
                        const ignored = preview.ignoredSourceColumns.includes(column);
                        const locked = ['case_id', 'variant_label'].includes(column) || existingField?.role === 'system';
                        const role = columnRoles[column] || (preview.outputColumns.includes(column) ? 'output' : 'source');
                        return (
                          <tr key={column}>
                            <td className="px-3 py-2 font-mono text-slate-200">{column}</td>
                            <td className="px-3 py-2 text-slate-500">{isNew ? '新列' : '已有列'}</td>
                            <td className="px-3 py-2">
                              {ignored
                                ? <span className="text-amber-300">平台生成记录（忽略源值）</span>
                                : locked
                                  ? <span className="text-slate-400">数据字段（锁定）</span>
                                  : <select value={role} onChange={event => setColumnRoles(current => ({ ...current, [column]: event.target.value as DatasetSyncColumnRole }))} className="border border-white/10 bg-slate-900 px-2 py-1.5 text-slate-200"><option value="source">数据字段</option><option value="output">模型结果</option></select>}
                            </td>
                            <td className="px-3 py-2">
                              {!ignored && role === 'output'
                                ? <select value={outputPolicies[column] || 'preserve_platform'} onChange={event => setOutputPolicies(current => ({ ...current, [column]: event.target.value as DatasetSyncOutputPolicy }))} className="w-full border border-white/10 bg-slate-900 px-2 py-1.5 text-slate-200">{Object.entries(outputPolicyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                                : <span className="text-slate-600">不适用</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="mt-6 border-t border-white/10 pt-5">
                <h3 className="text-sm font-semibold text-slate-100">Case 变更明细</h3>
                <div className="mt-3 max-h-[320px] overflow-auto border border-white/10">
                  <table className="w-full min-w-[760px] text-left text-xs">
                    <thead className="sticky top-0 bg-slate-950 text-slate-500"><tr><th className="px-3 py-2">case_id</th><th className="px-3 py-2">variant_label</th><th className="px-3 py-2">变更</th><th className="px-3 py-2">字段</th><th className="px-3 py-2">结果状态</th></tr></thead>
                    <tbody className="divide-y divide-white/10">
                      {actionableCases.map(item => <tr key={item.stableItemId || item.identity}><td className="px-3 py-2 font-medium text-slate-200">{item.caseId}</td><td className="px-3 py-2 text-slate-400">{item.variantLabel || '（空）'}</td><td className="px-3 py-2 text-amber-200">{actionLabel[item.action]}</td><td className="max-w-[420px] px-3 py-2 text-slate-400">{item.fieldChanges.map(change => change.field).join('、') || '-'}</td><td className="px-3 py-2">{item.staleOutputColumns.length ? <span className="text-amber-300">{item.staleOutputColumns.join('、')} 待重新生成</span> : <span className="text-slate-600">-</span>}</td></tr>)}
                      {!actionableCases.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">源数据与当前版本没有变化。</td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>

              {preview.requiresOverwriteConfirmation && (
                <label className="mt-5 flex items-start gap-3 border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                  <input type="checkbox" checked={overwriteConfirmed} onChange={event => setOverwriteConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-red-400" />
                  <span>我确认源表将替换 {preview.summary.sourceResultReplacements} 个结果并清空 {preview.summary.sourceResultClears} 个结果；旧生成记录将从当前版本移除。</span>
                </label>
              )}
              {preview.requiresDeletionConfirmation && (
                <label className="mt-3 flex items-start gap-3 border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                  <input type="checkbox" checked={deletionConfirmed} onChange={event => setDeletionConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-red-400" />
                  <span>我确认完整快照将从新版本移除 {preview.summary.deleted} 个 case；关联任务中的对应条目会归档，历史评分快照保留。</span>
                </label>
              )}
              {preview.requiresDemotionConfirmation && (
                <label className="mt-3 flex items-start gap-3 border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  <input type="checkbox" checked={demotionConfirmed} onChange={event => setDemotionConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-400" />
                  <span>我确认将 {preview.summary.outputColumnsDemoted} 个模型结果列改为数据字段；已有人工评测任务保留原绑定，当前版本移除这些列的生成审计记录。</span>
                </label>
              )}
            </div>
          )}
        </div>

        {error && <div role="alert" className="border-t border-red-400/30 bg-red-500/10 px-5 py-3 text-sm text-red-200 sm:px-7">{error}</div>}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-5 py-4 sm:px-7">
          <div className="min-w-0 text-xs text-slate-500">
            <div>当前 v{dataset.version || 1} · {dataset.items.length} case</div>
            {disabledReason && <div className="mt-1 text-amber-200">{disabledReason}</div>}
          </div>
          <div className="flex flex-wrap gap-2">
            {preview && <button type="button" onClick={resetPreview} disabled={busy} className="border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-40">返回选择来源</button>}
            <button type="button" onClick={onClose} disabled={busy} className="border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-40">取消</button>
            {!preview
              ? <button type="button" onClick={() => void createPreview()} disabled={busy} className="inline-flex items-center gap-2 bg-amber-400 px-5 py-2 text-sm font-semibold text-black hover:bg-amber-300 disabled:opacity-40"><RefreshCw size={16} className={busy ? 'animate-spin' : ''} /> 生成同步预览</button>
              : <button type="button" onClick={() => void applyPreview()} disabled={applyDisabled} className="inline-flex items-center gap-2 bg-amber-400 px-5 py-2 text-sm font-semibold text-black hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40">{busy || recalculating ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} {preview.hasChanges ? '确认并生成新版本' : '当前已是最新版本'}</button>}
          </div>
        </footer>
      </section>
    </div>
  );
};

export default DatasetSyncModal;
