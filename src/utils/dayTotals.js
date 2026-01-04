// src/utils/dayTotals.js
export const parsePlNumber = (v) => {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).trim().replace(/\s/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
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

// STATUS DNIA (to samo co w radiobuttonach w modalu)
export const getLeaveKind = (dayDoc) => {
  const direct = normalizeLeaveKind(dayDoc?.leaveKind ?? dayDoc?.dayLeave ?? null);
  if (direct) return direct;
  if (dayDoc?.flags?.urlop) return 'URL';
  if (dayDoc?.flags?.l4) return 'L4';
  if (dayDoc?.flags?.swieto) return 'SWIETO';
  return null;
};

// RĘCZNE pola (góra modala)
export const readManual = (dayDoc) => {
  return {
    work:  parsePlNumber(dayDoc?.work ?? dayDoc?.praca ?? 0),
    billed:parsePlNumber(dayDoc?.billed ?? dayDoc?.fakturowane ?? 0),
    drive: parsePlNumber(dayDoc?.drive ?? dayDoc?.jazda ?? 0),
    over:  parsePlNumber(dayDoc?.nadgodziny ?? 0),
  };
};

// ŹRÓDŁO PRAWDY “zlecenia dodane do dnia” = lista pozycji widocznych w modalu (np. "F: 2.00h — Klient")
export const readDayEntries = (dayDoc) => {
  if (Array.isArray(dayDoc?.powiazane)) return dayDoc.powiazane;
  if (Array.isArray(dayDoc?.zleceniaPowiazane)) return dayDoc.zleceniaPowiazane;
  return [];
};

const buildEntryKey = (entry) => {
  if (!entry) return '';
  const entryId = entry?.entryId ?? entry?.id ?? null;
  if (entryId != null) return String(entryId);
  const orderId = entry?.zlecenieId ?? entry?.orderId ?? '';
  const kindRaw = entry?.typ ?? entry?.type ?? '';
  const kind = kindRaw ? String(kindRaw).trim().toUpperCase() : '';
  const hours = parsePlNumber(entry?.godziny ?? entry?.hours ?? entry?.h ?? 0);
  const billed = parsePlNumber(entry?.fakturowane ?? 0);
  const work = parsePlNumber(entry?.work ?? entry?.praca ?? 0);
  const drive = parsePlNumber(entry?.drive ?? entry?.jazda ?? 0);
  const over = parsePlNumber(entry?.over ?? entry?.nadgodziny ?? 0);
  const dayKey = entry?.dayStr ?? entry?.date ?? '';
  return [orderId, kind, hours, billed, work, drive, over, dayKey].join('|');
};

const dedupeEntries = (entries) => {
  const seen = new Set();
  const deduped = [];
  for (const entry of entries) {
    const key = buildEntryKey(entry);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
};

// LICZENIE Z POZYCJI DNIA BEZ “ZGADYWANIA”:
// - Preferuj format typowany: { typ/type: 'F'|'J'|'P'|'N', godziny/hours/h: number }
// - Jeśli brak typu, użyj TYLKO pól zapisywanych przez modal (np. fakturowane)
export const sumEntries = (entries) => {
  let work = 0, drive = 0, billed = 0, over = 0;

  for (const it of entries) {
    const kindRaw = it?.typ ?? it?.type ?? null;
    const kind = kindRaw ? String(kindRaw).trim().toUpperCase() : '';
    const hours = parsePlNumber(it?.godziny ?? it?.hours ?? it?.h ?? 0);

    if (kind === 'F') { billed += hours; continue; }
    if (kind === 'J') { drive += hours; continue; }
    if (kind === 'P') { work += hours; continue; }
    if (kind === 'N') { over += hours; continue; }

    billed += parsePlNumber(it?.fakturowane ?? 0);
  }

  return { work, drive, billed, over };
};

const getDebugDayKey = () => {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search || '');
    return params.get('dbgDay');
  } catch (_) {
    return null;
  }
};

const resolveDayKey = (dayDoc) => {
  const raw = dayDoc?.date ?? dayDoc?.id ?? dayDoc?.dayStr ?? dayDoc?.day ?? null;
  if (!raw) return '';
  if (typeof raw === 'string') return raw.slice(0, 10);
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const yyyy = raw.getFullYear();
    const mm = String(raw.getMonth() + 1).padStart(2, '0');
    const dd = String(raw.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return '';
};

const computeFinalTotals = (fromClients, fromManual) => ({
  work: fromClients.work + (fromClients.work === 0 ? fromManual.work : 0),
  drive: fromClients.drive + (fromClients.drive === 0 ? fromManual.drive : 0),
  billed: fromClients.billed + (fromClients.billed === 0 ? fromManual.billed : 0),
  over: fromClients.over + (fromClients.over === 0 ? fromManual.over : 0),
});

// FINAL: to ma zwrócić DOKŁADNIE to, co ma pokazać kafel w kalendarzu i co ma pokazać modal jako suma
export const computeDaySummary = (dayDoc) => {
  const leave = getLeaveKind(dayDoc);
  if (leave) return { leaveKind: leave, hasAnyData: true, summary: null }; // wolne: tylko ikona

  const totalsFromManual = readManual(dayDoc || {});
  const entries = readDayEntries(dayDoc || {});
  const uniqueEntries = dedupeEntries(entries);
  const totalsFromClients = sumEntries(uniqueEntries);
  const totals = computeFinalTotals(totalsFromClients, totalsFromManual);

  const hasAny =
    uniqueEntries.length > 0 ||
    totals.work !== 0 || totals.drive !== 0 || totals.billed !== 0 || totals.over !== 0;

  const debugKey = getDebugDayKey();
  const dayKey = resolveDayKey(dayDoc || {});
  if (debugKey && dayKey === debugKey) {
    console.log('[dbgDay] day summary', {
      day: dayKey,
      totalsFromClients,
      totalsFromManual,
      finalTotals: totals,
    });
  }

  return { leaveKind: null, hasAnyData: hasAny, summary: totals };
};
