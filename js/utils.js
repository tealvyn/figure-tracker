// js/utils.js
import { state, toEur } from './state.js';

export function H(v) { 
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); 
}

function isVideoUrl(url = '') {
  return /\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i.test(String(url));
}

function mediaTag(url, className = 'figure-img', alt = '') {
  if (!url) {
    return `<div class="${className}" style="display:flex;align-items:center;justify-content:center;font-size:36px;">📦</div>`;
  }

  const safeUrl = H(url);
  const safeAlt = H(alt);

  if (isVideoUrl(url)) {
    const videoId = `app-video-${crypto.randomUUID()}`;
    return `
      <div class="app-video-wrap" data-no-card-open="true" data-no-swipe="true" data-no-lightbox-close="true">
        <video id="${videoId}" class="app-video ${className}" src="${safeUrl}" preload="metadata" playsinline data-app-video="true" data-no-card-open="true" data-no-swipe="true" data-no-lightbox-close="true"></video>
        <div class="app-video-controls" data-no-card-open="true" data-no-swipe="true" data-no-lightbox-close="true">
          <button class="app-video-play" type="button" onclick="toggleAppVideoPlay(event, '${videoId}')">▶</button>
          <button class="app-video-mute" type="button" onclick="toggleAppVideoMute(event, '${videoId}')">🔇</button>
        </div>
      </div>
    `;
  }

  return `<img class="${className}" src="${safeUrl}" alt="${safeAlt}" onerror="this.style.opacity='.1'">`;
}

export function fromEur(amount, currency = state.settings?.displayCurrency || state.settings?.regionalRules?.displayCurrency || 'EUR') {
  const value = Number(amount) || 0;
  const code = String(currency || 'EUR').toUpperCase();
  if (code === 'EUR') return value;
  const rate = Number(state.rates?.[code]) || 0;
  return rate ? value / rate : value;
}

export function toBaseEur(amount, currency = state.settings?.displayCurrency || state.settings?.regionalRules?.displayCurrency || 'EUR') {
  const value = Number(amount) || 0;
  const code = String(currency || 'EUR').toUpperCase();
  if (code === 'EUR') return value;
  const rate = Number(state.rates?.[code]) || 0;
  return rate ? value * rate : value;
}

