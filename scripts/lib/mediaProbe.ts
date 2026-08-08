import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import type { GenerationMediaKind } from '../../src/features/generation/mediaValidation.ts';

const execFileAsync = promisify(execFile);

export interface MediaProbeInput {
  url: string;
  expectedKinds: GenerationMediaKind[];
}

export interface MediaProbeResult {
  url: string;
  expectedKinds: GenerationMediaKind[];
  http: {
    ok: boolean;
    status?: number;
    finalUrl?: string;
    contentType?: string;
    contentLength?: number;
    error?: string;
  };
  decode: {
    ok: boolean;
    error?: string;
    formatName?: string;
    duration?: number;
    size?: number;
    streams: Array<{
      kind: string;
      codec?: string;
      width?: number;
      height?: number;
      sampleRate?: number;
      channels?: number;
      duration?: number;
    }>;
  };
  audioMetrics?: {
    silenceSeconds?: number;
    silenceRatio?: number;
    peakDb?: number;
    rmsDb?: number;
    error?: string;
  };
  previewPath?: string;
  audioPreviewPath?: string;
}

const finiteNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const isPrivateIpv4 = (hostname: string) => {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = parts;
  return first === 0
    || first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
};

export const getMediaProbeUrlRejection = (value: string) => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 'relative_or_non_http_url';
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return 'relative_or_non_http_url';
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname
    || hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || !hostname.includes('.')
    || isPrivateIpv4(hostname)
    || hostname === '::1'
    || hostname.startsWith('fe80:')
    || /^f[cd][0-9a-f]{2}:/i.test(hostname)) {
    return 'non_public_media_url';
  }
  return undefined;
};

const boundedError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https?:\/\/\S+/g, '[media-url]').slice(0, 500);
};

const fetchHeaders = async (url: string): Promise<MediaProbeResult['http']> => {
  const rejection = getMediaProbeUrlRejection(url);
  if (rejection) return { ok: false, error: rejection };
  const request = async (method: 'HEAD' | 'GET') => {
    const response = await fetch(url, {
      method,
      redirect: 'follow',
      headers: method === 'GET' ? { Range: 'bytes=0-65535' } : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    if (method === 'GET') await response.body?.cancel();
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      contentType: response.headers.get('content-type') || undefined,
      contentLength: finiteNumber(response.headers.get('content-length')),
    };
  };
  try {
    const head = await request('HEAD');
    if (head.ok && head.contentType) return head;
    return await request('GET');
  } catch (error) {
    try {
      return await request('GET');
    } catch (fallbackError) {
      return { ok: false, error: boundedError(fallbackError || error) };
    }
  }
};

const ffprobe = async (url: string): Promise<MediaProbeResult['decode']> => {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=format_name,duration,size:stream=codec_type,codec_name,width,height,sample_rate,channels,duration',
      '-of', 'json',
      url,
    ], {
      timeout: 40_000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout);
    const streams = Array.isArray(parsed.streams) ? parsed.streams.map((stream: Record<string, unknown>) => ({
      kind: String(stream.codec_type || 'unknown'),
      codec: stream.codec_name ? String(stream.codec_name) : undefined,
      width: finiteNumber(stream.width),
      height: finiteNumber(stream.height),
      sampleRate: finiteNumber(stream.sample_rate),
      channels: finiteNumber(stream.channels),
      duration: finiteNumber(stream.duration),
    })) : [];
    return {
      ok: streams.length > 0,
      formatName: parsed.format?.format_name ? String(parsed.format.format_name) : undefined,
      duration: finiteNumber(parsed.format?.duration),
      size: finiteNumber(parsed.format?.size),
      streams,
      ...(!streams.length ? { error: 'ffprobe_returned_no_streams' } : {}),
    };
  } catch (error) {
    return { ok: false, error: boundedError(error), streams: [] };
  }
};

