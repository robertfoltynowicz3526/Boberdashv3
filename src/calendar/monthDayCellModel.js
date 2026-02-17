const DAY_STATUS_LABELS = {
  L4: 'L4',
  SWIETO: 'Święto',
  URL: 'Urlop',
  SZKOLENIE: 'Szkolenie',
  WOLNE: 'Wolne',
};

const MONTH_CLIENT_LIMIT = 2;

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
  const clients = [...new Set((data.rawClients || []).map(normalizeClientName).filter(Boolean))];
  const status = resolveDayStatus(data.rawStatus);

  const totals = {
    praca: toHours(summary?.praca),
    jazda: toHours(summary?.jazda),
    fakturowane: toHours(summary?.fakturowane),
    nadgodziny: toHours(summary?.nadgodziny),
  };

  const hasPositiveTotals = Object.values(totals).some((value) => value > 0);
  const hasTimeEntries = Boolean(summary)
    && ['praca', 'jazda', 'fakturowane', 'nadgodziny'].some((key) => summary?.[key] != null && summary?.[key] !== '');
  const hasRelatedEntries = clients.length > 0 || hasTimeEntries;

  const hasData = Boolean(status) || clients.length > 0 || hasPositiveTotals;
  const hasSummary = hasPositiveTotals || hasRelatedEntries;
  const hasChips = Boolean(status) || clients.length > 0;

  return {
    dateKey: dayKey,
    dayNumber: Number(dayKey?.slice?.(8, 10)) || null,
    isOutsideMonth,
    status,
    clients,
    visibleClients: clients.slice(0, MONTH_CLIENT_LIMIT),
    overflowCount: Math.max(clients.length - MONTH_CLIENT_LIMIT, 0),
    totals,
    hasData,
    hasSummary,
    hasChips,
  };
};

export { DAY_STATUS_LABELS };
