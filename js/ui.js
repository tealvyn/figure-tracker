// js/ui.js
import { state, appState, persist, toEur } from './state.js';
import { H, eur, calcAmiAmiShipping, calcOrder, SCALE_WEIGHTS } from './utils.js';
import * as API from './api.js';

export function toast(msg) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg;
  document.body.appendChild(el); setTimeout(() => el.remove(), 2200);
}

export function showRatesBadge() {
  const badge = document.getElementById('ratesBadge');
  if(!badge) return;
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
  if (!silent) toast('Локальная копия сохранена');
  return backup;
}

export function restoreLocalBackup(id) {
  const backup = getLocalBackups().find(b => b.id === id);
  if (!backup?.state) return toast('Копия не найдена');
  if (!confirm('Восстановить эту локальную копию? Текущие данные будут заменены.')) return;
  Object.keys(state).forEach(key => delete state[key]);
  Object.assign(state, JSON.parse(JSON.stringify(backup.state)));
  appState.selectedOrder = null;
  persist();
  render();
  toast('Локальная копия восстановлена');
}

export function deleteLocalBackup(id) {
  const backups = getLocalBackups().filter(b => b.id !== id);
  localStorage.setItem(LOCAL_BACKUPS_KEY, JSON.stringify(backups));
  renderLocalBackups();
  toast('Копия удалена');
}


