// js/clipboard-import.js
import { formatReleaseDate, mergeTags, parseReleaseDateParts } from './product-meta.js';

const FIGURE_TRACKER_APP = 'FigureTracker';

const MESSAGES = {
  emptyClipboard: '\u0411\u0443\u0444\u0435\u0440 \u043E\u0431\u043C\u0435\u043D\u0430 \u043F\u0443\u0441\u0442',
  noClipboardAccess: '\u0411\u0440\u0430\u0443\u0437\u0435\u0440 \u043D\u0435 \u0434\u0430\u043B \u0434\u043E\u0441\u0442\u0443\u043F \u043A \u0431\u0443\u0444\u0435\u0440\u0443 \u043E\u0431\u043C\u0435\u043D\u0430',
  notJson: '\u0412 \u0431\u0443\u0444\u0435\u0440\u0435 \u043D\u0435\u0442 JSON \u0434\u0430\u043D\u043D\u044B\u0445 \u0442\u043E\u0432\u0430\u0440\u0430',
  unknownFormat: '\u0424\u043E\u0440\u043C\u0430\u0442 \u0434\u0430\u043D\u043D\u044B\u0445 \u0442\u043E\u0432\u0430\u0440\u0430 \u043D\u0435 \u0440\u0430\u0441\u043F\u043E\u0437\u043D\u0430\u043D',
  success: '\u2705 \u0414\u0430\u043D\u043D\u044B\u0435 \u0442\u043E\u0432\u0430\u0440\u0430 \u0432\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u044B \u0432 \u0444\u043E\u0440\u043C\u0443',
  severalItems: '\u041D\u0430\u0439\u0434\u0435\u043D\u043E \u043D\u0435\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0442\u043E\u0432\u0430\u0440\u043E\u0432; \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D \u043F\u0435\u0440\u0432\u044B\u0439'
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function firstValue(...values) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return '';
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureTargetForm(target) {
  const fieldId = target === 'wish' ? 'wName' : 'fName';
  const overlayId = target === 'wish' ? 'wishFormOverlay' : 'formOverlay';
  const overlay = document.getElementById(overlayId);
  const isOpen = !overlay || overlay.style.display !== 'none';
  if (document.getElementById(fieldId) && isOpen) return true;

  const opener = target === 'wish' ? window.openWishForm : window.openForm;
  if (typeof opener === 'function') {
    opener();
    await wait(50);
  }

  return Boolean(document.getElementById(fieldId));
}

function setValueIfExists(id, value) {
  const el = document.getElementById(id);
  if (!el) {
    console.warn('[Tampermonkey import] field not found:', id);
    return false;
  }
  el.value = value ?? '';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  console.log('[Tampermonkey import] set', id, '=>', el.value);
  return true;
}

function notify(message, deps = {}) {
  if (typeof deps.toast === 'function') deps.toast(message);
  else alert(message);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(MESSAGES.notJson);
  }
}

export async function readClipboardJson() {
  if (!navigator.clipboard?.readText) {
    throw new Error(MESSAGES.noClipboardAccess);
  }

  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch {
    throw new Error(MESSAGES.noClipboardAccess);
  }

  if (!clean(text)) throw new Error(MESSAGES.emptyClipboard);
  return parseJson(text);
}

export function normalizeImportedItem(raw, payload = {}) {
  const item = isPlainObject(raw) ? raw : {};
  const releaseDate = firstValue(item.releaseDate, item.release, item.date);
  const parsed = parseReleaseDateParts(releaseDate);
  const month = firstValue(item.month, parsed.month);
  const year = firstValue(item.year, parsed.year);
  const maker = firstValue(item.maker, item.brand, item.manufacturer);
  const brand = firstValue(item.brand, item.maker, item.manufacturer);
  const images = Array.isArray(item.images) ? item.images : [];
  const imageUrl = firstValue(item.imageUrl, item.img, item.image, item.thumbnail, images[0]);
  const sourceUrl = firstValue(item.sourceUrl);
  const shopUrl = firstValue(item.shopUrl, item.url, item.pageUrl, payload.pageUrl, sourceUrl);

  return {
    name: firstValue(item.name, item.title, item.productName),
    price: firstValue(item.price, item.priceOriginal, item.amount),
    currency: firstValue(item.currency, payload.currency, 'JPY'),
    maker,
    brand,
    month,
    year,
    releaseDate: formatReleaseDate(releaseDate),
    preorderStart: firstValue(item.preorderStart, item.preorderFrom),
    preorderEnd: firstValue(item.preorderEnd, item.preorderUntil),
    releaseStatus: firstValue(item.releaseStatus, item.status, 'unknown'),
    imageUrl,
    images,
    img: firstValue(item.img, item.imageUrl, item.image, item.thumbnail),
    sourceUrl,
    shopUrl,
    url: shopUrl,
    store: firstValue(item.store, item.shop, payload.sourceName),
    source: firstValue(item.source, payload.source),
    jan: firstValue(item.jan, item.ean, item.janCode),
    sku: firstValue(item.sku, item.code, item.productCode, item.itemCode),
    code: firstValue(item.code, item.sku, item.productCode, item.itemCode),
    tags: mergeTags([], item.tags || [])
  };
}

