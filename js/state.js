// js/state.js
export const KEY = 'fctV2';

const DEFAULT_RATES = { EUR: 1, USD: 1, JPY: 1, UAH: 0.025 };

export const COUNTRY_PROFILES = {
  fi: {
    id: 'fi',
    defaultCurrency: 'EUR',
    displayCurrency: 'EUR',
    defaultRegion: 'ЕС',
    regions: ['Япония', 'Китай', 'США', 'ЕС', 'Другое'],
    shippingMethods: [
      { value: 'small_packet', label: 'Small Packet' },
      { value: 'ems', label: 'EMS' },
      { value: 'surface', label: 'Surface Parcel' },
      { value: 'dhl', label: 'DHL' },
      { value: 'fedex', label: 'FedEx' },
      { value: 'other', label: 'Другое' }
    ]
  },
  ua: {
    id: 'ua',
    defaultCurrency: 'UAH',
    displayCurrency: 'UAH',
    defaultRegion: 'Украина',
    defaultShippingAmount: 150,
    shippingCurrency: 'UAH',
    regions: ['Украина', 'Япония', 'Китай', 'США', 'ЕС', 'Другое'],
    shippingMethods: [
      { value: 'nova_poshta', label: 'Новая Почта' },
      { value: 'ukrposhta', label: 'Укрпошта' },
      { value: 'meest', label: 'Meest' },
      { value: 'ems', label: 'EMS' },
      { value: 'dhl', label: 'DHL' },
      { value: 'fedex', label: 'FedEx' },
      { value: 'proxy', label: 'Посредник' },
      { value: 'other', label: 'Другое' }
    ]
  },
  custom: {
    id: 'custom',
    defaultCurrency: 'JPY',
    displayCurrency: 'EUR',
    defaultRegion: 'Япония',
    regions: ['Украина', 'Япония', 'Китай', 'США', 'ЕС', 'Другое'],
    shippingMethods: []
  }
};

const REGIONAL_RULE_PROFILES = {
  fi: {
    countryProfile: 'fi',
    displayCurrency: 'EUR',
    taxFreeLimit: 150,
    taxFreeLimitCurrency: 'EUR',
    importDutyRate: 4.7,
    vatRate: 25.5,
    customsFee: 0,
    brokerFee: 0,
    domesticShipping: 0,
    taxCalculationMode: 'manual'
  },
  ua: {
    countryProfile: 'ua',
    displayCurrency: 'UAH',
    taxFreeLimit: 150,
    taxFreeLimitCurrency: 'EUR',
    importDutyRate: 10,
    vatRate: 20,
    customsFee: 0,
    brokerFee: 0,
    domesticShipping: 0,
    taxCalculationMode: 'manual'
  },
  custom: {
    countryProfile: 'custom',
    displayCurrency: 'EUR',
    taxFreeLimit: 150,
    taxFreeLimitCurrency: 'EUR',
    importDutyRate: 0,
    vatRate: 0,
    customsFee: 0,
    brokerFee: 0,
    domesticShipping: 0,
    taxCalculationMode: 'off'
  }
};

const SHIPPING_METHOD_LABELS = {
  small_packet: 'Small Packet',
  ems: 'EMS',
  surface: 'Surface Parcel',
  dhl: 'DHL',
  fedex: 'FedEx',
  nova_poshta: 'Новая Почта',
  ukrposhta: 'Укрпошта',
  meest: 'Meest',
  proxy: 'Посредник',
  other: 'Другое'
};

export let state = { items: [], wishlist: [], rates: { ...DEFAULT_RATES }, ratesAt: 0, search: { global: '' } };
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
    state.rates = { ...DEFAULT_RATES, ...(state.rates || {}) };
    state.settings = state.settings && typeof state.settings === 'object' ? state.settings : {};
    state.settings.regionalRules = getRegionalRules(state.settings);
    state.search = state.search && typeof state.search === 'object' ? state.search : {};
    if (!state.search.global && state.filters?.search) state.search.global = state.filters.search;
    if (!state.search.global && state.collectionSearch) state.search.global = state.collectionSearch;
    state.search.global = String(state.search.global || '');
  } catch {
    console.error("State load error");
  }
}

function uniqueList(values) {
  return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))];
}

function methodOption(value) {
  const key = String(value || '').trim();
  return key ? { value: key, label: SHIPPING_METHOD_LABELS[key] || key } : null;
}

export function getCountryProfileId(settings = state.settings || {}) {
  if (COUNTRY_PROFILES[settings.countryProfile]) return settings.countryProfile;
  if (settings.region || settings.currency || settings.shipMethod || settings.displayCurrency) return 'custom';
  return 'fi';
}

export function getCountryProfile(profileId = getCountryProfileId()) {
  return COUNTRY_PROFILES[profileId] || COUNTRY_PROFILES.fi;
}

export function getProfileRegions(settings = state.settings || {}) {
  const profile = getCountryProfile(getCountryProfileId(settings));
  const regions = profile.id === 'custom'
    ? [...COUNTRY_PROFILES.ua.regions, ...COUNTRY_PROFILES.fi.regions, settings.region]
    : profile.regions;
  return uniqueList(regions);
}

export function getProfileShippingMethods(settings = state.settings || {}) {
  const profile = getCountryProfile(getCountryProfileId(settings));
  const methods = profile.id === 'custom'
    ? [...COUNTRY_PROFILES.ua.shippingMethods, ...COUNTRY_PROFILES.fi.shippingMethods, methodOption(settings.shipMethod)]
    : profile.shippingMethods;
  const seen = new Set();
  return methods.filter(Boolean).filter(method => {
    if (seen.has(method.value)) return false;
    seen.add(method.value);
    return true;
  });
}

export function getDefaultCurrency(settings = state.settings || {}) {
  const profile = getCountryProfile(getCountryProfileId(settings));
  return settings.currency || settings.defaultCurrency || profile.defaultCurrency || 'EUR';
}

export function getDisplayCurrency(settings = state.settings || {}) {
  const profile = getCountryProfile(getCountryProfileId(settings));
  return settings.displayCurrency || profile.displayCurrency || 'EUR';
}

export function getDefaultRegion(settings = state.settings || {}) {
  const profile = getCountryProfile(getCountryProfileId(settings));
  return settings.region || settings.defaultRegion || profile.defaultRegion || 'Япония';
}

export function getDefaultShipMethod(settings = state.settings || {}) {
  const methods = getProfileShippingMethods(settings);
  return settings.shipMethod || methods[0]?.value || 'small_packet';
}

export function getRegionalRules(settings = state.settings || {}) {
  const profileId = getCountryProfileId(settings);
  const base = REGIONAL_RULE_PROFILES[profileId] || REGIONAL_RULE_PROFILES.fi;
  const saved = settings.regionalRules && typeof settings.regionalRules === 'object' ? settings.regionalRules : {};
  return {
    ...base,
    ...saved,
    countryProfile: saved.countryProfile || profileId,
    displayCurrency: saved.displayCurrency || getDisplayCurrency(settings)
  };
}

export function getRegionalRuleProfile(profileId = 'fi') {
  return { ...(REGIONAL_RULE_PROFILES[profileId] || REGIONAL_RULE_PROFILES.custom) };
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
