// js/collection-view.js
import { state, toEur } from './state.js';
import { H, eur, calcOrder } from './utils.js';
import { getBadgeClass } from './status.js';

const MONTH_ROOTS = ['январ', 'феврал', 'март', 'апрел', 'май', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];

function orderStatus(order) {
  const statuses = order.items.map(item => item.status);
  if (statuses.every(status => status === 'Получено')) return 'Получено';
  if (statuses.some(status => status === 'В пути')) return 'В пути';
  if (statuses.every(status => status === 'Полностью оплачено' || status === 'Получено' || status === 'В пути')) return 'Полностью оплачено';
  if (statuses.some(status => status === 'Депозит оплачен' || status === 'Полностью оплачено')) return 'Депозит оплачен';
  return 'Не оплачено';
}

function parseReleaseDate(dateStr) {
  if (!dateStr) return null;
  const source = dateStr.toLowerCase();
  const month = MONTH_ROOTS.findIndex(root => source.includes(root));
  const yearMatch = source.match(/\d{4}/);
  const year = yearMatch ? parseInt(yearMatch[0], 10) : null;
  return month !== -1 && year ? { month, year } : null;
}

export function getItemTotalEur(item) {
  return toEur(item.priceOriginal || 0, item.currency || 'EUR') + (Number(item.shippingEur) || 0);
}

export function getCollectionTotals(orders = []) {
  const totals = { total: 0, paid: 0, tax: 0 };
  orders.forEach(order => {
    const c = calcOrder(order);
    totals.total += Number(c.total);
    totals.tax += Number(c.alv) + Number(c.customs);
    const taxPerItem = order.items.length ? (Number(c.alv) + Number(c.customs)) / order.items.length : 0;
    order.items.forEach(item => {
      const itemTotal = getItemTotalEur(item);
      const deposit = Number(item.deposit) || 0;
      if (item.status === 'Получено') totals.paid += itemTotal + taxPerItem;
      else if (item.status === 'В пути' || item.status === 'Полностью оплачено') totals.paid += itemTotal;
      else if (item.status === 'Депозит оплачен') totals.paid += deposit;
    });
  });
  totals.remaining = totals.total - totals.paid;
  return totals;
}

export function getStatusCounts(orders = []) {
  const statusCounts = { 'Не оплачено': 0, 'Депозит оплачен': 0, 'Полностью оплачено': 0, 'В пути': 0, 'Получено': 0 };
  for (const order of orders) {
    const status = orderStatus(order);
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }
  return statusCounts;
}

export function releaseSortValue(item) {
  const parsed = parseReleaseDate(item.releaseDate);
  if (!parsed) return 999999;
  return parsed.year * 100 + parsed.month;
}

export function renderMiniOrderRows(orders, emptyText) {
  if (!orders.length) return `<div class="dashboard-empty">${emptyText}</div>`;
  return orders.slice(0, 5).map(order => {
    const status = orderStatus(order);
    const c = calcOrder(order);
    const img = order.items.find(item => item.imageUrl)?.imageUrl;
    return `<button class="dashboard-row" onclick="appState.selectedOrder='${H(order.orderNumber)}';render();">
      ${img ? `<img src="${H(img)}" alt="" loading="lazy" onerror="this.style.opacity='.1'">` : `<span class="dashboard-row-icon">📦</span>`}
      <span class="dashboard-row-main"><strong>${H(order.orderName)}</strong><small>#${H(order.orderNumber)} · ${H(order.store || '—')}</small></span>
      <span class="dashboard-row-side"><span class="badge ${getBadgeClass(status)}">${H(status)}</span><b>${eur(c.remaining > 0 ? c.remaining : c.total)}</b></span>
    </button>`;
  }).join('');
}

export function renderReleaseRows(items, emptyText) {
  if (!items.length) return `<div class="dashboard-empty">${emptyText}</div>`;
  return items.slice(0, 5).map(item => {
    const price = getItemTotalEur(item);
    return `<button class="dashboard-row" onclick="openModal('${H(item.id)}')">
      ${item.imageUrl ? `<img src="${H(item.imageUrl)}" alt="" loading="lazy" onerror="this.style.opacity='.1'">` : `<span class="dashboard-row-icon">📅</span>`}
      <span class="dashboard-row-main"><strong>${H(item.name)}</strong><small>${H(item.releaseDate || '—')} · ${H(item.store || '—')}</small></span>
      <span class="dashboard-row-side"><span class="badge ${getBadgeClass(item.status)}">${H(item.status || '—')}</span><b>${eur(price)}</b></span>
    </button>`;
  }).join('');
}

