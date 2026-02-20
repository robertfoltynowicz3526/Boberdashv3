const toMonthKey = (value) => {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const aggregateMonthStats = (entries = [], monthKey) => {
  const totals = entries.reduce((acc, entry) => {
    if (toMonthKey(entry?.id || entry?.date) !== monthKey) return acc;
    if (entry?.leaveKind || entry?.flags?.urlop || entry?.flags?.l4 || entry?.flags?.swieto || entry?.flags?.wolne || entry?.flags?.szkolenie) return acc;
    acc.praca += Number(entry.praca || 0);
    acc.wyfakturowaneGodziny += Number(entry.fakturowane || entry.billed || 0);
    acc.nadgodziny += Number(entry.nadgodziny || 0);
    acc.jazda += Number(entry.jazda || 0);
    return acc;
  }, { praca: 0, wyfakturowaneGodziny: 0, nadgodziny: 0, jazda: 0 });
  totals.absorpcja = totals.wyfakturowaneGodziny > 0 ? (totals.wyfakturowaneGodziny / 168) * 100 : 0;
  return totals;
};

export const createMonthStatsCache = (storageKey = 'dashboardMonthStatsCache') => {
  const memory = new Map();
  const read = (key) => {
    if (memory.has(key)) return memory.get(key);
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || '{}');
      if (parsed[key]) {
        memory.set(key, parsed[key]);
        return parsed[key];
      }
    } catch (_) {}
    return null;
  };
  const write = (key, value) => {
    const record = { value, ts: Date.now() };
    memory.set(key, record);
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || '{}');
      parsed[key] = record;
      localStorage.setItem(storageKey, JSON.stringify(parsed));
    } catch (_) {}
    return record;
  };
  return { read, write };
};
