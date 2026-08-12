import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Eye,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';

import type {
  GenerationCaseInputOverrideV1,
  GenerationCaseReview,
  GenerationContractFinding,
  GenerationModelConfig,
  GenerationPreflightCase,
} from '../types';
import {
  GENERATION_FORCEABLE_PREFLIGHT_CODES,
  generationForceRequiresFinalJson,
} from '../features/generation/preflightReview';
import {
  buildGenerationRepairGroups,
  getGenerationFieldLabel,
  getGenerationCaseId,
  type GenerationRepairGroup,
} from '../features/generation/preflightPresentation';
import { generationParameterEditorValue } from '../features/generation/bulkRepair';

type ReviewDialogTab = 'repair' | 'preview';
type ReviewMode = 'guided' | 'expert';
type ContentField = keyof NonNullable<GenerationCaseInputOverrideV1['content']>;

interface GenerationCaseReviewDialogProps {
  item: GenerationPreflightCase;
  model: GenerationModelConfig;
  position: number;
  total: number;
  outsideCurrentFilter?: boolean;
  review?: GenerationCaseReview;
  promptColumnOptions: Array<{ column: string; value: unknown }>;
  parameterColumnOptions: Array<{ column: string; value: unknown }>;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onSaveDraft: (datasetItemId: string, review: GenerationCaseReview) => void;
  onSaveAndRepreflight: (
    datasetItemId: string,
    review: GenerationCaseReview,
  ) => Promise<GenerationPreflightCase | void>;
  onAcceptFindingRule: (ruleId: string) => void;
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const cloneReview = (review?: GenerationCaseReview): GenerationCaseReview => review
  ? clone(review)
  : {};

const serializePrompt = (value: unknown) => typeof value === 'string'
  ? value
  : JSON.stringify(value ?? '', null, 2);

const asRecord = (value: unknown): Record<string, unknown> => value
  && typeof value === 'object'
  && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};

const asArray = <T,>(value: unknown): T[] => Array.isArray(value) ? clone(value) as T[] : [];

const compactReview = (review: GenerationCaseReview): GenerationCaseReview => {
  const next = clone(review);
  const content = next.inputOverride?.content || {};
  const parameters = next.inputOverride?.parameters || {};
  if (next.inputOverride && !Object.keys(content).length && !Object.keys(parameters).length) {
    delete next.inputOverride;
  }
  if (!next.acceptedFindingIds?.length) delete next.acceptedFindingIds;
  if (!next.rejectedFindingIds?.length) delete next.rejectedFindingIds;
  if (next.promptOverride === undefined) delete next.promptOverride;
  if (!next.promptColumnOverride?.column) delete next.promptColumnOverride;
  if (next.parameterColumnOverrides && !Object.keys(next.parameterColumnOverrides).length) {
    delete next.parameterColumnOverrides;
  }
  if (!next.force) delete next.force;
  if (!next.finalAionRequest) delete next.finalAionRequest;
  return next;
};

const promptFindingIds = (findings: GenerationContractFinding[]) => findings
  .filter(finding => finding.proposal?.kind === 'prompt_rewrite')
  .map(finding => finding.id);

