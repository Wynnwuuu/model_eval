import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle, FileVideo, Image as ImageIcon, Loader2 } from 'lucide-react';
import { VIDEO_EXTENSIONS } from '../constants';
import { normalizeUrl } from '../utils';

interface MediaRendererProps {
  url: string;
  label?: string;
  isActive: boolean;
  className?: string;
  onLoadStatusChange?: (isLoaded: boolean) => void;
  forceType?: 'image' | 'video' | string;
  videoPreload?: 'none' | 'metadata' | 'auto';
}

// Some CDNs reject the request based on the Referer header (hotlink protection).
// On Firebase Hosting (or any non-localhost deploy) the page origin gets sent as
// Referer with the default "origin" policy and the CDN returns 403. We try a
// sequence of referrer policies and only show an error if all of them fail.
// Order matters: most "anti-leech" rules allow empty referer (direct link
// scenario), so `no-referrer` is tried first.
const REFERRER_POLICY_FALLBACKS = ['no-referrer', 'origin', 'unsafe-url'] as const;
type ReferrerPolicyOption = typeof REFERRER_POLICY_FALLBACKS[number];
const MEDIA_SOFT_TIMEOUT_MS = 12000;

const withRetryToken = (url: string, retryToken: number): string => {
  if (!url || retryToken === 0 || url.startsWith('data:') || url.startsWith('blob:')) {
    return url;
  }

  try {
    const parsed = new URL(url);
    parsed.searchParams.set('evaltrack_retry', String(retryToken));
    return parsed.toString();
  } catch {
    return `${url}${url.includes('?') ? '&' : '?'}evaltrack_retry=${retryToken}`;
  }
};

