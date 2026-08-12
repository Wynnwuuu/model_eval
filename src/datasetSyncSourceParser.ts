import Papa from 'papaparse';

export interface ParsedDatasetSyncManualSource {
  kind: 'manual';
  headers: string[];
  rows: Record<string, unknown>[];
  label: string;
}

export const parseDatasetSyncManualSource = (text: string, label: string): ParsedDatasetSyncManualSource => {
  const sourceText = text.replace(/^\uFEFF/, '');
  const trimmed = sourceText.trim();
  if (!trimmed) throw new Error('同步内容为空。');
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    const rows = Array.isArray(parsed) ? parsed : parsed?.items;
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
      throw new Error('JSON 必须是对象数组，或包含 items 对象数组。');
    }
    const headers: string[] = [];
    const seen = new Set<string>();
    rows.forEach(row => Object.keys(row).forEach(header => {
      if (!seen.has(header)) {
        seen.add(header);
        headers.push(header);
      }
    }));
    return { kind: 'manual', headers, rows, label };
  }

  const firstLine = sourceText.split(/\r?\n/).find(line => line.trim()) || '';
  const delimiter = firstLine.includes('\t') ? '\t' : undefined;
  const parsed = Papa.parse<Record<string, unknown>>(sourceText, {
    header: true,
    skipEmptyLines: 'greedy',
    ...(delimiter ? { delimiter } : {}),
  });
  if (parsed.errors.length) throw new Error(parsed.errors[0].message);
  const headers = parsed.meta.fields || [];
  if (!headers.length) throw new Error('没有识别到表头。');
  return { kind: 'manual', headers, rows: parsed.data, label };
};
