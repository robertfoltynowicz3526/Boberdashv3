const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

const normalizeDayKey = (value, context = '') => {
  if (!value) return '';
  let key = '';
  if (typeof value === 'string') key = value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    key = `${yyyy}-${mm}-${dd}`;
  }
  if (!DATE_KEY_RE.test(key)) {
    console.error('[calendar] invalid day key', { context, value, key });
    return '';
  }
  return key;
};

const parsePlNumber = (value) => {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = String(value).trim().replace(/\s/g, '').replace(',', '.');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
};

const readManualTotals = (manualDayDoc = {}) => ({
  work: parsePlNumber(manualDayDoc.work ?? 0),
  drive: parsePlNumber(manualDayDoc.drive ?? 0),
  billed: parsePlNumber(manualDayDoc.billed ?? 0),
  over: parsePlNumber(manualDayDoc.over ?? 0),
});

const buildOrderKey = (order) => {
  if (!order) return '';
  const entryId = order?.entryId ?? order?.id ?? null;
  if (entryId != null) return String(entryId);
  const orderId = order?.orderId ?? order?.zlecenieId ?? '';
  const client = order?.clientName ?? order?.klientNazwa ?? '';
  const work = parsePlNumber(order?.work ?? 0);
  const drive = parsePlNumber(order?.drive ?? 0);
  const billed = parsePlNumber(order?.billed ?? 0);
  const over = parsePlNumber(order?.over ?? 0);
  return [orderId, client, work, drive, billed, over].join('|');
};

const dedupeOrders = (ordersForDay = []) => {
  const seen = new Set();
  const deduped = [];
  ordersForDay.forEach((order) => {
    const key = buildOrderKey(order);
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(order);
  });
  return deduped;
};

const sumOrderContributions = (ordersForDay = []) =>
  ordersForDay.reduce(
    (acc, order) => {
      acc.work += parsePlNumber(order?.work ?? 0);
      acc.drive += parsePlNumber(order?.drive ?? 0);
      acc.billed += parsePlNumber(order?.billed ?? 0);
      acc.over += parsePlNumber(order?.over ?? 0);
      return acc;
    },
    { work: 0, drive: 0, billed: 0, over: 0 }
  );

const computeFinalTotals = (fromClients, fromManual) => ({
  work: fromClients.work + (fromClients.work === 0 ? fromManual.work : 0),
  drive: fromClients.drive + (fromClients.drive === 0 ? fromManual.drive : 0),
  billed: fromClients.billed + (fromClients.billed === 0 ? fromManual.billed : 0),
  over: fromClients.over + (fromClients.over === 0 ? fromManual.over : 0),
});

const getDebugDayKey = () => {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search || '');
    return params.get('dbgDay');
  } catch (_) {
    return null;
  }
};

let getManualDayDoc = () => null;
let getOrdersForDay = () => [];
let getLeaveKindForDay = () => null;

export const configureDayTotals = ({ manualGetter, ordersGetter, leaveGetter } = {}) => {
  if (typeof manualGetter === 'function') getManualDayDoc = manualGetter;
  if (typeof ordersGetter === 'function') getOrdersForDay = ordersGetter;
  if (typeof leaveGetter === 'function') getLeaveKindForDay = leaveGetter;
};

export const computeDayTotals = (dayStr) => {
  const key = normalizeDayKey(dayStr, 'computeDayTotals');
  if (!key) {
    return {
      totals: { work: 0, drive: 0, billed: 0, over: 0 },
      isLeave: false,
      hasData: false,
      leaveKind: null,
    };
  }

  const manualDayDoc = getManualDayDoc(key) || {};
  const ordersForDay = Array.isArray(getOrdersForDay(key)) ? getOrdersForDay(key) : [];
  const leaveKind = getLeaveKindForDay(key) || null;
  const isLeave = Boolean(leaveKind);

  const totalsFromManual = readManualTotals(manualDayDoc);
  const uniqueOrders = dedupeOrders(ordersForDay);
  const totalsFromClients = sumOrderContributions(uniqueOrders);
  const totals = computeFinalTotals(totalsFromClients, totalsFromManual);

  const hasData =
    !isLeave &&
    (uniqueOrders.length > 0 ||
      totals.work !== 0 ||
      totals.drive !== 0 ||
      totals.billed !== 0 ||
      totals.over !== 0);

  const debugKey = getDebugDayKey();
  if (debugKey && key === debugKey) {
    console.log('[dbgDay] totals', {
      day: key,
      totalsFromClients,
      totalsFromManual,
      finalTotals: totals,
    });
  }

  return { totals, isLeave, hasData, leaveKind };
};

export const __testables = {
  normalizeDayKey,
  parsePlNumber,
  readManualTotals,
  sumOrderContributions,
};
