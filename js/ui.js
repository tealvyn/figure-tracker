// js/ui.js
import { state, appState, persist, schedulePersist, toEur, buildChangeHistoryComments, appendSystemHistoryComments, addSystemHistoryComment, getCountryProfile, getCountryProfileId, getDefaultCurrency, getDefaultRegion, getDefaultShipMethod, getDisplayCurrency, getProfileRegions, getProfileShippingMethods, getRegionalRules, getRegionalRuleProfile } from './state.js';
import { H, eur, fromEur, toBaseEur, calcAmiAmiShipping, calcOrder, SCALE_WEIGHTS, calculateImportEstimate } from './utils.js';
import * as API from './api.js';
import { applyI18n, t } from './i18n.js';
import { downloadJsonBackup } from './data-portability.js';
import { grabFromClipboard } from './clipboard-import.js';
import { toast as notifyToast } from './notifications.js';
import { getBadgeClass, normalizeStatus } from './status.js';
import * as WishlistView from './wishlist-view.js';
import {
  getCollectionTotals,
  getItemTotalEur,
  getStatusCounts,
  releaseSortValue,
  renderCollectionHome,
  renderCollectionStatusBar
} from './collection-view.js';
import { renderMediaTag, getMediaKind, getImageUrl, getMediaUrl, isTelegramFileUrl, refreshTelegramMediaUrl } from './media-storage.js';
import { buildSearchText, formatReleaseDate, mergeTags, normalizeProductMeta, renderProductMetaBadges, renderProductMetaRows, tagKey } from './product-meta.js';

const GALLERY_PAGE_SIZE = 120;
const renderQueue = new Map();
let renderScheduled = false;

const CURRENCY_OPTIONS = ['EUR', 'USD', 'JPY', 'UAH'];

function setSelectOptions(selectOrId, options, selectedValue) {
  const select = typeof selectOrId === 'string' ? document.getElementById(selectOrId) : selectOrId;
  if (!select) return;
  const current = selectedValue ?? select.value;
  select.innerHTML = (options || []).map(option => {
    const value = typeof option === 'string' ? option : option.value;
    const label = typeof option === 'string' ? option : option.label;
    return `<option value="${H(value)}">${H(label)}</option>`;
  }).join('');
  if (current && ![...select.options].some(option => option.value === current)) {
    select.insertAdjacentHTML('afterbegin', `<option value="${H(current)}">${H(current)}</option>`);
  }
  select.value = current || select.options[0]?.value || '';
}

function getActiveProfileDefaults(settings = state.settings || {}) {
  const profileId = getCountryProfileId(settings);
  const profile = getCountryProfile(profileId);
  return {
    profileId,
    profile,
    currency: getDefaultCurrency(settings),
    displayCurrency: getDisplayCurrency(settings),
    region: getDefaultRegion(settings),
    shipMethod: getDefaultShipMethod(settings)
  };
}

function refreshRegionalSelects(selected = {}) {
  const s = state.settings || {};
  const defaults = getActiveProfileDefaults(s);
  const regions = getProfileRegions(s);
  const methods = getProfileShippingMethods(s);
  setSelectOptions('sRegion', regions, selected.region ?? defaults.region);
  setSelectOptions('fRegion', regions, selected.region ?? document.getElementById('fRegion')?.value ?? defaults.region);
  setSelectOptions('sShipMethod', methods, selected.shipMethod ?? defaults.shipMethod);
  setSelectOptions('fShipMethod', methods, selected.shipMethod ?? document.getElementById('fShipMethod')?.value ?? defaults.shipMethod);
  setSelectOptions('sCurrency', CURRENCY_OPTIONS, selected.currency ?? defaults.currency);
  setSelectOptions('fCurrency', CURRENCY_OPTIONS, selected.currency ?? document.getElementById('fCurrency')?.value ?? defaults.currency);
  setSelectOptions('wCurrency', CURRENCY_OPTIONS, selected.currency ?? document.getElementById('wCurrency')?.value ?? defaults.currency);
  setSelectOptions('sDisplayCurrency', CURRENCY_OPTIONS, selected.displayCurrency ?? defaults.displayCurrency);
  setSelectOptions('sCountryProfile', [
    { value: 'fi', label: t('settings.profileFi') },
    { value: 'ua', label: t('settings.profileUa') },
    { value: 'custom', label: t('settings.profileCustom') }
  ], selected.countryProfile ?? defaults.profileId);
  const trackingEl = document.getElementById('sTrackingService');
  if (trackingEl) trackingEl.value = s.trackingService || 'auto';
}

function formatDisplayMoneyFromEur(amountEur) {
  return eur(amountEur);
}

function syncFormMoneyCurrency() {
  const currency = getDisplayCurrency();
  const shippingLabel = document.getElementById('fShippingLabel');
  const depositLabel = document.getElementById('fDepositLabel');
  if (shippingLabel) shippingLabel.textContent = `Доставка ${currency} (весь заказ)`;
  if (depositLabel) depositLabel.textContent = `Предоплата ${currency} (весь заказ)`;
}

function setFormBaseEurValue(id, amountEur) {
  const input = document.getElementById(id);
  if (!input) return;
  const amount = Number(amountEur) || 0;
  input.value = amount ? fromEur(amount, getDisplayCurrency()).toFixed(2) : '';
}

function getFormBaseEurValue(id) {
  const amount = parseFloat(document.getElementById(id)?.value) || 0;
  return +toBaseEur(amount, getDisplayCurrency()).toFixed(2);
}

function eurToDisplayAmount(amountEur) {
  const currency = getDisplayCurrency();
  const amount = Number(amountEur) || 0;
  if (currency === 'EUR') return amount;
  const rate = Number(state.rates?.[currency]) || 0;
  return rate ? amount / rate : amount;
}

function readNumberInput(id, fallback = 0) {
  const value = Number(document.getElementById(id)?.value);
  return Number.isFinite(value) ? value : fallback;
}

function refreshRegionalRuleFields(rules = getRegionalRules()) {
  setSelectOptions('sTaxFreeLimitCurrency', CURRENCY_OPTIONS, rules.taxFreeLimitCurrency || 'EUR');
  setSelectOptions('sTaxCalculationMode', [
    { value: 'off', label: t('settings.taxModeOff') },
    { value: 'manual', label: t('settings.taxModeManual') }
  ], rules.taxCalculationMode || 'off');
  const vatBaseEl = document.getElementById('sVatBase');
  if (vatBaseEl) vatBaseEl.value = rules.vatBase || 'over_limit';
  const values = {
    sTaxFreeLimit: rules.taxFreeLimit,
    sImportDutyRate: rules.importDutyRate,
    sVatRate: rules.vatRate,
    sCustomsFee: rules.customsFee,
    sBrokerFee: rules.brokerFee,
    sDomesticShipping: rules.domesticShipping
  };
  for (const [id, value] of Object.entries(values)) {
    const el = document.getElementById(id);
    if (el) el.value = value ?? 0;
  }
}

