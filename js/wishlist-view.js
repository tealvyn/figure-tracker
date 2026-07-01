// js/wishlist-view.js
import { state, appState, persist, toEur } from './state.js';
import { H, eur } from './utils.js';
import { toast } from './notifications.js';
import { applyI18n, t } from './i18n.js';
import { buildSearchText, formatReleaseDate, mergeTags, normalizeProductMeta, renderProductMetaBadges, renderProductMetaRows } from './product-meta.js';
import { getMediaKind, getMediaUrl, isTelegramFileUrl } from './media-storage.js';

const PRIORITY_COLOR = { high: 'var(--red)', mid: 'var(--yellow)', low: 'var(--muted)' };
let lastWishDetailNavAt = 0;

function shouldIgnoreDuplicateNav(lastAt, gap = 140) {
  const now = performance.now();
  return Boolean(lastAt) && now - lastAt < gap;
}

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

function setWishModalMedia(target, entry, alt = '', lightboxContext = null) {
  if (!target) return null;
  const media = entry?.media || '';
  const url = getMediaUrl(media);
  const kind = getMediaKind(media);
  const next = document.createElement(kind === 'video' || kind === 'animation' ? 'video' : 'img');
  next.id = target.id;
  next.className = 'modal-img ' + (url && kind === 'image' ? 'zoomable' : '');
  next.style.display = url ? 'block' : 'none';

  if (media && typeof media === 'object') {
    if (media.provider) next.dataset.provider = media.provider;
    if (media.fileId) next.dataset.fileId = media.fileId;
    if (media.mediaType) next.dataset.mediaType = media.mediaType;
  }

  if (next.tagName === 'VIDEO') {
    next.controls = kind === 'video';
    next.autoplay = kind === 'animation';
    next.loop = kind === 'animation';
    next.muted = kind === 'animation';
    next.playsInline = true;
    next.preload = 'metadata';
    next.src = url;
    next.dataset.noCardOpen = 'true';
    next.onclick = event => window.stopMediaEvent?.(event) || event.stopPropagation();
    next.onpointerdown = event => window.stopMediaEvent?.(event) || event.stopPropagation();
    next.ontouchstart = event => window.stopMediaEvent?.(event) || event.stopPropagation();
  } else {
    next.src = url;
    next.alt = alt || '';
    next.onclick = url ? event => {
      event.stopPropagation();
      window.openLightbox?.(media, lightboxContext || { items: [entry], index: 0, ownerType: 'wishlist' });
    } : null;
  }

  next.onerror = () => window.handleMediaLoadError?.(next);
  target.replaceWith(next);
  return next;
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
  clearWishForm();
  document.getElementById('wishFormOverlay').style.display = 'flex';
  window.renderTagSuggestions?.();
  applyI18n();
}