const ITEM_DRAFT_KEY = 'fctV2ItemDraft';
const ITEM_DRAFT_FIELDS = ['fName', 'fOrder', 'fOrderName', 'fStore', 'fImg', 'fShopUrl', 'fPrice', 'fShipping', 'fDeposit', 'fMaker', 'fDateYear', 'fTags', 'fTracking', 'fOrderDate', 'fShipDate', 'fScale', 'fCurrency', 'fRegion', 'fStatus', 'fDateMonth', 'fShipMethod'];
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
  if (confirm(`Есть несохранённый черновик от ${when}. Восстановить?`)) {
    applyItemDraft(draft);
    toast('Черновик восстановлен');
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
    box.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px 0;">Локальных копий пока нет</div>';
    return;
  }
  const labels = { manual: 'Вручную', 'before-import': 'Перед импортом', 'before-clear': 'Перед очисткой', 'before-delete-item': 'Перед удалением фигурки', 'before-delete-wish': 'Перед удалением желания' };
  box.innerHTML = backups.map(b => {
    const date = new Date(b.createdAt).toLocaleString('ru');
    const items = b.state?.items?.length || 0;
    const wishes = b.state?.wishlist?.length || 0;
    const label = labels[b.reason] || b.reason || 'Копия';
    return `<div class="local-backup-row"><div><div class="local-backup-title">${H(label)} · ${H(date)}</div><div class="local-backup-meta">${items} фигурок · ${wishes} в вишлисте</div></div><div class="local-backup-actions"><button class="btn btn-sm" onclick="restoreLocalBackup('${H(b.id)}')">Восстановить</button><button class="btn btn-sm btn-danger" onclick="deleteLocalBackup('${H(b.id)}')">Удалить</button></div></div>`;
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
  if (!scale) { toast('Сначала выбери тип фигурки'); return; }

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
          const MONTHS = [['jan', 'янв'],['feb', 'фев'],['mar', 'мар'],['apr', 'апр'],['may', 'май', 'мая'],['jun', 'июн'],['jul', 'июл'],['aug', 'авг'],['sep', 'сен'],['oct', 'окт'],['nov', 'ноя', 'ноябр'],['dec', 'дек']];
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

export function badgeClass(status) {
  if (status === 'Полностью оплачено' || status === 'В пути') return 'badge-paid';
  if (status === 'Депозит оплачен') return 'badge-deposit';
  if (status === 'Получено') return 'badge-received';
  return 'badge-unpaid';
}

export function getFiltered() {
  const q = document.getElementById('searchInput')?.value.trim().toLowerCase() || '';
  const storeF = document.getElementById('filterStore')?.value || '';
  const regionF = document.getElementById('filterRegion')?.value || '';
  const showHidden = document.getElementById('showHiddenToggle')?.checked || false;

  return getOrders().filter(order => {
    const isHidden = order.items.every(i => i.hidden);
    if (isHidden && !showHidden) return false;
    if (appState.filterStatus && orderStatus(order) !== appState.filterStatus) return false;
    if (storeF && (order.store || '') !== storeF) return false;
    if (regionF && (order.items[0]?.region || '') !== regionF) return false;
    if (!q) return true;
    const hay = [order.orderName, order.orderNumber, order.store, ...order.items.flatMap(i => [i.name, i.manufacturer, i.releaseDate, ...(i.tags || [])])].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

export function renderSidebar() {
  const orders = getFiltered();
  const list = document.getElementById('orderList');
  if(!list) return;
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
  list.querySelectorAll('.order-item').forEach(el => el.addEventListener('click', () => { appState.selectedOrder = el.dataset.order; render(); }));
}

export function syncMobileCollectionView() {
  const sidebar = document.querySelector('.sidebar');
  const detailPane = document.getElementById('detailPane');
  if (!sidebar || !detailPane) return;

  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  if (!isMobile || appState.currentTab !== 'collection') {
    sidebar.classList.remove('hidden-mobile');
    detailPane.classList.remove('hidden-mobile');
    return;
  }

  sidebar.classList.toggle('hidden-mobile', Boolean(appState.selectedOrder));
  detailPane.classList.toggle('hidden-mobile', !appState.selectedOrder);
}

export function backToOrders() {
  appState.selectedOrder = null;
  closeFilters();
  render();
}

export function updateWishlistBadge() {
  const wishTab = document.querySelector('.nav-tab[data-tab="wishlist"]');
  if (!wishTab) return;
  const cnt = (state.wishlist || []).length;
  wishTab.innerHTML = `⭐ Вишлист${cnt ? ` <span class="tab-badge">${cnt}</span>` : ''}`;
}

export function renderDetail() {
  const pane = document.getElementById('detailPane');
  if(!pane) return;
  syncMobileCollectionView();
  if (!appState.selectedOrder) {
    const orders = getFiltered();
    const totals = { total: 0, paid: 0, tax: 0 };
    getOrders().forEach(o => {
      const c = calcOrder(o);
      totals.total += Number(c.total);
      totals.tax += Number(c.alv) + Number(c.customs);
      const taxPerItem = (Number(c.alv) + Number(c.customs)) / o.items.length;
      o.items.forEach(i => {
        const itemEur = toEur(i.priceOriginal || 0, i.currency || 'EUR');
        const shipping = Number(i.shippingEur) || 0;
        const deposit = Number(i.deposit) || 0;
        const itemTotal = itemEur + shipping;

        if (i.status === 'Получено') { totals.paid += itemTotal + taxPerItem; } 
        else if (i.status === 'В пути' || i.status === 'Полностью оплачено') { totals.paid += itemTotal; } 
        else if (i.status === 'Депозит оплачен') { totals.paid += deposit; }
      });
    });
    totals.remaining = totals.total - totals.paid;

    const allOrders = getOrders();
    const statusCounts = { 'Не оплачено': 0, 'Депозит оплачен': 0, 'Полностью оплачено': 0, 'В пути': 0, 'Получено': 0 };
    for (const order of allOrders) {
      const s = orderStatus(order);
      if (statusCounts[s] !== undefined) statusCounts[s]++;
      else statusCounts[s] = 1;
    }

    const statusBar = `
  <div style="display:flex;gap:8px;flex-wrap:wrap;padding:0 0 16px 0">
  <span class="badge" style="cursor:pointer;background:var(--line);" onclick="appState.filterStatus=null;render()">Все: ${getOrders().length}</span>
    <span class="badge badge-unpaid" style="cursor:pointer;" onclick="appState.filterStatus='Не оплачено';render()">⏳ Не оплачено: ${statusCounts['Не оплачено']}</span>
    <span class="badge badge-deposit" style="cursor:pointer;" onclick="appState.filterStatus='Депозит оплачен';render()">💳 Депозит: ${statusCounts['Депозит оплачен']}</span>
    <span class="badge badge-paid" style="cursor:pointer;" onclick="appState.filterStatus='Полностью оплачено';render()">✅ Оплачено: ${statusCounts['Полностью оплачено']}</span>
  <span class="badge badge-paid" style="cursor:pointer;" onclick="appState.filterStatus='В пути';render()">🚚 В пути: ${statusCounts['В пути']}</span>
<span class="badge badge-received" style="cursor:pointer;" onclick="appState.filterStatus='Получено';render()">📦 Получено: ${statusCounts['Получено']}</span>
    </div>`;

    pane.innerHTML = `
  <div class="stats-bar">
    <div class="stat"><div class="stat-label">Заказов</div><div class="stat-val">${orders.length}</div><div class="stat-sub">${state.items.length} фигурок</div></div>
    <div class="stat"><div class="stat-label">Итого</div><div class="stat-val">${eur(totals.total)}</div></div>
    <div class="stat"><div class="stat-label">Уплачено</div><div class="stat-val">${eur(totals.paid)}</div></div>
    <div class="stat"><div class="stat-label">Остаток</div><div class="stat-val" style="color:var(--yellow)">${eur(totals.remaining)}</div></div>
  <div class="chart-card" style="grid-column:1/-1;">
  <div class="chart-title">📊 Полочка vs Долги</div>
  <div id="shelfChart"></div>
</div>
    </div>
    ${statusBar}

  <div class="orders-grid fade-in" style="animation-delay:120ms">
    ${orders.length ? orders.map(order => {
      const c = calcOrder(order);
      const status = orderStatus(order);
      const thumbs = order.items.slice(0, 4).map(i =>
        i.imageUrl
          ? `<img class="order-grid-thumb" src="${H(i.imageUrl)}" alt="" loading="lazy" onerror="this.style.opacity='.1'">`
          : `<div class="order-grid-thumb" style="display:flex;align-items:center;justify-content:center;font-size:20px;">📦</div>`
      ).join('');
      const extra = order.items.length > 4 ? `<div class="order-grid-thumb order-thumb-more">+${order.items.length - 4}</div>` : '';
      const orderDate = order.items[0]?.orderDate ? new Date(order.items[0].orderDate).toLocaleDateString('ru') : '—';
      const shipDate = order.items[0]?.shipDate ? new Date(order.items[0].shipDate).toLocaleDateString('ru') : '—';
      return `<div class="order-grid-card fade-in" style="animation-delay:160ms" onclick="appState.selectedOrder='${H(order.orderNumber)}';render();">
        <div class="order-grid-thumbs">${thumbs}${extra}</div>
        <div class="order-grid-body">
          <div class="order-grid-name">${H(order.orderName)}</div>
          <div class="order-grid-meta">#${H(order.orderNumber)} · ${H(order.store || '—')}</div>
          <div class="order-grid-meta">📅 Заказан: ${orderDate}</div>
          <div class="order-grid-meta">🚚 Отправлен: ${shipDate}</div>
          <div class="order-grid-footer">
            <span class="badge ${badgeClass(status)}">${H(status)}</span>
            <span class="order-total">${eur(c.total)}</span>
          </div>
        </div>
      </div>`;
    }).join('') : '<div style="color:var(--muted);padding:40px 0;text-align:center;grid-column:1/-1;">Нет заказов</div>'}
  </div>`;
    renderShelfChart();
    return;
  }

  const order = getOrders().find(o => o.orderNumber === appState.selectedOrder);
  if (!order) { appState.selectedOrder = null; renderDetail(); return; }
  const c = calcOrder(order); const status = orderStatus(order);
  const figures = order.items.map(item => {
    const priceEur = toEur(item.priceOriginal || 0, item.currency || 'EUR');
    return `<div class="figure-card animate-in" style="animation-delay:${order.items.indexOf(item) * 40}ms" onclick="openModal('${H(item.id)}')" >${item.imageUrl ? `<img class="figure-img" src="${H(item.imageUrl)}" alt="${H(item.name)}" onerror="this.style.opacity='.1'">` : `<div class="figure-img" style="display:flex;align-items:center;justify-content:center;font-size:36px;">📦</div>`}<div class="figure-body"><div class="figure-name">${H(item.name)}</div><div class="figure-meta">🏭 ${H(item.manufacturer || '—')}</div><div class="figure-meta">📅 Выход: ${H(item.releaseDate || '—')}</div><div class="figure-meta">💱 ${H(String(item.priceOriginal ?? '—'))} ${H(item.currency || '')}${item.currency && item.currency !== 'EUR' ? ` → <span style="color:var(--accent)">${eur(priceEur)}</span>` : ''}</div>${item.shopUrl ? `<a href="${H(item.shopUrl)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--accent);text-decoration:none;margin-top:6px;margin-bottom:2px;">🔗 Открыть в магазине</a>` : ''}${item.tags?.length ? `<div class="tags">${item.tags.map(t => `<span class="tag">${H(t)}</span>`).join('')}</div>` : ''} <div class="figure-card-actions"><button class="btn btn-sm" onclick="editItem('${H(item.id)}')">Редактировать</button><button class="btn btn-sm btn-danger" onclick="deleteItem('${H(item.id)}')">Удалить</button></div></div></div>`;
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
}

export function openForm(options = {}) {
  const orders = getOrders();
  const dl = document.getElementById('orderSuggestions');
  dl.innerHTML = orders.map(o => `<option value="${H(o.orderNumber)}">${H(o.orderName)}</option>`).join('');
  document.getElementById('formOverlay').style.display = 'flex';
  renderTagSuggestions();
  if (!options.skipDraft) maybeRestoreItemDraft();
}

export function closeForm() { 
  document.getElementById('formOverlay').style.display = 'none'; 
  appState.editingId = null; 
  clearForm(); 
}

export function clearForm() {
  ['fName', 'fOrder', 'fOrderName', 'fStore', 'fImg', 'fShopUrl', 'fPrice', 'fShipping', 'fDeposit', 'fMaker', 'fDateYear', 'fTags', 'fTracking', 'fOrderDate', 'fShipDate', 'fScale'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('fCurrency').value = 'JPY';
  document.getElementById('fRegion').value = 'Япония';
  document.getElementById('fStatus').value = 'Не оплачено';
  document.getElementById('eurPreview').textContent = '';
  document.getElementById('formTitle').textContent = 'Добавить фигурку';
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
  const item = state.items.find(i => i.id === id);
  if (!item) return;
  appState.editingId = id;
  document.getElementById('fName').value = item.name || '';
  document.getElementById('fOrder').value = item.orderNumber || '';
  document.getElementById('fOrderName').value = item.orderName || '';
  document.getElementById('fStore').value = item.store || '';
  document.getElementById('fRegion').value = item.region || 'Япония';
  document.getElementById('fMaker').value = item.manufacturer || '';
  const _dp = (item.releaseDate || '').split(' ');
  document.getElementById('fDateMonth').value = _dp[0] || '';
  document.getElementById('fDateYear').value = _dp[1] || '';
  document.getElementById('fTracking').value = item.tracking || '';
  document.getElementById('fScale').value = item.scale || '';
  document.getElementById('fShipMethod').value = item.shipMethod || 'small_packet';
  document.getElementById('fOrderDate').value = item.orderDate || '';
  document.getElementById('fShipDate').value = item.shipDate || '';
  document.getElementById('fImg').value = (item.imageUrls || [item.imageUrl || '']).filter(Boolean).join(', ');
  document.getElementById('fShopUrl').value = item.shopUrl || '';
  document.getElementById('fPrice').value = item.priceOriginal || '';
  document.getElementById('fCurrency').value = item.currency || 'JPY';
  document.getElementById('fShipping').value = item.shippingEur || '';
  document.getElementById('fDeposit').value = item.deposit || '';
  document.getElementById('fStatus').value = item.status || 'Не оплачено';
  document.getElementById('fTags').value = (item.tags || []).join(', ');
  document.getElementById('formTitle').textContent = 'Редактировать фигурку';
  updateEurPreview(); openForm();
}

export function deleteItem(id) {
  if (!confirm('Удалить эту фигурку?')) return;
  createLocalBackup('before-delete-item', true);
  state.items = state.items.filter(i => i.id !== id);
  if (!getOrders().find(o => o.orderNumber === appState.selectedOrder)) appState.selectedOrder = null;
  persist(); render(); toast('Удалено');
}

export function saveItem() {
  const name = document.getElementById('fName').value.trim();
  const orderNumber = document.getElementById('fOrder').value.trim();
  if (!name) { alert('Укажи название фигурки'); return; }
  if (!orderNumber) { alert('Укажи номер заказа'); return; }
  const item = {
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
    imageUrls: document.getElementById('fImg').value.split(',').map(s => s.trim()).filter(Boolean),
    imageUrl: document.getElementById('fImg').value.split(',').map(s => s.trim()).filter(Boolean)[0] || '',
    shopUrl: document.getElementById('fShopUrl').value.trim(),
    priceOriginal: parseFloat(document.getElementById('fPrice').value) || 0,
    currency: document.getElementById('fCurrency').value,
    shippingEur: parseFloat(document.getElementById('fShipping').value) || 0,
    deposit: parseFloat(document.getElementById('fDeposit').value) || 0,
    status: document.getElementById('fStatus').value,
    tags: document.getElementById('fTags').value.split(',').map(t => t.trim()).filter(Boolean),
    rateAtSave: state.rates[document.getElementById('fCurrency').value] ?? 1,
    rateAtSaveDate: appState.editingId ? (state.items.find(i => i.id === appState.editingId)?.rateAtSaveDate || new Date().toLocaleDateString('ru')) : new Date().toLocaleDateString('ru'),
    createdAt: appState.editingId ? (state.items.find(i => i.id === appState.editingId)?.createdAt || Date.now()) : Date.now(),
    hidden: appState.editingId ? (state.items.find(i => i.id === appState.editingId)?.hidden || false) : false
  };
  const wasEditing = Boolean(appState.editingId);
  if (item.tracking && item.status !== 'Получено' && item.status !== 'В пути') { item.status = 'В пути'; }
  if (appState.editingId) { const idx = state.items.findIndex(i => i.id === appState.editingId); state.items[idx] = item; }
  else state.items.push(item);
  appState.selectedOrder = orderNumber;
  if (!wasEditing) clearItemDraft();
  closeForm(); persist(); render(); toast(wasEditing ? 'Сохранено' : 'Фигурка добавлена!');
}

export function loadSettings() {
  const s = state.settings || {};
  document.getElementById('sRegion').value = s.region || 'Япония';
  document.getElementById('sCurrency').value = s.currency || 'JPY';
  document.getElementById('sStore').value = s.store || '';
  document.getElementById('sShipMethod').value = s.shipMethod || 'small_packet';
  document.getElementById('sScriptUrl').value = s.scriptUrl || '';
  document.getElementById('sTgBotToken').value = s.tgBotToken || '';
  document.getElementById('sTgChatId').value = s.tgChatId || '';

  const orders = getOrders();
  const received = state.items.filter(i => i.status === 'Получено').length;
  document.getElementById('settingsStats').innerHTML = `${state.items.length} фигурок · ${orders.length} заказов · ${received} получено · ${state.wishlist?.length || 0} в вишлисте`;
}

export function saveSettings() {
  state.settings = {
    region: document.getElementById('sRegion').value,
    currency: document.getElementById('sCurrency').value,
    store: document.getElementById('sStore').value,
    shipMethod: document.getElementById('sShipMethod').value,
    scriptUrl: document.getElementById('sScriptUrl').value.trim(),
    tgBotToken: document.getElementById('sTgBotToken').value.trim(),
    tgChatId: document.getElementById('sTgChatId').value.trim()
  };
  persist();
}

export function clearAllData() {
  if (!confirm('Удалить ВСЕ данные? Это действие нельзя отменить!')) return;
  if (!confirm('Ты уверен? Все фигурки и вишлист будут удалены.')) return;
  createLocalBackup('before-clear', true);
  state.items = []; state.wishlist = [];
  appState.selectedOrder = null;
  persist(); render(); toast('🗑️ Все данные удалены');
}

export function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `figure-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); URL.revokeObjectURL(a.href); toast('📤 Бекап сохранён');
}

export function toggleOrderHidden(orderNumber) {
  state.items.forEach(i => { if (i.orderNumber === orderNumber) i.hidden = !i.hidden; });
  persist(); render();
  toast(state.items.find(i => i.orderNumber === orderNumber)?.hidden ? '🙈 Заказ скрыт' : '👁️ Заказ показан');
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
      ${[['📦 Получено', shelfValue, '#a78bfa'],['🚚 В пути', inTransitValue, '#4ade80'],['✅ Оплачено', prepaidValue, '#67e8f9'],['💳 Депозит', depositValue, '#fbbf24'],['⏳ Не оплачено', unpaidValue, '#f87171']].map(([label, val, color]) => `
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
  persist(); render(); toast('Заказ полностью оплачен ✅');
}

export function receiveWholeOrder(orderNumber) {
  state.items.forEach(i => { if (i.orderNumber === orderNumber) i.status = 'Получено'; });
  persist(); render(); renderShelf(); toast('✅ Весь заказ получен! Фигурки добавлены на полку 🗂️');
}

export function renderTagSuggestions() {
  const allTags = [...new Set(state.items.flatMap(i => i.tags || []).filter(Boolean))].sort();
  const input = document.getElementById('fTags');
  const container = document.getElementById('tagSuggestions');
  if (!container || !input) return;
  const current = input.value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  const suggestions = allTags.filter(t => !current.includes(t.toLowerCase()));
  if (!suggestions.length) { container.innerHTML = ''; return; }
  container.innerHTML = suggestions.map(tag => `<span onclick="addTag('${H(tag)}')" style="background:rgba(103,232,249,.1);border:1px solid rgba(103,232,249,.2);color:var(--accent);border-radius:999px;padding:3px 10px;font-size:11px;font-weight:600;cursor:pointer;transition:all .15s;">+ ${H(tag)}</span>`).join('');
}

export function addTag(tag) {
  const input = document.getElementById('fTags');
  const current = input.value.split(',').map(t => t.trim()).filter(Boolean);
  if (!current.includes(tag)) { current.push(tag); input.value = current.join(', '); }
  renderTagSuggestions();
}

export function renderGallery() {
  const q = (document.getElementById('gallerySearch')?.value || '').trim().toLowerCase();
  const sort = document.getElementById('gallerySort')?.value || 'newest';
  const makerF = document.getElementById('galleryMaker')?.value || '';
  let items = state.items.filter(i => !i.hidden);

  const makers = [...new Set(items.map(i => i.manufacturer).filter(Boolean))].sort();
  const makerSel = document.getElementById('galleryMaker');
  if (makerSel) {
    const cur = makerSel.value;
    makerSel.innerHTML = '<option value="">Все производители</option>' + makers.map(m => `<option value="${H(m)}" ${m === cur ? 'selected' : ''}>${H(m)}</option>`).join('');
  }

  if (q) items = items.filter(i => [i.name, i.manufacturer, i.store, ...(i.tags || [])].join(' ').toLowerCase().includes(q));
  if (makerF) items = items.filter(i => i.manufacturer === makerF);

  items.sort((a, b) => {
    if (sort === 'newest') return (b.createdAt || 0) - (a.createdAt || 0);
    if (sort === 'name') return (a.name || '').localeCompare(b.name || '');
    if (sort === 'price-desc') return toEur(b.priceOriginal || 0, b.currency || 'EUR') - toEur(a.priceOriginal || 0, a.currency || 'EUR');
    if (sort === 'price-asc') return toEur(a.priceOriginal || 0, a.currency || 'EUR') - toEur(b.priceOriginal || 0, b.currency || 'EUR');
    return 0;
  });

  const stats = document.getElementById('galleryStats');
  if (stats) stats.innerHTML = `<div style="font-size:13px;color:var(--muted);margin-bottom:14px;">${items.length} фигурок${makerF ? ` · ${H(makerF)}` : ''}</div>`;
  const grid = document.getElementById('galleryGrid');
  if (!items.length) { grid.innerHTML = '<div style="color:var(--muted);text-align:center;padding:60px 0;">Ничего не найдено</div>'; return; }

  grid.innerHTML = items.map((item, idx) => {
    const priceEur = toEur(item.priceOriginal || 0, item.currency || 'EUR');
    const imgs = item.imageUrls?.length ? item.imageUrls : item.imageUrl ? [item.imageUrl] : [];
    if (imgs.length === 0) {
      return `<div class="gallery-card animate-in" style="animation-delay:${idx * 20}ms; position: relative; aspect-ratio: 1;" onclick="openModal('${H(item.id)}')"><div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-size:40px; opacity:0.3; background:#111;">📦</div><div class="gallery-overlay"><div class="gallery-name">${H(item.name)}</div>${priceEur ? `<div class="gallery-price">€${priceEur.toFixed(2)}</div>` : ''}</div></div>`;
    }
    return imgs.map((img, imgIdx) => `<div class="gallery-card animate-in" style="animation-delay:${(idx + imgIdx) * 20}ms; position: relative; align-self: start;" onclick="openModal('${H(item.id)}')"><img class="zoomable" src="${H(img)}" loading="lazy" alt="${H(item.name)}" style="width: 100%; height: auto; display: block;" onerror="this.closest('.gallery-card').style.display='none'" onclick="event.stopPropagation(); openLightbox('${H(img)}', 'gallery')"><div class="gallery-overlay"><div class="gallery-name">${H(item.name)} ${imgs.length > 1 ? `<span style="font-size:11px;opacity:0.7">(${imgIdx + 1}/${imgs.length})</span>` : ''}</div>${priceEur && imgIdx === 0 ? `<div class="gallery-price">€${priceEur.toFixed(2)}</div>` : ''}</div></div>`).join('');
  }).join('');
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
  if (data.upcoming?.length) notices.push({ type: 'upcoming', text: `🔔 Скоро выходят: ${data.upcoming.slice(0, 3).map(i => `${H(i.name)} (${H(i.releaseDate)})`).join(' · ')}` });
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
  banner.style.display = 'flex'; banner.innerHTML = currentNotice.text;
}

export function getFactByTime() {
  const facts = ['🎯 Подсказка: используй теги, чтобы группировать фигурки по сериям', '💾 Делай бекапы в Google Drive, чтобы не потерять коллекцию', '📅 Можно сортировать заказы по ближайшему релизу', '🗂️ Полка показывает только полученные фигурки', '🏷️ Кликаешь по тегам в форме — они подставляются автоматически', '💡 Совет: используй фильтры, чтобы быстро находить нужные фигурки', '⚙️ Настройки позволяют менять валюту и ссылку на Google Script и телеграм-бота'];
  return facts[Math.floor(Date.now() / 60000) % facts.length];
}

export function openWishForm() { appState.editingWishId = null; clearWishForm(); document.getElementById('wishFormOverlay').style.display = 'flex'; }
export function closeWishForm() { document.getElementById('wishFormOverlay').style.display = 'none'; appState.editingWishId = null; }
export function clearWishForm() {
  ['wName', 'wStore', 'wMaker', 'wPrice', 'wDate', 'wImg', 'wShopUrl', 'wNotes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('wCurrency').value = 'JPY'; document.getElementById('wPriority').value = 'mid'; document.getElementById('wishFormTitle').textContent = 'Добавить в вишлист';
}

export function saveWish() {
  const name = document.getElementById('wName').value.trim();
  if (!name) { alert('Укажи название'); return; }
  const wish = {
    id: appState.editingWishId || crypto.randomUUID(), name, store: document.getElementById('wStore').value.trim(), manufacturer: document.getElementById('wMaker').value.trim(), priceOriginal: parseFloat(document.getElementById('wPrice').value) || 0, currency: document.getElementById('wCurrency').value, releaseDate: document.getElementById('wDate').value.trim(), imageUrls: document.getElementById('wImg').value.split(',').map(s => s.trim()).filter(Boolean), imageUrl: document.getElementById('wImg').value.split(',').map(s => s.trim()).filter(Boolean)[0] || '', shopUrl: document.getElementById('wShopUrl').value.trim(), notes: document.getElementById('wNotes').value.trim(), priority: document.getElementById('wPriority').value, createdAt: appState.editingWishId ? (state.wishlist?.find(w => w.id === appState.editingWishId)?.createdAt || Date.now()) : Date.now()
  };
  if (!state.wishlist) state.wishlist = [];
  if (appState.editingWishId) { const idx = state.wishlist.findIndex(w => w.id === appState.editingWishId); state.wishlist[idx] = wish; } else state.wishlist.push(wish);
  closeWishForm(); persist(); renderWishlist(); toast(appState.editingWishId ? 'Сохранено' : 'Добавлено в вишлист!');
}

export function deleteWish(id) {
  if (!confirm('Удалить из вишлиста?')) return;
  createLocalBackup('before-delete-wish', true);
  state.wishlist = state.wishlist.filter(w => w.id !== id); persist(); renderWishlist(); toast('Удалено');
}

export function moveWishToCollection(id) {
  const w = (state.wishlist || []).find(x => x.id === id); if (!w) return;
  closeModal();
  document.getElementById('fName').value = w.name || ''; document.getElementById('fStore').value = w.store || ''; document.getElementById('fMaker').value = w.manufacturer || '';
  const _dp = (w.releaseDate || '').split(' '); document.getElementById('fDateMonth').value = _dp[0] || ''; document.getElementById('fDateYear').value = _dp[1] || '';
  document.getElementById('fImg').value = (w.imageUrls?.length ? w.imageUrls : (w.imageUrl ? [w.imageUrl] : [])).join(', '); document.getElementById('fShopUrl').value = w.shopUrl || '';
  document.getElementById('fPrice').value = w.priceOriginal || ''; document.getElementById('fCurrency').value = w.currency || 'JPY'; document.getElementById('fTags').value = (w.tags || []).join(', ');
  updateEurPreview();
  switchTab('collection');
  document.getElementById('formTitle').textContent = 'Добавить фигурку'; appState.editingId = null; document.getElementById('formOverlay').style.display = 'flex'; toast('Заполни заказ и сохрани — фигурка перейдёт в коллекцию');
}

export function editWish(id) {
  const w = (state.wishlist || []).find(x => x.id === id); if (!w) return;
  appState.editingWishId = id;
  document.getElementById('wName').value = w.name || ''; document.getElementById('wStore').value = w.store || ''; document.getElementById('wMaker').value = w.manufacturer || ''; document.getElementById('wPrice').value = w.priceOriginal || ''; document.getElementById('wCurrency').value = w.currency || 'JPY'; document.getElementById('wDate').value = w.releaseDate || ''; document.getElementById('wImg').value = (w.imageUrls || [w.imageUrl || '']).filter(Boolean).join(', '); document.getElementById('wShopUrl').value = w.shopUrl || ''; document.getElementById('wNotes').value = w.notes || ''; document.getElementById('wPriority').value = w.priority || 'mid';
  document.getElementById('wishFormTitle').textContent = 'Редактировать'; document.getElementById('wishFormOverlay').style.display = 'flex';
}

const PRIORITY_LABEL = { 'high': '🔥 Куплю точно', 'mid': '⭐ Хочу', 'low': '💭 Если дёшево' };
const PRIORITY_COLOR = { 'high': 'var(--red)', 'mid': 'var(--yellow)', 'low': 'var(--muted)' };

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
  const grid = document.getElementById('wishGrid');
  if (!grid) return;
  if (!wishes.length) { grid.innerHTML = '<div style="color:var(--muted);padding:40px 0;grid-column:1/-1;text-align:center;">Вишлист пуст — добавь первую мечту! ⭐</div>'; return; }
  grid.innerHTML = wishes.map(w => {
    const priceEur = toEur(w.priceOriginal || 0, w.currency || 'EUR');
    return `<div class="wish-card animate-in" style="animation-delay:${wishes.indexOf(w) * 40}ms" onclick="openWishModal('${H(w.id)}')">${w.imageUrl ? `<img class="wish-img" src="${H(w.imageUrl)}" loading="lazy" alt="${H(w.name)}" onerror="this.style.opacity='.1'">` : `<div class="wish-img" style="display:flex;align-items:center;justify-content:center;font-size:48px;">⭐</div>`}<div class="wish-body"><div class="wish-name">${H(w.name)}</div><div class="wish-meta">${H(w.store || '—')}</div><div class="wish-price" style="color:${PRIORITY_COLOR[w.priority]}">${PRIORITY_LABEL[w.priority]}</div>${w.priceOriginal ? `<div class="wish-meta" style="color:var(--accent);margin-top:4px;">~€${priceEur}</div>` : ''}</div></div>`;
  }).join('');
}

export function openWishModal(id) {
  const w = (state.wishlist || []).find(x => x.id === id); if (!w) return;
  const priceEur = toEur(w.priceOriginal || 0, w.currency || 'EUR');
  const imgs = w.imageUrls?.length ? w.imageUrls : (w.imageUrl ? [w.imageUrl] : []);
  let imgIdx = 0; const modalImg = document.getElementById('modalImg');
  function updateWishModalImg() {
    modalImg.src = imgs[imgIdx] || ''; modalImg.style.display = imgs.length ? 'block' : 'none'; modalImg.className = 'modal-img ' + (imgs.length ? 'zoomable' : '');
    modalImg.onclick = imgs.length ? () => openLightbox(imgs[imgIdx], w.name) : null;
    document.getElementById('modalImgCounter').textContent = imgs.length > 1 ? `${imgIdx + 1} / ${imgs.length}` : '';
    document.getElementById('modalImgPrev').style.display = imgs.length > 1 ? 'flex' : 'none'; document.getElementById('modalImgNext').style.display = imgs.length > 1 ? 'flex' : 'none';
  }
  document.getElementById('modalImgPrev').onclick = () => { imgIdx = (imgIdx - 1 + imgs.length) % imgs.length; updateWishModalImg(); };
  document.getElementById('modalImgNext').onclick = () => { imgIdx = (imgIdx + 1) % imgs.length; updateWishModalImg(); };
  updateWishModalImg();
  document.getElementById('modalName').textContent = w.name || '—';
  document.getElementById('modalRows').innerHTML = `<div class="modal-row"><span class="modal-label">Приоритет</span><span style="color:${PRIORITY_COLOR[w.priority]}">${PRIORITY_LABEL[w.priority]}</span></div><div class="modal-row"><span class="modal-label">Магазин</span><span>${H(w.store || '—')}</span></div><div class="modal-row"><span class="modal-label">Производитель</span><span>${H(w.manufacturer || '—')}</span></div><div class="modal-row"><span class="modal-label">Дата выхода</span><span>${H(w.releaseDate || '—')}</span></div>${w.priceOriginal ? `<div class="modal-row"><span class="modal-label">Цена</span><span>${w.priceOriginal} ${w.currency} → <strong style="color:var(--green)">€${priceEur}</strong></span></div>` : ''}${w.notes ? `<div class="modal-row"><span class="modal-label">Заметки</span><span>${H(w.notes)}</span></div>` : ''}${w.shopUrl ? `<div class="modal-row"><span class="modal-label">Страница товара</span><a href="${H(w.shopUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:none;display:inline-flex;align-items:center;gap:4px;">Открыть в магазине </a></div>` : ''}`;
  document.getElementById('modalMove').style.display = 'flex'; document.getElementById('modalMove').onclick = () => moveWishToCollection(id); document.getElementById('modalEdit').onclick = () => { closeModal(); editWish(id); }; document.getElementById('modalDelete').onclick = () => { if (confirm('Удалить?')) { closeModal(); deleteWish(id); } }; document.getElementById('modalOverlay').style.display = 'flex';
}

export function openModal(id) {
  document.getElementById('modalMove').style.display = 'none';
  const item = state.items.find(i => i.id === id); if (!item) return;
  appState.modalItemId = id;
  const priceEur = toEur(item.priceOriginal || 0, item.currency || 'EUR');
  document.getElementById('modalName').textContent = item.name || '—';
  document.getElementById('modalRows').innerHTML = `<div class="modal-row"><span class="modal-label">Заказ</span><span>#${H(item.orderNumber)} — ${H(item.orderName || '')}</span></div><div class="modal-row"><span class="modal-label">Магазин</span><span>${H(item.store || '—')}</span></div><div class="modal-row"><span class="modal-label">Регион</span><span>${H(item.region || '—')}</span></div><div class="modal-row"><span class="modal-label">Производитель</span><span>${H(item.manufacturer || '—')}</span></div><div class="modal-row"><span class="modal-label">Дата выхода</span><span>${H(item.releaseDate || '—')}</span></div><div class="modal-row"><span class="modal-label">Цена</span><span>${item.priceOriginal} ${item.currency} → <strong style="color:var(--green)">€${priceEur}</strong></span></div><div class="modal-row"><span class="modal-label">Доставка</span><span>€${Number(item.shippingEur || 0).toFixed(2)}</span></div><div class="modal-row"><span class="modal-label">Предоплата</span><span>€${Number(item.deposit || 0).toFixed(2)}</span></div>${item.tags?.length ? `<div class="modal-row"><span class="modal-label">Теги</span><span class="tags">${item.tags.map(t => `<span class="tag">${H(t)}</span>`).join('')}</span></div>` : ''}${item.shopUrl ? `<div class="modal-row"><span class="modal-label">Страница товара</span><a href="${H(item.shopUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:none;display:inline-flex;align-items:center;gap:4px;">Открыть в магазине</a></div>` : ''}
  ${(item.rateAtSave && item.currency !== 'EUR') ? `<div class="modal-row"><span class="modal-label">Курс при добавлении</span><span>€${item.rateAtSave.toFixed(item.currency === 'JPY' ? 5 : 4)} за 1 ${item.currency} <span style="color:var(--muted)">(${item.rateAtSaveDate || '—'})</span></span></div><div class="modal-row"><span class="modal-label">Курс сейчас</span><span>€${(state.rates[item.currency] || 1).toFixed(item.currency === 'JPY' ? 5 : 4)} за 1 ${item.currency} ${(() => { const old = item.rateAtSave || 1; const now = state.rates[item.currency] || 1; const diff = ((now - old) / old * 100).toFixed(1); const color = now > old ? 'var(--green)' : 'var(--red)'; const arrow = now > old ? '↑' : '↓'; return now === old ? '<span style="color:var(--muted)">без изменений</span>' : `<span style="color:${color}">${arrow} ${Math.abs(diff)}%</span>`; })()}</span></div>` : ''}
  <div class="modal-row"><span class="modal-label">Статус</span><span class="badge ${badgeClass(item.status)}">${H(item.status || '—')}</span></div>`;

  const imgs = item.imageUrls?.length ? item.imageUrls : (item.imageUrl ? [item.imageUrl] : []);
  let imgIdx = 0; const modalImg = document.getElementById('modalImg');
  function updateModalImg() {
    modalImg.src = imgs[imgIdx] || ''; modalImg.style.display = imgs.length ? 'block' : 'none'; modalImg.className = 'modal-img ' + (imgs.length ? 'zoomable' : '');
    modalImg.onclick = imgs.length ? () => openLightbox(imgs[imgIdx], item.id) : null;
    document.getElementById('modalImgCounter').textContent = imgs.length > 1 ? `${imgIdx + 1} / ${imgs.length}` : '';
    document.getElementById('modalImgPrev').style.display = imgs.length > 1 ? 'flex' : 'none'; document.getElementById('modalImgNext').style.display = imgs.length > 1 ? 'flex' : 'none';
  }
  
  const receiveBtn = document.getElementById('modalReceive');
  if (item.status === 'Получено') { receiveBtn.style.display = 'none'; } else {
    receiveBtn.style.display = 'flex'; receiveBtn.onclick = () => { state.items.find(i => i.id === id).status = 'Получено'; persist(); render(); renderShelf(); toast('✅ Получено! Фигурка добавлена на полку'); closeModal(); };
  }
  document.getElementById('modalImgPrev').onclick = () => { imgIdx = (imgIdx - 1 + imgs.length) % imgs.length; updateModalImg(); };
  document.getElementById('modalImgNext').onclick = () => { imgIdx = (imgIdx + 1) % imgs.length; updateModalImg(); };
  updateModalImg();
  document.getElementById('modalEdit').onclick = () => { closeModal(); editItem(id); };
  document.getElementById('modalDelete').onclick = () => { if (confirm('Удалить?')) { closeModal(); deleteItem(id); } };
  document.getElementById('modalOverlay').style.display = 'flex'; document.getElementById('modalMove').style.display = 'none';
}

export function closeModal() {
  document.getElementById('modalOverlay').style.display = 'none'; appState.modalItemId = null;
  document.getElementById('modalImgPrev').onclick = null; document.getElementById('modalImgNext').onclick = null; document.getElementById('modalImgCounter').textContent = '';
  document.getElementById('modalImgPrev').style.display = 'none'; document.getElementById('modalImgNext').style.display = 'none';
}

export function renderShelf() {
  const q = document.getElementById('shelfSearch')?.value.trim().toLowerCase() || '';
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

  let items = [...received];
  if (q) items = items.filter(i => [i.name, i.manufacturer, i.orderName, ...(i.tags || [])].join(' ').toLowerCase().includes(q));
  items.sort((a, b) => {
    if (sort === 'newest') return (b.createdAt || 0) - (a.createdAt || 0);
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'price-desc') return b.totalPaid - a.totalPaid;
    if (sort === 'price-asc') return a.totalPaid - b.totalPaid;
    return 0;
  });

  const totalSpent = received.reduce((s, i) => s + i.totalPaid, 0);
  const stats = document.getElementById('shelfStats');
  if (stats) stats.innerHTML = `<span style="color:var(--green);font-weight:700;">${received.length} фигурок</span> · итого <span style="color:var(--green);font-weight:700;">€${totalSpent.toFixed(2)}</span>`;
  const grid = document.getElementById('shelfGrid');
  if (!items.length) { grid.innerHTML = `<div style="color:var(--muted);text-align:center;padding:60px 0;grid-column:1/-1;">Полка пуста 📦</div>`; return; }
  grid.innerHTML = items.map((item, idx) => `
    <div class="gallery-card animate-in" style="animation-delay:${idx * 30}ms" onclick="openModal('${H(item.id)}')">
      <div class="gallery-img-wrap">
        ${item.imageUrl ? `<img class="zoomable" src="${H(item.imageUrl)}" loading="lazy" alt="${H(item.name)}" onerror="this.style.opacity=.1" onclick="event.stopPropagation();openLightbox('${H(item.imageUrl)}','${H(item.name)}')">` : `<div class="gallery-placeholder">🖼️</div>`}
        <div class="gallery-overlay"><div class="gallery-name">${H(item.name)}</div><div class="gallery-price">€${item.totalPaid.toFixed(2)}</div></div>
      </div>
    </div>`).join('');
}

export function openLightbox(url, context = 'gallery') {
  const overlay = document.getElementById('lightboxOverlay');
  if (!overlay) return;
  if (context === 'gallery') { appState.lightboxPhotos = [...document.querySelectorAll('#galleryGrid img.zoomable')].map(img => img.src).filter(Boolean); }
  else {
    const item = state.items.find(i => String(i.id) === String(context));
    if (item) { appState.lightboxPhotos = item.imageUrls?.length ? item.imageUrls : item.imageUrl ? [item.imageUrl] : []; }
    else { appState.lightboxPhotos = [url]; }
  }
  appState.lightboxIndex = appState.lightboxPhotos.indexOf(url);
  if (appState.lightboxIndex === -1) { appState.lightboxPhotos = [url]; appState.lightboxIndex = 0; }
  showLightboxPhoto(); overlay.style.display = 'flex'; document.addEventListener('keydown', lightboxKeyHandler);
}

export function showLightboxPhoto() {
  const imgEl = document.getElementById('lightboxImg'); const counterEl = document.getElementById('lightboxCounter');
  if (!imgEl) return;
  imgEl.src = appState.lightboxPhotos[appState.lightboxIndex];
  if (appState.lightboxPhotos.length > 1) { if (counterEl) counterEl.textContent = `${appState.lightboxIndex + 1} / ${appState.lightboxPhotos.length}`; } else { if (counterEl) counterEl.textContent = ''; }
}

export function lightboxNav(dir) {
  if (!appState.lightboxPhotos.length) return;
  appState.lightboxIndex = (appState.lightboxIndex + dir + appState.lightboxPhotos.length) % appState.lightboxPhotos.length; showLightboxPhoto();
}

export function lightboxKeyHandler(e) { if (e.key === 'ArrowRight') lightboxNav(1); if (e.key === 'ArrowLeft') lightboxNav(-1); }
export function closeLightbox() { document.getElementById('lightboxOverlay').style.display = 'none'; document.removeEventListener('keydown', lightboxKeyHandler); }
export function initLightboxTouch() {
  const overlay = document.getElementById('lightboxOverlay'); if (!overlay || appState.lightboxTouchInitialized) return;
  appState.lightboxTouchInitialized = true;
  overlay.addEventListener('touchstart', e => { if (!e.touches.length) return; appState.lightboxTouchStartX = e.touches[0].clientX; appState.lightboxTouchStartY = e.touches[0].clientY; }, { passive: true });
  overlay.addEventListener('touchend', e => {
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
    html += `<div class="${classes}"><div class="month-name"><span>${MONTH_NAMES[m]}</span><span style="font-size:12px;color:var(--muted);font-weight:normal;">${itemsInMonth.length ? itemsInMonth.length + ' шт.' : ''}</span></div><div class="month-items">${itemsInMonth.length ? itemsInMonth.map(item => `<div class="calendar-item" onclick="${item._type === 'collection' ? `openModal('${H(item.id)}')` : `openWishModal('${H(item.id)}')`}">${item.imageUrl ? `<img src="${H(item.imageUrl)}" loading="lazy">` : `<div style="width:44px;height:44px;background:var(--panel-3);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;">📦</div>`}<div class="calendar-item-info"><div class="calendar-item-name">${H(item.name)}</div><div class="calendar-item-type">${item._type === 'collection' ? '📦 В коллекции/Предзаказ' : '⭐ Вишлист'}</div></div></div>`).join('') : '<div style="font-size:12px;color:var(--faint);text-align:center;padding:14px 0;">Нет релизов</div>'}</div></div>`;
  }
  document.getElementById('calendarGrid').innerHTML = html;
}

export async function grabFromTampermonkey(target = 'main') {
  try {
    const text = await navigator.clipboard.readText();
    const data = JSON.parse(text);
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };

    if (target === 'wish') {
      setVal('wName', data.name);
      setVal('wPrice', data.price);
      setVal('wMaker', data.brand);
      setVal('wImg', data.img);
      setVal('wDate', [data.month, data.year].filter(Boolean).join(' '));
      setVal('wShopUrl', data.url);
    } else {
      setVal('fName', data.name);
      setVal('fPrice', data.price);
      setVal('fMaker', data.brand);
      setVal('fImg', data.img);
      setVal('fDateMonth', data.month);
      setVal('fDateYear', data.year);
      setVal('fShopUrl', data.url);
      updateEurPreview();
    }

    alert('✅ Успешно! Данные из Tampermonkey вставлены в форму.');
  } catch (err) { alert('Ошибка при чтении данных!'); }
}

export function autofillFromLink(target = 'main') {
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
  appState.currentTab = tab;
  closeFilters();

  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });

  const sidebar = document.querySelector('.sidebar');
  const detailPane = document.getElementById('detailPane');
  const wishlistPane = document.getElementById('wishlistPane');

  hideStandalonePanes();
  if (wishlistPane) wishlistPane.style.display = 'none';

  if (tab === 'collection') {
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
    if (wishlistPane) wishlistPane.style.display = 'block';
    renderWishlist();
    return;
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
  const orders = getOrders();
  const stores = [...new Set(orders.map(o => o.store).filter(Boolean))].sort();
  const regions = [...new Set(orders.flatMap(o => o.items.map(i => i.region)).filter(Boolean))].sort();
  const storeEl = document.getElementById('filterStore'); const regionEl = document.getElementById('filterRegion');
  if (storeEl) { const sv = storeEl.value; storeEl.innerHTML = '<option value="">Все магазины</option>' + stores.map(s => `<option value="${H(s)}"${s === sv ? ' selected' : ''}>${H(s)}</option>`).join(''); }
  if (regionEl) { const rv = regionEl.value; regionEl.innerHTML = '<option value="">Все регионы</option>' + regions.map(r => `<option value="${H(r)}"${r === rv ? ' selected' : ''}>${H(r)}</option>`).join(''); }
  renderSidebar();
  renderDetail();
  initLightboxTouch();
  updateWishlistBadge();
  if (appState.currentTab === 'wishlist') renderWishlist();
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





