import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckSquare,
  CircleAlert,
  ExternalLink,
  Loader2,
  RefreshCw,
  Settings2,
  SkipForward,
} from 'lucide-react';

import type {
  GenerationCaseReview,
  GenerationPreflightCase,
  GenerationPreflightRepairAction,
} from '../types';
import {
  applyBulkGenerationRepair,
  buildGenerationBulkRepairWorkspace,
  type GenerationBulkRepairAction,
} from '../features/generation/bulkRepair';
import {
  getGenerationFieldLabel,
  getGenerationIssuePresentation,
  type GenerationIssueOption,
} from '../features/generation/preflightPresentation';

interface GenerationIssueRepairWorkspaceProps {
  issue: GenerationIssueOption;
  cases: GenerationPreflightCase[];
  reviews: Record<string, GenerationCaseReview>;
  rowsById: Map<string, Record<string, unknown>>;
  parameterColumns: string[];
  busy: boolean;
  onApply: (reviews: Record<string, GenerationCaseReview>, appliedIds: string[]) => Promise<void>;
  onExclude: (datasetItemIds: string[]) => Promise<void>;
  onReturnToSettings: () => void;
}

const displayValue = (value: unknown) => {
  if (value === undefined) return '未提供';
  if (value === null) return 'null';
  if (typeof value === 'string') return value || '空字符串';
  return JSON.stringify(value);
};

const ruleSourceLabel = (source?: string) => ({
  aion_input_schema: 'Aion input schema',
  aion_parameter_schema: 'Aion parameter schema',
  aion_options: 'Aion options',
  mcp_revision_1813: 'VidMuse MCP revision 1813',
  manueval_validation: 'ManuEval 基础校验',
}[String(source)] || '合同未声明');

const sourceLabel = (source?: string, column?: string) => {
  if (source === 'column' || source === 'case_column_override') return column ? `数据集列 ${column}` : '数据集列';
  if (source === 'uniform') return '批次统一值';
  if (source === 'case_override') return '当前 case 修改';
  if (source === 'unused') return '不发送';
  if (source === 'mapping') return column ? `输入映射列 ${column}` : '输入映射';
  return source || '未记录';
};

const actionKey = (action: GenerationPreflightRepairAction) => {
  if (action.kind === 'set_parameter' || action.kind === 'use_parameter_column' || action.kind === 'omit_parameter') {
    return `${action.kind}:${action.field}`;
  }
  if (action.kind === 'trim_content') return `${action.kind}:${action.field}:${action.maximum}`;
  if (action.kind === 'remove_content_item') return `${action.kind}:${action.field}:${action.index}`;
  return action.kind;
};

const actionLabel = (action: GenerationPreflightRepairAction) => {
  if (action.kind === 'set_parameter') return '统一改为模型支持值';
  if (action.kind === 'use_parameter_column') return '从另一数据集列逐 case 读取';
  if (action.kind === 'omit_parameter') return '本次生成不发送该参数';
  if (action.kind === 'keep_keyframes') return '保留关键帧，移除参考元素和音频';
  if (action.kind === 'keep_references') return '保留参考元素和音频，移除关键帧';
  if (action.kind === 'trim_content') return `按原顺序保留前 ${action.maximum} 项`;
  return `移除第 ${action.index + 1} 项无效素材`;
};

const issueForCase = (item: GenerationPreflightCase, selected: GenerationIssueOption) => (
  selected.severity === 'error' ? item.errors : item.warnings
).find(candidate => candidate.code === selected.code && String(candidate.field || '') === selected.field);

const parseFixedValue = (
  action: Extract<GenerationPreflightRepairAction, { kind: 'set_parameter' }>,
  input: string,
) => {
  if (action.allowedValues?.length) {
    const match = action.allowedValues.find(value => String(value) === input);
    if (match === undefined) throw new Error('请选择一个模型允许值。');
    return match;
  }
  if (action.valueType === 'number') {
    const parsed = Number(input);
    if (!Number.isFinite(parsed)) throw new Error('请输入有效数字。');
    return parsed;
  }
  if (action.valueType === 'boolean') {
    if (input === 'true') return true;
    if (input === 'false') return false;
    throw new Error('请选择 true 或 false。');
  }
  if (action.valueType === 'json') {
    try {
      return JSON.parse(input);
    } catch {
      throw new Error('请输入有效 JSON。');
    }
  }
  if (!input.trim()) throw new Error('请输入替换值。');
  return input;
};