function collectRegionalRules(profileDefaults = null) {
  const current = getRegionalRules();
  const base = profileDefaults || current;
  return {
    countryProfile: base.countryProfile || getCountryProfileId(),
    displayCurrency: base.displayCurrency || getDisplayCurrency(),
    taxFreeLimit: profileDefaults ? base.taxFreeLimit : readNumberInput('sTaxFreeLimit', base.taxFreeLimit),
    taxFreeLimitCurrency: profileDefaults ? base.taxFreeLimitCurrency : (document.getElementById('sTaxFreeLimitCurrency')?.value || base.taxFreeLimitCurrency || 'EUR'),
    importDutyRate: profileDefaults ? base.importDutyRate : readNumberInput('sImportDutyRate', base.importDutyRate),
    vatRate: profileDefaults ? base.vatRate : readNumberInput('sVatRate', base.vatRate),
    vatBase: profileDefaults ? base.vatBase : (document.getElementById('sVatBase')?.value || base.vatBase || 'over_limit'),
    customsFee: profileDefaults ? base.customsFee : readNumberInput('sCustomsFee', base.customsFee),
    brokerFee: profileDefaults ? base.brokerFee : readNumberInput('sBrokerFee', base.brokerFee),
    domesticShipping: profileDefaults ? base.domesticShipping : readNumberInput('sDomesticShipping', base.domesticShipping),
    taxCalculationMode: profileDefaults ? base.taxCalculationMode : (document.getElementById('sTaxCalculationMode')?.value || base.taxCalculationMode || 'off')
  };
}
const mediaLookup = new Map();
const STANDALONE_TABS = new Set(['gallery', 'calendar', 'analytics', 'shelf', 'settings']);
let gallerySliderTimer = null;
let gallerySliderObserver = null;
const visibleGallerySliders = new Set();
let lastProductDetailNavAt = 0;
let lastLightboxNavAt = 0;
export const TAMPERMONKEY_SCRIPT_URL = 'https://tealvyn.github.io/figure-tracker/tampermonkey/figure-tracker-universal-importer.user.js';
const TAMPERMONKEY_SCRIPT_RAW_URL = 'https://raw.githubusercontent.com/tealvyn/figure-tracker/main/tampermonkey/figure-tracker-universal-importer.user.js';
const TAMPERMONKEY_SCRIPT_LOCAL_URL = 'tampermonkey/figure-tracker-universal-importer.user.js';
const TAMPERMONKEY_SCRIPT_FALLBACK = "// ==UserScript==\r\n// @name         Figure Tracker Universal Importer\r\n// @namespace    figure-tracker-importer\r\n// @version      2.1.0\r\n// @description  Copy figure product data from AmiAmi, HobbySearch, Mandarake, Solaris, Good Smile Europe, OrzGK and other pages to Figure Tracker JSON format.\r\n// @author       You\r\n// @match        https://*.amiami.com/*\r\n// @match        https://amiami.com/*\r\n// @match        https://*.1999.co.jp/*\r\n// @match        https://1999.co.jp/*\r\n// @match        https://*.mandarake.co.jp/*\r\n// @match        https://mandarake.co.jp/*\r\n// @match        https://*.solarisjapan.com/*\r\n// @match        https://solarisjapan.com/*\r\n// @match        https://*.goodsmile.com/*\r\n// @match        https://goodsmile.com/*\r\n// @match        https://*.goodsmile-europe.com/*\r\n// @match        https://goodsmile-europe.com/*\r\n// @match        https://*.orzgk.com/*\r\n// @match        https://orzgk.com/*\r\n// @grant        GM_setClipboard\r\n// ==/UserScript==\r\n\r\n(function () {\r\n    'use strict';\r\n\r\n    const MONTHS = {\r\n        Jan: 'Январь',\r\n        Feb: 'Февраль',\r\n        Mar: 'Март',\r\n        Apr: 'Апрель',\r\n        May: 'Май',\r\n        Jun: 'Июнь',\r\n        Jul: 'Июль',\r\n        Aug: 'Август',\r\n        Sep: 'Сентябрь',\r\n        Oct: 'Октябрь',\r\n        Nov: 'Ноябрь',\r\n        Dec: 'Декабрь',\r\n        January: 'Январь',\r\n        February: 'Февраль',\r\n        March: 'Март',\r\n        April: 'Апрель',\r\n        May: 'Май',\r\n        June: 'Июнь',\r\n        July: 'Июль',\r\n        August: 'Август',\r\n        September: 'Сентябрь',\r\n        October: 'Октябрь',\r\n        November: 'Ноябрь',\r\n        December: 'Декабрь'\r\n    };\r\n\r\n    const SITE_PROFILES = [\r\n        { id: 'amiami', name: 'AmiAmi', matches: host => host.includes('amiami.com'), parse: parseAmiAmi },\r\n        { id: 'hobbysearch', name: 'HobbySearch', matches: host => host.includes('1999.co.jp'), parse: parseHobbySearch },\r\n        { id: 'mandarake', name: 'Mandarake', matches: host => host.includes('mandarake.co.jp'), parse: parseMandarake },\r\n        { id: 'solaris', name: 'Solaris Japan', matches: host => host.includes('solarisjapan.com'), parse: parseSolaris },\r\n        { id: 'goodsmile-europe', name: 'Good Smile Europe', matches: host => host.includes('goodsmile-europe.com'), parse: parseGoodSmileEurope },\r\n        { id: 'goodsmile', name: 'Good Smile', matches: host => host.includes('goodsmile.com'), parse: parseGoodSmile },\r\n        { id: 'orzgk', name: 'OrzGK', matches: host => host.includes('orzgk.com'), parse: parseOrzGK }\r\n    ];\r\n\r\n\r\n    function normalizeReleaseDate(value) {\r\n        const raw = cleanText(value);\r\n        if (!raw) return '';\r\n\r\n        const yearMonth = raw.match(/\\b(20\\d{2})[\\/.-](0?[1-9]|1[0-2])\\b/);\r\n        if (yearMonth) {\r\n            return `${yearMonth[1]}-${String(yearMonth[2]).padStart(2, '0')}`;\r\n        }\r\n\r\n        const quarter1 = raw.match(/\\b(20\\d{2})\\s*Q([1-4])\\b/i);\r\n        if (quarter1) return `${quarter1[1]} Q${quarter1[2]}`;\r\n\r\n        const quarter2 = raw.match(/\\bQ([1-4])\\s*(20\\d{2})\\b/i);\r\n        if (quarter2) return `${quarter2[2]} Q${quarter2[1]}`;\r\n\r\n        const monthYear = raw.match(/\\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\.?[\\s,-]+(20\\d{2})\\b/i);\r\n        if (monthYear) return `${monthYear[1]} ${monthYear[2]}`;\r\n\r\n        return raw;\r\n    }\r\n\r\n    function findReleaseDateInPage() {\r\n        const bodyText = cleanText(document.body ? document.body.innerText : '');\r\n\r\n        const patterns = [\r\n            /Est\\.?\\s*Released\\s*Time[\\s:：-]{0,30}([^\\n\\r]+)/i,\r\n            /Estimated\\s*Released\\s*Time[\\s:：-]{0,30}([^\\n\\r]+)/i,\r\n            /Est\\.?\\s*Release\\s*Time[\\s:：-]{0,30}([^\\n\\r]+)/i,\r\n            /Released\\s*Time[\\s:：-]{0,30}([^\\n\\r]+)/i,\r\n            /Release\\s*Time[\\s:：-]{0,30}([^\\n\\r]+)/i,\r\n            /Release\\s*Date[\\s:：-]{0,30}([^\\n\\r]+)/i,\r\n            /Est\\.?\\s*Release[\\s:：-]{0,30}([^\\n\\r]+)/i,\r\n            /Estimated\\s*Release[\\s:：-]{0,30}([^\\n\\r]+)/i\r\n        ];\r\n\r\n        for (const pattern of patterns) {\r\n            const match = bodyText.match(pattern);\r\n            if (!match) continue;\r\n\r\n            const normalized = normalizeReleaseDate(match[1]);\r\n            if (normalized) return normalized;\r\n        }\r\n\r\n        const labelValue = findLabelValue([\r\n            'Est Released Time',\r\n            'Estimated Released Time',\r\n            'Est Release Time',\r\n            'Released Time',\r\n            'Release Time',\r\n            'Release Date',\r\n            'Est. Release',\r\n            'Estimated Release',\r\n            'Release'\r\n        ]);\r\n\r\n        return normalizeReleaseDate(labelValue);\r\n    }\r\n\r\n    function findGoodSmileReleaseDate() {\r\n        const candidates = [];\r\n\r\n        // Самое точное место на goodsmile.com\r\n        document.querySelectorAll(\r\n            '.b-product-info__note, .b-product-info__status, #status-text-block, .p-product__infomation'\r\n        ).forEach(el => {\r\n            const value = cleanText(el.textContent || '');\r\n            if (value) candidates.push(value);\r\n        });\r\n\r\n        // fallback по всей странице\r\n        candidates.push(cleanText(document.body ? document.body.innerText : ''));\r\n\r\n        for (const textValue of candidates) {\r\n            // Shipping 08/2027\r\n            const shippingMonthYear = textValue.match(/\\bShipping\\s+(\\d{1,2})[\\/.-](20\\d{2})\\b/i);\r\n            if (shippingMonthYear) {\r\n                return `${shippingMonthYear[2]}-${String(shippingMonthYear[1]).padStart(2, '0')}`;\r\n            }\r\n\r\n            // Shipping 2027/08\r\n            const shippingYearMonth = textValue.match(/\\bShipping\\s+(20\\d{2})[\\/.-](\\d{1,2})\\b/i);\r\n            if (shippingYearMonth) {\r\n                return `${shippingYearMonth[1]}-${String(shippingYearMonth[2]).padStart(2, '0')}`;\r\n            }\r\n\r\n            // Release 08/2027\r\n            const releaseMonthYear = textValue.match(/\\b(?:Release|Released|Release Date|Shipping)\\s+(\\d{1,2})[\\/.-](20\\d{2})\\b/i);\r\n            if (releaseMonthYear) {\r\n                return `${releaseMonthYear[2]}-${String(releaseMonthYear[1]).padStart(2, '0')}`;\r\n            }\r\n        }\r\n\r\n        return '';\r\n    }\r\n\r\nfunction findDefinitionValue(labelNames) {\r\n  const wanted = labelNames.map(v => String(v).toLowerCase());\r\n\r\n  const dts = Array.from(document.querySelectorAll('dt'));\r\n\r\n  for (const dt of dts) {\r\n    const label = cleanText(dt.textContent || '').toLowerCase();\r\n\r\n    if (!wanted.some(w => label === w || label.includes(w))) continue;\r\n\r\n    let next = dt.nextElementSibling;\r\n\r\n    while (next && next.tagName && next.tagName.toLowerCase() !== 'dd') {\r\n      next = next.nextElementSibling;\r\n    }\r\n\r\n    if (next) {\r\n      const value = cleanText(next.textContent || '');\r\n      if (value) return value;\r\n    }\r\n  }\r\n\r\n  return '';\r\n}\r\n\r\n\r\n    function normalizeReleaseDate(value) {\r\n  const raw = cleanText(value);\r\n  if (!raw) return '';\r\n\r\n  // Late October 2027 / Early March 2027 / Mid July 2027\r\n  const monthYearWithPart = raw.match(\r\n    /\\b(?:Early|Mid|Late|End of|Beginning of)?\\s*(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\.?[\\s,-]+(20\\d{2})\\b/i\r\n  );\r\n\r\n  if (monthYearWithPart) {\r\n    return `${monthYearWithPart[1]} ${monthYearWithPart[2]}`;\r\n  }\r\n\r\n  // 2027/10 или 2027-10\r\n  const yearMonth = raw.match(/\\b(20\\d{2})[\\/.-](0?[1-9]|1[0-2])\\b/);\r\n  if (yearMonth) {\r\n    return `${yearMonth[1]}-${String(yearMonth[2]).padStart(2, '0')}`;\r\n  }\r\n\r\n  // 10/2027 или 10-2027\r\n  const monthYearNumber = raw.match(/\\b(0?[1-9]|1[0-2])[\\/.-](20\\d{2})\\b/);\r\n  if (monthYearNumber) {\r\n    return `${monthYearNumber[2]}-${String(monthYearNumber[1]).padStart(2, '0')}`;\r\n  }\r\n\r\n  // 2027 Q3\r\n  const quarter1 = raw.match(/\\b(20\\d{2})\\s*Q([1-4])\\b/i);\r\n  if (quarter1) return `${quarter1[1]} Q${quarter1[2]}`;\r\n\r\n  // Q3 2027\r\n  const quarter2 = raw.match(/\\bQ([1-4])\\s*(20\\d{2})\\b/i);\r\n  if (quarter2) return `${quarter2[2]} Q${quarter2[1]}`;\r\n\r\n  return raw;\r\n}\r\n\r\n\r\n    function findGoodSmileEuropeReleaseDate() {\r\n  const definitionValue = findDefinitionValue([\r\n    'Release',\r\n    'Release Date',\r\n    'Released',\r\n    'Shipping'\r\n  ]);\r\n\r\n  const normalizedDefinition = normalizeReleaseDate(definitionValue);\r\n  if (normalizedDefinition) return normalizedDefinition;\r\n\r\n  const labelValue = findLabelValue([\r\n    'Release',\r\n    'Release Date',\r\n    'Released',\r\n    'Shipping'\r\n  ]);\r\n\r\n  const normalizedLabel = normalizeReleaseDate(labelValue);\r\n  if (normalizedLabel) return normalizedLabel;\r\n\r\n  const bodyText = cleanText(document.body ? document.body.innerText : '');\r\n\r\n  const match = bodyText.match(\r\n    /\\bRelease\\s+((?:Early|Mid|Late|End of|Beginning of)?\\s*(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\.?\\s+20\\d{2}|20\\d{2}[\\/.-](?:0?[1-9]|1[0-2])|(?:0?[1-9]|1[0-2])[\\/.-]20\\d{2})/i\r\n  );\r\n\r\n  if (match) {\r\n    return normalizeReleaseDate(match[1]);\r\n  }\r\n\r\n  return '';\r\n}\r\n\r\n    function text(selector, root = document) {\r\n        const el = root.querySelector(selector);\r\n        return el ? cleanText(el.innerText || el.textContent) : '';\r\n    }\r\n\r\n    function attr(selector, attribute, root = document) {\r\n        const el = root.querySelector(selector);\r\n        return el ? el.getAttribute(attribute) || '' : '';\r\n    }\r\n\r\n    function cleanText(value) {\r\n        return String(value || '')\r\n            .replace(/&nbsp;/g, ' ')\r\n            .replace(/\\s+/g, ' ')\r\n            .trim();\r\n    }\r\n\r\n    function normalizeJan(value) {\r\n        const digits = String(value || '').replace(/\\D/g, '');\r\n        return digits.length >= 8 && digits.length <= 14 ? digits : '';\r\n    }\r\n\r\n    function normalizeJanList(value) {\r\n        const raw = String(value || '');\r\n        const matches = raw.match(/\\d[\\d\\s-]{6,20}\\d/g) || [];\r\n\r\n        return unique(\r\n            matches\r\n            .map(v => normalizeJan(v))\r\n            .filter(v => v.length >= 8 && v.length <= 14)\r\n        );\r\n    }\r\n\r\n    function getFirstJan(...values) {\r\n        for (const value of values) {\r\n            const list = normalizeJanList(value);\r\n            if (list.length) return list[0];\r\n        }\r\n\r\n        return '';\r\n    }\r\n\r\n    function findJanInPage() {\r\n        const candidates = [];\r\n\r\n        // 1. Сначала ищем рядом с явными JAN/EAN/Barcode/GTIN labels\r\n        const labelValue = findLabelValue([\r\n            'JAN code',\r\n            'JAN',\r\n            'EAN',\r\n            'Barcode',\r\n            'Bar code',\r\n            'GTIN',\r\n            'Product code',\r\n            'Product Code'\r\n        ]);\r\n\r\n        if (labelValue) candidates.push(labelValue);\r\n\r\n        // 2. Meta / title / structured snippets\r\n        candidates.push(\r\n            getMeta('product:retailer_item_id'),\r\n            getMeta('product:gtin'),\r\n            getMeta('product:gtin13'),\r\n            getMeta('product:gtin14'),\r\n            getMeta('og:title'),\r\n            document.title\r\n        );\r\n\r\n        // 3. Картинки часто содержат JAN в filename / alt / title\r\n        document.querySelectorAll('img').forEach(img => {\r\n            candidates.push(\r\n                img.getAttribute('alt'),\r\n                img.getAttribute('title'),\r\n                img.getAttribute('src'),\r\n                img.getAttribute('data-src'),\r\n                img.getAttribute('data-original'),\r\n                img.getAttribute('data-large_image')\r\n            );\r\n        });\r\n\r\n        // 4. WooCommerce variations часто содержат JAN внутри JSON в attribute/image/title/src\r\n        document.querySelectorAll('[data-product_variations]').forEach(el => {\r\n            candidates.push(el.getAttribute('data-product_variations'));\r\n        });\r\n\r\n        // 5. Небольшой fallback по тексту страницы, но только около слов JAN/EAN/Barcode/GTIN\r\n        const bodyText = cleanText(document.body?.innerText || '');\r\n        const nearJan = bodyText.match(/(?:JAN|EAN|Barcode|Bar code|GTIN|Product Code)[\\s:：-]{0,20}([0-9][0-9\\s/-]{6,30}[0-9])/i);\r\n        if (nearJan) candidates.push(nearJan[1]);\r\n\r\n        return getFirstJan(...candidates);\r\n    }\r\n\r\n    function cleanPrice(value) {\r\n        const raw = String(value || '').trim();\r\n        if (!raw) return '0';\r\n\r\n        const currency = detectCurrency(raw);\r\n\r\n        // JPY почти всегда без копеек/центов, поэтому любые точки/запятые считаем разделителями тысяч\r\n        if (currency === 'JPY' || raw.includes('JPY') || raw.includes('¥') || raw.includes('円')) {\r\n            const yen = raw.replace(/\\D/g, '');\r\n            return yen || '0';\r\n        }\r\n\r\n        let number = raw\r\n        .replace(/[^\\d.,]/g, '')\r\n        .trim();\r\n\r\n        if (!number) return '0';\r\n\r\n        const hasComma = number.includes(',');\r\n        const hasDot = number.includes('.');\r\n\r\n        // Пример: 1,234.56 -> 1234.56\r\n        if (hasComma && hasDot) {\r\n            const lastComma = number.lastIndexOf(',');\r\n            const lastDot = number.lastIndexOf('.');\r\n\r\n            if (lastDot > lastComma) {\r\n                number = number.replace(/,/g, '');\r\n            } else {\r\n                number = number.replace(/\\./g, '').replace(',', '.');\r\n            }\r\n\r\n            return number || '0';\r\n        }\r\n\r\n        // Пример: 1,234 -> 1234, но 55,58 -> 55.58\r\n        if (hasComma) {\r\n            const parts = number.split(',');\r\n            const last = parts[parts.length - 1];\r\n\r\n            if (last.length === 3 && parts.length >= 2) {\r\n                return number.replace(/,/g, '') || '0';\r\n            }\r\n\r\n            return number.replace(',', '.') || '0';\r\n        }\r\n\r\n        // Пример: 17.080 -> 17080, но 55.58 -> 55.58\r\n        if (hasDot) {\r\n            const parts = number.split('.');\r\n            const last = parts[parts.length - 1];\r\n\r\n            if (last.length === 3 && parts.length >= 2) {\r\n                return number.replace(/\\./g, '') || '0';\r\n            }\r\n\r\n            return number || '0';\r\n        }\r\n\r\n        return number || '0';\r\n    }\r\n\r\n    function detectCurrency(value) {\r\n        const raw = String(value || '').toUpperCase();\r\n        if (raw.includes('JPY') || raw.includes('¥') || raw.includes('円')) return 'JPY';\r\n        if (raw.includes('USD') || raw.includes('$')) return 'USD';\r\n        if (raw.includes('EUR') || raw.includes('€')) return 'EUR';\r\n        if (raw.includes('GBP') || raw.includes('£')) return 'GBP';\r\n        return '';\r\n    }\r\n\r\n    function absoluteUrl(url) {\r\n        if (!url) return '';\r\n        try {\r\n            return new URL(String(url), window.location.href).href;\r\n        } catch {\r\n            return String(url || '');\r\n        }\r\n    }\r\n\r\n    function unique(arr) {\r\n        return [...new Set((arr || []).map(v => cleanText(v)).filter(Boolean))];\r\n    }\r\n\r\n    function stripSiteSuffix(value) {\r\n        return cleanText(value)\r\n            .replace(/\\s*[|—-]\\s*Solaris Japan\\s*$/i, '')\r\n            .replace(/\\s*[|—-]\\s*Figuya\\s*[|—-]\\s*Good Smile Europe\\s*$/i, '')\r\n            .replace(/\\s*[|—-]\\s*Good Smile Europe\\s*$/i, '')\r\n            .replace(/\\s*[|—-]\\s*OrzGK\\s*$/i, '')\r\n            .replace(/\\s*\\|\\s*HobbySearch\\s*$/i, '')\r\n            .trim();\r\n    }\r\n\r\n    function getMeta(nameOrProperty) {\r\n        const el = document.querySelector(\r\n            `meta[property=\"${cssEscape(nameOrProperty)}\"], meta[name=\"${cssEscape(nameOrProperty)}\"]`\r\n    );\r\n        return el ? el.content || '' : '';\r\n    }\r\n\r\n    function getAllMeta(nameOrProperty) {\r\n        return Array.from(document.querySelectorAll(\r\n            `meta[property=\"${cssEscape(nameOrProperty)}\"], meta[name=\"${cssEscape(nameOrProperty)}\"]`\r\n    )).map(el => el.content || '').filter(Boolean);\r\n    }\r\n\r\n    function cssEscape(value) {\r\n        if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);\r\n        return String(value).replace(/\"/g, '\\\\\"');\r\n    }\r\n\r\n    function getCanonicalUrl() {\r\n        return attr('link[rel=\"canonical\"]', 'href') || getMeta('og:url') || window.location.href;\r\n    }\r\n\r\n    function getBestImage(selectors = []) {\r\n        for (const selector of selectors) {\r\n            const value = attr(selector, 'src') || attr(selector, 'data-src') || attr(selector, 'data-original') || attr(selector, 'data-zoom-image');\r\n            if (value) return absoluteUrl(value);\r\n        }\r\n\r\n        const secureOg = getMeta('og:image:secure_url');\r\n        if (secureOg) return absoluteUrl(secureOg);\r\n\r\n        const ogImage = getMeta('og:image');\r\n        if (ogImage) return absoluteUrl(ogImage);\r\n\r\n        const img = document.querySelector('main img, [class*=\"product\"] img, img');\r\n        return img ? absoluteUrl(img.currentSrc || img.src || img.getAttribute('src')) : '';\r\n    }\r\n\r\n    function collectImagesFromMeta() {\r\n        return unique([\r\n            ...getAllMeta('og:image:secure_url'),\r\n            ...getAllMeta('og:image')\r\n        ].map(absoluteUrl));\r\n    }\r\n\r\n    function collectImagesFromSelectors(selectors = []) {\r\n        const images = [];\r\n\r\n        for (const selector of selectors) {\r\n            document.querySelectorAll(selector).forEach(img => {\r\n                const src = img.currentSrc || img.src || img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original');\r\n                if (src && !String(src).startsWith('data:')) images.push(absoluteUrl(src));\r\n            });\r\n        }\r\n\r\n        return unique(images);\r\n    }\r\n\r\n    function splitReleaseDate(value) {\r\n        const raw = cleanText(value);\r\n        if (!raw) return { releaseDate: '', month: '', year: '' };\r\n\r\n        const amiamiMatch = raw.match(/^([A-Za-z]{3,9})[-\\s/]+(\\d{4})$/);\r\n        if (amiamiMatch) {\r\n            const monthRaw = amiamiMatch[1];\r\n            const year = amiamiMatch[2];\r\n            return { releaseDate: raw, month: MONTHS[monthRaw] || monthRaw, year };\r\n        }\r\n\r\n        const yearMonthMatch = raw.match(/(\\d{4})[-/.年\\s]+(\\d{1,2})/);\r\n        if (yearMonthMatch) {\r\n            const year = yearMonthMatch[1];\r\n            const monthNumber = Number(yearMonthMatch[2]);\r\n            const ruMonths = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];\r\n            return { releaseDate: raw, month: ruMonths[monthNumber] || '', year };\r\n        }\r\n\r\n        const monthYearMatch = raw.match(/([A-Za-z]{3,9})\\s+(\\d{4})/);\r\n        if (monthYearMatch) {\r\n            const monthRaw = monthYearMatch[1];\r\n            const year = monthYearMatch[2];\r\n            return { releaseDate: raw, month: MONTHS[monthRaw] || monthRaw, year };\r\n        }\r\n\r\n        const yearOnly = raw.match(/(\\d{4})/);\r\n        return { releaseDate: raw, month: '', year: yearOnly ? yearOnly[1] : '' };\r\n    }\r\n\r\n    function findLabelValue(labelNames) {\r\n        const wanted = labelNames.map(v => String(v).toLowerCase());\r\n        const rows = Array.from(document.querySelectorAll('tr, dl, .item-about__data, .item-about__data-row, li, div'));\r\n\r\n        for (const row of rows) {\r\n            const rowText = cleanText(row.innerText || row.textContent);\r\n            if (!rowText || rowText.length > 400) continue;\r\n            const lower = rowText.toLowerCase();\r\n\r\n            for (const label of wanted) {\r\n                if (lower.includes(label)) {\r\n                    const parts = rowText\r\n                    .replace(/：/g, ':')\r\n                    .split(':')\r\n                    .map(cleanText)\r\n                    .filter(Boolean);\r\n\r\n                    if (parts.length >= 2) return parts.slice(1).join(': ');\r\n                }\r\n            }\r\n        }\r\n\r\n        return '';\r\n    }\r\n\r\n    function getJsonLdObjects() {\r\n        const found = [];\r\n\r\n        function walk(value) {\r\n            if (!value) return;\r\n\r\n            if (Array.isArray(value)) {\r\n                value.forEach(walk);\r\n                return;\r\n            }\r\n\r\n            if (typeof value !== 'object') return;\r\n\r\n            found.push(value);\r\n\r\n            if (Array.isArray(value['@graph'])) value['@graph'].forEach(walk);\r\n            if (value.mainEntity) walk(value.mainEntity);\r\n            if (value.itemListElement) walk(value.itemListElement);\r\n            if (value.item) walk(value.item);\r\n        }\r\n\r\n        document.querySelectorAll('script[type=\"application/ld+json\"], script[type=\"application/json+ld\"]').forEach(script => {\r\n            const raw = script.textContent || '';\r\n            if (!raw.trim()) return;\r\n\r\n            try {\r\n                walk(JSON.parse(raw));\r\n            } catch (error) {\r\n                // Some shops embed invalid JSON-LD. Ignore and use meta/DOM fallback.\r\n            }\r\n        });\r\n\r\n        return found;\r\n    }\r\n\r\n    function hasType(obj, typeName) {\r\n        const type = obj && obj['@type'];\r\n        if (Array.isArray(type)) return type.map(String).some(t => t.toLowerCase() === typeName.toLowerCase());\r\n        return String(type || '').toLowerCase() === typeName.toLowerCase();\r\n    }\r\n\r\n    function findJsonLdProduct() {\r\n        return getJsonLdObjects().find(obj => hasType(obj, 'Product')) || null;\r\n    }\r\n\r\n    function asArray(value) {\r\n        if (!value) return [];\r\n        return Array.isArray(value) ? value : [value];\r\n    }\r\n\r\n    function getNamedValue(value) {\r\n        if (!value) return '';\r\n        if (typeof value === 'string') return cleanText(value);\r\n        if (typeof value === 'object') return cleanText(value.name || value['@id'] || value.url || '');\r\n        return cleanText(value);\r\n    }\r\n\r\n    function getOffer(product) {\r\n        const offers = asArray(product && product.offers).filter(Boolean);\r\n        if (!offers.length) return {};\r\n\r\n        const notOut = offers.find(o => !/outofstock/i.test(String(o.availability || '')));\r\n        const newCondition = offers.find(o => /newcondition/i.test(String(o.itemCondition || '')));\r\n        return newCondition || notOut || offers[0] || {};\r\n    }\r\n\r\n    function looksLikeJan(value) {\r\n        const digits = String(value || '').replace(/\\D/g, '');\r\n        return digits.length >= 8 && digits.length <= 14 ? digits : '';\r\n    }\r\n\r\n    function extractCodeFromUrl(url = window.location.href) {\r\n        const raw = String(url || '');\r\n        const amiami = raw.match(/[?&]scode=([^&]+)/i);\r\n        if (amiami) return decodeURIComponent(amiami[1]);\r\n\r\n        const hobby = raw.match(/\\/eng\\/(\\d+)/i);\r\n        if (hobby) return hobby[1];\r\n\r\n        return '';\r\n    }\r\n\r\n    function extractFromJsonLdProduct(product) {\r\n        if (!product) return {};\r\n        const jan = getFirstJan(\r\n            product.gtin13,\r\n            product.gtin14,\r\n            product.gtin12,\r\n            product.gtin,\r\n            product.sku,\r\n            product.mpn,\r\n            product.productID\r\n        );\r\n        const offer = getOffer(product);\r\n        const images = unique(asArray(product.image).map(img => {\r\n            if (typeof img === 'string') return absoluteUrl(img);\r\n            if (img && typeof img === 'object') return absoluteUrl(img.url || img.contentUrl || '');\r\n            return '';\r\n        }));\r\n\r\n        const sku = cleanText(product.sku || offer.sku || '');\r\n        const mpn = cleanText(product.mpn || '');\r\n        const productID = cleanText(product.productID || product.productId || '');\r\n        const gtin = cleanText(product.gtin13 || product.gtin14 || product.gtin12 || product.gtin || '');\r\n\r\n        return {\r\n            name: cleanText(product.name || ''),\r\n            price: cleanPrice(offer.price || product.price || ''),\r\n            currency: cleanText(offer.priceCurrency || product.priceCurrency || ''),\r\n            brand: getNamedValue(product.brand),\r\n            maker: getNamedValue(product.manufacturer) || getNamedValue(product.brand),\r\n            manufacturer: getNamedValue(product.manufacturer) || getNamedValue(product.brand),\r\n            releaseDate: cleanText(product.releaseDate || product.datePublished || ''),\r\n            imageUrl: images[0] || '',\r\n            img: images[0] || '',\r\n            images,\r\n            url: absoluteUrl(product.url || offer.url || getCanonicalUrl()),\r\n            sourceUrl: absoluteUrl(product.url || offer.url || getCanonicalUrl()),\r\n            sku,\r\n            mpn,\r\n            jan,\r\n            code: cleanText(product.sku || product.mpn || product.productID || ''),\r\n            raw: {\r\n                jsonLd: {\r\n                    name: product.name || '',\r\n                    sku,\r\n                    mpn,\r\n                    gtin,\r\n                    productID,\r\n                    brand: getNamedValue(product.brand),\r\n                    manufacturer: getNamedValue(product.manufacturer),\r\n                    price: offer.price || '',\r\n                    currency: offer.priceCurrency || ''\r\n                }\r\n            }\r\n        };\r\n    }\r\n\r\n    function extractFromMeta() {\r\n        const title = getMeta('og:title') || document.title || '';\r\n        const images = collectImagesFromMeta();\r\n\r\n        return {\r\n            name: stripSiteSuffix(title),\r\n            price: cleanPrice(getMeta('product:price:amount') || getMeta('og:price:amount') || getMeta('twitter:data1') || ''),\r\n            currency: cleanText(getMeta('product:price:currency') || getMeta('og:price:currency') || ''),\r\n            imageUrl: images[0] || '',\r\n            img: images[0] || '',\r\n            images,\r\n            url: absoluteUrl(getMeta('og:url') || getCanonicalUrl()),\r\n            sourceUrl: absoluteUrl(getMeta('og:url') || getCanonicalUrl())\r\n        };\r\n    }\r\n\r\n    function mergeData(...objects) {\r\n        const out = {};\r\n        for (const obj of objects) {\r\n            if (!obj) continue;\r\n            for (const [key, value] of Object.entries(obj)) {\r\n                if (key === 'images') {\r\n                    out.images = unique([...(out.images || []), ...asArray(value)]);\r\n                } else if (key === 'raw') {\r\n                    out.raw = Object.assign({}, out.raw || {}, value || {});\r\n                } else if ((out[key] == null || out[key] === '' || (Array.isArray(out[key]) && !out[key].length)) && value != null && value !== '') {\r\n                    out[key] = value;\r\n                }\r\n            }\r\n        }\r\n        return out;\r\n    }\r\n\r\n    function isSuspiciousManufacturer(value) {\r\n        const raw = cleanText(value);\r\n        if (!raw) return false;\r\n        if (raw.length > 80) return true;\r\n        return /categories|login sign up|search by category|view all|model train|military model|pvc figure|anime robot/i.test(raw);\r\n    }\r\n\r\n    function normalizeManufacturer(value, fallback = '') {\r\n        const raw = cleanText(value);\r\n        if (!raw || isSuspiciousManufacturer(raw)) return cleanText(fallback);\r\n        return raw;\r\n    }\r\n\r\n    function normalizeItem(raw, sourceId, sourceName) {\r\n        const release = splitReleaseDate(raw.releaseDate);\r\n        const jan = normalizeJan(raw.jan || raw.JAN) || findJanInPage();\r\n\r\n        return {\r\n            name: raw.name || '',\r\n            price: cleanPrice(raw.price),\r\n            currency: raw.currency || detectCurrency(raw.price),\r\n            brand: raw.brand || raw.maker || '',\r\n            maker: raw.maker || raw.brand || '',\r\n            manufacturer: raw.manufacturer || raw.maker || raw.brand || '',\r\n            releaseDate: release.releaseDate,\r\n            month: release.month,\r\n            year: release.year,\r\n            img: absoluteUrl(raw.img || raw.imageUrl || ''),\r\n            imageUrl: absoluteUrl(raw.imageUrl || raw.img || ''),\r\n            images: raw.images || [],\r\n            url: raw.url || window.location.href,\r\n            sourceUrl: raw.sourceUrl || window.location.href,\r\n            store: raw.store || sourceName,\r\n            source: sourceId,\r\n            jan,\r\n            code: raw.code || raw.amiamiCode || raw.productCode || raw.sku || raw.mpn || '',\r\n            sku: raw.sku || '',\r\n            category: raw.category || '',\r\n            scale: raw.scale || '',\r\n            raw\r\n        };\r\n    }\r\n\r\n    function makePayload(profile, items) {\r\n        return {\r\n            app: 'FigureTracker',\r\n            source: profile.id,\r\n            sourceName: profile.name,\r\n            version: 2,\r\n            copiedAt: new Date().toISOString(),\r\n            pageUrl: window.location.href,\r\n            items\r\n        };\r\n    }\r\n\r\n    function parseByJsonLdAndMeta(extra = {}) {\r\n        const jsonLd = extractFromJsonLdProduct(findJsonLdProduct());\r\n        const meta = extractFromMeta();\r\n        return [mergeData(jsonLd, meta, extra)];\r\n    }\r\n\r\n    function parseAmiAmi() {\r\n        const name = text('h2.item-detail__section-title') || text('h1') || getMeta('og:title');\r\n        const priceText = text('.item-detail__price_selling-price') || findLabelValue(['Price', 'Sale price', 'Selling price']);\r\n        const imageUrl = getBestImage(['img[src*=\"/main/\"]', '.item-detail__main-img img', '.item-detail__image img', 'img']);\r\n\r\n        let brand = '';\r\n        let releaseDate = '';\r\n        let jan = '';\r\n\r\n        const dts = document.querySelectorAll('.item-about__data-title');\r\n        const dds = document.querySelectorAll('.item-about__data-text');\r\n\r\n        dts.forEach((dt, index) => {\r\n            const label = cleanText(dt.innerText || dt.textContent);\r\n            const value = dds[index] ? cleanText(dds[index].innerText || dds[index].textContent) : '';\r\n            if (label === 'Release Date') releaseDate = value;\r\n            if (label === 'Brand') brand = value;\r\n            if (/jan/i.test(label)) jan = value;\r\n            jan = normalizeJan(jan) || findJanInPage();\r\n        });\r\n\r\n        const codeFromUrl = window.location.href.match(/scode=([^&]+)/i);\r\n\r\n        return [{\r\n            name,\r\n            price: priceText,\r\n            currency: 'JPY',\r\n            brand,\r\n            maker: brand,\r\n            manufacturer: brand,\r\n            releaseDate,\r\n            imageUrl,\r\n            images: imageUrl ? [imageUrl] : [],\r\n            sourceUrl: window.location.href,\r\n            amiamiCode: codeFromUrl ? decodeURIComponent(codeFromUrl[1]) : '',\r\n            jan\r\n        }];\r\n    }\r\n\r\n    function parseHobbySearch() {\r\n        const json = extractFromJsonLdProduct(findJsonLdProduct());\r\n        const meta = extractFromMeta();\r\n\r\n        return [mergeData(json, meta, {\r\n            store: 'HobbySearch',\r\n            sourceUrl: window.location.href,\r\n            url: window.location.href,\r\n            code: json.code || json.mpn || extractCodeFromUrl(),\r\n            currency: json.currency || meta.currency || 'USD',\r\n            brand: normalizeManufacturer(json.brand || json.maker || json.manufacturer),\r\n            maker: normalizeManufacturer(json.maker || json.brand || json.manufacturer)\r\n        })];\r\n    }\r\n\r\n    function parseMandarake() {\r\n        const json = extractFromJsonLdProduct(findJsonLdProduct());\r\n        if (json.name || json.price || json.imageUrl) {\r\n            return [mergeData(json, extractFromMeta(), { store: 'Mandarake' })];\r\n        }\r\n\r\n        const name = text('h1') || text('.item-title') || text('[class*=\"title\"]') || getMeta('og:title');\r\n        const priceText = text('.price') || text('[class*=\"price\"]') || findLabelValue(['Price', '販売価格']);\r\n        const imageUrl = getBestImage(['.itemImage img', '.product-image img', 'img[src*=\"manda\"]', 'img']);\r\n        const brand = findLabelValue(['Maker', 'Manufacturer', 'Brand', 'メーカー']);\r\n        const releaseDate = findLabelValue(['Release Date', 'Release', '発売日']);\r\n\r\n        return [{\r\n            name,\r\n            price: priceText,\r\n            currency: detectCurrency(priceText) || 'JPY',\r\n            brand,\r\n            maker: brand,\r\n            manufacturer: brand,\r\n            releaseDate,\r\n            imageUrl,\r\n            images: imageUrl ? [imageUrl] : [],\r\n            sourceUrl: window.location.href,\r\n            store: 'Mandarake'\r\n        }];\r\n    }\r\n\r\n    function parseSolaris() {\r\n        const json = extractFromJsonLdProduct(findJsonLdProduct());\r\n        const meta = extractFromMeta();\r\n\r\n        return [mergeData(json, meta, {\r\n            store: 'Solaris Japan',\r\n            sourceUrl: window.location.href,\r\n            url: window.location.href\r\n        })];\r\n    }\r\n\r\n    function parseGoodSmileEurope() {\r\n        const json = extractFromJsonLdProduct(findJsonLdProduct());\r\n        const meta = extractFromMeta();\r\n\r\n        let maker = json.maker || json.brand || json.manufacturer;\r\n        if (!maker) {\r\n            const title = cleanText(json.name || meta.name || document.title);\r\n            const match = title.match(/,\\s*([^,|]+?)\\s*\\|\\s*Figuya/i) || title.match(/-\\s*([^-|]+?)\\s*\\|\\s*Figuya/i);\r\n            if (match) maker = cleanText(match[1]);\r\n            if (/Good Smile Company/i.test(title)) maker = 'Good Smile Company';\r\n        }\r\n\r\n        const releaseDate =\r\n  findGoodSmileEuropeReleaseDate() ||\r\n  findReleaseDateInPage() ||\r\n  json.releaseDate ||\r\n  meta.releaseDate ||\r\n  '';\r\n\r\nreturn [mergeData({\r\n  releaseDate\r\n}, json, meta, {\r\n  name: json.name || stripSiteSuffix(meta.name || document.title),\r\n  brand: maker,\r\n  maker,\r\n  manufacturer: maker,\r\n  store: 'Good Smile Europe',\r\n  sourceUrl: window.location.href,\r\n  url: window.location.href\r\n})];\r\n    }\r\n\r\n    function parseGoodSmile() {\r\n        const json = extractFromJsonLdProduct(findJsonLdProduct());\r\n        if (json.name || json.price || json.imageUrl) {\r\n            const releaseDate =\r\n                  findGoodSmileReleaseDate() ||\r\n                  findReleaseDateInPage() ||\r\n                  json.releaseDate ||\r\n                  '';\r\n\r\n            return [mergeData(json, extractFromMeta(), {\r\n                releaseDate,\r\n                brand: json.brand || json.maker || 'Good Smile Company',\r\n                maker: json.maker || json.brand || 'Good Smile Company',\r\n                manufacturer: json.manufacturer || json.maker || json.brand || 'Good Smile Company',\r\n                store: 'Good Smile'\r\n            })];\r\n        }\r\n\r\n        const name = text('h1') || text('.product-title') || getMeta('og:title');\r\n        const priceText = text('[class*=\"price\"]') || findLabelValue(['Price', '価格']);\r\n        const imageUrl = getBestImage(['.product-image img', '.swiper-slide img', 'img']);\r\n        const brand = 'Good Smile Company';\r\n        const releaseDate =\r\n              findGoodSmileReleaseDate() ||\r\n              findReleaseDateInPage() ||\r\n              findLabelValue(['Release Date', 'Release', '発売時期', 'Release Info']) ||\r\n              '';\r\n        return [{\r\n            name,\r\n            price: priceText,\r\n            currency: detectCurrency(priceText) || 'JPY',\r\n            brand,\r\n            maker: brand,\r\n            manufacturer: brand,\r\n            releaseDate,\r\n            imageUrl,\r\n            images: imageUrl ? [imageUrl] : [],\r\n            sourceUrl: window.location.href,\r\n            store: 'Good Smile'\r\n        }];\r\n    }\r\n\r\n    function getOrzGKSelectedVariationPrice() {\r\n        const selectors = [\r\n            '.single_variation .woocommerce-variation-price .woocommerce-Price-amount bdi',\r\n            '.single_variation .woocommerce-variation-price .woocommerce-Price-amount',\r\n            '.single_variation .woocommerce-variation-price .price',\r\n            '.woocommerce-variation-price .woocommerce-Price-amount bdi',\r\n            '.woocommerce-variation-price .woocommerce-Price-amount',\r\n            '.woocommerce-variation-price .price'\r\n        ];\r\n\r\n        for (const selector of selectors) {\r\n            const el = document.querySelector(selector);\r\n            if (!el) continue;\r\n\r\n            const value = cleanText(el.textContent || el.innerText || '');\r\n            if (value && /[\\d]/.test(value)) {\r\n                return value;\r\n            }\r\n        }\r\n\r\n        return '';\r\n    }\r\n\r\n    function getCurrencyFromPriceText(value) {\r\n        const raw = String(value || '');\r\n\r\n        if (raw.includes('€')) return 'EUR';\r\n        if (raw.includes('$')) return 'USD';\r\n        if (raw.includes('¥') || raw.includes('円')) return 'JPY';\r\n        if (/EUR/i.test(raw)) return 'EUR';\r\n        if (/USD/i.test(raw)) return 'USD';\r\n        if (/JPY/i.test(raw)) return 'JPY';\r\n\r\n        return '';\r\n    }\r\n\r\n    function findOrzGKReleaseDate() {\r\n        const bodyText = cleanText(document.body ? document.body.innerText : '');\r\n\r\n        const match = bodyText.match(\r\n            /Est\\.?\\s*Released\\s*Time[\\s:：-]{0,30}(20\\d{2})[\\/.-](0?[1-9]|1[0-2])/i\r\n        );\r\n\r\n        if (match) {\r\n            return `${match[1]}-${String(match[2]).padStart(2, '0')}`;\r\n        }\r\n\r\n        return findReleaseDateInPage();\r\n    }\r\n\r\n    function parseOrzGK() {\r\n        const json = extractFromJsonLdProduct(findJsonLdProduct()) || {};\r\n        const meta = extractFromMeta() || {};\r\n\r\n        const galleryImages = collectImagesFromSelectors([\r\n            '.woocommerce-product-gallery img',\r\n            '.product-gallery img',\r\n            '.product img',\r\n            'main img'\r\n        ]);\r\n\r\n        const title = stripSiteSuffix(\r\n            json.name ||\r\n            meta.name ||\r\n            text('h1.product-title') ||\r\n            text('h1.entry-title') ||\r\n            text('h1') ||\r\n            document.title\r\n        );\r\n\r\n        const manufacturerFromTitle =\r\n              (title.match(/^([A-Z0-9][A-Z0-9 ._-]+?)\\s+-\\s+/i) || [])[1] || '';\r\n\r\n        const fullText = cleanText(document.body ? document.body.innerText : '');\r\n\r\n        const janCandidate =\r\n              looksLikeJan(json.jan) ||\r\n              looksLikeJan(findJanInPage()) ||\r\n              looksLikeJan((fullText.match(/\\b\\d{12,14}\\b/) || [])[0]) ||\r\n              '';\r\n\r\n        const selectedVariationPrice = getOrzGKSelectedVariationPrice();\r\n\r\n        const priceText =\r\n              selectedVariationPrice ||\r\n              json.price ||\r\n              meta.price ||\r\n              text('.summary .price') ||\r\n              text('.product .price') ||\r\n              '';\r\n\r\n        const currency =\r\n              getCurrencyFromPriceText(selectedVariationPrice) ||\r\n              getCurrencyFromPriceText(priceText) ||\r\n              json.currency ||\r\n              meta.currency ||\r\n              detectCurrency(priceText) ||\r\n              '';\r\n\r\n        const images = unique([\r\n            ...(json.images || []),\r\n            ...(meta.images || []),\r\n            ...galleryImages\r\n        ]);\r\n\r\n        const releaseDate =\r\n              findReleaseDateInPage() ||\r\n              json.releaseDate ||\r\n              meta.releaseDate ||\r\n              '';\r\n\r\n        const brand =\r\n              cleanText(json.brand || json.maker || json.manufacturer || manufacturerFromTitle);\r\n\r\n        return [{\r\n            name: title,\r\n            price: priceText,\r\n            currency,\r\n\r\n            brand,\r\n            maker: brand,\r\n            manufacturer: brand,\r\n\r\n            releaseDate,\r\n            month: '',\r\n            year: '',\r\n\r\n            imageUrl: json.imageUrl || meta.imageUrl || galleryImages[0] || '',\r\n            img: json.img || meta.img || galleryImages[0] || '',\r\n            images,\r\n\r\n            jan: janCandidate,\r\n            code: json.code || json.sku || json.mpn || janCandidate,\r\n\r\n            sku: json.sku || '',\r\n            store: 'OrzGK',\r\n            sourceUrl: window.location.href,\r\n            url: window.location.href,\r\n\r\n            raw: {\r\n                json,\r\n                meta,\r\n                selectedVariationPrice,\r\n                priceText,\r\n                currency\r\n            }\r\n        }];\r\n    }\r\n\r\n    function parseGeneric() {\r\n        const json = extractFromJsonLdProduct(findJsonLdProduct());\r\n        if (json.name || json.price || json.imageUrl) return [mergeData(json, extractFromMeta())];\r\n\r\n        const name = text('h1') || text('h2') || getMeta('og:title') || document.title;\r\n        const priceText = text('[class*=\"price\"]') || text('[id*=\"price\"]') || getMeta('product:price:amount') || '';\r\n        const imageUrl = getBestImage(['[class*=\"product\"] img', '[class*=\"gallery\"] img', 'main img', 'img']);\r\n        const brand = findLabelValue(['Brand', 'Maker', 'Manufacturer', 'Производитель', 'Бренд']);\r\n        const releaseDate = findLabelValue(['Release Date', 'Release', 'Дата релиза', '発売日']);\r\n\r\n        return [{\r\n            name,\r\n            price: priceText,\r\n            currency: getMeta('product:price:currency') || detectCurrency(priceText),\r\n            brand,\r\n            maker: brand,\r\n            manufacturer: brand,\r\n            releaseDate,\r\n            imageUrl,\r\n            images: imageUrl ? [imageUrl] : [],\r\n            sourceUrl: window.location.href,\r\n            store: location.hostname.replace(/^www\\./, '')\r\n        }];\r\n    }\r\n\r\n    function getCurrentProfile() {\r\n        const host = location.hostname.replace(/^www\\./, '');\r\n        return SITE_PROFILES.find(profile => profile.matches(host)) || {\r\n            id: 'generic',\r\n            name: host,\r\n            matches: () => true,\r\n            parse: parseGeneric\r\n        };\r\n    }\r\n\r\n    function copyToClipboard(value) {\r\n        if (typeof GM_setClipboard === 'function') {\r\n            GM_setClipboard(value, 'text');\r\n            return Promise.resolve();\r\n        }\r\n        return navigator.clipboard.writeText(value);\r\n    }\r\n\r\n    async function sendToTracker() {\r\n        try {\r\n            const profile = getCurrentProfile();\r\n            const rawItems = profile.parse();\r\n\r\n            const items = rawItems\r\n            .map(item => normalizeItem(item, profile.id, profile.name))\r\n            .filter(item => item.name || item.imageUrl || item.price);\r\n\r\n            if (!items.length) {\r\n                alert('Не получилось найти данные товара на этой странице.');\r\n                return;\r\n            }\r\n\r\n            const payload = makePayload(profile, items);\r\n            const dataStr = JSON.stringify(payload, null, 2);\r\n\r\n            await copyToClipboard(dataStr);\r\n\r\n            const first = items[0];\r\n            alert(\r\n                `Скопировано для Figure Tracker!\\n\\n` +\r\n                `Сайт: ${profile.name}\\n` +\r\n                `Название: ${first.name || '—'}\\n` +\r\n                `Цена: ${first.price || '—'} ${first.currency || ''}\\n` +\r\n                `Производитель: ${first.maker || '—'}\\n` +\r\n                `${first.jan ? `JAN: ${first.jan}\\n` : ''}` +\r\n                `${first.code ? `Код: ${first.code}` : ''}`\r\n      );\r\n        } catch (error) {\r\n            console.error('[Figure Tracker Importer]', error);\r\n            alert('Ошибка при сборе данных. Подробности в console.');\r\n        }\r\n    }\r\n\r\n    function createButton() {\r\n        if (document.getElementById('figure-tracker-import-btn')) return;\r\n\r\n        const btn = document.createElement('button');\r\n        btn.id = 'figure-tracker-import-btn';\r\n        btn.innerHTML = '📋 В трекер';\r\n\r\n        Object.assign(btn.style, {\r\n            position: 'fixed',\r\n            top: '115px',\r\n            right: '20px',\r\n            zIndex: '999999',\r\n            padding: '10px 16px',\r\n            background: '#f38029',\r\n            color: '#ffffff',\r\n            fontSize: '14px',\r\n            fontWeight: 'bold',\r\n            border: 'none',\r\n            borderRadius: '10px',\r\n            cursor: 'pointer',\r\n            boxShadow: '0 4px 14px rgba(0,0,0,0.25)',\r\n            transition: 'transform 0.15s ease, background 0.2s ease'\r\n        });\r\n\r\n        btn.addEventListener('mouseenter', () => {\r\n            btn.style.background = '#ff9a3d';\r\n            btn.style.transform = 'translateY(-1px)';\r\n        });\r\n\r\n        btn.addEventListener('mouseleave', () => {\r\n            btn.style.background = '#f38029';\r\n            btn.style.transform = 'translateY(0)';\r\n        });\r\n\r\n        btn.addEventListener('click', sendToTracker);\r\n\r\n        document.body.appendChild(btn);\r\n    }\r\n\r\n    function waitForPageReady() {\r\n        if (document.readyState === 'loading') {\r\n            document.addEventListener('DOMContentLoaded', createButton);\r\n        } else {\r\n            createButton();\r\n        }\r\n    }\r\n\r\n    waitForPageReady();\r\n})();";

