const dateKeyFromDate = (date) => {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const normalizeFlags = (flags = {}) => ({
  l4: Boolean(flags.l4),
  urlop: Boolean(flags.urlop),
  swieto: Boolean(flags.swieto),
});

let dailyEntries = new Map();
let dayFlags = new Map();
let cachedEvents = [];

export function setDailyEntries(entries = []) {
  dailyEntries = new Map();
  (entries || []).forEach((entry) => {
    const key = dateKeyFromDate(entry?.date || entry?.id);
    if (!key) return;
    dailyEntries.set(key, {
      work: Number(entry.work) || 0,
      drive: Number(entry.drive) || 0,
      billed: Number(entry.billed) || 0,
      flags: normalizeFlags(entry.flags || {}),
    });
  });
}

export function setDayFlags(flags = []) {
  dayFlags = new Map();
  (flags || []).forEach((flag) => {
    const key = flag?.date ? String(flag.date) : dateKeyFromDate(flag?.start);
    if (!key) return;
    const type = String(flag.type || '').toLowerCase();
    dayFlags.set(key, {
      l4: type === 'l4',
      urlop: type === 'urlop' || type === 'wolne',
      swieto: type === 'swieto' || type === 'święto' || type === 'holiday',
    });
  });
}

export function setCalendarEvents(events = []) {
  cachedEvents = Array.isArray(events) ? [...events] : [];
}

export function getDayFlagsSync(date) {
  const key = typeof date === 'string' ? date : dateKeyFromDate(date);
  if (!key) return null;
  return dayFlags.get(key) || dailyEntries.get(key)?.flags || null;
}

export async function getDailyTotals(date) {
  const key = typeof date === 'string' ? date : dateKeyFromDate(date);
  if (!key) return { work: 0, drive: 0, billed: 0, l4: false, urlop: false, swieto: false };
  const flags = normalizeFlags(dayFlags.get(key) || dailyEntries.get(key)?.flags || {});
  if (flags.l4 || flags.urlop || flags.swieto) {
    return { work: 0, drive: 0, billed: 0, ...flags };
  }
  const day = dailyEntries.get(key);
  return {
    work: day?.work || 0,
    drive: day?.drive || 0,
    billed: day?.billed || 0,
    ...flags,
  };
}

export async function loadEventsFromDb() {
  return cachedEvents || [];
}
