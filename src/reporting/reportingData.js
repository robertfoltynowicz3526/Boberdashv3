import { collection, query, orderBy, startAt, endBefore, getDocs } from "firebase/firestore";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const parsePlNumber = (value) => {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = String(value).trim().replace(/\s/g, '').replace(',', '.');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
};

const normalizeDayKey = (value, context = '') => {
  if (!value) return '';
  let key = '';
  if (typeof value === 'string') key = value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    key = `${yyyy}-${mm}-${dd}`;
  }
  if (!DATE_KEY_RE.test(key)) {
    console.error('[reporting] invalid day key', { context, value, key });
    return '';
  }
  return key;
};

const normalizeLeaveKind = (value) => {
  const upper = (value ?? '').toString().trim().toUpperCase();
  if (!upper) return null;
  if (upper === 'WOLNE') return 'URL';
  if (upper === 'BRAK' || upper === 'NONE') return null;
  if (upper === 'URL' || upper === 'URLOP') return 'URL';
  if (upper === 'L4') return 'L4';
  if (upper === 'SWIETO' || upper === 'ŚWIĘTO') return 'SWIETO';
  return null;
};

const normalizeDayFlags = (flags = {}, leaveKind = null) => {
  const normalizedKind = normalizeLeaveKind(leaveKind);
  return {
    urlop: Boolean(flags.urlop) || normalizedKind === 'URL',
    l4: Boolean(flags.l4) || normalizedKind === 'L4',
    swieto: Boolean(flags.swieto) || normalizedKind === 'SWIETO'
  };
};

const readManualTotals = (dayDoc = {}) => ({
  work: parsePlNumber(dayDoc?.work ?? dayDoc?.praca ?? 0),
  drive: parsePlNumber(dayDoc?.drive ?? dayDoc?.jazda ?? 0),
  billed: parsePlNumber(dayDoc?.billed ?? dayDoc?.fakturowane ?? 0),
  over: parsePlNumber(dayDoc?.nadgodziny ?? dayDoc?.over ?? 0),
});

const buildOrderKey = (order) => {
  if (!order) return '';
  const entryId = order?.entryId ?? order?.id ?? null;
  if (entryId != null) return String(entryId);
  const orderId = order?.orderId ?? order?.zlecenieId ?? '';
  const client = order?.clientName ?? order?.klientNazwa ?? '';
  const work = parsePlNumber(order?.work ?? 0);
  const drive = parsePlNumber(order?.drive ?? 0);
  const billed = parsePlNumber(order?.billed ?? order?.fakturowane ?? 0);
  const over = parsePlNumber(order?.over ?? 0);
  return [orderId, client, work, drive, billed, over].join('|');
};

const dedupeOrders = (orders = []) => {
  const seen = new Set();
  const deduped = [];
  orders.forEach((order) => {
    const key = buildOrderKey(order);
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(order);
  });
  return deduped;
};

const resolveClientName = (orderId, entryClientName, orderIndex, resolver) => {
  if (entryClientName) return entryClientName;
  if (typeof resolver === 'function') {
    const name = resolver(orderId, entryClientName, orderIndex);
    if (name) return name;
  }
  const order = orderIndex?.get?.(orderId);
  return order?.klientNazwa || orderId || 'Zlecenie';
};

const readOrderEntries = (dayDoc = {}, orderIndex, resolver) => {
  let entries = Array.isArray(dayDoc?.zleceniaPowiazane)
    ? dayDoc.zleceniaPowiazane
    : Array.isArray(dayDoc?.powiazane)
      ? dayDoc.powiazane
      : [];

  if (!entries.length && dayDoc?.zlecenieId) {
    entries = [{
      zlecenieId: dayDoc.zlecenieId,
      klientNazwa: dayDoc.klientNazwa,
      fakturowane: parsePlNumber(dayDoc?.fakturowane ?? dayDoc?.billed ?? 0)
    }];
  }

  const mapped = entries.map((entry) => {
    const orderId = entry?.zlecenieId ?? entry?.orderId ?? dayDoc?.zlecenieId ?? null;
    const clientName = resolveClientName(orderId, entry?.klientNazwa ?? entry?.clientName ?? null, orderIndex, resolver);
    return {
      orderId,
      clientName,
      work: parsePlNumber(entry?.work ?? entry?.praca ?? 0),
      drive: parsePlNumber(entry?.drive ?? entry?.jazda ?? 0),
      billed: parsePlNumber(entry?.fakturowane ?? entry?.billed ?? 0),
      over: parsePlNumber(entry?.over ?? entry?.nadgodziny ?? 0),
    };
  });

  return dedupeOrders(mapped);
};

const normalizeDayDoc = (dayStr, rawDoc = {}, orderIndex, resolver) => {
  const leaveKindRaw = normalizeLeaveKind(rawDoc?.leaveKind ?? rawDoc?.dayLeave ?? null);
  const flags = normalizeDayFlags(rawDoc?.flags ?? {}, leaveKindRaw);
  const leaveKind = leaveKindRaw || (flags.urlop ? 'URL' : flags.l4 ? 'L4' : flags.swieto ? 'SWIETO' : null);
  return {
    dayStr,
    manual: readManualTotals(rawDoc),
    leaveKind,
    flags,
    orders: readOrderEntries(rawDoc, orderIndex, resolver),
    note: rawDoc?.notatka || ''
  };
};

export const getYearRange = (year) => {
  const startKey = `${year}-01-01`;
  const endKey = `${year + 1}-01-01`;
  return { startKey, endKey };
};

export const loadYearReportingData = async ({ db, year, orderIndex = new Map(), resolveClientName: resolver }) => {
  const { startKey, endKey } = getYearRange(year);
  const q = query(
    collection(db, "godziny_pracy"),
    orderBy("__name__"),
    startAt(startKey),
    endBefore(endKey)
  );
  const snapshot = await getDocs(q);
  const days = [];
  snapshot.forEach((docSnap) => {
    const dayStr = normalizeDayKey(docSnap.id, 'reporting.loadYearReportingData');
    if (!dayStr) return;
    days.push(normalizeDayDoc(dayStr, docSnap.data(), orderIndex, resolver));
  });
  return { year, days };
};