function isMobileViewport() {
  return window.matchMedia('(max-width: 768px)').matches;
}

function isDisplayed(id) {
  const el = document.getElementById(id);
  return Boolean(el && el.style.display !== 'none' && !el.hidden);
}

function shouldIgnoreDuplicateNav(lastAt, gap = 140) {
  const now = performance.now();
  return Boolean(lastAt) && now - lastAt < gap;
}

function isEntitySwipeBlocked(event) {
  return Boolean(event?.target?.closest?.(
    'button, a, input, textarea, select, video, [data-no-swipe], [data-no-card-open]'
  ));
}

function pushUiHistory(kind) {
  if (!window.history?.pushState || appState.historyLayer === kind) return;
  history.pushState({ figureTrackerLayer: kind }, '');
  appState.historyLayer = kind;
}

function updateGlobalSearchDropdownTop() {
  const input = document.getElementById('globalSearchInput');
  if (!input) return;
  const rect = input.getBoundingClientRect();
  document.documentElement.style.setProperty('--global-search-dropdown-top', `${Math.round(rect.bottom + 6)}px`);
}

export function stopMediaEvent(event) {
  event?.stopPropagation();
}

export function isCardOpenBlocked(event) {
  return Boolean(event?.target?.closest(
    'video, audio, button, a, input, select, textarea, [data-no-card-open], [data-no-swipe], [data-no-lightbox-close], .app-video-wrap, .app-video-controls, .app-video-play, .app-video-mute, .media-video-preview, .media-video-toggle, .media-video-sound, .media-open-btn, .lightbox-arrow, .lightbox-close'
  ));
}

export function pauseAllVideosExcept(exceptVideo = null) {
  document.querySelectorAll('video').forEach(video => {
    if (video.dataset.gifLike === 'true') return;
    if (video !== exceptVideo && !video.paused) video.pause();
  });
}

export function updateAppVideoControls(video) {
  const wrap = video?.closest?.('.app-video-wrap');
  if (!wrap) return;
  const playBtn = wrap.querySelector('.app-video-play');
  const muteBtn = wrap.querySelector('.app-video-mute');
  if (playBtn) playBtn.textContent = video.paused || video.ended ? '▶' : '⏸';
  if (muteBtn) muteBtn.textContent = video.muted ? '🔇' : '🔊';
}

export function toggleAppVideoPlay(event, videoId) {
  event?.preventDefault();
  event?.stopPropagation();
  const video = document.getElementById(videoId);
  if (!video) return;
  if (video.paused || video.ended) video.play?.().catch(console.warn);
  else video.pause();
  updateAppVideoControls(video);
}

export function toggleAppVideoMute(event, videoId) {
  event?.preventDefault();
  event?.stopPropagation();
  const video = document.getElementById(videoId);
  if (!video) return;
  video.muted = !video.muted;
  updateAppVideoControls(video);
}

export function bindAppVideoControls(root = document) {
  root.querySelectorAll?.('video[data-app-video="true"]').forEach(video => {
    if (video.dataset.videoBound === 'true') {
      updateAppVideoControls(video);
      return;
    }
    video.dataset.videoBound = 'true';
    ['play', 'pause', 'volumechange', 'ended'].forEach(eventName => {
      video.addEventListener(eventName, () => updateAppVideoControls(video));
    });
    updateAppVideoControls(video);
  });
}

function createAppVideoElement(src, className = '', wrapClass = '') {
  const wrap = document.createElement('div');
  const videoId = `app-video-${crypto.randomUUID()}`;
  wrap.className = `app-video-wrap ${wrapClass}`.trim();
  wrap.dataset.noCardOpen = 'true';
  wrap.dataset.noSwipe = 'true';
  wrap.dataset.noLightboxClose = 'true';
  const video = document.createElement('video');
  video.id = videoId;
  video.className = `app-video ${className}`.trim();
  video.src = src;
  video.playsInline = true;
  video.preload = 'metadata';
  video.dataset.appVideo = 'true';
  video.dataset.noCardOpen = 'true';
  video.dataset.noSwipe = 'true';
  video.dataset.noLightboxClose = 'true';
  const controls = document.createElement('div');
  controls.className = 'app-video-controls';
  controls.dataset.noCardOpen = 'true';
  controls.dataset.noSwipe = 'true';
  controls.dataset.noLightboxClose = 'true';
  controls.innerHTML = `
    <button class="app-video-play" type="button" onclick="toggleAppVideoPlay(event, '${videoId}')">▶</button>
    <button class="app-video-mute" type="button" onclick="toggleAppVideoMute(event, '${videoId}')">🔇</button>
  `;
  wrap.append(video, controls);
  return { wrap, video };
}

function captureAppVideoState(sourceVideo) {
  if (!sourceVideo || sourceVideo.dataset.gifLike === 'true') return null;
  const wasPaused = sourceVideo.paused;
  const videoState = {
    currentTime: sourceVideo.currentTime || 0,
    paused: wasPaused,
    muted: sourceVideo.muted,
    volume: sourceVideo.volume,
    playbackRate: sourceVideo.playbackRate || 1
  };
  if (!wasPaused) sourceVideo.pause();
  return videoState;
}

export function syncPreviewVideoToggle(video) {
  const wrapper = video?.closest?.('.media-video-preview');
  if (!wrapper) return;
  const isPlaying = Boolean(video && !video.paused && !video.ended);
  wrapper.classList.toggle('is-playing', isPlaying);
  const btn = wrapper.querySelector('.media-video-toggle');
  if (btn) {
    btn.innerHTML = isPlaying ? '⏸' : '▶';
    btn.setAttribute('aria-label', isPlaying ? t('video.pause') : t('video.play'));
  }
  const soundBtn = wrapper.querySelector('.media-video-sound');
  if (soundBtn) {
    soundBtn.textContent = video.muted ? '🔇' : '🔊';
    soundBtn.setAttribute('aria-label', video.muted ? t('video.soundOn') : t('video.soundOff'));
  }
}

export function togglePreviewVideoSound(event) {
  stopMediaEvent(event);
  const wrapper = event?.currentTarget?.closest?.('.media-video-preview')
    || event?.target?.closest?.('.media-video-preview');
  const video = wrapper?.querySelector('video');
  if (!video) return;

  video.muted = !video.muted;
  video.volume = video.muted ? 0 : 1;
  syncPreviewVideoToggle(video);
}

export function ensurePreviewVideoControls(root = document) {
  root.querySelectorAll?.('.media-video-preview').forEach(wrapper => {
    const video = wrapper.querySelector('video');
    if (!video) return;
    if (!wrapper.querySelector('.media-video-sound')) {
      const btn = document.createElement('button');
      btn.className = 'media-video-sound';
      btn.type = 'button';
      btn.setAttribute('aria-label', t('video.soundOn'));
      btn.onclick = togglePreviewVideoSound;
      btn.onpointerdown = stopMediaEvent;
      btn.ontouchstart = stopMediaEvent;
      wrapper.appendChild(btn);
    }
    syncPreviewVideoToggle(video);
  });
}

export function initPreviewVideoControlsObserver() {
  if (appState.previewVideoControlsObserver) return;
  appState.previewVideoControlsObserver = true;
  const observer = new MutationObserver(() => {
    requestAnimationFrame(() => ensurePreviewVideoControls(document));
  });
  observer.observe(document.body, { childList: true, subtree: true });
  ensurePreviewVideoControls(document);
}

export async function togglePreviewVideo(event) {
  if (event) {
    event.stopPropagation();
  }
  
  const wrapper = event?.currentTarget?.closest?.('.media-video-preview')
    || event?.target?.closest?.('.media-video-preview');
  
  if (!wrapper) return;
  const video = wrapper.querySelector('video');
  if (!video) return;

  if (video.paused || video.ended) {
    pauseAllVideosExcept(video);
    try {
      await video.play();
    } catch (err) {
      console.warn('[togglePreviewVideo] Не удалось запустить видео:', err);
    }
  } else {
    video.pause();
  }
  syncPreviewVideoToggle(video);
}

export function closeTopHistoryLayer() {
  appState.historyLayer = null;

  if (!document.getElementById('globalSearchResults')?.hidden) {
    hideGlobalSearchResults();
    return true;
  }
  if (isDisplayed('lightboxOverlay')) {
    closeLightbox();
    return true;
  }
  if (isDisplayed('modalOverlay')) {
    closeModal();
    return true;
  }
  if (isDisplayed('formOverlay')) {
    closeForm();
    return true;
  }
  if (isDisplayed('wishFormOverlay')) {
    closeWishForm();
    return true;
  }
  if (STANDALONE_TABS.has(appState.currentTab)) {
    appState.standaloneTabHistory = false;
    switchTab('collection');
    return true;
  }
  if (isMobileViewport() && appState.currentTab === 'collection' && appState.selectedOrder) {
    backToOrders();
    return true;
  }
  return false;
}

export function bindHistoryBackHandling() {
  if (appState.historyBackBound) return;
  appState.historyBackBound = true;
  window.addEventListener('popstate', () => {
    closeTopHistoryLayer();
  });
}

function getTelegramSettings() {
  return {
    tgBotToken: state.settings?.tgBotToken || state.settings?.telegramBotToken || state.settings?.botToken || '',
    tgChatId: state.settings?.tgChatId || ''
  };
}

function shouldUseExternalUrl(url) {
  return Boolean(url) && !isTelegramFileUrl(String(url));
}

function mediaKey(value) {
  if (!value) return '';
  if (typeof value === 'object') {
    return String(
      value.fileId ||
      value.telegramFileId ||
      value.url ||
      value.src ||
      value.imageUrl ||
      value.videoUrl ||
      ''
    ).trim();
  }
  return String(value || '').trim();
}

function updateTelegramMediaInState(fileId, freshUrl, sourceMedia = {}) {
  if (!fileId || !freshUrl) return false;
  let changed = false;
  const allItems = [...(state.items || []), ...(state.wishlist || [])];

  for (const item of allItems) {
    const mediaList = Array.isArray(item.media) ? item.media : [];
    for (const media of mediaList) {
      if (media?.provider === 'telegram' && media.fileId === fileId) {
        media.url = freshUrl;
        media.src = freshUrl;
        const mediaType = String(media.mediaType || sourceMedia.mediaType || '').toLowerCase();
        const mimeType = String(media.mimeType || sourceMedia.mimeType || '').toLowerCase();
        if (mediaType === 'video' || mediaType === 'animation' || mimeType.startsWith('video/')) {
          media.videoUrl = freshUrl;
          delete media.imageUrl;
        } else {
          media.imageUrl = freshUrl;
          delete media.videoUrl;
        }
        media.refreshedAt = new Date().toISOString();
        changed = true;
      }
    }
  }

  return changed;
}

export async function handleMediaLoadError(el) {
  if (!el) return;

  const provider = el.dataset?.provider || '';
  const fileId = el.dataset?.fileId || '';
  if (provider !== 'telegram' || !fileId) {
    el.style.opacity = '.35';
    return;
  }

  if (el.dataset.refreshing === '1') return;
  el.dataset.refreshing = '1';

  try {
    const tempMedia = {
      provider: 'telegram',
      fileId,
      mediaType: el.dataset.mediaType || ''
    };
    const freshUrl = await refreshTelegramMediaUrl(tempMedia, getTelegramSettings().tgBotToken);
    if (!freshUrl) throw new Error('empty fresh Telegram URL');

    if (el.tagName === 'VIDEO') {
      el.src = freshUrl;
      el.querySelectorAll('source').forEach(source => { source.src = freshUrl; });
      el.load();
    } else {
      el.src = freshUrl;
    }

    if (updateTelegramMediaInState(fileId, freshUrl, tempMedia)) {
      persist();
    }
    el.style.opacity = '1';
  } catch (error) {
    console.warn('[handleMediaLoadError]', error);
    el.style.opacity = '.35';
  } finally {
    el.dataset.refreshing = '0';
  }
}

window.handleMediaLoadError = handleMediaLoadError;

export function scheduleRender(name, fn) {
  if (typeof fn !== 'function') return;
  renderQueue.set(name || fn.name || String(renderQueue.size), fn);
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    try {
      [...renderQueue.values()].forEach(renderFn => renderFn());
    } finally {
      renderQueue.clear();
      renderScheduled = false;
    }
  });
}


export function applyUiTheme() {
  const theme = state.settings?.theme === 'clean' ? 'clean' : 'cyberpunk';
  document.body.dataset.theme = theme;
  const toggle = document.getElementById('themeToggle');
  if (toggle) {
    toggle.textContent = theme === 'clean' ? 'CLEAN' : 'CYBER';
    toggle.classList.toggle('is-clean', theme === 'clean');
  }
}

export function applyUiDensity() {
  const density = state.settings?.density === 'comfortable' ? 'comfortable' : 'compact';
  document.body.dataset.density = density;
  applyUiTheme();
}

export function toggleTheme() {
  state.settings = state.settings || {};
  state.settings.theme = state.settings.theme === 'clean' ? 'cyberpunk' : 'clean';
  const select = document.getElementById('sTheme');
  if (select) select.value = state.settings.theme;
  applyUiTheme();
  persist();
}
export function toast(message, options = {}) {
  return notifyToast(message, options);
}

export function stopMedia(root = document, options = {}) {
  const resetSrc = Boolean(options.resetSrc);
  root?.querySelectorAll?.('video, audio')?.forEach(media => {
    try {
      if (media.dataset?.gifLike === 'true') return;
      media.pause();
      media.currentTime = 0;
      if (resetSrc) {
        media.removeAttribute('src');
        media.querySelectorAll('source').forEach(source => source.removeAttribute('src'));
        media.load();
      }
    } catch (error) {
      console.warn('Failed to stop media', error);
    }
  });
}

let tagsCache = null;

export function invalidateTagsCache() {
  tagsCache = null;
}

export function getAllTags() {
  if (tagsCache) return tagsCache;
  const fromItems = (state.items || []).flatMap(item => item.tags || []);
  const fromWishlist = (state.wishlist || []).flatMap(item => item.tags || []);
  const fromSettings = state.settings?.tags || state.tags || [];
  tagsCache = mergeTags(fromSettings, fromItems, fromWishlist).sort((a, b) => a.localeCompare(b));
  return tagsCache;
}

export function saveGlobalTags(tags) {
  state.settings = state.settings || {};
  state.settings.tags = mergeTags(tags);
}

export function syncGlobalTags() {
  invalidateTagsCache();
  saveGlobalTags(getAllTags());
}

export function ensureSearchIndexes() {
  (state.items || []).forEach(item => {
    if (item) item._searchText = buildSearchText(item);
  });
  (state.wishlist || []).forEach(wish => {
    if (wish) wish._searchText = buildSearchText(wish);
  });
}

function searchTextOf(item) {
  return item?._searchText || buildSearchText(item);
}

export function getGlobalSearchQuery() {
  return String(state.search?.global || '').trim().toLowerCase();
}

function getGlobalSearchWords(query = getGlobalSearchQuery()) {
  return String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function matchesGlobalSearch(item, query = getGlobalSearchQuery()) {
  const words = getGlobalSearchWords(query);
  if (!words.length) return true;
  const searchText = searchTextOf(item);
  return words.every(word => searchText.includes(word));
}

export function getGlobalSearchCounts() {
  const items = (state.items || []).filter(item => matchesGlobalSearch(item));
  const wishlist = (state.wishlist || []).filter(wish => matchesGlobalSearch(wish));
  return { collection: items.length, wishlist: wishlist.length, total: items.length + wishlist.length };
}

export function syncGlobalSearchInput() {
  const input = document.getElementById('globalSearchInput');
  if (input && document.activeElement !== input) input.value = state.search?.global || '';
  renderGlobalSearchCounts();
}

export function renderGlobalSearchCounts() {
  const box = document.getElementById('globalSearchCounts');
  if (!box) return;
  const query = String(state.search?.global || '').trim();
  if (!query) { box.textContent = ''; return; }
  const counts = getGlobalSearchCounts();
  box.textContent = t('globalSearch.counts', counts);
}

function globalSearchTextOf(item = {}, type = 'collection') {
  const comments = (item.comments || []).map(comment => comment?.text || '');
  const tasks = (item.tasks || []).flatMap(task => [task?.title, task?.note, task?.type]);
  return [
    item.name,
    item.orderNumber,
    item.orderName,
    item.store,
    item.manufacturer,
    item.region,
    item.status,
    item.tracking,
    item.jan,
    item.sku,
    item.code,
    item.releaseDate,
    item.shopUrl,
    item.source,
    item.sourceUrl,
    type === 'wishlist' ? item.priority : '',
    type === 'wishlist' ? (item.notes || item.note) : '',
    ...comments,
    ...tasks,
    ...(item.tags || [])
  ].filter(Boolean).join(' ').toLowerCase();
}

function globalSearchMatchContext(item = {}, query = getGlobalSearchQuery()) {
  const words = getGlobalSearchWords(query);
  if (!words.length) return null;
  const matchText = value => {
    const text = String(value || '').toLowerCase();
    return text && words.every(word => text.includes(word));
  };
  const task = (item.tasks || []).find(task => matchText(`${task?.title || ''} ${task?.note || ''}`));
  if (task) return { kind: 'task', label: 'Задача', text: [task.title, task.note].filter(Boolean).join(' · ') };
  const comment = (item.comments || []).find(comment => matchText(comment?.text));
  if (comment) return { kind: 'comment', label: 'Комментарий', text: comment.text || '' };
  return null;
}

function highlightSearchMatch(text, query) {
  const source = String(text || '');
  const needle = String(query || '').trim();
  if (!needle) return H(source);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return H(source).replace(new RegExp(`(${escaped})`, 'ig'), '<mark>$1</mark>');
}

function globalSearchThumb(item) {
  const entry = mediaEntriesOf(item)[0];
  if (entry && entry.kind !== 'video') return entry.url;
  return getImageUrl(item?.imageUrl || item?.img || item?.thumbUrl || '');
}

function getGlobalSearchResults(query = getGlobalSearchQuery()) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const matches = (item, type) => {
    const text = globalSearchTextOf(item, type);
    return words.every(word => text.includes(word));
  };
  const collection = (state.items || [])
    .filter(item => matches(item, 'collection'))
    .map(item => ({ type: 'collection', item, context: globalSearchMatchContext(item, q) }));
  const wishlist = (state.wishlist || [])
    .filter(item => matches(item, 'wishlist'))
    .map(item => ({ type: 'wishlist', item, context: globalSearchMatchContext(item, q) }));
  return [...collection, ...wishlist].slice(0, 10);
}

export function hideGlobalSearchResults() {
  const box = document.getElementById('globalSearchResults');
  if (!box) return;
  box.hidden = true;
  box.innerHTML = '';
  appState.globalSearchResults = [];
  if (appState.historyLayer === 'search') appState.historyLayer = null;
}

export function renderGlobalSearchResults() {
  const box = document.getElementById('globalSearchResults');
  if (!box) return;
  const query = getGlobalSearchQuery();
  const results = getGlobalSearchResults(query);
  appState.globalSearchResults = results;
  if (!results.length) {
    hideGlobalSearchResults();
    return;
  }

  box.innerHTML = results.map((result, index) => {
    const item = result.item || {};
    const isWish = result.type === 'wishlist';
    const thumb = globalSearchThumb(item);
    const badge = isWish ? t('globalSearch.wishlist') : t('globalSearch.collection');
    const meta = isWish
      ? [item.priority, item.manufacturer, item.store].filter(Boolean).join(' · ')
      : [item.orderNumber || item.orderName, item.status, item.store].filter(Boolean).join(' · ');
    const context = result.context;
    return `<button class="global-search-result${index === 0 ? ' active' : ''}" type="button" data-result-index="${index}">
      ${thumb ? `<img class="global-search-result-img" src="${H(thumb)}" alt="" loading="lazy" onerror="this.style.opacity='.2'">` : `<span class="global-search-result-img"></span>`}
      <span class="global-search-result-body">
        <span class="global-search-result-badge">${badge}</span>
        <span class="global-search-result-name">${highlightSearchMatch(item.name || '—', query)}</span>
        <span class="global-search-result-meta">${highlightSearchMatch(meta || '—', query)}</span>
        ${context ? `<span class="global-search-result-context"><span>${H(context.label)}</span>${highlightSearchMatch(context.text, query)}</span>` : ''}
      </span>
    </button>`;
  }).join('');
  updateGlobalSearchDropdownTop();
  if (box.hidden) pushUiHistory('search');
  box.hidden = false;
}

export function openGlobalSearchResult(index = 0) {
  const result = appState.globalSearchResults?.[Number(index)];
  if (!result?.item?.id) return;
  hideGlobalSearchResults();
  openEntityDetail(result.type, result.item.id);
}

export function handleGlobalSearchKeydown(event) {
  if (event.key === 'Escape') {
    hideGlobalSearchResults();
    return;
  }
  if (event.key === 'Enter') {
    const results = appState.globalSearchResults || [];
    if (!results.length) return;
    event.preventDefault();
    openGlobalSearchResult(0);
  }
}

export function setGlobalSearch(value) {
  state.search = state.search || {};
  state.search.global = String(value || '');
  appState.selectedOrder = null;
  resetGalleryPagination();
  schedulePersist();
  scheduleRender('main', render);
  scheduleRender('wishlist', renderWishlist);
  scheduleRender('gallery', renderGallery);
  scheduleRender('shelf', renderShelf);
  renderGlobalSearchCounts();
  renderGlobalSearchResults();
}

export function resetAllFilters() {
  appState.filterStatus = null;
  appState.selectedOrder = null;
  state.search = state.search || {};
  state.search.global = '';
  syncGlobalSearchInput();

  const storeEl = document.getElementById('filterStore');
  if (storeEl) storeEl.value = '';
  const regionEl = document.getElementById('filterRegion');
  if (regionEl) regionEl.value = '';
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = '';
  const wishPriority = document.getElementById('wishPriorityFilter');
  if (wishPriority) wishPriority.value = '';

  schedulePersist();
  render();
  renderWishlist();
}

window.resetAllFilters = resetAllFilters;

export function showRatesBadge() {
  const badge = document.getElementById('ratesBadge');
  if (!badge) return;
  const { USD, JPY, UAH } = state.rates;
  const age = Date.now() - (state.ratesAt || 0);
  const mins = Math.floor(age / 60000);
  const timeStr = mins < 1 ? 'только что' : mins < 60 ? `${mins} мин назад` : `${Math.floor(mins / 60)} ч назад`;
  badge.className = 'rates-badge';
  badge.title = `Обновлено: ${timeStr}`;
  badge.textContent = `1 USD = ${USD?.toFixed(4) ?? '???'} · 1 JPY = ${JPY?.toFixed(5) ?? '???'} · 1 UAH = ${UAH?.toFixed(5) ?? '???'} · ${timeStr}`;
}

const LOCAL_BACKUPS_KEY = 'fctV2LocalBackups';
const LOCAL_BACKUPS_LIMIT = 10;

function cloneStateForBackup() {
  return JSON.parse(JSON.stringify(state));
}

export function getLocalBackups() {
  try {
    const backups = JSON.parse(localStorage.getItem(LOCAL_BACKUPS_KEY) || '[]');
    return Array.isArray(backups) ? backups : [];
  } catch {
    return [];
  }
}

export function createLocalBackup(reason = 'manual', silent = false) {
  const backup = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    createdAt: Date.now(),
    reason,
    state: cloneStateForBackup()
  };
  const backups = [backup, ...getLocalBackups()].slice(0, LOCAL_BACKUPS_LIMIT);
  localStorage.setItem(LOCAL_BACKUPS_KEY, JSON.stringify(backups));
  renderLocalBackups();
  if (!silent) toast(t('toast.localBackupSaved'));
  return backup;
}

