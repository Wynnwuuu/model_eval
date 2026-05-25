const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const storageMode = String(import.meta.env.VITE_STORAGE_MODE || '').toLowerCase();
const legacyBackendFlag = String(import.meta.env.VITE_USE_API_BACKEND || '').toLowerCase();

export const IS_OFFLINE_LOCAL_DEMO =
  storageMode === 'local' ||
  legacyBackendFlag === 'false';

export const USE_SHARED_DATA_SOURCE = !IS_OFFLINE_LOCAL_DEMO;

const explicitApiBaseUrl = trimTrailingSlash(String(import.meta.env.VITE_API_BASE_URL || ''));

export const API_BASE_URL = USE_SHARED_DATA_SOURCE
  ? explicitApiBaseUrl
  : '';

export const DATA_SOURCE_LABEL = IS_OFFLINE_LOCAL_DEMO ? '离线本地 demo' : '共享后端';
