const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

const toNumber = (value) => {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = String(value).trim().replace(/\s/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const resolveDayKey = (value) => {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  const text = String(value).trim();
  const dayKey = text.slice(0, 10);
  if (DATE_RE.test(dayKey)) return dayKey;
  return '';
};

const resolveMonthKey = (entry = {}) => {
  const directMonth = String(entry?.monthKey || entry?.billingMonth || '').trim();
  if (MONTH_RE.test(directMonth)) return directMonth;
  const dayKey = resolveDayKey(entry?.date || entry?.id || entry?.day);
  return dayKey ? dayKey.slice(0, 7) : '';
};

const readManualDriveHours = (entry = {}) =>
  toNumber(
    entry?.drive
    ?? entry?.jazda
    ?? entry?.driveHours
    ?? entry?.czasJazdy
    ?? entry?.czas_jazdy
  );

const readLinkedDriveHours = (entry = {}) => {
  const links = Array.isArray(entry?.zleceniaPowiazane)
    ? entry.zleceniaPowiazane
    : Array.isArray(entry?.powiazane)
      ? entry.powiazane
      : [];
  return links.reduce((acc, linked) => acc + toNumber(
    linked?.driveForOrderHours
    ?? linked?.czasJazdyDlaZlecenia
    ?? linked?.driveHours
    ?? linked?.czasJazdy
    ?? linked?.drive
    ?? linked?.jazda
  ), 0);
};

export const readEntryDriveHours = (entry = {}) => readManualDriveHours(entry) + readLinkedDriveHours(entry);

export const aggregateMonthlyDriveHours = (entries = []) => {
  const totals = new Map();
  (entries || []).forEach((entry) => {
    const monthKey = resolveMonthKey(entry);
    if (!monthKey) return;
    const drive = readEntryDriveHours(entry);
    totals.set(monthKey, (totals.get(monthKey) || 0) + drive);
  });
  return totals;
};

export const getMonthlyDriveHoursFromCalendar = (entries = [], monthKey = '') => {
  if (!MONTH_RE.test(String(monthKey || ''))) return 0;
  return aggregateMonthlyDriveHours(entries).get(monthKey) || 0;
};