export function restoreLocalBackup(id) {
  const backup = getLocalBackups().find(b => b.id === id);
  if (!backup?.state) return toast(t('toast.localBackupMissing'));
  if (!confirm(t('confirm.restoreLocalBackup'))) return;
  Object.keys(state).forEach(key => delete state[key]);
  Object.assign(state, JSON.parse(JSON.stringify(backup.state)));
  appState.selectedOrder = null;
  persist();
  render();
  toast(t('toast.localBackupRestored'));
}

export function deleteLocalBackup(id) {
  const backups = getLocalBackups().filter(b => b.id !== id);
  localStorage.setItem(LOCAL_BACKUPS_KEY, JSON.stringify(backups));
  renderLocalBackups();
  toast(t('toast.localBackupDeleted'));
}


const ITEM_DRAFT_KEY = 'fctV2ItemDraft';
const ITEM_DRAFT_FIELDS = ['fName', 'fOrder', 'fOrderName', 'fStore', 'fImg', 'fShopUrl', 'fPrice', 'fShipping', 'fDeposit', 'fMaker', 'fDateYear', 'fTags', 'fTracking', 'fOrderDate', 'fShipDate', 'fScale', 'fCurrency', 'fRegion', 'fStatus', 'fDateMonth', 'fShipMethod', 'fJan', 'fSku', 'fPreorderStart', 'fPreorderEnd', 'fReleaseStatus', 'fSource', 'fSourceUrl'];
const ITEM_DRAFT_REQUIRED_SIGNAL = ['fName', 'fOrder', 'fOrderName', 'fImg', 'fShopUrl', 'fPrice', 'fShipping', 'fDeposit', 'fMaker', 'fDateYear', 'fTags', 'fTracking', 'fOrderDate', 'fShipDate', 'fScale'];

function readItemDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(ITEM_DRAFT_KEY) || 'null');
    return draft?.values ? draft : null;
  } catch {
    return null;
  }
}

function collectItemDraftValues() {
  return Object.fromEntries(ITEM_DRAFT_FIELDS.map(id => [id, document.getElementById(id)?.value || '']));
}

function hasItemDraftSignal(values) {
  return ITEM_DRAFT_REQUIRED_SIGNAL.some(id => String(values?.[id] || '').trim());
}

function applyItemDraft(draft) {
  for (const [id, value] of Object.entries(draft.values || {})) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }
  updateEurPreview();
  renderTagSuggestions();
}

export function saveItemDraft() {
  const overlay = document.getElementById('formOverlay');
  if (!overlay || overlay.style.display === 'none' || appState.editingId) return;
  const values = collectItemDraftValues();
  if (!hasItemDraftSignal(values)) return;
  localStorage.setItem(ITEM_DRAFT_KEY, JSON.stringify({ updatedAt: Date.now(), values }));
}

export function clearItemDraft() {
  localStorage.removeItem(ITEM_DRAFT_KEY);
}

export function maybeRestoreItemDraft() {
  if (appState.editingId) return;
  const currentValues = collectItemDraftValues();
  if (hasItemDraftSignal(currentValues)) return;
  const draft = readItemDraft();
  if (!draft || !hasItemDraftSignal(draft.values)) return;
  const when = new Date(draft.updatedAt || Date.now()).toLocaleString('ru');
  if (confirm(t('confirm.restoreDraft', { when }))) {
    applyItemDraft(draft);
    toast(t('toast.draftRestored'));
  } else {
    clearItemDraft();
  }
}

export function bindItemDraftAutosave() {
  const form = document.getElementById('formOverlay');
  if (!form || form.dataset.draftAutosaveBound === '1') return;
  form.dataset.draftAutosaveBound = '1';
  form.addEventListener('input', saveItemDraft);
  form.addEventListener('change', saveItemDraft);
}
export function renderLocalBackups() {
  const box = document.getElementById('localBackupsList');
  if (!box) return;
  const backups = getLocalBackups();
  if (!backups.length) {
    box.innerHTML = `<div style="font-size:12px;color:var(--muted);padding:8px 0;">${t('localBackup.empty')}</div>`;
    return;
  }
  const labels = { manual: t('localBackup.reason.manual'), 'before-import': t('localBackup.reason.beforeImport'), 'before-clear': t('localBackup.reason.beforeClear'), 'before-delete-item': t('localBackup.reason.beforeDeleteItem'), 'before-delete-wish': t('localBackup.reason.beforeDeleteWish') };
  box.innerHTML = backups.map(b => {
    const date = new Date(b.createdAt).toLocaleString('ru');
    const items = b.state?.items?.length || 0;
    const wishes = b.state?.wishlist?.length || 0;
    const label = labels[b.reason] || b.reason || t('localBackup.fallback');
    return `<div class="local-backup-row"><div><div class="local-backup-title">${H(label)} · ${H(date)}</div><div class="local-backup-meta">${t('localBackup.meta', { items, wishes })}</div></div><div class="local-backup-actions"><button class="btn btn-sm" onclick="restoreLocalBackup('${H(b.id)}')">${t('common.restore')}</button><button class="btn btn-sm btn-danger" onclick="deleteLocalBackup('${H(b.id)}')">${t('common.delete')}</button></div></div>`;
  }).join('');
}

export function updateEurPreview() {
  const amount = parseFloat(document.getElementById('fPrice').value);
  const currency = document.getElementById('fCurrency').value;
  const preview = document.getElementById('eurPreview');
  if (!amount || currency === 'EUR') { preview.textContent = ''; return; }
  const e = toEur(amount, currency);
  const rate = state.rates[currency];
  preview.textContent = `${amount} ${currency} × ${rate?.toFixed(currency === 'JPY' ? 5 : 4)} = ${eur(e)}`;
}

export function estimateShipping() {
  const scale = document.getElementById('fScale').value;
  if (!scale) { toast(t('toast.selectFigureType')); return; }

  const orderNumber = document.getElementById('fOrder').value.trim();
  const store = document.getElementById('fStore').value.trim().toLowerCase();
  const isOrzGK = store.includes('orzgk') || store.includes('orz');
  const region = document.getElementById('fRegion').value;
  const isEU = region === 'ЕС' || region === 'EU' || region === 'ЄС';
  const method = document.getElementById('fShipMethod').value;
  const countryProfile = getCountryProfileId();
  const orderItems = state.items.filter(i => i.orderNumber === orderNumber && i.id !== (appState.editingId || ''));
  const totalKg = orderItems.reduce((sum, i) => sum + (SCALE_WEIGHTS[i.scale || 'small']?.kg || 0.8), 0) + (SCALE_WEIGHTS[scale]?.kg || 0.8);
  const note = orderItems.length >= 1 ? ` · сборная ${orderItems.length + 1} шт, ~${totalKg.toFixed(1)}кг` : ` · ~${totalKg.toFixed(1)}кг`;

  let usedMethod = method;
  if (method === 'small_packet' && totalKg > 2.0) { usedMethod = 'ems'; toast('⚠️ Small Packet недоступен свыше 2кг — переключено на EMS'); }
  if (method === 'sal' && totalKg > 2.0) { usedMethod = 'ems'; toast('⚠️ SAL недоступен свыше 2кг — переключено на EMS'); }

  let resultEur;
  const ukrainianMethods = ['nova_poshta', 'ukrposhta', 'meest', 'proxy'];
  if (countryProfile === 'ua' && ukrainianMethods.includes(usedMethod)) {
    const profile = getCountryProfile('ua');
    const estimateUah = Math.max(0, Number(profile.defaultShippingAmount) || 150);
    resultEur = toBaseEur(estimateUah, 'UAH');
    toast(`📦 ${methodNameOf(usedMethod)}: ~${estimateUah.toFixed(0)} грн${note}`);
  } else if (isEU) {
    resultEur = Math.max(8, Math.round(totalKg * 3));
    toast(`📦 ЕС доставка: ~${eur(resultEur)}${note}`);
  } else if (isOrzGK) {
    resultEur = Math.max(15, Math.round(totalKg * 5.5 * 1.2));
    toast(`📦 OrzGK Special Line: ~${eur(resultEur)}${note}`);
  } else {
    const jpy = calcAmiAmiShipping(totalKg, usedMethod);
    resultEur = Math.round(jpy * (state.rates['JPY'] || 0.006));
    toast(`📦 ${methodNameOf(usedMethod)}: ~${jpy.toLocaleString()} JPY ≈ ${eur(resultEur)}${note}`);
  }
  setFormBaseEurValue('fShipping', resultEur);
}

function methodNameOf(method) {
  return { small_packet: 'Small Packet', sal: 'SAL', ems: 'EMS', surface: 'Surface', dhl: 'DHL', fedex: 'FedEx', nova_poshta: 'Новая Почта', ukrposhta: 'Укрпошта', meest: 'Meest', proxy: 'Посредник', other: 'Другое' }[method] || method;
}

export function getOrders() {
  const map = {};
  for (const item of state.items) {
    const k = item.orderNumber || 'no-order';
    if (!map[k]) map[k] = { orderNumber: k, orderName: item.orderName || k, store: item.store, region: item.region, items: [] };
    if (item.orderName) map[k].orderName = item.orderName;
    map[k].items.push(item);
  }

  const sort = document.getElementById('sortSelect')?.value || 'newest';
  return Object.values(map).sort((a, b) => {
    if (sort === 'newest') return Math.max(...b.items.map(i => i.createdAt || 0)) - Math.max(...a.items.map(i => i.createdAt || 0));
    if (sort === 'oldest') return Math.max(...a.items.map(i => i.createdAt || 0)) - Math.max(...b.items.map(i => i.createdAt || 0));
    if (sort === 'price-desc') return calcOrder(b).total - calcOrder(a).total;
    if (sort === 'price-asc') return calcOrder(a).total - calcOrder(b).total;
    if (sort === 'name') return a.orderName.localeCompare(b.orderName);

    if (sort === 'release-asc' || sort === 'release-desc') {
      const parseRelease = order => {
        const dates = order.items.map(i => i.releaseDate).filter(Boolean);
        if (!dates.length) return sort === 'release-asc' ? Infinity : -Infinity;
        const toNum = d => {
          if (!d) return 999999;
          const ymd = d.match(/(\d{4})[\/\-](\d{1,2})/);
          if (ymd) return parseInt(ymd[1]) * 100 + parseInt(ymd[2]);
          const MONTHS = [['jan', 'янв'], ['feb', 'фев'], ['mar', 'мар'], ['apr', 'апр'], ['may', 'май', 'мая'], ['jun', 'июн'], ['jul', 'июл'], ['aug', 'авг'], ['sep', 'сен'], ['oct', 'окт'], ['nov', 'ноя', 'ноябр'], ['dec', 'дек']];
          const lower = d.toLowerCase();
          const year = lower.match(/\d{4}/)?.[0] ?? '9999';
          const mIdx = MONTHS.findIndex(variants => variants.some(v => lower.includes(v)));
          return parseInt(year) * 100 + (mIdx >= 0 ? mIdx + 1 : 99);
        };
        return Math.min(...dates.map(toNum));
      };
      const da = parseRelease(a), db = parseRelease(b);
      return sort === 'release-asc' ? da - db : db - da;
    }
    return 0;
  });
}

export function orderStatus(order) {
  const s = order.items.map(i => i.status);
  if (s.every(x => x === 'Получено')) return 'Получено';
  if (s.some(x => x === 'В пути')) return 'В пути';
  if (s.every(x => x === 'Полностью оплачено' || x === 'Получено' || x === 'В пути')) return 'Полностью оплачено';
  if (s.some(x => x === 'Депозит оплачен' || x === 'Полностью оплачено')) return 'Депозит оплачен';
  return 'Не оплачено';
}

export function orderStatusKey(order) {
  return normalizeStatus(orderStatus(order));
}

export function badgeClass(status) {
  return getBadgeClass(status);
}

export function getFiltered() {
  const words = getGlobalSearchWords();
  const storeF = document.getElementById('filterStore')?.value || '';
  const regionF = document.getElementById('filterRegion')?.value || '';
  const showHidden = document.getElementById('showHiddenToggle')?.checked || false;

  return getOrders().filter(order => {
    const isHidden = order.items.every(i => i.hidden);
    if (isHidden && !showHidden) return false;
    if (appState.filterStatus && orderStatus(order) !== appState.filterStatus) return false;
    if (storeF && (order.store || '') !== storeF) return false;
    if (regionF && (order.items[0]?.region || '') !== regionF) return false;
    if (!words.length) return true;
    const orderText = [order.orderName, order.orderNumber, order.store].join(' ').toLowerCase();
    return words.every(word => orderText.includes(word) || order.items.some(item => searchTextOf(item).includes(word)));
  });
}

export function renderSidebar() {
  const orders = getFiltered();
  const list = document.getElementById('orderList');
  if (!list) return;
  if (!orders.length) { list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px;">Посылок нет.</div>'; return; }
  list.innerHTML = orders.map(order => {
    const isHidden = order.items.every(i => i.hidden);
    const c = calcOrder(order); const status = orderStatus(order);
    const thumbs = order.items.slice(0, 4).map(i => i.imageUrl ? `<img class="order-thumb" src="${H(i.imageUrl)}" alt="" loading="lazy" onerror="this.style.opacity='.1'">` : `<div class="order-thumb" style="display:flex;align-items:center;justify-content:center;">📦</div>`).join('');
    const extra = order.items.length > 4 ? `<div class="order-thumb-more">+${order.items.length - 4}</div>` : '';
    return `<div class="order-item ${isHidden ? 'hidden-order' : ''} ${order.orderNumber === appState.selectedOrder ? 'active' : ''}" data-order="${H(order.orderNumber)}">
      <div class="order-item-top"><div><div class="order-name">${H(order.orderName)}</div><div class="order-meta">#${H(order.orderNumber)} · ${H(order.store || '—')} · ${order.items.length} фиг.</div></div><span class="badge ${badgeClass(status)}">${H(status)}</span></div>
      <div class="order-thumbs">${thumbs}${extra}</div>
      <div class="order-footer"><span class="order-total">${eur(c.total)}</span>${c.remaining > 0 ? `<span class="order-remain">Остаток: ${eur(c.remaining)}</span>` : '<span style="font-size:12px;color:var(--green)">✓ Оплачено</span>'}</div>
    </div>`;
  }).join('');
  if (list.dataset.bound !== '1') {
    list.dataset.bound = '1';
    list.addEventListener('click', event => {
      const item = event.target.closest('.order-item');
      if (!item) return;
      appState.selectedOrder = item.dataset.order;
      scheduleRender('main', render);
    });
  }
}

export function syncMobileCollectionView() {
  const sidebar = document.querySelector('.sidebar');
  const detailPane = document.getElementById('detailPane');
  const mainPane = document.querySelector('.main');
  if (!sidebar || !detailPane) return;

  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  if (!isMobile || appState.currentTab !== 'collection') {
    sidebar.classList.remove('hidden-mobile');
    detailPane.classList.remove('hidden-mobile');
    mainPane?.classList.remove('mobile-list-mode', 'mobile-detail-mode');
    return;
  }

  const hasSelectedOrder = Boolean(appState.selectedOrder);
  sidebar.classList.toggle('hidden-mobile', hasSelectedOrder);
  detailPane.classList.toggle('hidden-mobile', !hasSelectedOrder);
  mainPane?.classList.toggle('mobile-list-mode', !hasSelectedOrder);
  mainPane?.classList.toggle('mobile-detail-mode', hasSelectedOrder);
}

function ensureMobileDetailHistory() {
  if (!isMobileViewport() || appState.currentTab !== 'collection' || !appState.selectedOrder || appState.mobileDetailHistory) return;
  pushUiHistory('detail');
  appState.mobileDetailHistory = true;
}

export function backToOrders() {
  appState.selectedOrder = null;
  appState.mobileDetailHistory = false;
  closeFilters();
  render();
}

export function updateWishlistBadge() {
  return WishlistView.updateWishlistBadge();
}

export function renderDetail() {
  const pane = document.getElementById('detailPane');
  if (!pane) return;
  ensureMobileDetailHistory();
  syncMobileCollectionView();
  if (!appState.selectedOrder) {
    const orders = getFiltered();
    const allOrders = getOrders();
    const totals = getCollectionTotals(allOrders);
    const statusCounts = getStatusCounts(allOrders);
    const statusBar = renderCollectionStatusBar(statusCounts, allOrders.length);
    pane.innerHTML = renderCollectionHome({
      orders,
      allOrders,
      totals,
      statusCounts,
      statusBar,
      itemCount: state.items.length
    });
    renderShelfChart();
    return;
  }

  const order = getOrders().find(o => o.orderNumber === appState.selectedOrder);
  if (!order) { appState.selectedOrder = null; renderDetail(); return; }
  const c = calcOrder(order); const status = orderStatus(order);
  const figures = order.items.map((rawItem, itemIndex) => {
    const item = normalizeProductMeta(rawItem);
    const priceEur = toEur(item.priceOriginal || 0, item.currency || 'EUR');
    const firstMedia = mediaEntriesOf(item)[0]?.media || item.imageUrl || item.img || item.videoUrl;
    return `<div class="figure-card animate-in" style="animation-delay:${itemIndex * 40}ms" onclick="if(isCardOpenBlocked(event))return;openEntityDetail('collection','${H(item.id)}')">
  ${renderMediaTag(firstMedia, 'figure-img', item.name)}
  <div class="figure-body">
    <div class="figure-name">${H(item.name)}</div>
    ${item.store ? `<div class="figure-meta">Магазин: ${H(item.store)}</div>` : ''}
    ${item.manufacturer ? `<div class="figure-meta">Производитель: ${H(item.manufacturer)}</div>` : ''}
    ${item.releaseDate ? `<div class="figure-meta">Выход: ${H(item.releaseDate)}</div>` : ''}
    <div class="figure-meta">💱 ${H(String(item.priceOriginal ?? '—'))} ${H(item.currency || '')}${item.currency && item.currency !== 'EUR' ? ` → <span style="color:var(--accent)">${eur(priceEur)}</span>` : ''}</div>
    <div class="product-badges">${renderProductMetaBadges(item)}</div>
    ${item.shopUrl ? `<a href="${H(item.shopUrl)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--accent);text-decoration:none;margin-top:6px;margin-bottom:2px;">🔗 Открыть в магазине</a>` : ''}
    ${item.tags?.length ? (function() {
      const maxTags = 4;
      const visible = item.tags.slice(0, maxTags);
      const hidden = item.tags.length - maxTags;
      let html = `<div class="tags">` + visible.map(t => `<span class="tag">${H(t)}</span>`).join('');
      if (hidden > 0) html += `<span class="tag" style="background: rgba(255,255,255,0.05); color: var(--muted);">+${hidden}</span>`;
      html += `</div>`;
      return html;
    })() : ''}
  </div>
</div>`;
  }).join('');
  const allReceived = order.items.every(i => i.status === 'Получено');
  const isHidden = order.items.every(i => i.hidden);
  const trackingCode = order.items.find(i => i.tracking)?.tracking;
  const _trackingService = state.settings?.trackingService || 'auto';
  const trackUrl = trackingCode
    ? _trackingService === 'parcelsapp'
      ? `https://parcelsapp.com/tracking/${trackingCode}`
      : _trackingService === 'postalninja'
        ? `https://postal.ninja/en/track/${trackingCode}`
        : _trackingService === '17track'
          ? `https://t.17track.net/en#nums=${trackingCode}`
          : (trackingCode.startsWith('JJ') || trackingCode.startsWith('LX') || trackingCode.startsWith('RR'))
            ? `https://parcelsapp.com/tracking/${trackingCode}`
            : `https://t.17track.net/en#nums=${trackingCode}`
    : null;
  pane.innerHTML = `
<div class="detail-header fade-in" style="animation-delay:0ms">
  <button class="btn btn-sm mobile-back" onclick="backToOrders()">← К списку</button>
  <div>
    <div class="detail-title">${H(order.orderName)}</div>
    <div class="detail-sub">Заказ #${H(order.orderNumber)} · ${H(order.store || '—')}</div>
  </div>
  <div class="detail-actions">
    <span class="badge ${badgeClass(status)}">${H(status)}</span>

    ${status !== 'Полностью оплачено' && status !== 'В пути' && status !== 'Получено' ? `<button class="btn btn-sm" style="border-color:var(--green); color:var(--green);" onclick="payWholeOrder('${H(order.orderNumber)}')">💰 Оплатить всё</button>` : ''}
    ${!allReceived
      ? `<button class="btn btn-sm" style="border-color:var(--accent);color:var(--accent);"
           onclick="receiveWholeOrder('${H(order.orderNumber)}')">✅ Всё получено</button>`
      : `<span class="badge" style="background-color:var(--panel-3);color:var(--light);font-size:12px;">✅ На полке</span>`}
    ${trackUrl ? `<a href="${H(trackUrl)}" class="btn btn-sm" style="border-color:var(--green);color:var(--green);text-decoration:none;" target="_blank">🚚 Отследить</a>` : ''}
      <button class="btn btn-sm" 
  style="border-color:var(--muted);color:var(--muted);"
  onclick="toggleOrderHidden('${H(order.orderNumber)}')">
  ${isHidden ? '👁️ Показать' : '🙈 Скрыть'}
</button>
    <button class="btn btn-primary btn-sm" onclick="addToOrder('${H(order.orderNumber)}')">+ Фигурку</button>
  </div>
</div>

<div class="detail-layout fade-in" style="animation-delay:40ms">
  <div class="items-column">
    <div class="section-title">Фигурки (${order.items.length})</div>
    <div class="figure-cards">
      ${figures || '<div style="color:var(--muted);padding:20px 0;">Пусто</div>'}
    </div>
  </div>

  <div class="breakdown fade-in" style="animation-delay:160ms">
    <div class="breakdown-title">Расчёт</div>
    <div class="summary-row"><span>📦 Товары</span><span>${eur(c.goodsEur)}</span></div>
    <div class="summary-row"><span>🚚 Доставка</span><span>${eur(c.shippingEur)}</span></div>
    <div class="summary-row"><span>📊 База для налога</span><span>${eur(c.taxBase)}</span></div>
    <div class="summary-row"><span>НДС</span><span>${c.isDomestic ? '<span style="color:var(--green)">0 — внутри страны</span>' : eur(c.alv)}</span></div>
    <div class="summary-row"><span>Таможня</span><span>${c.isDomestic ? '<span style="color:var(--green)">0 — внутри страны</span>' : c.overLimitAmount <= 0 ? '<span style="color:var(--green)">0 — в пределах лимита</span>' : eur(c.customs)}</span></div>
    <div class="summary-row"><span>💳 Предоплата</span><span>-${eur(c.deposit)}</span></div>
    <div class="summary-row" style="font-weight:800; font-size: 16px; margin-top:10px;"><span>💰 Итого к оплате</span><span>${eur(c.remaining)}</span></div>
  </div>
</div>
`;
  ensurePreviewVideoControls(pane);
}

export function openForm(options = {}) {
  if (!appState.editingId) {
    appState.pendingUploadedMedia = [];
  }
  const orders = getOrders();
  const dl = document.getElementById('orderSuggestions');
  dl.innerHTML = orders.map(o => `<option value="${H(o.orderNumber)}">${H(o.orderName)}</option>`).join('');
  document.getElementById('formOverlay').style.display = 'flex';
  pushUiHistory('form');
  renderTagSuggestions();
  if (!options.skipDraft) maybeRestoreItemDraft();
}

export function closeForm() {
  stopMedia(document.getElementById('formOverlay'), { resetSrc: false });
  document.getElementById('formOverlay').style.display = 'none';
  appState.editingId = null;
  appState.movingFromWishlistId = null;
  if (appState.historyLayer === 'form') appState.historyLayer = null;
  clearForm();
}

export function clearForm() {
  refreshRegionalSelects();
  syncFormMoneyCurrency();
  ['fName', 'fOrder', 'fOrderName', 'fStore', 'fImg', 'fShopUrl', 'fPrice', 'fShipping', 'fDeposit', 'fMaker', 'fDateYear', 'fTags', 'fTracking', 'fOrderDate', 'fShipDate', 'fScale', 'fJan', 'fSku', 'fPreorderStart', 'fPreorderEnd', 'fSource', 'fSourceUrl'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const defaults = getActiveProfileDefaults();
  document.getElementById('fCurrency').value = defaults.currency;
  document.getElementById('fRegion').value = defaults.region;
  document.getElementById('fStatus').value = 'Не оплачено';
  if (document.getElementById('fReleaseStatus')) document.getElementById('fReleaseStatus').value = 'unknown';
  document.getElementById('eurPreview').textContent = '';
  document.getElementById('formTitle').dataset.i18n = 'form.addFigure';
  document.getElementById('formTitle').textContent = t('form.addFigure');
  document.getElementById('fTracking').value = '';
  document.getElementById('fDateMonth').value = '';
  document.getElementById('fShipMethod').value = defaults.shipMethod;
  const s = state.settings || {};
  if (s.store) document.getElementById('fStore').value = s.store;
  renderTagSuggestions();
}

export function addToOrder(orderNum, orderName, store, region) {
  clearForm();
  document.getElementById('fOrder').value = orderNum;
  document.getElementById('fOrderName').value = orderName;
  document.getElementById('fStore').value = store;
  if (region) document.getElementById('fRegion').value = region;
  openForm({ skipDraft: true });
}

export function editItem(id) {
  const rawItem = state.items.find(i => i.id === id);
  if (!rawItem) return;
  refreshRegionalSelects({
    region: rawItem.region || undefined,
    currency: rawItem.currency || undefined,
    shipMethod: rawItem.shipMethod || undefined
  });
  const item = normalizeProductMeta(rawItem);
  appState.editingId = id;
  appState.pendingUploadedMedia = [];
  document.getElementById('fName').value = item.name || '';
  document.getElementById('fOrder').value = item.orderNumber || '';
  document.getElementById('fOrderName').value = item.orderName || '';
  document.getElementById('fStore').value = item.store || '';
  document.getElementById('fRegion').value = item.region || getDefaultRegion();
  document.getElementById('fMaker').value = item.manufacturer || '';
  const _formattedRelease = formatReleaseDate(item.releaseDate || '');
  const _dp = _formattedRelease.split(' ');
  document.getElementById('fDateMonth').value = _dp[0] || '';
  document.getElementById('fDateYear').value = _dp[1] || '';
  document.getElementById('fTracking').value = item.tracking || '';
  document.getElementById('fScale').value = item.scale || '';
  document.getElementById('fShipMethod').value = item.shipMethod || getDefaultShipMethod();
  document.getElementById('fOrderDate').value = item.orderDate || '';
  document.getElementById('fShipDate').value = item.shipDate || '';
  document.getElementById('fImg').value = mediaUrlsOf(item).join(', ');
  document.getElementById('fShopUrl').value = item.shopUrl || '';
  document.getElementById('fPrice').value = item.priceOriginal || '';
  document.getElementById('fCurrency').value = item.currency || getDefaultCurrency();
  syncFormMoneyCurrency();
  setFormBaseEurValue('fShipping', item.shippingEur);
  setFormBaseEurValue('fDeposit', item.deposit);
  document.getElementById('fStatus').value = item.status || 'Не оплачено';
  document.getElementById('fTags').value = (item.tags || []).join(', ');
  document.getElementById('fJan').value = item.jan || '';
  document.getElementById('fSku').value = item.sku || item.code || '';
  document.getElementById('fPreorderStart').value = item.preorderStart || '';
  document.getElementById('fPreorderEnd').value = item.preorderEnd || '';
  document.getElementById('fReleaseStatus').value = item.releaseStatus || 'unknown';
  document.getElementById('fSource').value = item.source || '';
  document.getElementById('fSourceUrl').value = item.sourceUrl || '';
  document.getElementById('formTitle').dataset.i18n = 'form.editFigure';
  document.getElementById('formTitle').textContent = t('form.editFigure');
  updateEurPreview(); openForm();
}

export function deleteItem(id) {
  if (!confirm(t('confirm.deleteItem'))) return;
  createLocalBackup('before-delete-item', true);
  state.items = state.items.filter(i => i.id !== id);
  syncGlobalTags();
  if (!getOrders().find(o => o.orderNumber === appState.selectedOrder)) appState.selectedOrder = null;
  persist(); render(); toast(t('toast.deleted'));
}

function mergeMediaByUrl(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const media of list || []) {
      const key = mediaKey(media);
      if (key && !map.has(key)) map.set(key, media);
    }
  }
  return [...map.values()];
}

