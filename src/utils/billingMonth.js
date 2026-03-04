const padMonth = (value) => String(value).padStart(2, '0');

const toMonthKey = (value) => {
  if (!value) return '';

  if (typeof value?.toDate === 'function') {
    return toMonthKey(value.toDate());
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return `${value.getFullYear()}-${padMonth(value.getMonth() + 1)}`;
  }

  if (typeof value === 'number') {
    return toMonthKey(new Date(value));
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';

    const normalized = trimmed.replace(/[./]/g, '-');
    const monthMatch = normalized.match(/^(\d{4})-(\d{1,2})$/);
    if (monthMatch) {
      const [, year, month] = monthMatch;
      return `${year}-${padMonth(month)}`;
    }

    const parsed = new Date(normalized.length >= 10 ? normalized.slice(0, 10) : normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${padMonth(parsed.getMonth() + 1)}`;
    }
  }

  return '';
};

export const resolveOrderBillingMonth = (order, entryDate) => {
  const explicitMonth =
    toMonthKey(order?.billingMonth) ||
    toMonthKey(order?.billingMonthKey) ||
    toMonthKey(order?.settlementMonth);
  if (explicitMonth) return explicitMonth;

  const normalizedStatus = String(order?.status || '').trim().toLowerCase();
  const isCompleted = normalizedStatus === 'zakończone' || normalizedStatus === 'ukończone' || normalizedStatus === 'ukonczone';
  if (isCompleted) {
    const completedMonth = toMonthKey(order?.completedDate || order?.dataUkonczenia || order?.closeDate || order?.closedAt || order?.endAt);
    if (completedMonth) return completedMonth;
  }

  return toMonthKey(entryDate) || toMonthKey(new Date());
};
