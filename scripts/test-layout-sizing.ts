import assert from 'node:assert/strict';

import {
  APP_SIDEBAR_WIDTH,
  DATASET_COLUMN_WIDTH,
  DATASET_LEFT_PANE_WIDTH,
  DATASET_RIGHT_PANE_WIDTH,
  clampDatasetColumnWidth,
  normalizeAppShellLayoutPreference,
  normalizeDatasetColumnWidthStore,
  normalizeDatasetRepositoryLayoutPreference,
  parseAppShellLayoutPreference,
  parseDatasetColumnWidthStore,
  parseDatasetRepositoryLayoutPreference,
  removeDatasetColumnWidth,
  renameDatasetColumnWidths,
  resizeDatasetRepositoryPane,
  setDatasetColumnWidth,
} from '../src/layoutSizing';

assert.deepEqual(normalizeAppShellLayoutPreference(undefined), {
  sidebarWidth: APP_SIDEBAR_WIDTH.defaultValue,
});
assert.equal(normalizeAppShellLayoutPreference({ sidebarWidth: 10 }).sidebarWidth, APP_SIDEBAR_WIDTH.min);
assert.equal(normalizeAppShellLayoutPreference({ sidebarWidth: 1000 }).sidebarWidth, APP_SIDEBAR_WIDTH.max);
assert.deepEqual(parseAppShellLayoutPreference('{invalid'), {
  sidebarWidth: APP_SIDEBAR_WIDTH.defaultValue,
});

assert.deepEqual(normalizeDatasetRepositoryLayoutPreference({ left: 300, right: 420 }), {
  leftWidth: 300,
  rightWidth: 420,
});
assert.deepEqual(normalizeDatasetRepositoryLayoutPreference({ leftWidth: 20, rightWidth: 900 }), {
  leftWidth: DATASET_LEFT_PANE_WIDTH.min,
  rightWidth: DATASET_RIGHT_PANE_WIDTH.max,
});
assert.deepEqual(parseDatasetRepositoryLayoutPreference(null), {
  leftWidth: DATASET_LEFT_PANE_WIDTH.defaultValue,
  rightWidth: DATASET_RIGHT_PANE_WIDTH.defaultValue,
});
assert.deepEqual(resizeDatasetRepositoryPane({
  pane: 'left',
  targetWidth: 460,
  current: { leftWidth: 280, rightWidth: 360 },
  containerWidth: 1120,
}), { leftWidth: 248, rightWidth: 360 });
assert.deepEqual(resizeDatasetRepositoryPane({
  pane: 'right',
  targetWidth: 620,
  current: { leftWidth: 220, rightWidth: 360 },
  containerWidth: 1400,
}), { leftWidth: 220, rightWidth: 620 });
assert.deepEqual(resizeDatasetRepositoryPane({
  pane: 'left',
  targetWidth: 480,
  current: { leftWidth: 280, rightWidth: 360 },
  containerWidth: 900,
  generationMode: true,
}), { leftWidth: 404, rightWidth: 360 });

assert.equal(clampDatasetColumnWidth(20), DATASET_COLUMN_WIDTH.min);
assert.equal(clampDatasetColumnWidth(1200), DATASET_COLUMN_WIDTH.max);
assert.equal(clampDatasetColumnWidth('not-a-number', 280), 280);
assert.deepEqual(parseDatasetColumnWidthStore('{broken'), {});
assert.deepEqual(normalizeDatasetColumnWidthStore({
  'dataset-a': { prompt: 320, video: 5000, ignored: 'bad' },
  invalid: 'not-an-object',
}), {
  'dataset-a': { prompt: 320, video: DATASET_COLUMN_WIDTH.max },
});

let store = setDatasetColumnWidth({}, 'dataset-a', 'prompt', 320);
store = setDatasetColumnWidth(store, 'dataset-b', 'prompt', 560);
assert.equal(store['dataset-a'].prompt, 320);
assert.equal(store['dataset-b'].prompt, 560);

store = renameDatasetColumnWidths(store, 'dataset-a', [['prompt', '完整Prompt']]);
assert.equal(store['dataset-a'].prompt, undefined);
assert.equal(store['dataset-a']['完整Prompt'], 320);
assert.equal(store['dataset-b'].prompt, 560);

store = removeDatasetColumnWidth(store, 'dataset-a', '完整Prompt');
assert.equal(store['dataset-a'], undefined);
assert.equal(store['dataset-b'].prompt, 560);

const swapped = renameDatasetColumnWidths(
  { dataset: { modelA: 240, modelB: 420 } },
  'dataset',
  [['modelA', 'modelB'], ['modelB', 'modelA']],
);
assert.deepEqual(swapped.dataset, { modelA: 420, modelB: 240 });

console.log('Layout sizing regression checks passed.');