const parseAudioMetrics = (stderr: string, duration?: number): MediaProbeResult['audioMetrics'] => {
  const starts = Array.from(stderr.matchAll(/silence_start:\s*([\d.]+)/g)).map(match => Number(match[1]));
  const ends = Array.from(stderr.matchAll(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g))
    .map(match => ({ end: Number(match[1]), duration: Number(match[2]) }));
  let silenceSeconds = ends.reduce((sum, entry) => sum + (Number.isFinite(entry.duration) ? entry.duration : 0), 0);
  if (starts.length > ends.length && duration && Number.isFinite(starts.at(-1))) {
    silenceSeconds += Math.max(0, duration - (starts.at(-1) || 0));
  }
  const peaks = Array.from(stderr.matchAll(/Peak level dB:\s*(-?(?:inf|[\d.]+))/gi))
    .map(match => match[1].toLowerCase() === '-inf' ? -Infinity : Number(match[1]))
    .filter(value => !Number.isNaN(value));
  const rms = Array.from(stderr.matchAll(/RMS level dB:\s*(-?(?:inf|[\d.]+))/gi))
    .map(match => match[1].toLowerCase() === '-inf' ? -Infinity : Number(match[1]))
    .filter(value => !Number.isNaN(value));
  return {
    silenceSeconds,
    ...(duration && duration > 0 ? { silenceRatio: Math.min(1, silenceSeconds / duration) } : {}),
    ...(peaks.length ? { peakDb: Math.max(...peaks) } : {}),
    ...(rms.length ? { rmsDb: Math.max(...rms) } : {}),
  };
};

const analyzeAudio = async (url: string, duration?: number): Promise<MediaProbeResult['audioMetrics']> => {
  try {
    const { stderr } = await execFileAsync('ffmpeg', [
      '-hide_banner', '-nostats', '-i', url,
      '-af', 'silencedetect=noise=-50dB:d=0.5,astats=metadata=1:reset=0',
      '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null',
    ], {
      timeout: 90_000,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    return parseAudioMetrics(stderr, duration);
  } catch (error: any) {
    const stderr = String(error?.stderr || '');
    if (stderr) return { ...parseAudioMetrics(stderr, duration), error: boundedError(error) };
    return { error: boundedError(error) };
  }
};

const createPreview = async (
  url: string,
  kinds: GenerationMediaKind[],
  decode: MediaProbeResult['decode'],
  previewDir: string,
) => {
  if (!decode.ok) return undefined;
  mkdirSync(previewDir, { recursive: true });
  const stem = createHash('sha256').update(url).digest('hex').slice(0, 20);
  const hasVideo = decode.streams.some(stream => stream.kind === 'video');
  const hasAudio = decode.streams.some(stream => stream.kind === 'audio');
  const renderAudio = kinds.includes('audio') && hasAudio && !kinds.includes('image');
  const output = resolve(previewDir, `${stem}.${renderAudio ? 'png' : 'jpg'}`);
  try {
    const args = renderAudio
      ? [
          '-y', '-hide_banner', '-loglevel', 'error', '-i', url,
          '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=640x120:colors=white',
          '-frames:v', '1', output,
        ]
      : hasVideo
        ? [
            '-y', '-hide_banner', '-loglevel', 'error', '-i', url,
            '-vf', 'scale=320:-2', '-frames:v', '1', output,
          ]
        : [];
    if (!args.length) return undefined;
    await execFileAsync('ffmpeg', args, {
      timeout: 60_000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    return output;
  } catch {
    return undefined;
  }
};

const runPool = async <T, R>(
  inputs: T[],
  concurrency: number,
  worker: (input: T, index: number) => Promise<R>,
) => {
  const results = new Array<R>(inputs.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
    while (nextIndex < inputs.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(inputs[index], index);
    }
  });
  await Promise.all(runners);
  return results;
};

export const probeMediaInputs = async (
  inputs: MediaProbeInput[],
  options: {
    concurrency?: number;
    previewDir: string;
    onProgress?: (completed: number, total: number) => void;
  },
) => {
  let completed = 0;
  return runPool(inputs, options.concurrency || 6, async input => {
    const rejection = getMediaProbeUrlRejection(input.url);
    if (rejection) {
      completed += 1;
      options.onProgress?.(completed, inputs.length);
      return {
        url: input.url,
        expectedKinds: input.expectedKinds,
        http: { ok: false, error: rejection },
        decode: { ok: false, error: rejection, streams: [] },
      } satisfies MediaProbeResult;
    }
    const [http, decode] = await Promise.all([fetchHeaders(input.url), ffprobe(input.url)]);
    const hasAudio = decode.streams.some(stream => stream.kind === 'audio');
    const audioMetrics = input.expectedKinds.includes('audio') && hasAudio
      ? await analyzeAudio(input.url, decode.duration)
      : undefined;
    const previewPath = await createPreview(input.url, input.expectedKinds, decode, options.previewDir);
    completed += 1;
    options.onProgress?.(completed, inputs.length);
    return {
      url: input.url,
      expectedKinds: input.expectedKinds,
      http,
      decode,
      ...(audioMetrics ? { audioMetrics } : {}),
      ...(previewPath ? { previewPath } : {}),
    } satisfies MediaProbeResult;
  });
};
