// js/data-portability.js
import { normalizeStatus } from './status.js';

const BACKUP_APP = 'FigureTracker';
const BACKUP_VERSION = 2;
const LAST_BACKUP_KEY = 'figureTracker:lastBackupBeforeImport';

export { normalizeStatus };

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsText(file);
  });
}

function parseBackupJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Файл не JSON или повреждён');
  }
}

function getBackupPayload(rawData) {
  if (!isPlainObject(rawData)) {
    throw new Error('JSON не похож на backup Figure Tracker');
  }

  if (rawData.app === BACKUP_APP && isPlainObject(rawData.data)) {
    if (!Array.isArray(rawData.data.items)) {
      throw new Error('В backup нет data.items');
    }
    return { format: 'v2', source: rawData.data };
  }

  if (Array.isArray(rawData.items)) {
    return { format: 'legacy', source: rawData };
  }

  throw new Error('JSON не похож на backup Figure Tracker: нет items или data.items');
}

function normalizeItem(item) {
  const next = isPlainObject(item) ? { ...item } : {};
  const statusKey = normalizeStatus(next.status || next.statusKey);
  if (statusKey) next.statusKey = statusKey;
  return next;
}

function normalizeWish(wish) {
  return isPlainObject(wish) ? { ...wish } : {};
}

export function exportStateToJson(state) {
  const data = isPlainObject(state) ? clone(state) : {};
  data.items = Array.isArray(data.items) ? data.items : [];
  data.wishlist = Array.isArray(data.wishlist) ? data.wishlist : [];
  data.settings = isPlainObject(data.settings) ? data.settings : {};
  data.rates = isPlainObject(data.rates) ? data.rates : {};

  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data
  };
}

export function downloadJsonBackup(state) {
  const backup = exportStateToJson(state);
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `figure-tracker-backup-v${BACKUP_VERSION}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function migrateData(rawData, currentState = {}) {
  const { source } = getBackupPayload(rawData);
  const current = isPlainObject(currentState) ? currentState : {};
  const migrated = { ...clone(current), ...clone(source) };

  migrated.items = source.items.map(normalizeItem);
  migrated.wishlist = Array.isArray(source.wishlist) ? source.wishlist.map(normalizeWish) : [];
  migrated.settings = isPlainObject(source.settings)
    ? { ...(isPlainObject(current.settings) ? clone(current.settings) : {}), ...clone(source.settings) }
    : (isPlainObject(current.settings) ? clone(current.settings) : {});
  migrated.rates = isPlainObject(source.rates)
    ? { ...(isPlainObject(current.rates) ? clone(current.rates) : { EUR: 1 }), ...clone(source.rates) }
    : (isPlainObject(current.rates) ? clone(current.rates) : { EUR: 1, USD: 1, JPY: 1 });

  return migrated;
}

function saveLastBackupBeforeImport(currentState) {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, JSON.stringify({
      createdAt: new Date().toISOString(),
      state: clone(currentState)
    }));
  } catch {
    // localStorage may be unavailable or full; existing local backup still covers the main path.
  }
}

function showImportError(error, deps = {}) {
  const message = error?.message || 'Не удалось импортировать backup';
  if (typeof deps.toast === 'function') deps.toast(message);
  else alert(message);
}

export async function importStateFromFile(file, currentState, options = {}) {
  if (!file) return { cancelled: true };

  const rawData = parseBackupJson(await readFileAsText(file));
  const migrated = migrateData(rawData, currentState);
  const itemCount = migrated.items.length;
  const confirmImport = options.confirm || ((message) => confirm(message));

  if (!confirmImport(`Импортировать ${itemCount} записей? Текущие данные будут заменены.`)) {
    return { cancelled: true };
  }

  if (typeof options.createLocalBackup === 'function') {
    options.createLocalBackup('before-import', true);
  }
  saveLastBackupBeforeImport(currentState);

  Object.keys(currentState).forEach(key => delete currentState[key]);
  Object.assign(currentState, migrated);

  if (options.appState) options.appState.selectedOrder = null;
  if (typeof options.persist === 'function') options.persist();
  if (typeof options.render === 'function') options.render();
  if (typeof options.refreshRates === 'function') options.refreshRates();
  if (typeof options.toast === 'function') options.toast('Импорт успешен');

  return { cancelled: false, state: migrated, itemCount };
}

export function bindImportFileInput(inputEl, deps = {}) {
  if (!inputEl || inputEl.dataset.dataPortabilityBound === '1') return;
  inputEl.dataset.dataPortabilityBound = '1';

  inputEl.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      await importStateFromFile(file, deps.state, deps);
    } catch (error) {
      showImportError(error, deps);
    } finally {
      event.target.value = '';
    }
  });
}
