// js/wishlist-view.js
import { state, appState, persist, toEur } from './state.js';
import { H, eur } from './utils.js';
import { toast } from './notifications.js';
import { applyI18n, t } from './i18n.js';
import { buildSearchText, formatReleaseDate, mergeTags, normalizeProductMeta, renderProductMetaBadges } from './product-meta.js';
import { getMediaKind, getMediaUrl, isTelegramFileUrl, isVideoUrl } from './media-storage.js';

const PRIORITY_COLOR = { high: 'var(--red)', mid: 'var(--yellow)', low: 'var(--muted)' };

function priorityLabel(priority) {
  const labels = {
    high: `🔥 ${t('wishlist.definitelyWant')}`,
    mid: `⭐ ${t('wishlist.want')}`,
    low: `💭 ${t('wishlist.ifCheap')}`
  };
  return labels[priority] || labels.mid;
}

function shouldUseExternalUrl(url) {
  return Boolean(url) && !isTelegramFileUrl(String(url));
}

function isExternalVideoUrl(url) {
  return shouldUseExternalUrl(url) && (isVideoUrl(url) || /video/i.test(String(url)));
}

function isExternalImageUrl(url) {
  return shouldUseExternalUrl(url) && !isExternalVideoUrl(url);
}

function guessVideoMimeType(url) {
  if (/\.webm(\?|#|$)/i.test(url)) return 'video/webm';
  if (/\.mov(\?|#|$)/i.test(url)) return 'video/quicktime';
  if (/\.m4v(\?|#|$)/i.test(url)) return 'video/mp4';
  return 'video/mp4';
}

function createExternalVideoMedia(url) {
  const cleanUrl = String(url || '').trim();
  return {
    id: crypto.randomUUID(),
    provider: 'external',
    type: 'video',
    mediaType: 'video',
    mimeType: guessVideoMimeType(cleanUrl),
    url: cleanUrl,
    videoUrl: cleanUrl,
    createdAt: Date.now()
  };
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

function wishFormUrls(wish) {
  const urls = [];
  const seen = new Set();
  const add = url => {
    const value = String(url || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    urls.push(value);
  };
  (wish?.imageUrls || []).forEach(add);
  (wish?.media || []).forEach(media => {
    const url = getMediaUrl(media);
    if (media?.provider === 'external' && isExternalVideoUrl(url)) add(url);
  });
  if (!urls.length && shouldUseExternalUrl(wish?.imageUrl)) add(wish.imageUrl);
  return urls;
}

function wishlistMediaEntries(wish) {
  const entries = [];
  const seen = new Set();
  const add = value => {
    const url = getMediaUrl(value);
    const key = mediaKey(value) || url;
    if (!url || seen.has(key)) return;
    seen.add(key);
    const media = value && typeof value === 'object' ? value : url;
    entries.push({ url, media, kind: getMediaKind(media) });
  };

  (wish?.imageUrls || []).filter(shouldUseExternalUrl).forEach(add);
  (wish?.media || []).forEach(add);
  if (shouldUseExternalUrl(wish?.imageUrl)) add(wish.imageUrl);
  if (shouldUseExternalUrl(wish?.img)) add(wish.img);

  return entries;
}

function syncWishlistGlobalTags() {
  window.invalidateTagsCache?.();
  state.settings = state.settings || {};
  state.settings.tags = mergeTags(
    state.settings.tags || state.tags || [],
    (state.items || []).flatMap(item => item.tags || []),
    (state.wishlist || []).flatMap(item => item.tags || [])
  );
}

function matchesWishlistGlobalSearch(wish) {
  const words = String(state.search?.global || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const searchText = wish?._searchText || buildSearchText(wish);
  return words.every(word => searchText.includes(word));
}

export function updateWishlistBadge() {
  const wishTab = document.querySelector('.nav-tab[data-tab="wishlist"]');
  if (!wishTab) return;
  wishTab.removeAttribute('data-i18n');
  const cnt = (state.wishlist || []).length;
  wishTab.innerHTML = `${t('nav.wishlist')}${cnt ? ` <span class="tab-badge">${cnt}</span>` : ''}`;
}

export function openWishForm() {
  appState.editingWishId = null;
  appState.pendingWishUploadedMedia = [];
  appState.pendingUploadedWishMedia = [];
  clearWishForm();
  document.getElementById('wishFormOverlay').style.display = 'flex';
  window.renderTagSuggestions?.();
  applyI18n();
}

export function closeWishForm() {
  window.stopMedia?.(document.getElementById('wishFormOverlay'), { resetSrc: false });
  document.getElementById('wishFormOverlay').style.display = 'none';
  appState.editingWishId = null;
  appState.pendingWishUploadedMedia = [];
  appState.pendingUploadedWishMedia = [];
}

export function clearWishForm() {
  ['wName', 'wStore', 'wMaker', 'wPrice', 'wDate', 'wImg', 'wShopUrl', 'wNotes', 'wJan', 'wSku', 'wPreorderStart', 'wPreorderEnd', 'wSource', 'wSourceUrl', 'wTags'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('wCurrency').value = 'JPY';
  document.getElementById('wPriority').value = 'mid';
  if (document.getElementById('wReleaseStatus')) document.getElementById('wReleaseStatus').value = 'unknown';
  document.getElementById('wishFormTitle').dataset.i18n = 'wish.formTitle';
  document.getElementById('wishFormTitle').textContent = t('wish.formTitle');
}

export function saveWish() {
  const name = document.getElementById('wName').value.trim();
  if (!name) { alert(t('alert.wishNameRequired')); return; }
  const rawUrls = (document.getElementById('wImg')?.value || '')
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(Boolean);
  const existingWish = appState.editingWishId
    ? (state.wishlist || []).find(w => w.id === appState.editingWishId)
    : null;
  const baseMedia = mergeMediaByUrl(
    existingWish?.media || [],
    existingWish?.images || [],
    appState.pendingWishUploadedMedia || [],
    appState.pendingUploadedWishMedia || []
  );
  const baseMediaUrls = mediaUrlSet(baseMedia);
  const externalVideoMedia = rawUrls
    .filter(isExternalVideoUrl)
    .filter(url => !baseMediaUrls.has(url))
    .map(createExternalVideoMedia);
  const media = mergeMediaByUrl(baseMedia, externalVideoMedia);
  const mediaUrls = mediaUrlSet(media);
  const imageUrls = rawUrls
    .filter(isExternalImageUrl)
    .filter(url => !mediaUrls.has(url));
  const fallbackMediaUrl = getMediaUrl(media[0]) || '';
  const wish = normalizeProductMeta({
    id: appState.editingWishId || crypto.randomUUID(),
    name,
    store: document.getElementById('wStore').value.trim(),
    manufacturer: document.getElementById('wMaker').value.trim(),
    priceOriginal: parseFloat(document.getElementById('wPrice').value) || 0,
    currency: document.getElementById('wCurrency').value,
    releaseDate: formatReleaseDate(document.getElementById('wDate').value.trim()),
    imageUrls,
    imageUrl: imageUrls[0] || existingWish?.imageUrl || fallbackMediaUrl || '',
    img: imageUrls[0] || existingWish?.img || fallbackMediaUrl || '',
    media,
    shopUrl: document.getElementById('wShopUrl').value.trim(),
    jan: document.getElementById('wJan')?.value.trim() || '',
    sku: document.getElementById('wSku')?.value.trim() || '',
    code: document.getElementById('wSku')?.value.trim() || '',
    preorderStart: document.getElementById('wPreorderStart')?.value.trim() || '',
    preorderEnd: document.getElementById('wPreorderEnd')?.value.trim() || '',
    releaseStatus: document.getElementById('wReleaseStatus')?.value || 'unknown',
    source: document.getElementById('wSource')?.value.trim() || '',
    sourceUrl: document.getElementById('wSourceUrl')?.value.trim() || '',
    notes: document.getElementById('wNotes').value.trim(),
    priority: document.getElementById('wPriority').value,
    tags: (document.getElementById('wTags')?.value || '').split(',').map(t => t.trim()).filter(Boolean),
    createdAt: appState.editingWishId ? (state.wishlist?.find(w => w.id === appState.editingWishId)?.createdAt || Date.now()) : Date.now()
  });
  if (!state.wishlist) state.wishlist = [];
  if (appState.editingWishId) {
    const idx = state.wishlist.findIndex(w => w.id === appState.editingWishId);
    state.wishlist[idx] = wish;
  } else {
    state.wishlist.push(wish);
  }
  syncWishlistGlobalTags();
  closeWishForm();
  persist();
  renderWishlist();
  updateWishlistBadge();
  toast(appState.editingWishId ? t('toast.saved') : t('wishlist.added'));
}

export function deleteWish(id) {
  if (!confirm(t('confirm.deleteWish'))) return;
  window.createLocalBackup?.('before-delete-wish', true);
  state.wishlist = state.wishlist.filter(w => w.id !== id);
  syncWishlistGlobalTags();
  persist();
  renderWishlist();
  updateWishlistBadge();
  toast(t('toast.deleted'));
}

export function editWish(id) {
  const rawWish = (state.wishlist || []).find(x => x.id === id);
  if (!rawWish) return;
  const w = normalizeProductMeta(rawWish);
  appState.editingWishId = id;
  appState.pendingWishUploadedMedia = [];
  appState.pendingUploadedWishMedia = [];
  document.getElementById('wName').value = w.name || '';
  document.getElementById('wStore').value = w.store || '';
  document.getElementById('wMaker').value = w.manufacturer || '';
  document.getElementById('wPrice').value = w.priceOriginal || '';
  document.getElementById('wCurrency').value = w.currency || 'JPY';
  document.getElementById('wDate').value = w.releaseDate || '';
  document.getElementById('wImg').value = wishFormUrls(w).join(', ');
  document.getElementById('wShopUrl').value = w.shopUrl || '';
  document.getElementById('wNotes').value = w.notes || '';
  document.getElementById('wPriority').value = w.priority || 'mid';
  document.getElementById('wJan').value = w.jan || '';
  document.getElementById('wSku').value = w.sku || w.code || '';
  document.getElementById('wPreorderStart').value = w.preorderStart || '';
  document.getElementById('wPreorderEnd').value = w.preorderEnd || '';
  document.getElementById('wReleaseStatus').value = w.releaseStatus || 'unknown';
  document.getElementById('wSource').value = w.source || '';
  document.getElementById('wSourceUrl').value = w.sourceUrl || '';
  document.getElementById('wTags').value = (w.tags || []).join(', ');
  document.getElementById('wishFormTitle').dataset.i18n = 'wish.editTitle';
  document.getElementById('wishFormTitle').textContent = t('wish.editTitle');
  window.renderTagSuggestions?.();
  document.getElementById('wishFormOverlay').style.display = 'flex';
}

export function renderWishlist() {
  const allWishes = state.wishlist || [];
  const pf = document.getElementById('wishPriorityFilter')?.value || '';
  const wishes = allWishes.filter(w => {
    if (pf && w.priority !== pf) return false;
    return matchesWishlistGlobalSearch(w);
  });
  updateWishlistBadge();
  const stats = document.getElementById('wishStats');
  if (stats) {
    const counts = allWishes.reduce((acc, w) => {
      acc[w.priority || 'mid'] = (acc[w.priority || 'mid'] || 0) + 1;
      return acc;
    }, { high: 0, mid: 0, low: 0 });
    const estimated = allWishes.reduce((sum, w) => sum + toEur(w.priceOriginal || 0, w.currency || 'EUR'), 0);
    stats.innerHTML = `
      <div class="wish-stat"><span>${t('wishlist.total')}</span><strong>${allWishes.length}</strong></div>
      <div class="wish-stat high"><span>${t('wishlist.definitelyWant')}</span><strong>${counts.high || 0}</strong></div>
      <div class="wish-stat mid"><span>${t('wishlist.want')}</span><strong>${counts.mid || 0}</strong></div>
      <div class="wish-stat low"><span>${t('wishlist.ifCheap')}</span><strong>${counts.low || 0}</strong></div>
      <div class="wish-stat total"><span>${t('wishlist.estimate')}</span><strong>${eur(estimated)}</strong></div>`;
  }
  const grid = document.getElementById('wishGrid');
  if (!grid) return;
  if (!wishes.length) {
    grid.innerHTML = `<div style="color:var(--muted);padding:40px 0;grid-column:1/-1;text-align:center;">${t('wishlist.empty')}</div>`;
    return;
  }
  grid.innerHTML = wishes.map(w => {
    const wish = normalizeProductMeta(w);
    const coverEntry = wishlistMediaEntries(wish)[0];
    const coverUrl = coverEntry?.url || wish.imageUrl || '';
    const coverMedia = coverEntry?.media || coverUrl;
    const priceEur = toEur(wish.priceOriginal || 0, wish.currency || 'EUR');
    return `<div class="wish-card animate-in" style="animation-delay:${wishes.indexOf(w) * 40}ms" onclick="if(window.isCardOpenBlocked?.(event))return;openEntityDetail('wishlist','${H(wish.id)}')">
      ${coverUrl ? `<img class="wish-img" src="${H(coverUrl)}" loading="lazy" alt="${H(wish.name)}" data-provider="${H(coverMedia?.provider || '')}" data-file-id="${H(coverMedia?.fileId || '')}" data-media-type="${H(coverMedia?.mediaType || '')}" onerror="handleMediaLoadError(this)">` : `<div class="wish-img" style="display:flex;align-items:center;justify-content:center;font-size:48px;">⭐</div>`}
      <div class="wish-body">
        <div class="wish-name">${H(wish.name)}</div>
        ${wish.store ? `<div class="wish-meta">${H(wish.store)}</div>` : ''}
        ${wish.manufacturer ? `<div class="wish-meta">${H(wish.manufacturer)}</div>` : ''}
        ${wish.releaseDate ? `<div class="wish-meta">${t('wishlist.release')}: ${H(wish.releaseDate)}</div>` : ''}
        ${wish.priceOriginal ? `<div class="wish-meta" style="color:var(--accent);margin-top:4px;">${H(String(wish.priceOriginal))} ${H(wish.currency || '')} · ~€${priceEur}</div>` : ''}
        <div class="wish-price" style="color:${PRIORITY_COLOR[wish.priority]}">${priorityLabel(wish.priority)}</div>
        <div class="product-badges">${renderProductMetaBadges(wish)}</div>
        ${wish.tags?.length ? `<div class="tags">${wish.tags.map(t => `<span class="tag">${H(t)}</span>`).join('')}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

export function openWishModal(id) {
  return window.openEntityDetail?.('wishlist', id);
}
