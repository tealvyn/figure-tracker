// js/status.js
export const STATUS_KEYS = {
  WISHLIST: 'wishlist',
  PRE_ORDER: 'pre_order',
  UNPAID: 'unpaid',
  DEPOSIT_PAID: 'deposit_paid',
  PAID: 'paid',
  SHIPPING: 'shipping',
  RECEIVED: 'received',
  OWNED: 'owned',
  SOLD: 'sold',
  HIDDEN: 'hidden',
  ARCHIVE: 'archive'
};

const STATUS_ALIASES = {
  'Не оплачено': STATUS_KEYS.UNPAID,
  'Депозит оплачен': STATUS_KEYS.DEPOSIT_PAID,
  'Полностью оплачено': STATUS_KEYS.PAID,
  'В пути': STATUS_KEYS.SHIPPING,
  'Получено': STATUS_KEYS.RECEIVED,
  wishlist: STATUS_KEYS.WISHLIST,
  pre_order: STATUS_KEYS.PRE_ORDER,
  unpaid: STATUS_KEYS.UNPAID,
  deposit_paid: STATUS_KEYS.DEPOSIT_PAID,
  paid: STATUS_KEYS.PAID,
  shipping: STATUS_KEYS.SHIPPING,
  in_transit: STATUS_KEYS.SHIPPING,
  received: STATUS_KEYS.RECEIVED,
  owned: STATUS_KEYS.OWNED,
  sold: STATUS_KEYS.SOLD,
  hidden: STATUS_KEYS.HIDDEN,
  archive: STATUS_KEYS.ARCHIVE
};

const RU_LABELS = {
  [STATUS_KEYS.WISHLIST]: 'Вишлист',
  [STATUS_KEYS.PRE_ORDER]: 'Предзаказ',
  [STATUS_KEYS.UNPAID]: 'Не оплачено',
  [STATUS_KEYS.DEPOSIT_PAID]: 'Депозит оплачен',
  [STATUS_KEYS.PAID]: 'Полностью оплачено',
  [STATUS_KEYS.SHIPPING]: 'В пути',
  [STATUS_KEYS.RECEIVED]: 'Получено',
  [STATUS_KEYS.OWNED]: 'В коллекции',
  [STATUS_KEYS.SOLD]: 'Продано',
  [STATUS_KEYS.HIDDEN]: 'Скрыто',
  [STATUS_KEYS.ARCHIVE]: 'Архив'
};

const EN_LABELS = {
  [STATUS_KEYS.WISHLIST]: 'Wishlist',
  [STATUS_KEYS.PRE_ORDER]: 'Pre-order',
  [STATUS_KEYS.UNPAID]: 'Unpaid',
  [STATUS_KEYS.DEPOSIT_PAID]: 'Deposit paid',
  [STATUS_KEYS.PAID]: 'Paid',
  [STATUS_KEYS.SHIPPING]: 'Shipping',
  [STATUS_KEYS.RECEIVED]: 'Received',
  [STATUS_KEYS.OWNED]: 'Owned',
  [STATUS_KEYS.SOLD]: 'Sold',
  [STATUS_KEYS.HIDDEN]: 'Hidden',
  [STATUS_KEYS.ARCHIVE]: 'Archive'
};

const BADGE_CLASSES = {
  [STATUS_KEYS.UNPAID]: 'badge-unpaid',
  [STATUS_KEYS.DEPOSIT_PAID]: 'badge-deposit',
  [STATUS_KEYS.PAID]: 'badge-paid',
  [STATUS_KEYS.SHIPPING]: 'badge-paid',
  [STATUS_KEYS.RECEIVED]: 'badge-received',
  [STATUS_KEYS.SOLD]: 'badge-unpaid',
  [STATUS_KEYS.HIDDEN]: 'badge-unpaid',
  [STATUS_KEYS.ARCHIVE]: 'badge-unpaid'
};

const ORDER_STATUS_CLASSES = {
  [STATUS_KEYS.UNPAID]: 'status-unpaid',
  [STATUS_KEYS.DEPOSIT_PAID]: 'status-deposit',
  [STATUS_KEYS.PAID]: 'status-paid',
  [STATUS_KEYS.SHIPPING]: 'status-paid',
  [STATUS_KEYS.RECEIVED]: 'status-paid'
};

const STATUS_COLORS = {
  [STATUS_KEYS.UNPAID]: '#f87171',
  [STATUS_KEYS.DEPOSIT_PAID]: '#fbbf24',
  [STATUS_KEYS.PAID]: '#4ade80',
  [STATUS_KEYS.SHIPPING]: '#4ade80',
  [STATUS_KEYS.RECEIVED]: '#a78bfa',
  [STATUS_KEYS.SOLD]: '#f87171',
  [STATUS_KEYS.HIDDEN]: '#8899aa',
  [STATUS_KEYS.ARCHIVE]: '#8899aa'
};

export function normalizeStatus(value) {
  const text = String(value || '').trim();
  if (!text) return STATUS_KEYS.UNPAID;
  return STATUS_ALIASES[text] || text;
}

export function getStatusLabel(status, lang = 'ru') {
  const key = normalizeStatus(status);
  const labels = lang === 'en' ? EN_LABELS : RU_LABELS;
  return labels[key] || String(status || '');
}

export function getBadgeClass(status) {
  const key = normalizeStatus(status);
  return BADGE_CLASSES[key] || BADGE_CLASSES[STATUS_KEYS.UNPAID];
}

export function getOrderStatusClass(status) {
  const key = normalizeStatus(status);
  return ORDER_STATUS_CLASSES[key] || ORDER_STATUS_CLASSES[STATUS_KEYS.UNPAID];
}

export function getStatusClass(status) {
  return getBadgeClass(status);
}

export function getStatusColor(status) {
  const key = normalizeStatus(status);
  return STATUS_COLORS[key] || STATUS_COLORS[STATUS_KEYS.UNPAID];
}

export function isPaidStatus(status) {
  const key = normalizeStatus(status);
  return key === STATUS_KEYS.PAID || key === STATUS_KEYS.SHIPPING || key === STATUS_KEYS.RECEIVED;
}

export function isReceivedStatus(status) {
  return normalizeStatus(status) === STATUS_KEYS.RECEIVED;
}
