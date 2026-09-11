import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Download, GripVertical, Headphones, RotateCcw, SkipForward } from 'lucide-react';
import AudioAnalysisContent from './AudioAnalysisContent';
import FloatingAudioPlayer from './FloatingAudioPlayer';
import { AUDIO_ANALYSIS_VIEWS, type AudioAnalysisView } from '../audioAnalysisPresentation';
import {
  blindVariantOrder, buildSimpleResultsCsv, emptySimpleSession, isCompleteOrder, loadSimpleSession,
  moveSimpleVariant, persistSimpleSession, simpleStorageKey, SimpleStorageConflictError, type SimpleDataset, type SimpleSession,
} from '../simpleEvaluation';

const actionClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-200 transition hover:border-white/30 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-35';

export default function SimpleAudioEvaluation({ dataset }: { dataset: SimpleDataset }) {
  const [initial] = useState(() => {
    try { return { state: loadSimpleSession(dataset, window.localStorage), error: '' }; }
    catch (error) { return { state: emptySimpleSession(dataset), error: error instanceof Error ? error.message : '浏览器存储暂不可用。' }; }
  });
  const [session, setSession] = useState<SimpleSession>(initial.state);
  const [storageBlocked, setStorageBlocked] = useState(Boolean(initial.error));
  const [error, setError] = useState(initial.error);
  const [notice, setNotice] = useState('');
  const [analysisView, setAnalysisView] = useState<AudioAnalysisView>('overview');
  const [hasListened, setHasListened] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const [audioExpanded, setAudioExpanded] = useState(() => window.matchMedia('(min-width: 1280px)').matches);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const item = dataset.cases[session.currentIndex];
  const candidateCount = dataset.variants.length;
  const review = session.reviews[item.id];
  const optionOrder = review?.optionOrder || blindVariantOrder(dataset, session.reviewerId, item.id);
  const initialOrder = review?.status === 'ranked' ? review.order : optionOrder;
  const caseKey = `${dataset.id}:${session.reviewerId}:${item.id}`;
  const audioUrl = `${import.meta.env.BASE_URL}${item.audioUrl.replace(/^\//, '')}`;
  const [draft, setDraft] = useState({ caseKey, order: initialOrder, confirmed: false });
  const currentDraft = draft.caseKey === caseKey ? draft : { caseKey, order: initialOrder, confirmed: false };
  const activeCaseRef = useRef(caseKey);
  activeCaseRef.current = caseKey;
  const labelOf = (id: string) => String.fromCharCode(65 + optionOrder.indexOf(id));
  const answered = Object.values(session.reviews).filter(entry => entry.status === 'ranked').length;
  const skipped = Object.values(session.reviews).filter(entry => entry.status === 'skipped').length;
  const completed = answered + skipped;
  const dirty = currentDraft.order.join('|') !== initialOrder.join('|');
  const unsaved = dirty || currentDraft.confirmed;
  const canSave = !saving && !storageBlocked && hasListened && !audioError && currentDraft.confirmed
    && isCompleteOrder(currentDraft.order, dataset.variants.map(variant => variant.id));

  useEffect(() => {
    setDraft({ caseKey, order: initialOrder, confirmed: false });
    setHasListened(false); setAudioError(false); setAnalysisView('overview');
    setDraggingId(null); setDropTarget(null);
    setError(storageBlocked ? initial.error : '');
  }, [caseKey]);

  useEffect(() => {
    const changedElsewhere = (event: StorageEvent) => {
      if (event.key !== simpleStorageKey(dataset.id) && event.key !== null) return;
      setStorageBlocked(true); setError(new SimpleStorageConflictError().message); setNotice('');
    };
    window.addEventListener('storage', changedElsewhere);
    return () => window.removeEventListener('storage', changedElsewhere);
  }, [dataset.id]);

  const persist = (next: SimpleSession, message: string): boolean => {
    try {
      const saved = persistSimpleSession(dataset, next, window.localStorage);
      setSession(saved); setError(''); setNotice(message);
      return true;
    } catch (cause) {
      if (cause instanceof SimpleStorageConflictError) { setStorageBlocked(true); setError(cause.message); }
      else setError('保存失败，当前排序仍保留在页面上。请不要关闭或刷新页面，释放浏览器存储空间后重试。');
      setNotice('');
      return false;
    }
  };

  const navigate = (index: number) => {
    if (saving || storageBlocked || unsaved || index < 0 || index >= dataset.cases.length) return;
    if (persist({ ...session, currentIndex: index }, '')) window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const move = (variantId: string, target: number) => {
    if (saving || storageBlocked) return;
    const order = moveSimpleVariant(currentDraft.order, variantId, target);
    if (order === currentDraft.order || order.join('|') === currentDraft.order.join('|')) return;
    setDraft({ caseKey, order, confirmed: false }); setError(''); setNotice('');
  };

  const save = () => {
    if (!canSave) return;
    setSaving(true);
    const nextIndex = Math.min(session.currentIndex + 1, dataset.cases.length - 1);
    const next: SimpleSession = { ...session, currentIndex: nextIndex, reviews: {
      ...session.reviews,
      [item.id]: { status: 'ranked', order: [...currentDraft.order], optionOrder: [...optionOrder], savedAt: new Date().toISOString() },
    } };
    const message = Object.keys(next.reviews).length === dataset.cases.length ? '已保存，本轮全部完成，可以导出评价。' : '评价已保存。';
    if (persist(next, message)) {
      setDraft({ caseKey, order: currentDraft.order, confirmed: false });
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
    setSaving(false);
  };

  const skip = () => {
    if (saving || storageBlocked || review?.status === 'ranked') return;
    const next = { ...session, currentIndex: Math.min(session.currentIndex + 1, dataset.cases.length - 1), reviews: {
      ...session.reviews,
      [item.id]: { status: 'skipped' as const, order: [], optionOrder: [...optionOrder], savedAt: new Date().toISOString() },
    } };
    if (persist(next, '已跳过，可用“上一条”返回补评。')) {
      setDraft({ caseKey, order: optionOrder, confirmed: false });
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  };

  const exportCsv = () => {
    if (storageBlocked) return;
    try {
      const csv = buildSimpleResultsCsv(dataset, session);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url;
      link.download = `audio-evaluation-${session.reviewerId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('已导出当前保存的评价。');
    } catch { setError('导出失败，请重试。已保存的评价未改动。'); }
  };

  const reloadStorage = () => {
    try {
      const state = loadSimpleSession(dataset, window.localStorage);
      const restoredItem = dataset.cases[state.currentIndex];
      const restoredReview = state.reviews[restoredItem.id];
      const restoredOptions = restoredReview?.optionOrder || blindVariantOrder(dataset, state.reviewerId, restoredItem.id);
      const restoredOrder = restoredReview?.status === 'ranked' ? restoredReview.order : restoredOptions;
      setSession(state); setStorageBlocked(false); setError(''); setNotice('已读取本地进度。');
      setDraft({ caseKey: `${dataset.id}:${state.reviewerId}:${restoredItem.id}`, order: restoredOrder, confirmed: false });
      setHasListened(false); setAudioError(false); setDraggingId(null); setDropTarget(null); setAnalysisView('overview');
      audioRef.current?.pause();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '浏览器存储暂不可用。'); }
  };

  return <div className="min-h-screen" data-testid="simple-audio-evaluation">
    <header className="border-b border-white/10 bg-black/25">
      <div className="mx-auto flex max-w-[1480px] flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-8">
        <div><p className="text-xs font-bold tracking-[0.2em] text-amber-400">MODEL EVAL</p><h1 className="mt-1 text-xl font-bold text-slate-100">音频分析盲排</h1></div>
        <div className="flex flex-wrap items-center gap-4"><span className="text-sm text-slate-400">已评 {answered} · 已跳过 {skipped} · 共 {dataset.cases.length} 条</span><button type="button" onClick={exportCsv} disabled={!completed || saving || storageBlocked} className={actionClass}><Download size={16} />导出评价 CSV</button></div>
      </div>
      <div className="h-1 bg-white/5" role="progressbar" aria-label="评审进度" aria-valuemin={0} aria-valuemax={dataset.cases.length} aria-valuenow={completed}><div className="h-full bg-amber-400 transition-all" style={{ width: `${completed / dataset.cases.length * 100}%` }} /></div>
    </header>

    <FloatingAudioPlayer
      audioRef={audioRef} sourceKey={caseKey} src={audioUrl} index={session.currentIndex + 1} total={dataset.cases.length} durationSeconds={item.durationSeconds}
      expanded={audioExpanded} onExpandedChange={setAudioExpanded} error={audioError}
      onPlaying={() => { if (activeCaseRef.current === caseKey) { setHasListened(true); setAudioError(false); } }}
      onError={() => { if (activeCaseRef.current === caseKey) setAudioError(true); }}
      onRetry={() => { setAudioError(false); setHasListened(false); audioRef.current?.load(); }}
    />
    <div className="evaluation-content" data-audio-expanded={audioExpanded}>
    <main className="mx-auto max-w-[1480px] px-4 py-6 sm:px-8 sm:py-8">
      {storageBlocked && <div role="alert" className="mb-6 rounded-xl border border-rose-400/30 bg-rose-400/5 p-4 text-sm text-rose-200"><p>{error || '浏览器存储暂不可用，恢复后才能保存评价。'}</p><button type="button" onClick={reloadStorage} className={`${actionClass} mt-3`}>重新读取本地进度</button></div>}
      <section className="mb-6 rounded-2xl border border-white/15 bg-white/[0.035] p-4 sm:p-5" aria-label="待评审音频">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-base font-bold text-slate-100"><Headphones size={19} className="text-amber-400" />音频 {session.currentIndex + 1}<span className="ml-1 text-sm font-normal text-slate-500">/ {dataset.cases.length}</span></h2><span className="text-xs text-slate-400">{review?.status === 'ranked' ? '本条已保存，可试听后修改' : review?.status === 'skipped' ? '本条已跳过，可继续补评' : '待评审'}</span></div>
        <p className="mt-3 text-xs leading-5 text-slate-400">先听音频，再按事实的准确程度排序。注意错误、臆测与关键信息遗漏；语言、篇幅和排版不代表质量。可通过左侧音频栏随时重听。</p>
      </section>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_310px]">
        <section className="min-w-0" aria-labelledby="read-analysis-heading">
          <h2 id="read-analysis-heading" className="text-base font-bold text-slate-100">对照阅读</h2>
          <p className="mt-1 text-xs leading-5 text-slate-400">分析 A–{String.fromCharCode(64 + candidateCount)} 的位置固定。排序在右侧完成，手机上位于阅读区下方。<a href="#ranking-panel" className="ml-2 text-amber-300 underline underline-offset-4 xl:hidden">前往排序</a></p>
          <div role="tablist" aria-label="分析内容分区" className="my-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {AUDIO_ANALYSIS_VIEWS.map(view => <button
              key={view.id} type="button" role="tab" id={`analysis-tab-${view.id}`} aria-controls="analysis-reading-panel" aria-selected={analysisView === view.id} tabIndex={analysisView === view.id ? 0 : -1}
              onClick={() => setAnalysisView(view.id)}
              onKeyDown={event => {
                const index = AUDIO_ANALYSIS_VIEWS.findIndex(entry => entry.id === view.id);
                const next = event.key === 'ArrowRight' ? (index + 1) % 4 : event.key === 'ArrowLeft' ? (index + 3) % 4 : event.key === 'Home' ? 0 : event.key === 'End' ? 3 : null;
                if (next === null) return;
                event.preventDefault(); const target = AUDIO_ANALYSIS_VIEWS[next].id; setAnalysisView(target); document.getElementById(`analysis-tab-${target}`)?.focus();
              }}
              className={`rounded-lg border px-4 py-2.5 text-sm font-semibold ${analysisView === view.id ? 'border-amber-400/45 bg-amber-400/10 text-amber-300' : 'border-white/15 text-slate-400 hover:bg-white/5'}`}
            >{view.label}</button>)}
          </div>
          <div id="analysis-reading-panel" role="tabpanel" aria-labelledby={`analysis-tab-${analysisView}`} className="grid min-w-0 grid-cols-1 items-start gap-4 md:grid-cols-2">
            {optionOrder.map((variantId, index) => <article key={variantId} className="min-w-0 overflow-hidden rounded-xl border border-white/15 bg-white/[0.025]" data-testid={`analysis-card-${String.fromCharCode(65 + index)}`}>
              <h3 className="flex items-center gap-2 border-b border-white/10 px-5 py-4 text-sm font-bold text-slate-100"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-white/5 font-mono text-amber-300">{String.fromCharCode(65 + index)}</span>分析 {String.fromCharCode(65 + index)}</h3>
              <div className="min-w-0 p-5"><AudioAnalysisContent original={item.outputs[variantId]} view={analysisView} /></div>
            </article>)}
          </div>
        </section>

        <aside id="ranking-panel" className="min-w-0 scroll-mt-6 rounded-2xl border border-white/15 bg-[#12151a] p-4 xl:sticky xl:top-6" aria-label="排序与保存">
          <h2 className="text-base font-bold text-slate-100">给出你的排序</h2>
          <p className="mt-2 text-xs leading-5 text-slate-400">拖动调整顺序，也可用上下按钮。<br />第 1 名最准确，不设并列。</p>
          <ol className="my-4 flex flex-col gap-2" aria-label="分析排名">
            {currentDraft.order.map((variantId, index) => <li
              key={variantId} draggable={!saving && !storageBlocked} data-testid={`rank-row-${labelOf(variantId)}`}
              onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', variantId); setDraggingId(variantId); }}
              onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(variantId); }}
              onDrop={event => { event.preventDefault(); const id = draggingId || event.dataTransfer.getData('text/plain'); if (currentDraft.order.includes(id)) move(id, index); setDraggingId(null); setDropTarget(null); }}
              onDragEnd={() => { setDraggingId(null); setDropTarget(null); }}
              className={`flex min-w-0 cursor-grab items-center gap-2 rounded-xl border px-3 py-3 active:cursor-grabbing ${dropTarget === variantId ? 'border-amber-400 bg-amber-400/10' : index === 0 ? 'border-amber-400/35 bg-amber-400/5' : 'border-white/10 bg-white/[0.025]'} ${draggingId === variantId ? 'opacity-40' : ''}`}
            >
              <GripVertical size={16} className="shrink-0 text-slate-500" aria-hidden="true" />
              <span className="w-6 shrink-0 text-sm font-bold text-amber-300" aria-label={`第 ${index + 1} 名`}>{index + 1}</span>
              <span className="flex-1 text-sm font-bold text-slate-100">分析 {labelOf(variantId)}</span>
              <button type="button" onClick={() => move(variantId, index - 1)} disabled={saving || storageBlocked || index === 0} aria-label={`将分析 ${labelOf(variantId)} 上移`} className="rounded-md p-1.5 text-slate-300 hover:bg-white/10 disabled:opacity-20"><ArrowUp size={16} /></button>
              <button type="button" onClick={() => move(variantId, index + 1)} disabled={saving || storageBlocked || index === currentDraft.order.length - 1} aria-label={`将分析 ${labelOf(variantId)} 下移`} className="rounded-md p-1.5 text-slate-300 hover:bg-white/10 disabled:opacity-20"><ArrowDown size={16} /></button>
            </li>)}
          </ol>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-white/10 p-3 text-sm leading-6 text-slate-300"><input type="checkbox" checked={currentDraft.confirmed} disabled={!hasListened || audioError || saving || storageBlocked} onChange={event => setDraft({ ...currentDraft, confirmed: event.target.checked })} className="mt-1 h-4 w-4 shrink-0 accent-amber-400" /><span>我已试听并确认此排序</span></label>
          <p role="status" className="mt-3 min-h-5 text-xs leading-5 text-slate-400">{!hasListened ? '请先播放音频' : audioError ? '请先恢复音频播放' : !currentDraft.confirmed ? `请确认从第 1 名到第 ${candidateCount} 名的顺序` : '可以保存评价'}</p>
          {!storageBlocked && error && <p role="alert" className="mt-3 text-sm leading-6 text-rose-300">{error}</p>}
          {notice && !error && <p role="status" className="mt-3 flex items-start gap-1.5 text-sm leading-6 text-emerald-300"><Check size={16} className="mt-1 shrink-0" />{notice}</p>}
          <button type="button" onClick={save} disabled={!canSave} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-amber-400 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-35"><Check size={17} />{session.currentIndex === dataset.cases.length - 1 ? '保存评价' : '保存并下一条'}</button>
          <div className="mt-4 grid grid-cols-2 gap-2"><button type="button" onClick={() => navigate(session.currentIndex - 1)} disabled={session.currentIndex === 0 || saving || unsaved || storageBlocked} className={actionClass}><ArrowLeft size={15} />上一条</button><button type="button" onClick={() => navigate(session.currentIndex + 1)} disabled={session.currentIndex === dataset.cases.length - 1 || saving || unsaved || storageBlocked} className={actionClass}>下一条<ArrowRight size={15} /></button></div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <button type="button" onClick={skip} disabled={saving || storageBlocked || review?.status === 'ranked'} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-25"><SkipForward size={14} />跳过本条</button>
            {unsaved && <button type="button" onClick={() => { setDraft({ caseKey, order: initialOrder, confirmed: false }); if (!storageBlocked) setError(''); }} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"><RotateCcw size={13} />恢复原顺序</button>}
          </div>
          {unsaved && <p className="mt-3 text-xs leading-5 text-amber-200/80">排序尚未保存。保存或恢复原顺序后可切换音频。</p>}
          <p className="mt-5 border-t border-white/10 pt-4 text-xs leading-5 text-slate-500">进度仅保存在当前浏览器，刷新可继续。分享时请导出 CSV。<br />评审编号：{session.reviewerId.slice(0, 8)}</p>
        </aside>
      </div>
    </main>
    </div>
  </div>;
}
