const RU_MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь'
];

const MONTH_ALIASES = [
  ['jan', 'january', 'янв'],
  ['feb', 'february', 'фев'],
  ['mar', 'march', 'мар'],
  ['apr', 'april', 'апр'],
  ['may', 'май', 'мая'],
  ['jun', 'june', 'июн'],
  ['jul', 'july', 'июл'],
  ['aug', 'august', 'авг'],
  ['sep', 'sept', 'september', 'сен'],
  ['oct', 'october', 'окт'],
  ['nov', 'november', 'ноя'],
  ['dec', 'december', 'дек']
];

export const RELEASE_STATUS_OPTIONS = ['unknown', 'preorder', 'released', 'delayed', 'cancelled'];

export const RELEASE_STATUS_LABELS = {
  unknown: 'unknown',
  preorder: 'preorder',
  released: 'released',
  delayed: 'delayed',
  cancelled: 'cancelled'
};

export function H(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function clean(value) {
  return value == null ? '' : String(value).trim();
}

export function normalizeTag(tag) {
  return String(tag || '').trim().replace(/\s+/g, ' ');
}

export function tagKey(tag) {
  return normalizeTag(tag).toLowerCase();
}

function firstText(...values) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return '';
}

function isTelegramFileUrl(value = '') {
  return typeof value === 'string' && value.includes('api.telegram.org/file/bot');
}

function nonTelegramText(value) {
  const text = firstText(value);
  return text && !isTelegramFileUrl(text) ? text : '';
}

export function mergeTags(...tagLists) {
  const source = tagLists.flatMap(tags => (
    Array.isArray(tags) ? tags : String(tags || '').split(',')
  ));
  const seen = new Map();
  const result = [];
  for (const rawTag of source) {
    const tag = normalizeTag(rawTag);
    const key = tagKey(tag);
    if (!tag || seen.has(key)) continue;
    seen.set(key, tag);
    result.push(tag);
  }
  return result;
}

export function parseReleaseDateParts(value) {
  const source = clean(value);
  if (!source) return { month: '', year: '' };
  const lower = source.toLowerCase().replace(/\b(early|mid|late|end of|around|release|released)\b/g, ' ');
  const year = lower.match(/(20\d{2}|19\d{2})/)?.[1] || '';
  let monthIndex = -1;

  const yearMonth = lower.match(/(?:20\d{2}|19\d{2})[\/\-.\s年]+(\d{1,2})/);
  if (yearMonth) monthIndex = Number(yearMonth[1]) - 1;

  if (monthIndex < 0) {
    const monthYear = lower.match(/(?:^|[^\d])(\d{1,2})[\/\-.](?:20\d{2}|19\d{2})/);
    if (monthYear) monthIndex = Number(monthYear[1]) - 1;
  }

  if (monthIndex < 0) {
    monthIndex = MONTH_ALIASES.findIndex(aliases => aliases.some(alias => lower.includes(alias)));
  }

  if (monthIndex < 0 || monthIndex > 11 || !year) return { month: '', year };
  return { month: RU_MONTHS[monthIndex], year };
}

export function formatReleaseDate(value) {
  const source = clean(value);
  if (!source) return '';
  const parsed = parseReleaseDateParts(source);
  if (parsed.month && parsed.year) return `${parsed.month} ${parsed.year}`;
  return source;
}

export function normalizeReleaseStatus(value) {
  const status = clean(value).toLowerCase();
  return RELEASE_STATUS_OPTIONS.includes(status) ? status : 'unknown';
}

export function buildSearchText(item = {}) {
  return [
    item.name,
    item.orderName,
    item.orderNumber,
    item.store,
    item.manufacturer,
    item.releaseDate,
    item.preorderStart,
    item.preorderEnd,
    item.releaseStatus,
    item.jan,
    item.sku,
    item.code,
    item.source,
    item.sourceUrl,
    item.shopUrl,
    item.notes,
    item.status,
    item.paymentStatus,
    item.currency,
    ...(item.tags || [])
  ].filter(Boolean).join(' ').toLowerCase();
}

export function normalizeProductMeta(item = {}) {
  const next = item && typeof item === 'object' ? { ...item } : {};
  const sku = firstText(next.sku, next.code, next.productCode, next.itemCode);
  const images = Array.isArray(next.images) ? next.images : [];
  const imageUrls = Array.isArray(next.imageUrls) ? next.imageUrls : [];
  const cleanImageUrls = mergeTags(
    imageUrls.filter(url => typeof url === 'string' && !isTelegramFileUrl(url)),
    images.filter(url => typeof url === 'string' && !isTelegramFileUrl(url))
  );
  const imageUrl = nonTelegramText(next.imageUrl) ||
    nonTelegramText(next.img) ||
    nonTelegramText(next.image) ||
    nonTelegramText(next.thumbnail) ||
    cleanImageUrls[0] ||
    '';

  next.jan = firstText(next.jan, next.ean, next.janCode);
  next.sku = sku;
  next.code = firstText(next.code, sku);
  next.source = firstText(next.source, next.importSource);
  next.sourceUrl = firstText(next.sourceUrl);
  next.shopUrl = firstText(next.shopUrl, next.url, next.pageUrl);
  next.releaseDate = formatReleaseDate(next.releaseDate || next.release || next.date);
  next.preorderStart = firstText(next.preorderStart, next.preorderFrom);
  next.preorderEnd = firstText(next.preorderEnd, next.preorderUntil);
  next.releaseStatus = normalizeReleaseStatus(next.releaseStatus);
  next.imageUrl = imageUrl;
  next.img = imageUrl;
  next.imageUrls = mergeTags(cleanImageUrls, imageUrl ? [imageUrl] : []);
  next.tags = mergeTags(next.tags || [], []);
  next._searchText = buildSearchText(next);
  return next;
}

export function renderProductMetaBadges(item = {}) {
  const normalized = normalizeProductMeta(item);
  const sku = firstText(normalized.sku, normalized.code);
  const badges = [];
  if (normalized.releaseStatus && normalized.releaseStatus !== 'unknown') badges.push(['status', RELEASE_STATUS_LABELS[normalized.releaseStatus]]);
  if (normalized.jan) badges.push(['jan', `JAN ${normalized.jan}`]);
  if (sku) badges.push(['sku', `SKU ${sku}`]);
  if (normalized.source) badges.push(['source', normalized.source]);
  return badges.map(([kind, label]) => `<span class="product-badge product-badge-${kind}">${H(label)}</span>`).join('');
}

export function renderProductMetaRows(item = {}) {
  const normalized = normalizeProductMeta(item);
  const sku = firstText(normalized.sku, normalized.code);
  const rows = [
    ['JAN / EAN', normalized.jan],
    ['SKU / код', sku],
    ['Дата выхода', normalized.releaseDate],
    ['Старт предзаказа', normalized.preorderStart],
    ['Окончание предзаказа', normalized.preorderEnd],
    ['Статус релиза', normalized.releaseStatus !== 'unknown' ? normalized.releaseStatus : ''],
    ['Источник импорта', normalized.source],
    ['Ссылка-источник', normalized.sourceUrl, true]
  ].filter(([, value]) => clean(value));

  if (!rows.length) return '';
  return `<div class="product-meta-section"><div class="product-meta-title">Данные товара</div>${rows.map(([label, value, isUrl]) => `<div class="modal-row"><span class="modal-label">${H(label)}</span>${isUrl ? `<a href="${H(value)}" target="_blank" rel="noopener noreferrer">${H(value)}</a>` : `<span>${H(value)}</span>`}</div>`).join('')}</div>`;
}
