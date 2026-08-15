import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, FileAudio, FileVideo, Image as ImageIcon, Loader2 } from 'lucide-react';
import { VIDEO_EXTENSIONS } from '../constants';
import { resolveMediaPlaybackCandidates } from '../mediaProxy';
import { resolvePlaybackUrl } from '../mediaUrlUtils';

export interface MediaRendererProps {
  url: string;
  label?: string;
  isActive: boolean;
  className?: string;
  onLoadStatusChange?: (isLoaded: boolean) => void;
  onPlaybackStateChange?: (isPlaying: boolean) => void;
  forceType?: 'image' | 'video' | 'audio' | string;
  videoPreload?: 'none' | 'metadata' | 'auto';
  compact?: boolean;
}

const REFERRER_POLICY_FALLBACKS = ['no-referrer', 'origin', 'unsafe-url'] as const;
type ReferrerPolicyOption = typeof REFERRER_POLICY_FALLBACKS[number];

const MEDIA_SOFT_TIMEOUT_MS = 7000;
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'svg'];

const detectMediaTypeFromUrl = (url: string): 'image' | 'video' | 'audio' | null => {
  const cleanUrl = url.trim().split('?')[0].split('#')[0].toLowerCase();
  const lowerUrl = url.toLowerCase();
  const decodedUrl = (() => {
    try {
      return decodeURIComponent(url).toLowerCase();
    } catch {
      return lowerUrl;
    }
  })();
  const typeHaystack = `${lowerUrl} ${decodedUrl}`;
  const endsWithAny = (extensions: string[]) => extensions.some(ext => cleanUrl.endsWith(`.${ext}`));

  if (
    endsWithAny(VIDEO_EXTENSIONS) ||
    VIDEO_EXTENSIONS.some(ext => decodedUrl.split('?')[0].split('#')[0].endsWith(`.${ext}`)) ||
    /\/videos?\//i.test(typeHaystack) ||
    /(?:^|[?&])(type|mediaType|outputType)=video(?:&|$)/i.test(typeHaystack)
  ) {
    return 'video';
  }

  if (
    endsWithAny(AUDIO_EXTENSIONS) ||
    AUDIO_EXTENSIONS.some(ext => decodedUrl.split('?')[0].split('#')[0].endsWith(`.${ext}`)) ||
    /\/audios?\//i.test(typeHaystack) ||
    /(?:^|[?&])(type|mediaType|outputType)=audio(?:&|$)/i.test(typeHaystack)
  ) {
    return 'audio';
  }

  if (
    endsWithAny(IMAGE_EXTENSIONS) ||
    IMAGE_EXTENSIONS.some(ext => decodedUrl.split('?')[0].split('#')[0].endsWith(`.${ext}`)) ||
    /\/images?\//i.test(typeHaystack) ||
    /(?:^|[?&])(type|mediaType|outputType)=image(?:&|$)/i.test(typeHaystack)
  ) {
    return 'image';
  }

  return null;
};

const inferMediaTypeFromUrl = (url: string): 'image' | 'video' | 'audio' =>
  detectMediaTypeFromUrl(url) || 'image';

const isForcedMediaType = (value?: string): value is 'image' | 'video' | 'audio' =>
  value === 'image' || value === 'video' || value === 'audio';

