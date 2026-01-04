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
  wolne: Boolean(flags.wolne),
  kind: flags.kind || null,
});

const normalizeFlagType = (value) => {
  const raw = (value ?? '').toString().trim().toLowerCase();
  if (!raw) return null;
  if (raw.startsWith('leave_')) return normalizeFlagType(raw.replace('leave_', ''));
  if (raw === 'l4') return 'l4';
  if (raw === 'urlop' || raw === 'url' || raw === 'leave') return 'urlop';
  if (raw === 'wolne' || raw === 'free' || raw === 'holiday' || raw === 'swieto' || raw === 'święto') return 'wolne';
  return null;
};

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

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
    const type = normalizeFlagType(flag?.type || flag?.kind || flag?.leaveKind);
    if (!type) return;
    dayFlags.set(key, {
      l4: type === 'l4',
      urlop: type === 'urlop' || type === 'wolne',
      swieto: type === 'swieto' || type === 'święto' || type === 'holiday' || type === 'wolne',
      wolne: type === 'wolne',
      kind: type,
    });
  });
}

export function setCalendarEvents(events = []) {
  const normalized = [];
  (Array.isArray(events) ? events : []).forEach((event) => {
    if (!event) return;
    let start = event.start ?? event.date;
    if (typeof start === 'string') {
      const trimmed = start.slice(0, 10);
      if (!DATE_KEY_RE.test(trimmed)) {
        console.error('[calendar] invalid event start', { start, event });
        return;
      }
      start = trimmed;
    } else if (start instanceof Date) {
      if (Number.isNaN(start.getTime())) {
        console.error('[calendar] invalid event start', { start, event });
        return;
      }
    } else {
      console.error('[calendar] invalid event start', { start, event });
      return;
    }
    normalized.push({
      ...event,
      start,
      allDay: event.allDay ?? true,
    });
  });
  cachedEvents = normalized;
}

export function getDayFlagsSync(date) {
  const key = typeof date === 'string' ? date : dateKeyFromDate(date);
  if (!key) return null;
  return dayFlags.get(key) || dailyEntries.get(key)?.flags || null;
}

export async function getDailyTotals(date) {
  try {
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
  } catch (e) {
    console.error('getDailyTotals failed:', e);
    return null;
  }
}

export async function loadEventsFromDb(start, end) {
  try {
    return cachedEvents || [];
  } catch (e) {
    console.error('loadEventsFromDb failed:', e);
    return [];
  }
}
