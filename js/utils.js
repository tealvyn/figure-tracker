// js/utils.js
import { state, toEur } from './state.js';

export function H(v) { 
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); 
}

export function eur(n) { 
  return '€' + Number(n || 0).toFixed(2); 
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
  const storeName = (order.store || '').toLowerCase();
  const isOrzGK = storeName.includes('orzgk') || storeName.includes('orz');
  const isEU = ['ЕС'].includes(order.items[0]?.region?.trim().toUpperCase()) || isOrzGK;
  
  const goodsEur = order.items.reduce((s, i) => s + toEur(i.priceOriginal || 0, i.currency || 'EUR'), 0);
  const shippingEur = Math.max(0, ...order.items.map(i => Number(i.shippingEur || 0)));
  const taxBase = +(goodsEur + shippingEur).toFixed(2);
  
  const alv = isEU ? 0 : +(taxBase * 0.255).toFixed(2);
  const customs = isEU ? 0 : (taxBase > 150 ? +(taxBase * 0.047).toFixed(2) : 0);
  const total = +(taxBase + alv + customs).toFixed(2);
  const deposit = Math.max(0, ...order.items.map(i => Number(i.deposit || 0)));
  const remaining = +Math.max(total - deposit, 0).toFixed(2);
  
  return { goodsEur, shippingEur, taxBase, alv, customs, total, deposit, remaining, isEU };
}