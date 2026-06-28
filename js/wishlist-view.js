// js/wishlist-view.js
import { state, appState, persist, toEur } from './state.js';
import { H, eur } from './utils.js';
import { toast } from './notifications.js';
import { applyI18n, t } from './i18n.js';

const PRIORITY_LABEL = { high: '🔥 Куплю точно', mid: '⭐ Хочу', low: '💭 Если дёшево' };
const PRIORITY_COLOR = { high: 'var(--red)', mid: 'var(--yellow)', low: 'var(--muted)' };

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
  applyI18n();
}

export function closeWishForm() {
  document.getElementById('wishFormOverlay').style.display = 'none';
  appState.editingWishId = null;
}

export function clearWishForm() {
  ['wName', 'wStore', 'wMaker', 'wPrice', 'wDate', 'wImg', 'wShopUrl', 'wNotes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('wCurrency').value = 'JPY';
  document.getElementById('wPriority').value = 'mid';
  document.getElementById('wishFormTitle').dataset.i18n = 'wish.formTitle';
  document.getElementById('wishFormTitle').textContent = t('wish.formTitle');
}

export function saveWish() {
  const name = document.getElementById('wName').value.trim();
  if (!name) { alert('Укажи название'); return; }
  const imageUrls = document.getElementById('wImg').value.split(',').map(s => s.trim()).filter(Boolean);
  const wish = {
    id: appState.editingWishId || crypto.randomUUID(),
    name,
    store: document.getElementById('wStore').value.trim(),
    manufacturer: document.getElementById('wMaker').value.trim(),
    priceOriginal: parseFloat(document.getElementById('wPrice').value) || 0,
    currency: document.getElementById('wCurrency').value,
    releaseDate: document.getElementById('wDate').value.trim(),
    imageUrls,
    imageUrl: imageUrls[0] || '',
    shopUrl: document.getElementById('wShopUrl').value.trim(),
    notes: document.getElementById('wNotes').value.trim(),
    priority: document.getElementById('wPriority').value,
    createdAt: appState.editingWishId ? (state.wishlist?.find(w => w.id === appState.editingWishId)?.createdAt || Date.now()) : Date.now()
  };
  if (!state.wishlist) state.wishlist = [];
  if (appState.editingWishId) {
    const idx = state.wishlist.findIndex(w => w.id === appState.editingWishId);
    state.wishlist[idx] = wish;
  } else {
    state.wishlist.push(wish);
  }
  closeWishForm();
  persist();
  renderWishlist();
  updateWishlistBadge();
  toast(appState.editingWishId ? 'Сохранено' : 'Добавлено в вишлист!');
}

export function deleteWish(id) {
  if (!confirm('Удалить из вишлиста?')) return;
  window.createLocalBackup?.('before-delete-wish', true);
  state.wishlist = state.wishlist.filter(w => w.id !== id);
  persist();
  renderWishlist();
  updateWishlistBadge();
  toast('Удалено');
}

export function editWish(id) {
  const w = (state.wishlist || []).find(x => x.id === id);
  if (!w) return;
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
  document.getElementById('wishFormTitle').dataset.i18n = 'wish.editTitle';
  document.getElementById('wishFormTitle').textContent = t('wish.editTitle');
  document.getElementById('wishFormOverlay').style.display = 'flex';
}

export function renderWishlist() {
  const allWishes = state.wishlist || [];
  const q = (document.getElementById('wishSearch')?.value || '').trim().toLowerCase();
  const pf = document.getElementById('wishPriorityFilter')?.value || '';
  const wishes = allWishes.filter(w => {
    if (pf && w.priority !== pf) return false;
    if (!q) return true;
    return [w.name, w.store, w.manufacturer, w.releaseDate].join(' ').toLowerCase().includes(q);
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
      <div class="wish-stat"><span>Всего</span><strong>${allWishes.length}</strong></div>
      <div class="wish-stat high"><span>Точно хочу</span><strong>${counts.high || 0}</strong></div>
      <div class="wish-stat mid"><span>Хочу</span><strong>${counts.mid || 0}</strong></div>
      <div class="wish-stat low"><span>Если дёшево</span><strong>${counts.low || 0}</strong></div>
      <div class="wish-stat total"><span>Оценка</span><strong>${eur(estimated)}</strong></div>`;
  }
  const grid = document.getElementById('wishGrid');
  if (!grid) return;
  if (!wishes.length) {
    grid.innerHTML = '<div style="color:var(--muted);padding:40px 0;grid-column:1/-1;text-align:center;">Вишлист пуст — добавь первую мечту! ⭐</div>';
    return;
  }
  grid.innerHTML = wishes.map(w => {
    const priceEur = toEur(w.priceOriginal || 0, w.currency || 'EUR');
    return `<div class="wish-card animate-in" style="animation-delay:${wishes.indexOf(w) * 40}ms" onclick="openWishModal('${H(w.id)}')">${w.imageUrl ? `<img class="wish-img" src="${H(w.imageUrl)}" loading="lazy" alt="${H(w.name)}" onerror="this.style.opacity='.1'">` : `<div class="wish-img" style="display:flex;align-items:center;justify-content:center;font-size:48px;">⭐</div>`}<div class="wish-body"><div class="wish-name">${H(w.name)}</div><div class="wish-meta">${H(w.store || '—')}</div><div class="wish-price" style="color:${PRIORITY_COLOR[w.priority]}">${PRIORITY_LABEL[w.priority]}</div>${w.priceOriginal ? `<div class="wish-meta" style="color:var(--accent);margin-top:4px;">~€${priceEur}</div>` : ''}</div></div>`;
  }).join('');
}

export function openWishModal(id) {
  const w = (state.wishlist || []).find(x => x.id === id);
  if (!w) return;
  const priceEur = toEur(w.priceOriginal || 0, w.currency || 'EUR');
  const imgs = w.imageUrls?.length ? w.imageUrls : (w.imageUrl ? [w.imageUrl] : []);
  let imgIdx = 0;
  const modalImg = document.getElementById('modalImg');

  function updateWishModalImg() {
    modalImg.src = imgs[imgIdx] || '';
    modalImg.style.display = imgs.length ? 'block' : 'none';
    modalImg.className = 'modal-img ' + (imgs.length ? 'zoomable' : '');
    modalImg.onclick = imgs.length ? () => window.openLightbox?.(imgs[imgIdx], w.name) : null;
    document.getElementById('modalImgCounter').textContent = imgs.length > 1 ? `${imgIdx + 1} / ${imgs.length}` : '';
    document.getElementById('modalImgPrev').style.display = imgs.length > 1 ? 'flex' : 'none';
    document.getElementById('modalImgNext').style.display = imgs.length > 1 ? 'flex' : 'none';
  }

  document.getElementById('modalImgPrev').onclick = () => { imgIdx = (imgIdx - 1 + imgs.length) % imgs.length; updateWishModalImg(); };
  document.getElementById('modalImgNext').onclick = () => { imgIdx = (imgIdx + 1) % imgs.length; updateWishModalImg(); };
  updateWishModalImg();
  document.getElementById('modalName').textContent = w.name || '—';
  document.getElementById('modalRows').innerHTML = `<div class="modal-row"><span class="modal-label">Приоритет</span><span style="color:${PRIORITY_COLOR[w.priority]}">${PRIORITY_LABEL[w.priority]}</span></div><div class="modal-row"><span class="modal-label">Магазин</span><span>${H(w.store || '—')}</span></div><div class="modal-row"><span class="modal-label">Производитель</span><span>${H(w.manufacturer || '—')}</span></div><div class="modal-row"><span class="modal-label">Дата выхода</span><span>${H(w.releaseDate || '—')}</span></div>${w.priceOriginal ? `<div class="modal-row"><span class="modal-label">Цена</span><span>${w.priceOriginal} ${w.currency} → <strong style="color:var(--green)">€${priceEur}</strong></span></div>` : ''}${w.notes ? `<div class="modal-row"><span class="modal-label">Заметки</span><span>${H(w.notes)}</span></div>` : ''}${w.shopUrl ? `<div class="modal-row"><span class="modal-label">Страница товара</span><a href="${H(w.shopUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:none;display:inline-flex;align-items:center;gap:4px;">Открыть в магазине </a></div>` : ''}`;
  document.getElementById('modalMove').style.display = 'flex';
  document.getElementById('modalMove').onclick = () => window.moveWishToCollection?.(id);
  document.getElementById('modalEdit').onclick = () => { window.closeModal?.(); window.editWish?.(id); };
  document.getElementById('modalDelete').onclick = () => { if (confirm('Удалить?')) { window.closeModal?.(); deleteWish(id); } };
  document.getElementById('modalOverlay').style.display = 'flex';
}
