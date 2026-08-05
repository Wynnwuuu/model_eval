type DurationModelSource = {
  supportedDurations?: Array<string | number>;
  controls?: Array<{
    key: string;
    type: 'text' | 'number' | 'select' | 'toggle' | 'json';
    options?: string[];
  }>;
  options?: Record<string, any>;
};

export type ReferenceAudioDurationResolution = {
  valid: boolean;
  detectedSeconds: number;
  resolvedDuration?: number;
  continuous: boolean;
  error?: {
    code: string;
    message: string;
  };
};

export type AudioDurationProbeResult = {
  seconds?: number;
  error?: string;
};

type ProbeAudioDurationsOptions = {
  cache?: Map<string, number>;
  concurrency?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  probe?: (url: string, signal?: AbortSignal) => Promise<number>;
};

const AUDIO_DURATION_TOLERANCE_SECONDS = 0.15;

const numericOptions = (model: DurationModelSource) => {
  const fromModel = (model.supportedDurations || []).map(Number).filter(Number.isFinite);
  if (fromModel.length) return Array.from(new Set(fromModel)).sort((left, right) => left - right);
  const control = model.controls?.find(item => item.key === 'duration');
  return Array.from(new Set((control?.options || []).map(Number).filter(Number.isFinite)))
    .sort((left, right) => left - right);
};

const parameterSchemaProperties = (options: Record<string, any>) => {
  for (const candidate of [options.parameter_schema, options.params_schema, options.parameters_schema]) {
    if (candidate?.properties && typeof candidate.properties === 'object') return candidate.properties;
  }
  return {};
};

const firstFinite = (values: unknown[]) => {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
};

const continuousDurationBounds = (model: DurationModelSource) => {
  const options = model.options || {};
  const schema = parameterSchemaProperties(options).duration || {};
  return {
    minimum: firstFinite([
      schema.minimum,
      schema.min,
      options.duration_min,
      options.min_duration,
      options.minimum_duration,
    ]),
    maximum: firstFinite([
      schema.maximum,
      schema.max,
      options.duration_max,
      options.max_duration,
      options.maximum_duration,
    ]),
  };
};

const roundedMilliseconds = (value: number) => Math.round(value * 1000) / 1000;

export const resolveReferenceAudioDuration = (
  model: DurationModelSource,
  detectedSeconds: number,
  toleranceSeconds = AUDIO_DURATION_TOLERANCE_SECONDS,
): ReferenceAudioDurationResolution => {
  const detected = Number(detectedSeconds);
  if (!Number.isFinite(detected) || detected <= 0) {
    return {
      valid: false,
      detectedSeconds: detected,
      continuous: false,
      error: {
        code: 'UNKNOWN_AUDIO_DURATION',
        message: 'Reference audio duration is unavailable.',
      },
    };
  }

  const supported = numericOptions(model);
  if (supported.length) {
    const minimum = supported[0];
    const maximum = supported[supported.length - 1];
    if (detected < minimum - toleranceSeconds || detected > maximum + toleranceSeconds) {
      return {
        valid: false,
        detectedSeconds: roundedMilliseconds(detected),
        continuous: false,
        error: {
          code: 'AUDIO_DURATION_OUT_OF_RANGE',
          message: `Reference audio duration ${roundedMilliseconds(detected)}s is outside the supported range ${minimum}-${maximum}s.`,
        },
      };
    }

    const nearest = supported.reduce((best, candidate) =>
      Math.abs(candidate - detected) < Math.abs(best - detected) ? candidate : best);
    const resolvedDuration = Math.abs(nearest - detected) <= toleranceSeconds
      ? nearest
      : supported.find(candidate => candidate >= detected);
    if (resolvedDuration === undefined) {
      return {
        valid: false,
        detectedSeconds: roundedMilliseconds(detected),
        continuous: false,
        error: {
          code: 'AUDIO_DURATION_OUT_OF_RANGE',
          message: `No supported duration can contain ${roundedMilliseconds(detected)}s of reference audio.`,
        },
      };
    }
    return {
      valid: true,
      detectedSeconds: roundedMilliseconds(detected),
      resolvedDuration,
      continuous: false,
    };
  }

  const durationControl = model.controls?.find(item => item.key === 'duration');
  if (!durationControl || durationControl.type !== 'number') {
    return {
      valid: false,
      detectedSeconds: roundedMilliseconds(detected),
      continuous: false,
      error: {
        code: 'AUDIO_DURATION_NOT_SUPPORTED',
        message: 'The model does not expose a duration control that can follow reference audio.',
      },
    };
  }

  const { minimum, maximum } = continuousDurationBounds(model);
  if ((minimum !== undefined && detected < minimum - toleranceSeconds)
    || (maximum !== undefined && detected > maximum + toleranceSeconds)) {
    return {
      valid: false,
      detectedSeconds: roundedMilliseconds(detected),
      continuous: true,
      error: {
        code: 'AUDIO_DURATION_OUT_OF_RANGE',
        message: `Reference audio duration ${roundedMilliseconds(detected)}s is outside the supported model range.`,
      },
    };
  }

  const bounded = minimum !== undefined && Math.abs(detected - minimum) <= toleranceSeconds
    ? minimum
    : maximum !== undefined && Math.abs(detected - maximum) <= toleranceSeconds
      ? maximum
      : detected;
  return {
    valid: true,
    detectedSeconds: roundedMilliseconds(detected),
    resolvedDuration: roundedMilliseconds(bounded),
    continuous: true,
  };
};

