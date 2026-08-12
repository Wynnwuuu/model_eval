import { db } from './auth';
import { doc, getDoc } from './datastore';
import {
  MANUEVAL_SHARE_IMAGE_PATH,
  PageMetadata,
  PageMetadataNames,
  parsePageMetadataResourceRequest,
  resolvePageMetadata,
} from './pageMetadata';
import { API_BASE_URL, USE_SHARED_DATA_SOURCE } from './runtimeConfig';

export const PAGE_METADATA_REFRESH_EVENT = 'manueval:page-metadata-refresh';

export const notifyPageMetadataRefresh = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PAGE_METADATA_REFRESH_EVENT));
};

const snapshotExists = (snapshot: any) => {
  if (!snapshot) return false;
  return typeof snapshot.exists === 'function' ? snapshot.exists() : Boolean(snapshot.exists);
};

const loadLocalDocument = async (collectionName: string, id?: string) => {
  if (!id) return undefined;
  const snapshot = await getDoc(doc(db, collectionName, id));
  return snapshotExists(snapshot) ? snapshot.data() : undefined;
};

const loadLocalNames = async (pathname: string, searchParams: URLSearchParams): Promise<PageMetadataNames> => {
  const request = parsePageMetadataResourceRequest(pathname, searchParams);
  const [project, dataset, task, template, generation] = await Promise.all([
    loadLocalDocument('projects', request.projectId),
    loadLocalDocument('evalDatasets', request.datasetId),
    loadLocalDocument('evalTasks', request.taskId),
    loadLocalDocument('evalTemplates', request.templateId),
    loadLocalDocument('evalGenerationJobs', request.generationBatchId),
  ]);

  return {
    projectName: project?.name,
    datasetName: dataset?.name,
    taskName: task?.name,
    templateName: template?.name,
    generationTargetName: generation?.targetColumn
      || generation?.modelConfig?.displayName
      || generation?.modelConfig?.modelName,
  };
};

export const loadPageMetadataForLocation = async (
  pathname: string,
  search: string,
): Promise<PageMetadata> => {
  const searchParams = new URLSearchParams(search);
  if (!USE_SHARED_DATA_SOURCE) {
    return resolvePageMetadata({
      pathname,
      searchParams,
      names: await loadLocalNames(pathname, searchParams),
    });
  }

  const path = `${pathname}${search}`;
  const response = await fetch(`${API_BASE_URL}/api/page-metadata?path=${encodeURIComponent(path)}`);
  if (!response.ok) throw new Error(`Failed to load page metadata: ${response.status}`);
  const payload = await response.json() as { metadata?: PageMetadata };
  if (!payload.metadata?.title) throw new Error('Page metadata response is incomplete');
  return payload.metadata;
};

const upsertMeta = (attribute: 'name' | 'property', key: string, content: string) => {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.content = content;
};

export const applyPageMetadata = (metadata: PageMetadata) => {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const canonicalUrl = window.location.href;
  const imageUrl = new URL(MANUEVAL_SHARE_IMAGE_PATH, window.location.origin).toString();

  document.title = metadata.title;
  upsertMeta('name', 'description', metadata.description);
  upsertMeta('property', 'og:title', metadata.title);
  upsertMeta('property', 'og:description', metadata.description);
  upsertMeta('property', 'og:url', canonicalUrl);
  upsertMeta('property', 'og:image', imageUrl);
  upsertMeta('name', 'twitter:title', metadata.title);
  upsertMeta('name', 'twitter:description', metadata.description);
  upsertMeta('name', 'twitter:image', imageUrl);

  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    document.head.appendChild(canonical);
  }
  canonical.href = canonicalUrl;
};
