import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileUp, Link2, RefreshCw, X } from 'lucide-react';

import { parseDatasetSyncManualSource } from '../datasetSyncSourceParser';
import type { DatasetSyncOutputPolicy, DatasetSyncPreview, EvalDataset } from '../types';
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

const outputPolicyLabels: Record<DatasetSyncOutputPolicy, string> = {
  preserve_platform: '保留平台现有结果（默认）',
  fill_platform_blanks: '仅用源表填充平台空值',
  source_overwrite: '源表覆盖（包括空值）',
};

const actionLabel: Record<string, string> = {
  added: '新增',
  updated: '更新',
  deleted: '删除',
  restored: '恢复',
  unchanged: '无变化',
};

const DatasetSyncModal: React.FC<DatasetSyncModalProps> = ({ dataset, onClose, onApplied }) => {
  const [mode, setMode] = useState<SourceMode>(dataset.syncSource?.kind === 'feishu_base' ? 'feishu_base' : 'file');
  const [feishuUrl, setFeishuUrl] = useState(dataset.syncSource?.sourceUrl || '');
  const [pasteText, setPasteText] = useState('');
  const [manualSource, setManualSource] = useState<DatasetSyncSourceInput | null>(null);
  const [manualLabel, setManualLabel] = useState('');
  const [preview, setPreview] = useState<DatasetSyncPreview | null>(null);
  const [outputPolicies, setOutputPolicies] = useState<Record<string, DatasetSyncOutputPolicy>>({});
  const [newColumnRoles, setNewColumnRoles] = useState<Record<string, 'source' | 'output'>>({});
  const [overwriteConfirmed, setOverwriteConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const actionableCases = useMemo(
    () => preview?.cases.filter(item => item.action !== 'unchanged') || [],
    [preview],
  );

  const receivePreview = (next: DatasetSyncPreview) => {
    setPreview(next);
    setOutputPolicies(next.outputPolicies);
    setNewColumnRoles(next.newColumnRoles);
    setOverwriteConfirmed(false);
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
      receivePreview(await createDatasetSyncPreview(dataset, source));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const refreshPreview = async () => {
    if (!preview) return;
    try {
      setBusy(true);
      setError('');
      receivePreview(await updateDatasetSyncPreview(preview.id, { outputPolicies, newColumnRoles }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const applyPreview = async () => {
    if (!preview) return;
    try {
      setBusy(true);
      setError('');
      const saved = await applyDatasetSyncPreview(preview.id, overwriteConfirmed);
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
      setPreview(null);
      setError('');
    } catch (cause) {
      setManualSource(null);
      setManualLabel('');
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const hasDecisionChanges = preview && (
    JSON.stringify(outputPolicies) !== JSON.stringify(preview.outputPolicies)
    || JSON.stringify(newColumnRoles) !== JSON.stringify(preview.newColumnRoles)
  );
  const blocked = Boolean(preview?.validationIssues.length || preview?.blockers.length);

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/75 p-3 sm:p-6">
      <section role="dialog" aria-modal="true" aria-label="同步更新评测集" className="flex max-h-[94vh] w-full max-w-6xl flex-col border border-white/15 bg-slate-950 shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-7">
          <div className="min-w-0">
            <div className="text-xs uppercase text-amber-300">Dataset sync</div>
            <h2 className="mt-1 truncate text-xl font-semibold text-slate-100">同步更新：{dataset.name}</h2>
            <p className="mt-1 text-sm text-slate-400">以 case_id + variant_label 对齐 case。预览确认后生成新版本，历史任务和结果证据不会被删除。</p>
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
                    <span className="mt-2 block text-xs leading-5 text-slate-500">读取整张表，不使用链接中的 view 筛选。应用必须拥有 bitable:app:readonly 权限，并被添加为该 Base 的协作者。</span>
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
                源表列名和顺序会成为当前版本的准确信息结构；必须包含 case_id，variant_label 可为空。同一组合不能重复。平台已有结果列不会因为源表缺列而消失。
              </div>
            </div>
          ) : (
            <div className="px-5 py-5 sm:px-7">
              <div className="grid grid-cols-2 border border-white/10 sm:grid-cols-4 lg:grid-cols-7">
                {Object.entries(preview.summary).map(([key, value]) => (
                  <div key={key} className="border-b border-r border-white/10 px-3 py-3 last:border-r-0">
                    <div className="text-[11px] text-slate-500">{{ added: '新增', updated: '更新', deleted: '删除', restored: '恢复', unchanged: '不变', staleResults: '待重跑结果', sourceResultOverwrites: '源表覆盖' }[key] || key}</div>
                    <div className={`mt-1 text-xl font-semibold ${key === 'deleted' || key === 'sourceResultOverwrites' ? 'text-red-300' : key === 'staleResults' ? 'text-amber-300' : 'text-slate-100'}`}>{value}</div>
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

              <section className="mt-6 border-t border-white/10 pt-5">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-100">列与结果保留策略</h3>
                    <p className="mt-1 text-xs text-slate-500">新列默认是普通字段。只有明确标记为模型结果后，才会按结果策略维护。</p>
                  </div>
                  {hasDecisionChanges && <button type="button" onClick={() => void refreshPreview()} disabled={busy} className="inline-flex items-center gap-2 bg-amber-400 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-300 disabled:opacity-40"><RefreshCw size={16} /> 更新预览</button>}
                </div>
                <div className="mt-3 overflow-x-auto border border-white/10">
                  <table className="w-full min-w-[720px] text-left text-xs">
                    <thead className="bg-black/30 text-slate-500"><tr><th className="px-3 py-2">列名</th><th className="px-3 py-2">来源</th><th className="px-3 py-2">用途</th><th className="px-3 py-2">结果处理</th></tr></thead>
                    <tbody className="divide-y divide-white/10">
                      {preview.sourceHeaders.map(column => {
                        const isNew = Object.prototype.hasOwnProperty.call(preview.newColumnRoles, column);
                        const role = newColumnRoles[column] || (preview.outputColumns.includes(column) ? 'output' : 'source');
                        return (
                          <tr key={column}>
                            <td className="px-3 py-2 font-mono text-slate-200">{column}</td>
                            <td className="px-3 py-2 text-slate-500">{isNew ? '新增列' : '已有列'}</td>
                            <td className="px-3 py-2">
                              {isNew ? <select value={role} onChange={event => setNewColumnRoles(current => ({ ...current, [column]: event.target.value as 'source' | 'output' }))} className="border border-white/10 bg-slate-900 px-2 py-1.5 text-slate-200"><option value="source">普通字段</option><option value="output">模型结果</option></select> : <span className="text-slate-400">{role === 'output' ? '模型结果' : '保留原用途'}</span>}
                            </td>
                            <td className="px-3 py-2">
                              {role === 'output' ? <select value={outputPolicies[column] || 'preserve_platform'} onChange={event => setOutputPolicies(current => ({ ...current, [column]: event.target.value as DatasetSyncOutputPolicy }))} className="w-full border border-white/10 bg-slate-900 px-2 py-1.5 text-slate-200">{Object.entries(outputPolicyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : <span className="text-slate-600">不适用</span>}
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
                  <span>我确认源表将覆盖所选结果列，包括用空值清除平台现有结果。该操作会生成新版本，但会改变当前评测集显示的结果。</span>
                </label>
              )}
            </div>
          )}
        </div>

        {error && <div role="alert" className="border-t border-red-400/30 bg-red-500/10 px-5 py-3 text-sm text-red-200 sm:px-7">{error}</div>}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-5 py-4 sm:px-7">
          <div className="text-xs text-slate-500">当前 v{dataset.version || 1} · {dataset.items.length} case</div>
          <div className="flex gap-2">
            {preview && <button type="button" onClick={() => setPreview(null)} disabled={busy} className="border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-40">返回选择来源</button>}
            <button type="button" onClick={onClose} disabled={busy} className="border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-40">取消</button>
            {!preview ? <button type="button" onClick={() => void createPreview()} disabled={busy} className="inline-flex items-center gap-2 bg-amber-400 px-5 py-2 text-sm font-semibold text-black hover:bg-amber-300 disabled:opacity-40"><RefreshCw size={16} className={busy ? 'animate-spin' : ''} /> 生成同步预览</button> : <button type="button" onClick={() => void applyPreview()} disabled={busy || blocked || Boolean(hasDecisionChanges) || (preview.requiresOverwriteConfirmation && !overwriteConfirmed)} className="inline-flex items-center gap-2 bg-amber-400 px-5 py-2 text-sm font-semibold text-black hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40">{busy ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} 确认并生成新版本</button>}
          </div>
        </footer>
      </section>
    </div>
  );
};

export default DatasetSyncModal;
