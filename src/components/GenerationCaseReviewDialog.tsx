import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft,
  ChevronRight,
  Save,
  X,
} from 'lucide-react';

import type {
  GenerationCaseReview,
  GenerationContractFinding,
  GenerationPreflightCase,
} from '../types';
import {
  GENERATION_FORCEABLE_PREFLIGHT_CODES,
  generationForceRequiresFinalJson,
} from '../features/generation/preflightReview';
import {
  getGenerationCaseId,
  getGenerationIssuePresentation,
} from '../features/generation/preflightPresentation';

type ReviewDialogTab = 'issues' | 'edit' | 'audit';

interface GenerationCaseReviewDialogProps {
  item: GenerationPreflightCase;
  position: number;
  total: number;
  review?: GenerationCaseReview;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onSave: (datasetItemId: string, review: GenerationCaseReview) => void;
  onAcceptFindingRule: (ruleId: string) => void;
}

const serializePrompt = (value: unknown) => typeof value === 'string'
  ? value
  : JSON.stringify(value ?? '', null, 2);

const cloneReview = (review?: GenerationCaseReview): GenerationCaseReview => review
  ? JSON.parse(JSON.stringify(review))
  : {};

const JsonPanel: React.FC<{ label: string; value: unknown }> = ({ label, value }) => (
  <section className="border border-white/10 bg-black/20">
    <h4 className="border-b border-white/10 px-3 py-2 text-xs font-medium text-sky-200">{label}</h4>
    <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-all p-3 text-[11px] leading-5 text-slate-300">
      {JSON.stringify(value ?? {}, null, 2)}
    </pre>
  </section>
);

