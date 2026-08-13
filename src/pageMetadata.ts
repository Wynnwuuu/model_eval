export const MANUEVAL_SITE_NAME = 'Manueval';
export const MANUEVAL_SHARE_IMAGE_PATH = '/manueval-share.png';

export interface PageMetadata {
  title: string;
  description: string;
}

export interface PageMetadataNames {
  projectName?: string;
  datasetName?: string;
  taskName?: string;
  templateName?: string;
  generationTargetName?: string;
}

export interface PageMetadataResourceRequest {
  projectId?: string;
  datasetId?: string;
  taskId?: string;
  templateId?: string;
  generationBatchId?: string;
}

interface ResolvePageMetadataInput {
  pathname: string;
  searchParams?: URLSearchParams;
  names?: PageMetadataNames;
}

interface PageMetadataUrls {
  canonicalUrl: string;
  imageUrl: string;
}

const DESCRIPTIONS = {
  home: 'Manueval',
  projects: '查看项目进度、评测物料与结果。',
  datasets: '查看评测集字段、样本与媒体内容。',
  generation: '查看批量生产配置、进度与产物。',
  templates: '查看评测标准、维度与评分规则。',
  tasks: '查看评测物料、任务配置与执行状态。',
  evaluation: '参与评测并提交评测结果。',
  results: '查看单次评测结果与票数汇总。',
  insights: '查看评测结论、可信统计与 case 明细。',
  history: '查看历史评测记录。',
  login: '登录 Manueval。',
} as const;

const cleanResourceName = (value?: string) => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
};

const titled = (name: string | undefined, type: string) => {
  const cleanName = cleanResourceName(name);
  return cleanName
    ? `${cleanName} · ${type} · ${MANUEVAL_SITE_NAME}`
    : `${type} · ${MANUEVAL_SITE_NAME}`;
};

