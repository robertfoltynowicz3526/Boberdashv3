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

export const resolveOrderInvoicedHours = (order = {}) => {
  return parseHours(order?.invoicedHours ?? order?.wyfakturowaneGodziny ?? order?.wyfakturowane ?? 0);
};

const normalizeOrderStatus = (status) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'ukończone' || normalized === 'ukonczone' || normalized === 'zakończone' || normalized === 'zakonczone' || normalized === 'closed') return 'closed';
  if (normalized === 'aktywne' || normalized === 'active') return 'active';
  return normalized;
};

export const resolveOrderExplicitBillingMonth = (order = {}) => normalizeMonthKey(order?.settlementMonth || order?.billingMonth);

export const resolveOrderBillingMonth = (order = {}) => {
  const explicitMonth = resolveOrderExplicitBillingMonth(order);
  if (explicitMonth) return explicitMonth;
  const completedOn = resolveOrderCompletedOn(order);
  return completedOn ? completedOn.slice(0, 7) : '';
};

export const normalizeOrderForBilling = (order = {}) => {
  const createdOn = resolveOrderCreatedOn(order);
  const completedOn = resolveOrderCompletedOn(order);
  const settlementMonth = resolveOrderBillingMonth({ ...order, completedOn });
  const invoicedHours = resolveOrderInvoicedHours(order);
  return {
    ...order,
    createdOn: createdOn || order?.createdOn || '',
    completedOn: completedOn || order?.completedOn || null,
    completionDate: completedOn || order?.completionDate || null,
    settlementMonth: settlementMonth || null,
    billingMonth: settlementMonth || null,
    invoicedHours,
    wyfakturowaneGodziny: invoicedHours
  };
};

export const buildInvoiceStatsByMonth = (orders = [], _calendarEntries = [], _options = {}) => {
  const monthStats = new Map();
  const debug = {
    month: null,
    closed: [],
    active: [],
    duplicateEntryIds: [],
    feb2026Entries: []
  };

  (orders || []).forEach((order) => {
    const status = normalizeOrderStatus(order?.status);
    if (status !== 'closed') return;
    const monthKey = resolveOrderBillingMonth(order);
    if (!monthKey) return;
    const billed = resolveOrderInvoicedHours(order);
    if (!billed) return;

    const current = monthStats.get(monthKey) || { invoicedHours: 0, ordersCount: 0 };
    current.invoicedHours += billed;
    current.ordersCount += 1;
    monthStats.set(monthKey, current);
  });

  return { monthStats, debug };
};
