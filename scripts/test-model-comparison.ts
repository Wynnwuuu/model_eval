import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  buildComparisonCsv, comparisonSummary, rankedComparisonOptions, validateComparisonDataset,
  type ComparisonDataset,
} from '../src/modelComparison.ts';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url));
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

// Parse the source exports independently of the page's exporter, including quoted cells.
function parseCsv(text: string): Record<string, string>[] {
  const records: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(cell); records.push(row); row = []; cell = '';
    } else cell += char;
  }
  assert.equal(quoted, false, 'Source CSV must not contain an unterminated quoted field');
  if (row.length || cell) { row.push(cell); records.push(row); }
  const header = records.shift();
  assert.ok(header?.length, 'CSV header is required');
  return records.filter(record => record.some(value => value !== '')).map(record => {
    assert.equal(record.length, header.length, 'Every CSV row must match its header');
    return Object.fromEntries(header.map((key, index) => [key, record[index]]));
  });
}

function parseOutput(text: string): unknown {
  const clean = text.trim().replace(/^```(?:json)?\s*\n/i, '').replace(/\n```$/, '');
  return JSON.parse(clean);
}

const originalBytes = read('src/data/evaluation.json');
assert.equal(sha256(originalBytes), 'd2e9c94d2559b718cd4b50ce8e7dcfc305d0a190f23a4b7d622c8bd708a2cf09',
  'The original evaluation dataset must remain byte-for-byte unchanged');
const original = JSON.parse(originalBytes.toString('utf8')) as ComparisonDataset;
const dataset = validateComparisonDataset(JSON.parse(read('src/data/model-comparison.json').toString('utf8')));
const before = JSON.stringify(dataset);
assert.equal(dataset.sourceDatasetId, original.id);
assert.equal(dataset.cases.length, 30);
assert.equal(dataset.variants.length, 3);
assert.deepEqual(new Set(dataset.sources.map(source => source.key)), new Set(['first15_csv', 'colleague_zip']));
assert.deepEqual(dataset.variants, original.variants, 'Real model identities must match the original dataset');

const firstCsvBytes = read('docs/comparison-sources/first15-rankings.csv');
const firstRows = parseCsv(firstCsvBytes.toString('utf8'));
const colleagueRows = parseCsv(read('docs/comparison-sources/colleague-rankings.csv').toString('utf8'));
assert.equal(firstRows.length, 45);
assert.equal(colleagueRows.length, 45);
assert.ok(firstRows.every(row => row.Status === 'ranked' && row.DatasetID === original.id));
assert.equal(dataset.sources.find(source => source.key === 'first15_csv')!.sha256, sha256(firstCsvBytes));
assert.equal(dataset.sources.find(source => source.key === 'colleague_zip')!.sha256,
  'e49eea969afd0bd8669a0c8307264c3690c8a9eeb804ba890257b33279ca1964', 'The colleague ZIP identity is pinned');

const rowsBySource = { first15_csv: firstRows, colleague_zip: colleagueRows };
const verifiedSourceRows = new Set<string>();
let checkedOutputs = 0;
for (const [index, item] of dataset.cases.entries()) {
  const sourceKey = index < 15 ? 'first15_csv' : 'colleague_zip';
  const sourceRows = rowsBySource[sourceKey].filter(row => row.SourceID === item.id);
  const originalItem = original.cases[index];
  assert.equal(item.caseNumber, index + 1);
  assert.equal(item.id, originalItem.id, 'Case numbers must retain the original case order');
  assert.equal(item.sourceKey, sourceKey);
  assert.equal(sourceRows.length, 3, `${item.id}: exactly three source votes are required`);
  assert.deepEqual(sourceRows.map(row => Number(row.Rank)).sort(), [1, 2, 3]);
  assert.equal(new Set(sourceRows.map(row => `${row.ModelName}\0${row.PromptName}`)).size, 3);
  assert.equal(item.category, originalItem.category);
  assert.equal(item.durationSeconds, originalItem.durationSeconds);
  assert.equal(item.audioUrl, originalItem.audioUrl);
  assert.equal(item.audioSha256, originalItem.audioSha256);
  assert.equal(sha256(read(`public${item.audioUrl}`)), item.audioSha256, `${item.id}: original audio bytes`);

  const options = rankedComparisonOptions(dataset, item);
  assert.deepEqual(options.map(option => option.rank), [1, 2, 3]);
  for (const row of sourceRows) {
    // This is deliberately a named join. BlindLabel and source-row position are not identities.
    const variants = dataset.variants.filter(variant => variant.modelName === row.ModelName && variant.promptName === row.PromptName);
    assert.equal(variants.length, 1, `${item.id}: source model and Prompt must have a unique identity`);
    const variant = variants[0];
    if (sourceKey === 'first15_csv') assert.equal(row.VariantID, variant.id);
    else assert.equal(Number(row['题号']), item.caseNumber);
    const option = options.find(candidate => candidate.variantId === variant.id)!;
    assert.ok(option, `${item.id}: ${row.ModelName} is missing`);
    assert.equal(option.rank, Number(row.Rank), `${item.id}: ${row.ModelName} must use its actual source vote`);
    assert.equal(option.original, item.outputs[variant.id]);
    assert.equal(sha256(option.original), option.outputSha256, `${item.id}: ${row.ModelName} output hash`);
    if (index < 15) assert.equal(option.original, originalItem.outputs[variant.id], `${item.id}: keep first-half raw output`);
    else assert.deepEqual(parseOutput(option.original), parseOutput(originalItem.outputs[variant.id]),
      `${item.id}: colleague export must not change any original output value`);
    const key = `${sourceKey}\0${row.SourceID}\0${row.ModelName}\0${row.PromptName}`;
    assert.equal(verifiedSourceRows.has(key), false, 'No source vote may be counted twice');
    verifiedSourceRows.add(key);
    checkedOutputs++;
  }
}
assert.equal(verifiedSourceRows.size, 90);
assert.equal(checkedOutputs, 90);