function mediaUrlSet(mediaList = []) {
  const urls = new Set();
  for (const media of mediaList || []) {
    if (!media) continue;
    if (typeof media === 'object') {
      [media.url, media.src, media.imageUrl, media.videoUrl, getMediaUrl(media)]
        .map(value => String(value || '').trim())
        .filter(Boolean)
        .forEach(url => urls.add(url));
    } else {
      const url = String(media || '').trim();
      if (url) urls.add(url);
    }
  }
  return urls;
}

export function saveItem() {
  const name = document.getElementById('fName').value.trim();
  const orderNumber = document.getElementById('fOrder').value.trim();
  if (!name) { alert(t('alert.itemNameRequired')); return; }
  if (!orderNumber) { alert(t('alert.orderNumberRequired')); return; }
  const existingItem = appState.editingId ? state.items.find(i => i.id === appState.editingId) : null;
  const uploadedMedia = appState.pendingUploadedMedia || [];
  const currentFImgUrls = new Set(
    document.getElementById('fImg').value
      .split(/[\s,]+/)
      .map(s => s.trim())
      .filter(Boolean)
  );

  const existingMediaToKeep = (existingItem?.media || []).filter(m => {
    const url = getMediaUrl(m);
    return !url || currentFImgUrls.has(url);
  });
  
  const existingImagesToKeep = (existingItem?.images || []).filter(m => {
    const url = getMediaUrl(m);
    return !url || currentFImgUrls.has(url);
  });

  const media = mergeMediaByUrl(
    existingMediaToKeep,
    existingImagesToKeep,
    uploadedMedia
  );
  const mediaUrls = mediaUrlSet(media);
  const imageUrls = [...currentFImgUrls]
    .filter(url => shouldUseExternalUrl(url) && !mediaUrls.has(url));
  const item = normalizeProductMeta({
    id: appState.editingId || crypto.randomUUID(),
    name, orderNumber,
    orderName: document.getElementById('fOrderName').value.trim() || orderNumber,
    store: document.getElementById('fStore').value.trim(),
    region: document.getElementById('fRegion').value,
    manufacturer: document.getElementById('fMaker').value.trim(),
    releaseDate: [document.getElementById('fDateMonth').value, document.getElementById('fDateYear').value].filter(Boolean).join(' '),
    tracking: document.getElementById('fTracking').value.trim(),
    scale: document.getElementById('fScale').value,
    shipMethod: document.getElementById('fShipMethod').value,
    orderDate: document.getElementById('fOrderDate').value,
    shipDate: document.getElementById('fShipDate').value,
    imageUrls,
    imageUrl: imageUrls[0] || existingItem?.imageUrl || '',
    media,
    shopUrl: document.getElementById('fShopUrl').value.trim(),
    jan: document.getElementById('fJan')?.value.trim() || '',
    sku: document.getElementById('fSku')?.value.trim() || '',
    code: document.getElementById('fSku')?.value.trim() || '',
    preorderStart: document.getElementById('fPreorderStart')?.value.trim() || '',
    preorderEnd: document.getElementById('fPreorderEnd')?.value.trim() || '',
    releaseStatus: document.getElementById('fReleaseStatus')?.value || 'unknown',
    source: document.getElementById('fSource')?.value.trim() || '',
    sourceUrl: document.getElementById('fSourceUrl')?.value.trim() || '',
    priceOriginal: parseFloat(document.getElementById('fPrice').value) || 0,
    currency: document.getElementById('fCurrency').value,
    shippingEur: getFormBaseEurValue('fShipping'),
    deposit: getFormBaseEurValue('fDeposit'),
    status: document.getElementById('fStatus').value,
    tags: document.getElementById('fTags').value.split(',').map(t => t.trim()).filter(Boolean),
    rateAtSave: state.rates[document.getElementById('fCurrency').value] ?? 1,
    rateAtSaveDate: appState.editingId ? (existingItem?.rateAtSaveDate || new Date().toLocaleDateString('ru')) : new Date().toLocaleDateString('ru'),
    createdAt: appState.editingId ? (existingItem?.createdAt || Date.now()) : Date.now(),
    hidden: appState.editingId ? (existingItem?.hidden || false) : false
  });
  const hadTracking = Boolean(String(existingItem?.tracking || '').trim());
  const hasTracking = Boolean(String(item.tracking || '').trim());
  const trackingAdded = !hadTracking && hasTracking;
  if (trackingAdded && item.status !== 'Получено' && item.status !== 'В пути') { item.status = 'В пути'; }
  const historyComments = buildChangeHistoryComments(existingItem, item);
  item.comments = appState.editingId ? appendSystemHistoryComments([...(existingItem?.comments || [])], historyComments) : (appState.pendingEntityNotes?.comments || []);
  item.tasks = appState.editingId ? (existingItem?.tasks || []) : (appState.pendingEntityNotes?.tasks || []);
  const wasEditing = Boolean(appState.editingId);
  if (appState.editingId) { const idx = state.items.findIndex(i => i.id === appState.editingId); if (idx >= 0) state.items[idx] = item; else state.items.push(item); }
  else state.items.push(item);
  syncGlobalTags();
  appState.selectedOrder = orderNumber;
  appState.pendingUploadedMedia = [];
  appState.pendingEntityNotes = null;
  if (!wasEditing) clearItemDraft();
  if (appState.movingFromWishlistId) { state.wishlist = (state.wishlist || []).filter(x => x.id !== appState.movingFromWishlistId); appState.movingFromWishlistId = null; }
  closeForm(); persist(); render(); toast(wasEditing ? t('toast.saved') : t('toast.itemAdded'));
}

export function loadSettings() {
  const s = state.settings || {};
  syncFormMoneyCurrency();
  refreshRegionalSelects({
    countryProfile: getCountryProfileId(s),
    region: getDefaultRegion(s),
    currency: getDefaultCurrency(s),
    displayCurrency: getDisplayCurrency(s),
    shipMethod: getDefaultShipMethod(s)
  });
  refreshRegionalRuleFields(getRegionalRules(s));
  document.getElementById('sStore').value = s.store || '';
  if (document.getElementById('sDensity')) document.getElementById('sDensity').value = s.density || 'compact';
  if (document.getElementById('sTheme')) document.getElementById('sTheme').value = s.theme || 'cyberpunk';
  applyUiDensity();
  document.getElementById('sScriptUrl').value = s.scriptUrl || '';
  if (document.getElementById('sUploadProvider')) {
    document.getElementById('sUploadProvider').value = s.uploadProvider || 'telegram';
  }
  document.getElementById('sTgBotToken').value = s.tgBotToken || '';
  document.getElementById('sTgChatId').value = s.tgChatId || '';

  const orders = getOrders();
  const received = state.items.filter(i => i.status === 'Получено').length;
  document.getElementById('settingsStats').innerHTML = t('settings.statsLine', {
    items: state.items.length,
    orders: orders.length,
    received,
    wishlist: state.wishlist?.length || 0
  });
  renderLocalBackups();
}

export function saveSettings(options = {}) {
  const existingTags = getAllTags();
  const previousSettings = state.settings || {};
  const countryProfile = document.getElementById('sCountryProfile')?.value || getCountryProfileId(previousSettings);
  const profileChanged = countryProfile !== getCountryProfileId(previousSettings);
  const profile = getCountryProfile(countryProfile);
  const applyProfileDefaults = countryProfile !== 'custom' && (profileChanged || options.applyProfileDefaults);
  const profileDefaults = applyProfileDefaults
    ? {
      region: profile.defaultRegion,
      currency: profile.defaultCurrency,
      displayCurrency: profile.displayCurrency,
      shipMethod: profile.shippingMethods[0]?.value || 'small_packet'
    }
    : null;
  const displayCurrency = profileDefaults?.displayCurrency || document.getElementById('sDisplayCurrency')?.value || getDisplayCurrency(previousSettings);
  const regionalRuleDefaults = applyProfileDefaults ? getRegionalRuleProfile(countryProfile) : null;
  const regionalRules = collectRegionalRules(regionalRuleDefaults);
  regionalRules.countryProfile = countryProfile;
  regionalRules.displayCurrency = displayCurrency;
  state.settings = {
    ...previousSettings,
    countryProfile,
    region: profileDefaults?.region || document.getElementById('sRegion').value,
    currency: profileDefaults?.currency || document.getElementById('sCurrency').value,
    defaultCurrency: profileDefaults?.currency || document.getElementById('sCurrency').value,
    defaultRegion: profileDefaults?.region || document.getElementById('sRegion').value,
    displayCurrency,
    regionalRules,
    store: document.getElementById('sStore').value,
    shipMethod: profileDefaults?.shipMethod || document.getElementById('sShipMethod').value,
    density: document.getElementById('sDensity')?.value || state.settings?.density || 'compact',
    theme: document.getElementById('sTheme')?.value || state.settings?.theme || 'cyberpunk',
    trackingService: document.getElementById('sTrackingService')?.value || 'auto',
    tags: existingTags,
    gallery: state.settings?.gallery || {},
    scriptUrl: document.getElementById('sScriptUrl').value.trim(),
    uploadProvider: document.getElementById('sUploadProvider')?.value || 'telegram',
    tgBotToken: document.getElementById('sTgBotToken').value.trim(),
    tgChatId: document.getElementById('sTgChatId').value.trim()
  };
  applyUiDensity();
  persist();
  refreshRegionalSelects({
    countryProfile: state.settings.countryProfile,
    region: state.settings.region,
    currency: state.settings.currency,
    displayCurrency: state.settings.displayCurrency,
    shipMethod: state.settings.shipMethod
  });
  refreshRegionalRuleFields(state.settings.regionalRules);
  syncFormMoneyCurrency();
  renderAnalytics();
}

export function clearAllData() {
  if (!confirm(t('confirm.clearAll'))) return;
  if (!confirm(t('confirm.clearAllAgain'))) return;
  createLocalBackup('before-clear', true);
  state.items = []; state.wishlist = [];
  syncGlobalTags();
  appState.selectedOrder = null;
  persist(); render(); toast(t('toast.allDataDeleted'));
}

export function exportData() {
  downloadJsonBackup(state);
  toast(t('toast.backupSaved'));
}

export function toggleOrderHidden(orderNumber) {
  state.items.forEach(i => { if (i.orderNumber === orderNumber) i.hidden = !i.hidden; });
  persist(); render();
  toast(state.items.find(i => i.orderNumber === orderNumber)?.hidden ? t('toast.orderHidden') : t('toast.orderShown'));
}

export function updateSuggestions() {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  const box = document.getElementById('searchSuggestions');
  if (q.length < 1) { box.classList.remove('visible'); return; }
  const hits = [];
  for (const item of state.items) {
    const fields = [item.name, item.manufacturer, item.store, item.orderName, ...(item.tags || [])];
    for (const f of fields) {
      if (f && f.toLowerCase().includes(q) && !hits.includes(f)) {
        hits.push(f);
        if (hits.length >= 6) break;
      }
    }
    if (hits.length >= 6) break;
  }
  if (!hits.length) { box.classList.remove('visible'); return; }
  box.innerHTML = hits.map(h => {
    const idx = h.toLowerCase().indexOf(q);
    const highlighted = H(h.slice(0, idx)) + '<mark>' + H(h.slice(idx, idx + q.length)) + '</mark>' + H(h.slice(idx + q.length));
    return `<div class="search-suggestion" onmousedown="applySuggestion('${H(h)}')">${highlighted}</div>`;
  }).join('');
  box.classList.add('visible');
}

export function applySuggestion(val) {
  document.getElementById('searchInput').value = val;
  document.getElementById('searchSuggestions').classList.remove('visible');
  appState.selectedOrder = null; render();
}

