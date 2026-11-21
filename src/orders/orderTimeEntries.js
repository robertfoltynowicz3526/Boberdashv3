import { parseHours } from './invoiceStats.js';

export const ORDER_TIME_LABEL = 'Godziny fakturowane z ewidencji';
const EMPTY_TIME = { rows: [], total: 0 };

export function buildOrderTimeIndex(days) {
  const index = new Map();
  for (const day of days) {
    const date = day.id;
    const totals = new Map();
    const seen = new Map();
    for (const entry of day.zleceniaPowiazane || []) {
      const orderId = String(entry.zlecenieId ?? '').trim();
      if (!orderId) continue;
      if (entry.entryId) {
        if (!seen.has(orderId)) seen.set(orderId, new Set());
        const entries = seen.get(orderId);
        if (entries.has(entry.entryId)) continue;
        entries.add(entry.entryId);
      }
      totals.set(orderId, (totals.get(orderId) ?? 0) + parseHours(entry.fakturowane));
    }
    for (const [orderId, hours] of totals) {
      if (!index.has(orderId)) index.set(orderId, { rows: [], total: 0 });
      const summary = index.get(orderId);
      summary.rows.push({ date, hours });
      summary.total += hours;
    }
  }
  for (const { rows } of index.values()) rows.sort((a, b) => b.date.localeCompare(a.date));
  return index;
}

export const getOrderTime = (index, orderId) => index.get(String(orderId ?? '').trim()) ?? EMPTY_TIME;