export function normalizeClipboardPayload(payload) {
  if (!isPlainObject(payload)) throw new Error(MESSAGES.unknownFormat);

  if (payload.app === FIGURE_TRACKER_APP && Array.isArray(payload.items)) {
    const items = payload.items.map(item => normalizeImportedItem(item, payload));
    if (!items.length) throw new Error(MESSAGES.unknownFormat);
    return items;
  }

  if (Array.isArray(payload.items)) {
    const items = payload.items.map(item => normalizeImportedItem(item, payload));
    if (!items.length) throw new Error(MESSAGES.unknownFormat);
    return items;
  }

  const looksLikeLegacy = ['name', 'price', 'brand', 'maker', 'month', 'year', 'img', 'imageUrl', 'url', 'releaseDate', 'jan', 'sku', 'code']
    .some(key => clean(payload[key]));
  if (looksLikeLegacy) return [normalizeImportedItem(payload, { ...payload, source: 'legacy', sourceName: 'Tampermonkey' })];

  throw new Error(MESSAGES.unknownFormat);
}

export function fillMainFormFromImportedItem(item) {
  const imageList = mergeTags([], [...(Array.isArray(item.images) ? item.images : []), item.imageUrl || item.img]);
  const currentTags = document.getElementById('fTags')?.value || '';
  const mergedTags = mergeTags(currentTags, item.tags || []);
  const changed = [
    setValueIfExists('fName', item.name),
    setValueIfExists('fStore', item.store),
    setValueIfExists('fPrice', item.price),
    setValueIfExists('fMaker', item.maker || item.brand),
    setValueIfExists('fImg', imageList.join(', ')),
    setValueIfExists('fDateMonth', item.month),
    setValueIfExists('fDateYear', item.year),
    setValueIfExists('fShopUrl', item.shopUrl || item.url),
    setValueIfExists('fJan', item.jan),
    setValueIfExists('fSku', item.sku || item.code),
    setValueIfExists('fPreorderStart', item.preorderStart),
    setValueIfExists('fPreorderEnd', item.preorderEnd),
    setValueIfExists('fReleaseStatus', item.releaseStatus || 'unknown'),
    setValueIfExists('fSource', item.source),
    setValueIfExists('fSourceUrl', item.sourceUrl),
    setValueIfExists('fTags', mergedTags.join(', '))
  ];
  if (document.getElementById('fCurrency')) changed.push(setValueIfExists('fCurrency', item.currency || 'JPY'));
  return changed.some(Boolean);
}

export function fillWishFormFromImportedItem(item) {
  const imageList = mergeTags([], [...(Array.isArray(item.images) ? item.images : []), item.imageUrl || item.img]);
  const currentTags = document.getElementById('wTags')?.value || '';
  const mergedTags = mergeTags(currentTags, item.tags || []);
  const changed = [
    setValueIfExists('wName', item.name),
    setValueIfExists('wStore', item.store),
    setValueIfExists('wPrice', item.price),
    setValueIfExists('wMaker', item.maker || item.brand),
    setValueIfExists('wImg', imageList.join(', ')),
    setValueIfExists('wDate', item.releaseDate || [item.month, item.year].filter(Boolean).join(' ')),
    setValueIfExists('wShopUrl', item.shopUrl || item.url),
    setValueIfExists('wJan', item.jan),
    setValueIfExists('wSku', item.sku || item.code),
    setValueIfExists('wPreorderStart', item.preorderStart),
    setValueIfExists('wPreorderEnd', item.preorderEnd),
    setValueIfExists('wReleaseStatus', item.releaseStatus || 'unknown'),
    setValueIfExists('wSource', item.source),
    setValueIfExists('wSourceUrl', item.sourceUrl),
    setValueIfExists('wTags', mergedTags.join(', '))
  ];
  if (document.getElementById('wCurrency')) changed.push(setValueIfExists('wCurrency', item.currency || 'JPY'));
  return changed.some(Boolean);
}

export async function grabFromClipboard(target = 'main', deps = {}) {
  try {
    const payload = await readClipboardJson();
    const items = normalizeClipboardPayload(payload);
    const item = items[0];
    await ensureTargetForm(target);

    let didFill = false;
    if (target === 'wish') didFill = fillWishFormFromImportedItem(item);
    else {
      didFill = fillMainFormFromImportedItem(item);
      if (typeof deps.updateEurPreview === 'function') deps.updateEurPreview();
    }

    if (!didFill) {
      throw new Error(target === 'wish'
        ? '\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u043E\u0442\u043A\u0440\u043E\u0439 \u0444\u043E\u0440\u043C\u0443 wishlist'
        : '\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u043E\u0442\u043A\u0440\u043E\u0439 \u0444\u043E\u0440\u043C\u0443 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u044F \u0437\u0430\u043A\u0430\u0437\u0430');
    }

    if (items.length > 1) notify(MESSAGES.severalItems, deps);
    notify(MESSAGES.success, deps);
    return item;
  } catch (error) {
    notify(error?.message || MESSAGES.unknownFormat, deps);
    return null;
  }
}