export function renderShelfChart() {
  const el = document.getElementById('shelfChart');
  if (!el) return;
  let shelfValue = 0, inTransitValue = 0, prepaidValue = 0, depositValue = 0, unpaidValue = 0;
  state.items.forEach(i => {
    const itemEur = toEur(i.priceOriginal || 0, i.currency || 'EUR') + (Number(i.shippingEur) || 0);
    const deposit = Number(i.deposit) || 0;
    if (i.status === 'Получено') shelfValue += itemEur;
    else if (i.status === 'В пути') inTransitValue += itemEur;
    else if (i.status === 'Полностью оплачено') prepaidValue += itemEur;
    else if (i.status === 'Депозит оплачен') { prepaidValue += deposit; depositValue += itemEur - deposit; }
    else unpaidValue += itemEur;
  });
  const total = shelfValue + inTransitValue + prepaidValue + depositValue + unpaidValue || 1;
  const pct = v => (v / total * 100).toFixed(1);

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;">
      ${[['📦 Получено', shelfValue, '#a78bfa'], ['🚚 В пути', inTransitValue, '#4ade80'], ['✅ Оплачено', prepaidValue, '#67e8f9'], ['💳 Депозит', depositValue, '#fbbf24'], ['⏳ Не оплачено', unpaidValue, '#f87171']].map(([label, val, color]) => `
        <div style="display:flex;justify-content:space-between;">
          <span style="color:${color}">${label}</span>
          <span style="color:${color}">${eur(val)} · ${pct(val)}%</span>
        </div>`).join('')}
    </div>
    <div style="height:28px;border-radius:14px;overflow:hidden;display:flex;gap:2px;">
      ${shelfValue ? `<div style="width:${pct(shelfValue)}%;background:#a78bfa;border-radius:14px 0 0 14px;"></div>` : ''}
      ${inTransitValue ? `<div style="width:${pct(inTransitValue)}%;background:#4ade80;"></div>` : ''}
      ${prepaidValue ? `<div style="width:${pct(prepaidValue)}%;background:#67e8f9;"></div>` : ''}
      ${depositValue ? `<div style="width:${pct(depositValue)}%;background:#fbbf24;"></div>` : ''}
      ${unpaidValue ? `<div style="width:${pct(unpaidValue)}%;background:#f87171;border-radius:0 14px 14px 0;"></div>` : ''}
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:12px;font-size:13px;color:var(--muted);">
      <span>Коллекция дома: <strong style="color:#a78bfa;">${eur(shelfValue)}</strong></span>
      <span>Ещё потратить: <strong style="color:#f87171;">${eur(depositValue + unpaidValue)}</strong></span>
    </div>`;
}

export function renderAnalytics() {
  const orders = getOrders();
  const totals = getCollectionTotals(orders);
  const received = state.items.filter(i => i.status === 'Получено');
  const inTransit = state.items.filter(i => i.status === 'В пути');
  const unpaid = state.items.filter(i => i.status === 'Не оплачено' || i.status === 'Депозит оплачен');
  const displayCurrency = getDisplayCurrency();
  const importEstimates = state.items.map(item => calculateImportEstimate(item, { ...(state.settings || {}), regionalRules: getRegionalRules() }, state.rates));
  const importExtraTotal = importEstimates.reduce((sum, estimate) => sum + (estimate.enabled ? estimate.estimatedTotalExtra : 0), 0);
  const importGrandTotal = totals.total + importExtraTotal;
  const topStore = Object.entries(state.items.reduce((acc, i) => {
    const key = i.store || '—';
    acc[key] = (acc[key] || 0) + getItemTotalEur(i);
    return acc;
  }, {})).sort((a, b) => b[1] - a[1])[0];

  const summaryEl = document.getElementById('analyticsSummary');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="analytics-kpi"><span>Всего</span><strong>${formatDisplayMoneyFromEur(totals.total)}</strong><small>${orders.length} заказов · ${state.items.length} фигурок</small></div>
      <div class="analytics-kpi"><span>На полке</span><strong>${received.length}</strong><small>${formatDisplayMoneyFromEur(received.reduce((s, i) => s + getItemTotalEur(i), 0))}</small></div>
      <div class="analytics-kpi"><span>В пути</span><strong>${inTransit.length}</strong><small>${inTransit.length ? 'ждёт получения' : 'ничего не едет'}</small></div>
      <div class="analytics-kpi"><span>Осталось</span><strong>${formatDisplayMoneyFromEur(totals.remaining)}</strong><small>${unpaid.length} позиций требуют денег</small></div>
      <div class="analytics-kpi"><span>Топ магазин</span><strong>${H(topStore?.[0] || '—')}</strong><small>${topStore ? formatDisplayMoneyFromEur(topStore[1]) : 'нет данных'}</small></div>
      ${importExtraTotal ? `<div class="analytics-kpi"><span>${t('analytics.importExtras')}</span><strong>${formatDisplayMoneyFromEur(importExtraTotal)}</strong><small>${t('analytics.importGrandTotal')}: ${formatDisplayMoneyFromEur(importGrandTotal)}</small></div>` : ''}
      <div class="analytics-kpi"><span>${t('analytics.baseCurrency', { currency: 'EUR' })}</span><strong>${displayCurrency}</strong><small>${t('analytics.displayCurrency', { currency: displayCurrency })}</small></div>`;
  }

  const forecastEl = document.getElementById('analyticsForecast');
  if (forecastEl) {
    const upcoming = state.items.filter(i => i.status !== 'Получено' && i.releaseDate).sort((a, b) => releaseSortValue(a) - releaseSortValue(b)).slice(0, 6);
    forecastEl.innerHTML = `<div class="analytics-forecast-title">Ближайший план</div>${upcoming.length ? upcoming.map(i => `<button onclick="openEntityDetail('collection','${H(i.id)}')"><span>${H(i.releaseDate || '—')}</span><strong>${H(i.name)}</strong><em>${formatDisplayMoneyFromEur(getItemTotalEur(i))}</em></button>`).join('') : '<div class="dashboard-empty">Нет будущих релизов</div>'}`;
  }

  if (typeof Chart === 'undefined') return;
  const storeData = {}; const makerData = {};
  state.items.forEach(i => {
    const eur = toEur(i.priceOriginal || 0, i.currency || 'EUR');
    const displayValue = eurToDisplayAmount(eur);
    const store = i.store || 'Неизвестно';
    const maker = i.manufacturer || 'Неизвестно';
    storeData[store] = (storeData[store] || 0) + displayValue;
    makerData[maker] = (makerData[maker] || 0) + displayValue;
  });
  const createChart = (canvasId, instance, dataObj, colorScheme) => {
    if (instance) instance.destroy();
    const ctx = document.getElementById(canvasId).getContext('2d');
    const labels = Object.keys(dataObj);
    const data = Object.values(dataObj).map(v => v.toFixed(2));
    return new Chart(ctx, { type: 'doughnut', data: { labels: labels, datasets: [{ data: data, backgroundColor: colorScheme, borderWidth: 0, hoverOffset: 10 }] }, options: { responsive: true, maintainAspectRatio: false, layout: { padding: 0 }, plugins: { legend: { position: 'right', labels: { color: '#edf2f8', boxWidth: 12, padding: 15, font: { size: 11 } } } } } });
  };
  const colors = ['#4ade80', '#67e8f9', '#a78bfa', '#f87171', '#fbbf24', '#818cf8', '#34d399', '#f472b6'];
  appState.storeChartInstance = createChart('storeChart', appState.storeChartInstance, storeData, colors);
  appState.makerChartInstance = createChart('makerChart', appState.makerChartInstance, makerData, [...colors].reverse());

  const MONTH_NAMES = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
  const now = new Date(); const monthsPaid = new Array(12).fill(0); const monthsUnpaid = new Array(12).fill(0);
  state.items.forEach(i => {
    if (!i.releaseDate) return;
    const lower = i.releaseDate.toLowerCase();
    const yearMatch = lower.match(/\d{4}/);
    if (!yearMatch || parseInt(yearMatch[0]) !== now.getFullYear()) return;
    const ymd = i.releaseDate.match(/(\d{4})[\/\-](\d{1,2})/);
    let mIdx = -1;
    if (ymd) { mIdx = parseInt(ymd[2]) - 1; } else {
      const RU_MONTHS = [['янв'], ['фев'], ['мар'], ['апр'], ['май', 'мая'], ['июн'], ['июл'], ['авг'], ['сен'], ['окт'], ['ноя', 'ноябр'], ['дек']];
      mIdx = RU_MONTHS.findIndex(v => v.some(m => lower.includes(m)));
    }
    if (mIdx < 0) return;
    const eurVal = toEur(i.priceOriginal || 0, i.currency || 'EUR');
    const displayValue = eurToDisplayAmount(eurVal);
    if (i.status === 'Полностью оплачено' || i.status === 'Получено') monthsPaid[mIdx] += displayValue; else monthsUnpaid[mIdx] += displayValue;
  });

  if (appState.monthChartInstance) appState.monthChartInstance.destroy();
  const ctxM = document.getElementById('monthChart').getContext('2d');
  appState.monthChartInstance = new Chart(ctxM, { type: 'bar', data: { labels: MONTH_NAMES, datasets: [{ label: 'Оплачено', data: monthsPaid.map(v => v.toFixed(2)), backgroundColor: '#4ade8088', borderColor: '#4ade80', borderWidth: 1, borderRadius: 6 }, { label: 'Не оплачено', data: monthsUnpaid.map(v => v.toFixed(2)), backgroundColor: '#67e8f988', borderColor: '#67e8f9', borderWidth: 1, borderRadius: 6 }] }, options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true, ticks: { color: '#8899aa' }, grid: { color: '#ffffff11' } }, y: { stacked: true, ticks: { color: '#8899aa', callback: v => `${v} ${displayCurrency}` }, grid: { color: '#ffffff11' } } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y} ${displayCurrency}` } } } } });
}

export function payWholeOrder(orderNumber) {
  state.items.forEach(i => { if (i.orderNumber === orderNumber) i.status = 'Полностью оплачено'; });
  persist(); render(); toast(t('toast.orderPaid'));
}

export function receiveWholeOrder(orderNumber) {
  state.items.forEach(i => { if (i.orderNumber === orderNumber) i.status = 'Получено'; });
  persist(); render(); renderShelf(); toast(t('toast.orderReceived'));
}

export function renderTagSuggestions() {
  renderTagButtons('fTags', 'tagSuggestions');
  renderTagButtons('wTags', 'wishTagSuggestions');
}

function renderTagButtons(inputId, containerId) {
  const allTags = getAllTags();
  const input = document.getElementById(inputId);
  const container = document.getElementById(containerId);
  if (!container || !input) return;
  const current = input.value.split(',').map(t => tagKey(t)).filter(Boolean);
  const suggestions = allTags.filter(t => !current.includes(tagKey(t)));
  if (!suggestions.length) { container.innerHTML = ''; return; }
  container.innerHTML = suggestions.map(tag => `<button type="button" class="tag-suggestion-chip" data-tag="${H(tag)}">+ ${H(tag)}</button>`).join('');
  container.querySelectorAll('[data-tag]').forEach(btn => {
    btn.addEventListener('click', () => addTag(btn.dataset.tag, inputId));
  });
}

export function addTag(tag, inputId = 'fTags') {
  const input = document.getElementById(inputId);
  if (!input) return;
  const current = input.value.split(',').map(t => t.trim()).filter(Boolean);
  if (!current.some(t => tagKey(t) === tagKey(tag))) { current.push(tag); input.value = current.join(', '); }
  renderTagSuggestions();
}

function isGalleryHiddenItem(item = {}) {
  return item.hidden === true || item.isHidden === true || item.galleryHidden === true || item.visibility === 'hidden';
}

export function setGalleryShowHidden(value) {
  state.settings = state.settings || {};
  state.settings.gallery = state.settings.gallery || {};
  state.settings.gallery.showHidden = Boolean(value);
  schedulePersist();
  scheduleRender('gallery', renderGallery);
}

export function cleanupGalleryAutoSlider() {
  if (gallerySliderTimer) {
    clearInterval(gallerySliderTimer);
    gallerySliderTimer = null;
  }
  if (gallerySliderObserver) {
    gallerySliderObserver.disconnect();
    gallerySliderObserver = null;
  }
  visibleGallerySliders.clear();
}

function setGalleryCardSlide(card, next) {
  const slides = [...card.querySelectorAll('.gallery-slide')];
  if (slides.length <= 1) return;
  const index = ((next % slides.length) + slides.length) % slides.length;
  slides.forEach((slide, idx) => {
    const active = idx === index;
    slide.classList.toggle('is-active', active);
    if (!active) slide.querySelectorAll('video').forEach(video => video.pause?.());
  });
  card.dataset.currentIndex = String(index);
  const count = card.querySelector('.gallery-card-count');
  if (count) count.textContent = `${index + 1}/${slides.length}`;
  card.querySelectorAll('.gallery-dot').forEach((dot, idx) => dot.classList.toggle('active', idx === index));
}

function isGallerySlideReady(slide) {
  const media = slide?.querySelector('img, video');
  if (!media) return false;
  if (media instanceof HTMLImageElement) return Boolean(media.complete && media.naturalWidth);
  if (media instanceof HTMLVideoElement) return media.readyState >= 1;
  return true;
}

function advanceGalleryCardSlide(card) {
  if (!card || card.matches(':hover') || card.matches(':focus-within')) return;
  const slides = [...card.querySelectorAll('.gallery-slide')];
  if (slides.length <= 1) return;
  const activeVideo = card.querySelector('.gallery-slide.is-active video');
  if (activeVideo && !activeVideo.paused && !activeVideo.dataset.gifLike) return;
  const current = Math.max(0, Number(card.dataset.currentIndex || 0));
  const next = (current + 1) % slides.length;
  if (!isGallerySlideReady(slides[next])) return;
  setGalleryCardSlide(card, next);
}

function lockGalleryCardMediaRatio(card) {
  if (!card || card.dataset.mediaRatioLocked === 'true') return;
  const mediaBox = card.querySelector('.gallery-card-media-slider, .gallery-card-media, .gallery-video-wrap');
  const firstMedia = mediaBox?.querySelector('img, video');
  if (!mediaBox || !firstMedia) return;
  const apply = () => {
    let width = 4;
    let height = 5;
    if (firstMedia instanceof HTMLImageElement && firstMedia.naturalWidth && firstMedia.naturalHeight) {
      width = firstMedia.naturalWidth;
      height = firstMedia.naturalHeight;
    } else if (firstMedia instanceof HTMLVideoElement && firstMedia.videoWidth && firstMedia.videoHeight) {
      width = firstMedia.videoWidth;
      height = firstMedia.videoHeight;
    }
    const isWide = width > height * 1.25;
    const isSquare = Math.abs(width - height) / Math.max(width, height) < 0.14;
    card.classList.toggle('gallery-card-wide', isWide);
    card.classList.toggle('gallery-card-square', !isWide && isSquare);
    card.classList.toggle('gallery-card-tall', !isWide && !isSquare);
    card.style.setProperty('--gallery-card-ratio', isWide ? '16 / 10' : isSquare ? '1 / 1' : '4 / 5');
    card.dataset.mediaRatioLocked = 'true';
  };
  if ((firstMedia instanceof HTMLImageElement && firstMedia.complete) || firstMedia.readyState >= 1) {
    apply();
  } else {
    firstMedia.addEventListener('load', apply, { once: true });
    firstMedia.addEventListener('loadedmetadata', apply, { once: true });
  }
}

function initGalleryAutoSlider() {
  cleanupGalleryAutoSlider();
  const cards = [...document.querySelectorAll('[data-gallery-slider="true"]')];
  if (!cards.length) return;
  cards.forEach(lockGalleryCardMediaRatio);
  gallerySliderObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) visibleGallerySliders.add(entry.target);
      else visibleGallerySliders.delete(entry.target);
    });
  }, { threshold: 0.35 });
  cards.forEach(card => gallerySliderObserver.observe(card));
  const delay = isMobileViewport() ? 7000 : 5500;
  gallerySliderTimer = window.setInterval(() => {
    visibleGallerySliders.forEach(card => advanceGalleryCardSlide(card));
  }, delay);
}

export function openGalleryCardLightbox(button, ownerType, ownerId) {
  const card = button?.closest?.('.gallery-card');
  const index = Math.max(0, Number(card?.dataset.currentIndex || 0));
  const slide = card?.querySelector(`.gallery-slide[data-slide-index="${index}"]`) || card?.querySelector('.gallery-slide.is-active');
  const url = slide?.dataset.mediaUrl || '';
  if (!url) return;
  openItemLightbox(ownerType, ownerId, url, index, slide.querySelector('video'));
}

export function renderGallery() {
  cleanupGalleryAutoSlider();
  const sort = document.getElementById('gallerySort')?.value || 'newest';
  const makerF = document.getElementById('galleryMaker')?.value || '';
  const showHiddenEl = document.getElementById('galleryShowHidden');
  if (showHiddenEl && showHiddenEl.dataset.initialized !== '1') {
    showHiddenEl.checked = Boolean(state.settings?.gallery?.showHidden);
    showHiddenEl.dataset.initialized = '1';
  }
  const showHidden = showHiddenEl ? showHiddenEl.checked : Boolean(state.settings?.gallery?.showHidden);
  let items = state.items.filter(i => showHidden || !isGalleryHiddenItem(i));

  const makerSource = state.items.filter(i => showHidden || !isGalleryHiddenItem(i));
  const makers = [...new Set(makerSource.map(i => i.manufacturer).filter(Boolean))].sort();
  const makerSel = document.getElementById('galleryMaker');
  if (makerSel) {
    const cur = makerSel.value;
    makerSel.innerHTML = `<option value="">${t('gallery.allMakers')}</option>` + makers.map(m => `<option value="${H(m)}" ${m === cur ? 'selected' : ''}>${H(m)}</option>`).join('');
  }

  items = items.filter(i => matchesGlobalSearch(i));
  if (makerF) items = items.filter(i => i.manufacturer === makerF);

  items.sort((a, b) => {
    if (sort === 'newest') return (b.createdAt || 0) - (a.createdAt || 0);
    if (sort === 'name') return (a.name || '').localeCompare(b.name || '');
    if (sort === 'price-desc') return toEur(b.priceOriginal || 0, b.currency || 'EUR') - toEur(a.priceOriginal || 0, a.currency || 'EUR');
    if (sort === 'price-asc') return toEur(a.priceOriginal || 0, a.currency || 'EUR') - toEur(b.priceOriginal || 0, b.currency || 'EUR');
    return 0;
  });

 const stats = document.getElementById('galleryStats');
if (stats) {
  stats.innerHTML = `<div style="font-size:13px;color:var(--muted);margin-bottom:14px;">${items.length} фигурок${makerF ? ` · ${H(makerF)}` : ''}</div>`;
}

const grid = document.getElementById('galleryGrid');
if (!grid) return;

if (!items.length) {
  grid.innerHTML = `<div style="color:var(--muted);text-align:center;padding:60px 0;">${t('gallery.empty')}</div>`;
  return;
}

const visibleCount = appState.galleryVisibleCount || GALLERY_PAGE_SIZE;
const visibleItems = items.slice(0, visibleCount);

grid.innerHTML = visibleItems.map((item, idx) => {
  const priceEur = toEur(item.priceOriginal || 0, item.currency || 'EUR');
  const imgs = mediaEntriesOf(item);
  const slides = imgs.map((entry, mediaIdx) => {
    const mediaTag = renderMediaTag(entry.media, 'gallery-media', item.name)
      .replace(/class="([^"]*gallery-media[^"]*)"/, `class="$1" data-media-url="${H(entry.url)}"`)
      .replace('<video ', entry.kind === 'animation' ? '<video data-gif-like="true" ' : '<video ');
    return `<div class="gallery-slide ${mediaIdx === 0 ? 'is-active' : ''}" data-slide-index="${mediaIdx}" data-media-url="${H(entry.url)}">${mediaTag}</div>`;
  }).join('');
  const mediaHtml = imgs.length
    ? `<div class="gallery-card-media ${imgs.some(entry => entry.kind === 'video' || entry.kind === 'animation') ? 'has-video' : ''}">
        <div class="gallery-card-media-slider">${slides}</div>
        <button class="icon-action-btn media-open-btn" type="button" title="${t('common.open')}" onclick="event.stopPropagation(); openGalleryCardLightbox(this, 'collection', '${H(item.id)}')">⛶</button>
        ${imgs.length > 1 ? `<span class="gallery-card-count">1/${imgs.length}</span>` : ''}
      </div>`
    : `<div class="gallery-card-media gallery-card-placeholder"><div>📦</div></div>`;
  const meta = [
    item.store,
    item.status,
    priceEur ? eur(priceEur) : ''
  ].filter(Boolean).map(H).join(' · ');

  return `<div class="gallery-card animate-in" ${imgs.length > 1 ? `data-gallery-slider="true" data-item-id="${H(item.id)}" data-current-index="0"` : ''} style="animation-delay:${idx * 20}ms;" onclick="if(isCardOpenBlocked(event))return;openEntityDetail('collection','${H(item.id)}')">
      ${mediaHtml}
      <div class="gallery-card-body">
        <div class="gallery-card-title">${H(item.name)}</div>
        ${meta ? `<div class="gallery-card-meta">${meta}</div>` : ''}
        ${imgs.length > 1 ? `<div class="gallery-dots">${imgs.map((_, dotIdx) => `<span class="gallery-dot ${dotIdx === 0 ? 'active' : ''}"></span>`).join('')}</div>` : ''}
      </div>
    </div>`;
}).join('');

if (visibleItems.length < items.length) {
  grid.innerHTML += `<div class="gallery-more">
    <button type="button" class="btn btn-primary btn-sm" onclick="showMoreGallery()">${t('gallery.showMore', { count: Math.min(GALLERY_PAGE_SIZE, items.length - visibleItems.length), total: items.length - visibleItems.length })}</button>
  </div>`;
}
ensurePreviewVideoControls(grid);
requestAnimationFrame(initGalleryAutoSlider);
}

export function showMoreGallery() {
  appState.galleryVisibleCount = (appState.galleryVisibleCount || GALLERY_PAGE_SIZE) + GALLERY_PAGE_SIZE;
  renderGallery();
}

export function resetGalleryPagination() {
  appState.galleryVisibleCount = GALLERY_PAGE_SIZE;
}

export function checkReleaseReminders() {
  const now = new Date(); const cm = now.getMonth(), cy = now.getFullYear();
  const allItems = [...state.items, ...(state.wishlist || [])];
  const months = ['январ', 'феврал', 'март', 'апрел', 'май', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
  const upcoming = allItems.filter(item => {
    if (!item.releaseDate) return false;
    const d = item.releaseDate.toLowerCase();
    const mIdx = months.findIndex(m => d.includes(m));
    if (mIdx === -1) return false;
    const yearMatch = d.match(/\d{4}/);
    const year = yearMatch ? parseInt(yearMatch[0]) : cy;
    const diff = (year - cy) * 12 + (mIdx - cm);
    return diff >= 0 && diff <= 1;
  });
  const unpaidItems = state.items.filter(i => i.status !== 'Получено' && i.status !== 'Полностью оплачено');
  const unpaidTotal = unpaidItems.reduce((sum, i) => sum + toEur(i.priceOriginal || 0, i.currency || 'EUR'), 0);
  const inTransit = state.items.filter(i => i.status === 'В пути');
  const received = state.items.filter(i => i.status === 'Получено');
  const totalSpent = received.reduce((s, i) => s + toEur(i.priceOriginal || 0, i.currency || 'EUR'), 0);
  state.bannerData = { upcoming, unpaidItems, unpaidTotal, inTransit, stats: { totalItems: state.items.length, received: received.length, wishlist: (state.wishlist || []).length, totalSpent } };
}

export function updateBanner(advance = false) {
  const banner = document.getElementById('releaseBanner');
  if (!banner) return;
  if (typeof appState.currentTab !== 'undefined' && appState.currentTab !== 'collection') { banner.style.display = 'none'; return; }
  const data = state.bannerData || {}; const notices = [];
  if (data.unpaidItems?.length) notices.push({ type: 'unpaid', text: `💰 Не оплачено ${data.unpaidItems.length} шт. на ${eur(data.unpaidTotal)}` });
  if (data.upcoming?.length) notices.push({ type: 'upcoming', text: `🔔 Скоро выходят: ${data.upcoming.slice(0, 3).map(i => `${H(i.name)} (${H(i.releaseDate)})`).join(' • ')}` });
  if (data.inTransit?.length) notices.push({ type: 'transit', text: `🚚 В пути: ${data.inTransit.length} фигурок` });
  if (data.stats) notices.push({ type: 'stats', text: `📦 Коллекция: ${data.stats.totalItems} фигурок · дома ${data.stats.received} · в вишлисте ${data.stats.wishlist}` });
  notices.push({ type: 'fact', text: getFactByTime() });
  const active = notices.filter(n => n && n.text);
  if (!active.length) { banner.style.display = 'none'; return; }
  if (advance) appState.bannerIndex = (appState.bannerIndex + 1) % active.length;
  else if (appState.bannerIndex >= active.length) appState.bannerIndex = 0;

  const currentNotice = active[appState.bannerIndex];
  const BANNER_THEMES = { unpaid: { bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.2)', color: 'var(--red)' }, upcoming: { bg: 'rgba(251,191,36,0.08)', border: 'rgba(251,191,36,0.2)', color: 'var(--yellow)' }, transit: { bg: 'rgba(74,222,128,0.08)', border: 'rgba(74,222,128,0.2)', color: 'var(--green)' }, stats: { bg: 'rgba(103,232,249,0.08)', border: 'rgba(103,232,249,0.2)', color: 'var(--accent)' }, fact: { bg: 'rgba(138,147,168,0.08)', border: 'rgba(138,147,168,0.2)', color: 'var(--muted)' } };
  const theme = BANNER_THEMES[currentNotice.type] || BANNER_THEMES.fact;
  banner.style.background = theme.bg; banner.style.borderBottomColor = theme.border; banner.style.color = theme.color;
  banner.style.display = 'flex';
  banner.innerHTML = '<div class="release-ticker"><div class="release-ticker-track"><span class="release-ticker-text"></span></div></div>';
  banner.querySelector('.release-ticker-text').innerHTML = currentNotice.text;
  requestAnimationFrame(updateReleaseTickerState);
}

function updateReleaseTickerState() {
  const ticker = document.querySelector('.release-ticker');
  const track = document.querySelector('.release-ticker-track');
  if (!ticker || !track) return;
  const shouldScroll = track.scrollWidth > ticker.clientWidth + 8;
  ticker.classList.toggle('is-marquee', shouldScroll);
  if (shouldScroll) {
    const duration = Math.max(16, Math.min(45, Math.round(track.scrollWidth / 35)));
    ticker.style.setProperty('--release-ticker-duration', `${duration}s`);
  }
}

export function getFactByTime() {
  const facts = ['🎯 Подсказка: используй теги, чтобы группировать фигурки по сериям', '💾 Делай бекапы в Google Drive, чтобы не потерять коллекцию', '📅 Можно сортировать заказы по ближайшему релизу', '🗂️ Полка показывает только полученные фигурки', '🏷️ Кликаешь по тегам в форме — они подставляются автоматически', '💡 Совет: используй фильтры, чтобы быстро находить нужные фигурки', '⚙️ Настройки позволяют менять валюту и ссылку на Google Script и телеграм-бота'];
  return facts[Math.floor(Date.now() / 60000) % facts.length];
}

export function openWishForm(...args) {
  const result = WishlistView.openWishForm(...args);
  pushUiHistory('wishForm');
  return result;
}
export function closeWishForm(...args) {
  const result = WishlistView.closeWishForm(...args);
  if (appState.historyLayer === 'wishForm') appState.historyLayer = null;
  return result;
}
export function clearWishForm(...args) { return WishlistView.clearWishForm(...args); }
export function saveWish(...args) { return WishlistView.saveWish(...args); }
export function deleteWish(...args) { return WishlistView.deleteWish(...args); }

export function moveWishToCollection(id) {
  const rawWish = (state.wishlist || []).find(x => x.id === id); if (!rawWish) return;
  const w = normalizeProductMeta(rawWish);
  closeModal();
  appState.pendingUploadedMedia = Array.isArray(w.media) ? [...w.media] : [];
  appState.pendingEntityNotes = {
    comments: Array.isArray(rawWish.comments) ? [...rawWish.comments] : [],
    tasks: Array.isArray(rawWish.tasks) ? [...rawWish.tasks] : []
  };
  document.getElementById('fName').value = w.name || ''; document.getElementById('fStore').value = w.store || ''; document.getElementById('fMaker').value = w.manufacturer || '';
  const _dp = (w.releaseDate || '').split(' '); document.getElementById('fDateMonth').value = _dp[0] || ''; document.getElementById('fDateYear').value = _dp[1] || '';
  document.getElementById('fImg').value = (w.imageUrls?.length ? w.imageUrls : (w.imageUrl ? [w.imageUrl] : [])).join(', '); document.getElementById('fShopUrl').value = w.shopUrl || '';
  document.getElementById('fPrice').value = w.priceOriginal || ''; document.getElementById('fCurrency').value = w.currency || 'JPY'; document.getElementById('fTags').value = (w.tags || []).join(', ');
  document.getElementById('fJan').value = w.jan || '';
  document.getElementById('fSku').value = w.sku || w.code || '';
  document.getElementById('fPreorderStart').value = w.preorderStart || '';
  document.getElementById('fPreorderEnd').value = w.preorderEnd || '';
  document.getElementById('fReleaseStatus').value = w.releaseStatus || 'unknown';
  document.getElementById('fSource').value = w.source || '';
  document.getElementById('fSourceUrl').value = w.sourceUrl || '';
  updateEurPreview();
  switchTab('collection');
  document.getElementById('formTitle').dataset.i18n = 'form.addFigure'; document.getElementById('formTitle').textContent = t('form.addFigure'); appState.editingId = null; appState.movingFromWishlistId = id; document.getElementById('formOverlay').style.display = 'flex'; pushUiHistory('form'); toast(t('toast.moveWishPrompt'));
}

function mediaUrlsOf(item) {
  return mediaEntriesOf(item).map(entry => entry.url);
}

function mediaEntriesOf(item) {
  const entries = [];
  const seen = new Set();
  const add = value => {
    const url = getMediaUrl(value);
    const key = mediaKey(value) || url;
    if (!url || seen.has(key)) return;
    seen.add(key);
    const media = value && typeof value === 'object' ? value : url;
    if (value && typeof value === 'object') mediaLookup.set(url, value);
    entries.push({ url, media, kind: getMediaKind(media) });
  };

  (item?.imageUrls || []).filter(shouldUseExternalUrl).forEach(add);
  (item?.media || []).forEach(add);

  if (shouldUseExternalUrl(item?.imageUrl)) add(item.imageUrl);
  if (shouldUseExternalUrl(item?.img)) add(item.img);

  return entries;
}

function mediaForUrl(value) {
  const url = getMediaUrl(value);
  return mediaLookup.get(url) || value;
}

function normalizeLightboxEntry(value) {
  const media = value?.media ?? value;
  const url = String(value?.url || getMediaUrl(media) || '').trim();
  if (!url) return null;
  return { url, media, kind: value?.kind || getMediaKind(media) };
}

function getLightboxOwner(ownerType, ownerId) {
  if (!ownerId) return null;
  if (ownerType === 'wishlist') return (state.wishlist || []).find(item => item.id === ownerId) || null;
  if (ownerType === 'collection') return (state.items || []).find(item => item.id === ownerId) || null;
  return (state.items || []).find(item => item.id === ownerId)
    || (state.wishlist || []).find(item => item.id === ownerId)
    || null;
}

function getLightboxItems(src, context) {
  if (Array.isArray(context)) return context.map(normalizeLightboxEntry).filter(Boolean);

  if (context && typeof context === 'object') {
    const explicitItems = context.items || context.mediaItems || context.media || [];
    if (Array.isArray(explicitItems) && explicitItems.length) {
      return explicitItems.map(normalizeLightboxEntry).filter(Boolean);
    }

    const owner = getLightboxOwner(context.ownerType, context.ownerId);
    if (owner) return mediaEntriesOf(owner);
  }

  if (typeof context === 'string') {
    if (context === 'modal' && Array.isArray(window.currentModalMedia) && window.currentModalMedia.length) {
      return window.currentModalMedia.map(normalizeLightboxEntry).filter(Boolean);
    }

    const owner = getLightboxOwner('', context);
    if (owner) return mediaEntriesOf(owner);

    if (context === 'gallery') return [normalizeLightboxEntry(src)].filter(Boolean);
  }

  return [normalizeLightboxEntry(src)].filter(Boolean);
}

function updateLightboxControls() {
  const items = appState.lightboxItems || [];
  const hasMultiple = items.length > 1;
  document.querySelectorAll('.lightbox-arrow').forEach(btn => {
    btn.style.display = hasMultiple ? 'flex' : 'none';
    btn.disabled = !hasMultiple;
  });
  const counter = document.getElementById('lightboxCounter');
  if (counter) {
    counter.textContent = hasMultiple ? `${appState.lightboxIndex + 1}/${items.length}` : '';
  }
}

export function openItemLightbox(ownerType, ownerId, src, index = null, sourceVideo = null) {
  const owner = getLightboxOwner(ownerType, ownerId);
  const items = owner ? mediaEntriesOf(owner) : [];
  const videoState = captureAppVideoState(sourceVideo) || (sourceVideo ? (() => {
    const wasPaused = sourceVideo.paused;
    const state = {
      currentTime: sourceVideo.currentTime || 0,
      paused: wasPaused,
      muted: sourceVideo.muted,
      volume: sourceVideo.volume,
      playbackRate: sourceVideo.playbackRate || 1
    };
    if (!wasPaused) sourceVideo.pause();
    return state;
  })() : null);
  openLightbox(src, { items, index, ownerId, ownerType, videoState });
}

function renderClickableMedia(url, className = '', alt = '', lightboxContext = 'gallery') {
  if (!url) return '';

  const kind = getMediaKind(url);

  if (kind === 'animation' || kind === 'video') {
    return renderMediaTag(url, className, alt);
  }

  return `<img class="${className} zoomable" data-media-url="${H(url)}" src="${H(url)}" loading="lazy" alt="${H(alt || '')}" onerror="handleMediaLoadError(this)" onclick="event.stopPropagation();openItemLightbox('', '${H(lightboxContext)}', '${H(url)}')">`;
}

export function editWish(...args) {
  const result = WishlistView.editWish(...args);
  pushUiHistory('wishForm');
  return result;
}
export function renderWishlist(...args) { return WishlistView.renderWishlist(...args); }
export function openWishModal(id) { return openEntityDetail('wishlist', id); }

function setModalMedia(media, alt = '', lightboxContext = 'modal') {
  const oldEl = document.getElementById('modalImg');
  if (!oldEl) return;
  stopMedia(oldEl.parentElement || document.getElementById('modalOverlay'), { resetSrc: true });

  const resolvedMedia = mediaForUrl(media);
  const safeUrl = String(getMediaUrl(resolvedMedia) || '');
  const kind = getMediaKind(resolvedMedia);

  let newEl;
  const stopVideoEvent = (event) => stopMediaEvent(event);

  if (kind === 'animation') {
    newEl = document.createElement('video');
    newEl.autoplay = true;
    newEl.loop = true;
    newEl.muted = true;
    newEl.playsInline = true;
    newEl.preload = 'auto';
    newEl.src = safeUrl;
    newEl.dataset.gifLike = 'true';
    newEl.dataset.noSwipe = 'true';
    newEl.dataset.noLightboxClose = 'true';
    newEl.onclick = stopVideoEvent;
  } else if (kind === 'video') {
    const appVideo = createAppVideoElement(safeUrl, 'modal-img', 'modal-img');
    newEl = appVideo.wrap;
    newEl.style.display = safeUrl ? 'block' : 'none';
    bindAppVideoControls(newEl);
  } else {
    newEl = document.createElement('img');
    newEl.src = safeUrl;
    newEl.alt = alt || '';

    newEl.onclick = (event) => {
      event.stopPropagation();
      if (appState.entityDetailSuppressClick) return;
      if (safeUrl) openLightbox(safeUrl, lightboxContext);
    };
  }

  newEl.id = 'modalImg';
  if (newEl.tagName === 'VIDEO') newEl.dataset.noCardOpen = 'true';

  // zoomable только для фото, не для видео/gif-анимаций
  if (kind !== 'video') newEl.className = 'modal-img ' + (safeUrl && kind === 'image' ? 'zoomable' : '');

  if (resolvedMedia && typeof resolvedMedia === 'object') {
    if (resolvedMedia.provider) newEl.dataset.provider = resolvedMedia.provider;
    if (resolvedMedia.fileId) newEl.dataset.fileId = resolvedMedia.fileId;
    if (resolvedMedia.mediaType) newEl.dataset.mediaType = resolvedMedia.mediaType;
  }
  newEl.onerror = () => handleMediaLoadError(newEl);
  if (resolvedMedia && typeof resolvedMedia === 'object') {
    if (resolvedMedia.provider) newEl.dataset.provider = resolvedMedia.provider;
    if (resolvedMedia.fileId) newEl.dataset.fileId = resolvedMedia.fileId;
    if (resolvedMedia.mediaType) newEl.dataset.mediaType = resolvedMedia.mediaType;
  }
  newEl.onerror = () => handleMediaLoadError(newEl);
  newEl.style.display = safeUrl ? 'block' : 'none';

  oldEl.replaceWith(newEl);
  if (kind === 'video') bindAppVideoControls(newEl);
}

function setLightboxMedia(media, alt = '', options = {}) {
  const oldEl = document.getElementById('lightboxImg');
  if (!oldEl) return;
  stopMedia(document.getElementById('lightboxOverlay'), { resetSrc: true });

  const resolvedMedia = mediaForUrl(media);
  const safeUrl = String(getMediaUrl(resolvedMedia) || '');
  const kind = getMediaKind(resolvedMedia);

  let newEl;
  let mediaEl;
  if (kind === 'animation') {
    newEl = document.createElement('video');
    newEl.autoplay = true;
    newEl.loop = true;
    newEl.muted = true;
    newEl.playsInline = true;
    newEl.preload = 'auto';
    newEl.src = safeUrl;
    newEl.dataset.gifLike = 'true';
    newEl.dataset.noSwipe = 'true';
    newEl.dataset.noLightboxClose = 'true';
  } else if (kind === 'video') {
    const appVideo = createAppVideoElement(safeUrl, 'lightbox-media lightbox-video', 'lightbox-video-wrap');
    newEl = appVideo.wrap;
    mediaEl = appVideo.video;
  } else {
    newEl = document.createElement('img');
    newEl.src = safeUrl;
    newEl.alt = alt || '';
    newEl.onclick = (event) => event.stopPropagation();
  }

  newEl.id = 'lightboxImg';
  if (newEl.tagName === 'VIDEO') newEl.dataset.noCardOpen = 'true';
  if (mediaEl) mediaEl.dataset.noCardOpen = 'true';

  if (kind === 'animation') {
    newEl.className = 'lightbox-media lightbox-video lightbox-gif-video lightbox-animation';
  } else {
    if (kind !== 'video') newEl.className = 'lightbox-media';
  }

  newEl.style.display = safeUrl ? 'block' : 'none';

  oldEl.replaceWith(newEl);
  pauseAllVideosExcept(mediaEl || (newEl.tagName === 'VIDEO' ? newEl : null));
  if (mediaEl) bindAppVideoControls(newEl);
  if (mediaEl) applyLightboxVideoState();
}

function applyLightboxVideoState() {
  const state = appState.lightboxVideoState;
  if (!state) return;
  const video = document.querySelector('#lightboxOverlay video[data-app-video="true"]');
  if (!video) return;
  const apply = () => {
    try {
      if (Number.isFinite(state.currentTime) && state.currentTime > 0) {
        video.currentTime = Math.min(state.currentTime, video.duration || state.currentTime);
      }
      video.muted = Boolean(state.muted);
      if (typeof state.volume === 'number') video.volume = Math.max(0, Math.min(1, state.volume));
      if (state.playbackRate) video.playbackRate = state.playbackRate;
      updateAppVideoControls(video);
      if (!state.paused) video.play?.().catch(console.warn);
    } catch (error) {
      console.warn('[lightbox video state] failed', error);
    } finally {
      appState.lightboxVideoState = null;
    }
  };
  if (video.readyState >= 1) apply();
  else video.addEventListener('loadedmetadata', apply, { once: true });
}

function productDetailRow(label, value, isHtml = false, extraClass = '') {
  if (value == null || value === '') return '';
  return `<div class="modal-row entity-detail-row product-detail-row ${extraClass}"><span class="modal-label">${H(label)}</span>${isHtml ? `<span>${value}</span>` : `<span>${H(value)}</span>`}</div>`;
}

function productDetailLink(label, url, text = '') {
  if (!url) return '';
  const safeUrl = H(url);
  return productDetailRow(label, `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${H(text || url)}</a>`, true);
}

function importWarningText(warning) {
  return {
    missingAmount: t('importEstimate.warningMissingAmount'),
    missingItemRate: t('importEstimate.warningMissingRate'),
    missingLimitRate: t('importEstimate.warningMissingRate'),
    missingFeeRate: t('importEstimate.warningMissingRate')
  }[warning] || warning;
}

function buildImportEstimateBlock(item) {
  const settings = { ...(state.settings || {}), regionalRules: getRegionalRules() };
  const rules = settings.regionalRules;
  const estimate = calculateImportEstimate(item, settings, state.rates);
  if (!estimate.enabled) return '';
  const rows = [
    productDetailRow(t('importEstimate.taxableBase'), formatDisplayMoneyFromEur(estimate.taxableBase)),
    productDetailRow(t('importEstimate.limit'), `${rules.taxFreeLimit || 0} ${rules.taxFreeLimitCurrency || 'EUR'}`),
    productDetailRow(t('importEstimate.overLimit'), formatDisplayMoneyFromEur(estimate.overLimitAmount)),
    productDetailRow(t('importEstimate.importDuty'), formatDisplayMoneyFromEur(estimate.importDuty)),
    productDetailRow(t('importEstimate.vat'), formatDisplayMoneyFromEur(estimate.vat)),
    productDetailRow(t('importEstimate.fees'), formatDisplayMoneyFromEur(estimate.customsFee + estimate.brokerFee + estimate.domesticShipping)),
    productDetailRow(t('importEstimate.extraTotal'), formatDisplayMoneyFromEur(estimate.estimatedTotalExtra)),
    productDetailRow(t('importEstimate.grandTotal'), formatDisplayMoneyFromEur(estimate.estimatedGrandTotal))
  ].filter(Boolean).join('');
  const warnings = [...new Set(estimate.warnings || [])].map(importWarningText).filter(Boolean);
  return `
    <details class="entity-import-estimate">
      <summary class="entity-import-estimate-title">${H(t('importEstimate.title'))}</summary>
      <div class="entity-import-estimate-rows">${rows}</div>
      <div class="entity-import-estimate-warning">${H(t('importEstimate.disclaimer'))}</div>
      ${warnings.length ? `<div class="entity-import-estimate-warning">${warnings.map(H).join(' · ')}</div>` : ''}
    </details>`;
}

function buildCollectionDetailRows(item, priceEur) {
  const shipping = Number(item.shippingEur || 0);
  const deposit = Number(item.deposit || 0);
  const remaining = Math.max(0, priceEur + shipping - deposit);
  const sku = item.sku || item.code || '';
  return [
    productDetailRow('Заказ', item.orderNumber ? `#${item.orderNumber}` : ''),
    productDetailRow('Посылка', item.orderName),
    productDetailRow('Магазин', item.store),
    productDetailRow('Регион', item.region),
    productDetailRow('Производитель', item.manufacturer),
    productDetailRow('Дата выхода', item.releaseDate),
    productDetailRow('Статус', item.status),
    productDetailRow('Цена', item.priceOriginal ? `${item.priceOriginal} ${item.currency || ''} · ${eur(priceEur)}` : ''),
    productDetailRow('Доставка', shipping ? eur(shipping) : ''),
    productDetailRow('Предоплата', deposit ? eur(deposit) : ''),
    productDetailRow('Остаток', eur(remaining)),
    productDetailRow('Трек-номер', item.tracking),
    productDetailRow('Масштаб / тип', item.scale),
    productDetailRow('Метод доставки', item.shipMethod),
    productDetailRow('Дата заказа', item.orderDate),
    productDetailRow('Дата отправки', item.shipDate),
    productDetailRow('JAN / EAN', item.jan),
    productDetailRow('SKU / код', sku),
    productDetailRow('Старт предзаказа', item.preorderStart),
    productDetailRow('Окончание предзаказа', item.preorderEnd),
    productDetailRow('Статус релиза', item.releaseStatus && item.releaseStatus !== 'unknown' ? item.releaseStatus : ''),
    productDetailRow('Источник импорта', item.source),
    productDetailLink('Ссылка-источник', item.sourceUrl),
    productDetailLink('Страница товара', item.shopUrl, t('common.openStore')),
    item.tags?.length ? productDetailRow('Теги', `<span class="tags">${item.tags.map(tag => `<span class="tag">${H(tag)}</span>`).join('')}</span>`, true, 'product-detail-row-tags') : '',
    buildImportEstimateBlock(item)
  ].filter(Boolean).join('');
}

