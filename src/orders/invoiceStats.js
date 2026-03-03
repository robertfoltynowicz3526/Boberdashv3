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
  const explicit = normalizeMonthKey(order?.billingMonth);
  if (explicit) return explicit;
  const completedOn = resolveOrderCompletedOn(order);
  if (completedOn) return completedOn.slice(0, 7);
  const createdOn = resolveOrderCreatedOn(order);
  return createdOn ? createdOn.slice(0, 7) : '';
};

const normalizeOrderStatus = (status) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'ukończone' || normalized === 'ukonczone' || normalized === 'closed') return 'closed';
  if (normalized === 'aktywne' || normalized === 'active') return 'active';
  return normalized;
};

const resolveEntryMonthKey = (dayDoc = {}) => normalizeMonthKey(dayDoc?.date || dayDoc?.id || '');

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
  const assignmentMode = options?.assignmentMode === 'explicit-only' ? 'explicit-only' : 'fallback';
  const selectedYear = Number.isFinite(Number(options?.selectedYear)) ? Number(options.selectedYear) : null;
  const monthStats = new Map();
  const orderMetaMap = new Map();
  let unassignedHours = 0;
  const unassignedByYear = new Map();

  (orders || []).forEach((order) => {
    const orderId = order?.id;
    if (!orderId) return;
    orderMetaMap.set(orderId, {
      status: normalizeOrderStatus(order?.status),
      completionMonth: normalizeMonthKey(resolveOrderCompletedOn(order)),
      fallbackMonth: assignmentMode === 'explicit-only'
        ? resolveOrderExplicitBillingMonth(order)
        : resolveOrderBillingMonth(order)
    });
  });

  (calendarEntries || []).forEach((dayDoc) => {
    const entryYear = resolveEntryYear(dayDoc);
    if (Number.isFinite(selectedYear) && entryYear !== selectedYear) return;
    const entries = extractOrderEntries(dayDoc);
    const entryMonth = resolveEntryMonthKey(dayDoc);
    entries.forEach((entry) => {
      const orderId = entry?.zlecenieId ?? entry?.orderId;
      if (!orderId) return;
      const billed = readEntryInvoicedForOrderHours(entry);
      if (!billed) return;
      const orderMeta = orderMetaMap.get(orderId) || null;
      const monthKey = orderMeta?.status === 'closed'
        ? (orderMeta?.completionMonth || orderMeta?.fallbackMonth || '')
        : (entryMonth || orderMeta?.fallbackMonth || '');
      if (!monthKey) {
        unassignedHours += billed;
        if (Number.isFinite(entryYear)) {
          unassignedByYear.set(entryYear, (unassignedByYear.get(entryYear) || 0) + billed);
        }
        return;
      }
      if (assignmentMode === 'explicit-only' && Number.isFinite(selectedYear)) {
        const billingYear = Number(monthKey.slice(0, 4));
        if (billingYear !== selectedYear) return;
      }
      const current = monthStats.get(monthKey) || { invoicedHours: 0, ordersCount: 0 };
      current.invoicedHours += billed;
      current.ordersCount += 1;
      monthStats.set(monthKey, current);
    });
  });

  return { monthStats, unassignedHours, unassignedByYear };
};
