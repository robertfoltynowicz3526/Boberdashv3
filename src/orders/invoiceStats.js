import { normalizeDateOnly } from './orderDates.js';

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

export const normalizeMonthKey = (value) => {
  if (!value) return '';
  const raw = String(value).trim().slice(0, 7);
  return MONTH_KEY_RE.test(raw) ? raw : '';
};

const parseHours = (value) => {
  if (value == null) return 0;
  const num = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(num) ? num : 0;
};

const readEntryInvoicedForOrderHours = (entry = {}) => {
  return parseHours(
    entry?.invoicedForOrderHours
    ?? entry?.fakturowaneDlaZlecenia
    ?? entry?.fakturowane
    ?? entry?.billed
    ?? 0
  );
};

export const resolveOrderCreatedOn = (order = {}) => {
  return normalizeDateOnly(order?.createdOn || order?.createdDate || order?.createdAt);
};

export const resolveOrderCompletedOn = (order = {}) => {
  return normalizeDateOnly(
    order?.completedOn
    || order?.completionDate
    || order?.serviceDate
    || order?.dataUkonczenia
    || order?.completedAt
  );
};

export const resolveOrderBillingMonth = (order = {}) => {
  const completedOn = resolveOrderCompletedOn(order);
  if (completedOn) return completedOn.slice(0, 7);
  const createdOn = resolveOrderCreatedOn(order);
  return createdOn ? createdOn.slice(0, 7) : '';
};

const normalizeOrderStatus = (status) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'ukończone' || normalized === 'ukonczone' || normalized === 'zakończone' || normalized === 'zakonczone' || normalized === 'closed') return 'closed';
  if (normalized === 'aktywne' || normalized === 'active') return 'active';
  return normalized;
};

const resolveDayDateKey = (dayDoc = {}) => {
  const raw = String(dayDoc?.dateKey || dayDoc?.dayStr || dayDoc?.date || dayDoc?.id || '').trim();
  const dateKey = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : '';
};

const resolveEntryMonthKey = (dayDoc = {}) => {
  const dateKey = resolveDayDateKey(dayDoc);
  return dateKey ? dateKey.slice(0, 7) : '';
};

export const resolveOrderExplicitBillingMonth = (order = {}) => normalizeMonthKey(order?.billingMonth);

export const normalizeOrderForBilling = (order = {}) => {
  const createdOn = resolveOrderCreatedOn(order);
  const completedOn = resolveOrderCompletedOn(order);
  const explicitBillingMonth = resolveOrderExplicitBillingMonth(order);
  const resolvedBillingMonth = resolveOrderBillingMonth({ ...order, createdOn, completedOn });
  return {
    ...order,
    createdOn: createdOn || order?.createdOn || '',
    completedOn: completedOn || order?.completedOn || null,
    billingMonth: explicitBillingMonth || null,
    resolvedBillingMonth: resolvedBillingMonth || null
  };
};

const extractOrderEntries = (dayDoc = {}) => {
  let entries = Array.isArray(dayDoc?.zleceniaPowiazane)
    ? dayDoc.zleceniaPowiazane
    : Array.isArray(dayDoc?.powiazane)
      ? dayDoc.powiazane
      : [];

  if (!entries.length && dayDoc?.zlecenieId) {
    entries = [{
      zlecenieId: dayDoc.zlecenieId,
      fakturowane: dayDoc?.fakturowane ?? dayDoc?.billed ?? 0
    }];
  }

  return entries;
};

const resolveEntryYear = (dayDoc = {}) => {
  const key = String(dayDoc?.date || dayDoc?.id || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const year = Number(key.slice(0, 4));
    return Number.isFinite(year) ? year : null;
  }
  return null;
};

export const buildInvoiceStatsByMonth = (orders = [], calendarEntries = [], options = {}) => {
  const selectedYear = Number.isFinite(Number(options?.selectedYear)) ? Number(options.selectedYear) : null;
  const debugMonthKey = normalizeMonthKey(options?.debugMonthKey || options?.debugMonth || '');
  const debugSummaryEnabled = Boolean(options?.debugSummaryEnabled);
  const monthStats = new Map();
  const debug = {
    month: debugMonthKey || null,
    closed: [],
    active: [],
    duplicateEntryIds: [],
    feb2026Entries: []
  };
  const seenEntryIds = new Set();

  (calendarEntries || []).forEach((dayDoc) => {
    const entryYear = resolveEntryYear(dayDoc);
    if (Number.isFinite(selectedYear) && entryYear !== selectedYear) return;
    const dayDateKey = resolveDayDateKey(dayDoc);
    const entryMonth = dayDateKey ? dayDateKey.slice(0, 7) : resolveEntryMonthKey(dayDoc);
    const entries = extractOrderEntries(dayDoc);
    entries.forEach((entry, index) => {
      const orderId = entry?.zlecenieId ?? entry?.orderId;
      if (!orderId) return;
      const billed = readEntryInvoicedForOrderHours(entry);
      if (!billed) return;
      const sourceEntryId = String(
        entry?.entryId
        || entry?.id
        || `${dayDoc?.id || dayDoc?.date || 'unknown-day'}:${index}:${orderId}`
      );
      if (seenEntryIds.has(sourceEntryId)) {
        debug.duplicateEntryIds.push(sourceEntryId);
        return;
      }
      seenEntryIds.add(sourceEntryId);
      if (!entryMonth) return;

      const current = monthStats.get(entryMonth) || { invoicedHours: 0, ordersCount: 0 };
      current.invoicedHours += billed;
      current.ordersCount += 1;
      monthStats.set(entryMonth, current);

      if (debugMonthKey && entryMonth === debugMonthKey) {
        debug.active.push({ orderId, monthTotal: billed, entryId: sourceEntryId });
      }

      if (debugSummaryEnabled && selectedYear === 2026 && entryMonth === '2026-02') {
        debug.feb2026Entries.push({
          entryId: sourceEntryId,
          dateKey: dayDateKey,
          orderId,
          fakturowane: billed
        });
      }
    });
  });

  if (debugMonthKey) {
    debug.closed.sort((a, b) => String(a.orderId).localeCompare(String(b.orderId)));
    debug.active.sort((a, b) => String(a.orderId).localeCompare(String(b.orderId)));
  }

  if (debug.duplicateEntryIds.length) {
    console.warn('[InvoiceStats] Duplicate entry ids detected during monthly aggregation', {
      duplicateCount: debug.duplicateEntryIds.length,
      duplicateEntryIds: debug.duplicateEntryIds
    });
  }

  if (debugSummaryEnabled && selectedYear === 2026) {
    const perOrder = debug.feb2026Entries.reduce((acc, item) => {
      const orderId = String(item.orderId || 'BRAK_ZLECENIA');
      acc[orderId] = (acc[orderId] || 0) + (Number(item.fakturowane) || 0);
      return acc;
    }, {});
    const totalFeb = debug.feb2026Entries.reduce((sum, item) => sum + (Number(item.fakturowane) || 0), 0);
    console.info('[DEBUG_SUMMARY][2026-02] entries', debug.feb2026Entries);
    console.info('[DEBUG_SUMMARY][2026-02] totals', { totalFakturowane: totalFeb, perOrderId: perOrder });
    console.info('[DEBUG_SUMMARY][2026-02] duplicateEntryIds', debug.duplicateEntryIds);
  }

  return { monthStats, debug };
};
