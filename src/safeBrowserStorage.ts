export type BrowserStorageIssueKind = 'quota' | 'unavailable' | 'auth';

export interface BrowserStorageIssue {
  kind: BrowserStorageIssueKind;
  key: string;
  operation: 'read' | 'write' | 'remove';
  message: string;
  technicalMessage?: string;
  timestamp: number;
}

export interface BrowserStorageResult<T = void> {
  ok: boolean;
  value?: T;
  issue?: BrowserStorageIssue;
}

const STORAGE_ISSUE_EVENT = 'manueval:browser-storage-issue';
let lastBrowserStorageIssue: BrowserStorageIssue | null = null;

const isQuotaError = (error: unknown) => {
  if (error instanceof DOMException) {
    return error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED';
  }
  return String((error as { name?: string } | null)?.name || '').includes('Quota');
};

const createIssue = (
  key: string,
  operation: BrowserStorageIssue['operation'],
  error: unknown,
  kindOverride?: BrowserStorageIssueKind,
): BrowserStorageIssue => {
  const kind = kindOverride || (isQuotaError(error) ? 'quota' : 'unavailable');
  return {
    kind,
    key,
    operation,
    message: kind === 'auth'
      ? '浏览器无法保存登录状态，请清理本站存储空间后重新登录。'
      : kind === 'quota'
        ? '浏览器本地空间已满。线上任务仍会从服务端读取，部分本地偏好可能无法保存。'
        : '浏览器本地存储暂不可用。线上任务仍可继续使用。',
    technicalMessage: error instanceof Error ? error.message : String(error),
    timestamp: Date.now(),
  };
};

export const reportBrowserStorageIssue = (issue: BrowserStorageIssue) => {
  lastBrowserStorageIssue = issue;
  console.warn('Browser storage operation failed', issue);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<BrowserStorageIssue>(STORAGE_ISSUE_EVENT, { detail: issue }));
  }
};

export const subscribeBrowserStorageIssues = (listener: (issue: BrowserStorageIssue) => void) => {
  if (typeof window === 'undefined') return () => undefined;
  if (lastBrowserStorageIssue) listener(lastBrowserStorageIssue);
  const handler = (event: Event) => listener((event as CustomEvent<BrowserStorageIssue>).detail);
  window.addEventListener(STORAGE_ISSUE_EVENT, handler);
  return () => window.removeEventListener(STORAGE_ISSUE_EVENT, handler);
};

export const safeGetStorageItem = (
  storage: Storage,
  key: string,
  options: { report?: boolean; kind?: BrowserStorageIssueKind } = {},
): BrowserStorageResult<string | null> => {
  try {
    return { ok: true, value: storage.getItem(key) };
  } catch (error) {
    const issue = createIssue(key, 'read', error, options.kind);
    if (options.report !== false) reportBrowserStorageIssue(issue);
    return { ok: false, issue };
  }
};

export const safeSetStorageItem = (
  storage: Storage,
  key: string,
  value: string,
  options: { report?: boolean; kind?: BrowserStorageIssueKind } = {},
): BrowserStorageResult => {
  try {
    storage.setItem(key, value);
    return { ok: true };
  } catch (error) {
    const issue = createIssue(key, 'write', error, options.kind);
    if (options.report !== false) reportBrowserStorageIssue(issue);
    return { ok: false, issue };
  }
};

export const safeRemoveStorageItem = (
  storage: Storage,
  key: string,
  options: { report?: boolean; kind?: BrowserStorageIssueKind } = {},
): BrowserStorageResult => {
  try {
    storage.removeItem(key);
    return { ok: true };
  } catch (error) {
    const issue = createIssue(key, 'remove', error, options.kind);
    if (options.report !== false) reportBrowserStorageIssue(issue);
    return { ok: false, issue };
  }
};

export class AuthStorageError extends Error {
  constructor(public readonly issue: BrowserStorageIssue) {
    super(issue.message);
    this.name = 'AuthStorageError';
  }
}

export const setRequiredAuthStorageItems = (
  storage: Storage,
  entries: Array<[string, string]>,
) => {
  const previous = entries.map(([key]) => [key, safeGetStorageItem(storage, key, { report: false }).value ?? null] as const);
  for (const [key, value] of entries) {
    const result = safeSetStorageItem(storage, key, value, { kind: 'auth' });
    if (!result.ok) {
      previous.forEach(([previousKey, previousValue]) => {
        if (previousValue === null) safeRemoveStorageItem(storage, previousKey, { report: false });
        else safeSetStorageItem(storage, previousKey, previousValue, { report: false });
      });
      throw new AuthStorageError(result.issue!);
    }
  }
};