const MediaRenderer: React.FC<MediaRendererProps> = ({ url, label, isActive, className = '', onLoadStatusChange, forceType, videoPreload = 'auto' }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image');

  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const onLoadStatusChangeRef = useRef(onLoadStatusChange);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [retryToken, setRetryToken] = useState(0);
  const [referrerPolicyIdx, setReferrerPolicyIdx] = useState(0);
  const [softTimedOut, setSoftTimedOut] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const referrerPolicy: ReferrerPolicyOption = REFERRER_POLICY_FALLBACKS[referrerPolicyIdx];
  const finalUrl = normalizeUrl(url);
  const mediaSrc = blobUrl || withRetryToken(finalUrl, retryToken);

  useEffect(() => {
    onLoadStatusChangeRef.current = onLoadStatusChange;
  }, [onLoadStatusChange]);

  // Simple heuristic to detect type from URL extension
  useEffect(() => {
    setLoading(true);
    setError(false);
    setErrorStatus(null);
    setRetryToken(0);
    setSoftTimedOut(false);
    setBlobUrl(null); // Reset blob url on new url
    setReferrerPolicyIdx(0); // Restart referrer policy fallback chain on new url
    onLoadStatusChangeRef.current?.(false);
    
    // Reset based on URL change
    const cleanUrl = finalUrl.trim().split('?')[0].split('#')[0].toLowerCase();
    const isVideoExt = VIDEO_EXTENSIONS.some(ext => cleanUrl.endsWith(`.${ext}`));

    // If normalization could not recover a merged URL, fail visibly but do not
    // block the evaluator from continuing.
    const httpCount = (finalUrl.match(/https?:\/\//g) || []).length;
    if (httpCount > 1) {
      setError(true);
      setLoading(false);
      onLoadStatusChangeRef.current?.(true);
      return;
    }

    if (isVideoExt) {
      setMediaType('video');
      return;
    }

    if (forceType === 'video' || forceType === 'image') {
      setMediaType(forceType);
      return;
    }

    setMediaType('image');
  }, [url, forceType]);

  // Cleanup blob URL when url changes or component unmounts
  useEffect(() => {
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [url, blobUrl]);

  const handleLoad = () => {
    setLoading(false);
    setError(false);
    setSoftTimedOut(false);
    onLoadStatusChangeRef.current?.(true);
  };

  useEffect(() => {
    if (mediaType !== 'image' || error || !mediaSrc) return;

    const image = imgRef.current;
    if (image?.complete && image.naturalWidth > 0) {
      handleLoad();
    }
  }, [mediaType, mediaSrc, retryKey, referrerPolicyIdx, error]);

  useEffect(() => {
    if (mediaType !== 'video' || error || !loading) return;

    const markLoadedIfReady = () => {
      const video = videoRef.current;
      if (video && video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        handleLoad();
      }
    };

    const checks = [250, 1000, 3000].map(delay => window.setTimeout(markLoadedIfReady, delay));

    markLoadedIfReady();

    return () => {
      checks.forEach(window.clearTimeout);
    };
  }, [mediaType, mediaSrc, retryKey, error, loading]);

  useEffect(() => {
    if (!loading || error || !finalUrl) return;

    const softTimeout = window.setTimeout(() => {
      // Some remote image/video hosts keep the media request pending for a long
      // time or never fire canplay/load in embedded contexts. Keep the media
      // element alive, but do not block voting forever.
      setSoftTimedOut(true);
      setLoading(false);
      onLoadStatusChangeRef.current?.(true);
    }, MEDIA_SOFT_TIMEOUT_MS);

    return () => window.clearTimeout(softTimeout);
  }, [loading, error, finalUrl, mediaSrc, mediaType]);

  const handleError = () => {
    // Try the next referrer policy before giving up. This handles CDN hotlink
    // protection differences between local dev (often allowed) and deployed
    // origins (e.g. Firebase Hosting domains not in the CDN whitelist).
    if (referrerPolicyIdx < REFERRER_POLICY_FALLBACKS.length - 1) {
      setReferrerPolicyIdx(prev => prev + 1);
      setLoading(true);
      setError(false);
      setErrorStatus(null);
      setSoftTimedOut(false);
      setRetryKey(prev => prev + 1);
      return;
    }
    setLoading(false);
    setError(true);
    setSoftTimedOut(false);
    setErrorStatus(mediaType === 'video' ? videoRef.current?.error?.code ?? null : null);
    onLoadStatusChangeRef.current?.(true); // Treat error as loaded so user can still vote if it fails
  };

  const triggerRetry = () => {
    setLoading(true);
    setError(false);
    setErrorStatus(null);
    setSoftTimedOut(false);
    setBlobUrl(null);
    setRetryToken(Date.now());
    setReferrerPolicyIdx(0);
    onLoadStatusChangeRef.current?.(false);
    setRetryKey(prev => prev + 1);
  };

  if (!finalUrl) {
    return (
      <div className={`relative w-full h-full min-h-0 flex flex-col items-center justify-center bg-white/5 rounded-xl overflow-hidden border border-white/10 shadow-xl group ${className}`}>
        <AlertCircle className="w-10 h-10 mb-2 text-slate-500 shrink-0" />
        <p className="text-sm font-medium text-slate-400">链接为空</p>
      </div>
    );
  }

  return (
    <div className={`relative w-full h-full min-h-0 flex flex-col bg-black/40 rounded-xl overflow-hidden border border-white/10 shadow-xl group ${className}`}>
      {/* Label Badge */}
      {label && (
        <div className="absolute top-4 left-4 z-10 bg-black/60 backdrop-blur-md text-white px-3 py-1 rounded-full text-xs font-semibold tracking-wider border border-white/10 pointer-events-none">
          {label}
        </div>
      )}

      {/* Loading State */}
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/5 z-10">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/5 text-slate-400 p-4 text-center overflow-y-auto z-20">
          <AlertCircle className="w-10 h-10 mb-2 text-red-400 shrink-0" />
          <p className="text-sm font-medium text-slate-300">
            {errorStatus ? `加载失败（浏览器媒体错误 ${errorStatus}）` : ((finalUrl.match(/https?:\/\//g) || []).length > 1 ? '检测到多个链接合并' : '加载失败')}
          </p>
          <p className="text-xs text-slate-500 mt-1 break-all max-w-full px-4 select-all">
            {errorStatus
              ? '已自动尝试 no-referrer / origin / unsafe-url 三种 Referrer 策略仍失败。常见原因：CDN 防盗链未放行当前部署域名、链接已签名过期、服务器不支持浏览器嵌入播放，或资源响应格式不符合图片/视频标签要求。'
              : ((finalUrl.match(/https?:\/\//g) || []).length > 1
                ? '您的表格解析失败，导致多个列的内容被合并到了一个链接中。请检查上传文件的分隔符（建议使用逗号或制表符）。'
                : (finalUrl ? `尝试加载的链接: ${finalUrl}` : '链接为空'))}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <button 
              onClick={triggerRetry}
              className="px-3 py-1.5 bg-white/10 glass-panel-hover text-slate-200 rounded-lg text-xs font-medium transition-colors"
            >
              重试
            </button>
            <button 
              onClick={() => {
                setMediaType(mediaType === 'image' ? 'video' : 'image');
                setLoading(true);
                setError(false);
                setErrorStatus(null);
                setSoftTimedOut(false);
                setRetryToken(Date.now());
                setReferrerPolicyIdx(0);
                onLoadStatusChangeRef.current?.(false);
                setRetryKey(prev => prev + 1);
              }}
              className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30 rounded-lg text-xs font-medium transition-colors"
            >
              尝试作为{mediaType === 'image' ? '视频' : '图片'}加载
            </button>
            <a 
              href={finalUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 rounded-lg text-xs font-medium transition-colors"
            >
              在新标签页打开
            </a>
          </div>
        </div>
      )}

      {/* Media Content */}
      <div className="absolute inset-0 z-0 flex items-center justify-center bg-black/60 min-h-0">
        {mediaType === 'video' ? (
          <video
            key={`video-${retryKey}-${retryToken}-${referrerPolicyIdx}-${blobUrl ? 'blob' : 'url'}`}
            ref={videoRef}
            src={mediaSrc || undefined}
            className={`w-full h-full object-contain object-center focus:outline-none ${loading ? 'opacity-0' : 'opacity-100'}`}
            controls
            autoPlay={isActive}
            loop
            muted
            preload={videoPreload}
            playsInline // Critical for iOS/Mobile to prevent detached player refresh issues
            referrerPolicy={referrerPolicy}
            onLoadedMetadata={handleLoad}
            onLoadedData={handleLoad}
            onCanPlay={handleLoad}
            onCanPlayThrough={handleLoad}
            onPlaying={handleLoad}
            onError={handleError}
            onKeyDown={(e) => e.stopPropagation()} // Prevent video shortcuts from interfering with app voting
          />
        ) : (
          <img
            key={`img-${retryKey}-${retryToken}-${referrerPolicyIdx}`}
            ref={imgRef}
            src={mediaSrc || undefined}
            alt={label}
            className={`w-full h-full object-contain object-center ${loading ? 'opacity-0' : 'opacity-100'}`}
            referrerPolicy={referrerPolicy}
            onLoad={handleLoad}
            onError={handleError}
          />
        )}
      </div>

      {softTimedOut && !error && (
        <div className="absolute left-3 bottom-3 right-12 z-20 rounded-lg border border-amber-400/30 bg-black/70 px-3 py-2 text-xs text-amber-100 shadow-lg backdrop-blur-sm">
          资源响应较慢，已允许继续评测；媒体仍会在加载完成后自动显示。
        </div>
      )}

      {/* Type Indicator (Bottom Right) */}
      <div className="absolute bottom-4 right-4 z-20 bg-black/40 backdrop-blur-sm p-1.5 rounded-lg text-white/70 pointer-events-none">
        {mediaType === 'video' ? <FileVideo size={16} /> : <ImageIcon size={16} />}
      </div>
    </div>
  );
};

export default MediaRenderer;