export function renderCollectionStatusBar(statusCounts, totalOrders = 0) {
  return `<div class="status-filter-row">
    <span class="badge" style="cursor:pointer;background:var(--line);" onclick="appState.filterStatus=null;render()">Все: ${totalOrders}</span>
    <span class="badge badge-unpaid" style="cursor:pointer;" onclick="appState.filterStatus='Не оплачено';render()">⏳ Не оплачено: ${statusCounts['Не оплачено']}</span>
    <span class="badge badge-deposit" style="cursor:pointer;" onclick="appState.filterStatus='Депозит оплачен';render()">💳 Депозит: ${statusCounts['Депозит оплачен']}</span>
    <span class="badge badge-paid" style="cursor:pointer;" onclick="appState.filterStatus='Полностью оплачено';render()">✅ Оплачено: ${statusCounts['Полностью оплачено']}</span>
    <span class="badge badge-paid" style="cursor:pointer;" onclick="appState.filterStatus='В пути';render()">🚚 В пути: ${statusCounts['В пути']}</span>
    <span class="badge badge-received" style="cursor:pointer;" onclick="appState.filterStatus='Получено';render()">📦 Получено: ${statusCounts['Получено']}</span>
  </div>`;
}

export function renderOrderGridCards(orders) {
  if (!orders.length) return '<div style="color:var(--muted);padding:40px 0;text-align:center;grid-column:1/-1;">Нет заказов</div>';
  return orders.map(order => {
    const c = calcOrder(order);
    const status = orderStatus(order);
    const thumbs = order.items.slice(0, 4).map(item =>
      item.imageUrl
        ? `<img class="order-grid-thumb" src="${H(item.imageUrl)}" alt="" loading="lazy" onerror="this.style.opacity='.1'">`
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
          <span class="badge ${getBadgeClass(status)}">${H(status)}</span>
          <span class="order-total">${eur(c.total)}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

export function renderCollectionHome({ orders, allOrders, totals, statusCounts, statusBar, itemCount }) {
  const actionOrders = allOrders
    .filter(order => ['Не оплачено', 'Депозит оплачен'].includes(orderStatus(order)))
    .sort((a, b) => calcOrder(b).remaining - calcOrder(a).remaining);
  const releaseItems = state.items
    .filter(item => item.status !== 'Получено' && item.releaseDate)
    .sort((a, b) => releaseSortValue(a) - releaseSortValue(b));
  const inWork = statusCounts['Не оплачено'] + statusCounts['Депозит оплачен'] + statusCounts['В пути'];

  return `<div class="collection-dashboard">
    <div class="stats-bar dashboard-stats">
      <div class="stat"><div class="stat-label">Заказов</div><div class="stat-val">${orders.length}</div><div class="stat-sub">${itemCount} фигурок · ${inWork} в работе</div></div>
      <div class="stat"><div class="stat-label">Итого</div><div class="stat-val">${eur(totals.total)}</div></div>
      <div class="stat"><div class="stat-label">Уплачено</div><div class="stat-val">${eur(totals.paid)}</div></div>
      <div class="stat"><div class="stat-label">Остаток</div><div class="stat-val" style="color:var(--yellow)">${eur(totals.remaining)}</div></div>
    </div>

    <div class="dashboard-focus-grid">
      <section class="dashboard-panel">
        <div class="dashboard-panel-head"><span>Нужно действие</span><small>${actionOrders.length ? `${actionOrders.length} заказов` : 'всё спокойно'}</small></div>
        <div class="dashboard-list">${renderMiniOrderRows(actionOrders, 'Нет срочных оплат')}</div>
      </section>
      <section class="dashboard-panel">
        <div class="dashboard-panel-head"><span>Ближайшие релизы</span><small>${releaseItems.length ? `${releaseItems.length} позиций` : 'нет дат'}</small></div>
        <div class="dashboard-list">${renderReleaseRows(releaseItems, 'Нет ближайших релизов')}</div>
      </section>
    </div>

    <div class="chart-card shelf-dashboard-card">
      <div class="chart-title">📊 Полочка vs Долги</div>
      <div id="shelfChart"></div>
    </div>

    ${statusBar}

    <div class="dashboard-section-head"><div><strong>Заказы</strong><span>${orders.length} по текущим фильтрам</span></div></div>
    <div class="orders-grid fade-in" style="animation-delay:120ms">${renderOrderGridCards(orders)}</div>
  </div>`;
}