const decodePathSegment = (value?: string) => {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const getCanonicalPagePath = (
  pathname: string,
  searchParams = new URLSearchParams(),
) => {
  const path = pathname.replace(/\/+$/, '') || '/';
  const legacyTaskInsights = path.match(/^\/tasks\/([^/]+)\/insights$/);
  if (legacyTaskInsights) return `/tasks/${legacyTaskInsights[1]}/results`;
  const search = searchParams.toString();
  return `${path}${search ? `?${search}` : ''}`;
};

export const parsePageMetadataResourceRequest = (
  pathname: string,
  searchParams = new URLSearchParams(),
): PageMetadataResourceRequest => {
  const path = pathname.replace(/\/+$/, '') || '/';
  const batchId = searchParams.get('batch')?.trim() || undefined;
  const projectMatch = path.match(/^\/projects\/([^/]+)(?:\/tasks|\/insights)?$/);
  const datasetMatch = path.match(/^\/datasets\/([^/]+)(?:\/generation)?$/);
  const taskMatch = path.match(/^\/tasks\/([^/]+)(?:\/evaluate|\/results|\/insights)?$/);
  const templateMatch = path.match(/^\/templates\/([^/]+)$/);

  return {
    projectId: decodePathSegment(projectMatch?.[1]),
    datasetId: decodePathSegment(datasetMatch?.[1]),
    taskId: taskMatch?.[1] === 'new' ? undefined : decodePathSegment(taskMatch?.[1]),
    templateId: decodePathSegment(templateMatch?.[1]),
    generationBatchId: batchId,
  };
};

export const resolvePageMetadata = ({
  pathname,
  searchParams = new URLSearchParams(),
  names = {},
}: ResolvePageMetadataInput): PageMetadata => {
  const path = pathname.replace(/\/+$/, '') || '/';

  if (path === '/') return { title: MANUEVAL_SITE_NAME, description: DESCRIPTIONS.home };
  if (path === '/login' || path === '/feishu-callback') {
    return { title: titled(undefined, '登录'), description: DESCRIPTIONS.login };
  }

  if (path === '/projects') return { title: titled(undefined, '项目'), description: DESCRIPTIONS.projects };
  if (/^\/projects\/[^/]+\/insights$/.test(path)) {
    return { title: titled(names.projectName, '结果洞察'), description: DESCRIPTIONS.insights };
  }
  if (/^\/projects\/[^/]+\/tasks$/.test(path)) {
    return { title: titled(names.projectName, '评测物料'), description: DESCRIPTIONS.tasks };
  }
  if (/^\/projects\/[^/]+$/.test(path)) {
    return { title: titled(names.projectName, '项目'), description: DESCRIPTIONS.projects };
  }

  if (path === '/datasets') return { title: titled(undefined, '评测集'), description: DESCRIPTIONS.datasets };
  if (/^\/datasets\/[^/]+\/generation$/.test(path)) {
    const batchId = searchParams.get('batch')?.trim();
    return batchId
      ? { title: titled(names.generationTargetName, '生产任务'), description: DESCRIPTIONS.generation }
      : { title: titled(names.datasetName, '生产'), description: DESCRIPTIONS.generation };
  }
  if (/^\/datasets\/[^/]+$/.test(path)) {
    return { title: titled(names.datasetName, '评测集'), description: DESCRIPTIONS.datasets };
  }

  if (path === '/generation') {
    const batchId = searchParams.get('batch')?.trim();
    return batchId
      ? { title: titled(names.generationTargetName, '生产任务'), description: DESCRIPTIONS.generation }
      : { title: titled(undefined, '生产'), description: DESCRIPTIONS.generation };
  }

  if (path === '/templates') return { title: titled(undefined, 'Rubric'), description: DESCRIPTIONS.templates };
  if (/^\/templates\/[^/]+$/.test(path)) {
    return { title: titled(names.templateName, 'Rubric'), description: DESCRIPTIONS.templates };
  }

  if (path === '/tasks') return { title: titled(undefined, '评测物料'), description: DESCRIPTIONS.tasks };
  if (path === '/tasks/new') return { title: titled(undefined, '新建评测物料'), description: DESCRIPTIONS.tasks };
  if (/^\/tasks\/[^/]+\/evaluate$/.test(path)) {
    return { title: titled(names.taskName, '参与评测'), description: DESCRIPTIONS.evaluation };
  }
  if (/^\/tasks\/[^/]+\/results$/.test(path)) {
    return { title: titled(names.taskName, '评测结果'), description: DESCRIPTIONS.results };
  }
  if (/^\/tasks\/[^/]+\/insights$/.test(path)) {
    return { title: titled(names.taskName, '评测结果'), description: DESCRIPTIONS.results };
  }
  if (/^\/tasks\/[^/]+$/.test(path)) {
    return { title: titled(names.taskName, '评测物料'), description: DESCRIPTIONS.tasks };
  }

  if (path === '/evaluation' || path === '/evaluation/run') {
    return { title: titled(undefined, '参与评测'), description: DESCRIPTIONS.evaluation };
  }
  if (path === '/evaluation/results') {
    return { title: titled(undefined, '评测结果'), description: DESCRIPTIONS.results };
  }
  if (path === '/insights') return { title: titled(undefined, '结果洞察'), description: DESCRIPTIONS.insights };
  if (path === '/history') return { title: titled(undefined, '历史'), description: DESCRIPTIONS.history };

  return { title: MANUEVAL_SITE_NAME, description: DESCRIPTIONS.home };
};

export const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const renderPageMetadataTags = (
  metadata: PageMetadata,
  urls: PageMetadataUrls,
) => {
  const title = escapeHtml(metadata.title);
  const description = escapeHtml(metadata.description);
  const canonicalUrl = escapeHtml(urls.canonicalUrl);
  const imageUrl = escapeHtml(urls.imageUrl);

  return `<!-- manueval:metadata:start -->
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta name="robots" content="noindex,nofollow" />
    <link rel="canonical" href="${canonicalUrl}" />
    <link rel="icon" type="image/svg+xml" href="/manueval-icon.svg" />
    <link rel="apple-touch-icon" href="/manueval-touch-icon.png" />
    <meta name="theme-color" content="#050607" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${canonicalUrl}" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="Manueval" />
    <meta property="og:site_name" content="${MANUEVAL_SITE_NAME}" />
    <meta property="og:locale" content="zh_CN" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${imageUrl}" />
    <meta name="twitter:image:alt" content="Manueval" />
    <!-- manueval:metadata:end -->`;
};

const METADATA_BLOCK = /<!-- manueval:metadata:start -->[\s\S]*?<!-- manueval:metadata:end -->/;

export const injectPageMetadata = (html: string, renderedTags: string) => {
  if (METADATA_BLOCK.test(html)) return html.replace(METADATA_BLOCK, renderedTags);
  return html.replace('</head>', `${renderedTags}\n  </head>`);
};
