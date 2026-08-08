import { serverConfig } from '../config.ts';
import {
  normalizeAionModelConfig,
  type NormalizedGenerationModel,
} from './generationPlanning.ts';

type FetchLike = typeof fetch;
export type AionExecutionTransport = 'model_api' | 'task_worker';
type GenerationModality = 'image' | 'video';

const TASK_WORKER_FIELDS: Record<GenerationModality, string[]> = {
  image: ['model_name', 'prompt', 'image_urls', 'aspect_ratio', 'resolution', 'caption'],
  video: [
    'model_name',
    'prompt',
    'image_urls',
    'aspect_ratio',
    'resolution',
    'duration',
    'generate_audio',
    'audio_url',
    'audios',
    'video_url',
    'video_urls',
    'reference_video_urls',
    'generation_type',
    'elements',
    'multi_shot',
    'multi_prompt',
    'avatar_params',
    'caption',
  ],
};

const encodeMediaPath = (value: string) =>
  value.split('/').filter(Boolean).map(part => {
    try {
      return encodeURIComponent(decodeURIComponent(part));
    } catch {
      return encodeURIComponent(part);
    }
  }).join('/');

export type AionUserAssetOptions = {
  mediaType: GenerationModality;
  expectedUserId: string;
  imageBaseUrl?: string;
  videoBaseUrl?: string;
};

const encodeTrustedAssetTail = (value: string) => {
  const segments = value.split('/');
  if (!segments.length || segments.some(segment => !segment)) return undefined;
  const encoded: string[] = [];
  for (const segment of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return undefined;
    }
    if (!decoded || decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0')) {
      return undefined;
    }
    encoded.push(encodeURIComponent(decoded));
  }
  return encoded.join('/');
};

export const aionUserAssetPathToUrl = (
  rawValue: string,
  options: AionUserAssetOptions,
) => {
  const value = String(rawValue || '').trim();
  const expectedUserId = String(options.expectedUserId || '').trim();
  if (!value || !expectedUserId) return undefined;

  const assetDirectory = options.mediaType === 'video' ? 'videos' : 'images';
  const configuredBaseUrl = options.mediaType === 'video'
    ? options.videoBaseUrl || serverConfig.aionTaskWorkerVideoBaseUrl
    : options.imageBaseUrl || serverConfig.aionTaskWorkerImageBaseUrl;
  let baseUrl: URL;
  try {
    baseUrl = new URL(configuredBaseUrl);
  } catch {
    return undefined;
  }
  if (!['http:', 'https:'].includes(baseUrl.protocol)) return undefined;
  const basePath = baseUrl.pathname.replace(/\/+$/, '');
  const expectedPrefix = basePath + '/user/' + encodeURIComponent(expectedUserId) + '/assets/' + assetDirectory + '/';

  if (/^https?:\/\//i.test(value)) {
    let candidate: URL;
    try {
      candidate = new URL(value);
    } catch {
      return undefined;
    }
    if (candidate.origin !== baseUrl.origin || !candidate.pathname.startsWith(expectedPrefix)) return undefined;
    const encodedTail = encodeTrustedAssetTail(candidate.pathname.slice(expectedPrefix.length));
    if (!encodedTail) return undefined;
    return baseUrl.origin + expectedPrefix + encodedTail + candidate.search;
  }

  if (value.includes('\\') || value.includes('\0')) return undefined;
  const match = value.match(/^\/work\/aion-user-base-dev\/([^/]+)\/assets\/(images|videos)\/(.+)$/);
  if (!match || match[1] !== expectedUserId || match[2] !== assetDirectory) return undefined;
  const encodedTail = encodeTrustedAssetTail(match[3]);
  if (!encodedTail) return undefined;
  return baseUrl.origin + expectedPrefix + encodedTail;
};

export const buildTaskWorkerSubmission = (
  path: string,
  body: Record<string, any>,
) => {
  if (body.extra_params?.seed !== undefined) {
    throw new Error('The task_worker execution transport does not support Seed; use model_api or set Seed to unused.');
  }
  const modality: GenerationModality = path.endsWith('/generate-image') ? 'image' : 'video';
  const data = Object.fromEntries(
    TASK_WORKER_FIELDS[modality]
      .filter(key => body[key] !== undefined)
      .map(key => [key, body[key]]),
  );
  if (modality === 'video') data.standalone = true;
  return {
    modality,
    request: {
      event_type: modality === 'image'
        ? 'vidflow/remix-reference.triggered'
        : 'vidflow/remix-shot-video.triggered',
      tool_type: modality === 'image'
        ? 'generate_reference_image_by_index'
        : 'generate_video_for_shot_by_index',
      task_type: 'rtc',
      data,
      count: 1,
    },
  };
};