const MediaRenderer: React.FC<MediaRendererProps> = ({
  url,
  label,
  isActive,
  className = '',
  onLoadStatusChange,
  onPlaybackStateChange,
  forceType,
  videoPreload = 'auto',
  compact = false,
}) => {
  const sourceUrl = useMemo(() => resolvePlaybackUrl(url), [url]);
  const candidates = useMemo(() => resolveMediaPlaybackCandidates(sourceUrl || ''), [sourceUrl]);
  const candidateSignature = useMemo(
    () => candidates.map(candidate => `${candidate.kind}:${candidate.url}`).join('|'),
    [candidates]
  );
  const [candidateIndex, setCandidateIndex] = useState(0);
  const currentCandidate = candidates[Math.min(candidateIndex, Math.max(candidates.length - 1, 0))];
  const finalUrl = currentCandidate?.url || '';
  const originalUrl = candidates.find(candidate => candidate.kind === 'direct')?.url || finalUrl;
  const proxyCandidateIndex = candidates.findIndex(candidate => candidate.kind === 'proxy');
  const canUseProxy = proxyCandidateIndex >= 0 && proxyCandidateIndex !== candidateIndex;
  const canUseDirect = candidateIndex > 0 && Boolean(originalUrl);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [mediaType, setMediaType] = useState<'image' | 'video' | 'audio'>('image');
  const [retryKey, setRetryKey] = useState(0);
  const [referrerPolicyIdx, setReferrerPolicyIdx] = useState(0);
  const [softTimedOut, setSoftTimedOut] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  const onLoadStatusChangeRef = useRef(onLoadStatusChange);
  const activeRequestKeyRef = useRef('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const referrerPolicy: ReferrerPolicyOption = REFERRER_POLICY_FALLBACKS[referrerPolicyIdx];
  const hasMergedUrl = (finalUrl.match(/https?:\/\//g) || []).length > 1;
  const mediaRequestKey = useMemo(
    () => `${mediaType}::${finalUrl || ''}::${currentCandidate?.kind || 'none'}::${referrerPolicy}::${retryKey}`,
    [mediaType, finalUrl, currentCandidate?.kind, referrerPolicy, retryKey]
  );

  const isActiveRequest = useCallback((requestKey: string) => requestKey === activeRequestKeyRef.current, []);

  const inferCurrentMediaType = useCallback((candidateUrl: string) => {
    const detectedType = detectMediaTypeFromUrl(candidateUrl);
    if (isForcedMediaType(forceType)) {
      // Treat forceType as a hint: if URL clearly indicates audio/video, prefer URL type.
      if ((forceType === 'video' && detectedType === 'audio') || (forceType === 'audio' && detectedType === 'video')) {
        return detectedType;
      }
      return forceType;
    }
    return detectedType || 'image';
  }, [forceType]);

  const resetCurrentRequest = useCallback(() => {
    setLoading(true);
    setError(false);
    setErrorStatus(null);
    setSoftTimedOut(false);
    setReferrerPolicyIdx(0);
    setRetryKey(prev => prev + 1);
    onLoadStatusChangeRef.current?.(false);
  }, []);

  const switchToCandidate = useCallback((nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= candidates.length) return;
    setCandidateIndex(nextIndex);
    setMediaType(inferCurrentMediaType(candidates[nextIndex].url));
    resetCurrentRequest();
  }, [candidates, inferCurrentMediaType, resetCurrentRequest]);

  useEffect(() => {
    onLoadStatusChangeRef.current = onLoadStatusChange;
  }, [onLoadStatusChange]);

  useEffect(() => {
    setCandidateIndex(0);
    setReferrerPolicyIdx(0);
    setRetryKey(prev => prev + 1);
    setSoftTimedOut(false);
    setErrorStatus(null);
    setError(false);
    setMediaType(inferCurrentMediaType(candidates[0]?.url || ''));
  }, [candidateSignature, inferCurrentMediaType, candidates]);

  useEffect(() => {
    setMediaType(inferCurrentMediaType(finalUrl));
  }, [finalUrl, inferCurrentMediaType]);

  useEffect(() => {
    activeRequestKeyRef.current = mediaRequestKey;

    if (!finalUrl) {
      setLoading(false);
      setError(false);
      setErrorStatus(null);
      setSoftTimedOut(false);
      onLoadStatusChangeRef.current?.(true);
      return;
    }

    if (hasMergedUrl) {
      setLoading(false);
      setError(true);
      setErrorStatus(null);
      setSoftTimedOut(false);
      onLoadStatusChangeRef.current?.(true);
      return;
    }

    setLoading(true);
    setError(false);
    setErrorStatus(null);
    setSoftTimedOut(false);
    onLoadStatusChangeRef.current?.(false);
  }, [finalUrl, hasMergedUrl, mediaRequestKey]);

  const handleLoad = useCallback((requestKey: string) => {
    if (!isActiveRequest(requestKey)) return;

    setLoading(false);
    setError(false);
    setSoftTimedOut(false);
    onLoadStatusChangeRef.current?.(true);
  }, [isActiveRequest]);

  const handleError = (requestKey: string) => {
    if (!isActiveRequest(requestKey)) return;

    if (referrerPolicyIdx < REFERRER_POLICY_FALLBACKS.length - 1) {
      setReferrerPolicyIdx(prev => prev + 1);
      setLoading(true);
      setError(false);
      setErrorStatus(null);
      setSoftTimedOut(false);
      setRetryKey(prev => prev + 1);
      return;
    }

    if (candidateIndex < candidates.length - 1) {
      switchToCandidate(candidateIndex + 1);
      return;
    }

    setLoading(false);
    setError(true);
    setSoftTimedOut(false);
    setErrorStatus(mediaType === 'video'
      ? videoRef.current?.error?.code ?? null
      : mediaType === 'audio'
        ? audioRef.current?.error?.code ?? null
        : null);
    onLoadStatusChangeRef.current?.(true);
  };

  useEffect(() => {
    if (mediaType !== 'image' || error || !finalUrl) return;

    const image = imgRef.current;
    if (image?.complete && image.naturalWidth > 0) {
      handleLoad(mediaRequestKey);
    }
  }, [mediaType, finalUrl, mediaRequestKey, retryKey, referrerPolicyIdx, error, handleLoad]);

  useEffect(() => {
    if (mediaType !== 'video' || error || !loading) return;

    const markLoadedIfReady = () => {
      if (!isActiveRequest(mediaRequestKey)) return;
      const video = videoRef.current;
      if (video && video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        handleLoad(mediaRequestKey);
      }
    };

    const checks = [250, 1000, 3000].map(delay => window.setTimeout(markLoadedIfReady, delay));
    markLoadedIfReady();

    return () => {
      checks.forEach(window.clearTimeout);
    };
  }, [mediaType, finalUrl, mediaRequestKey, retryKey, error, loading, handleLoad, isActiveRequest]);

  useEffect(() => {
    if (!loading || error || !finalUrl) return;

    const requestKey = mediaRequestKey;
    const softTimeout = window.setTimeout(() => {
      if (!isActiveRequest(requestKey)) return;
      setSoftTimedOut(true);
    }, MEDIA_SOFT_TIMEOUT_MS);

    return () => window.clearTimeout(softTimeout);
  }, [loading, error, finalUrl, mediaType, mediaRequestKey, isActiveRequest]);

  const triggerRetry = () => {
    resetCurrentRequest();
  };

  const toggleMediaType = () => {
    setMediaType(prev => prev === 'image' ? 'video' : 'image');
    resetCurrentRequest();
  };

  if (!finalUrl) {
    return (
      <div className={`relative w-full h-full min-h-0 flex flex-col items-center justify-center bg-white/5 rounded-xl overflow-hidden border border-white/10 shadow-xl group ${className}`}>
        <AlertCircle className="w-10 h-10 mb-2 text-slate-500 shrink-0" />
        <p className="text-sm font-medium text-slate-400">链接为空</p>
      </div>
    );
  }

  const sourceLabel = currentCandidate?.kind === 'proxy' ? '代理加载' : '直连加载';

  return (
    <div className={`relative w-full h-full min-h-0 flex flex-col bg-black/40 rounded-xl overflow-hidden border border-white/10 shadow-xl group ${className}`}>
      {label && (
        <div className="absolute top-4 left-4 z-10 bg-black/60 backdrop-blur-md text-white px-3 py-1 rounded-full text-xs font-semibold tracking-wider border border-white/10 pointer-events-none">
          {label}
        </div>
      )}

      {loading && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/5 z-10">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <span className="text-xs text-slate-300">{sourceLabel}</span>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/5 text-slate-400 p-4 text-center overflow-y-auto z-20">
          <AlertCircle className="w-10 h-10 mb-2 text-red-400 shrink-0" />
          <p className="text-sm font-medium text-slate-300">
            {errorStatus ? `加载失败（浏览器媒体错误 ${errorStatus}）` : (hasMergedUrl ? '检测到多个链接被合并' : '加载失败')}
          </p>
          <p className="text-xs text-slate-500 mt-1 break-all max-w-full px-4 select-all">
            {hasMergedUrl
              ? '表格解析可能失败，多个列内容被合并到了同一个链接中。请检查上传文件的分隔符，建议使用逗号或制表符。'
              : `当前尝试：${sourceLabel}。链接：${finalUrl}`}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <button
              onClick={triggerRetry}
              className="px-3 py-1.5 bg-white/10 glass-panel-hover text-slate-200 rounded-lg text-xs font-medium transition-colors"
            >
              重试当前源
            </button>
            {canUseProxy && (
              <button
                onClick={() => switchToCandidate(proxyCandidateIndex)}
                className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-medium transition-colors"
              >
                使用代理加载
              </button>
            )}
            {canUseDirect && (
              <button
                onClick={() => switchToCandidate(0)}
                className="px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-medium transition-colors"
              >
                重新直连
              </button>
            )}
            <button
              onClick={toggleMediaType}
              className="px-3 py-1.5 bg-white/10 hover:bg-white/15 text-slate-200 border border-white/10 rounded-lg text-xs font-medium transition-colors"
            >
              尝试作为{mediaType === 'image' ? '视频' : '图片'}加载
            </button>
            <a
              href={originalUrl || finalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 rounded-lg text-xs font-medium transition-colors"
            >
              打开原链接
            </a>
          </div>
        </div>
      )}

      <div className="absolute inset-0 z-0 flex items-center justify-center bg-black/60 min-h-0">
        {mediaType === 'video' ? (
          <video
            key={`video-${mediaRequestKey}`}
            ref={videoRef}
            src={finalUrl || undefined}
            className={`w-full h-full object-contain object-center focus:outline-none ${loading ? 'opacity-0' : 'opacity-100'}`}
            controls
            autoPlay={isActive}
            loop
            preload={videoPreload}
            playsInline
            referrerPolicy={referrerPolicy}
            onLoadedMetadata={() => handleLoad(mediaRequestKey)}
            onLoadedData={() => handleLoad(mediaRequestKey)}
            onCanPlay={() => handleLoad(mediaRequestKey)}
            onCanPlayThrough={() => handleLoad(mediaRequestKey)}
            onPlaying={() => handleLoad(mediaRequestKey)}
            onPlay={() => onPlaybackStateChange?.(true)}
            onPause={() => onPlaybackStateChange?.(false)}
            onEnded={() => onPlaybackStateChange?.(false)}
            onError={() => handleError(mediaRequestKey)}
            onKeyDown={(event) => event.stopPropagation()}
          />
        ) : mediaType === 'audio' ? (
          <div className={`flex h-full w-full flex-col items-center justify-center ${compact ? 'gap-2 p-2' : 'gap-4 p-6'}`}>
            <FileAudio className={`${compact ? 'h-6 w-6' : 'h-14 w-14'} text-amber-300`} />
            <audio
              key={`audio-${mediaRequestKey}`}
              ref={audioRef}
              src={finalUrl || undefined}
              className="w-full max-w-xl"
              controls
              autoPlay={isActive}
              preload={videoPreload}
              referrerPolicy={referrerPolicy}
              onLoadedMetadata={() => handleLoad(mediaRequestKey)}
              onLoadedData={() => handleLoad(mediaRequestKey)}
              onCanPlay={() => handleLoad(mediaRequestKey)}
              onCanPlayThrough={() => handleLoad(mediaRequestKey)}
              onPlaying={() => handleLoad(mediaRequestKey)}
              onPlay={() => onPlaybackStateChange?.(true)}
              onPause={() => onPlaybackStateChange?.(false)}
              onEnded={() => onPlaybackStateChange?.(false)}
              onError={() => handleError(mediaRequestKey)}
              onKeyDown={(event) => event.stopPropagation()}
            />
          </div>
        ) : (
          <img
            key={`img-${mediaRequestKey}`}
            ref={imgRef}
            src={finalUrl || undefined}
            alt={label || ''}
            className={`w-full h-full object-contain object-center ${loading ? 'opacity-0' : 'opacity-100'}`}
            referrerPolicy={referrerPolicy}
            onLoad={() => handleLoad(mediaRequestKey)}
            onError={() => handleError(mediaRequestKey)}
          />
        )}
      </div>

      {softTimedOut && !error && (
        <div className="absolute left-3 bottom-3 right-12 z-20 rounded-lg border border-amber-400/30 bg-black/70 px-3 py-2 text-xs text-amber-100 shadow-lg backdrop-blur-sm">
          <div className="mb-2">媒体仍在加载。可继续等待、打开原链接核对，或切换到代理加载。</div>
          <div className="flex flex-wrap gap-2">
            {canUseProxy && (
              <button
                onClick={() => switchToCandidate(proxyCandidateIndex)}
                className="rounded border border-amber-300/30 bg-amber-400/15 px-2 py-1 text-amber-100 hover:bg-amber-400/25"
              >
                使用代理加载
              </button>
            )}
            {canUseDirect && (
              <button
                onClick={() => switchToCandidate(0)}
                className="rounded border border-emerald-300/30 bg-emerald-400/15 px-2 py-1 text-emerald-100 hover:bg-emerald-400/25"
              >
                重新直连
              </button>
            )}
            <button
              onClick={triggerRetry}
              className="rounded border border-white/10 bg-white/10 px-2 py-1 text-slate-100 hover:bg-white/15"
            >
              重试
            </button>
            <a
              href={originalUrl || finalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-blue-300/30 bg-blue-400/15 px-2 py-1 text-blue-100 hover:bg-blue-400/25"
            >
              打开原链接
            </a>
          </div>
        </div>
      )}

      <div className={`absolute z-20 bg-black/40 backdrop-blur-sm rounded-lg text-white/70 pointer-events-none ${compact ? 'bottom-2 right-2 p-1' : 'bottom-4 right-4 p-1.5'}`}>
        {mediaType === 'video' ? <FileVideo size={16} /> : mediaType === 'audio' ? <FileAudio size={16} /> : <ImageIcon size={16} />}
      </div>
    </div>
  );
};

export default MediaRenderer;
