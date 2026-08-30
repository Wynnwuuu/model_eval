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
  const parsed = Papa.parse<unknown[]>(sourceText, {
    header: false,
    skipEmptyLines: 'greedy',
    ...(delimiter ? { delimiter } : {}),
  });
  if (parsed.errors.length) throw new Error(parsed.errors[0].message);
  const [headerRow, ...dataRows] = parsed.data;
  const headers = (headerRow || []).map(value => String(value ?? ''));
  if (!headers.length) throw new Error('没有识别到表头。');
  if (headers.some(header => !header.trim())) throw new Error('数据源包含空列名。');
  if (new Set(headers).size !== headers.length) throw new Error('数据源包含重复列名。');
  const rows = dataRows.map((values, index) => {
    if (values.length > headers.length) throw new Error(`第 ${index + 2} 行包含超出表头的单元格。`);
    return Object.fromEntries(headers.map((header, columnIndex) => [header, values[columnIndex] ?? '']));
  });
  return { kind: 'manual', headers, rows, label };
};
