// js/state.js
export const KEY = 'fctV2';

export let state = { items: [], wishlist: [], rates: { EUR: 1, USD: 1, JPY: 1 }, ratesAt: 0 };
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
    shelfChartInstance: null
};

export function loadState() {
  try {
    const local = JSON.parse(localStorage.getItem(KEY));
    if (local) Object.assign(state, local);
  } catch {
    console.error("State load error");
  }
}

export function persist() { 
  localStorage.setItem(KEY, JSON.stringify(state)); 
}

export function toEur(amount, currency) { 
  return +(Number(amount) * (state.rates[currency] ?? 1)).toFixed(2); 
}