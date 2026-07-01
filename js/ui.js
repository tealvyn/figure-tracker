// js/ui.js
import { state, appState, persist, schedulePersist, toEur } from './state.js';
import { H, eur, calcAmiAmiShipping, calcOrder, SCALE_WEIGHTS } from './utils.js';
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
const mediaLookup = new Map();
const STANDALONE_TABS = new Set(['gallery', 'calendar', 'analytics', 'shelf', 'settings']);
let gallerySliderTimer = null;
let gallerySliderObserver = null;
const visibleGallerySliders = new Set();
let lastProductDetailNavAt = 0;
let lastLightboxNavAt = 0;

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
    'video, audio, button, a, input, select, textarea, [data-no-card-open], .media-video-preview, .media-video-toggle, .media-video-sound, .media-open-btn, .lightbox-arrow, .lightbox-close'
  ));
}

export function pauseAllVideosExcept(exceptVideo = null) {
  document.querySelectorAll('video').forEach(video => {
    if (video !== exceptVideo && !video.paused) video.pause();
  });
}

export function syncPreviewVideoToggle(video) {
  const wrapper = video?.closest?.('.media-video-preview');
  if (!wrapper) return;
  const isPlaying = Boolean(video && !video.paused && !video.ended);
  wrapper.classList.toggle('is-playing', isPlaying);
  const btn = wrapper.querySelector('.media-video-toggle');
  if (btn) {
    btn.textContent = isPlaying ? '∎' : '▶';
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

export function togglePreviewVideo(event) {
  stopMediaEvent(event);
  const wrapper = event?.currentTarget?.closest?.('.media-video-preview')
    || event?.target?.closest?.('.media-video-preview');
  const video = wrapper?.querySelector('video');
  if (!video) return;

  if (video.paused || video.ended) {
    pauseAllVideosExcept(video);
    video.play?.().catch(() => null);
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
    const freshUrl = await refreshTelegramMediaUrl(tempMedia, getTelegramSettings());
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
    if (item && !item._searchText) item._searchText = buildSearchText(item);
  });
  (state.wishlist || []).forEach(wish => {
    if (wish && !wish._searchText) wish._searchText = buildSearchText(wish);
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
  return [
    item.name,
    item.orderNumber,
    item.orderName,
    item.store,
    item.manufacturer,
    item.region,
    item.status,
    item.jan,
    item.sku,
    item.code,
    item.releaseDate,
    item.shopUrl,
    item.source,
    item.sourceUrl,
    type === 'wishlist' ? item.priority : '',
    type === 'wishlist' ? (item.notes || item.note) : '',
    ...(item.tags || [])
  ].filter(Boolean).join(' ').toLowerCase();
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
    .map(item => ({ type: 'collection', item }));
  const wishlist = (state.wishlist || [])
    .filter(item => matches(item, 'wishlist'))
    .map(item => ({ type: 'wishlist', item }));
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
    return `<button class="global-search-result${index === 0 ? ' active' : ''}" type="button" data-result-index="${index}">
      ${thumb ? `<img class="global-search-result-img" src="${H(thumb)}" alt="" loading="lazy" onerror="this.style.opacity='.2'">` : `<span class="global-search-result-img"></span>`}
      <span class="global-search-result-body">
        <span class="global-search-result-badge">${badge}</span>
        <span class="global-search-result-name">${highlightSearchMatch(item.name || '—', query)}</span>
        <span class="global-search-result-meta">${highlightSearchMatch(meta || '—', query)}</span>
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
  if (result.type === 'wishlist') openWishModal(result.item.id);
  else openModal(result.item.id);
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

export function showRatesBadge() {
  const badge = document.getElementById('ratesBadge');
  if (!badge) return;
  const { USD, JPY } = state.rates;
  const age = Date.now() - (state.ratesAt || 0);
  const mins = Math.floor(age / 60000);
  const timeStr = mins < 1 ? 'только что' : mins < 60 ? `${mins} мин назад` : `${Math.floor(mins / 60)} ч назад`;
  badge.className = 'rates-badge';
  badge.title = `Обновлено: ${timeStr}`;
  badge.textContent = `1 USD = ${USD?.toFixed(4) ?? '???'} · 1 JPY = ${JPY?.toFixed(5) ?? '???'} · ${timeStr}`;
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
  preview.textContent = `${amount} ${currency} × ${rate?.toFixed(currency === 'JPY' ? 5 : 4)} = €${e}`;
}

export function estimateShipping() {
  const scale = document.getElementById('fScale').value;
  if (!scale) { toast(t('toast.selectFigureType')); return; }

  const orderNumber = document.getElementById('fOrder').value.trim();
  const store = document.getElementById('fStore').value.trim().toLowerCase();
  const isOrzGK = store.includes('orzgk') || store.includes('orz');
  const region = document.getElementById('fRegion').value;
  const isEU = region === 'ЕС';
  const method = document.getElementById('fShipMethod').value;
  const orderItems = state.items.filter(i => i.orderNumber === orderNumber && i.id !== (appState.editingId || ''));
  const totalKg = orderItems.reduce((sum, i) => sum + (SCALE_WEIGHTS[i.scale || 'small']?.kg || 0.8), 0) + (SCALE_WEIGHTS[scale]?.kg || 0.8);
  const note = orderItems.length >= 1 ? ` · сборная ${orderItems.length + 1} шт, ~${totalKg.toFixed(1)}кг` : ` · ~${totalKg.toFixed(1)}кг`;

  let usedMethod = method;
  if (method === 'small_packet' && totalKg > 2.0) { usedMethod = 'ems'; toast('⚠️ Small Packet недоступен свыше 2кг — переключено на EMS'); }
  if (method === 'sal' && totalKg > 2.0) { usedMethod = 'ems'; toast('⚠️ SAL недоступен свыше 2кг — переключено на EMS'); }

  let resultEur;
  if (isEU) {
    resultEur = Math.max(8, Math.round(totalKg * 3));
    toast(`📦 ЕС доставка: ~€${resultEur}${note}`);
  } else if (isOrzGK) {
    resultEur = Math.max(15, Math.round(totalKg * 5.5 * 1.2));
    toast(`📦 OrzGK Special Line: ~€${resultEur}${note}`);
  } else {
    const jpy = calcAmiAmiShipping(totalKg, usedMethod);
    resultEur = Math.round(jpy * (state.rates['JPY'] || 0.006));
    const methodName = { small_packet: 'Small Packet', sal: 'SAL', ems: 'EMS', surface: 'Surface' }[usedMethod];
    toast(`📦 ${methodName}: ~${jpy.toLocaleString()} JPY ≈ €${resultEur}${note}`);
  }
  document.getElementById('fShipping').value = resultEur.toFixed(2);
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
    return `<div class="figure-card animate-in" style="animation-delay:${itemIndex * 40}ms" onclick="if(isCardOpenBlocked(event))return;openModal('${H(item.id)}')">
  ${renderMediaTag(firstMedia, 'figure-img', item.name)}
  <div class="figure-body">
    <div class="figure-name">${H(item.name)}</div>
    ${item.store ? `<div class="figure-meta">Магазин: ${H(item.store)}</div>` : ''}
    ${item.manufacturer ? `<div class="figure-meta">Производитель: ${H(item.manufacturer)}</div>` : ''}
    ${item.releaseDate ? `<div class="figure-meta">Выход: ${H(item.releaseDate)}</div>` : ''}
    <div class="figure-meta">💱 ${H(String(item.priceOriginal ?? '—'))} ${H(item.currency || '')}${item.currency && item.currency !== 'EUR' ? ` → <span style="color:var(--accent)">${eur(priceEur)}</span>` : ''}</div>
    <div class="product-badges">${renderProductMetaBadges(item)}</div>
    ${item.shopUrl ? `<a href="${H(item.shopUrl)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--accent);text-decoration:none;margin-top:6px;margin-bottom:2px;">🔗 Открыть в магазине</a>` : ''}
    ${item.tags?.length ? `<div class="tags">${item.tags.map(t => `<span class="tag">${H(t)}</span>`).join('')}</div>` : ''}
  </div>
</div>`;
  }).join('');
  const allReceived = order.items.every(i => i.status === 'Получено');
  const isHidden = order.items.every(i => i.hidden);
  const trackingCode = order.items.find(i => i.tracking)?.tracking;
  const trackUrl = trackingCode
    ? (trackingCode.startsWith('JJ') || trackingCode.startsWith('LX') || trackingCode.startsWith('RR'))
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
    <div class="breakdown-title">Расчёт налогов · Финляндия (ALV 25.5%)</div>
    <div class="summary-row"><span>📦 Товары</span><span>${eur(c.goodsEur)}</span></div>
    <div class="summary-row"><span>🚚 Доставка</span><span>${eur(c.shippingEur)}</span></div>
    <div class="summary-row"><span>📊 База для налога</span><span>${eur(c.taxBase)}</span></div>
    <div class="summary-row"><span>🇫🇮 ALV 25.5%</span><span>${c.isEU ? '<span style="color:var(--green)">0 — ЕС</span>' : eur(c.alv)}</span></div>
    <div class="summary-row"><span>🏛️ Таможня (4.7%)</span><span>${c.isEU ? '<span style="color:var(--green)">0 — ЕС</span>' : c.taxBase <= 150 ? '<span style="color:var(--green)">0 — ≤150€</span>' : eur(c.customs)}</span></div>
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
  if (appState.historyLayer === 'form') appState.historyLayer = null;
  clearForm();
}

export function clearForm() {
  ['fName', 'fOrder', 'fOrderName', 'fStore', 'fImg', 'fShopUrl', 'fPrice', 'fShipping', 'fDeposit', 'fMaker', 'fDateYear', 'fTags', 'fTracking', 'fOrderDate', 'fShipDate', 'fScale', 'fJan', 'fSku', 'fPreorderStart', 'fPreorderEnd', 'fSource', 'fSourceUrl'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('fCurrency').value = 'JPY';
  document.getElementById('fRegion').value = 'Япония';
  document.getElementById('fStatus').value = 'Не оплачено';
  if (document.getElementById('fReleaseStatus')) document.getElementById('fReleaseStatus').value = 'unknown';
  document.getElementById('eurPreview').textContent = '';
  document.getElementById('formTitle').dataset.i18n = 'form.addFigure';
  document.getElementById('formTitle').textContent = t('form.addFigure');
  document.getElementById('fTracking').value = '';
  document.getElementById('fDateMonth').value = '';
  document.getElementById('fShipMethod').value = 'small_packet';
  const s = state.settings || {};
  if (s.region) document.getElementById('fRegion').value = s.region;
  if (s.currency) document.getElementById('fCurrency').value = s.currency;
  if (s.store) document.getElementById('fStore').value = s.store;
  if (s.shipMethod) document.getElementById('fShipMethod').value = s.shipMethod;
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
  const item = normalizeProductMeta(rawItem);
  appState.editingId = id;
  appState.pendingUploadedMedia = [];
  document.getElementById('fName').value = item.name || '';
  document.getElementById('fOrder').value = item.orderNumber || '';
  document.getElementById('fOrderName').value = item.orderName || '';
  document.getElementById('fStore').value = item.store || '';
  document.getElementById('fRegion').value = item.region || 'Япония';
  document.getElementById('fMaker').value = item.manufacturer || '';
  const _formattedRelease = formatReleaseDate(item.releaseDate || '');
  const _dp = _formattedRelease.split(' ');
  document.getElementById('fDateMonth').value = _dp[0] || '';
  document.getElementById('fDateYear').value = _dp[1] || '';
  document.getElementById('fTracking').value = item.tracking || '';
  document.getElementById('fScale').value = item.scale || '';
  document.getElementById('fShipMethod').value = item.shipMethod || 'small_packet';
  document.getElementById('fOrderDate').value = item.orderDate || '';
  document.getElementById('fShipDate').value = item.shipDate || '';
  document.getElementById('fImg').value = mediaUrlsOf(item).join(', ');
  document.getElementById('fShopUrl').value = item.shopUrl || '';
  document.getElementById('fPrice').value = item.priceOriginal || '';
  document.getElementById('fCurrency').value = item.currency || 'JPY';
  document.getElementById('fShipping').value = item.shippingEur || '';
  document.getElementById('fDeposit').value = item.deposit || '';
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
  const media = mergeMediaByUrl(
    existingItem?.media || [],
    existingItem?.images || [],
    uploadedMedia
  );
  const mediaUrls = mediaUrlSet(media);
  const imageUrls = document.getElementById('fImg').value
    .split(',')
    .map(s => s.trim())
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
    shippingEur: parseFloat(document.getElementById('fShipping').value) || 0,
    deposit: parseFloat(document.getElementById('fDeposit').value) || 0,
    status: document.getElementById('fStatus').value,
    tags: document.getElementById('fTags').value.split(',').map(t => t.trim()).filter(Boolean),
    rateAtSave: state.rates[document.getElementById('fCurrency').value] ?? 1,
    rateAtSaveDate: appState.editingId ? (existingItem?.rateAtSaveDate || new Date().toLocaleDateString('ru')) : new Date().toLocaleDateString('ru'),
    createdAt: appState.editingId ? (existingItem?.createdAt || Date.now()) : Date.now(),
    hidden: appState.editingId ? (existingItem?.hidden || false) : false
  });
  const wasEditing = Boolean(appState.editingId);
  if (item.tracking && item.status !== 'Получено' && item.status !== 'В пути') { item.status = 'В пути'; }
  if (appState.editingId) { const idx = state.items.findIndex(i => i.id === appState.editingId); state.items[idx] = item; }
  else state.items.push(item);
  syncGlobalTags();
  appState.selectedOrder = orderNumber;
  appState.pendingUploadedMedia = [];
  if (!wasEditing) clearItemDraft();
  closeForm(); persist(); render(); toast(wasEditing ? t('toast.saved') : t('toast.itemAdded'));
}

export function loadSettings() {
  const s = state.settings || {};
  document.getElementById('sRegion').value = s.region || 'Япония';
  document.getElementById('sCurrency').value = s.currency || 'JPY';
  document.getElementById('sStore').value = s.store || '';
  document.getElementById('sShipMethod').value = s.shipMethod || 'small_packet';
  if (document.getElementById('sDensity')) document.getElementById('sDensity').value = s.density || 'compact';
  if (document.getElementById('sTheme')) document.getElementById('sTheme').value = s.theme || 'cyberpunk';
  applyUiDensity();
  document.getElementById('sScriptUrl').value = s.scriptUrl || '';
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

export function saveSettings() {
  const existingTags = getAllTags();
  state.settings = {
    region: document.getElementById('sRegion').value,
    currency: document.getElementById('sCurrency').value,
    store: document.getElementById('sStore').value,
    shipMethod: document.getElementById('sShipMethod').value,
    density: document.getElementById('sDensity')?.value || state.settings?.density || 'compact',
    theme: document.getElementById('sTheme')?.value || state.settings?.theme || 'cyberpunk',
    tags: existingTags,
    gallery: state.settings?.gallery || {},
    scriptUrl: document.getElementById('sScriptUrl').value.trim(),
    tgBotToken: document.getElementById('sTgBotToken').value.trim(),
    tgChatId: document.getElementById('sTgChatId').value.trim()
  };
  applyUiDensity();
  persist();
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
          <span style="color:${color}">€${val.toFixed(2)} · ${pct(val)}%</span>
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
      <span>Коллекция дома: <strong style="color:#a78bfa;">€${shelfValue.toFixed(2)}</strong></span>
      <span>Ещё потратить: <strong style="color:#f87171;">€${(depositValue + unpaidValue).toFixed(2)}</strong></span>
    </div>`;
}

export function renderAnalytics() {
  const orders = getOrders();
  const totals = getCollectionTotals(orders);
  const received = state.items.filter(i => i.status === 'Получено');
  const inTransit = state.items.filter(i => i.status === 'В пути');
  const unpaid = state.items.filter(i => i.status === 'Не оплачено' || i.status === 'Депозит оплачен');
  const topStore = Object.entries(state.items.reduce((acc, i) => {
    const key = i.store || '—';
    acc[key] = (acc[key] || 0) + getItemTotalEur(i);
    return acc;
  }, {})).sort((a, b) => b[1] - a[1])[0];

  const summaryEl = document.getElementById('analyticsSummary');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="analytics-kpi"><span>Всего</span><strong>${eur(totals.total)}</strong><small>${orders.length} заказов · ${state.items.length} фигурок</small></div>
      <div class="analytics-kpi"><span>На полке</span><strong>${received.length}</strong><small>${eur(received.reduce((s, i) => s + getItemTotalEur(i), 0))}</small></div>
      <div class="analytics-kpi"><span>В пути</span><strong>${inTransit.length}</strong><small>${inTransit.length ? 'ждёт получения' : 'ничего не едет'}</small></div>
      <div class="analytics-kpi"><span>Осталось</span><strong>${eur(totals.remaining)}</strong><small>${unpaid.length} позиций требуют денег</small></div>
      <div class="analytics-kpi"><span>Топ магазин</span><strong>${H(topStore?.[0] || '—')}</strong><small>${topStore ? eur(topStore[1]) : 'нет данных'}</small></div>`;
  }

  const forecastEl = document.getElementById('analyticsForecast');
  if (forecastEl) {
    const upcoming = state.items.filter(i => i.status !== 'Получено' && i.releaseDate).sort((a, b) => releaseSortValue(a) - releaseSortValue(b)).slice(0, 6);
    forecastEl.innerHTML = `<div class="analytics-forecast-title">Ближайший план</div>${upcoming.length ? upcoming.map(i => `<button onclick="openModal('${H(i.id)}')"><span>${H(i.releaseDate || '—')}</span><strong>${H(i.name)}</strong><em>${eur(getItemTotalEur(i))}</em></button>`).join('') : '<div class="dashboard-empty">Нет будущих релизов</div>'}`;
  }

  if (typeof Chart === 'undefined') return;
  const storeData = {}; const makerData = {};
  state.items.forEach(i => {
    const eur = toEur(i.priceOriginal || 0, i.currency || 'EUR');
    const store = i.store || 'Неизвестно';
    const maker = i.manufacturer || 'Неизвестно';
    storeData[store] = (storeData[store] || 0) + eur;
    makerData[maker] = (makerData[maker] || 0) + eur;
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
    if (i.status === 'Полностью оплачено' || i.status === 'Получено') monthsPaid[mIdx] += eurVal; else monthsUnpaid[mIdx] += eurVal;
  });

  if (appState.monthChartInstance) appState.monthChartInstance.destroy();
  const ctxM = document.getElementById('monthChart').getContext('2d');
  appState.monthChartInstance = new Chart(ctxM, { type: 'bar', data: { labels: MONTH_NAMES, datasets: [{ label: 'Оплачено', data: monthsPaid.map(v => v.toFixed(2)), backgroundColor: '#4ade8088', borderColor: '#4ade80', borderWidth: 1, borderRadius: 6 }, { label: 'Не оплачено', data: monthsUnpaid.map(v => v.toFixed(2)), backgroundColor: '#67e8f988', borderColor: '#67e8f9', borderWidth: 1, borderRadius: 6 }] }, options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true, ticks: { color: '#8899aa' }, grid: { color: '#ffffff11' } }, y: { stacked: true, ticks: { color: '#8899aa', callback: v => `€${v}` }, grid: { color: '#ffffff11' } } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: €${ctx.parsed.y}` } } } } });
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
    priceEur ? `€${priceEur.toFixed(2)}` : ''
  ].filter(Boolean).map(H).join(' · ');

  return `<div class="gallery-card animate-in" ${imgs.length > 1 ? `data-gallery-slider="true" data-item-id="${H(item.id)}" data-current-index="0"` : ''} style="animation-delay:${idx * 20}ms;" onclick="if(isCardOpenBlocked(event))return;openProductDetail('collection','${H(item.id)}')">
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
  if (data.unpaidItems?.length) notices.push({ type: 'unpaid', text: `💰 Не оплачено ${data.unpaidItems.length} шт. на €${data.unpaidTotal.toFixed(2)}` });
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
  document.getElementById('formTitle').dataset.i18n = 'form.addFigure'; document.getElementById('formTitle').textContent = t('form.addFigure'); appState.editingId = null; document.getElementById('formOverlay').style.display = 'flex'; pushUiHistory('form'); toast(t('toast.moveWishPrompt'));
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
  const startTime = Number(sourceVideo?.currentTime || 0);
  const autoplay = Boolean(sourceVideo && !sourceVideo.paused && !sourceVideo.ended);
  if (sourceVideo) sourceVideo.pause();
  openLightbox(src, { items, index, ownerId, ownerType, startTime, autoplay });
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
export function openWishModal(...args) {
  const result = WishlistView.openWishModal(...args);
  pushUiHistory('modal');
  return result;
}

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
    newEl.preload = 'metadata';
    newEl.src = safeUrl;
    newEl.onclick = stopVideoEvent;
    newEl.onpointerdown = stopVideoEvent;
    newEl.ontouchstart = stopVideoEvent;
  } else if (kind === 'video') {
    newEl = document.createElement('video');
    newEl.controls = true;
    newEl.preload = 'metadata';
    newEl.playsInline = true;
    newEl.src = safeUrl;
    newEl.onclick = stopVideoEvent;
    newEl.onpointerdown = stopVideoEvent;
    newEl.ontouchstart = stopVideoEvent;
  } else {
    newEl = document.createElement('img');
    newEl.src = safeUrl;
    newEl.alt = alt || '';

    newEl.onclick = (event) => {
      event.stopPropagation();
      if (safeUrl) openLightbox(safeUrl, lightboxContext);
    };
  }

  newEl.id = 'modalImg';
  if (newEl.tagName === 'VIDEO') newEl.dataset.noCardOpen = 'true';

  // zoomable только для фото, не для видео/gif-анимаций
  newEl.className = 'modal-img ' + (safeUrl && kind === 'image' ? 'zoomable' : '');

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
}

function setLightboxMedia(media, alt = '', options = {}) {
  const oldEl = document.getElementById('lightboxImg');
  if (!oldEl) return;
  stopMedia(document.getElementById('lightboxOverlay'), { resetSrc: true });

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
    newEl.preload = 'metadata';
    newEl.src = safeUrl;
    newEl.onclick = stopVideoEvent;
    newEl.onpointerdown = stopVideoEvent;
    newEl.ontouchstart = stopVideoEvent;
  } else if (kind === 'video') {
    newEl = document.createElement('video');
    newEl.controls = true;
    newEl.preload = 'metadata';
    newEl.playsInline = true;
    newEl.src = safeUrl;
    newEl.onclick = stopVideoEvent;
    newEl.onpointerdown = stopVideoEvent;
    newEl.ontouchstart = stopVideoEvent;
    const startTime = Number(options.startTime || 0);
    if (startTime > 0) {
      newEl.addEventListener('loadedmetadata', () => {
        try { newEl.currentTime = Math.min(startTime, Number(newEl.duration || startTime)); } catch {}
      }, { once: true });
    }
    if (options.autoplay) {
      newEl.addEventListener('canplay', () => {
        newEl.play?.().catch(() => null);
      }, { once: true });
    }
  } else {
    newEl = document.createElement('img');
    newEl.src = safeUrl;
    newEl.alt = alt || '';
    newEl.onclick = (event) => event.stopPropagation();
  }

  newEl.id = 'lightboxImg';
  if (newEl.tagName === 'VIDEO') newEl.dataset.noCardOpen = 'true';

  if (kind === 'animation') {
    newEl.className = 'lightbox-media lightbox-animation';
  } else if (kind === 'video') {
    newEl.className = 'lightbox-media lightbox-video';
  } else {
    newEl.className = 'lightbox-media';
  }

  newEl.style.display = safeUrl ? 'block' : 'none';

  oldEl.replaceWith(newEl);
  pauseAllVideosExcept(newEl.tagName === 'VIDEO' ? newEl : null);
}

function productDetailRow(label, value, isHtml = false) {
  if (value == null || value === '') return '';
  return `<div class="modal-row product-detail-row"><span class="modal-label">${H(label)}</span>${isHtml ? `<span>${value}</span>` : `<span>${H(value)}</span>`}</div>`;
}

function productDetailLink(label, url, text = '') {
  if (!url) return '';
  const safeUrl = H(url);
  return productDetailRow(label, `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${H(text || url)}</a>`, true);
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
    productDetailRow('Цена', item.priceOriginal ? `${item.priceOriginal} ${item.currency || ''} · €${priceEur.toFixed(2)}` : ''),
    productDetailRow('Доставка', shipping ? `€${shipping.toFixed(2)}` : ''),
    productDetailRow('Предоплата', deposit ? `€${deposit.toFixed(2)}` : ''),
    productDetailRow('Остаток', `€${remaining.toFixed(2)}`),
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
    item.tags?.length ? productDetailRow('Теги', `<span class="tags">${item.tags.map(tag => `<span class="tag">${H(tag)}</span>`).join('')}</span>`, true) : ''
  ].filter(Boolean).join('');
}

function renderProductDetailThumbs(items, activeIndex, ownerId, onSelect, ownerType = 'collection') {
  const mediaFrame = document.getElementById('modalImg')?.parentElement;
  if (!mediaFrame) return;
  mediaFrame.classList.add('product-detail-media');
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
    const sourceVideo = mediaFrame.querySelector('video');
    const startTime = Number(sourceVideo?.currentTime || 0);
    const autoplay = Boolean(sourceVideo && !sourceVideo.paused && !sourceVideo.ended);
    if (sourceVideo) sourceVideo.pause();
    if (entry?.url) openLightbox(entry.url, { items: entries, index, ownerId, ownerType, startTime, autoplay });
  };
  lightboxBtn.style.display = items.length ? 'inline-flex' : 'none';
  let thumbs = document.getElementById('productDetailThumbs');
  if (!thumbs) {
    thumbs = document.createElement('div');
    thumbs.id = 'productDetailThumbs';
    thumbs.className = 'product-detail-thumbs';
    mediaFrame.insertAdjacentElement('afterend', thumbs);
  }
  thumbs.innerHTML = items.length > 1 ? items.map((entry, idx) => (
    `<button type="button" class="${idx === activeIndex ? 'active' : ''}" data-media-index="${idx}">
      ${entry.kind === 'video' || entry.kind === 'animation' ? '<span>▶</span>' : `<img src="${H(entry.url)}" alt="">`}
    </button>`
  )).join('') : '';
  thumbs.querySelectorAll('[data-media-index]').forEach(button => {
    button.onclick = () => onSelect(Number(button.dataset.mediaIndex || 0));
  });
}

export function openProductDetail(type, id) {
  if (type === 'wishlist') return openWishModal(id);
  return openModal(id);
}

export function openModal(id) {
  pauseAllVideosExcept();
  document.getElementById('modalMove').style.display = 'none';
  const rawItem = state.items.find(i => i.id === id); if (!rawItem) return;
  const item = normalizeProductMeta(rawItem);
  appState.modalItemId = id;
  const priceEur = toEur(item.priceOriginal || 0, item.currency || 'EUR');
  document.getElementById('modalOverlay')?.classList.add('product-detail-overlay');
  document.querySelector('#modalOverlay .modal-box')?.classList.add('product-detail-modal');
  document.querySelector('#modalOverlay .modal-body')?.classList.add('product-detail-info');
  document.getElementById('modalName')?.classList.add('product-detail-title');
  document.getElementById('modalName').textContent = item.name || '—';
  document.getElementById('modalRows').classList.add('product-detail-meta-grid');
  document.getElementById('modalRows').innerHTML = buildCollectionDetailRows(item, priceEur);

  const imgs = mediaEntriesOf(item);
  appState.productDetailMedia = imgs;
  appState.productDetailMediaIndex = 0;
  window.currentModalImages = imgs.map(img => img.url);
  window.currentModalMedia = imgs;
  function updateModalImg() {
    const entries = appState.productDetailMedia || imgs;
    const imgIdx = Math.max(0, Math.min(entries.length - 1, Number(appState.productDetailMediaIndex) || 0));
    appState.productDetailMediaIndex = imgIdx;
    setModalMedia(entries[imgIdx]?.media || '', item?.name || '', {
      items: entries,
      index: imgIdx,
      ownerId: id,
      ownerType: 'collection'
    });
    document.getElementById('modalImgCounter').textContent = entries.length > 1 ? `${imgIdx + 1} / ${entries.length}` : '';
    document.getElementById('modalImgPrev').style.display = entries.length > 1 ? 'flex' : 'none'; document.getElementById('modalImgNext').style.display = entries.length > 1 ? 'flex' : 'none';
    renderProductDetailThumbs(entries, imgIdx, id, nextIdx => { appState.productDetailMediaIndex = nextIdx; updateModalImg(); });
  }

  const receiveBtn = document.getElementById('modalReceive');
  if (item.status === 'Получено') { receiveBtn.style.display = 'none'; } else {
    receiveBtn.style.display = 'flex'; receiveBtn.onclick = () => { state.items.find(i => i.id === id).status = 'Получено'; persist(); render(); renderShelf(); toast(t('toast.itemReceived')); closeModal(); };
  }
  document.getElementById('modalImgPrev').onclick = () => {
    if (shouldIgnoreDuplicateNav(lastProductDetailNavAt)) return;
    lastProductDetailNavAt = performance.now();
    const entries = appState.productDetailMedia || [];
    if (entries.length <= 1) return;
    appState.productDetailMediaIndex = (Number(appState.productDetailMediaIndex || 0) - 1 + entries.length) % entries.length;
    updateModalImg();
  };
  document.getElementById('modalImgNext').onclick = () => {
    if (shouldIgnoreDuplicateNav(lastProductDetailNavAt)) return;
    lastProductDetailNavAt = performance.now();
    const entries = appState.productDetailMedia || [];
    if (entries.length <= 1) return;
    appState.productDetailMediaIndex = (Number(appState.productDetailMediaIndex || 0) + 1) % entries.length;
    updateModalImg();
  };
  updateModalImg();
  document.getElementById('modalEdit').onclick = () => { closeModal(); editItem(id); };
  document.getElementById('modalDelete').onclick = () => { if (confirm(t('confirm.deleteGeneric'))) { closeModal(); deleteItem(id); } };
  document.getElementById('modalOverlay').style.display = 'flex'; document.getElementById('modalMove').style.display = 'none';
  pushUiHistory('modal');
}

export function closeModal() {
  stopMedia(document.getElementById('modalOverlay'), { resetSrc: true });
  document.getElementById('modalOverlay').style.display = 'none'; appState.modalItemId = null;
  document.getElementById('modalOverlay')?.classList.remove('product-detail-overlay');
  document.getElementById('modalOverlay')?.classList.remove('wishlist-detail-overlay');
  document.querySelector('#modalOverlay .modal-box')?.classList.remove('product-detail-modal', 'wishlist-detail-modal');
  document.querySelector('#modalOverlay .modal-body')?.classList.remove('product-detail-info', 'wishlist-detail-info');
  document.getElementById('modalName')?.classList.remove('product-detail-title');
  document.getElementById('modalRows')?.classList.remove('product-detail-meta-grid');
  document.getElementById('modalImg')?.parentElement?.classList.remove('product-detail-media', 'wishlist-detail-media');
  document.getElementById('productDetailLightboxBtn')?.remove();
  document.getElementById('productDetailThumbs')?.remove();
  window.currentModalMedia = [];
  appState.productDetailMedia = [];
  appState.productDetailMediaIndex = 0;
  if (appState.historyLayer === 'modal') appState.historyLayer = null;
  document.getElementById('modalImgPrev').onclick = null; document.getElementById('modalImgNext').onclick = null; document.getElementById('modalImgCounter').textContent = '';
  document.getElementById('modalImgPrev').style.display = 'none'; document.getElementById('modalImgNext').style.display = 'none';
}

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
  if (stats) stats.innerHTML = `<span style="color:var(--green);font-weight:700;">${received.length} фигурок</span> · итого <span style="color:var(--green);font-weight:700;">€${totalSpent.toFixed(2)}</span>`;
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
    <div class="gallery-card animate-in" style="animation-delay:${idx * 30}ms" onclick="if(isCardOpenBlocked(event))return;openModal('${H(item.id)}')">
      <div class="gallery-img-wrap">
        ${mediaHtml}
        <div class="gallery-overlay"><div class="gallery-name">${H(item.name)}</div><div class="gallery-price">€${item.totalPaid.toFixed(2)}</div></div>
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

  setLightboxMedia(items[index]?.media || items[index]?.url || src, '', {
    startTime: context && typeof context === 'object' ? context.startTime : 0,
    autoplay: Boolean(context && typeof context === 'object' && context.autoplay)
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
  document.removeEventListener('keydown', lightboxKeyHandler);
}
export function initLightboxTouch() {
  const overlay = document.getElementById('lightboxOverlay'); if (!overlay || appState.lightboxTouchInitialized) return;
  appState.lightboxTouchInitialized = true;
  overlay.addEventListener('touchstart', e => {
    if (e.target?.closest?.('.lightbox-arrow, .lightbox-close, .lightbox-media, #lightboxImg, video, button')) {
      appState.lightboxTouchStartX = appState.lightboxTouchStartY = null;
      return;
    }
    if (!e.touches.length) return; appState.lightboxTouchStartX = e.touches[0].clientX; appState.lightboxTouchStartY = e.touches[0].clientY;
  }, { passive: true });
  overlay.addEventListener('touchend', e => {
    if (e.target?.closest?.('.lightbox-arrow, .lightbox-close, .lightbox-media, #lightboxImg, video, button')) {
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
    html += `<div class="${classes}"><div class="month-name"><span>${MONTH_NAMES[m]}</span><span style="font-size:12px;color:var(--muted);font-weight:normal;">${itemsInMonth.length ? itemsInMonth.length + ' шт.' : ''}</span></div><div class="month-items">${itemsInMonth.length ? itemsInMonth.map(item => `<div class="calendar-item" onclick="if(isCardOpenBlocked(event))return;${item._type === 'collection' ? `openModal('${H(item.id)}')` : `openWishModal('${H(item.id)}')`}">${item.imageUrl
      ? renderClickableMedia(item.imageUrl, 'figure-img', item.name, item.id)
      : `<div class="figure-img" style="display:flex;align-items:center;justify-content:center;font-size:36px;">📦</div>`}<div class="calendar-item-info"><div class="calendar-item-name">${H(item.name)}</div><div class="calendar-item-type">${item._type === 'collection' ? '📦 В коллекции/Предзаказ' : '⭐ Вишлист'}</div></div></div>`).join('') : '<div style="font-size:12px;color:var(--faint);text-align:center;padding:14px 0;">Нет релизов</div>'}</div></div>`;
  }
  document.getElementById('calendarGrid').innerHTML = html;
}

function waitForTampermonkeyForm(ms = 50) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
