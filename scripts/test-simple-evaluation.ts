import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  blindVariantOrder, buildSimpleResultsCsv, isCompleteOrder, loadSimpleSession, moveSimpleVariant,
  persistSimpleSession, simpleStorageKey, SimpleStorageConflictError, validateSimpleDataset, type SimpleDataset,
} from '../src/simpleEvaluation.ts';

const dataset = validateSimpleDataset(JSON.parse(readFileSync(new URL('../src/data/evaluation.json', import.meta.url), 'utf8')));
const cells = new Map<string, string>();
const storage = { getItem: (key: string) => cells.get(key) || null, setItem: (key: string, value: string) => { cells.set(key, value); } };
const state = loadSimpleSession(dataset, storage);
assert.equal(state.datasetId, dataset.id);
assert.deepEqual(state.reviews, {});
assert.equal(loadSimpleSession(dataset, storage).reviewerId, state.reviewerId);
const caseId = dataset.cases[0].id;
const order = blindVariantOrder(dataset, state.reviewerId, caseId);
assert.deepEqual(blindVariantOrder(dataset, state.reviewerId, caseId), order);
assert.ok(isCompleteOrder(order, dataset.variants.map(variant => variant.id)));
assert.equal(isCompleteOrder([order[0], order[0], ...order.slice(2)], order), false);
assert.equal(isCompleteOrder([...order.slice(0, -1), 'unrelated-variant'], order), false);
assert.equal(isCompleteOrder(order.slice(1), order), false);
assert.equal(isCompleteOrder([...order, 'extra-variant'], order), false);
const moved = moveSimpleVariant(order, order[order.length - 1], 0);
assert.equal(moved[0], order[order.length - 1]);
assert.deepEqual(order, blindVariantOrder(dataset, state.reviewerId, caseId));
assert.deepEqual(moveSimpleVariant(order, 'missing', 0), order);
const answered = { ...state, currentIndex: 1, reviews: {
  [caseId]: { status: 'ranked' as const, order: moved, optionOrder: order, savedAt: '2026-09-11T12:00:00.000Z' },
  [dataset.cases[1].id]: { status: 'skipped' as const, order: [], optionOrder: blindVariantOrder(dataset, state.reviewerId, dataset.cases[1].id), savedAt: '2026-09-11T12:01:00.000Z' },
} };
const saved = persistSimpleSession(dataset, answered, storage);
assert.deepEqual(loadSimpleSession(dataset, storage), saved);
assert.equal(saved.revision, state.revision + 1);
assert.throws(() => persistSimpleSession(dataset, answered, storage), SimpleStorageConflictError);
const serialized = cells.get(simpleStorageKey(dataset.id))!;
assert.ok(serialized.length < 5000);
assert.ok(!serialized.includes(dataset.cases[0].outputs[order[0]]));
assert.ok(!serialized.includes('outputs'));
const csv = buildSimpleResultsCsv(dataset, answered);
assert.ok(csv.startsWith('\uFEFF'));
assert.equal(csv.trim().split('\r\n').length, dataset.variants.length + 2); // Header, one row per ranked variant, one skipped case.
assert.ok(csv.includes(state.reviewerId));
const firstRow = csv.split('\r\n')[1];
assert.ok(firstRow.includes(caseId));
assert.ok(firstRow.includes(moved[0]));
assert.ok(firstRow.includes(dataset.variants.find(variant => variant.id === moved[0])!.modelName));
assert.ok(firstRow.endsWith(`"${String.fromCharCode(64 + order.length)}","1"`));
assert.ok(csv.includes('"skipped"'));