const GenerationIssueRepairWorkspace: React.FC<GenerationIssueRepairWorkspaceProps> = ({
  issue,
  cases,
  reviews,
  rowsById,
  parameterColumns,
  busy,
  onApply,
  onExclude,
  onReturnToSettings,
}) => {
  const workspace = useMemo(() => buildGenerationBulkRepairWorkspace({
    cases,
    reviews,
    severity: issue.severity,
    code: issue.code,
    field: issue.field,
  }), [cases, issue.code, issue.field, issue.severity, reviews]);
  const firstCase = cases.find(item => Boolean(issueForCase(item, issue)));
  const firstIssue = firstCase && issueForCase(firstCase, issue);
  const presentation = firstIssue && getGenerationIssuePresentation(firstIssue, issue.severity);
  const [selectedIds, setSelectedIds] = useState<string[]>(workspace.eligibleIds);
  const [selectedActionKey, setSelectedActionKey] = useState('');
  const [fixedValue, setFixedValue] = useState('');
  const [column, setColumn] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    setSelectedIds(workspace.eligibleIds);
    setSelectedActionKey('');
    setFixedValue('');
    setColumn('');
    setConfirmed(false);
    setLocalError('');
  }, [issue.key, workspace.eligibleIds.join('|')]);

  const selectedAction = workspace.commonActions.find(action => actionKey(action) === selectedActionKey);
  const selectedCases = workspace.cases.filter(item => selectedIds.includes(item.datasetItemId));
  const firstEvidence = firstIssue?.evidence;
  const allowedValues = firstEvidence?.allowedValues || [];
  const requirement = allowedValues.length
    ? `允许值：${allowedValues.map(displayValue).join('、')}`
    : firstEvidence?.minimum !== undefined || firstEvidence?.maximum !== undefined
      ? `允许范围：${firstEvidence.minimum ?? '-∞'} 至 ${firstEvidence.maximum ?? '+∞'}`
      : '模型配置未提供可直接批量替换的枚举或范围。';

  const toggleCase = (datasetItemId: string) => {
    setSelectedIds(current => current.includes(datasetItemId)
      ? current.filter(id => id !== datasetItemId)
      : [...current, datasetItemId]);
    setConfirmed(false);
  };

  const buildAction = (): GenerationBulkRepairAction => {
    if (!selectedAction) throw new Error('请选择修复方式。');
    if (selectedAction.kind === 'set_parameter') {
      return {
        kind: 'set_parameter',
        field: selectedAction.field,
        value: parseFixedValue(selectedAction, fixedValue),
      };
    }
    if (selectedAction.kind === 'use_parameter_column') {
      if (!column) throw new Error('请选择备用数据集列。');
      return { kind: 'use_parameter_column', field: selectedAction.field, column };
    }
    return selectedAction;
  };

  const proposedValue = (datasetItemId: string) => {
    if (!selectedAction) return '尚未选择修复方式';
    if (selectedAction.kind === 'set_parameter') return fixedValue || '尚未选择替换值';
    if (selectedAction.kind === 'use_parameter_column') {
      return column ? displayValue(rowsById.get(datasetItemId)?.[column]) : '尚未选择备用列';
    }
    return actionLabel(selectedAction);
  };

  const apply = async () => {
    setLocalError('');
    try {
      if (!selectedIds.length) throw new Error('至少选择一个 case。');
      const action = buildAction();
      const result = applyBulkGenerationRepair({ workspace, cases, reviews, selectedIds, action });
      if (result.unsupportedActionIds.length) {
        throw new Error(`${result.unsupportedActionIds.length} 个 case 的合同不支持该批量动作，请取消选择后重试。`);
      }
      await onApply(result.reviews, result.appliedIds);
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const exclude = async () => {
    setLocalError('');
    try {
      if (!selectedIds.length) throw new Error('至少选择一个 case。');
      await onExclude(selectedIds);
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <section className={`mt-3 border-l-2 px-4 py-4 ${issue.severity === 'error' ? 'border-red-400 bg-red-500/[0.06]' : 'border-amber-400 bg-amber-500/[0.06]'}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CircleAlert size={17} className={issue.severity === 'error' ? 'text-red-300' : 'text-amber-300'} />
            <h4 className="text-sm font-semibold text-slate-100">{presentation?.title || issue.label}</h4>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-300">{presentation?.description}</p>
          <p className="mt-1 text-xs text-slate-500">问题码 {issue.code} · 修复字段 {getGenerationFieldLabel(issue.field)}</p>
        </div>
        <span className="border border-white/10 px-2 py-1 text-xs text-slate-300">影响 {workspace.targetIds.length} 个 case</span>
      </div>

      <div className="mt-4 grid gap-4 border-y border-white/10 py-4 lg:grid-cols-3">
        <div>
          <div className="text-xs text-slate-500">原始输入与来源</div>
          <div className="mt-2 space-y-1 text-sm text-slate-200">
            {workspace.valueDistribution.slice(0, 8).map(entry => (
              <div key={entry.value} className="flex justify-between gap-3"><code className="truncate" title={entry.value}>{entry.value}</code><span className="shrink-0 text-slate-500">{entry.count} 条</span></div>
            ))}
          </div>
          <div className="mt-2 text-xs text-slate-500">{sourceLabel(firstEvidence?.source, firstEvidence?.sourceColumn)}</div>
          {firstEvidence?.normalizedValue !== undefined && (
            <div className="mt-1 text-xs text-slate-400">当前规范化值：<code className="text-slate-200">{displayValue(firstEvidence.normalizedValue)}</code></div>
          )}
        </div>
        <div>
          <div className="text-xs text-slate-500">当前模型要求</div>
          <div className="mt-2 text-sm leading-6 text-slate-200">{requirement}</div>
          <div className="mt-2 text-xs text-slate-500">来源：{ruleSourceLabel(firstEvidence?.ruleSource)}</div>
          {firstEvidence?.modelConfigFingerprint && <code className="mt-1 block break-all text-[10px] text-slate-600">{firstEvidence.modelConfigFingerprint}</code>}
        </div>
        <div>
          <div className="text-xs text-slate-500">处理路径</div>
          <p className="mt-2 text-sm leading-6 text-slate-200">选择批量修复，或把无法处理的 case 从本次生成中排除。应用后系统会立即读取锁定的数据集版本并重新预检。</p>
          <button type="button" onClick={onReturnToSettings} className="mt-2 inline-flex items-center gap-2 text-xs text-sky-300 hover:text-sky-200"><Settings2 size={14} />返回生成参数设置</button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm font-medium text-slate-100">选择要处理的 case</div>
        <div className="flex gap-2">
          <button type="button" onClick={() => { setSelectedIds(workspace.eligibleIds); setConfirmed(false); }} className="inline-flex items-center gap-1.5 border border-white/10 px-2.5 py-1.5 text-xs text-slate-300"><CheckSquare size={13} />全选可处理项</button>
          <button type="button" onClick={() => { setSelectedIds([]); setConfirmed(false); }} className="border border-white/10 px-2.5 py-1.5 text-xs text-slate-300">清空</button>
        </div>
      </div>
      <p className="mt-1 text-xs text-slate-500">默认选中当前预检中全部同类问题；上方搜索和状态筛选不会改变这里的范围。</p>

      <div className="mt-3 max-h-56 overflow-auto border-y border-white/10">
        <div className="grid min-w-[880px] grid-cols-[28px_minmax(150px,0.7fr)_minmax(170px,1fr)_minmax(170px,1fr)_minmax(170px,1fr)] gap-3 border-b border-white/10 px-2 py-2 text-[11px] text-slate-500">
          <span />
          <span>Case</span>
          <span>数据集原始值</span>
          <span>当前生效值</span>
          <span>待应用值</span>
        </div>
        {workspace.cases.map(item => (
          <label key={item.datasetItemId || item.caseId} className={`grid min-w-[880px] grid-cols-[28px_minmax(150px,0.7fr)_minmax(170px,1fr)_minmax(170px,1fr)_minmax(170px,1fr)] items-center gap-3 border-b border-white/5 px-2 py-2.5 text-xs last:border-0 ${item.expertConflict || !item.datasetItemId ? 'text-slate-600' : 'text-slate-200'}`}>
            <input
              type="checkbox"
              disabled={item.expertConflict || !item.datasetItemId}
              checked={Boolean(item.datasetItemId && selectedIds.includes(item.datasetItemId))}
              onChange={() => toggleCase(item.datasetItemId)}
            />
            <span className="truncate" title={item.caseId}>{item.caseId}</span>
            <span className="truncate" title={displayValue(item.rawValue)}>{item.sourceColumn ? `${item.sourceColumn}: ` : ''}{displayValue(item.rawValue)}</span>
            <span className="truncate" title={displayValue(item.normalizedValue)}>{displayValue(item.normalizedValue)}</span>
            <span className="truncate" title={item.expertConflict ? '专家 JSON 已接管' : proposedValue(item.datasetItemId)}>{item.expertConflict ? '专家 JSON 已接管，不能批量修改' : proposedValue(item.datasetItemId)}</span>
          </label>
        ))}
      </div>

      {(workspace.expertConflictIds.length > 0 || workspace.missingStableIdCount > 0) && (
        <div className="mt-3 text-xs leading-5 text-amber-200">
          {workspace.expertConflictIds.length > 0 && <div>{workspace.expertConflictIds.length} 个 case 使用专家最终 Aion JSON，已保持未选。</div>}
          {workspace.missingStableIdCount > 0 && <div>{workspace.missingStableIdCount} 个 case 缺少稳定 ID，不能安全批量修改或排除。</div>}
        </div>
      )}

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(220px,0.8fr)_minmax(260px,1.2fr)]">
        <label className="text-xs text-slate-400">
          <span className="mb-1.5 block">批量处理方式</span>
          <select value={selectedActionKey} onChange={event => { setSelectedActionKey(event.target.value); setFixedValue(''); setColumn(''); setConfirmed(false); }} className="h-10 w-full border border-white/10 bg-slate-950 px-3 text-sm text-slate-100">
            <option value="">选择修复方式</option>
            {workspace.commonActions.map(action => <option key={actionKey(action)} value={actionKey(action)}>{actionLabel(action)}</option>)}
          </select>
        </label>
        <div>
          {selectedAction?.kind === 'set_parameter' && (
            <label className="block text-xs text-slate-400">
              <span className="mb-1.5 block">待应用的新值</span>
              {selectedAction.allowedValues?.length ? (
                <select value={fixedValue} onChange={event => { setFixedValue(event.target.value); setConfirmed(false); }} className="h-10 w-full border border-white/10 bg-slate-950 px-3 text-sm text-slate-100">
                  <option value="">选择模型支持值</option>
                  {selectedAction.allowedValues.map(value => <option key={String(value)} value={String(value)}>{displayValue(value)}</option>)}
                </select>
              ) : (
                <input
                  type={selectedAction.valueType === 'number' ? 'number' : 'text'}
                  min={selectedAction.minimum}
                  max={selectedAction.maximum}
                  step={selectedAction.valueType === 'number' ? 'any' : undefined}
                  value={fixedValue}
                  onChange={event => { setFixedValue(event.target.value); setConfirmed(false); }}
                  placeholder="输入替换值"
                  className="h-10 w-full border border-white/10 bg-slate-950 px-3 text-sm text-slate-100"
                />
              )}
            </label>
          )}
          {selectedAction?.kind === 'use_parameter_column' && (
            <label className="block text-xs text-slate-400">
              <span className="mb-1.5 block">备用数据集列</span>
              <select value={column} onChange={event => { setColumn(event.target.value); setConfirmed(false); }} className="h-10 w-full border border-white/10 bg-slate-950 px-3 text-sm text-slate-100">
                <option value="">选择列</option>
                {parameterColumns.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
          )}
          {!workspace.commonActions.length && (
            <div className="flex h-10 items-center text-xs text-amber-200">合同没有给出可确定执行的批量修复，只能逐条处理或批量排除。</div>
          )}
        </div>
      </div>

      {selectedCases.length > 0 && (
        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="text-xs font-medium text-slate-300">应用前后对照</div>
          <div className="mt-2 max-h-40 overflow-auto text-xs">
            {selectedCases.map(item => (
              <div key={`preview-${item.datasetItemId}`} className="grid min-w-[680px] grid-cols-[minmax(130px,0.7fr)_minmax(180px,1fr)_20px_minmax(180px,1fr)] items-center gap-2 border-b border-white/5 py-2 last:border-0">
                <span className="truncate text-slate-400">{item.caseId}</span>
                <code className="truncate text-red-200" title={displayValue(item.rawValue)}>{displayValue(item.rawValue)}</code>
                <ArrowRight size={13} className="text-slate-600" />
                <code className="truncate text-emerald-200" title={proposedValue(item.datasetItemId)}>{proposedValue(item.datasetItemId)}</code>
              </div>
            ))}
          </div>
        </div>
      )}

      {localError && <div className="mt-3 flex items-start gap-2 text-xs text-red-200"><CircleAlert size={14} className="mt-0.5 shrink-0" />{localError}</div>}
      <label className="mt-4 flex items-start gap-2 text-xs text-slate-300">
        <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-0.5" />
        <span>我已核对上方选中范围和修改前后值；本操作只影响本次生成，应用后立即重新预检。</span>
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy || !confirmed || !selectedIds.length || !selectedAction} onClick={() => { void apply(); }} className="inline-flex items-center gap-2 bg-amber-500 px-3 py-2 text-xs font-medium text-black disabled:opacity-40">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}应用到 {selectedIds.length} 个 case 并重新预检
        </button>
        <button type="button" disabled={busy || !confirmed || !selectedIds.length} onClick={() => { void exclude(); }} className="inline-flex items-center gap-2 border border-white/15 px-3 py-2 text-xs text-slate-200 disabled:opacity-40">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <SkipForward size={14} />}从本次生成中排除 {selectedIds.length} 个 case
        </button>
        <button type="button" onClick={onReturnToSettings} className="inline-flex items-center gap-2 border border-white/10 px-3 py-2 text-xs text-slate-300"><ExternalLink size={13} />调整整个批次设置</button>
      </div>
    </section>
  );
};

export default GenerationIssueRepairWorkspace;