function buildWishlistDetailRows(item, priceEur) {
  const sku = item.sku || item.code || '';
  const priority = {
    high: t('wishlist.definitelyWant'),
    mid: t('wishlist.want'),
    low: t('wishlist.ifCheap')
  }[item.priority] || item.priority;
  return [
    productDetailRow(t('modal.priority'), priority),
    productDetailRow(t('modal.store'), item.store),
    productDetailRow(t('modal.manufacturer'), item.manufacturer),
    productDetailRow(t('wishlist.release'), item.releaseDate),
    productDetailRow(t('modal.price'), item.priceOriginal ? `${item.priceOriginal} ${item.currency || ''} · ${eur(priceEur)}` : ''),
    productDetailLink(t('modal.productPage'), item.shopUrl, t('common.openStore')),
    productDetailRow('Источник импорта', item.source),
    productDetailLink('Ссылка-источник', item.sourceUrl),
    productDetailRow('JAN / EAN', item.jan),
    productDetailRow('SKU / код', sku),
    productDetailRow('Старт предзаказа', item.preorderStart),
    productDetailRow('Окончание предзаказа', item.preorderEnd),
    productDetailRow('Статус релиза', item.releaseStatus && item.releaseStatus !== 'unknown' ? item.releaseStatus : ''),
    item.tags?.length ? productDetailRow(t('modal.tags'), `<span class="tags">${item.tags.map(tag => `<span class="tag">${H(tag)}</span>`).join('')}</span>`, true, 'product-detail-row-tags') : '',
    productDetailRow(t('modal.notes'), item.notes || item.note),
    buildImportEstimateBlock(item)
  ].filter(Boolean).join('');
}

function normalizeEntityType(type) {
  return type === 'wishlist' ? 'wishlist' : 'collection';
}

function getEntityByType(type, id) {
  const ownerType = normalizeEntityType(type);
  const list = ownerType === 'wishlist' ? (state.wishlist || []) : (state.items || []);
  return list.find(item => item.id === id) || null;
}

function ensureEntityLists(item) {
  if (!item) return { comments: [], tasks: [] };
  if (!Array.isArray(item.comments)) item.comments = [];
  if (!Array.isArray(item.tasks)) item.tasks = [];
  return { comments: item.comments, tasks: item.tasks };
}

function entityNoteId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function entityTaskTypeLabel(type) {
  return {
    payment: 'Оплата',
    shipping: 'Доставка',
    release: 'Релиз',
    check: 'Проверить',
    other: 'Другое'
  }[type] || 'Другое';
}

function formatEntityDate(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split('-');
    return `${month}.${year}`;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('ru');
}

function toDateInputValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseEntityReleaseDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const numeric = raw.match(/\b(20\d{2})[\/.-](0?[1-9]|1[0-2])(?:[\/.-](0?[1-9]|[12]\d|3[01]))?\b/);
  if (numeric) return new Date(Number(numeric[1]), Number(numeric[2]) - 1, Number(numeric[3] || 1));
  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) return date;
  const parsed = parseReleaseDate(raw);
  if (parsed?.year && parsed.month >= 0) return new Date(parsed.year, parsed.month, 1);
  return null;
}

function refreshEntityAfterNoteAction(type, id) {
  persist();
  render();
  if (appState.entityDetail?.id === id && appState.entityDetail?.type === normalizeEntityType(type)) {
    openEntityDetail(type, id);
  }
}

function renderEntityTasks(type, id, tasks = []) {
  const active = tasks.filter(task => !task.done);
  const done = tasks.filter(task => task.done);
  const renderTask = task => `<div class="entity-task${task.done ? ' done' : ''}">
    <label class="entity-task-check">
      <input type="checkbox" ${task.done ? 'checked' : ''} onchange="toggleEntityTask('${type}','${H(id)}','${H(task.id)}')">
      <span>
        <strong>${H(task.title || 'Без названия')}</strong>
        <em>${H(task.note || '')}</em>
      </span>
    </label>
    <div class="entity-task-meta">
      <span class="badge">${H(entityTaskTypeLabel(task.type))}</span>
      ${task.dueDate ? `<span>${H(formatEntityDate(task.dueDate))}</span>` : ''}
      ${task.done && task.completedAt ? `<span>Выполнено: ${H(formatEntityDate(task.completedAt))}</span>` : ''}
    </div>
    <div class="entity-task-actions">
      <button class="btn btn-sm" type="button" onclick="editEntityTask('${type}','${H(id)}','${H(task.id)}')">Редактировать</button>
      <button class="btn btn-sm btn-danger" type="button" onclick="deleteEntityTask('${type}','${H(id)}','${H(task.id)}')">Удалить</button>
    </div>
  </div>`;

  if (!active.length && !done.length) return '<div class="entity-note-empty">Задач пока нет</div>';

  return `${active.length ? active.map(renderTask).join('') : '<div class="entity-note-empty">Активных задач нет</div>'}
    ${done.length ? `<details class="entity-completed-tasks">
      <summary>Выполненные задачи <span>${done.length}</span></summary>
      <div class="entity-completed-task-list">${done.map(renderTask).join('')}</div>
    </details>` : ''}`;
}
function renderEntityComments(type, id, comments = []) {
  if (!comments.length) return '<div class="entity-note-empty">Комментариев пока нет</div>';
  return [...comments].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(comment => {
    const isSystem = comment.type === 'system';
    return `<div class="entity-comment${isSystem ? ' system' : ''}">
    <div class="entity-comment-text">${isSystem ? '<span class="entity-comment-badge">auto</span>' : ''}${H(comment.text || '')}</div>
    <div class="entity-comment-meta">${H(formatEntityDate(comment.createdAt))}</div>
    <div class="entity-comment-actions">
      ${isSystem ? '' : `<button class="btn btn-sm" type="button" onclick="editEntityComment('${type}','${H(id)}','${H(comment.id)}')">Редактировать</button>`}
      <button class="btn btn-sm btn-danger" type="button" onclick="deleteEntityComment('${type}','${H(id)}','${H(comment.id)}')">Удалить</button>
    </div>
  </div>`;
  }).join('');
}

function renderEntityNotesPanel(type, id, item) {
  const { tasks } = ensureEntityLists(item);
  return `<section class="entity-notes-panel">
    <div class="entity-notes-head">
      <strong>Задачи</strong>
      <span>${tasks.filter(task => !task.done).length} активных</span>
    </div>
    <div class="entity-tasks">
      <div class="entity-task-templates">
        <button class="btn btn-sm" type="button" onclick="fillEntityTaskTemplate('payment')">Оплатить</button>
        <button class="btn btn-sm" type="button" onclick="fillEntityTaskTemplate('release')">Проверить релиз</button>
        <button class="btn btn-sm" type="button" onclick="fillEntityTaskTemplate('shipping')">Проверить трек</button>
        <button class="btn btn-sm" type="button" onclick="fillEntityTaskTemplate('shop')">Написать магазину</button>
      </div>
      <div class="entity-note-form" id="entityTaskForm">
        <input id="entityTaskTitle" type="text" placeholder="Что нужно сделать?">
        <input id="entityTaskDueDate" type="date" placeholder="Срок выполнения">
        <div class="entity-task-date-presets">
          <button class="btn btn-sm" type="button" onclick="fillEntityTaskDueDate('today')">Сегодня</button>
          <button class="btn btn-sm" type="button" onclick="fillEntityTaskDueDate('week')">Через неделю</button>
          <button class="btn btn-sm" type="button" onclick="fillEntityTaskDueDate('thisMonth')">До конца месяца</button>
          <button class="btn btn-sm" type="button" onclick="fillEntityTaskDueDate('nextMonth')">До конца следующего</button>
          <button class="btn btn-sm" type="button" onclick="fillEntityTaskDueDate('beforeRelease')">За месяц до релиза</button>
        </div>
        <select id="entityTaskType">
          <option value="payment">Оплата</option>
          <option value="shipping">Доставка</option>
          <option value="release">Релиз</option>
          <option value="check">Проверить</option>
          <option value="other">Другое</option>
        </select>
        <textarea id="entityTaskNote" rows="2" placeholder="Заметка к задаче"></textarea>
        <div class="entity-task-form-actions">
          <button class="btn btn-sm" id="entityTaskSubmit" type="button" onclick="addEntityTask('${type}','${H(id)}')">Добавить задачу</button>
          <button class="btn btn-sm muted" id="entityTaskCancel" type="button" onclick="cancelEntityTaskEdit()" hidden>Отмена</button>
        </div>
      </div>
      <div class="entity-task-list">${renderEntityTasks(type, id, tasks)}</div>
    </div>
  </section>`;
}

function renderEntityCommentsPanel(type, id, item) {
  const { comments } = ensureEntityLists(item);
  return `<section class="entity-notes-panel">
    <div class="entity-comments">
      <h4>История / комментарии</h4>
      <div class="entity-note-form">
        <textarea id="entityCommentText" rows="3" placeholder="Что произошло?"></textarea>
        <button class="btn btn-sm" type="button" onclick="addEntityComment('${type}','${H(id)}')">Добавить комментарий</button>
      </div>
      <div class="entity-comment-list">${renderEntityComments(type, id, comments)}</div>
    </div>
  </section>`;
}

export function fillEntityTaskTemplate(template) {
  const title = document.getElementById('entityTaskTitle');
  const type = document.getElementById('entityTaskType');
  const note = document.getElementById('entityTaskNote');
  const presets = {
    payment: ['Оплатить заказ', 'payment', ''],
    release: ['Проверить релиз', 'release', ''],
    shipping: ['Проверить трек', 'shipping', ''],
    shop: ['Написать магазину', 'other', '']
  };
  const preset = presets[template] || presets.payment;
  if (title) title.value = preset[0];
  if (type) type.value = preset[1];
  if (note && preset[2]) note.value = preset[2];
}

export function fillEntityTaskDueDate(preset) {
  const input = document.getElementById('entityTaskDueDate');
  if (!input) return;
  const today = new Date();
  let date = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  if (preset === 'week') {
    date.setDate(date.getDate() + 7);
  } else if (preset === 'thisMonth') {
    date = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  } else if (preset === 'nextMonth') {
    date = new Date(today.getFullYear(), today.getMonth() + 2, 0);
  } else if (preset === 'beforeRelease') {
    const detail = appState.entityDetail;
    const item = detail ? getEntityByType(detail.type, detail.id) : null;
    const releaseDate = parseEntityReleaseDate(item?.releaseDate);
    if (!releaseDate) {
      toast('Не удалось определить дату релиза');
      return;
    }
    date = new Date(releaseDate.getFullYear(), releaseDate.getMonth() - 1, releaseDate.getDate());
  }

  input.value = toDateInputValue(date);
}

function setEntityTaskEditMode(task = null) {
  const form = document.getElementById('entityTaskForm');
  const submit = document.getElementById('entityTaskSubmit');
  const cancel = document.getElementById('entityTaskCancel');
  if (!form || !submit || !cancel) return;
  if (task) {
    form.dataset.editingTaskId = task.id;
    submit.textContent = 'Сохранить задачу';
    cancel.hidden = false;
  } else {
    delete form.dataset.editingTaskId;
    submit.textContent = 'Добавить задачу';
    cancel.hidden = true;
  }
}

function clearEntityTaskForm() {
  const title = document.getElementById('entityTaskTitle');
  const dueDate = document.getElementById('entityTaskDueDate');
  const type = document.getElementById('entityTaskType');
  const note = document.getElementById('entityTaskNote');
  if (title) title.value = '';
  if (dueDate) dueDate.value = '';
  if (type) type.value = 'other';
  if (note) note.value = '';
}

export function cancelEntityTaskEdit() {
  clearEntityTaskForm();
  setEntityTaskEditMode(null);
}

export function addEntityTask(type, id) {
  const item = getEntityByType(type, id);
  if (!item) return;
  const { tasks } = ensureEntityLists(item);
  const title = document.getElementById('entityTaskTitle')?.value.trim() || '';
  if (!title) return toast('Напиши, что нужно сделать');
  const form = document.getElementById('entityTaskForm');
  const editingTaskId = form?.dataset?.editingTaskId || '';
  const existingTask = editingTaskId ? tasks.find(task => task.id === editingTaskId) : null;
  const nextValues = {
    title,
    note: document.getElementById('entityTaskNote')?.value.trim() || '',
    type: document.getElementById('entityTaskType')?.value || 'other',
    dueDate: document.getElementById('entityTaskDueDate')?.value || ''
  };
  if (existingTask) {
    Object.assign(existingTask, nextValues, { updatedAt: Date.now() });
  } else {
    tasks.push({
      id: entityNoteId(),
      ...nextValues,
      done: false,
      createdAt: Date.now(),
      completedAt: null
    });
  }
  refreshEntityAfterNoteAction(type, id);
}

export function toggleEntityTask(type, id, taskId) {
  const item = getEntityByType(type, id);
  const task = item?.tasks?.find(task => task.id === taskId);
  if (!task) return;
  task.done = !task.done;
  task.completedAt = task.done ? Date.now() : null;
  const { comments } = ensureEntityLists(item);
  addSystemHistoryComment(
    comments,
    task.done
      ? `Задача выполнена: ${task.title || 'Без названия'}`
      : `Задача возвращена в активные: ${task.title || 'Без названия'}`
  );
  refreshEntityAfterNoteAction(type, id);
}

export function editEntityTask(type, id, taskId) {
  const item = getEntityByType(type, id);
  const task = item?.tasks?.find(task => task.id === taskId);
  if (!task) return;
  const title = document.getElementById('entityTaskTitle');
  const dueDate = document.getElementById('entityTaskDueDate');
  const taskType = document.getElementById('entityTaskType');
  const note = document.getElementById('entityTaskNote');
  if (title) title.value = task.title || '';
  if (dueDate) dueDate.value = task.dueDate || '';
  if (taskType) taskType.value = task.type || 'other';
  if (note) note.value = task.note || '';
  setEntityTaskEditMode(task);
  title?.focus();
}

export function deleteEntityTask(type, id, taskId) {
  const item = getEntityByType(type, id);
  if (!item?.tasks) return;
  if (!confirm('Удалить задачу?')) return;
  item.tasks = item.tasks.filter(task => task.id !== taskId);
  refreshEntityAfterNoteAction(type, id);
}

