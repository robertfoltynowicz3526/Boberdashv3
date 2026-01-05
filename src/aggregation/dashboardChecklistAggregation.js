const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

const normalizeDayKey = (value) => {
  if (!value) return '';
  if (typeof value === 'string') {
    const trimmed = value.slice(0, 10);
    return DATE_KEY_RE.test(trimmed) ? trimmed : '';
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return '';
};

const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

const isWeekend = (dayStr) => {
  const parsed = toDate(dayStr);
  if (!parsed) return false;
  const day = parsed.getDay();
  return day === 0 || day === 6;
};

const listDaysInclusive = (startValue, endValue) => {
  const start = toDate(startValue);
  const end = toDate(endValue);
  if (!start || !end) return [];
  const [from, to] = start <= end ? [start, end] : [end, start];
  const days = [];
  let cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const endDate = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cursor <= endDate) {
    days.push(normalizeDayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
};

const hasManualTotals = (manual = {}) => {
  if (!manual) return false;
  return [manual.work, manual.drive, manual.billed, manual.over]
    .some((val) => Number(val || 0) > 0);
};

const isLeaveUrlop = (value) => {
  if (!value) return false;
  const normalized = String(value).toUpperCase();
  return normalized === 'URL' || normalized === 'URLOP' || normalized === 'WOLNE';
};

export const getMissingSummaryDays = ({
  monthStart,
  monthEnd,
  manualByDay,
  ordersByDay,
  leaveByDay,
  countWorkingDays = true
} = {}) => {
  const days = listDaysInclusive(monthStart, monthEnd);
  const missing = [];
  days.forEach((day) => {
    if (!day) return;
    if (countWorkingDays && isWeekend(day)) return;
    if (leaveByDay?.get(day)) return;
    const manual = manualByDay?.get(day);
    const orders = ordersByDay?.get(day) || [];
    const hasManual = hasManualTotals(manual);
    const hasOrders = Array.isArray(orders) && orders.length > 0;
    if (!hasManual && !hasOrders) {
      missing.push(day);
    }
  });
  return { count: missing.length, days: missing };
};

export const getUnbilledOrders = ({ orders = [] } = {}) => {
  const finishedStatuses = new Set(['ukończone', 'ukonczone', 'zakończone', 'wykonane', 'done', 'completed']);
  const ids = [];

  (orders || []).forEach((order) => {
    if (!order?.id) return;
    const status = String(order.status || '').toLowerCase();
    const billed = Number(order.billedValue || 0);
    const workValue = Number(order.workValue || 0);
    if (status) {
      if (!finishedStatuses.has(status)) return;
      if (billed <= 0) ids.push(order.id);
      return;
    }
    if (workValue > 0 && billed <= 0) ids.push(order.id);
  });

  return { count: ids.length, ids };
};

export const getPlannedLeaveMissingCalendar = ({
  plannedLeaveEntries = [],
  leaveByDay,
  includeWeekends = true
} = {}) => {
  const missingDates = [];
  const missingByEntry = {};
  plannedLeaveEntries.forEach((entry) => {
    if (!entry?.id) return;
    const start = entry.startDate || '';
    const end = entry.endDate || entry.startDate || '';
    const days = listDaysInclusive(start, end);
    const missingForEntry = [];
    days.forEach((day) => {
      if (!day) return;
      if (!includeWeekends && isWeekend(day)) return;
      if (entry.countWorkingDays && isWeekend(day)) return;
      const leaveKind = leaveByDay?.get(day);
      if (!isLeaveUrlop(leaveKind)) {
        missingForEntry.push(day);
        missingDates.push(day);
      }
    });
    if (missingForEntry.length) missingByEntry[entry.id] = missingForEntry;
  });

  return { count: missingDates.length, dates: missingDates, byEntry: missingByEntry };
};
