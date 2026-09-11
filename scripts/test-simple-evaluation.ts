import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  blindVariantOrder, buildSimpleResultsCsv, isCompleteOrder, loadSimpleSession, moveSimpleVariant,
  persistSimpleSession, simpleStorageKey, SimpleStorageConflictError, validateSimpleDataset,
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
const moved = moveSimpleVariant(order, order[4], 0);
assert.equal(moved[0], order[4]);
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
assert.equal(csv.trim().split('\r\n').length, 7); // Header, five ranked variants, one skipped case.
assert.ok(csv.includes(state.reviewerId));
const firstRow = csv.split('\r\n')[1];
assert.ok(firstRow.includes(caseId));
assert.ok(firstRow.includes(moved[0]));
assert.ok(firstRow.includes(dataset.variants.find(variant => variant.id === moved[0])!.modelName));
assert.ok(firstRow.endsWith('"E","1"'));
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
console.log(`Simple evaluation passed: ${dataset.cases.length} cases / five variants, stable anonymization, strict ranking, dataset isolation, exact CSV identities and failed-save preservation.`);