export const probeBrowserAudioDuration = (url: string, signal?: AbortSignal) =>
  new Promise<number>((resolve, reject) => {
    if (typeof Audio === 'undefined') {
      reject(new Error('Audio metadata probing is unavailable in this runtime.'));
      return;
    }
    const audio = new Audio();
    audio.preload = 'metadata';

    const cleanup = () => {
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (callback: () => void) => {
      cleanup();
      audio.removeAttribute('src');
      audio.load();
      callback();
    };
    const onLoaded = () => {
      const seconds = Number(audio.duration);
      finish(() => Number.isFinite(seconds) && seconds > 0
        ? resolve(seconds)
        : reject(new Error('Audio metadata did not include a finite duration.')));
    };
    const onError = () => finish(() => reject(new Error('Failed to read audio metadata.')));
    const onAbort = () => finish(() => reject(new DOMException('Aborted', 'AbortError')));

    audio.addEventListener('loadedmetadata', onLoaded, { once: true });
    audio.addEventListener('error', onError, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    audio.src = url;
    audio.load();
  });

const probeWithTimeout = async (
  url: string,
  probe: (url: string, signal?: AbortSignal) => Promise<number>,
  timeoutMs: number,
  outerSignal?: AbortSignal,
) => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  outerSignal?.addEventListener('abort', abort, { once: true });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      probe(url, controller.signal),
      new Promise<number>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error(`Audio metadata probe timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    outerSignal?.removeEventListener('abort', abort);
  }
};

export const probeAudioDurations = async (
  urls: string[],
  options: ProbeAudioDurationsOptions = {},
): Promise<Record<string, AudioDurationProbeResult>> => {
  const uniqueUrls = Array.from(new Set(urls.map(url => String(url || '').trim()).filter(Boolean)));
  const results: Record<string, AudioDurationProbeResult> = {};
  const pending: string[] = [];
  for (const url of uniqueUrls) {
    const cached = options.cache?.get(url);
    if (cached !== undefined) results[url] = { seconds: cached };
    else if (!/^https?:\/\//i.test(url)) results[url] = { error: 'Reference audio must use a public HTTP(S) URL.' };
    else pending.push(url);
  }

  const probe = options.probe || probeBrowserAudioDuration;
  const timeoutMs = Math.max(1, options.timeoutMs || 12_000);
  const concurrency = Math.max(1, Math.min(options.concurrency || 4, pending.length || 1));
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < pending.length) {
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const url = pending[cursor];
      cursor += 1;
      try {
        const seconds = await probeWithTimeout(url, probe, timeoutMs, options.signal);
        if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Audio duration is invalid.');
        results[url] = { seconds };
        options.cache?.set(url, seconds);
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') throw error;
        results[url] = { error: error instanceof Error ? error.message : String(error) };
      }
    }
  });
  await Promise.all(workers);
  return results;
};
