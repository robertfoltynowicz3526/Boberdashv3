const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

const normalizeDayKey = (value) => {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = value.slice(0, 10);
    return DATE_KEY_RE.test(trimmed) ? trimmed : null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    const key = `${yyyy}-${mm}-${dd}`;
    return DATE_KEY_RE.test(key) ? key : null;
  }
  return null;
};

const normalizeNumber = (value) => {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = String(value).trim().replace(/\s/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeLeaveKind = (value) => {
  if (!value) return null;
  const upper = String(value).trim().toUpperCase();
  if (!upper) return null;
  if (upper === 'WOLNE') return 'URL';
  return upper;
};

const normalizeManualEntry = (value = {}) => ({
  work: normalizeNumber(value.work ?? value.praca ?? 0),
  drive: normalizeNumber(value.drive ?? value.jazda ?? 0),
  billed: normalizeNumber(value.billed ?? value.fakturowane ?? 0),
  over: normalizeNumber(value.over ?? value.nadgodziny ?? 0)
});

const normalizeOrdersForDay = (list = []) =>
  (Array.isArray(list) ? list : []).map((entry) => ({
    orderId: entry?.orderId ?? entry?.zlecenieId ?? null,
    billed: normalizeNumber(entry?.billed ?? entry?.fakturowane ?? 0)
  }));

const normalizeOrder = (order = {}) => ({
  id: order.id || order.orderId || '',
  status: order.status ? String(order.status) : '',
  billedValue: normalizeNumber(order.wyfakturowaneGodziny ?? order.billed ?? order.billedHours ?? order.fakturowane ?? 0),
  workValue: normalizeNumber(
    order.czasPracy ??
      order.workHours ??
      order.hours ??
      order.godziny ??
      order.robocizna ??
      order.wartosc ??
      order.kwota ??
      order.total ??
      order.motoHours ??
      order.motogodziny ??
      0
  )
});

const normalizePlannedLeaveEntry = (entry = {}) => ({
  id: entry.id || '',
  startDate: normalizeDayKey(entry.startDate || entry.start || entry.from || entry.startAt || entry.start_date) || '',
  endDate: normalizeDayKey(entry.endDate || entry.end || entry.to || entry.endAt || entry.end_date) || '',
  type: entry.type || 'Urlop planowany',
  countWorkingDays: Boolean(entry.countWorkingDays)
});

export const buildDashboardChecklistData = ({
  manualByDay,
  ordersByDay,
  leaveByDay,
  plannedLeaveEntries,
  orders
} = {}) => {
  const normalizedManualByDay = new Map();
  const normalizedOrdersByDay = new Map();
  const normalizedLeaveByDay = new Map();

  if (manualByDay instanceof Map) {
    manualByDay.forEach((value, key) => {
      const dayKey = normalizeDayKey(key);
      if (!dayKey) return;
      normalizedManualByDay.set(dayKey, normalizeManualEntry(value));
    });
  }

  if (ordersByDay instanceof Map) {
    ordersByDay.forEach((value, key) => {
      const dayKey = normalizeDayKey(key);
      if (!dayKey) return;
      normalizedOrdersByDay.set(dayKey, normalizeOrdersForDay(value));
    });
  }

  if (leaveByDay instanceof Map) {
    leaveByDay.forEach((value, key) => {
      const dayKey = normalizeDayKey(key);
      if (!dayKey) return;
      const kind = normalizeLeaveKind(value);
      if (kind) normalizedLeaveByDay.set(dayKey, kind);
    });
  } else if (leaveByDay && typeof leaveByDay === 'object') {
    Object.entries(leaveByDay).forEach(([key, value]) => {
      const dayKey = normalizeDayKey(key);
      if (!dayKey) return;
      const kind = normalizeLeaveKind(value);
      if (kind) normalizedLeaveByDay.set(dayKey, kind);
    });
  }

  const normalizedPlannedLeaveEntries = (plannedLeaveEntries || []).map(normalizePlannedLeaveEntry);
  const normalizedOrders = (orders || []).map(normalizeOrder);

  return {
    manualByDay: normalizedManualByDay,
    ordersByDay: normalizedOrdersByDay,
    leaveByDay: normalizedLeaveByDay,
    plannedLeaveEntries: normalizedPlannedLeaveEntries,
    orders: normalizedOrders
  };
};