const moveItem = <T,>(items: T[], from: number, to: number) => {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

const JsonPanel: React.FC<{ label: string; value: unknown }> = ({ label, value }) => (
  <section className="border border-white/10 bg-black/20">
    <h4 className="border-b border-white/10 px-3 py-2 text-xs font-medium text-sky-200">{label}</h4>
    <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-all p-3 text-[11px] leading-5 text-slate-300">
      {JSON.stringify(value ?? {}, null, 2)}
    </pre>
  </section>
);

const FieldActions: React.FC<{
  index: number;
  total: number;
  onMove: (to: number) => void;
  onRemove: () => void;
}> = ({ index, total, onMove, onRemove }) => (
  <div className="flex shrink-0 items-center gap-1">
    <button type="button" title="上移" aria-label="上移" disabled={index === 0} onClick={() => onMove(index - 1)} className="inline-flex h-8 w-8 items-center justify-center border border-white/10 text-slate-300 disabled:opacity-30"><ArrowUp size={14} /></button>
    <button type="button" title="下移" aria-label="下移" disabled={index === total - 1} onClick={() => onMove(index + 1)} className="inline-flex h-8 w-8 items-center justify-center border border-white/10 text-slate-300 disabled:opacity-30"><ArrowDown size={14} /></button>
    <button type="button" title="移除" aria-label="移除" onClick={onRemove} className="inline-flex h-8 w-8 items-center justify-center border border-red-400/20 text-red-300"><Trash2 size={14} /></button>
  </div>
);

const UrlArrayEditor: React.FC<{
  field: 'image_urls' | 'images';
  values: string[];
  outputModality: 'image' | 'video';
  onChange: (values: string[]) => void;
  onReset: () => void;
}> = ({ field, values, outputModality, onChange, onReset }) => (
  <div className="space-y-3 border-t border-white/10 pt-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <div className="text-sm font-medium text-slate-100">{outputModality === 'video' ? '关键帧输入' : '图片输入'}</div>
        <div className="mt-1 text-xs text-slate-500">字段：{field}{outputModality === 'video' ? '；第一项为首帧，第二项为尾帧，不用于普通参考图。' : ''}</div>
      </div>
      <button type="button" onClick={onReset} className="border border-white/10 px-3 py-1.5 text-xs text-slate-300">恢复评测集值</button>
    </div>
    {values.map((url, index) => (
      <div key={`${field}-${index}`} className="flex items-start gap-2">
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-xs text-slate-400">{outputModality === 'video' ? index === 0 ? '首帧' : '尾帧' : `图片 ${index + 1}`}</span>
          <input value={url} onChange={event => onChange(values.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} className="w-full border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-100" />
        </label>
        <div className="pt-5"><FieldActions index={index} total={values.length} onMove={to => onChange(moveItem(values, index, to))} onRemove={() => onChange(values.filter((_value, itemIndex) => itemIndex !== index))} /></div>
      </div>
    ))}
    {!values.length && <div className="border border-dashed border-white/10 px-3 py-4 text-xs text-slate-500">当前 case 不发送该通道。</div>}
    <button type="button" disabled={outputModality === 'video' && values.length >= 2} onClick={() => onChange([...values, ''])} className="inline-flex items-center gap-2 border border-sky-400/20 px-3 py-2 text-xs text-sky-200 disabled:opacity-40"><Plus size={14} /> 添加{outputModality === 'video' ? '关键帧' : '图片'}</button>
  </div>
);

const ElementEditor: React.FC<{
  values: Array<Record<string, unknown>>;
  onChange: (values: Array<Record<string, unknown>>) => void;
  onReset: () => void;
}> = ({ values, onChange, onReset }) => {
  const update = (index: number, value: Record<string, unknown>) => onChange(values.map((item, itemIndex) => itemIndex === index ? value : item));
  return (
    <div className="space-y-3 border-t border-white/10 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-slate-100">参考元素</div>
          <div className="mt-1 text-xs text-slate-500">字段：elements；普通参考图、参考视频和已有 Element ID 均在这里维护。</div>
        </div>
        <button type="button" onClick={onReset} className="border border-white/10 px-3 py-1.5 text-xs text-slate-300">恢复评测集值</button>
      </div>
      {values.map((element, index) => {
        const mode = element.element_id !== undefined ? 'id' : element.video_url !== undefined ? 'video' : 'image';
        const references = asArray<string>(element.reference_image_urls);
        return (
          <section key={`element-${index}`} className="border border-white/10 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <label className="min-w-[180px] flex-1 text-xs text-slate-400">
                <span className="mb-1 block">Element {index + 1} 类型</span>
                <select value={mode} onChange={event => {
                  const nextMode = event.target.value;
                  update(index, nextMode === 'video' ? { video_url: '' } : nextMode === 'id' ? { element_id: 0 } : { frontal_image_url: '' });
                }} className="w-full border border-white/10 bg-slate-950 px-3 py-2 text-slate-100">
                  <option value="image">参考图片</option>
                  <option value="video">参考视频</option>
                  <option value="id">已有 Element ID</option>
                </select>
              </label>
              <FieldActions index={index} total={values.length} onMove={to => onChange(moveItem(values, index, to))} onRemove={() => onChange(values.filter((_value, itemIndex) => itemIndex !== index))} />
            </div>
            {mode === 'image' && (
              <div className="mt-3 space-y-3">
                <label className="block text-xs text-slate-400">
                  <span className="mb-1 block">主参考图 frontal_image_url</span>
                  <input value={String(element.frontal_image_url || '')} onChange={event => update(index, { ...element, frontal_image_url: event.target.value })} className="w-full border border-white/10 bg-slate-950 px-3 py-2 text-slate-100" />
                </label>
                {references.map((url, referenceIndex) => (
                  <div key={`element-${index}-reference-${referenceIndex}`} className="flex items-center gap-2">
                    <input value={url} aria-label={`Element ${index + 1} 补充参考图 ${referenceIndex + 1}`} onChange={event => update(index, { ...element, reference_image_urls: references.map((value, itemIndex) => itemIndex === referenceIndex ? event.target.value : value) })} className="min-w-0 flex-1 border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-100" />
                    <button type="button" title="移除补充参考图" aria-label="移除补充参考图" onClick={() => update(index, { ...element, reference_image_urls: references.filter((_value, itemIndex) => itemIndex !== referenceIndex) })} className="inline-flex h-8 w-8 items-center justify-center border border-red-400/20 text-red-300"><Trash2 size={14} /></button>
                  </div>
                ))}
                <button type="button" onClick={() => update(index, { ...element, reference_image_urls: [...references, ''] })} className="inline-flex items-center gap-2 border border-white/10 px-3 py-1.5 text-xs text-slate-300"><Plus size={13} /> 添加同一元素的补充参考图</button>
              </div>
            )}
            {mode === 'video' && (
              <label className="mt-3 block text-xs text-slate-400">
                <span className="mb-1 block">参考视频 video_url</span>
                <input value={String(element.video_url || '')} onChange={event => update(index, { video_url: event.target.value })} className="w-full border border-white/10 bg-slate-950 px-3 py-2 text-slate-100" />
              </label>
            )}
            {mode === 'id' && (
              <label className="mt-3 block text-xs text-slate-400">
                <span className="mb-1 block">Element ID</span>
                <input type="number" min="0" step="1" value={Number(element.element_id ?? 0)} onChange={event => update(index, { element_id: Number(event.target.value) })} className="w-full border border-white/10 bg-slate-950 px-3 py-2 text-slate-100" />
              </label>
            )}
          </section>
        );
      })}
      {!values.length && <div className="border border-dashed border-white/10 px-3 py-4 text-xs text-slate-500">当前 case 没有参考元素。</div>}
      <button type="button" onClick={() => onChange([...values, { frontal_image_url: '' }])} className="inline-flex items-center gap-2 border border-sky-400/20 px-3 py-2 text-xs text-sky-200"><Plus size={14} /> 添加参考元素</button>
    </div>
  );
};

const AudioEditor: React.FC<{
  values: Array<{ url?: string; range?: number[] }>;
  onChange: (values: Array<{ url?: string; range?: number[] }>) => void;
  onReset: () => void;
}> = ({ values, onChange, onReset }) => {
  const update = (index: number, value: { url?: string; range?: number[] }) => onChange(values.map((item, itemIndex) => itemIndex === index ? value : item));
  return (
    <div className="space-y-3 border-t border-white/10 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-slate-100">参考音频</div>
          <div className="mt-1 text-xs text-slate-500">字段：audios；每项包含 URL 和可选截取区间。</div>
        </div>
        <button type="button" onClick={onReset} className="border border-white/10 px-3 py-1.5 text-xs text-slate-300">恢复评测集值</button>
      </div>
      {values.map((audio, index) => (
        <section key={`audio-${index}`} className="border border-white/10 p-3">
          <div className="flex items-start gap-2">
            <label className="min-w-0 flex-1 text-xs text-slate-400">
              <span className="mb-1 block">Audio {index + 1} URL</span>
              <input value={audio.url || ''} onChange={event => update(index, { ...audio, url: event.target.value })} className="w-full border border-white/10 bg-slate-950 px-3 py-2 text-slate-100" />
            </label>
            <div className="pt-5"><FieldActions index={index} total={values.length} onMove={to => onChange(moveItem(values, index, to))} onRemove={() => onChange(values.filter((_value, itemIndex) => itemIndex !== index))} /></div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-xs text-slate-400"><span className="mb-1 block">开始秒数（可选）</span><input type="number" min="0" step="any" value={audio.range?.[0] ?? ''} onChange={event => update(index, { ...audio, range: event.target.value === '' ? undefined : [Number(event.target.value), audio.range?.[1] ?? Number(event.target.value)] })} className="w-full border border-white/10 bg-slate-950 px-3 py-2 text-slate-100" /></label>
            <label className="text-xs text-slate-400"><span className="mb-1 block">结束秒数（可选）</span><input type="number" min="0" step="any" value={audio.range?.[1] ?? ''} onChange={event => update(index, { ...audio, range: event.target.value === '' ? undefined : [audio.range?.[0] ?? 0, Number(event.target.value)] })} className="w-full border border-white/10 bg-slate-950 px-3 py-2 text-slate-100" /></label>
          </div>
        </section>
      ))}
      {!values.length && <div className="border border-dashed border-white/10 px-3 py-4 text-xs text-slate-500">当前 case 没有参考音频。</div>}
      <button type="button" onClick={() => onChange([...values, { url: '' }])} className="inline-flex items-center gap-2 border border-sky-400/20 px-3 py-2 text-xs text-sky-200"><Plus size={14} /> 添加参考音频</button>
    </div>
  );
};

const MaterialPreview: React.FC<{ input: Record<string, unknown>; outputModality: 'image' | 'video' }> = ({ input, outputModality }) => {
  const images = asArray<string>(outputModality === 'video' ? input.image_urls : input.images);
  const elements = asArray<Record<string, unknown>>(input.elements);
  const audios = asArray<Record<string, unknown>>(input.audios);
  return (
    <div className="divide-y divide-white/10 border border-white/10">
      <div className="grid gap-2 px-3 py-3 text-xs sm:grid-cols-[140px_1fr]"><span className="text-slate-500">{outputModality === 'video' ? '关键帧' : '图片输入'}</span><div className="space-y-1 text-slate-200">{images.length ? images.map((url, index) => <div key={`${url}-${index}`} className="break-all">{outputModality === 'video' ? index === 0 ? '首帧' : '尾帧' : `图片 ${index + 1}`}：{url}</div>) : '无'}</div></div>
      {outputModality === 'video' && <div className="grid gap-2 px-3 py-3 text-xs sm:grid-cols-[140px_1fr]"><span className="text-slate-500">参考元素</span><div className="space-y-1 text-slate-200">{elements.length ? elements.map((element, index) => <div key={`preview-element-${index}`} className="break-all">@Element{index + 1}：{String(element.frontal_image_url || element.video_url || `element_id=${element.element_id}`)}</div>) : '无'}</div></div>}
      {outputModality === 'video' && <div className="grid gap-2 px-3 py-3 text-xs sm:grid-cols-[140px_1fr]"><span className="text-slate-500">参考音频</span><div className="space-y-1 text-slate-200">{audios.length ? audios.map((audio, index) => <div key={`preview-audio-${index}`} className="break-all">Audio {index + 1}：{String(audio.url || '')}{Array.isArray(audio.range) ? ` [${audio.range.join(', ')}]` : ''}</div>) : '无'}</div></div>}
    </div>
  );
};

const GenerationCaseReviewDialog: React.FC<GenerationCaseReviewDialogProps> = ({
  item,
  model,
  position,
  total,
  outsideCurrentFilter = false,
  review,
  promptColumnOptions,
  parameterColumnOptions,
  onClose,
  onPrevious,
  onNext,
  onSaveDraft,
  onSaveAndRepreflight,
  onAcceptFindingRule,
}) => {
  const datasetItemId = String(item.resolvedCase.datasetItemId || '');
  const caseId = getGenerationCaseId(item);
  const audit = item.resolvedCase.compilerAudit || {};
  const findings = (audit.contractFindings || []) as GenerationContractFinding[];
  const repairGroups = useMemo(() => buildGenerationRepairGroups(item), [item]);
  const defaultForceRuleCodes = useMemo(() => Array.from(new Set(item.errors
    .map(issue => issue.code)
    .filter(code => GENERATION_FORCEABLE_PREFLIGHT_CODES.has(code)))), [item.errors]);
  const [tab, setTab] = useState<ReviewDialogTab>('repair');
  const [mode, setMode] = useState<ReviewMode>(review?.finalAionRequest ? 'expert' : 'guided');
  const [draftReview, setDraftReview] = useState<GenerationCaseReview>(() => cloneReview(review));
  const [requestDraft, setRequestDraft] = useState(() => JSON.stringify(review?.finalAionRequest || audit.finalAionRequest || {}, null, 2));
  const [localError, setLocalError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTab('repair');
    setMode(review?.finalAionRequest ? 'expert' : 'guided');
    setDraftReview(cloneReview(review));
    setRequestDraft(JSON.stringify(review?.finalAionRequest || audit.finalAionRequest || {}, null, 2));
    setLocalError('');
  }, [datasetItemId]);

  const initialSnapshot = useMemo(() => JSON.stringify({
    review: compactReview(cloneReview(review)),
    mode: review?.finalAionRequest ? 'expert' : 'guided',
    request: JSON.stringify(review?.finalAionRequest || audit.finalAionRequest || {}, null, 2),
  }), [audit.finalAionRequest, review]);
  const currentSnapshot = JSON.stringify({
    review: compactReview(draftReview),
    mode,
    request: requestDraft,
  });
  const dirty = initialSnapshot !== currentSnapshot;
  const previewStale = dirty || JSON.stringify(compactReview(cloneReview(review))) !== JSON.stringify(compactReview(cloneReview(audit.review)));
  const sourceInput = asRecord(audit.caseInputOverride?.sourceInput || audit.compiledInput);
  const promptColumnValues = useMemo(
    () => new Map(promptColumnOptions.map(option => [option.column, option.value])),
    [promptColumnOptions],
  );
  const parameterColumnValues = useMemo(
    () => new Map(parameterColumnOptions.map(option => [option.column, option.value])),
    [parameterColumnOptions],
  );

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

  const clearForce = (current: GenerationCaseReview) => current.force
    ? { ...current, force: undefined }
    : current;

  const setContentOperation = (field: ContentField, value: unknown, omit = false) => {
    setDraftReview(current => {
      const next = clearForce(cloneReview(current));
      const content = { ...(next.inputOverride?.content || {}) };
      content[field] = omit ? { action: 'omit' } : { action: 'set', value };
      next.inputOverride = { version: 1, content, parameters: next.inputOverride?.parameters };
      if (field === 'prompt') {
        delete next.promptColumnOverride;
        delete next.promptOverride;
        const ids = new Set(promptFindingIds(findings));
        next.acceptedFindingIds = (next.acceptedFindingIds || []).filter(id => !ids.has(id));
        next.rejectedFindingIds = Array.from(new Set([...(next.rejectedFindingIds || []), ...ids]));
      }
      return compactReview(next);
    });
  };

  const clearContentOperation = (field: ContentField) => {
    setDraftReview(current => {
      const next = clearForce(cloneReview(current));
      const content = { ...(next.inputOverride?.content || {}) };
      delete content[field];
      next.inputOverride = { version: 1, content, parameters: next.inputOverride?.parameters };
      if (field === 'prompt') {
        delete next.promptColumnOverride;
        const ids = new Set(promptFindingIds(findings));
        next.rejectedFindingIds = (next.rejectedFindingIds || []).filter(id => !ids.has(id));
      }
      return compactReview(next);
    });
  };

  const setParameterOperation = (field: string, value: unknown, omit = false) => {
    setDraftReview(current => {
      const next = clearForce(cloneReview(current));
      const parameters = { ...(next.inputOverride?.parameters || {}) };
      parameters[field] = omit ? { action: 'omit' } : { action: 'set', value };
      next.inputOverride = { version: 1, content: next.inputOverride?.content, parameters };
      if (next.parameterColumnOverrides) delete next.parameterColumnOverrides[field];
      return compactReview(next);
    });
  };

  const setParameterColumnOperation = (field: string, column: string) => {
    setDraftReview(current => {
      const next = clearForce(cloneReview(current));
      const parameters = { ...(next.inputOverride?.parameters || {}) };
      delete parameters[field];
      next.inputOverride = { version: 1, content: next.inputOverride?.content, parameters };
      next.parameterColumnOverrides = { ...(next.parameterColumnOverrides || {}) };
      if (column) next.parameterColumnOverrides[field] = { version: 1, column };
      else delete next.parameterColumnOverrides[field];
      return compactReview(next);
    });
  };

  const clearParameterOperation = (field: string) => {
    setDraftReview(current => {
      const next = clearForce(cloneReview(current));
      const parameters = { ...(next.inputOverride?.parameters || {}) };
      delete parameters[field];
      next.inputOverride = { version: 1, content: next.inputOverride?.content, parameters };
      if (next.parameterColumnOverrides) delete next.parameterColumnOverrides[field];
      return compactReview(next);
    });
  };

  const effectiveContent = (field: ContentField) => {
    if (field === 'prompt' && draftReview.promptColumnOverride) {
      return promptColumnValues.get(draftReview.promptColumnOverride.column);
    }
    const operation = draftReview.inputOverride?.content?.[field];
    if (operation?.action === 'omit') return undefined;
    if (operation?.action === 'set') return operation.value;
    return sourceInput[field];
  };

  const setFindingDecision = (finding: GenerationContractFinding, decision: 'accept' | 'reject') => {
    setDraftReview(current => {
      const next = clearForce(cloneReview(current));
      const accepted = new Set(next.acceptedFindingIds || []);
      const rejected = new Set(next.rejectedFindingIds || []);
      if (decision === 'accept') {
        accepted.add(finding.id);
        rejected.delete(finding.id);
        if (finding.proposal?.kind === 'prompt_rewrite') {
          delete next.promptColumnOverride;
          const content = { ...(next.inputOverride?.content || {}) };
          delete content.prompt;
          next.inputOverride = { version: 1, content, parameters: next.inputOverride?.parameters };
          delete next.promptOverride;
        }
      } else {
        rejected.add(finding.id);
        accepted.delete(finding.id);
      }
      next.acceptedFindingIds = Array.from(accepted);
      next.rejectedFindingIds = Array.from(rejected);
      return compactReview(next);
    });
  };

  const setPromptColumnOperation = (column: string) => {
    setDraftReview(current => {
      const next = cloneReview(current);
      const content = { ...(next.inputOverride?.content || {}) };
      delete content.prompt;
      next.inputOverride = { version: 1, content, parameters: next.inputOverride?.parameters };
      delete next.promptOverride;
      const ids = new Set(promptFindingIds(findings));
      next.acceptedFindingIds = (next.acceptedFindingIds || [])
        .filter(id => !ids.has(id) && !id.startsWith('plugin-prompt-'));
      next.rejectedFindingIds = (next.rejectedFindingIds || [])
        .filter(id => !ids.has(id) && !id.startsWith('plugin-prompt-'));
      if (column) next.promptColumnOverride = { version: 1, column };
      else delete next.promptColumnOverride;
      return compactReview(next);
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

  const switchMode = (nextMode: ReviewMode) => {
    if (nextMode === mode) return;
    const message = nextMode === 'expert'
      ? '启用专家模式会清除当前字段级修复和 Plugin 决定，并由最终 Aion JSON 完整接管。是否继续？'
      : '返回普通修复会清除最终 Aion JSON 和强制提交设置。是否继续？';
    if (!window.confirm(message)) return;
    setDraftReview(current => nextMode === 'expert'
      ? compactReview({
          finalAionRequest: current.finalAionRequest,
          force: current.force,
        })
      : {});
    if (nextMode === 'expert') setRequestDraft(JSON.stringify(draftReview.finalAionRequest || audit.finalAionRequest || {}, null, 2));
    setMode(nextMode);
    setLocalError('');
  };

  const buildSavedReview = (): GenerationCaseReview | undefined => {
    const next = compactReview(cloneReview(draftReview));
    if (mode === 'guided') {
      delete next.finalAionRequest;
      return compactReview(next);
    }
    try {
      const parsed = JSON.parse(requestDraft);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('最终 Aion JSON 必须是一个 JSON 对象。');
      delete next.inputOverride;
      delete next.promptOverride;
      delete next.promptColumnOverride;
      delete next.parameterColumnOverrides;
      delete next.acceptedFindingIds;
      delete next.rejectedFindingIds;
      next.finalAionRequest = parsed;
      return compactReview(next);
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : String(reason));
      setTab('repair');
      return undefined;
    }
  };

  const saveDraftAndNext = () => {
    const next = buildSavedReview();
    if (!next) return;
    onSaveDraft(datasetItemId, next);
    if (onNext) onNext();
    else onClose();
  };

  const saveAndRepreflight = async () => {
    const next = buildSavedReview();
    if (!next) return;
    setSaving(true);
    setLocalError('');
    try {
      const refreshedItem = await onSaveAndRepreflight(datasetItemId, next);
      const refreshedRequest = refreshedItem?.resolvedCase.compilerAudit?.finalAionRequest;
      setDraftReview(next);
      if (refreshedRequest) setRequestDraft(JSON.stringify(refreshedRequest, null, 2));
      setTab('preview');
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const accepted = new Set(draftReview.acceptedFindingIds || []);
  const rejected = new Set(draftReview.rejectedFindingIds || []);
  const reviewedCodes = draftReview.force?.ruleCodes || defaultForceRuleCodes;
  const needsFinalJson = generationForceRequiresFinalJson(reviewedCodes);
  const riskOnlyCodes = defaultForceRuleCodes.filter(code => !generationForceRequiresFinalJson([code]));
  const editorKeys = new Set<string>();

  const renderParameterEditor = (field: string) => {
    const control = model.controls.find(candidate => candidate.key === field);
    const auditEntry = item.resolvedCase.parameterAudit?.[field];
    const operation = draftReview.inputOverride?.parameters?.[field];
    const columnOverride = draftReview.parameterColumnOverrides?.[field];
    const issue = [...item.errors, ...item.warnings].find(candidate => (
      (candidate.field || '').match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1] === field
    ));
    const evidence = issue?.evidence;
    const canOmit = [...item.errors, ...item.warnings].some(candidate => (
      (candidate.field || '').match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1] === field
      && (candidate.repairActions || []).some(action => action.kind === 'omit_parameter' && action.field === field)
    ));
    const currentValue = operation?.action === 'set'
      ? operation.value
      : operation?.action === 'omit'
        ? undefined
        : columnOverride
          ? parameterColumnValues.get(columnOverride.column)
          : item.resolvedCase.controls?.[field] ?? auditEntry?.value;
    const rawValue = evidence?.rawValue ?? auditEntry?.rawValue ?? auditEntry?.value;
    const normalizedValue = evidence?.normalizedValue ?? auditEntry?.value;
    const currentSource = columnOverride
      ? `备用列 ${columnOverride.column}`
      : operation?.action === 'set'
        ? '当前 case 固定值'
        : operation?.action === 'omit'
          ? '当前 case 不发送'
          : auditEntry?.source === 'column'
            ? `数据集列 ${auditEntry.column || evidence?.sourceColumn || ''}`
            : auditEntry?.source || evidence?.source || '批次设置';
    if (!control) {
      return (
        <div className="space-y-3 border-t border-white/10 pt-3">
          <div className="text-sm text-slate-200">当前模型没有声明参数 <code className="text-sky-200">{field}</code>。</div>
          <div className="grid gap-2 border-y border-white/10 py-3 text-xs sm:grid-cols-2">
            <div><div className="text-slate-500">数据集原始值</div><code className="mt-1 block break-all text-red-200">{JSON.stringify(rawValue ?? null)}</code></div>
            <div><div className="text-slate-500">当前来源</div><div className="mt-1 text-slate-200">{currentSource}</div></div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canOmit && <button type="button" onClick={() => setParameterOperation(field, undefined, true)} className={`border px-3 py-2 text-xs ${operation?.action === 'omit' ? 'border-emerald-400 bg-emerald-500/10 text-emerald-200' : 'border-white/10 text-slate-300'}`}>当前 case 不发送此参数</button>}
            {(operation || columnOverride) && <button type="button" onClick={() => clearParameterOperation(field)} className="border border-white/10 px-3 py-2 text-xs text-slate-300">恢复批次设置</button>}
          </div>
        </div>
      );
    }
    const applyValue = (value: unknown) => setParameterOperation(field, value);
    const editorValue = generationParameterEditorValue(currentValue, control.options || [], operation);
    return (
      <div className="space-y-3 border-t border-white/10 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium text-slate-100">{control.label || getGenerationFieldLabel(field)}</div>
            <div className="mt-1 text-xs text-slate-500">参数 {field}；当前来源：{currentSource}</div>
          </div>
          <button type="button" onClick={() => clearParameterOperation(field)} className="border border-white/10 px-3 py-1.5 text-xs text-slate-300">恢复批次设置</button>
        </div>
        <div className="grid gap-2 border-y border-white/10 py-3 text-xs sm:grid-cols-3">
          <div><div className="text-slate-500">数据集原始值</div><code className="mt-1 block break-all text-red-200">{JSON.stringify(rawValue ?? null)}</code></div>
          <div><div className="text-slate-500">当前生效值</div><code className="mt-1 block break-all text-slate-200">{JSON.stringify(normalizedValue ?? null)}</code></div>
          <div>
            <div className="text-slate-500">模型允许值</div>
            <div className="mt-1 text-emerald-200">{control.options?.length ? control.options.join('、') : `${control.minimum ?? '-∞'} 至 ${control.maximum ?? '+∞'}`}</div>
            <div className="mt-1 text-[10px] text-slate-600">{control.optionSource === 'aion_parameter_schema' ? 'Aion parameter schema' : control.optionSource === 'aion_options' ? 'Aion options' : '未声明来源'}</div>
          </div>
        </div>
        {control.type === 'toggle' ? (
          <label className="block text-xs text-slate-400">
            <span className="mb-1.5 block">为当前 case 选择替换值</span>
            <select value={operation?.action === 'set' ? String(operation.value) : ''} onChange={event => event.target.value ? applyValue(event.target.value === 'true') : clearParameterOperation(field)} className="w-full border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100">
              <option value="">选择开或关</option>
              <option value="true">开</option>
              <option value="false">关</option>
            </select>
          </label>
        ) : control.type === 'select' ? (
          <label className="block text-xs text-slate-400">
            <span className="mb-1.5 block">为当前 case 选择替换值</span>
            <select value={editorValue} onChange={event => event.target.value ? applyValue(event.target.value) : clearParameterOperation(field)} className="w-full border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100">
              <option value="">选择模型支持值</option>
              {(control.options || []).map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        ) : control.type === 'number' ? (
          <input type="number" min={control.minimum} max={control.maximum} step="any" value={operation?.action === 'set' ? Number(operation.value) : ''} placeholder="输入待应用值" onChange={event => event.target.value === '' ? clearParameterOperation(field) : applyValue(Number(event.target.value))} className="w-full border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
        ) : control.type === 'json' ? (
          <textarea rows={5} value={operation?.action === 'set' ? (typeof operation.value === 'string' ? operation.value : JSON.stringify(operation.value ?? {}, null, 2)) : ''} placeholder="输入待应用 JSON" onChange={event => {
            try { applyValue(JSON.parse(event.target.value)); } catch { applyValue(event.target.value); }
          }} className="w-full border border-white/10 bg-slate-950 p-3 font-mono text-xs text-slate-100" />
        ) : (
          <input value={operation?.action === 'set' ? String(operation.value ?? '') : ''} placeholder="输入待应用值" onChange={event => event.target.value === '' ? clearParameterOperation(field) : applyValue(event.target.value)} className="w-full border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
        )}
        <label className="block text-xs text-slate-400">
          <span className="mb-1.5 block">或从数据集另一列读取</span>
          <select value={columnOverride?.column || ''} onChange={event => setParameterColumnOperation(field, event.target.value)} className="w-full border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100">
            <option value="">不使用备用列</option>
            {parameterColumnOptions.map(option => <option key={option.column} value={option.column}>{option.column}：{String(option.value ?? '空值')}</option>)}
          </select>
        </label>
        {canOmit && <button type="button" onClick={() => setParameterOperation(field, undefined, true)} className={`border px-3 py-2 text-xs ${operation?.action === 'omit' ? 'border-emerald-400 bg-emerald-500/10 text-emerald-200' : 'border-white/10 text-slate-300'}`}>当前 case 不发送此参数</button>}
      </div>
    );
  };

  const renderGroupEditor = (group: GenerationRepairGroup) => {
    if (group.kind === 'prompt' || group.kind === 'prompt_channel_mismatch') {
      const key = 'prompt';
      if (editorKeys.has(key)) return null;
      editorKeys.add(key);
      const promptValue = effectiveContent('prompt');
      return (
        <div className="space-y-3 border-t border-white/10 pt-3">
          {group.proposal?.kind === 'prompt_rewrite' && (
            <div className="grid gap-3 lg:grid-cols-2">
              <div><div className="mb-1 text-xs text-slate-500">当前 Prompt</div><pre className="max-h-44 overflow-auto whitespace-pre-wrap border border-red-400/20 bg-red-500/[0.04] p-3 text-xs leading-5 text-slate-200">{serializePrompt(promptValue)}</pre></div>
              <div><div className="mb-1 text-xs text-slate-500">建议修改</div><pre className="max-h-44 overflow-auto whitespace-pre-wrap border border-emerald-400/20 bg-emerald-500/[0.04] p-3 text-xs leading-5 text-slate-200">{serializePrompt(group.proposal.prompt)}</pre></div>
            </div>
          )}
          {group.finding && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setFindingDecision(group.finding as GenerationContractFinding, 'accept')} className={`inline-flex items-center gap-2 border px-3 py-2 text-xs ${accepted.has(group.finding.id) ? 'border-emerald-400 bg-emerald-500/10 text-emerald-200' : 'border-emerald-400/30 text-emerald-200'}`}><Check size={14} /> 采用建议</button>
              <button type="button" onClick={() => setFindingDecision(group.finding as GenerationContractFinding, 'reject')} className={`border px-3 py-2 text-xs ${rejected.has(group.finding.id) ? 'border-slate-400 bg-white/10 text-slate-100' : 'border-white/10 text-slate-300'}`}>拒绝建议并自行修改</button>
              <button type="button" onClick={() => {
                setFindingDecision(group.finding as GenerationContractFinding, 'accept');
                onAcceptFindingRule(group.finding?.ruleId || '');
              }} className="border border-sky-400/20 px-3 py-2 text-xs text-sky-200">同类全部采用</button>
            </div>
          )}
          <label className="block">
            <span className="mb-1.5 block text-xs text-slate-400">从评测集备用 Prompt 列读取</span>
            <select
              value={draftReview.promptColumnOverride?.column || ''}
              onChange={event => setPromptColumnOperation(event.target.value)}
              className="mb-3 w-full border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            >
              <option value="">使用主 Prompt 或手工编辑</option>
              {promptColumnOptions.map(option => (
                <option key={option.column} value={option.column}>{option.column}</option>
              ))}
            </select>
            <span className="mb-1.5 block text-xs text-slate-400">本批次当前 case 的 Prompt</span>
            <textarea value={serializePrompt(promptValue)} onChange={event => setContentOperation('prompt', event.target.value)} rows={9} className="w-full border border-white/10 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100" />
          </label>
          <button type="button" onClick={() => { clearContentOperation('prompt'); setPromptColumnOperation(''); }} className="border border-white/10 px-3 py-2 text-xs text-slate-300">恢复主 Prompt 列</button>
        </div>
      );
    }

    const field = group.field || '';
    const root = field.match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1] || '';
    if (group.kind === 'parameter') {
      const key = `parameter:${root}`;
      if (!root || editorKeys.has(key)) return null;
      editorKeys.add(key);
      return renderParameterEditor(root);
    }

    const mediaFields: ContentField[] = group.kind === 'generation_mode'
      ? model.outputModality === 'video' ? ['image_urls', 'elements', 'audios'] : ['images']
      : root === 'image_urls' || root === 'images' || root === 'elements' || root === 'audios'
        ? [root]
        : [];
    if (!mediaFields.length) return null;
    return (
      <div className="space-y-4">
        {mediaFields.map(mediaField => {
          const key = `content:${mediaField}`;
          if (editorKeys.has(key)) return null;
          editorKeys.add(key);
          if (mediaField === 'image_urls' || mediaField === 'images') {
            const values = asArray<string>(effectiveContent(mediaField));
            return <UrlArrayEditor key={mediaField} field={mediaField} values={values} outputModality={model.outputModality} onChange={next => setContentOperation(mediaField, next, next.length === 0)} onReset={() => clearContentOperation(mediaField)} />;
          }
          if (mediaField === 'elements') {
            const values = asArray<Record<string, unknown>>(effectiveContent('elements'));
            return <ElementEditor key={mediaField} values={values} onChange={next => setContentOperation('elements', next, next.length === 0)} onReset={() => clearContentOperation('elements')} />;
          }
          const values = asArray<{ url?: string; range?: number[] }>(effectiveContent('audios'));
          return <AudioEditor key={mediaField} values={values} onChange={next => setContentOperation('audios', next, next.length === 0)} onReset={() => clearContentOperation('audios')} />;
        })}
      </div>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-[180] flex bg-black/85 md:items-center md:justify-center md:p-5">
      <section role="dialog" aria-modal="true" aria-labelledby="generation-case-review-title" className="flex h-full w-full flex-col overflow-hidden border-white/15 bg-slate-950 shadow-2xl md:h-[94vh] md:max-w-7xl md:border">
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-4 py-3 md:px-5">
          <div className="min-w-0">
            <div className="text-xs text-slate-500">Case {position + 1} / {total}</div>
            <h3 id="generation-case-review-title" className="mt-1 truncate text-lg font-semibold text-slate-100" title={caseId}>{caseId}</h3>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <span className={item.valid ? 'text-emerald-300' : 'text-red-300'}>{item.valid ? '有效' : '无效'}</span>
              <span className="text-sky-300">ManuEval：{item.generationType}</span>
              {audit.effectiveGenerationType && <span className="text-slate-400">Aion 已知有效模式：{audit.effectiveGenerationType}</span>}
              {outsideCurrentFilter && <span className="text-emerald-300">已修复，不再匹配当前筛选</span>}
            </div>
          </div>
          <button type="button" onClick={() => guardLeave(onClose)} aria-label="关闭 case 详情" className="inline-flex h-9 w-9 shrink-0 items-center justify-center border border-white/10 text-slate-400 hover:text-white"><X size={17} /></button>
        </header>

        <nav className="flex overflow-x-auto border-b border-white/10 px-3 md:px-5" aria-label="Case 审阅内容">
          <button type="button" onClick={() => setTab('repair')} className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm md:px-4 ${tab === 'repair' ? 'border-amber-400 text-amber-200' : 'border-transparent text-slate-400 hover:text-slate-100'}`}><WandSparkles size={15} /> 修复问题（{repairGroups.length} 个根因）</button>
          <button type="button" onClick={() => setTab('preview')} className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm md:px-4 ${tab === 'preview' ? 'border-amber-400 text-amber-200' : 'border-transparent text-slate-400 hover:text-slate-100'}`}><Eye size={15} /> 生成预览</button>
        </nav>

        <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
          {tab === 'repair' && mode === 'guided' && (
            <div className="space-y-4">
              <div className="border border-sky-400/20 bg-sky-500/[0.06] px-4 py-3 text-sm leading-6 text-sky-100">
                每个区块代表一个需要处理的根因。修改控件就在问题说明下方；保存并重新预检后，系统会重新生成 MCP 输入和 Aion 请求。
              </div>
              {repairGroups.map(group => (
                <section key={group.id} className={`border-l-2 px-4 py-4 ${group.severity === 'error' ? 'border-red-400 bg-red-500/[0.05]' : 'border-amber-400 bg-amber-500/[0.05]'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h4 className={`font-medium ${group.severity === 'error' ? 'text-red-200' : 'text-amber-200'}`}>{group.title}</h4>
                      {group.field && <div className="mt-1 text-xs text-slate-500">修改位置：{group.field}</div>}
                    </div>
                    <span className={`border px-2 py-0.5 text-[11px] ${group.severity === 'error' ? 'border-red-400/20 text-red-200' : 'border-amber-400/20 text-amber-200'}`}>{group.severity === 'error' ? '阻断生成' : '需要确认'}</span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-200">{group.description}</p>
                  <p className="mt-1 text-sm leading-6 text-sky-200">建议：{group.suggestion}</p>
                  <div className="mt-4">{renderGroupEditor(group)}</div>
                  <details className="mt-4 text-xs text-slate-500">
                    <summary className="cursor-pointer">相关检查（{group.diagnostics.length}）与技术原因</summary>
                    <div className="mt-2 space-y-2 border-t border-white/10 pt-2">
                      {group.diagnostics.map((diagnostic, index) => <div key={`${diagnostic.issue.code}-${index}`} className="break-words font-mono">[{diagnostic.issue.code}] {diagnostic.issue.message}</div>)}
                      {group.finding && <div className="break-words font-mono">规则：{group.finding.ruleId} / {group.finding.source} / {group.finding.sourceVersion}</div>}
                    </div>
                  </details>
                </section>
              ))}
              {!repairGroups.length && <div className="border border-emerald-400/20 bg-emerald-500/[0.05] py-12 text-center text-sm text-emerald-300">当前 case 没有预检问题。</div>}

              {!!riskOnlyCodes.length && (
                <details className="border border-red-400/20 bg-red-500/[0.04] p-4">
                  <summary className="cursor-pointer text-sm font-medium text-red-100">无法修改时，确认保留当前素材风险</summary>
                  <div className="mt-3 space-y-3">
                    <div className="text-xs leading-5 text-red-200/80">仅用于可人工确认且不需要改写最终 JSON 的风险。开始字段修复时会清除旧的风险确认。</div>
                    <input value={draftReview.force?.reason || ''} onChange={event => updateForce({ reason: event.target.value, ruleCodes: riskOnlyCodes })} placeholder="说明保留当前输入的原因" className="w-full border border-red-400/20 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
                    <label className="flex items-start gap-3 text-sm text-red-100"><input type="checkbox" checked={draftReview.force?.duplicateBillingRiskConfirmed === true} onChange={event => updateForce({ duplicateBillingRiskConfirmed: event.target.checked, ruleCodes: riskOnlyCodes })} className="mt-0.5" /><span>我已核对当前素材，并理解提交后可能产生计费。</span></label>
                  </div>
                </details>
              )}

              <section className="border border-white/10 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><h4 className="text-sm font-medium text-slate-100">高级：人工覆盖最终 Aion 请求</h4><p className="mt-1 text-xs leading-5 text-slate-500">该模式会绕过普通字段编译，只用于模型合同无法表达且必须人工构造请求的情况。</p></div>
                  <button type="button" onClick={() => switchMode('expert')} className={`inline-flex items-center gap-2 border px-3 py-2 text-xs ${needsFinalJson ? 'border-red-400/40 bg-red-500/10 text-red-100' : 'border-white/10 text-slate-300'}`}><Code2 size={14} /> {needsFinalJson ? '当前问题需要专家请求' : '进入专家模式'}</button>
                </div>
              </section>
            </div>
          )}

          {tab === 'repair' && mode === 'expert' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100"><AlertTriangle size={18} className="mt-0.5 shrink-0" /><div><div className="font-medium">专家模式：最终 JSON 将完整接管本 case</div><p className="mt-1 leading-6 text-red-200/80">Prompt、素材和参数都必须在下方 JSON 中正确填写；系统不再保证它与 MCP 或模型合同对齐。</p></div></div>
              <button type="button" onClick={() => switchMode('guided')} className="border border-white/10 px-3 py-2 text-xs text-slate-300">返回普通字段修复</button>
              <label className="block"><span className="mb-2 block text-sm font-medium text-slate-200">最终 Aion JSON</span><textarea value={requestDraft} onChange={event => setRequestDraft(event.target.value)} rows={18} className="w-full border border-red-400/20 bg-black/30 p-3 font-mono text-xs leading-5 text-slate-100" /></label>
              <label className="block"><span className="mb-2 block text-sm font-medium text-slate-200">强制提交原因</span><input value={draftReview.force?.reason || ''} onChange={event => updateForce({ reason: event.target.value, ruleCodes: defaultForceRuleCodes })} className="w-full border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" /></label>
              <label className="flex items-start gap-3 text-sm text-red-100"><input type="checkbox" checked={draftReview.force?.duplicateBillingRiskConfirmed === true} onChange={event => updateForce({ duplicateBillingRiskConfirmed: event.target.checked, ruleCodes: defaultForceRuleCodes })} className="mt-0.5" /><span>我确认该请求可能不再符合 MCP，并理解可能产生重复计费。</span></label>
            </div>
          )}

          {tab === 'preview' && (
            <div className="space-y-4">
              {previewStale && <div className="flex items-start gap-3 border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"><RefreshCw size={17} className="mt-0.5 shrink-0" /><div><div className="font-medium">当前预览尚未包含这些修改</div><p className="mt-1 text-xs leading-5 text-amber-200/80">下方是上一次服务端预检快照。点击“保存并重新预检”后，MCP 输入、生成方式和 Aion 请求才会更新。</p></div></div>}
              <section><h4 className="mb-2 text-sm font-medium text-slate-100">最终 Prompt</h4><pre className="max-h-56 overflow-auto whitespace-pre-wrap border border-white/10 bg-black/20 p-3 text-xs leading-5 text-slate-200">{serializePrompt(audit.mcpToolInput?.prompt ?? item.resolvedCase.prompt)}</pre></section>
              <section><h4 className="mb-2 text-sm font-medium text-slate-100">素材角色与编号</h4><MaterialPreview input={asRecord(audit.mcpToolInput)} outputModality={model.outputModality} /></section>
              <div className="grid gap-4 lg:grid-cols-2">
                <section className="border border-white/10 p-4"><div className="text-xs text-slate-500">ManuEval 推导生成方式</div><div className="mt-2 text-base font-medium text-sky-200">{item.generationType}</div>{audit.effectiveGenerationType && <div className="mt-2 text-xs text-slate-400">Aion 已知有效模式：{audit.effectiveGenerationType}</div>}</section>
                <section className="border border-white/10 p-4"><div className="text-xs text-slate-500">参数来源</div><div className="mt-2 space-y-1 text-xs text-slate-200">{Object.entries(item.resolvedCase.parameterAudit || {}).length ? (Object.entries(item.resolvedCase.parameterAudit || {}) as Array<[string, { source?: string; value?: unknown; destination?: string }]>).map(([key, value]) => <div key={key}>{key}：{value.source} / {JSON.stringify(value.value ?? value.destination)}</div>) : '使用批次设置或模型默认值'}</div></section>
              </div>
              <div className="grid gap-4 xl:grid-cols-2"><JsonPanel label="MCP 标准输入（只读）" value={audit.mcpToolInput} /><JsonPanel label="最终 Aion 请求（只读）" value={audit.finalAionRequest} /></div>
              <details className="border border-white/10">
                <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium text-slate-200"><Code2 size={15} /> 技术详情</summary>
                <div className="grid gap-4 border-t border-white/10 p-4 xl:grid-cols-2">
                  <JsonPanel label="评测集输入、映射意图与 Case 覆盖" value={{ originalInput: audit.originalInput, inputIntent: audit.intent, promptColumnOverride: audit.promptColumnOverride, caseInputOverride: audit.caseInputOverride }} />
                  <JsonPanel label="素材类型与可达性校验" value={audit.mediaReferences} />
                  <JsonPanel label="MCP 投影差异与人工覆盖" value={{ projectionDiff: audit.projectionDiff, overrideAudit: audit.overrideAudit }} />
                  <JsonPanel label="合同与 Plugin 规则" value={{ contractSource: audit.contractSource, contractFindings: audit.contractFindings, review: audit.review }} />
                </div>
              </details>
            </div>
          )}

          {localError && <div className="mt-4 border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{localError}</div>}
        </main>

        <footer className="flex flex-col gap-3 border-t border-white/10 px-4 py-3 lg:flex-row lg:items-center lg:justify-between md:px-5">
          <div className="flex gap-2">
            <button type="button" onClick={() => onPrevious && guardLeave(onPrevious)} disabled={!onPrevious || saving} className="inline-flex h-9 items-center gap-2 border border-white/10 px-3 text-sm text-slate-300 disabled:opacity-30"><ChevronLeft size={15} /> 上一条</button>
            <button type="button" onClick={() => onNext && guardLeave(onNext)} disabled={!onNext || saving} className="inline-flex h-9 items-center gap-2 border border-white/10 px-3 text-sm text-slate-300 disabled:opacity-30">下一条 <ChevronRight size={15} /></button>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => guardLeave(onClose)} disabled={saving} className="h-9 border border-white/10 px-4 text-sm text-slate-300 disabled:opacity-40">取消</button>
            <button type="button" onClick={saveDraftAndNext} disabled={!datasetItemId || !dirty || saving} className="inline-flex h-9 items-center gap-2 border border-sky-400/20 px-4 text-sm text-sky-200 disabled:opacity-40"><Save size={15} /> 暂存并看下一条</button>
            <button type="button" onClick={() => { void saveAndRepreflight(); }} disabled={!datasetItemId || (!dirty && !previewStale) || saving} className="inline-flex h-9 items-center gap-2 bg-amber-400 px-4 text-sm font-medium text-black disabled:opacity-40">{saving ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} 保存并重新预检</button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
};

export default GenerationCaseReviewDialog;