// A different dataset fingerprint opens a separate state and cannot reuse these votes.
const changedDataset = { ...dataset, id: dataset.id + '-changed' };
const changed = loadSimpleSession(changedDataset, storage);
assert.equal(changed.reviewerId, state.reviewerId);
assert.deepEqual(changed.reviews, {});
assert.throws(() => persistSimpleSession(changedDataset, answered, storage));
const before = cells.get(simpleStorageKey(dataset.id));
assert.throws(() => persistSimpleSession(dataset, { ...saved, currentIndex: 2 }, {
  getItem: storage.getItem, setItem: () => { throw new Error('quota exceeded'); },
}));
assert.equal(cells.get(simpleStorageKey(dataset.id)), before);
const invalidReview = { ...answered, reviews: { [caseId]: { ...answered.reviews[caseId], order: [order[0]] } } };
assert.throws(() => persistSimpleSession(dataset, invalidReview, storage));
const malformed = JSON.stringify({ ...answered, datasetId: 'unrelated-dataset' });
cells.set(simpleStorageKey(dataset.id), malformed);
assert.throws(() => loadSimpleSession(dataset, storage));
assert.equal(cells.get(simpleStorageKey(dataset.id)), malformed);

function fixture(count: number): SimpleDataset {
  const variants = Array.from({ length: count }, (_, index) => ({ id: `variant-${index}`, name: `Prompt ${index}`, modelName: 'same-model', promptName: `Prompt ${index}`, isBaseline: false }));
  return {
    id: `fixture-${count}-variants`, title: 'Candidate boundary fixture', variants,
    cases: [{ id: 'shared-audio', category: 'test', audioUrl: '/audio/test.wav', durationSeconds: 1, outputs: Object.fromEntries(variants.map(variant => [variant.id, `${variant.name} analysis`])) }],
  };
}

// Both the new two-Prompt comparison and previous five-variant data remain usable.
const legacyFixture = validateSimpleDataset(fixture(5));
const currentFixture = validateSimpleDataset(fixture(2));
for (const boundary of [legacyFixture, currentFixture]) {
  const boundaryState = loadSimpleSession(boundary, storage);
  const boundaryOrder = blindVariantOrder(boundary, boundaryState.reviewerId, boundary.cases[0].id);
  assert.ok(isCompleteOrder(boundaryOrder, boundary.variants.map(variant => variant.id)));
  const boundarySaved = persistSimpleSession(boundary, { ...boundaryState, reviews: {
    [boundary.cases[0].id]: { status: 'ranked', order: [...boundaryOrder].reverse(), optionOrder: boundaryOrder, savedAt: '2026-09-11T12:00:00.000Z' },
  } }, storage);
  assert.deepEqual(loadSimpleSession(boundary, storage), boundarySaved);
  assert.equal(buildSimpleResultsCsv(boundary, boundarySaved).trim().split('\r\n').length, boundary.variants.length + 1);
}
const legacySaved = loadSimpleSession(legacyFixture, storage);
const currentSaved = loadSimpleSession(currentFixture, storage);
assert.equal(legacySaved.reviews['shared-audio'].order.length, 5);
assert.equal(currentSaved.reviews['shared-audio'].order.length, 2);
assert.equal(legacySaved.reviewerId, currentSaved.reviewerId);
assert.throws(() => persistSimpleSession(currentFixture, legacySaved, storage));
assert.equal(loadSimpleSession(legacyFixture, storage).reviews['shared-audio'].order.length, 5);
for (const invalidCount of [0, 1, 6]) assert.throws(() => validateSimpleDataset(fixture(invalidCount)));
assert.throws(() => validateSimpleDataset({ ...currentFixture, variants: [currentFixture.variants[0], currentFixture.variants[0]] }));
assert.throws(() => validateSimpleDataset({ ...currentFixture, cases: [{ ...currentFixture.cases[0], outputs: { [currentFixture.variants[0].id]: 'one result only' } }] }));
console.log(`Simple evaluation passed: ${dataset.cases.length} cases / ${dataset.variants.length} variants, 2–5 boundaries, stable anonymization, exact membership, old/new dataset isolation, CSV identities and failed-save preservation.`);
