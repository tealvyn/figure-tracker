// js/state.js
export const KEY = 'fctV2';

export let state = { items: [], wishlist: [], rates: { EUR: 1, USD: 1, JPY: 1 }, ratesAt: 0, search: { global: '' } };
export let appState = {
    selectedOrder: null,
    editingId: null,
    filterStatus: null,
    currentTab: 'collection',
    editingWishId: null,
    modalItemId: null,
    lightboxPhotos: [],
    lightboxIndex: 0,
    lightboxTouchStartX: null,
    lightboxTouchStartY: null,
    lightboxTouchInitialized: false,
    particlesInitialized: false,
    currentCalendarYear: new Date().getFullYear(),
    bannerIndex: 0,
    monthChartInstance: null,
    storeChartInstance: null,
    makerChartInstance: null,
    shelfChartInstance: null,
    galleryVisibleCount: 120
};

export function loadState() {
  try {
    const local = JSON.parse(localStorage.getItem(KEY));
    if (local) Object.assign(state, local);
    state.search = state.search && typeof state.search === 'object' ? state.search : {};
    if (!state.search.global && state.filters?.search) state.search.global = state.filters.search;
    if (!state.search.global && state.collectionSearch) state.search.global = state.collectionSearch;
    state.search.global = String(state.search.global || '');
  } catch {
    console.error("State load error");
  }
}

export function persist() { 
  localStorage.setItem(KEY, JSON.stringify(state)); 
}

let persistTimer = null;
export function schedulePersist(delay = 150) {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persist();
    persistTimer = null;
  }, delay);
}

function historyId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function emptyEquivalent(value, field) {
  if (value == null) return '';
  if (['priceOriginal', 'shippingEur', 'deposit'].includes(field)) {
    const number = Number(value) || 0;
    return number === 0 ? '' : String(number);
  }
  return String(value).trim();
}

function historyDisplay(value, field) {
  const normalized = emptyEquivalent(value, field);
  if (!normalized) return '—';
  if (field === 'deposit') return `${normalized} €`;
  if (field === 'shippingEur') return `${normalized} €`;
  return normalized;
}

function isFullyPaidStatus(value) {
  return String(value || '').trim().toLowerCase() === 'полностью оплачено';
}

function systemHistoryComment(text, createdAt) {
  return {
    id: historyId(),
    type: 'system',
    text,
    createdAt,
    updatedAt: createdAt
  };
}

export function addSystemHistoryComment(comments, text, createdAt = Date.now()) {
  if (!Array.isArray(comments) || !text) return false;
  const lastSystem = [...comments].reverse().find(comment => comment?.type === 'system');
  if (lastSystem?.text === text && createdAt - Number(lastSystem.createdAt || 0) < 5000) return false;
  comments.push(systemHistoryComment(text, createdAt));
  return true;
}

export function appendSystemHistoryComments(comments, additions = []) {
  const target = Array.isArray(comments) ? comments : [];
  for (const comment of additions || []) {
    if (comment?.type === 'system') addSystemHistoryComment(target, comment.text, comment.createdAt || Date.now());
    else if (comment) target.push(comment);
  }
  return target;
}

export function buildChangeHistoryComments(previous = null, next = {}) {
  if (!previous) return [];
  const createdAt = Date.now();
  const comments = [];
  const fields = [
    ['status', 'Статус изменён'],
    ['priceOriginal', 'Цена изменена'],
    ['currency', 'Валюта изменена'],
    ['shippingEur', 'Доставка изменена'],
    ['deposit', 'Предоплата изменена'],
    ['releaseDate', 'Дата релиза изменена'],
    ['tracking', 'Трек номер изменён'],
    ['store', 'Магазин изменён'],
    ['orderNumber', 'Номер заказа изменён'],
    ['orderName', 'Посылка изменена'],
    ['shopUrl', 'Страница товара изменена']
  ];

  for (const [field, label] of fields) {
    const before = emptyEquivalent(previous[field], field);
    const after = emptyEquivalent(next[field], field);
    if (before === after) continue;

    if (field === 'status' && isFullyPaidStatus(after)) {
      comments.push(systemHistoryComment('Заказ отмечен как полностью оплаченный', createdAt));
      continue;
    }

    if (field === 'deposit') {
      comments.push(systemHistoryComment(`Предоплата изменена: ${historyDisplay(previous[field], field)} → ${historyDisplay(next[field], field)}`, createdAt));
      continue;
    }

    if (field === 'tracking') {
      comments.push(systemHistoryComment(
        before
          ? `Трек номер изменён: ${historyDisplay(previous[field], field)} → ${historyDisplay(next[field], field)}`
          : `Добавлен трек номер: ${historyDisplay(next[field], field)}`,
        createdAt
      ));
      continue;
    }

    if (field === 'releaseDate') {
      comments.push(systemHistoryComment(`Дата релиза изменена: ${historyDisplay(previous[field], field)} → ${historyDisplay(next[field], field)}`, createdAt));
      continue;
    }

    comments.push(systemHistoryComment(`${label}: ${historyDisplay(previous[field], field)} → ${historyDisplay(next[field], field)}`, createdAt));
  }

  return comments;
}

export function toEur(amount, currency) { 
  return +(Number(amount) * (state.rates[currency] ?? 1)).toFixed(2); 
}
