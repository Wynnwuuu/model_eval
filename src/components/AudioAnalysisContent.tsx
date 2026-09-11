import React, { useMemo } from 'react';
import {
  audioAnalysisFieldLabel,
  isAudioAnalysisObject,
  parseAudioAnalysis,
  type AudioAnalysisValue,
  type AudioAnalysisView,
} from '../audioAnalysisPresentation';

function AnalysisValue({ value, depth = 0 }: { value: AudioAnalysisValue; depth?: number }) {
  if (Array.isArray(value)) {
    if (!value.length) return <span className="font-mono text-slate-400">[]</span>;
    return <ol className="flex min-w-0 flex-col gap-3">
      {value.map((entry, index) => <li key={index} className="min-w-0 border-l border-white/15 pl-3">
        {value.length > 1 && <span className="mb-1 block text-xs text-slate-500">{index + 1}</span>}
        <AnalysisValue value={entry} depth={depth + 1} />
      </li>)}
    </ol>;
  }
  if (isAudioAnalysisObject(value)) {
    if (!Object.keys(value).length) return <span className="font-mono text-slate-400">{'{}'}</span>;
    return <dl className="flex min-w-0 flex-col gap-3">
      {Object.entries(value).map(([key, entry]) => <div key={key} className="min-w-0">
        <dt className="mb-1 text-xs font-medium leading-5 text-slate-400 [overflow-wrap:anywhere]">{audioAnalysisFieldLabel(key)}</dt>
        <dd className={`min-w-0 ${depth < 3 && typeof entry === 'object' && entry !== null ? 'pl-2' : ''}`}><AnalysisValue value={entry} depth={depth + 1} /></dd>
      </div>)}
    </dl>;
  }
  const text = value === null ? 'null' : value === '' ? '""' : String(value);
  return <div className="whitespace-pre-wrap text-sm leading-7 text-slate-200 [overflow-wrap:anywhere]">{text}</div>;
}

export default function AudioAnalysisContent({ original, view }: { original: string; view: AudioAnalysisView }) {
  const analysis = useMemo(() => parseAudioAnalysis(original), [original]);
  if (view === 'raw') {
    return <pre className="m-0 whitespace-pre-wrap break-words font-mono text-xs leading-6 text-slate-200 [overflow-wrap:anywhere]">{analysis.original}</pre>;
  }
  if (analysis.kind === 'text') {
    return <div>
      {view !== 'overview' && <p className="mb-3 text-xs leading-5 text-slate-400">此返回为连续文本，保留全文供对照。</p>}
      <div className="whitespace-pre-wrap text-sm leading-7 text-slate-200 [overflow-wrap:anywhere]">{analysis.original}</div>
    </div>;
  }
  if (analysis.kind === 'json') {
    return <div>
      <p className="mb-3 text-xs leading-5 text-slate-400">此返回未按当前分区组织，以下显示全部内容。</p>
      <AnalysisValue value={analysis.value!} />
    </div>;
  }
  const sections = analysis.sections[view];
  if (!sections.length) return <p className="text-sm leading-7 text-slate-400">此返回未提供独立的本分区字段。其他分区和完整原文仍可查看。</p>;
  const mainSections = sections.filter(section => !section.supplemental);
  const supplemental = sections.filter(section => section.supplemental);
  const renderSection = (section: typeof sections[number]) => <section key={section.path} className="min-w-0">
    <h4 className="mb-2 text-xs font-bold leading-5 text-slate-400 [overflow-wrap:anywhere]">{section.title}</h4>
    <AnalysisValue value={section.value} />
  </section>;
  return <div className="flex min-w-0 flex-col gap-5">
    {mainSections.map(renderSection)}
    {supplemental.length > 0 && <details className="min-w-0 border-t border-white/10 pt-3">
      <summary className="cursor-pointer text-xs leading-6 text-slate-400">返回中的补充信息</summary>
      <div className="mt-4 flex min-w-0 flex-col gap-5">{supplemental.map(renderSection)}</div>
    </details>}
  </div>;
}