const summary = comparisonSummary(dataset);
assert.deepEqual(summary.map(row => ({ model: row.variant.modelName, sum: row.rankSum,
  first: row.firstCount, second: row.secondCount, third: row.thirdCount, position: row.position })), [
  { model: 'Qwen3.5-Omni-Plus', sum: 49, first: 16, second: 9, third: 5, position: 1 },
  { model: 'Gemini 3.1 Pro', sum: 58, first: 12, second: 8, third: 10, position: 2 },
  { model: 'Gemini 3.8 Flash', sum: 73, first: 2, second: 13, third: 15, position: 3 },
]);
for (const row of summary) {
  assert.equal(row.averageRank, row.rankSum / 30);
  assert.equal(row.firstRate, row.firstCount / 30);
}
const lastOptions = rankedComparisonOptions(dataset, dataset.cases[29]);
assert.equal(dataset.cases[29].id, 'STM-V-004');
assert.deepEqual(lastOptions.map(option => option.variant.modelName),
  ['Qwen3.5-Omni-Plus', 'Gemini 3.1 Pro', 'Gemini 3.8 Flash']);

// Random display/storage order must never attach a rank to a different model or output.
const reordered = structuredClone(dataset);
reordered.variants.reverse();
reordered.sources.reverse();
for (const item of reordered.cases) {
  item.rankings.reverse();
  item.outputs = Object.fromEntries(Object.entries(item.outputs).reverse());
}
validateComparisonDataset(reordered);
for (const [index, item] of reordered.cases.entries()) {
  assert.deepEqual(rankedComparisonOptions(reordered, item), rankedComparisonOptions(dataset, dataset.cases[index]));
}
assert.deepEqual(comparisonSummary(reordered), summary);

const exportText = buildComparisonCsv(dataset);
assert.ok(exportText.startsWith('\uFEFF'));
assert.equal(buildComparisonCsv(reordered), exportText);
const exportedRows = parseCsv(exportText);
assert.equal(exportedRows.length, 90);
for (const row of exportedRows) {
  const item = dataset.cases.find(candidate => candidate.id === row.SourceID)!;
  const option = rankedComparisonOptions(dataset, item).find(candidate => candidate.variantId === row.VariantID)!;
  assert.ok(option);
  assert.equal(row.DatasetID, original.id);
  assert.equal(Number(row.CaseNumber), item.caseNumber);
  assert.equal(row.ModelName, option.variant.modelName);
  assert.equal(row.PromptName, option.variant.promptName);
  assert.equal(Number(row.Rank), option.rank);
  assert.equal(row.OutputSHA256, option.outputSha256);
  assert.equal(row.ReviewSource, dataset.sources.find(source => source.key === item.sourceKey)!.label);
}
assert.equal(JSON.stringify(dataset), before, 'Validation, ranking, summary and export must not mutate the snapshot');
assert.deepEqual(read('src/data/evaluation.json'), originalBytes, 'Reading the comparison must not rewrite the original dataset');

const invalidCases: [string, (copy: ComparisonDataset) => void][] = [
  ['duplicate rank', copy => { copy.cases[0].rankings[1].rank = copy.cases[0].rankings[0].rank; }],
  ['duplicate ranking identity', copy => { copy.cases[0].rankings[1].variantId = copy.cases[0].rankings[0].variantId; }],
  ['unknown ranking identity', copy => { copy.cases[0].rankings[0].variantId = 'not-a-dataset-variant'; }],
  ['missing ranking', copy => { copy.cases[0].rankings.pop(); }],
  ['rank zero', copy => { copy.cases[0].rankings[0].rank = 0; }],
  ['rank above model count', copy => { copy.cases[0].rankings[0].rank = 4; }],
  ['fractional rank', copy => { copy.cases[0].rankings[0].rank = 1.5; }],
  ['missing output', copy => { delete copy.cases[0].outputs[copy.variants[0].id]; }],
  ['empty output', copy => { copy.cases[0].outputs[copy.variants[0].id] = ' '; }],
  ['unknown extra output', copy => { copy.cases[0].outputs.unrelated = 'unrelated output'; }],
  ['invalid output hash', copy => { copy.cases[0].rankings[0].outputSha256 = 'invalid'; }],
  ['invalid audio hash', copy => { copy.cases[0].audioSha256 = 'invalid'; }],
  ['unknown review source', copy => { copy.cases[0].sourceKey = 'unknown'; }],
  ['duplicate source', copy => { copy.sources.push({ ...copy.sources[0] }); }],
  ['duplicate model definition', copy => { copy.variants[1] = { ...copy.variants[0] }; }],
  ['duplicate case identity', copy => { copy.cases[1].id = copy.cases[0].id; }],
  ['wrong case number', copy => { copy.cases[0].caseNumber = 2; }],
];
for (const [label, mutate] of invalidCases) {
  const copy = structuredClone(dataset);
  mutate(copy);
  assert.throws(() => validateComparisonDataset(copy), label);
}
console.log(`Model comparison passed: 30 cases, ${checkedOutputs} independently joined source votes and output hashes, 30 audio hashes, exact first-half text, semantic second-half fidelity, ZIP final vote, stable order, CSV export, immutable dataset and ${invalidCases.length} malformed snapshots rejected.`);