export function addEntityComment(type, id) {
  const item = getEntityByType(type, id);
  if (!item) return;
  const { comments } = ensureEntityLists(item);
  const text = document.getElementById('entityCommentText')?.value.trim() || '';
  if (!text) return toast('Напиши комментарий');
  comments.push({
    id: entityNoteId(),
    text,
    type: 'note',
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  refreshEntityAfterNoteAction(type, id);
}

export function editEntityComment(type, id, commentId) {
  const item = getEntityByType(type, id);
  const comment = item?.comments?.find(comment => comment.id === commentId);
  if (!comment) return;
  const text = prompt('Комментарий', comment.text || '');
  if (text == null) return;
  comment.text = text.trim();
  comment.updatedAt = Date.now();
  refreshEntityAfterNoteAction(type, id);
}

export function deleteEntityComment(type, id, commentId) {
  const item = getEntityByType(type, id);
  if (!item?.comments) return;
  if (!confirm('Удалить комментарий?')) return;
  item.comments = item.comments.filter(comment => comment.id !== commentId);
  refreshEntityAfterNoteAction(type, id);
}

function renderProductDetailThumbs(items, activeIndex, ownerId, onSelect, ownerType = 'collection') {
  const mediaFrame = document.getElementById('modalImg')?.parentElement;
  if (!mediaFrame) return;
  mediaFrame.classList.add('entity-detail-media', 'entity-detail-media-shell', 'product-detail-media');
  mediaFrame.setAttribute('ontouchstart', 'onEntityMediaTouchStart(event)');
  mediaFrame.setAttribute('ontouchend', 'onEntityMediaTouchEnd(event)');
  let lightboxBtn = document.getElementById('productDetailLightboxBtn');
  if (!lightboxBtn) {
    lightboxBtn = document.createElement('button');
    lightboxBtn.id = 'productDetailLightboxBtn';
    lightboxBtn.type = 'button';
    lightboxBtn.className = 'icon-action-btn media-open-btn product-detail-lightbox-btn';
    lightboxBtn.textContent = '⛶';
    mediaFrame.appendChild(lightboxBtn);
  }
  lightboxBtn.onclick = event => {
    event.stopPropagation();
    const entries = appState.productDetailMedia || items;
    const index = Math.max(0, Math.min(entries.length - 1, Number(appState.productDetailMediaIndex ?? activeIndex) || 0));
    const entry = entries[index];
    const sourceVideo = mediaFrame.querySelector('video[data-app-video="true"]') || mediaFrame.querySelector('video');
    const videoState = captureAppVideoState(sourceVideo);
    if (entry?.url) openLightbox(entry.url, { items: entries, index, ownerId, ownerType, videoState });
  };
  lightboxBtn.style.display = items.length ? 'inline-flex' : 'none';
  let thumbs = document.getElementById('productDetailThumbs');
  if (!thumbs) {
    thumbs = document.createElement('div');
    thumbs.id = 'productDetailThumbs';
    thumbs.className = 'entity-detail-thumbs product-detail-thumbs';
    mediaFrame.insertAdjacentElement('afterend', thumbs);
  }
  thumbs.innerHTML = items.length > 1 ? items.map((entry, idx) => (
    `<button type="button" class="entity-detail-thumb${idx === activeIndex ? ' active' : ''}" data-media-index="${idx}">
      ${entry.kind === 'video' || entry.kind === 'animation' ? '<span>▶</span>' : `<img src="${H(entry.url)}" alt="">`}
    </button>`
  )).join('') : '';
  thumbs.querySelectorAll('[data-media-index]').forEach(button => {
    button.onclick = () => onSelect(Number(button.dataset.mediaIndex || 0));
  });
}

function unbindEntityDetailMobileCollapse() {
  const modal = document.querySelector('#modalOverlay .entity-detail-modal');
  const scroller = modal;
  if (scroller && appState.entityDetailCollapseScrollHandler) {
    scroller.removeEventListener('scroll', appState.entityDetailCollapseScrollHandler);
  }
  modal?.classList.remove('is-media-collapsed');
  appState.entityDetailCollapseScrollHandler = null;
}

function bindEntityDetailMobileCollapse() {
  const modal = document.querySelector('#modalOverlay .entity-detail-modal');
  const scroller = modal;
  if (!modal || !scroller) return;

  if (appState.entityDetailCollapseScrollHandler) {
    scroller.removeEventListener('scroll', appState.entityDetailCollapseScrollHandler);
  }

  const update = () => {
    if (!window.matchMedia('(max-width: 768px)').matches) {
      modal.classList.remove('is-media-collapsed');
      return;
    }
    modal.classList.toggle('is-media-collapsed', scroller.scrollTop > 80);
  };

  appState.entityDetailCollapseScrollHandler = update;
  scroller.addEventListener('scroll', update, { passive: true });
  requestAnimationFrame(update);
}

export function openProductDetail(type, id) {
  return openEntityDetail(type, id);
}

export function entityDetailNav(direction) {
  const entries = appState.entityDetail?.media || [];
  if (entries.length <= 1) return;
  if (shouldIgnoreDuplicateNav(lastProductDetailNavAt)) return;
  lastProductDetailNavAt = performance.now();
  const current = Number(appState.entityDetail?.mediaIndex || 0);
  const next = (current + direction + entries.length) % entries.length;
  appState.entityDetail.mediaIndex = next;
  appState.productDetailMediaIndex = next;
  appState.entityDetailUpdate?.();
}

export function onEntityMediaTouchStart(event) {
  if (isEntitySwipeBlocked(event)) {
    appState.entityDetailTouchStartX = null;
    appState.entityDetailTouchStartY = null;
    return;
  }
  const touch = event.touches?.[0];
  if (!touch) return;
  appState.entityDetailTouchStartX = touch.clientX;
  appState.entityDetailTouchStartY = touch.clientY;
}

export function onEntityMediaTouchEnd(event) {
  if (isEntitySwipeBlocked(event)) {
    appState.entityDetailTouchStartX = null;
    appState.entityDetailTouchStartY = null;
    return;
  }
  const touch = event.changedTouches?.[0];
  if (!touch || appState.entityDetailTouchStartX == null) return;
  const dx = touch.clientX - appState.entityDetailTouchStartX;
  const dy = touch.clientY - appState.entityDetailTouchStartY;
  appState.entityDetailTouchStartX = null;
  appState.entityDetailTouchStartY = null;
  if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
  appState.entityDetailSuppressClick = true;
  setTimeout(() => { appState.entityDetailSuppressClick = false; }, 250);
  entityDetailNav(dx < 0 ? 1 : -1);
}

export function openEntityDetail(type, id) {
  pauseAllVideosExcept();
  const ownerType = type === 'wishlist' ? 'wishlist' : 'collection';
  const source = ownerType === 'wishlist' ? (state.wishlist || []) : (state.items || []);
  const rawItem = source.find(item => item.id === id);
  if (!rawItem) {
    console.warn('[openEntityDetail] item not found', { type: ownerType, id });
    toast?.(t('toast.notFound') || 'Item not found');
    return;
  }
  const item = normalizeProductMeta(rawItem);
  appState.modalItemId = id;
  const priceEur = toEur(item.priceOriginal || 0, item.currency || 'EUR');
  const overlay = document.getElementById('modalOverlay');
  overlay?.classList.add('entity-detail-overlay', 'product-detail-overlay');
  overlay?.classList.toggle('wishlist-detail-overlay', ownerType === 'wishlist');
  const modalBox = document.querySelector('#modalOverlay .modal-box');
  modalBox?.classList.add('entity-detail-modal', 'product-detail-modal');
  if (modalBox) modalBox.scrollTop = 0;
  let backBtn = document.getElementById('entityDetailBack');
  if (!backBtn && modalBox) {
    backBtn = document.createElement('button');
    backBtn.id = 'entityDetailBack';
    backBtn.type = 'button';
    backBtn.className = 'icon-action-btn entity-detail-back';
    backBtn.dataset.noSwipe = 'true';
    backBtn.setAttribute('aria-label', t('common.close'));
    backBtn.textContent = '←';
    backBtn.onclick = event => {
      event.stopPropagation();
      closeEntityDetail();
    };
    modalBox.prepend(backBtn);
  }
  if (backBtn) backBtn.style.display = 'inline-flex';
  const modalClose = document.getElementById('modalClose');
  if (modalClose) modalClose.style.display = 'none';
  document.querySelector('#modalOverlay .modal-actions')?.classList.add('entity-detail-actions');
  document.querySelector('#modalOverlay .modal-body')?.classList.add('entity-detail-info', 'product-detail-info');
  document.getElementById('modalName')?.classList.add('entity-detail-title', 'product-detail-title');
  document.getElementById('modalName').textContent = item.name || '—';
  document.getElementById('modalRows').classList.add('entity-detail-rows', 'product-detail-meta-grid');
  document.getElementById('modalRows').innerHTML = ownerType === 'wishlist'
    ? buildWishlistDetailRows(item, priceEur)
    : buildCollectionDetailRows(item, priceEur);
  let notesPanel = document.getElementById('entityNotesPanel');
  if (!notesPanel) {
    notesPanel = document.createElement('div');
    notesPanel.id = 'entityNotesPanel';
    notesPanel.style.gridColumn = '2';
    notesPanel.style.gridRow = '4';
    notesPanel.style.minWidth = '0';
    modalBox.appendChild(notesPanel);
  }
  notesPanel.innerHTML = renderEntityNotesPanel(ownerType, id, rawItem);

  let commentsPanel = document.getElementById('entityCommentsPanel');
  if (!commentsPanel) {
    commentsPanel = document.createElement('div');
    commentsPanel.id = 'entityCommentsPanel';
    commentsPanel.style.gridColumn = '1';
    commentsPanel.style.gridRow = '4';
    commentsPanel.style.minWidth = '0';
    modalBox.appendChild(commentsPanel);
  }
  commentsPanel.innerHTML = renderEntityCommentsPanel(ownerType, id, rawItem);

  const imgs = mediaEntriesOf(item);
  appState.entityDetail = { type: ownerType, id, media: imgs, mediaIndex: 0 };
  appState.productDetailMedia = imgs;
  appState.productDetailMediaIndex = 0;
  window.currentModalImages = imgs.map(img => img.url);
  window.currentModalMedia = imgs;
  function updateModalImg() {
    const detail = appState.entityDetail || {};
    const entries = detail.media || appState.productDetailMedia || imgs;
    const imgIdx = Math.max(0, Math.min(entries.length - 1, Number(detail.mediaIndex ?? appState.productDetailMediaIndex) || 0));
    if (appState.entityDetail) appState.entityDetail.mediaIndex = imgIdx;
    appState.productDetailMediaIndex = imgIdx;
    setModalMedia(entries[imgIdx]?.media || '', item?.name || '', {
      items: entries,
      index: imgIdx,
      ownerId: id,
      ownerType
    });
    document.getElementById('modalImgCounter').textContent = entries.length > 1 ? `${imgIdx + 1} / ${entries.length}` : '';
    document.getElementById('modalImgPrev').style.display = entries.length > 1 ? 'flex' : 'none'; document.getElementById('modalImgNext').style.display = entries.length > 1 ? 'flex' : 'none';
    renderProductDetailThumbs(entries, imgIdx, id, nextIdx => {
      if (appState.entityDetail) appState.entityDetail.mediaIndex = nextIdx;
      appState.productDetailMediaIndex = nextIdx;
      updateModalImg();
    }, ownerType);
  }
  appState.entityDetailUpdate = updateModalImg;

  const receiveBtn = document.getElementById('modalReceive');
  if (ownerType === 'collection' && item.status !== 'Получено') {
    receiveBtn.style.display = 'flex'; receiveBtn.onclick = () => { state.items.find(i => i.id === id).status = 'Получено'; persist(); render(); renderShelf(); toast(t('toast.itemReceived')); closeEntityDetail(); };
  } else receiveBtn.style.display = 'none';
  const moveBtn = document.getElementById('modalMove');
  moveBtn.style.display = ownerType === 'wishlist' ? 'flex' : 'none';
  moveBtn.onclick = ownerType === 'wishlist' ? () => moveWishToCollection(id) : null;
  document.getElementById('modalImgPrev').onclick = () => entityDetailNav(-1);
  document.getElementById('modalImgNext').onclick = () => entityDetailNav(1);
  updateModalImg();
  bindEntityDetailMobileCollapse();
  document.getElementById('modalEdit').onclick = () => { closeEntityDetail(); ownerType === 'wishlist' ? editWish(id) : editItem(id); };
  document.getElementById('modalDelete').onclick = () => {
    if (ownerType === 'wishlist') {
      deleteWish(id);
      if (!(state.wishlist || []).some(item => item.id === id)) closeEntityDetail();
      return;
    }
    deleteItem(id);
    if (!(state.items || []).some(item => item.id === id)) closeEntityDetail();
  };
  overlay.style.display = 'flex';
  pushUiHistory('modal');
}

export function openModal(id) { return openEntityDetail('collection', id); }

export function closeEntityDetail() {
  unbindEntityDetailMobileCollapse();
  stopMedia(document.getElementById('modalOverlay'), { resetSrc: true });
  document.getElementById('modalOverlay').style.display = 'none'; appState.modalItemId = null;
  document.getElementById('modalOverlay')?.classList.remove('product-detail-overlay');
  document.getElementById('modalOverlay')?.classList.remove('wishlist-detail-overlay');
  document.getElementById('modalOverlay')?.classList.remove('entity-detail-overlay');
  document.querySelector('#modalOverlay .modal-box')?.classList.remove('entity-detail-modal', 'product-detail-modal', 'wishlist-detail-modal');
  document.querySelector('#modalOverlay .modal-actions')?.classList.remove('entity-detail-actions');
  document.querySelector('#modalOverlay .modal-body')?.classList.remove('entity-detail-info', 'product-detail-info', 'wishlist-detail-info');
  document.getElementById('modalName')?.classList.remove('entity-detail-title', 'product-detail-title');
  document.getElementById('modalRows')?.classList.remove('entity-detail-rows', 'product-detail-meta-grid');
  document.getElementById('modalImg')?.parentElement?.classList.remove('entity-detail-media', 'entity-detail-media-shell', 'product-detail-media', 'wishlist-detail-media');
  document.getElementById('productDetailLightboxBtn')?.remove();
  document.getElementById('productDetailThumbs')?.remove();
  document.getElementById('entityNotesPanel')?.remove();
  document.getElementById('entityCommentsPanel')?.remove();
  document.getElementById('entityDetailBack')?.remove();
  window.currentModalMedia = [];
  appState.entityDetail = null;
  appState.entityDetailUpdate = null;
  appState.entityDetailTouchStartX = null;
  appState.entityDetailTouchStartY = null;
  appState.entityDetailSuppressClick = false;
  appState.productDetailMedia = [];
  appState.productDetailMediaIndex = 0;
  if (appState.historyLayer === 'modal') appState.historyLayer = null;
  document.getElementById('modalImgPrev').onclick = null; document.getElementById('modalImgNext').onclick = null; document.getElementById('modalImgCounter').textContent = '';
  document.getElementById('modalImgPrev').style.display = 'none'; document.getElementById('modalImgNext').style.display = 'none';
  document.getElementById('modalMove').onclick = null;
  document.getElementById('modalMove').style.display = 'none';
  document.getElementById('modalReceive').onclick = null;
  document.getElementById('modalReceive').style.display = 'none';
  const modalClose = document.getElementById('modalClose');
  if (modalClose) modalClose.style.display = '';
}

export function closeModal() { return closeEntityDetail(); }

export function renderShelf() {
  const sort = document.getElementById('shelfSort')?.value || 'newest';
  const received = [];
  getOrders().forEach(o => {
    const c = calcOrder(o);
    const taxPerItem = (Number(c.alv) + Number(c.customs)) / o.items.length;
    o.items.forEach(i => {
      if (i.status === 'Получено') {
        const itemEur = toEur(i.priceOriginal || 0, i.currency || 'EUR');
        const totalPaid = +(itemEur + Number(i.shippingEur || 0) + taxPerItem).toFixed(2);
        received.push({ ...i, totalPaid, orderName: o.orderName });
      }
    });
  });

  let items = received.filter(i => matchesGlobalSearch(i));
  items.sort((a, b) => {
    if (sort === 'newest') return (b.createdAt || 0) - (a.createdAt || 0);
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'price-desc') return b.totalPaid - a.totalPaid;
    if (sort === 'price-asc') return a.totalPaid - b.totalPaid;
    return 0;
  });

  const totalSpent = received.reduce((s, i) => s + i.totalPaid, 0);
  const makerTop = Object.entries(received.reduce((acc, i) => { const key = i.manufacturer || '—'; acc[key] = (acc[key] || 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1])[0];
  const shelfHero = document.getElementById('shelfHero');
  if (shelfHero) {
    shelfHero.innerHTML = `
      <div class="shelf-hero-cell"><span>На полке</span><strong>${received.length}</strong><small>полученных фигурок</small></div>
      <div class="shelf-hero-cell"><span>Стоимость</span><strong>${eur(totalSpent)}</strong><small>с доставкой и налогами</small></div>
      <div class="shelf-hero-cell"><span>Топ производитель</span><strong>${H(makerTop?.[0] || '—')}</strong><small>${makerTop ? `${makerTop[1]} шт.` : 'пока нет данных'}</small></div>
      <div class="shelf-hero-cell"><span>Показано</span><strong>${items.length}</strong><small>по текущему фильтру</small></div>`;
  }
  const stats = document.getElementById('shelfStats');
  if (stats) stats.innerHTML = `<span style="color:var(--green);font-weight:700;">${received.length} фигурок</span> · итого <span style="color:var(--green);font-weight:700;">${eur(totalSpent)}</span>`;
  const grid = document.getElementById('shelfGrid');
  if (!items.length) { grid.innerHTML = `<div style="color:var(--muted);text-align:center;padding:60px 0;grid-column:1/-1;">${t('shelf.empty')}</div>`; return; }
  grid.innerHTML = items.map((item, idx) => {
    const media = mediaEntriesOf(item);
    const first = media[0];
    const mediaTag = first ? renderMediaTag(first.media, 'gallery-media', item.name)
      .replace(/class="([^"]*gallery-media[^"]*)"/, `class="$1" data-media-url="${H(first.url)}"`) : '';
    const mediaHtml = !first
      ? `<div class="gallery-placeholder">🖼️</div>`
      : first.kind === 'image'
        ? `<img class="zoomable gallery-media" data-media-url="${H(first.url)}" src="${H(first.url)}" loading="lazy" alt="${H(item.name)}" onerror="this.style.opacity=.1" onclick="event.stopPropagation();openItemLightbox('collection','${H(item.id)}','${H(first.url)}',0)">`
        : `<div class="gallery-video-wrap" data-no-card-open="true">
            ${mediaTag}
            <button class="icon-action-btn media-open-btn" type="button" title="${t('common.open')}" onclick="event.stopPropagation();openItemLightbox('collection','${H(item.id)}','${H(first.url)}',0,this.closest('.gallery-video-wrap')?.querySelector('video'))">⛶</button>
          </div>`;
    return `
    <div class="gallery-card animate-in" style="animation-delay:${idx * 30}ms" onclick="if(isCardOpenBlocked(event))return;openEntityDetail('collection','${H(item.id)}')">
      <div class="gallery-img-wrap">
        ${mediaHtml}
        <div class="gallery-overlay"><div class="gallery-name">${H(item.name)}</div><div class="gallery-price">${eur(item.totalPaid)}</div></div>
      </div>
    </div>`;
  }).join('');
  ensurePreviewVideoControls(grid);
}

export function openLightbox(src, context = 'gallery') {
  if (!src) return;
  pauseAllVideosExcept();

  const overlay = document.getElementById('lightboxOverlay');
  const items = getLightboxItems(src, context);
  const srcUrl = String(getMediaUrl(src) || src || '');
  const hasContextIndex = context && typeof context === 'object' && context.index !== null
    && typeof context.index !== 'undefined' && Number.isFinite(Number(context.index));
  const requestedIndex = hasContextIndex
    ? Number(context.index)
    : items.findIndex(item => item.url === srcUrl);
  const index = Math.max(0, Math.min(items.length - 1, requestedIndex < 0 ? 0 : requestedIndex));

  appState.lightboxItems = items;
  appState.lightboxPhotos = items.map(item => item.url);
  appState.lightboxIndex = index;
  appState.lightboxCurrentUrl = items[index]?.url || srcUrl;
  appState.lightboxVideoState = context && typeof context === 'object' ? (context.videoState || null) : null;

  setLightboxMedia(items[index]?.media || items[index]?.url || src, '', {
    videoState: appState.lightboxVideoState
  });

  overlay.style.display = 'flex';
  pushUiHistory('lightbox');
  document.removeEventListener('keydown', lightboxKeyHandler);
  document.addEventListener('keydown', lightboxKeyHandler);
  updateLightboxControls();
}

export function showLightboxPhoto() {
  const items = appState.lightboxItems || [];
  const current = items[appState.lightboxIndex];
  appState.lightboxVideoState = null;
  setLightboxMedia(current?.media || current?.url || appState.lightboxPhotos?.[appState.lightboxIndex]);
  appState.lightboxCurrentUrl = current?.url || appState.lightboxCurrentUrl || '';
  updateLightboxControls();
}

export function lightboxNav(dir) {
  if (shouldIgnoreDuplicateNav(lastLightboxNavAt)) return;
  lastLightboxNavAt = performance.now();
  const items = appState.lightboxItems || [];
  if (items.length <= 1) return;

  appState.lightboxIndex =
    (appState.lightboxIndex + dir + items.length) % items.length;

  const current = items[appState.lightboxIndex];
  appState.lightboxCurrentUrl = current?.url || '';
  appState.lightboxVideoState = null;
  pauseAllVideosExcept();
  setLightboxMedia(current?.media || current?.url || '');
  updateLightboxControls();
}

export function lightboxKeyHandler(e) { if (e.key === 'ArrowRight') lightboxNav(1); if (e.key === 'ArrowLeft') lightboxNav(-1); if (e.key === 'Escape') closeLightbox(); }
export function closeLightbox() {
  const overlay = document.getElementById('lightboxOverlay');
  pauseAllVideosExcept();
  stopMedia(overlay, { resetSrc: true });
  if (overlay) overlay.style.display = 'none';
  if (appState.historyLayer === 'lightbox') appState.historyLayer = null;
  appState.lightboxCurrentUrl = '';
  appState.lightboxGestureLocked = false;
  appState.lightboxTouchStartX = appState.lightboxTouchStartY = null;
  document.removeEventListener('keydown', lightboxKeyHandler);
}
export function initLightboxTouch() {
  const overlay = document.getElementById('lightboxOverlay'); if (!overlay || appState.lightboxTouchInitialized) return;
  appState.lightboxTouchInitialized = true;
  const isInteractiveLightboxTarget = target => Boolean(target?.closest?.(
    'video, audio, .app-video-wrap, .app-video-controls, .app-video-play, .app-video-mute, button, a, input, textarea, select, [data-no-swipe], [data-no-lightbox-close]'
  ));
  overlay.addEventListener('touchstart', e => {
    appState.lightboxGestureLocked = isInteractiveLightboxTarget(e.target);
    if (appState.lightboxGestureLocked) {
      appState.lightboxTouchStartX = appState.lightboxTouchStartY = null;
      return;
    }
    if (!e.touches.length) return; appState.lightboxTouchStartX = e.touches[0].clientX; appState.lightboxTouchStartY = e.touches[0].clientY;
  }, { passive: true });
  overlay.addEventListener('touchend', e => {
    if (appState.lightboxGestureLocked) {
      appState.lightboxGestureLocked = false;
      appState.lightboxTouchStartX = appState.lightboxTouchStartY = null;
      return;
    }
    if (isInteractiveLightboxTarget(e.target)) {
      appState.lightboxTouchStartX = appState.lightboxTouchStartY = null;
      return;
    }
    if (appState.lightboxTouchStartX === null) return; if (!e.changedTouches.length) return;
    const dx = e.changedTouches[0].clientX - appState.lightboxTouchStartX; const dy = e.changedTouches[0].clientY - appState.lightboxTouchStartY;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) { appState.lightboxTouchStartX = appState.lightboxTouchStartY = null; return; }
    if (dx < 0) { lightboxNav(1); } else { lightboxNav(-1); }
    appState.lightboxTouchStartX = appState.lightboxTouchStartY = null;
  }, { passive: true });
}

const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTH_ROOTS = ['январ', 'феврал', 'март', 'апрел', 'май', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
export function changeCalendarYear(delta) { appState.currentCalendarYear += delta; renderCalendar(); }
export function parseReleaseDate(dateStr) {
  if (!dateStr) return null; const d = dateStr.toLowerCase(); const mIdx = MONTH_ROOTS.findIndex(m => d.includes(m)); const yearMatch = d.match(/\d{4}/); const year = yearMatch ? parseInt(yearMatch[0]) : null;
  if (mIdx !== -1 && year) return { month: mIdx, year: year }; return null;
}
export function renderCalendar() {
  document.getElementById('calendarYearDisplay').textContent = appState.currentCalendarYear;
  const now = new Date(); const currentMonth = now.getMonth(); const currentYear = now.getFullYear();
  const allItems = [...state.items.map(i => ({ ...i, _type: 'collection' })), ...(state.wishlist || []).map(w => ({ ...w, _type: 'wishlist' }))];
  const yearItems = allItems.filter(item => { const parsed = parseReleaseDate(item.releaseDate); return parsed && parsed.year === appState.currentCalendarYear; });
  let html = '';
  for (let m = 0; m < 12; m++) {
    const itemsInMonth = yearItems.filter(item => parseReleaseDate(item.releaseDate).month === m);
    let classes = 'calendar-month';
    if (appState.currentCalendarYear === currentYear && m === currentMonth) classes += ' current';
    else if (appState.currentCalendarYear < currentYear || (appState.currentCalendarYear === currentYear && m < currentMonth)) classes += ' past';
    html += `<div class="${classes}"><div class="month-name"><span>${MONTH_NAMES[m]}</span><span style="font-size:12px;color:var(--muted);font-weight:normal;">${itemsInMonth.length ? itemsInMonth.length + ' шт.' : ''}</span></div><div class="month-items">${itemsInMonth.length ? itemsInMonth.map(item => `<div class="calendar-item" onclick="if(isCardOpenBlocked(event))return;openEntityDetail('${item._type === 'collection' ? 'collection' : 'wishlist'}','${H(item.id)}')">${item.imageUrl
      ? renderClickableMedia(item.imageUrl, 'figure-img', item.name, item.id)
      : `<div class="figure-img" style="display:flex;align-items:center;justify-content:center;font-size:36px;">📦</div>`}<div class="calendar-item-info"><div class="calendar-item-name">${H(item.name)}</div><div class="calendar-item-type">${item._type === 'collection' ? '📦 В коллекции/Предзаказ' : '⭐ Вишлист'}</div></div></div>`).join('') : '<div style="font-size:12px;color:var(--faint);text-align:center;padding:14px 0;">Нет релизов</div>'}</div></div>`;
  }
  document.getElementById('calendarGrid').innerHTML = html;
}

function waitForTampermonkeyForm(ms = 50) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function installTampermonkeyScript() {
  window.open(TAMPERMONKEY_SCRIPT_URL, '_blank', 'noopener,noreferrer');
}

export async function getTampermonkeyScript() {
  const urls = [TAMPERMONKEY_SCRIPT_LOCAL_URL, TAMPERMONKEY_SCRIPT_URL, TAMPERMONKEY_SCRIPT_RAW_URL];

  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) return await response.text();
    } catch (err) {
      console.warn('[Tampermonkey install] fetch failed:', url, err);
    }
  }

  return TAMPERMONKEY_SCRIPT_FALLBACK;
}

export async function downloadTampermonkeyScript() {
  const code = await getTampermonkeyScript();
  const blob = new Blob([code], { type: 'application/javascript;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = 'figure-tracker-universal-importer.user.js';
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

export async function copyTampermonkeyScript() {
  try {
    const code = await getTampermonkeyScript();
    await navigator.clipboard.writeText(code);
    toast('Код userscript скопирован');
  } catch (err) {
    console.warn('[Tampermonkey install] copy failed:', err);
    toast('Не удалось скопировать код userscript');
  }
}

async function ensureTampermonkeyFormOpen(target = 'main') {
  const fieldId = target === 'wish' ? 'wName' : 'fName';
  const overlayId = target === 'wish' ? 'wishFormOverlay' : 'formOverlay';
  const overlay = document.getElementById(overlayId);
  const isOpen = !overlay || overlay.style.display !== 'none';
  if (document.getElementById(fieldId) && isOpen) return true;

  const opener = target === 'wish' ? window.openWishForm : window.openForm;
  if (typeof opener === 'function') {
    opener();
    await waitForTampermonkeyForm();
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

async function grabFromTampermonkeyLegacy(target = 'main') {
  try {
    const text = await navigator.clipboard.readText();

    if (!text || !text.trim()) {
      toast?.('\u0411\u0443\u0444\u0435\u0440 \u043E\u0431\u043C\u0435\u043D\u0430 \u043F\u0443\u0441\u0442');
      return null;
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      toast?.('\u0412 \u0431\u0443\u0444\u0435\u0440\u0435 \u043D\u0435\u0442 JSON \u0434\u0430\u043D\u043D\u044B\u0445 \u0442\u043E\u0432\u0430\u0440\u0430');
      return null;
    }

    const item = Array.isArray(data.items) ? data.items[0] : data;

    if (!item || typeof item !== 'object') {
      toast?.('\u0424\u043E\u0440\u043C\u0430\u0442 \u0434\u0430\u043D\u043D\u044B\u0445 \u0442\u043E\u0432\u0430\u0440\u0430 \u043D\u0435 \u0440\u0430\u0441\u043F\u043E\u0437\u043D\u0430\u043D');
      return null;
    }

    const name = item.name || '';
    const price = item.price || '';
    const maker = item.maker || item.brand || '';
    const store = item.store || item.shop || data.sourceName || '';
    const img = item.imageUrl || item.img || '';
    const url = item.sourceUrl || item.url || '';
    const month = item.month || '';
    const year = item.year || '';

    await ensureTampermonkeyFormOpen(target);

    if (target === 'wish') {
      const didFill = [
        setValueIfExists('wName', name),
        setValueIfExists('wStore', store),
        setValueIfExists('wPrice', price),
        setValueIfExists('wMaker', maker),
        setValueIfExists('wImg', img),
        setValueIfExists('wDate', item.releaseDate || [month, year].filter(Boolean).join(' ')),
        setValueIfExists('wShopUrl', url)
      ].some(Boolean);
      if (!didFill) {
        toast?.('\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u043E\u0442\u043A\u0440\u043E\u0439 \u0444\u043E\u0440\u043C\u0443 wishlist');
        return null;
      }
      toast?.('\u0414\u0430\u043D\u043D\u044B\u0435 \u0432\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u044B \u0432 wishlist');
      return item;
    }

    const didFill = [
      setValueIfExists('fName', name),
      setValueIfExists('fStore', store),
      setValueIfExists('fPrice', price),
      setValueIfExists('fMaker', maker),
      setValueIfExists('fImg', img),
      setValueIfExists('fDateMonth', month),
      setValueIfExists('fDateYear', year),
      setValueIfExists('fShopUrl', url)
    ].some(Boolean);

    if (!didFill) {
      toast?.('\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u043E\u0442\u043A\u0440\u043E\u0439 \u0444\u043E\u0440\u043C\u0443 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u044F \u0437\u0430\u043A\u0430\u0437\u0430');
      return null;
    }

    if (typeof updateEurPreview === 'function') {
      updateEurPreview();
    }

    toast?.('\u0414\u0430\u043D\u043D\u044B\u0435 \u0442\u043E\u0432\u0430\u0440\u0430 \u0432\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u044B');
    return item;
  } catch (err) {
    console.error('[grabFromTampermonkeyLegacy]', err);

    if (err?.name === 'NotAllowedError') {
      toast?.('\u0411\u0440\u0430\u0443\u0437\u0435\u0440 \u043D\u0435 \u0434\u0430\u043B \u0434\u043E\u0441\u0442\u0443\u043F \u043A \u0431\u0443\u0444\u0435\u0440\u0443 \u043E\u0431\u043C\u0435\u043D\u0430');
      return null;
    }

    toast?.('\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0432\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0435 \u0438\u0437 \u0431\u0443\u0444\u0435\u0440\u0430');
    return null;
  }
}

export async function grabFromTampermonkey(target = 'main') {
  try {
    const result = await grabFromClipboard(target, {
      toast,
      updateEurPreview
    });
    if (result) return result;
    console.warn('[grabFromTampermonkey] new importer returned no item, trying legacy fallback');
    return await grabFromTampermonkeyLegacy(target);
  } catch (err) {
    console.warn('[grabFromTampermonkey] new importer failed, trying legacy fallback', err);
    return await grabFromTampermonkeyLegacy(target);
  }
}

export function autofillFromLink(target = 'main') {
  return grabFromTampermonkey(target);
}

export async function debugTampermonkeyImport(target = 'main') {
  console.log('[Tampermonkey debug] target:', target);
  console.log('[Tampermonkey debug] typeof window.grabFromTampermonkey:', typeof window.grabFromTampermonkey);
  try {
    const text = await navigator.clipboard.readText();
    console.log('[Tampermonkey debug] clipboard text:', text);
  } catch (err) {
    console.warn('[Tampermonkey debug] clipboard read failed:', err);
  }
  return grabFromTampermonkey(target);
}


export function toggleFilters(force) {
  const sidebar = document.querySelector('.sidebar');
  const btn = document.getElementById('filterToggle');
  if (!sidebar) return;

  const shouldOpen = typeof force === 'boolean' ? force : !sidebar.classList.contains('filters-open');
  sidebar.classList.toggle('filters-open', shouldOpen);

  if (btn) {
    btn.setAttribute('aria-expanded', String(shouldOpen));
    btn.textContent = shouldOpen ? '✕ Закрыть' : '☰ Фильтры';
  }
}

export function closeFilters() {
  toggleFilters(false);
}

export function hideStandalonePanes() {
  ['galleryPane', 'calendarPane', 'analyticsPane', 'shelfPane', 'settingsPane'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

export function switchTab(tab = 'collection') {
  const previousTab = appState.currentTab;
  if (STANDALONE_TABS.has(tab) && previousTab !== tab && !appState.standaloneTabHistory) {
    pushUiHistory('tab');
    appState.standaloneTabHistory = true;
  }
  if (tab === 'collection') appState.standaloneTabHistory = false;
  if (previousTab === 'gallery' && tab !== 'gallery') {
    cleanupGalleryAutoSlider();
    stopMedia(document.getElementById('galleryPane'), { resetSrc: false });
  }
  stopMedia(document.getElementById('modalOverlay'), { resetSrc: true });
  stopMedia(document.getElementById('lightboxOverlay'), { resetSrc: true });
  appState.currentTab = tab;
  closeFilters();

  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });

  const sidebar = document.querySelector('.sidebar');
  const detailPane = document.getElementById('detailPane');
  const wishlistPane = document.getElementById('wishlistPane');
  const mainPane = document.querySelector('.main');

  hideStandalonePanes();
  if (wishlistPane) wishlistPane.style.display = 'none';

  if (tab === 'collection') {
    if (mainPane) mainPane.style.display = 'grid';
    if (sidebar) sidebar.style.display = 'flex';
    if (detailPane) detailPane.style.display = 'block';
    syncMobileCollectionView();
    render();
    checkReleaseReminders();
    updateBanner(false);
    return;
  }

  if (sidebar) {
    sidebar.style.display = 'none';
    sidebar.classList.remove('hidden-mobile', 'filters-open');
  }
  if (detailPane) {
    detailPane.style.display = 'none';
    detailPane.classList.remove('hidden-mobile');
  }
  updateBanner(false);

  if (tab === 'wishlist') {
    if (mainPane) {
      mainPane.style.display = 'grid';
      mainPane.classList.remove('mobile-list-mode', 'mobile-detail-mode');
    }
    if (wishlistPane) wishlistPane.style.display = 'block';
    renderWishlist();
    return;
  }

  if (mainPane) {
    mainPane.style.display = 'none';
    mainPane.classList.remove('mobile-list-mode', 'mobile-detail-mode');
  }
  const pane = document.getElementById(`${tab}Pane`);
  if (pane) pane.style.display = 'block';

  if (tab === 'gallery') renderGallery();
  if (tab === 'calendar') renderCalendar();
  if (tab === 'analytics') renderAnalytics();
  if (tab === 'shelf') renderShelf();
  if (tab === 'settings') loadSettings();
}

export function goHome() {
  appState.selectedOrder = null;
  switchTab('collection');
}

export function render() {
  ensureSearchIndexes();
  syncGlobalTags();
  syncGlobalSearchInput();
  applyUiDensity();
  const orders = getOrders();
  const stores = [...new Set(orders.map(o => o.store).filter(Boolean))].sort();
  const regions = [...new Set(orders.flatMap(o => o.items.map(i => i.region)).filter(Boolean))].sort();
  const storeEl = document.getElementById('filterStore'); const regionEl = document.getElementById('filterRegion');
  if (storeEl) { const sv = storeEl.value; storeEl.innerHTML = `<option value="">${t('common.allStores')}</option>` + stores.map(s => `<option value="${H(s)}"${s === sv ? ' selected' : ''}>${H(s)}</option>`).join(''); }
  if (regionEl) { const rv = regionEl.value; regionEl.innerHTML = `<option value="">${t('common.allRegions')}</option>` + regions.map(r => `<option value="${H(r)}"${r === rv ? ' selected' : ''}>${H(r)}</option>`).join(''); }
  renderSidebar();
  renderDetail();
  initLightboxTouch();
  updateWishlistBadge();
  if (appState.currentTab === 'wishlist') renderWishlist();
  updateWishlistBadge();
  applyI18n();
  syncMobileCollectionView();
}

// Background Particles
export function initParticles() {
  const canvas = document.getElementById('particles');
  if (!canvas || appState.particlesInitialized) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  appState.particlesInitialized = true;
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, particles = [];

  function randomColor() {
    const colors = ['rgba(103,232,249,', 'rgba(74,222,128,', 'rgba(167,139,250,'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  function createParticle() {
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.8 + 0.4,
      dx: (Math.random() - 0.5) * 0.35,
      dy: (Math.random() - 0.5) * 0.35,
      color: randomColor(),
      alpha: Math.random() * 0.45 + 0.08,
      pulse: Math.random() * Math.PI * 2,
      pulseSpeed: 0.01 + Math.random() * 0.02
    };
  }

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
    const count = window.innerWidth <= 768 ? 28 : 70;
    particles = Array.from({ length: count }, createParticle);
  }

  function draw() {
    if (document.hidden) { requestAnimationFrame(draw); return; }
    ctx.clearRect(0, 0, W, H);
    for (const p of particles) {
      p.pulse += p.pulseSpeed;
      const a = p.alpha * (0.7 + 0.3 * Math.sin(p.pulse));
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color + a + ')';
      ctx.fill();
      p.x += p.dx;
      p.y += p.dy;
      if (p.x < 0) p.x = W;
      if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H;
      if (p.y > H) p.y = 0;
    }
    requestAnimationFrame(draw);
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  });

  resize();
  requestAnimationFrame(draw);
}
