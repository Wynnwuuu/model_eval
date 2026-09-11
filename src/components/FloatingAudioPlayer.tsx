import { useEffect, useRef, useState, type RefObject } from 'react';
import { ChevronLeft, Headphones, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';

type Props = {
  audioRef: RefObject<HTMLAudioElement | null>;
  sourceKey: string;
  src: string;
  index: number;
  total: number;
  durationSeconds: number;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  error: boolean;
  onPlaying: () => void;
  onError: () => void;
  onRetry: () => void;
};

const clock = (seconds: number) => {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(safe / 60).toString().padStart(2, '0')}:${(safe % 60).toString().padStart(2, '0')}`;
};

export default function FloatingAudioPlayer({ audioRef, sourceKey, src, index, total, durationSeconds, expanded, onExpandedChange, error, onPlaying, onError, onRetry }: Props) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const activeSource = useRef(sourceKey);
  activeSource.current = sourceKey;
  const toggleRef = useRef<HTMLButtonElement>(null);
  const isCurrent = () => activeSource.current === sourceKey;

  useEffect(() => {
    const audio = audioRef.current;
    setPlaying(false); setCurrentTime(0); setDuration(0);
    if (audio) { audio.volume = volume; audio.muted = muted; }
    return () => { audio?.pause(); };
  }, [sourceKey, audioRef]);

  const start = () => {
    const audio = audioRef.current;
    if (!audio || error) return;
    void audio.play().catch(cause => {
      // Pausing or changing the source may intentionally cancel a pending play.
      if (isCurrent() && cause?.name !== 'AbortError') onError();
    });
  };
  const togglePlayback = () => {
    if (!audioRef.current?.paused) audioRef.current?.pause();
    else start();
  };
  const collapse = () => { onExpandedChange(false); toggleRef.current?.focus(); };
  const totalTime = duration || durationSeconds;
  const playbackLabel = playing ? '暂停音频' : '播放音频';
  const PlayIcon = playing ? Pause : Play;

  return <aside
    aria-label="悬浮音频播放器" data-testid="floating-audio-player" data-expanded={expanded}
    className="audio-rail" onKeyDown={event => { if (event.key === 'Escape' && expanded) { event.preventDefault(); collapse(); } }}
  >
    <audio
      ref={audioRef} key={sourceKey} src={src} preload="metadata" aria-label={`音频 ${index}`} hidden
      onLoadedMetadata={event => { if (isCurrent()) setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0); }}
      onDurationChange={event => { if (isCurrent()) setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0); }}
      onTimeUpdate={event => { if (isCurrent()) setCurrentTime(event.currentTarget.currentTime); }}
      onPlay={() => { if (isCurrent()) setPlaying(true); }}
      onPlaying={() => { if (isCurrent()) { setPlaying(true); onPlaying(); } }}
      onPause={() => { if (isCurrent()) setPlaying(false); }}
      onEnded={() => { if (isCurrent()) setPlaying(false); }}
      onError={() => { if (isCurrent()) { setPlaying(false); onError(); } }}
      onVolumeChange={event => { if (isCurrent()) { setVolume(event.currentTarget.volume); setMuted(event.currentTarget.muted); } }}
    />

    <div className={expanded ? 'flex items-center justify-between gap-3' : 'flex flex-col items-center gap-2'}>
      {expanded && <div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300"><Headphones size={18} aria-hidden="true" /></span><div><p className="text-[11px] text-slate-400">当前音频</p><p className="text-sm font-bold tabular-nums text-slate-100">{index} <span className="font-normal text-slate-500">/ {total}</span></p></div></div>}
      <button
        ref={toggleRef} type="button" aria-label={expanded ? '收起音频栏' : '展开音频栏'} title={expanded ? '收起音频栏' : '展开音频栏'}
        aria-expanded={expanded} aria-controls="audio-player-controls" onClick={() => onExpandedChange(!expanded)}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-300 transition hover:bg-white/10 hover:text-white"
      >{expanded ? <ChevronLeft size={20} aria-hidden="true" /> : <Headphones size={21} className={error ? 'text-rose-300' : 'text-amber-300'} aria-hidden="true" />}</button>
      {!expanded && <><span className="text-[10px] tabular-nums text-slate-400">{index}/{total}</span><button type="button" aria-label={playbackLabel} title={playbackLabel} disabled={error} onClick={togglePlayback} className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400 text-slate-950 transition hover:bg-amber-300 disabled:opacity-35"><PlayIcon size={18} fill="currentColor" aria-hidden="true" /></button>{error && <span className="text-[10px] text-rose-300">加载失败</span>}</>}
    </div>

    {expanded && <div id="audio-player-controls" className="mt-5">
      <div className="flex items-center gap-3">
        <button type="button" aria-label={playbackLabel} disabled={error} onClick={togglePlayback} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-amber-400 text-sm font-bold text-slate-950 transition hover:bg-amber-300 disabled:opacity-35"><PlayIcon size={17} fill="currentColor" aria-hidden="true" />{playing ? '暂停' : '播放音频'}</button>
        <button type="button" aria-label="从头播放" title="从头播放" disabled={!duration || error} onClick={() => { if (audioRef.current) { audioRef.current.currentTime = 0; setCurrentTime(0); start(); } }} className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/15 text-slate-300 transition hover:bg-white/10 disabled:opacity-35"><RotateCcw size={18} aria-hidden="true" /></button>
      </div>
      <div className="mt-4">
        <input type="range" aria-label="音频播放进度" min={0} max={totalTime} step={0.1} value={Math.min(currentTime, totalTime)} disabled={!duration || error}
          aria-valuetext={`${clock(currentTime)}，共 ${clock(totalTime)}`}
          onChange={event => { const time = Number(event.target.value); if (audioRef.current && duration) { audioRef.current.currentTime = time; setCurrentTime(time); } }}
          className="audio-range h-6 w-full cursor-pointer accent-amber-400 disabled:cursor-not-allowed disabled:opacity-35" />
        <div className="flex justify-between font-mono text-[11px] tabular-nums text-slate-400"><span>{clock(currentTime)}</span><span>{clock(totalTime)}</span></div>
      </div>
      <div className="mt-4 flex items-center gap-2 border-t border-white/10 pt-3">
        <button type="button" aria-label={muted || volume === 0 ? '取消静音' : '静音'} title={muted || volume === 0 ? '取消静音' : '静音'} onClick={() => { const audio = audioRef.current; if (!audio) return; if (audio.muted || audio.volume === 0) { audio.muted = false; if (!audio.volume) audio.volume = 1; } else audio.muted = true; }} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-slate-200">{muted || !volume ? <VolumeX size={17} aria-hidden="true" /> : <Volume2 size={17} aria-hidden="true" />}</button>
        <input type="range" aria-label="音量" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={event => { const audio = audioRef.current; if (audio) { audio.volume = Number(event.target.value); audio.muted = false; } }} className="audio-range h-6 min-w-0 flex-1 cursor-pointer accent-slate-400" />
      </div>
      {error ? <p role="alert" className="mt-3 text-xs leading-5 text-rose-200">音频加载失败，请<button type="button" className="ml-1 underline underline-offset-4" onClick={() => { setPlaying(false); setCurrentTime(0); setDuration(0); onRetry(); }}>重试加载</button>。</p>
        : <p className="mt-2 text-[11px] leading-5 text-slate-500">边听边读，随时重听。收起后继续播放。</p>}
    </div>}
  </aside>;
}