export function closeWishForm() {
  window.stopMedia?.(document.getElementById('wishFormOverlay'), { resetSrc: false });
  document.getElementById('wishFormOverlay').style.display = 'none';
  appState.editingWishId = null;
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
  const imageUrls = document.getElementById('wImg').value.split(',').map(s => s.trim()).filter(shouldUseExternalUrl);
  const wish = normalizeProductMeta({
    id: appState.editingWishId || crypto.randomUUID(),
    name,
    store: document.getElementById('wStore').value.trim(),
    manufacturer: document.getElementById('wMaker').value.trim(),
    priceOriginal: parseFloat(document.getElementById('wPrice').value) || 0,
    currency: document.getElementById('wCurrency').value,
    releaseDate: formatReleaseDate(document.getElementById('wDate').value.trim()),
    imageUrls,
    imageUrl: imageUrls[0] || '',
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
  document.getElementById('wName').value = w.name || '';
  document.getElementById('wStore').value = w.store || '';
  document.getElementById('wMaker').value = w.manufacturer || '';
  document.getElementById('wPrice').value = w.priceOriginal || '';
  document.getElementById('wCurrency').value = w.currency || 'JPY';
  document.getElementById('wDate').value = w.releaseDate || '';
  document.getElementById('wImg').value = (w.imageUrls || [w.imageUrl || '']).filter(Boolean).join(', ');
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
    return `<div class="wish-card animate-in" style="animation-delay:${wishes.indexOf(w) * 40}ms" onclick="if(window.isCardOpenBlocked?.(event))return;openWishModal('${H(wish.id)}')">
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
  window.pauseAllVideosExcept?.();
  const rawWish = (state.wishlist || []).find(x => x.id === id);
  if (!rawWish) return;
  const w = normalizeProductMeta(rawWish);
  const priceEur = toEur(w.priceOriginal || 0, w.currency || 'EUR');
  const imgs = wishlistMediaEntries(w);
  appState.productDetailMedia = imgs;
  appState.productDetailMediaIndex = 0;
  let modalImg = document.getElementById('modalImg');

  function updateWishModalImg() {
    const entries = appState.productDetailMedia || imgs;
    const imgIdx = Math.max(0, Math.min(entries.length - 1, Number(appState.productDetailMediaIndex) || 0));
    appState.productDetailMediaIndex = imgIdx;
    window.stopMedia?.(document.getElementById('modalOverlay'), { resetSrc: true });
    modalImg = setWishModalMedia(modalImg, entries[imgIdx], w.name, {
      items: entries,
      index: imgIdx,
      ownerId: id,
      ownerType: 'wishlist'
    });
    document.getElementById('modalImgCounter').textContent = entries.length > 1 ? `${imgIdx + 1} / ${entries.length}` : '';
    document.getElementById('modalImgPrev').style.display = entries.length > 1 ? 'flex' : 'none';
    document.getElementById('modalImgNext').style.display = entries.length > 1 ? 'flex' : 'none';
  }

  document.getElementById('modalImgPrev').onclick = () => {
    if (shouldIgnoreDuplicateNav(lastWishDetailNavAt)) return;
    lastWishDetailNavAt = performance.now();
    const entries = appState.productDetailMedia || [];
    if (entries.length <= 1) return;
    appState.productDetailMediaIndex = (Number(appState.productDetailMediaIndex || 0) - 1 + entries.length) % entries.length;
    updateWishModalImg();
  };
  document.getElementById('modalImgNext').onclick = () => {
    if (shouldIgnoreDuplicateNav(lastWishDetailNavAt)) return;
    lastWishDetailNavAt = performance.now();
    const entries = appState.productDetailMedia || [];
    if (entries.length <= 1) return;
    appState.productDetailMediaIndex = (Number(appState.productDetailMediaIndex || 0) + 1) % entries.length;
    updateWishModalImg();
  };
  updateWishModalImg();
  document.getElementById('modalOverlay')?.classList.add('product-detail-overlay', 'wishlist-detail-overlay');
  document.querySelector('#modalOverlay .modal-box')?.classList.add('product-detail-modal', 'wishlist-detail-modal');
  document.querySelector('#modalOverlay .modal-body')?.classList.add('product-detail-info', 'wishlist-detail-info');
  document.getElementById('modalImg')?.parentElement?.classList.add('product-detail-media', 'wishlist-detail-media');
  document.getElementById('modalName')?.classList.add('product-detail-title');
  document.getElementById('modalRows')?.classList.add('product-detail-meta-grid');
  document.getElementById('modalName').textContent = w.name || '—';
  document.getElementById('modalRows').innerHTML = `<div class="modal-row"><span class="modal-label">${t('modal.priority')}</span><span style="color:${PRIORITY_COLOR[w.priority]}">${priorityLabel(w.priority)}</span></div>${w.store ? `<div class="modal-row"><span class="modal-label">${t('modal.store')}</span><span>${H(w.store)}</span></div>` : ''}${w.manufacturer ? `<div class="modal-row"><span class="modal-label">${t('modal.manufacturer')}</span><span>${H(w.manufacturer)}</span></div>` : ''}${w.priceOriginal ? `<div class="modal-row"><span class="modal-label">${t('modal.price')}</span><span>${w.priceOriginal} ${w.currency} → <strong style="color:var(--green)">€${priceEur}</strong></span></div>` : ''}${renderProductMetaRows(w)}${w.tags?.length ? `<div class="modal-row"><span class="modal-label">${t('modal.tags')}</span><span class="tags">${w.tags.map(t => `<span class="tag">${H(t)}</span>`).join('')}</span></div>` : ''}${w.notes ? `<div class="modal-row"><span class="modal-label">${t('modal.notes')}</span><span>${H(w.notes)}</span></div>` : ''}${w.shopUrl ? `<div class="modal-row"><span class="modal-label">${t('modal.productPage')}</span><a href="${H(w.shopUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:none;display:inline-flex;align-items:center;gap:4px;">${t('common.openStore')}</a></div>` : ''}`;
  document.getElementById('modalMove').style.display = 'flex';
  document.getElementById('modalMove').onclick = () => window.moveWishToCollection?.(id);
  document.getElementById('modalEdit').onclick = () => { window.closeModal?.(); window.editWish?.(id); };
  document.getElementById('modalDelete').onclick = () => { if (confirm(t('confirm.deleteGeneric'))) { window.closeModal?.(); deleteWish(id); } };
  document.getElementById('modalOverlay').style.display = 'flex';
}
