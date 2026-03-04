import { normalizeDateOnly } from './orderDates.js';

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

export const normalizeMonthKey = (value) => {
  if (!value) return '';
  const raw = String(value).trim().slice(0, 7);
  return MONTH_KEY_RE.test(raw) ? raw : '';
};

export const parseHours = (value) => {
  if (value == null) return 0;
  const num = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(num) ? num : 0;
};

export const parseAmount = (value) => {
  if (value == null) return 0;
  const num = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(num) ? num : 0;
};

const normalizeOrderStatus = (status) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (['ukończone', 'ukonczone', 'zakończone', 'zakonczone', 'closed', 'zakończone'].includes(normalized)) return 'zakończone';
  if (['aktywne', 'active'].includes(normalized)) return 'aktywne';
  return normalized || 'aktywne';
};

export const resolveOrderCreatedOn = (order = {}) => {
  return normalizeDateOnly(order?.createdOn || order?.createdDate || order?.createdAt);
};

export const resolveOrderCompletedOn = (order = {}) => {
  return normalizeDateOnly(
    order?.completionDate
    || order?.completedOn
    || order?.serviceDate
    || order?.dataUkonczenia
    || order?.completedAt
  );
};

export const resolveOrderSettlementMonth = (order = {}) => {
  const explicit = normalizeMonthKey(order?.settlementMonth || order?.billingMonth);
  if (explicit) return explicit;
  const completedOn = resolveOrderCompletedOn(order);
  return completedOn ? completedOn.slice(0, 7) : '';
};

const toBillingMonthFromDate = (value) => {
  const normalized = normalizeDateOnly(value);
  if (normalized) return normalized.slice(0, 7);
  return normalizeMonthKey(value);
};

export const resolveOrderBillingMonth = (order = {}, entryDate = null) => {
  const explicitBillingMonth = normalizeMonthKey(
    order?.billingMonth
    || order?.billingMonthKey
    || order?.settlementMonth
  );
  if (explicitBillingMonth) return explicitBillingMonth;

  const normalizedStatus = normalizeOrderStatus(order?.status);
  if (normalizedStatus === 'zakończone') {
    const completedMonth = toBillingMonthFromDate(
      order?.completedDate
      || order?.completionDate
      || order?.completedOn
      || order?.completedAt
      || order?.serviceDate
      || order?.dataUkonczenia
    );
    if (completedMonth) return completedMonth;
  }

  const fallbackMonth = toBillingMonthFromDate(
    entryDate
    || order?.entryDate
    || order?.createdOn
    || order?.createdDate
    || order?.createdAt
    || new Date()
  );

  return fallbackMonth || toBillingMonthFromDate(new Date());
};

export const isOrderClosed = (order = {}) => normalizeOrderStatus(order?.status) === 'zakończone';

export const getOrderInvoicedHours = (order = {}) => parseHours(order?.invoicedHours ?? order?.wyfakturowaneGodziny ?? order?.wyfakturowane ?? 0);
export const getOrderGrossAmount = (order = {}) => parseAmount(order?.grossAmount ?? order?.kwotaBrutto ?? 0);
export const getOrderNetAmount = (order = {}) => parseAmount(order?.netAmount ?? order?.kwotaNetto ?? 0);

export const normalizeOrderForBilling = (order = {}) => {
  const createdOn = resolveOrderCreatedOn(order);
  const completionDate = resolveOrderCompletedOn(order);
  const settlementMonth = resolveOrderSettlementMonth(order);
  return {
    ...order,
    status: normalizeOrderStatus(order?.status),
    createdOn: createdOn || order?.createdOn || '',
    startDate: normalizeDateOnly(order?.startDate || order?.startAt || createdOn) || null,
    completionDate: completionDate || null,
    completedOn: completionDate || null,
    settlementMonth: settlementMonth || null,
    billingMonth: settlementMonth || null,
    invoicedHours: order?.invoicedHours ?? order?.wyfakturowaneGodziny ?? null,
    wyfakturowaneGodziny: order?.invoicedHours ?? order?.wyfakturowaneGodziny ?? null,
    grossAmount: order?.grossAmount ?? order?.kwotaBrutto ?? null,
    netAmount: order?.netAmount ?? order?.kwotaNetto ?? null
  };
};

export const buildInvoiceStatsByMonth = (orders = []) => {
  const monthStats = new Map();
  (orders || []).forEach((order) => {
    if (!isOrderClosed(order)) return;
    const monthKey = resolveOrderSettlementMonth(order);
    if (!monthKey) return;
    const current = monthStats.get(monthKey) || { invoicedHours: 0, ordersCount: 0, grossAmount: 0, netAmount: 0 };
    current.invoicedHours += getOrderInvoicedHours(order);
    current.grossAmount += getOrderGrossAmount(order);
    current.netAmount += getOrderNetAmount(order);
    current.ordersCount += 1;
    monthStats.set(monthKey, current);
  });
  return { monthStats, debug: { month: null, closed: [], active: [], duplicateEntryIds: [] } };
};