const GenerationCaseReviewDialog: React.FC<GenerationCaseReviewDialogProps> = ({
  item,
  position,
  total,
  review,
  onClose,
  onPrevious,
  onNext,
  onSave,
  onAcceptFindingRule,
}) => {
  const datasetItemId = String(item.resolvedCase.datasetItemId || '');
  const caseId = getGenerationCaseId(item);
  const audit = item.resolvedCase.compilerAudit;
  const findings = (audit?.contractFindings || []) as GenerationContractFinding[];
  const defaultForceRuleCodes = useMemo(() => Array.from(new Set(item.errors
    .map(issue => issue.code)
    .filter(code => GENERATION_FORCEABLE_PREFLIGHT_CODES.has(code)))), [item.errors]);
  const [tab, setTab] = useState<ReviewDialogTab>('issues');
  const [draftReview, setDraftReview] = useState<GenerationCaseReview>(() => cloneReview(review));
  const [promptDraft, setPromptDraft] = useState(() => serializePrompt(
    review?.promptOverride !== undefined ? review.promptOverride : item.resolvedCase.prompt,
  ));
  const [requestDraft, setRequestDraft] = useState(() => JSON.stringify(
    review?.finalAionRequest || audit?.finalAionRequest || {}, null, 2,
  ));
  const [useRequestOverride, setUseRequestOverride] = useState(Boolean(review?.finalAionRequest));
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    setTab('issues');
    setDraftReview(cloneReview(review));
    setPromptDraft(serializePrompt(
      review?.promptOverride !== undefined ? review.promptOverride : item.resolvedCase.prompt,
    ));
    setRequestDraft(JSON.stringify(review?.finalAionRequest || audit?.finalAionRequest || {}, null, 2));
    setUseRequestOverride(Boolean(review?.finalAionRequest));
    setLocalError('');
  }, [audit?.finalAionRequest, datasetItemId, item.resolvedCase.prompt, review]);

  const initialSnapshot = useMemo(() => JSON.stringify({
    review: cloneReview(review),
    prompt: serializePrompt(review?.promptOverride !== undefined ? review.promptOverride : item.resolvedCase.prompt),
    request: JSON.stringify(review?.finalAionRequest || audit?.finalAionRequest || {}, null, 2),
    useRequestOverride: Boolean(review?.finalAionRequest),
  }), [audit?.finalAionRequest, item.resolvedCase.prompt, review]);
  const currentSnapshot = JSON.stringify({
    review: draftReview,
    prompt: promptDraft,
    request: requestDraft,
    useRequestOverride,
  });
  const dirty = initialSnapshot !== currentSnapshot;

  const guardLeave = (action: () => void) => {
    if (dirty && !window.confirm('当前 case 有尚未保存的修改，确定放弃吗？')) return;
    action();
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') guardLeave(onClose);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const setFindingDecision = (findingId: string, decision: 'accept' | 'reject') => {
    setDraftReview(current => {
      const accepted = new Set(current.acceptedFindingIds || []);
      const rejected = new Set(current.rejectedFindingIds || []);
      if (decision === 'accept') {
        accepted.add(findingId);
        rejected.delete(findingId);
      } else {
        rejected.add(findingId);
        accepted.delete(findingId);
      }
      return {
        ...current,
        acceptedFindingIds: Array.from(accepted),
        rejectedFindingIds: Array.from(rejected),
      };
    });
  };

  const updateForce = (patch: Partial<NonNullable<GenerationCaseReview['force']>>) => {
    setDraftReview(current => ({
      ...current,
      force: {
        reason: current.force?.reason || '',
        duplicateBillingRiskConfirmed: current.force?.duplicateBillingRiskConfirmed === true,
        ruleCodes: current.force?.ruleCodes || defaultForceRuleCodes,
        ...patch,
      },
    }));
  };

  const save = () => {
    let finalAionRequest: Record<string, unknown> | undefined;
    if (useRequestOverride) {
      try {
        const parsed = JSON.parse(requestDraft);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('最终 Aion JSON 必须是对象。');
        }
        finalAionRequest = parsed;
      } catch (reason) {
        setLocalError(reason instanceof Error ? reason.message : String(reason));
        setTab('edit');
        return;
      }
    }
    const originalPrompt = serializePrompt(item.resolvedCase.prompt);
    const nextReview: GenerationCaseReview = {
      ...draftReview,
      promptOverride: promptDraft === originalPrompt ? undefined : promptDraft,
      finalAionRequest,
    };
    onSave(datasetItemId, nextReview);
    onClose();
  };

  const accepted = new Set(draftReview.acceptedFindingIds || []);
  const rejected = new Set(draftReview.rejectedFindingIds || []);
  const reviewedCodes = draftReview.force?.ruleCodes || defaultForceRuleCodes;
  const needsFinalJson = generationForceRequiresFinalJson(reviewedCodes);

  return createPortal(
    <div className="fixed inset-0 z-[180] flex bg-black/85 md:items-center md:justify-center md:p-5">
      <section role="dialog" aria-modal="true" aria-labelledby="generation-case-review-title" className="flex h-full w-full flex-col overflow-hidden border-white/15 bg-slate-950 shadow-2xl md:h-[92vh] md:max-w-7xl md:border">
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-4 py-3 md:px-5">
          <div className="min-w-0">
            <div className="text-xs text-slate-500">Case {position + 1} / {total}</div>
            <h3 id="generation-case-review-title" className="mt-1 truncate text-lg font-semibold text-slate-100" title={caseId}>{caseId}</h3>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <span className={item.valid ? 'text-emerald-300' : 'text-red-300'}>{item.valid ? '有效' : '无效'}</span>
              <span className="text-sky-300">ManuEval：{item.generationType}</span>
              {audit?.effectiveGenerationType && <span className="text-slate-400">Aion 已知有效模式：{audit.effectiveGenerationType}</span>}
            </div>
          </div>
          <button type="button" onClick={() => guardLeave(onClose)} aria-label="关闭 case 详情" className="inline-flex h-9 w-9 shrink-0 items-center justify-center border border-white/10 text-slate-400 hover:text-white"><X size={17} /></button>
        </header>

        <nav className="flex overflow-x-auto border-b border-white/10 px-3 md:px-5" aria-label="Case 审阅内容">
          {([
            ['issues', `问题与修复 (${item.errors.length + item.warnings.length})`],
            ['edit', 'Prompt 与人工覆盖'],
            ['audit', '请求审计'],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setTab(value)} className={`shrink-0 border-b-2 px-3 py-3 text-sm md:px-4 ${tab === value ? 'border-amber-400 text-amber-200' : 'border-transparent text-slate-400 hover:text-slate-100'}`}>{label}</button>
          ))}
        </nav>

        <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
          {tab === 'issues' && (
            <div className="space-y-4">
              {[...item.errors.map(issue => ({ issue, severity: 'error' as const })), ...item.warnings.map(issue => ({ issue, severity: 'warning' as const }))].map(({ issue, severity }, index) => {
                const presentation = getGenerationIssuePresentation(issue, severity);
                return (
                  <section key={`${severity}-${issue.code}-${issue.field || ''}-${index}`} className={`border-l-2 px-4 py-3 ${severity === 'error' ? 'border-red-400 bg-red-500/[0.06]' : 'border-amber-400 bg-amber-500/[0.06]'}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h4 className={severity === 'error' ? 'font-medium text-red-200' : 'font-medium text-amber-200'}>{presentation.title}</h4>
                      <div className="flex gap-2 text-[11px]">
                        {presentation.forceable && <span className="border border-red-400/20 px-2 py-0.5 text-red-200">可人工确认</span>}
                        {presentation.requiresFinalJson && <span className="border border-amber-400/20 px-2 py-0.5 text-amber-200">需最终 JSON</span>}
                      </div>
                    </div>
                    {issue.field && <div className="mt-1 text-xs text-slate-500">影响字段：{issue.field}</div>}
                    <p className="mt-2 text-sm leading-6 text-slate-300">{presentation.description}</p>
                    <p className="mt-2 text-sm leading-6 text-sky-200">建议：{presentation.suggestion}</p>
                    <details className="mt-3 text-xs text-slate-500">
                      <summary className="cursor-pointer">技术信息</summary>
                      <div className="mt-2 break-words font-mono">[{issue.code}] {issue.message}</div>
                    </details>
                  </section>
                );
              })}
              {!item.errors.length && !item.warnings.length && <div className="py-12 text-center text-sm text-emerald-300">当前 case 没有预检问题。</div>}

              {!!findings.length && (
                <section className="border border-white/10">
                  <h4 className="border-b border-white/10 px-4 py-3 text-sm font-medium text-slate-100">Plugin 建议</h4>
                  <div className="divide-y divide-white/10">
                    {findings.map(finding => (
                      <div key={finding.id} className="p-4">
                        <div className="text-sm text-amber-200">{finding.message}</div>
                        <div className="mt-1 text-[11px] text-slate-500">{finding.ruleId} · {finding.source} · {finding.sourceVersion}</div>
                        {finding.disposition !== 'force_required' && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button type="button" onClick={() => setFindingDecision(finding.id, 'accept')} className={`border px-3 py-1.5 text-xs ${accepted.has(finding.id) ? 'border-emerald-400 bg-emerald-500/20 text-emerald-100' : 'border-white/10 text-slate-300'}`}>接受建议</button>
                            <button type="button" onClick={() => setFindingDecision(finding.id, 'reject')} className={`border px-3 py-1.5 text-xs ${rejected.has(finding.id) ? 'border-slate-400 bg-white/10 text-slate-100' : 'border-white/10 text-slate-300'}`}>拒绝建议</button>
                            <button type="button" onClick={() => guardLeave(() => { onAcceptFindingRule(finding.ruleId); onClose(); })} className="border border-sky-400/20 px-3 py-1.5 text-xs text-sky-200">同类全部接受</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}

          {tab === 'edit' && (
            <div className="grid gap-5 xl:grid-cols-2">
              <section className="space-y-4">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-200">本批次 Prompt</span>
                  <textarea value={promptDraft} onChange={event => setPromptDraft(event.target.value)} rows={12} className="w-full border border-white/10 bg-black/30 p-3 font-mono text-xs leading-5 text-slate-100" />
                </label>
                <button type="button" onClick={() => setPromptDraft(serializePrompt(item.resolvedCase.prompt))} className="border border-white/10 px-3 py-2 text-xs text-slate-300">恢复原始 Prompt</button>
              </section>
              <section className="space-y-4">
                <label className="flex items-start gap-3 border border-red-400/20 bg-red-500/[0.06] p-3 text-sm text-red-100">
                  <input type="checkbox" checked={useRequestOverride} onChange={event => setUseRequestOverride(event.target.checked)} className="mt-0.5" />
                  <span>采用下方 JSON 作为最终 Aion 人工覆盖。启用后不再保证 MCP 或模型合同对齐。</span>
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-200">最终 Aion JSON</span>
                  <textarea value={requestDraft} onChange={event => setRequestDraft(event.target.value)} rows={15} className="w-full border border-white/10 bg-black/30 p-3 font-mono text-xs leading-5 text-slate-100" />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-200">强制提交原因</span>
                  <input value={draftReview.force?.reason || ''} onChange={event => updateForce({ reason: event.target.value })} className="w-full border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" />
                </label>
                <label className="flex items-start gap-3 text-sm text-red-100">
                  <input type="checkbox" checked={draftReview.force?.duplicateBillingRiskConfirmed === true} onChange={event => updateForce({ duplicateBillingRiskConfirmed: event.target.checked })} className="mt-0.5" />
                  <span>{useRequestOverride ? '我确认人工请求可能不再符合 MCP，并理解可能产生重复计费。' : needsFinalJson ? '我确认该问题仍需最终 Aion JSON，仅确认风险不会使 case 有效。' : '我确认保留当前请求和素材风险，并理解可能产生重复计费。'}</span>
                </label>
                {draftReview.force && <button type="button" onClick={() => setDraftReview(current => ({ ...current, force: undefined }))} className="border border-white/10 px-3 py-2 text-xs text-slate-300">清除强制提交设置</button>}
                {localError && <div className="border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{localError}</div>}
              </section>
            </div>
          )}

          {tab === 'audit' && (
            <div className="grid gap-4 xl:grid-cols-2">
              <JsonPanel label="原始输入与用户意图" value={{ originalInput: audit?.originalInput, inputIntent: audit?.intent, normalizedInput: audit?.compiledInput }} />
              <JsonPanel label="MCP 标准输入" value={audit?.mcpToolInput} />
              <JsonPanel label="素材角色与确定性校验" value={audit?.mediaReferences} />
              <JsonPanel label="生成方式" value={{ manuevalGenerationType: item.generationType, aionKnownEffectiveType: audit?.effectiveGenerationType }} />
              <JsonPanel label="最终 Aion 请求" value={{ request: audit?.finalAionRequest, projectionDiff: audit?.projectionDiff, overrideAudit: audit?.overrideAudit }} />
              <JsonPanel label="参数来源" value={{
                seed: {
                  policyVersion: item.resolvedCase.seedPolicyVersion,
                  mode: item.resolvedCase.seedMode,
                  status: item.resolvedCase.seedMode === 'unused' ? '未发送，使用模型默认' : item.resolvedCase.seedMode,
                  value: item.resolvedCase.seed,
                },
                parameters: item.resolvedCase.parameterAudit,
                contractSource: audit?.contractSource,
                contractFindings: audit?.contractFindings,
                review: audit?.review,
              }} />
            </div>
          )}
        </main>

        <footer className="flex flex-col gap-3 border-t border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-5">
          <div className="flex gap-2">
            <button type="button" onClick={() => onPrevious && guardLeave(onPrevious)} disabled={!onPrevious} className="inline-flex h-9 items-center gap-2 border border-white/10 px-3 text-sm text-slate-300 disabled:opacity-30"><ChevronLeft size={15} /> 上一条</button>
            <button type="button" onClick={() => onNext && guardLeave(onNext)} disabled={!onNext} className="inline-flex h-9 items-center gap-2 border border-white/10 px-3 text-sm text-slate-300 disabled:opacity-30">下一条 <ChevronRight size={15} /></button>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => guardLeave(onClose)} className="h-9 border border-white/10 px-4 text-sm text-slate-300">取消</button>
            <button type="button" onClick={save} disabled={!datasetItemId || !dirty} className="inline-flex h-9 items-center gap-2 bg-amber-400 px-4 text-sm font-medium text-black disabled:opacity-40"><Save size={15} /> 保存修改</button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
};

export default GenerationCaseReviewDialog;
