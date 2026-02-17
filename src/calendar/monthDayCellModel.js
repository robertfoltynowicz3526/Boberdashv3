const DAY_STATUS_LABELS = {
  L4: 'L4',
  SWIETO: 'Święto',
  URL: 'Urlop',
  SZKOLENIE: 'Szkolenie',
  WOLNE: 'Wolne',
};

const MONTH_CLIENT_LIMIT = 3;

export const normalizeClientName = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    const candidate = value.name ?? value.clientName ?? value.klientNazwa ?? value.title ?? '';
    return String(candidate || '').trim();
  }
  return String(value).trim();
};

export const resolveDayStatus = (statusValue) => {
  if (!statusValue) return null;
  const raw = String(statusValue).trim().toUpperCase();
  const key = raw === 'SWIĘTO' ? 'SWIETO' : raw.replace('Ś', 'S');
  if (!DAY_STATUS_LABELS[key]) return null;
  return { key, label: DAY_STATUS_LABELS[key] };
};

export const readDayData = (dayKey, decorations = {}) => {
  const rawSummary = decorations.summaryByDay?.[dayKey] || null;
  const rawClients = Array.isArray(decorations.clientsByDay?.[dayKey]) ? decorations.clientsByDay[dayKey] : [];
  const rawStatus = decorations.leaveByDay?.[dayKey] || null;
  return { rawSummary, rawClients, rawStatus };
};

const toHours = (value) => Number(value) || 0;

export const buildDayCellViewModel = ({ dayKey, isOutsideMonth = false, data = {} }) => {
  const summary = data.rawSummary || null;
  const clientsForDay = [...new Set((data.rawClients || []).map(normalizeClientName).filter(Boolean))];
  const dayStatus = resolveDayStatus(data.rawStatus);

  const summaryForDay = {
    praca: toHours(summary?.praca),
    jazda: toHours(summary?.jazda),
    fakturowane: toHours(summary?.fakturowane),
    nadgodziny: toHours(summary?.nadgodziny),
  };

  const hasPositiveTotals = Object.values(summaryForDay).some((value) => value > 0);
  const hasWorkEntry = Boolean(summary)
    && ['praca', 'jazda', 'fakturowane', 'nadgodziny'].some((key) => summary?.[key] != null && summary?.[key] !== '');
  const hasAnyWork = hasPositiveTotals || hasWorkEntry;

  const flags = {
    hasAnyWork,
    hasPositiveTotals,
    hasAnyClients: clientsForDay.length > 0,
    hasStatus: Boolean(dayStatus),
  };

  return {
    date: dayKey,
    dayNumber: Number(dayKey?.slice?.(8, 10)) || null,
    isOutsideMonth,
    dayStatus,
    clientsForDay,
    visibleClients: clientsForDay.slice(0, MONTH_CLIENT_LIMIT),
    overflowCount: Math.max(clientsForDay.length - MONTH_CLIENT_LIMIT, 0),
    summaryForDay,
    flags,
  };
};

export { DAY_STATUS_LABELS };