export const taskWorkerFilePathToUrl = (
  rawFilePath: string,
  mediaType: GenerationModality,
  imageBaseUrl = serverConfig.aionTaskWorkerImageBaseUrl,
  videoBaseUrl = serverConfig.aionTaskWorkerVideoBaseUrl,
) => {
  if (/^https?:\/\//i.test(rawFilePath)) {
    try {
      const url = new URL(rawFilePath);
      url.hostname = url.hostname.replace('-internal', '');
      return url.toString();
    } catch {
      return rawFilePath;
    }
  }

  const filePath = rawFilePath
    .replace(/^(?:\.\.\/)+work\//, '/work/')
    .replace('-internal', '');
  const baseUrl = mediaType === 'video' ? videoBaseUrl : imageBaseUrl;
  const userMatch = filePath.match(/^\/work\/aion-user-base-(?:dev|staging|prod)\/(.+)$/);
  if (userMatch) return `${baseUrl}/user/${encodeMediaPath(userMatch[1])}`;

  const runtimeMatch = filePath.match(/^\/work\/aion-runtime(-v2)?-(?:dev|staging|prod)\/(.+)$/);
  if (runtimeMatch) {
    return `${baseUrl}${runtimeMatch[1] ? '/v2/static' : '/static'}/${encodeMediaPath(runtimeMatch[2])}`;
  }

  const threadMatch = filePath.match(/(thread_[^/]+\/.+)$/);
  if (threadMatch) return `${baseUrl}/static/${encodeMediaPath(threadMatch[1])}`;
  return rawFilePath;
};

export const normalizeTaskWorkerTask = (
  task: Record<string, any>,
  mediaType: GenerationModality,
  imageBaseUrl?: string,
  videoBaseUrl?: string,
) => {
  const status = String(task.status || '').toLowerCase();
  const mappedStatus = status === 'success'
    ? 'succeed'
    : status === 'running'
      ? 'processing'
      : status === 'pending'
        ? 'submitted'
        : status;
  const filePath = task.data?.result?.file_path || task.result?.file_path;
  const resultUrl = typeof filePath === 'string' && filePath
    ? taskWorkerFilePathToUrl(filePath, mediaType, imageBaseUrl, videoBaseUrl)
    : undefined;
  const payload: Record<string, any> = {
    task_id: task.id,
    task_status: mappedStatus,
    task_status_msg: task.message,
    endpoint_type: mediaType,
    model_request_id: task.data?.model_request_id,
  };
  if (resultUrl) {
    payload[mediaType === 'image' ? 'images' : 'videos'] = [{
      url: resultUrl,
      file_path: filePath,
    }];
  } else if (status === 'success') {
    payload.task_status = 'failed';
    payload.task_status_msg = 'VidMuse task-worker completed without a media result path.';
  }
  return payload;
};

export class AionGenerationClient {
  constructor(
    private readonly baseUrl = serverConfig.aionManagerBaseUrl,
    private readonly userId = serverConfig.aionEvalUserId,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly modelApiBaseUrl = serverConfig.aionModelApiBaseUrl,
    private readonly transport: AionExecutionTransport = serverConfig.aionExecutionTransport,
    private readonly taskWorkerBaseUrl = serverConfig.aionTaskWorkerBaseUrl,
    private readonly taskWorkerThreadId = serverConfig.aionTaskWorkerThreadId,
    private readonly taskWorkerImageBaseUrl = serverConfig.aionTaskWorkerImageBaseUrl,
    private readonly taskWorkerVideoBaseUrl = serverConfig.aionTaskWorkerVideoBaseUrl,
  ) {}

  executionTransport() {
    return this.transport;
  }

  isExecutionConfigured() {
    return Boolean(
      this.baseUrl
      && this.userId
      && (
        this.transport === 'model_api'
        || (this.taskWorkerBaseUrl && this.taskWorkerThreadId)
      ),
    );
  }

  private url(path: string) {
    if (!this.baseUrl) throw new Error('AION_MANAGER_BASE_URL is not configured');
    const modelPrefix = '/model/api/v1/model';
    if (this.modelApiBaseUrl && (path === modelPrefix || path.startsWith(`${modelPrefix}/`))) {
      return `${this.modelApiBaseUrl.replace(/\/+$/, '')}${path.slice(modelPrefix.length)}`;
    }
    return `${this.baseUrl.replace(/\/+$/, '')}${path}`;
  }

  private async requestJsonUrl(
    url: string,
    init: RequestInit = {},
    authenticated = false,
    threadScoped = false,
  ): Promise<any> {
    if (authenticated && !this.userId) throw new Error('AION_EVAL_USER_ID is not configured');
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body) headers.set('Content-Type', 'application/json');
    if (authenticated) headers.set('x-auth-user-id', this.userId);
    if (threadScoped) {
      if (!this.taskWorkerThreadId) throw new Error('AION_TASK_WORKER_THREAD_ID is not configured');
      headers.set('x-auth-thread-id', this.taskWorkerThreadId);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), serverConfig.aionRequestTimeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        ...init,
        headers,
        signal: controller.signal,
      });
      const body: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = body?.detail?.message || body?.detail;
        const message = detail || body?.message || `Aion request failed with HTTP ${response.status}`;
        const error = new Error(
          typeof message === 'string' ? message : JSON.stringify(message),
        ) as Error & { status?: number; responseBody?: any };
        error.status = response.status;
        error.responseBody = body;
        throw error;
      }
      return body;
    } finally {
      clearTimeout(timeout);
    }
  }

  private requestJson(path: string, init: RequestInit = {}, authenticated = false): Promise<any> {
    return this.requestJsonUrl(this.url(path), init, authenticated);
  }

  async listModels(modalities: GenerationModality[] = ['image', 'video']): Promise<NormalizedGenerationModel[]> {
    const results: NormalizedGenerationModel[] = [];
    for (const modality of modalities) {
      const body = await this.requestJson(
        `/public/api/v1/configs/model-configs?model_type=${encodeURIComponent(modality)}`,
      );
      const items = Array.isArray(body)
        ? body
        : [body?.data, body?.items, body?.models, body?.model_configs, body?.modelConfigs]
          .find(candidate => Array.isArray(candidate)) || [];
      for (const item of items) {
        const enabledFlag = item?.is_enabled ?? item?.isEnabled ?? item?.enabled;
        if (enabledFlag === false || String(enabledFlag).toLowerCase() === 'false') {
          continue;
        }

        try {
          results.push(normalizeAionModelConfig(item));
        } catch (error) {
          console.warn('[generation] ignored invalid Aion model config', {
            model: item?.name,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    return Array.from(new Map(
      results.map(model => [`${model.outputModality}:${model.modelName}`, model]),
    ).values());
  }

  async getModel(modelName: string) {
    const models = await this.listModels();
    return models.find(model => model.modelName === modelName) || null;
  }

  async submit(path: string, body: Record<string, any>) {
    if (this.transport === 'model_api') {
      return this.requestJson(path, {
        method: 'POST',
        body: JSON.stringify(body),
      }, true);
    }

    if (!this.taskWorkerBaseUrl || !this.taskWorkerThreadId) {
      throw new Error('Aion task-worker transport is not configured');
    }
    const submission = buildTaskWorkerSubmission(path, body);
    const response = await this.requestJsonUrl(
      `${this.taskWorkerBaseUrl}/api/v2/threads/${encodeURIComponent(this.taskWorkerThreadId)}/task-worker/create-task`,
      {
        method: 'POST',
        body: JSON.stringify(submission.request),
      },
      true,
      true,
    );
    const taskId = Array.isArray(response?.task_ids) ? response.task_ids[0] : undefined;
    if (!taskId) throw new Error('VidMuse task-worker returned no task ID');
    return {
      task_id: String(taskId),
      task_status: 'submitted',
      endpoint_type: submission.modality,
      transport: 'task_worker',
    };
  }

  async getTask(taskId: string, modelName: string, endpointType?: string) {
    if (this.transport === 'model_api') {
      const query = new URLSearchParams({ model_name: modelName });
      if (endpointType) query.set('endpoint_type', endpointType);
      return this.requestJson(
        `/model/api/v1/model/tasks/${encodeURIComponent(taskId)}?${query.toString()}`,
        {},
        true,
      );
    }

    const response = await this.requestJsonUrl(
      `${this.taskWorkerBaseUrl}/api/v1/thread-tasks/${encodeURIComponent(this.taskWorkerThreadId)}/rtc`,
      {},
      true,
      true,
    );
    const tasks = Array.isArray(response) ? response : [];
    const task = tasks.find(candidate => String(candidate?.id) === taskId);
    if (!task) {
      const error = new Error(`VidMuse task-worker task not found: ${taskId}`) as Error & { status?: number };
      error.status = 404;
      throw error;
    }
    const modality: GenerationModality = endpointType === 'image' ? 'image' : 'video';
    return normalizeTaskWorkerTask(
      task,
      modality,
      this.taskWorkerImageBaseUrl,
      this.taskWorkerVideoBaseUrl,
    );
  }
}

export const aionGenerationClient = new AionGenerationClient();
