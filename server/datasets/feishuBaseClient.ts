import { ApiError, badRequest } from '../http/errors.ts';

const FEISHU_OPEN_API = 'https://open.feishu.cn/open-apis';
const ALLOWED_FEISHU_HOSTS = ['feishu.cn', 'larksuite.com'];

export const resolveFeishuBaseUrl = (sourceUrl: string) => {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw badRequest('请输入有效的飞书多维表格链接。');
  }
  const allowedHost = ALLOWED_FEISHU_HOSTS.some(suffix => parsed.hostname === suffix || parsed.hostname.endsWith(`.${suffix}`));
  const pathMatch = parsed.pathname.match(/^\/base\/([^/]+)/);
  const tableId = parsed.searchParams.get('table')?.trim();
  if (parsed.protocol !== 'https:' || !allowedHost || !pathMatch?.[1] || !tableId) {
    throw badRequest('链接必须是包含 table 参数的飞书 Base 地址。');
  }
  try {
    return { appToken: decodeURIComponent(pathMatch[1]), tableId };
  } catch {
    throw badRequest('飞书 Base 链接中的 app token 无效。');
  }
};

export const normalizeFeishuBaseCell = (value: unknown): unknown => {
  if (value == null) return '';
  if (Array.isArray(value)) {
    if (!value.length) return '';
    if (value.every(item => item && typeof item === 'object' && typeof (item as any).text === 'string')) {
      return value.map(item => (item as any).text).join('');
    }
    if (value.every(item => item && typeof item === 'object' && typeof (item as any).link === 'string')) {
      const links = value.map(item => (item as any).link);
      return links.length === 1 ? links[0] : links;
    }
    return value.map(normalizeFeishuBaseCell);
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.link === 'string') return record.link;
    if (typeof record.url === 'string') return record.url;
    if (typeof record.text === 'string') return record.text;
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, normalizeFeishuBaseCell(item)]));
  }
  return value;
};

const readApiPage = async <T>(url: URL, token: string, fetchImpl: typeof fetch): Promise<T> => {
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  let body: any;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(502, 'FEISHU_BASE_REQUEST_FAILED', '飞书 Base 返回了无法解析的响应。');
  }
  if (!response.ok || body?.code !== 0) {
    throw new ApiError(
      response.status === 403 ? 403 : 502,
      response.status === 403 ? 'FEISHU_BASE_FORBIDDEN' : 'FEISHU_BASE_REQUEST_FAILED',
      body?.msg || body?.message || '读取飞书 Base 失败。请确认应用权限及表格授权。',
      { feishuCode: body?.code },
    );
  }
  return body as T;
};

const listAll = async <T>(input: {
  url: URL;
  token: string;
  fetchImpl: typeof fetch;
  pageSize: number;
}) => {
  const items: T[] = [];
  let pageToken = '';
  do {
    const url = new URL(input.url);
    url.searchParams.set('page_size', String(input.pageSize));
    if (pageToken) url.searchParams.set('page_token', pageToken);
    const page = await readApiPage<{ data?: { items?: T[]; has_more?: boolean; page_token?: string } }>(url, input.token, input.fetchImpl);
    items.push(...(page.data?.items || []));
    pageToken = page.data?.has_more ? page.data.page_token || '' : '';
    if (page.data?.has_more && !pageToken) {
      throw new ApiError(502, 'FEISHU_BASE_PAGINATION_FAILED', '飞书 Base 分页响应缺少 page_token。');
    }
  } while (pageToken);
  return items;
};

export const readFeishuBaseSnapshot = async (input: {
  sourceUrl: string;
  tenantAccessToken: string;
  fetchImpl?: typeof fetch;
}) => {
  const { appToken, tableId } = resolveFeishuBaseUrl(input.sourceUrl);
  const fetchImpl = input.fetchImpl || fetch;
  const basePath = `${FEISHU_OPEN_API}/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}`;
  const fields = await listAll<{ field_name?: string }>({
    url: new URL(`${basePath}/fields`),
    token: input.tenantAccessToken,
    fetchImpl,
    pageSize: 100,
  });
  const headers = fields.map(field => String(field.field_name || '').trim()).filter(Boolean);
  if (!headers.length) throw new ApiError(422, 'FEISHU_BASE_EMPTY_SCHEMA', '飞书 Base 没有可读取的字段。');
  const records = await listAll<{ fields?: Record<string, unknown> }>({
    url: new URL(`${basePath}/records`),
    token: input.tenantAccessToken,
    fetchImpl,
    pageSize: 500,
  });
  const rows = records.map(record => Object.fromEntries(headers.map(header => [
    header,
    normalizeFeishuBaseCell(record.fields?.[header]),
  ])));
  return { appToken, tableId, headers, rows };
};
