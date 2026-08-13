import { extractMediaUrls } from '../../mediaUrlUtils.js';

export const GENERATION_FAILURE_CELL_PREFIX = '生成失败（已跳过，不再重试）';

type GenerationFailureCellInput = {
  status?: string;
  error?: {
    code?: string;
    message?: string;
    httpStatus?: number;
    errorName?: string;
    transportCode?: string;
    errorType?: string;
    errorCode?: string;
    retryable?: boolean;
  };
  providerTaskId?: string;
  providerJobId?: string;
  requestId?: string;
  id?: string;
};

const safeDiagnosticText = (value: unknown) => String(value || '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  .replace(/https?:\/\/[^\s"'<>]+/gi, candidate => {
    try {
      const url = new URL(candidate);
      return `${url.origin}${url.pathname}${url.search ? '?[redacted]' : ''}`;
    } catch {
      return '[redacted-url]';
    }
  })
  .replace(/\b(?:authorization|credential|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|password)\s*[:=]\s*\S+/gi, '[redacted-credential]')
  .replace(/(?:file:\/\/\/|[A-Za-z]:\\)[^\r\n]*/g, '[redacted-path]')
  .trim()
  .slice(0, 2_000);

export const sanitizeGenerationFailureError = (error: GenerationFailureCellInput['error']) => {
  if (!error) return undefined;
  return {
    ...(error.code ? { code: safeDiagnosticText(error.code) } : {}),
    ...(error.message ? { message: safeDiagnosticText(error.message) } : {}),
    ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}),
    ...(error.errorName ? { errorName: safeDiagnosticText(error.errorName) } : {}),
    ...(error.transportCode ? { transportCode: safeDiagnosticText(error.transportCode) } : {}),
    ...(error.errorType ? { errorType: safeDiagnosticText(error.errorType) } : {}),
    ...(error.errorCode ? { errorCode: safeDiagnosticText(error.errorCode) } : {}),
    ...(error.retryable !== undefined ? { retryable: error.retryable } : {}),
  };
};

export const formatGenerationFailureCell = (item: GenerationFailureCellInput) => {
  const error = sanitizeGenerationFailureError(item.error) || {};
  const lines = [
    GENERATION_FAILURE_CELL_PREFIX,
    `错误码：${safeDiagnosticText(error.code || item.status || 'GENERATION_FAILED')}`,
    `原因：${safeDiagnosticText(error.message || '模型生成失败，且操作者已确认不再重试。')}`,
    error.httpStatus ? `HTTP 状态：${error.httpStatus}` : '',
    error.errorType ? `Aion 错误类型：${safeDiagnosticText(error.errorType)}` : '',
    error.errorCode ? `Aion 错误码：${safeDiagnosticText(error.errorCode)}` : '',
    error.transportCode ? `传输错误：${safeDiagnosticText(error.transportCode)}` : '',
    error.errorName ? `错误类型：${safeDiagnosticText(error.errorName)}` : '',
    error.retryable !== undefined ? `上游标记可重试：${error.retryable ? '是' : '否'}` : '',
    `请求 ID：${safeDiagnosticText(item.providerTaskId || item.providerJobId || item.requestId || item.id || '未返回')}`,
  ];
  return lines.filter(Boolean).join('\n');
};

export const isGenerationFailureCell = (value: unknown) => (
  typeof value === 'string' && value.trimStart().startsWith(GENERATION_FAILURE_CELL_PREFIX)
);

export type ExcludedGenerationEvaluationRow = {
  row: Record<string, any>;
  reason: 'generation_failed' | 'missing_media';
  columns: string[];
};

export const partitionGenerationEvaluationRows = (
  rows: Record<string, any>[],
  mediaOutputColumns: string[],
) => {
  const included: Record<string, any>[] = [];
  const excluded: ExcludedGenerationEvaluationRow[] = [];
  for (const row of rows) {
    const failedColumns = mediaOutputColumns.filter(column => isGenerationFailureCell(row[column]));
    if (failedColumns.length) {
      excluded.push({ row, reason: 'generation_failed', columns: failedColumns });
      continue;
    }
    const missingColumns = mediaOutputColumns.filter(column => !extractMediaUrls(row[column]).length);
    if (missingColumns.length) {
      excluded.push({ row, reason: 'missing_media', columns: missingColumns });
      continue;
    }
    included.push(row);
  }
  return { included, excluded };
};
