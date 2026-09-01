import assert from 'node:assert/strict';
import Papa from 'papaparse';

import { buildDatasetCsv } from '../src/datasetCsvExport';
import type { EvalDataset } from '../src/types';

const dataset: EvalDataset = {
  id: 'csv-export-regression',
  name: 'CSV export regression',
  description: '',
  tags: [],
  inputSchema: [
    { key: 'case_id', label: 'case_id', type: 'text', role: 'case_id' },
    { key: 'prompt', label: 'prompt', type: 'text', role: 'input' },
    { key: 'result', label: 'result', type: 'video_url', role: 'output', previewType: 'video' },
    { key: 'result_status', label: 'result_status', type: 'text', role: 'metadata' },
    { key: 'schema_only', label: 'schema_only', type: 'text', role: 'system' },
  ],
  items: [
    {
      case_id: 'case-1',
      prompt: 'first row has no result',
      __datasetItemId: 'item-1',
      _originalData: { private: true },
    },
    {
      case_id: 'case-2',
      prompt: 'comma, quote " and\nnewline',
      result: 'https://example.com/result-2.mp4',
      result_status: 'succeeded',
      late_business_column: ['kept', 'as-json'],
      __datasetItemId: 'item-2',
      __generationResultMeta: { result: { stale: false } },
    },
  ],
  columnMappings: {
    caseId: 'case_id',
    inputColumns: ['prompt'],
    outputColumns: ['result'],
    dimensionColumns: [],
    referenceColumns: [],
    standard: { case_id: 'case_id', full_prompt: 'prompt' },
  },
  createdAt: 1,
  updatedAt: 2,
};

const csv = buildDatasetCsv(dataset);
const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });

assert.deepEqual(
  parsed.meta.fields,
  ['case_id', 'prompt', 'result', 'result_status', 'schema_only', 'late_business_column'],
  'CSV headers must use the complete dataset projection instead of row zero',
);
assert.equal(parsed.data.length, 2, 'all cases must be exported');
assert.equal(parsed.data[0].result, '', 'a missing first-row value must remain an empty cell');
assert.equal(parsed.data[0].schema_only, '', 'an entirely empty schema column must still be exported');
assert.equal(parsed.data[1].result, 'https://example.com/result-2.mp4');
assert.equal(parsed.data[1].late_business_column, '["kept","as-json"]');
assert.equal(parsed.data[1].prompt, 'comma, quote " and\nnewline', 'CSV escaping must preserve raw text');
assert.ok(!parsed.meta.fields?.some(field => field.startsWith('__') || field === '_originalData'));

console.log('Dataset CSV export tests passed.');
