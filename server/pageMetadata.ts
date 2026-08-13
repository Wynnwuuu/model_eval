import type { PageMetadata, PageMetadataNames } from '../src/pageMetadata.ts';
import {
  MANUEVAL_SHARE_IMAGE_PATH,
  getCanonicalPagePath,
  injectPageMetadata,
  parsePageMetadataResourceRequest,
  renderPageMetadataTags,
  resolvePageMetadata,
} from '../src/pageMetadata.ts';

export { getCanonicalPagePath };
import { getDataset } from './datasets/datasetRepository.ts';
import { getGenerationBatch } from './generation/generationExecutionRepository.ts';
import { getProject } from './projects/projectRepository.ts';
import { getTask } from './tasks/taskRepository.ts';
import { getTemplate } from './templates/templateRepository.ts';

export interface PageMetadataLoaders {
  getProjectName: (id: string) => Promise<string | undefined>;
  getDatasetName: (id: string) => Promise<string | undefined>;
  getTaskName: (id: string) => Promise<string | undefined>;
  getTemplateName: (id: string) => Promise<string | undefined>;
  getGenerationTargetName: (id: string) => Promise<string | undefined>;
}

export const defaultPageMetadataLoaders: PageMetadataLoaders = {
  getProjectName: async id => (await getProject(id))?.name,
  getDatasetName: async id => (await getDataset(id))?.name,
  getTaskName: async id => (await getTask(id))?.name,
  getTemplateName: async id => (await getTemplate(id))?.name,
  getGenerationTargetName: async id => {
    const batch = await getGenerationBatch(id);
    return batch?.targetColumn
      || batch?.modelConfig?.displayName
      || batch?.modelConfig?.modelName;
  },
};

const settleName = async (loader: (() => Promise<string | undefined>) | undefined) => {
  if (!loader) return undefined;
  try {
    return await loader();
  } catch (error) {
    console.warn('Failed to resolve page metadata resource name', error);
    return undefined;
  }
};

export const loadPageMetadataNames = async (
  pathname: string,
  searchParams: URLSearchParams,
  loaders: PageMetadataLoaders = defaultPageMetadataLoaders,
): Promise<PageMetadataNames> => {
  const request = parsePageMetadataResourceRequest(pathname, searchParams);
  const [projectName, datasetName, taskName, templateName, generationTargetName] = await Promise.all([
    settleName(request.projectId ? () => loaders.getProjectName(request.projectId!) : undefined),
    settleName(request.datasetId ? () => loaders.getDatasetName(request.datasetId!) : undefined),
    settleName(request.taskId ? () => loaders.getTaskName(request.taskId!) : undefined),
    settleName(request.templateId ? () => loaders.getTemplateName(request.templateId!) : undefined),
    settleName(request.generationBatchId ? () => loaders.getGenerationTargetName(request.generationBatchId!) : undefined),
  ]);

  return { projectName, datasetName, taskName, templateName, generationTargetName };
};

export const resolveServerPageMetadata = async (
  pathname: string,
  searchParams: URLSearchParams,
  loaders: PageMetadataLoaders = defaultPageMetadataLoaders,
): Promise<PageMetadata> => resolvePageMetadata({
  pathname,
  searchParams,
  names: await loadPageMetadataNames(pathname, searchParams, loaders),
});

export const renderSpaPage = ({
  html,
  metadata,
  canonicalUrl,
  origin,
}: {
  html: string;
  metadata: PageMetadata;
  canonicalUrl: string;
  origin: string;
}) => injectPageMetadata(
  html,
  renderPageMetadataTags(metadata, {
    canonicalUrl,
    imageUrl: new URL(MANUEVAL_SHARE_IMAGE_PATH, origin).toString(),
  }),
);
