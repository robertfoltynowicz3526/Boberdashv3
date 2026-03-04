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

const RATE_BY_ORDER_TYPE = {
  S: 45,
  W: 35,
  G: 35,
  Z: 30,
  P: 0
};

const LEGACY_NET_RATIO = 0.7;
const isDevMode = Boolean(import.meta?.env?.DEV);

const warnDev = (message, payload) => {
  if (!isDevMode) return;
  console.warn(message, payload);
};

const toCents = (amount) => Math.round(parseAmount(amount) * 100);

const parseVatRate = (order = {}) => {
  const raw = parseAmount(order?.vatRate ?? order?.vat ?? order?.stawkaVat ?? order?.podatekVat ?? order?.taxRate);
  if (!Number.isFinite(raw)) return null;
  if (raw > 1) return raw / 100;
  if (raw >= 0) return raw;
  return null;
};

const readStoredGrossNet = (order = {}) => {
  const grossRaw = order?.grossAmount ?? order?.kwotaBrutto ?? order?.brutto ?? order?.gross ?? order?.valueGross;
  const netRaw = order?.netAmount ?? order?.kwotaNetto ?? order?.netto ?? order?.net ?? order?.valueNet;
  const hasGross = grossRaw != null && String(grossRaw).trim() !== '';
  const hasNet = netRaw != null && String(netRaw).trim() !== '';

  return {
    hasGross,
    hasNet,
    grossCents: hasGross ? toCents(grossRaw) : null,
    netCents: hasNet ? toCents(netRaw) : null
  };
};

export const computeOrderAmounts = (order = {}) => {
  const vatRate = parseVatRate(order);
  const { hasGross, hasNet, grossCents: storedGrossCents, netCents: storedNetCents } = readStoredGrossNet(order);

  if (hasGross && hasNet) {
    const grossCents = storedGrossCents ?? 0;
    const netCents = storedNetCents ?? 0;
    return { grossCents, netCents, vatCents: grossCents - netCents, vatRate, source: 'stored:gross+net' };
  }

  const fallbackRate = vatRate != null ? vatRate : (1 - LEGACY_NET_RATIO);
  if (hasGross) {
    const grossCents = storedGrossCents ?? 0;
    const netCents = Math.round(grossCents * (1 - fallbackRate));
    return { grossCents, netCents, vatCents: grossCents - netCents, vatRate: fallbackRate, source: 'stored:gross' };
  }
  if (hasNet) {
    const netCents = storedNetCents ?? 0;
    const grossCents = fallbackRate >= 1 ? 0 : Math.round(netCents / (1 - fallbackRate));
    return { grossCents, netCents, vatCents: grossCents - netCents, vatRate: fallbackRate, source: 'stored:net' };
  }

  const invoicedHours = getOrderInvoicedHours(order);
  const explicitRate = parseAmount(order?.stawka ?? order?.rate ?? order?.hourlyRate);
  const orderTypeRate = parseAmount(RATE_BY_ORDER_TYPE[String(order?.typZlecenia || '').trim()] ?? 0);
  const hourlyRate = explicitRate > 0 ? explicitRate : orderTypeRate;

  if (!hourlyRate && invoicedHours > 0) {
    warnDev('[billing] missing hourly rate for order amount fallback', {
      id: order?.id,
      typZlecenia: order?.typZlecenia,
      invoicedHours
    });
    return { grossCents: 0, netCents: 0, vatCents: 0, vatRate: fallbackRate, source: 'missing-rate' };
  }

  const grossCents = toCents(invoicedHours * hourlyRate);
  const netCents = Math.round(grossCents * LEGACY_NET_RATIO);
  return { grossCents, netCents, vatCents: grossCents - netCents, vatRate: fallbackRate, source: 'derived:hours*rate' };
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
export const getOrderGrossAmount = (order = {}) => computeOrderAmounts(order).grossCents / 100;
export const getOrderNetAmount = (order = {}) => computeOrderAmounts(order).netCents / 100;

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
    grossAmount: order?.grossAmount ?? order?.kwotaBrutto ?? order?.brutto ?? order?.gross ?? order?.valueGross ?? null,
    netAmount: order?.netAmount ?? order?.kwotaNetto ?? order?.netto ?? order?.net ?? order?.valueNet ?? null
  };
};

export const buildInvoiceStatsByMonth = (orders = []) => {
  const monthStats = new Map();
  (orders || []).forEach((order) => {
    if (!isOrderClosed(order)) return;
    const monthKey = resolveOrderSettlementMonth(order);
    if (!monthKey) return;
    const current = monthStats.get(monthKey) || { invoicedHours: 0, ordersCount: 0, grossAmount: 0, netAmount: 0 };
    const amounts = computeOrderAmounts(order);
    current.invoicedHours += getOrderInvoicedHours(order);
    current.grossAmount += amounts.grossCents / 100;
    current.netAmount += amounts.netCents / 100;
    current.ordersCount += 1;
    monthStats.set(monthKey, current);
  });
  return { monthStats, debug: { month: null, closed: [], active: [], duplicateEntryIds: [] } };
};
