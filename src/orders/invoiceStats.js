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

export const resolveOrderBillingMonth = (order = {}) => {
  const explicit = normalizeMonthKey(order?.billingMonth);
  if (explicit) return explicit;
  const completedOn = resolveOrderCompletedOn(order);
  if (completedOn) return completedOn.slice(0, 7);
  const createdOn = resolveOrderCreatedOn(order);
  return createdOn ? createdOn.slice(0, 7) : '';
};

export const normalizeOrderForBilling = (order = {}) => {
  const createdOn = resolveOrderCreatedOn(order);
  const completedOn = resolveOrderCompletedOn(order);
  const billingMonth = resolveOrderBillingMonth({ ...order, createdOn, completedOn });
  return {
    ...order,
    createdOn: createdOn || order?.createdOn || '',
    completedOn: completedOn || order?.completedOn || null,
    billingMonth: billingMonth || order?.billingMonth || ''
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

export const buildInvoiceStatsByMonth = (orders = [], calendarEntries = []) => {
  const monthStats = new Map();
  const orderMonthMap = new Map();

  (orders || []).forEach((order) => {
    const orderId = order?.id;
    if (!orderId) return;
    const monthKey = resolveOrderBillingMonth(order);
    if (monthKey) orderMonthMap.set(orderId, monthKey);
  });

  const billedByOrderId = new Map();
  (calendarEntries || []).forEach((dayDoc) => {
    const entries = extractOrderEntries(dayDoc);
    entries.forEach((entry) => {
      const orderId = entry?.zlecenieId ?? entry?.orderId;
      if (!orderId) return;
      const billed = parseHours(entry?.fakturowane ?? entry?.billed ?? 0);
      if (!billed) return;
      billedByOrderId.set(orderId, (billedByOrderId.get(orderId) || 0) + billed);
    });
  });

  billedByOrderId.forEach((invoicedHours, orderId) => {
    const monthKey = orderMonthMap.get(orderId);
    if (!monthKey) return;
    const current = monthStats.get(monthKey) || { invoicedHours: 0, ordersCount: 0 };
    current.invoicedHours += invoicedHours;
    current.ordersCount += 1;
    monthStats.set(monthKey, current);
  });

  return monthStats;
};
