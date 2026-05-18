import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, ClipboardList, MessageSquare, RotateCcw, SkipForward, X } from 'lucide-react';
import { EvaluationItem } from '../types';
import DimensionChips from './DimensionChips';
import BenchmarkOutputCell from './BenchmarkOutputCell';
import { PreviewMediaType } from '../mediaTypeUtils';
import { getDimensionValuesForItem } from '../dimensionUtils';
import { resolveEvaluationItemPrompt } from '../rankingUtils';

interface BenchmarkPreviewScreenProps {
  item: EvaluationItem;
  currentIndex: number;
  totalItems: number;
  models: { id: string; name: string }[];
  outputType?: PreviewMediaType;
  onComment: (comment: string) => void;
  onSkip: () => void;
  onEnd: () => void;
  onBack: () => void;
  onGoBack?: () => void;
}

const stringifyValue = (value: unknown) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
};

const BenchmarkPreviewScreen: React.FC<BenchmarkPreviewScreenProps> = ({
  item,
  currentIndex,
  totalItems,
  models,
  outputType = 'text',
  onComment,
  onSkip,
  onEnd,
  onBack,
  onGoBack
}) => {
  const [comment, setComment] = useState('');

  useEffect(() => {
    setComment('');
  }, [item.id]);

  const inputEntries = useMemo(() => {
    const entries = Object.entries(item.inputs || {});
    if (entries.length > 0) return entries;
    const prompt = resolveEvaluationItemPrompt(item);
    return prompt ? [['Prompt', prompt]] : [];
  }, [item]);

  const outputEntries = useMemo(() => {
    if (item.modelOutputs?.length) {
      return item.modelOutputs.map(output => ({
        key: output.modelId,
        label: output.modelName,
        value: output.url
      }));
    }

    return models
      .map((model, index) => ({
        key: model.id,
        label: model.name,
        value: index === 0 ? item.modelA_Url : index === 1 ? item.modelB_Url : ''
      }))
      .filter(output => output.value);
  }, [item, models]);

  const progressPercent = totalItems > 0 ? Math.round(((currentIndex + 1) / totalItems) * 100) : 0;
  const isLastItem = currentIndex >= totalItems - 1;
  const handleSave = () => onComment(comment);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tagName = target.tagName.toLowerCase();
      return tagName === 'textarea' || tagName === 'input' || tagName === 'select' || target.isContentEditable;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const editable = isEditableTarget(event.target);

      if (editable) {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          handleSave();
        }
        return;
      }

      if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'j' || event.key.toLowerCase() === 'n' || event.key === 'Enter') {
        event.preventDefault();
        handleSave();
        return;
      }

      if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'k') {
        if (onGoBack) {
          event.preventDefault();
          onGoBack();
        }
        return;
      }

      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        onSkip();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [comment, handleSave, onGoBack, onSkip]);

  return (
    <div className="mx-auto flex min-h-[calc(100vh-96px)] max-w-7xl flex-col px-4 py-4 md:px-6">
      <header className="mb-4 flex flex-col gap-3 border-b border-white/10 pb-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-amber-300">
            <ClipboardList size={15} />
            Benchmark 数据预览
          </div>
          <h1 className="truncate text-2xl font-bold text-slate-100">Case {currentIndex + 1} / {totalItems}</h1>
          <div className="mt-3 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-amber-400" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={onBack} className="inline-flex items-center gap-2 border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10">
            <X size={16} /> 返回
          </button>
          {onGoBack && (
            <button onClick={onGoBack} className="inline-flex items-center gap-2 border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10">
              <RotateCcw size={16} /> 上一条
            </button>
          )}
          <button onClick={onEnd} className="inline-flex items-center gap-2 border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10">
            结束预览
          </button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
        <aside className="flex min-h-0 flex-col gap-4">
          <section className="border border-white/10 bg-white/5 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-100">输入信息</h2>
              <span className="text-xs text-slate-500">{inputEntries.length} 字段</span>
            </div>
            <DimensionChips values={getDimensionValuesForItem(item)} label="" />
            <div className="mt-4 space-y-3">
              {inputEntries.map(([key, value]) => (
                <div key={key} className="border border-white/10 bg-black/20 p-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{key}</div>
                  <div className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">{stringifyValue(value) || '-'}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="border border-white/10 bg-white/5 p-4">
            <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-100">
              <MessageSquare size={16} /> 评论
            </label>
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="可记录数据问题、字段说明、复核意见；留空也可以保存为已预览。"
              className="min-h-[220px] w-full resize-y border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-amber-400"
            />
          </section>
        </aside>

        <section className="min-h-0 border border-white/10 bg-white/5 p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-100">输出预览</h2>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <ArrowLeft size={14} />
              <span>{outputEntries.length} 输出列</span>
              <ArrowRight size={14} />
            </div>
          </div>
          <div className="grid max-h-[calc(100vh-190px)] gap-4 overflow-y-auto md:grid-cols-2">
            {outputEntries.length > 0 ? (
              outputEntries.map(output => (
                <BenchmarkOutputCell
                  key={output.key}
                  label={output.label}
                  value={output.value}
                  preferredType={outputType}
                  isActive={false}
                />
              ))
            ) : (
              <div className="flex min-h-[260px] items-center justify-center border border-white/10 bg-black/20 text-sm text-slate-500">
                未选择输出预览列
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="sticky bottom-0 z-30 mt-4 border border-white/10 bg-slate-950/90 p-3 shadow-2xl shadow-black/40 backdrop-blur">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="text-xs text-slate-400">Case {currentIndex + 1} / {totalItems}</div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10 md:w-64">
              <div className="h-full bg-amber-400" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 md:flex md:items-center">
            {onGoBack && (
              <button onClick={onGoBack} className="inline-flex items-center justify-center gap-2 border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-200 hover:bg-white/10">
                <RotateCcw size={16} /> 上一条
              </button>
            )}
            <button onClick={onSkip} className="inline-flex items-center justify-center gap-2 border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-200 hover:bg-white/10">
              <SkipForward size={16} /> 跳过
            </button>
            <button onClick={handleSave} className="col-span-2 inline-flex items-center justify-center gap-2 bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 md:col-span-1">
              <CheckCircle2 size={16} /> {isLastItem ? '保存并完成' : '保存并下一条'}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default BenchmarkPreviewScreen;
