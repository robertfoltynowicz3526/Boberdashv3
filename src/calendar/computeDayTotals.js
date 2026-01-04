const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

const normalizeDayKey = (value) => {
  if (!value) return '';
  let key = '';
  if (typeof value === 'string') key = value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    key = `${yyyy}-${mm}-${dd}`;
  }
  return DATE_KEY_RE.test(key) ? key : '';
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

let getManualDayDoc = () => null;
let getOrdersForDay = () => [];
let getLeaveKindForDay = () => null;

export const configureDayTotals = ({ manualGetter, ordersGetter, leaveGetter } = {}) => {
  if (typeof manualGetter === 'function') getManualDayDoc = manualGetter;
  if (typeof ordersGetter === 'function') getOrdersForDay = ordersGetter;
  if (typeof leaveGetter === 'function') getLeaveKindForDay = leaveGetter;
};

export const computeDayTotals = (dayStr) => {
  const key = normalizeDayKey(dayStr);
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

  const manual = readManualTotals(manualDayDoc);
  const fromOrders = sumOrderContributions(ordersForDay);
  const totals = {
    work: manual.work + fromOrders.work,
    drive: manual.drive + fromOrders.drive,
    billed: manual.billed + fromOrders.billed,
    over: manual.over + fromOrders.over,
  };

  const hasData =
    !isLeave &&
    (ordersForDay.length > 0 ||
      totals.work !== 0 ||
      totals.drive !== 0 ||
      totals.billed !== 0 ||
      totals.over !== 0);

  return { totals, isLeave, hasData, leaveKind };
};

export const __testables = {
  normalizeDayKey,
  parsePlNumber,
  readManualTotals,
  sumOrderContributions,
};
