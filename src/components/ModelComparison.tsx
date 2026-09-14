import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, Headphones, Link, LockKeyhole } from 'lucide-react';
import AudioAnalysisContent from './AudioAnalysisContent';
import FloatingAudioPlayer from './FloatingAudioPlayer';
import { AUDIO_ANALYSIS_VIEWS, type AudioAnalysisView } from '../audioAnalysisPresentation';
import { buildComparisonCsv, comparisonSummary, rankedComparisonOptions, type ComparisonDataset } from '../modelComparison';

const actionClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-200 transition hover:border-white/30 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-35';
const selectClass = 'min-w-0 rounded-lg border border-white/20 bg-[#141b24] px-3 py-2.5 text-sm text-slate-100';

function caseIdFromUrl(dataset: ComparisonDataset) {
  const requested = new URL(window.location.href).searchParams.get('case');
  return dataset.cases.find(item => item.id === requested)?.id || dataset.cases[0].id;
}

export default function ModelComparison({ dataset }: { dataset: ComparisonDataset }) {
  const [caseId, setCaseId] = useState(() => caseIdFromUrl(dataset));
  const [category, setCategory] = useState('');
  const [analysisView, setAnalysisView] = useState<AudioAnalysisView>('overview');
  const [audioExpanded, setAudioExpanded] = useState(() => window.matchMedia('(min-width: 1280px)').matches);
  const [audioError, setAudioError] = useState(false);
  const [notice, setNotice] = useState('');
  const audioRef = useRef<HTMLAudioElement>(null);
  const caseHeadingRef = useRef<HTMLHeadingElement>(null);
  const item = dataset.cases.find(candidate => candidate.id === caseId)!;
  const source = dataset.sources.find(candidate => candidate.key === item.sourceKey)!;
  const caseKey = `${dataset.id}:${item.id}`;
  const activeCaseRef = useRef(caseKey);
  activeCaseRef.current = caseKey;
  const audioUrl = `${import.meta.env.BASE_URL}${item.audioUrl.replace(/^\//, '')}`;
  const summary = useMemo(() => comparisonSummary(dataset), [dataset]);
  const categories = useMemo(() => [...new Set(dataset.cases.map(entry => entry.category))], [dataset]);
  const filteredCases = dataset.cases.filter(entry => !category || entry.category === category);
  const filteredIndex = filteredCases.findIndex(entry => entry.id === item.id);
  const options = rankedComparisonOptions(dataset, item);
  const caseUrl = new URL(window.location.href);
  caseUrl.searchParams.delete('view');
  caseUrl.searchParams.set('case', item.id);
  caseUrl.hash = '';

  useEffect(() => {
    const restoreUrl = () => {
      setCaseId(caseIdFromUrl(dataset));
      setCategory('');
      setNotice('');
    };
    window.addEventListener('popstate', restoreUrl);
    return () => window.removeEventListener('popstate', restoreUrl);
  }, [dataset]);

  useEffect(() => {
    setAudioError(false);
    setNotice('');
  }, [caseKey]);

  const navigate = (id: string, scroll = false) => {
    if (!dataset.cases.some(entry => entry.id === id)) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('view');
    url.searchParams.set('case', id);
    url.hash = '';
    if (id !== caseId || window.location.href !== url.href) window.history.pushState(null, '', url);
    setCaseId(id);
    setNotice('');
    if (scroll) caseHeadingRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  };

  const exportCsv = () => {
    try {
      const csv = buildComparisonCsv(dataset);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `audio-model-comparison-${dataset.cases.length}题.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`已导出全部 ${dataset.cases.length} 题的具名排名。`);
    } catch {
      setNotice('导出失败，请重试。');
    }
  };

  return <div className="min-h-screen" data-testid="comparison-page">
    <header className="border-b border-white/10 bg-black/25">
      <div className="mx-auto flex max-w-[1760px] flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-8">
        <div><p className="text-xs font-bold tracking-[0.2em] text-amber-400">MODEL COMPARISON</p><h1 className="mt-1 text-xl font-bold text-slate-100">音频模型评审结果</h1></div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-400"><LockKeyhole size={14} aria-hidden="true" />已确认排名 · 只读</span>
          <button type="button" onClick={exportCsv} className={actionClass}><Download size={16} aria-hidden="true" />导出排名 CSV</button>
          <a href={`${import.meta.env.BASE_URL}?view=blind`} className="text-xs text-slate-400 underline underline-offset-4 hover:text-white">独立盲评入口</a>
        </div>
      </div>
    </header>

    <FloatingAudioPlayer
      audioRef={audioRef} sourceKey={caseKey} src={audioUrl} index={item.caseNumber} total={dataset.cases.length} durationSeconds={item.durationSeconds}
      expanded={audioExpanded} onExpandedChange={setAudioExpanded} error={audioError}
      onPlaying={() => { if (activeCaseRef.current === caseKey) setAudioError(false); }}
      onError={() => { if (activeCaseRef.current === caseKey) setAudioError(true); }}
      onRetry={() => { setAudioError(false); audioRef.current?.load(); }}
    />

    <div className="evaluation-content" data-audio-expanded={audioExpanded}>
      <main className="mx-auto max-w-[1760px] px-4 py-6 sm:px-8 sm:py-8">
        <section aria-labelledby="comparison-summary-heading" className="mb-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="comparison-summary-heading" className="text-base font-bold text-slate-100">总排名 <span className="ml-2 text-sm font-normal text-slate-400">{dataset.cases.length} 题</span></h2>
            <p className="text-xs leading-5 text-slate-400">每题等权，平均名次越低越好；相同则并列。</p>
          </div>
          <ol className="mt-4 grid gap-3 md:grid-cols-3" aria-label="模型总排名">
            {summary.map(row => <li key={row.variant.id} className={`min-w-0 rounded-xl border p-4 ${row.position === 1 ? 'border-amber-400/35 bg-amber-400/[0.06]' : 'border-white/15 bg-white/[0.025]'}`}>
              <div className="flex items-start gap-3"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-bold ${row.position === 1 ? 'bg-amber-400 text-slate-950' : 'bg-white/10 text-slate-300'}`}>{row.position}</span><div className="min-w-0"><h3 className="text-sm font-bold leading-6 text-slate-100 [overflow-wrap:anywhere]">{row.variant.modelName}</h3><p className="mt-1 text-xs text-slate-400">{row.variant.promptName || row.variant.name}</p></div></div>
              <div className="mt-4 flex flex-wrap items-end justify-between gap-3"><div><span className="text-2xl font-bold tabular-nums text-slate-100">{row.averageRank.toFixed(2)}</span><span className="ml-2 text-xs text-slate-400">平均名次</span></div><p className="text-xs leading-6 text-slate-400">首选 <strong className="font-semibold text-slate-200">{row.firstCount} 次</strong> · {(row.firstRate * 100).toFixed(1)}%</p></div>
            </li>)}
          </ol>
          <p className="mt-3 text-xs leading-5 text-slate-500">这里展示已确认的人评相对排序，可直接试听并查看每个模型的完整输出。</p>
        </section>

        <section aria-labelledby="case-heading" className="mb-6 rounded-2xl border border-white/15 bg-white/[0.035] p-4 sm:p-5" data-testid="case-summary">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><h2 id="case-heading" ref={caseHeadingRef} className="flex scroll-mt-6 flex-wrap items-center gap-2 text-base font-bold text-slate-100"><Headphones size={19} className="text-amber-400" aria-hidden="true" />第 {item.caseNumber} 题 <span className="text-sm font-normal text-slate-500">/ {dataset.cases.length}</span><span className="ml-1 rounded-md bg-white/5 px-2 py-1 font-mono text-xs text-slate-300">{item.id}</span></h2><p className="mt-2 text-sm text-slate-300">{item.category}<span className="mx-2 text-slate-600">·</span><span className="text-xs text-slate-400">{source.label}</span></p></div>
            <a href={caseUrl.href} className="inline-flex items-center gap-1.5 text-xs text-amber-300 underline underline-offset-4" title="可复制此链接，直接打开当前题目"><Link size={14} aria-hidden="true" />本题链接</a>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
            <label className="flex min-w-0 flex-col gap-2 text-xs text-slate-400">筛选类别
              <select aria-label="筛选类别" className={selectClass} value={category} onChange={event => {
                const next = event.target.value;
                setCategory(next);
                if (next && item.category !== next) navigate(dataset.cases.find(entry => entry.category === next)!.id);
              }}><option value="">全部类别（{dataset.cases.length} 题）</option>{categories.map(value => <option key={value} value={value}>{value}（{dataset.cases.filter(entry => entry.category === value).length} 题）</option>)}</select>
            </label>
            <label className="flex min-w-0 flex-col gap-2 text-xs text-slate-400">选择题目
              <select data-testid="case-select" aria-label="选择题目" className={selectClass} value={item.id} onChange={event => navigate(event.target.value)}>{filteredCases.map(entry => <option key={entry.id} value={entry.id}>第 {entry.caseNumber} 题 · {entry.id} · {entry.category}</option>)}</select>
            </label>
            <nav aria-label="切换题目" className="flex items-end gap-2"><button type="button" className={`${actionClass} flex-1 whitespace-nowrap py-2.5`} disabled={filteredIndex <= 0} onClick={() => navigate(filteredCases[filteredIndex - 1].id)}><ArrowLeft size={15} aria-hidden="true" />上一题</button><button type="button" className={`${actionClass} flex-1 whitespace-nowrap py-2.5`} disabled={filteredIndex >= filteredCases.length - 1} onClick={() => navigate(filteredCases[filteredIndex + 1].id)}>下一题<ArrowRight size={15} aria-hidden="true" /></button></nav>
          </div>
        </section>

        <section aria-labelledby="comparison-reading-heading">
          <h2 id="comparison-reading-heading" className="text-base font-bold text-slate-100">本题输出与排序</h2>
          <p className="mt-1 text-xs leading-5 text-slate-400">按第 1、2、3 名依次展示，模型名称与对应输出一起保留。左侧音频栏可随时试听。</p>
          <div role="tablist" aria-label="分析内容分区" className="my-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {AUDIO_ANALYSIS_VIEWS.map(view => <button key={view.id} type="button" role="tab" id={`comparison-tab-${view.id}`} aria-controls="comparison-reading-panel" aria-selected={analysisView === view.id} tabIndex={analysisView === view.id ? 0 : -1}
              onClick={() => setAnalysisView(view.id)}
              onKeyDown={event => {
                const index = AUDIO_ANALYSIS_VIEWS.findIndex(entry => entry.id === view.id);
                const count = AUDIO_ANALYSIS_VIEWS.length;
                const next = event.key === 'ArrowRight' ? (index + 1) % count : event.key === 'ArrowLeft' ? (index + count - 1) % count : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : null;
                if (next === null) return;
                event.preventDefault();
                const target = AUDIO_ANALYSIS_VIEWS[next].id;
                setAnalysisView(target);
                document.getElementById(`comparison-tab-${target}`)?.focus();
              }}
              className={`rounded-lg border px-4 py-2.5 text-sm font-semibold ${analysisView === view.id ? 'border-amber-400/45 bg-amber-400/10 text-amber-300' : 'border-white/15 text-slate-400 hover:bg-white/5'}`}>{view.label}</button>)}
          </div>
          <div id="comparison-reading-panel" role="tabpanel" aria-labelledby={`comparison-tab-${analysisView}`} className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-3">
            {options.map(option => <article key={`${item.id}:${option.variantId}`} data-testid={`comparison-card-${option.rank}`} data-variant-id={option.variantId} data-rank={option.rank} data-model-name={option.variant.modelName} className={`min-w-0 overflow-hidden rounded-xl border bg-white/[0.025] ${option.rank === 1 ? 'border-amber-400/35' : 'border-white/15'}`}>
              <div className="border-b border-white/10 px-4 py-4 sm:px-5"><span className={`mb-3 inline-flex rounded-md px-2.5 py-1 text-xs font-bold ${option.rank === 1 ? 'bg-amber-400 text-slate-950' : 'bg-white/10 text-slate-200'}`}>第 {option.rank} 名</span><h3 className="text-sm font-bold leading-6 text-slate-100 [overflow-wrap:anywhere]">{option.variant.modelName}</h3><p className="mt-1 text-xs leading-5 text-slate-400">Prompt：{option.variant.promptName || option.variant.name}</p></div>
              <div className="min-w-0 p-4 sm:p-5"><AudioAnalysisContent original={option.original} view={analysisView} /></div>
            </article>)}
          </div>
          <nav aria-label="阅读后切换题目" className="mt-6 flex flex-wrap justify-between gap-3"><button type="button" className={actionClass} disabled={filteredIndex <= 0} onClick={() => navigate(filteredCases[filteredIndex - 1].id, true)}><ArrowLeft size={15} aria-hidden="true" />上一题</button><button type="button" className={actionClass} disabled={filteredIndex >= filteredCases.length - 1} onClick={() => navigate(filteredCases[filteredIndex + 1].id, true)}>下一题<ArrowRight size={15} aria-hidden="true" /></button></nav>
        </section>
        {notice && <p role="status" className="mt-4 text-sm text-amber-200">{notice}</p>}
      </main>
    </div>
  </div>;
}
