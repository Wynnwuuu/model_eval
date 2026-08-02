import { createHash, createHmac, randomUUID } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { Readable, Transform } from 'node:stream';
import path from 'node:path';
import net from 'node:net';

import OSS from 'ali-oss';

import type { RequestUser } from '../auth/context.ts';
import { serverConfig } from '../config.ts';
import { badRequest, notFound } from '../http/errors.ts';
import {
  createGenerationAsset,
  findGenerationAssetBySource,
  getGenerationAsset,
  updateGenerationAsset,
} from './generationExecutionRepository.ts';

const MULTIPART_THRESHOLD = 100 * 1024 * 1024;
const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

const normalizeUploadContentType = (fileName: string, contentType?: string) => {
  const extension = path.extname(fileName || '').toLowerCase();
  const inferredType = MIME_BY_EXTENSION[extension];
  const providedType = String(contentType || '').split(';')[0].trim().toLowerCase();
  const normalizedType = !providedType || providedType === 'application/octet-stream' ? inferredType : providedType;
  if (!inferredType || !normalizedType || inferredType.split('/')[0] !== normalizedType.split('/')[0]) {
    throw badRequest(`Unsupported generation asset type: ${contentType || 'unknown'} (${extension || 'no extension'}).`);
  }
  return normalizedType;
};

const normalizeRemoteContentType = (fileName: string, contentType?: string) => {
  const extension = path.extname(fileName || '').toLowerCase();
  const inferredType = MIME_BY_EXTENSION[extension];
  const providedType = String(contentType || '').split(';')[0].trim().toLowerCase();
  const providedIsMedia = /^(?:image|audio|video)\//.test(providedType);
  if (providedIsMedia && (!inferredType || inferredType.split('/')[0] === providedType.split('/')[0])) {
    return providedType;
  }
  if ((!providedType || providedType === 'application/octet-stream') && inferredType) return inferredType;
  throw new Error(`Remote generation asset has an unsupported content type: ${contentType || 'unknown'}.`);
};

export const createByteLimitStream = (maxBytes: number) => {
  let transferredBytes = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      transferredBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
      if (transferredBytes > maxBytes) {
        callback(new Error(`Remote asset exceeds ${maxBytes} bytes.`));
        return;
      }
      callback(null, chunk);
    },
  });
};

const MULTIPART_PART_SIZE = 20 * 1024 * 1024;

const sanitizeFileName = (value: string) => {
  const normalized = path.basename(value || 'asset.bin').replace(/[^a-zA-Z0-9._-]+/g, '_');
  return normalized.slice(-180) || 'asset.bin';
};

const isPrivateIp = (address: string) => {
  if (address === '::1' || address === '::' || address.startsWith('fe80:') || address.startsWith('fc') || address.startsWith('fd')) {
    return true;
  }
  if (!net.isIPv4(address)) return false;
  const parts = address.split('.').map(Number);
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || parts[0] === 0;
};

const assertSafeRemoteUrl = async (value: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw badRequest('The remote asset URL is invalid.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw badRequest('Remote assets must use http(s).');
  if (['localhost', 'host.docker.internal'].includes(url.hostname.toLowerCase())) {
    throw badRequest('Remote assets cannot use a local host name.');
  }
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(item => isPrivateIp(item.address))) {
    throw badRequest('Remote assets cannot resolve to a private network address.');
  }
  return url;
};

const fetchRemoteAsset = async (sourceUrl: string) => {
  let current = sourceUrl;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    await assertSafeRemoteUrl(current);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), serverConfig.generationTaskTimeoutMs);
    let response: Response;
    try {
      response = await fetch(current, { redirect: 'manual', signal: controller.signal });
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
    if (response.status >= 300 && response.status < 400) {
      clearTimeout(timeout);
      const location = response.headers.get('location');
      if (!location) throw new Error('Remote asset redirect is missing a Location header.');
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok || !response.body) {
      clearTimeout(timeout);
      throw new Error(`Remote asset download failed with HTTP ${response.status}.`);
    }
    const size = Number(response.headers.get('content-length') || 0);
    if (size > serverConfig.generationMaxAssetBytes) {
      clearTimeout(timeout);
      controller.abort();
      throw new Error(`Remote asset exceeds ${serverConfig.generationMaxAssetBytes} bytes.`);
    }
    return {
      response,
      finalUrl: current,
      size,
      cleanup: () => {
        clearTimeout(timeout);
        controller.abort();
      },
    };
  }
  throw new Error('Remote asset exceeded the redirect limit.');
};
class GenerationAssetService {
  private client: OSS | null = null;

  mode() {
    return serverConfig.generationAssetMode;
  }

  usesTemporaryUrls() {
    return this.mode() === 'temporary_url';
  }

  isExecutionReady() {
    return this.usesTemporaryUrls() || this.isConfigured();
  }

  isConfigured() {
    return Boolean(
      serverConfig.ossAccessKeyId
      && serverConfig.ossAccessKeySecret
      && serverConfig.ossEndpoint
      && serverConfig.ossBucket,
    );
  }