export function eur(n) {
  const currency = String(state.settings?.displayCurrency || state.settings?.regionalRules?.displayCurrency || 'EUR').toUpperCase();
  const amount = fromEur(n, currency);
  try {
    return new Intl.NumberFormat(currency === 'UAH' ? 'uk-UA' : undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export const SCALE_WEIGHTS = {
  small: { kg: 0.8 },
  standard: { kg: 1.5 },
  large: { kg: 4.0 },
};

export const AMIAMI_RATES = {
  small_packet: [[0.8, 2230], [1.0, 2590], [1.5, 3490], [2.0, 4390]],
  sal: [[0.5, 1350], [1.0, 1900], [1.5, 2550], [2.0, 3150]],
  ems: [[0.5, 2700], [0.8, 3900], [1.0, 4700], [1.5, 5550], [2.0, 6550], [2.5, 7650], [3.0, 8800], [4.0, 11000], [5.0, 13000], [6.0, 15000], [7.0, 17000]],
  surface: [[1.0, 2500], [2.0, 3100], [3.0, 3700], [5.0, 4900], [7.0, 6100]]
};

export function calcAmiAmiShipping(kg, method) {
  const table = AMIAMI_RATES[method] || AMIAMI_RATES.small_packet;
  for (const [limit, jpy] of table) {
    if (kg <= limit) return jpy;
  }
  return table[table.length - 1][1];
}

export function calcOrzGKShipping(kg) {
  const eur = Math.max(15, Math.round(kg * 5.5 * 1.2));
  return { eur, method: 'Special Line (без налога)' };
}

export function calcOrder(order) {
  const goodsEur = order.items.reduce((s, i) => s + toEur(i.priceOriginal || 0, i.currency || 'EUR'), 0);
  const shippingEur = Math.max(0, ...order.items.map(i => Number(i.shippingEur || 0)));
  const taxBase = +(goodsEur + shippingEur).toFixed(2);
  const firstItem = order.items[0] || {};
  const estimate = calculateImportEstimate({
    ...firstItem,
    store: order.store || firstItem.store,
    priceOriginal: goodsEur,
    currency: 'EUR',
    shippingEur
  }, state.settings || {}, state.rates || {});
  const isDomestic = isImportExempt(firstItem, state.settings || {}, order.store);
  const alv = estimate.enabled ? estimate.vat : 0;
  const customs = estimate.enabled
    ? +(estimate.importDuty + estimate.customsFee + estimate.brokerFee + estimate.domesticShipping).toFixed(2)
    : 0;
  const total = +(taxBase + alv + customs).toFixed(2);
  const deposit = Math.max(0, ...order.items.map(i => Number(i.deposit || 0)));
  const remaining = +Math.max(total - deposit, 0).toFixed(2);
  
  return {
    goodsEur,
    shippingEur,
    taxBase,
    alv,
    customs,
    total,
    deposit,
    remaining,
    isDomestic,
    overLimitAmount: estimate.overLimitAmount || 0
  };
}

function convertToEur(amount, currency, rates = state.rates || {}) {
  const value = Number(amount) || 0;
  const code = String(currency || 'EUR').toUpperCase();
  if (!value) return 0;
  if (code === 'EUR') return value;
  const rate = Number(rates[code]) || 0;
  return rate ? +(value * rate).toFixed(2) : null;
}

function isImportExempt(item = {}, settings = {}, storeOverride = '') {
  const rules = settings.regionalRules || {};
  const profile = String(rules.countryProfile || settings.countryProfile || '').toLowerCase();
  const region = String(item.region || '').trim().toUpperCase();
  if (profile === 'ua') return ['УКРАИНА', 'УКРАЇНА', 'UKRAINE'].includes(region);
  if (profile === 'fi') return ['ЕС', 'ЄС', 'EU'].includes(region);
  return false;
}

export function calculateImportEstimate(item, settings = {}, rates = state.rates || {}) {
  const rules = settings.regionalRules || {};
  const warnings = [];
  const offResult = {
    enabled: false,
    taxableBase: 0,
    overLimitAmount: 0,
    importDuty: 0,
    vat: 0,
    customsFee: 0,
    brokerFee: 0,
    domesticShipping: 0,
    estimatedTotalExtra: 0,
    estimatedGrandTotal: 0,
    warnings
  };

  if (!rules || rules.taxCalculationMode === 'off') return offResult;

  const price = Number(item?.priceOriginal) || 0;
  const currency = item?.currency || 'EUR';
  if (!price) warnings.push('missingAmount');

  const goodsEur = +((Number(price) || 0) * (Number(rates[currency]) || 1)).toFixed(2);
  if (currency !== 'EUR' && !rates[currency]) warnings.push('missingItemRate');

  const shippingEur = Number(item?.shippingEur) || 0;
  const taxableBase = +(goodsEur + shippingEur).toFixed(2);
  if (isImportExempt(item, settings)) {
    return {
      enabled: true,
      taxableBase,
      overLimitAmount: 0,
      importDuty: 0,
      vat: 0,
      customsFee: 0,
      brokerFee: 0,
      domesticShipping: 0,
      estimatedTotalExtra: 0,
      estimatedGrandTotal: taxableBase,
      warnings
    };
  }
  const limitCurrency = rules.taxFreeLimitCurrency || 'EUR';
  const limitEur = convertToEur(rules.taxFreeLimit, limitCurrency, rates);
  if (limitEur == null) warnings.push('missingLimitRate');

  const feeCurrency = rules.displayCurrency || settings.displayCurrency || 'EUR';
  const customsFee = convertToEur(rules.customsFee, feeCurrency, rates);
  const brokerFee = convertToEur(rules.brokerFee, feeCurrency, rates);
  const domesticShipping = convertToEur(rules.domesticShipping, feeCurrency, rates);
  if (customsFee == null || brokerFee == null || domesticShipping == null) warnings.push('missingFeeRate');

  const vatBase = rules.vatBase || 'over_limit';
  const overLimitAmount = Math.max(0, taxableBase - (limitEur ?? 0));
  let importDuty, vat;
  if (vatBase === 'full') {
    // EU rules: duty only on the amount exceeding the threshold,
    // but VAT is always charged on the FULL value (goods + shipping + duty), starting from 0 €
    importDuty = +(overLimitAmount * (Number(rules.importDutyRate) || 0) / 100).toFixed(2);
    vat = +((taxableBase + importDuty) * (Number(rules.vatRate) || 0) / 100).toFixed(2);
  } else {
    // UA and others: both duty and VAT are applied only to the amount over the limit
    importDuty = +(overLimitAmount * (Number(rules.importDutyRate) || 0) / 100).toFixed(2);
    vat = +((overLimitAmount + importDuty) * (Number(rules.vatRate) || 0) / 100).toFixed(2);
  }
  const fixedFees = (customsFee ?? 0) + (brokerFee ?? 0) + (domesticShipping ?? 0);
  const estimatedTotalExtra = +(importDuty + vat + fixedFees).toFixed(2);

  return {
    enabled: true,
    taxableBase,
    overLimitAmount: +overLimitAmount.toFixed(2),
    importDuty,
    vat,
    customsFee: +(customsFee ?? 0).toFixed(2),
    brokerFee: +(brokerFee ?? 0).toFixed(2),
    domesticShipping: +(domesticShipping ?? 0).toFixed(2),
    estimatedTotalExtra,
    estimatedGrandTotal: +(taxableBase + estimatedTotalExtra).toFixed(2),
    warnings
  };
}
