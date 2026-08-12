export interface WidthRange {
  min: number;
  max: number;
  defaultValue: number;
}

export interface AppShellLayoutPreference {
  sidebarWidth: number;
}

export interface DatasetRepositoryLayoutPreference {
  leftWidth: number;
  rightWidth: number;
}

export type DatasetColumnWidthStore = Record<string, Record<string, number>>;

export const APP_SIDEBAR_WIDTH: WidthRange = {
  min: 208,
  max: 400,
  defaultValue: 256,
};

export const DATASET_LEFT_PANE_WIDTH: WidthRange = {
  min: 220,
  max: 480,
  defaultValue: 280,
};

export const DATASET_RIGHT_PANE_WIDTH: WidthRange = {
  min: 300,
  max: 720,
  defaultValue: 360,
};

export const DATASET_COLUMN_WIDTH = {
  min: 96,
  max: 960,
} as const;

export const DATASET_REPOSITORY_MIN_CENTER_WIDTH = 480;
export const DATASET_REPOSITORY_MIN_COMPACT_CENTER_WIDTH = 320;

export const clampWidth = (value: unknown, range: WidthRange) => {
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) return range.defaultValue;
  return Math.round(Math.max(range.min, Math.min(range.max, numericValue)));
};

const parseStoredJson = (raw: string | null): unknown => {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

export const normalizeAppShellLayoutPreference = (value: unknown): AppShellLayoutPreference => {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { sidebarWidth: clampWidth(candidate.sidebarWidth, APP_SIDEBAR_WIDTH) };
};

export const parseAppShellLayoutPreference = (raw: string | null) =>
  normalizeAppShellLayoutPreference(parseStoredJson(raw));

export const normalizeDatasetRepositoryLayoutPreference = (
  value: unknown,
): DatasetRepositoryLayoutPreference => {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    // Keep accepting the previous { left, right } storage shape.
    leftWidth: clampWidth(candidate.leftWidth ?? candidate.left, DATASET_LEFT_PANE_WIDTH),
    rightWidth: clampWidth(candidate.rightWidth ?? candidate.right, DATASET_RIGHT_PANE_WIDTH),
  };
};

export const parseDatasetRepositoryLayoutPreference = (raw: string | null) =>
  normalizeDatasetRepositoryLayoutPreference(parseStoredJson(raw));

export const resizeDatasetRepositoryPane = ({
  pane,
  targetWidth,
  current,
  containerWidth,
  generationMode = false,
}: {
  pane: 'left' | 'right';
  targetWidth: number;
  current: DatasetRepositoryLayoutPreference;
  containerWidth: number;
  generationMode?: boolean;
}): DatasetRepositoryLayoutPreference => {
  const normalized = normalizeDatasetRepositoryLayoutPreference(current);
  const gapWidth = generationMode ? 16 : 32;
  const minimumSideWidth = DATASET_LEFT_PANE_WIDTH.min
    + (generationMode ? 0 : DATASET_RIGHT_PANE_WIDTH.min);
  const availableCenterWidth = Math.max(
    DATASET_REPOSITORY_MIN_COMPACT_CENTER_WIDTH,
    containerWidth - minimumSideWidth - gapWidth,
  );
  const centerWidth = Math.min(DATASET_REPOSITORY_MIN_CENTER_WIDTH, availableCenterWidth);
  const maximumSideWidth = Math.max(minimumSideWidth, containerWidth - centerWidth - gapWidth);

  if (pane === 'left') {
    const requested = clampWidth(targetWidth, DATASET_LEFT_PANE_WIDTH);
    const available = generationMode
      ? maximumSideWidth
      : maximumSideWidth - normalized.rightWidth;
    return {
      ...normalized,
      leftWidth: Math.max(DATASET_LEFT_PANE_WIDTH.min, Math.min(requested, available)),
    };
  }

  if (generationMode) return normalized;
  const requested = clampWidth(targetWidth, DATASET_RIGHT_PANE_WIDTH);
  return {
    ...normalized,
    rightWidth: Math.max(
      DATASET_RIGHT_PANE_WIDTH.min,
      Math.min(requested, maximumSideWidth - normalized.leftWidth),
    ),
  };
};

export const clampDatasetColumnWidth = (value: unknown, fallback = 180) => {
  const numericValue = typeof value === 'number' ? value : Number(value);
  const resolvedFallback = Number.isFinite(fallback)
    ? Math.max(DATASET_COLUMN_WIDTH.min, Math.min(DATASET_COLUMN_WIDTH.max, fallback))
    : 180;
  if (!Number.isFinite(numericValue)) return Math.round(resolvedFallback);
  return Math.round(Math.max(DATASET_COLUMN_WIDTH.min, Math.min(DATASET_COLUMN_WIDTH.max, numericValue)));
};

export const normalizeDatasetColumnWidthStore = (value: unknown): DatasetColumnWidthStore => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([datasetId, widths]) => Boolean(datasetId) && widths && typeof widths === 'object' && !Array.isArray(widths))
      .map(([datasetId, widths]) => [
        datasetId,
        Object.fromEntries(
          Object.entries(widths as Record<string, unknown>)
            .filter(([columnKey, width]) => Boolean(columnKey) && Number.isFinite(Number(width)))
            .map(([columnKey, width]) => [columnKey, clampDatasetColumnWidth(width)]),
        ),
      ])
      .filter(([, widths]) => Object.keys(widths).length > 0),
  );
};

export const parseDatasetColumnWidthStore = (raw: string | null) =>
  normalizeDatasetColumnWidthStore(parseStoredJson(raw));

export const setDatasetColumnWidth = (
  store: DatasetColumnWidthStore,
  datasetId: string,
  columnKey: string,
  width: number,
): DatasetColumnWidthStore => {
  if (!datasetId || !columnKey) return store;
  return {
    ...store,
    [datasetId]: {
      ...(store[datasetId] || {}),
      [columnKey]: clampDatasetColumnWidth(width),
    },
  };
};

export const renameDatasetColumnWidths = (
  store: DatasetColumnWidthStore,
  datasetId: string,
  renameEntries: ReadonlyArray<readonly [string, string]>,
): DatasetColumnWidthStore => {
  const current = store[datasetId];
  if (!current || renameEntries.length === 0) return store;

  const next = { ...current };
  renameEntries.forEach(([oldKey, newKey]) => {
    if (!oldKey || !newKey || oldKey === newKey || current[oldKey] === undefined) return;
    delete next[oldKey];
  });
  renameEntries.forEach(([oldKey, newKey]) => {
    if (!oldKey || !newKey || oldKey === newKey || current[oldKey] === undefined) return;
    next[newKey] = current[oldKey];
  });

  return { ...store, [datasetId]: next };
};

export const removeDatasetColumnWidth = (
  store: DatasetColumnWidthStore,
  datasetId: string,
  columnKey: string,
): DatasetColumnWidthStore => {
  const current = store[datasetId];
  if (!current || current[columnKey] === undefined) return store;

  const next = { ...current };
  delete next[columnKey];
  if (Object.keys(next).length === 0) {
    const nextStore = { ...store };
    delete nextStore[datasetId];
    return nextStore;
  }
  return { ...store, [datasetId]: next };
};