  private getClient() {
    if (!this.isConfigured()) throw new Error('ManuEval dev OSS is not configured');
    if (!this.client) {
      this.client = new OSS({
        accessKeyId: serverConfig.ossAccessKeyId,
        accessKeySecret: serverConfig.ossAccessKeySecret,
        endpoint: serverConfig.ossEndpoint,
        region: serverConfig.ossRegion || undefined,
        bucket: serverConfig.ossBucket,
        secure: true,
      });
    }
    return this.client;
  }

  private token(assetId: string) {
    const secret = serverConfig.jwtSecret || serverConfig.ossAccessKeySecret;
    if (!secret) throw new Error('JWT_SECRET or OSS secret is required for asset capability URLs');
    return createHmac('sha256', secret).update(assetId).digest('base64url');
  }

  private tokenHash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private objectKey(kind: string, datasetId: string | undefined, fileName: string) {
    const date = new Date().toISOString().slice(0, 10);
    return [
      serverConfig.ossPrefix,
      kind,
      datasetId || 'unbound',
      date,
      randomUUID(),
      sanitizeFileName(fileName),
    ].filter(Boolean).join('/');
  }

  stableUrl(assetId: string) {
    if (!serverConfig.publicBaseUrl) return `/api/generation-assets/${assetId}/content?token=${this.token(assetId)}`;
    return `${serverConfig.publicBaseUrl}/api/generation-assets/${assetId}/content?token=${this.token(assetId)}`;
  }

  async verifyCapability(assetId: string, token: string) {
    const asset = await getGenerationAsset(assetId);
    if (!asset || asset.status !== 'ready') return null;
    if (this.tokenHash(token) !== asset.capability_token_hash) return null;
    return asset;
  }

  async signedGetUrl(objectKey: string) {
    return this.getClient().signatureUrl(objectKey, {
      expires: serverConfig.ossSignedUrlTtlSeconds,
      method: 'GET',
    });
  }

  async createUpload(
    input: {
      datasetId?: string;
      fileName: string;
      relativePath?: string;
      contentType?: string;
      sizeBytes: number;
    },
    user: RequestUser,
  ) {
    if (this.usesTemporaryUrls()) {
      throw new Error('Local asset upload is unavailable in temporary URL mode. Use a public media URL in the dataset.');
    }
    if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) throw badRequest('Asset size must be positive.');
    const contentType = normalizeUploadContentType(input.fileName, input.contentType);
    if (input.sizeBytes > serverConfig.generationMaxAssetBytes) {
      throw badRequest(`Asset exceeds ${serverConfig.generationMaxAssetBytes} bytes.`);
    }
    const id = `asset-${randomUUID()}`;
    const token = this.token(id);
    const objectKey = this.objectKey('input', input.datasetId, input.fileName);
    const asset = await createGenerationAsset({
      id,
      organizationId: user.organizationId,
      datasetId: input.datasetId,
      kind: 'input',
      fileName: sanitizeFileName(input.fileName),
      relativePath: input.relativePath,
      objectKey,
      contentType,
      sizeBytes: input.sizeBytes,
      capabilityTokenHash: this.tokenHash(token),
      createdBy: user.id,
    });

    if (input.sizeBytes < MULTIPART_THRESHOLD) {
      const uploadUrl = this.getClient().signatureUrl(objectKey, {
        method: 'PUT',
        expires: 3600,
        'Content-Type': contentType,
      } as any);
      return {
        assetId: asset.id,
        mode: 'single' as const,
        objectKey,
        uploadUrl,
        headers: { 'Content-Type': contentType },
      };
    }

    const initiated = await this.getClient().initMultipartUpload(objectKey, {
      headers: { 'Content-Type': contentType },
    } as any);
    const partCount = Math.ceil(input.sizeBytes / MULTIPART_PART_SIZE);
    const partUrls = Array.from({ length: partCount }, (_, index) => {
      const partNumber = index + 1;
      return {
        partNumber,
        url: this.getClient().signatureUrl(objectKey, {
          method: 'PUT',
          expires: 3600,
          subResource: {
            uploadId: initiated.uploadId,
            partNumber: String(partNumber),
          },
        } as any),
      };
    });
    return {
      assetId: asset.id,
      mode: 'multipart' as const,
      objectKey,
      uploadId: initiated.uploadId,
      partSize: MULTIPART_PART_SIZE,
      partUrls,
    };
  }

  async completeUpload(
    assetId: string,
    upload?: { uploadId?: string; parts?: Array<{ number: number; etag: string }> },
    user?: RequestUser,
  ) {
    const asset = await getGenerationAsset(assetId);
    if (!asset) throw notFound('Generation asset');
    if (user && (asset.created_by !== user.id || asset.organization_id !== user.organizationId)) {
      throw notFound('Generation asset');
    }
    if (asset.kind !== 'input') throw notFound('Generation asset');
    const responseFor = (contentType: string, sizeBytes: number) => ({
      assetId,
      assetUrl: `asset://${assetId}`,
      stableUrl: this.stableUrl(assetId),
      fileName: asset.file_name,
      relativePath: asset.relative_path,
      contentType,
      sizeBytes,
    });
    if (asset.status === 'ready') {
      return responseFor(String(asset.content_type || ''), Number(asset.size_bytes || 0));
    }
    if (asset.status !== 'pending') throw badRequest('The generation asset upload is not completable.');

    const client = this.getClient() as any;
    let head = await client.head(asset.object_key).catch(() => null);
    if (!head && upload?.uploadId) {
      const parts = (upload.parts || []).map(part => ({
        number: part.number,
        etag: part.etag.replaceAll('"', ''),
      }));
      if (!parts.length) throw badRequest('Multipart upload has no completed parts.');
      await client.completeMultipartUpload(asset.object_key, upload.uploadId, parts);
      head = await client.head(asset.object_key);
    }
    if (!head) throw badRequest('The OSS upload is not available yet.');

    const size = Number(head?.res?.headers?.['content-length'] || 0);
    try {
      if (!Number.isFinite(size) || size <= 0 || size > serverConfig.generationMaxAssetBytes) {
        throw badRequest(`Uploaded asset has an invalid size: ${size}.`);
      }
      const contentType = normalizeUploadContentType(
        asset.file_name,
        head?.res?.headers?.['content-type'] || asset.content_type,
      );
      await updateGenerationAsset(assetId, { status: 'ready', sizeBytes: size, contentType });
      return responseFor(contentType, size);
    } catch (error) {
      await client.delete(asset.object_key).catch(() => undefined);
      await updateGenerationAsset(assetId, { status: 'failed' });
      throw error;
    }
  }

  async resolveInputReference(value: string) {
    if (!value.startsWith('asset://')) return value;
    const assetId = value.slice('asset://'.length);
    const asset = await getGenerationAsset(assetId);
    if (!asset || asset.status !== 'ready') throw new Error(`Uploaded asset is not ready: ${assetId}`);
    return this.signedGetUrl(asset.object_key);
  }

  async archiveRemote(
    sourceUrl: string,
    input: {
      datasetId: string;
      jobId: string;
      jobItemId: string;
      kind: 'input' | 'output';
      fileName?: string;
      createdBy?: string;
    },
  ) {
    const existing = await findGenerationAssetBySource(input.jobId, sourceUrl);
    if (existing) {
      return {
        id: existing.id,
        stableUrl: this.stableUrl(existing.id),
        signedUrl: await this.signedGetUrl(existing.object_key),
      };
    }

    const remote = await fetchRemoteAsset(sourceUrl);
    const { response, finalUrl, size, cleanup } = remote;
    let assetId = '';
    let objectKey = '';
    try {
      const sourceContentType = response.headers.get('content-type') || 'application/octet-stream';
      const fromUrl = path.basename(new URL(finalUrl).pathname) || `${input.kind}.bin`;
      const fileName = sanitizeFileName(input.fileName || fromUrl);
      const contentType = normalizeRemoteContentType(fileName, sourceContentType);
      assetId = `asset-${randomUUID()}`;
      const token = this.token(assetId);
      objectKey = this.objectKey(input.kind, input.datasetId, fileName);
      await createGenerationAsset({
        id: assetId,
        organizationId: 'default',
        datasetId: input.datasetId,
        jobId: input.jobId,
        jobItemId: input.jobItemId,
        kind: input.kind,
        fileName,
        objectKey,
        contentType,
        sizeBytes: size || undefined,
        sourceUrl,
        capabilityTokenHash: this.tokenHash(token),
        createdBy: input.createdBy,
      });

      const stream = Readable.fromWeb(response.body as any)
        .pipe(createByteLimitStream(serverConfig.generationMaxAssetBytes));
      await this.getClient().putStream(objectKey, stream, {
        contentLength: size || undefined,
        mime: contentType,
      } as any);
      const head = await (this.getClient() as any).head(objectKey);
      const archivedSize = Number(head?.res?.headers?.['content-length'] || size || 0);
      if (!Number.isFinite(archivedSize) || archivedSize <= 0 || archivedSize > serverConfig.generationMaxAssetBytes) {
        throw new Error('Archived asset has an invalid size.');
      }
      await updateGenerationAsset(assetId, {
        status: 'ready',
        contentType,
        sizeBytes: archivedSize,
        sourceUrl,
      });
      return {
        id: assetId,
        stableUrl: this.stableUrl(assetId),
        signedUrl: await this.signedGetUrl(objectKey),
      };
    } catch (error) {
      if (objectKey) await this.getClient().delete(objectKey).catch(() => undefined);
      if (assetId) await updateGenerationAsset(assetId, { status: 'failed' }).catch(() => undefined);
      throw error;
    } finally {
      cleanup();
    }
  }
}

export const generationAssetService = new GenerationAssetService();
