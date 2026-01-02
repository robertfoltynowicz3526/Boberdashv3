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

// FINAL: to ma zwrócić DOKŁADNIE to, co ma pokazać kafel w kalendarzu i co ma pokazać modal jako suma
export const computeDaySummary = (dayDoc) => {
  const leave = getLeaveKind(dayDoc);
  if (leave) return { leaveKind: leave, hasAnyData: true, summary: null }; // wolne: tylko ikona

  const manual = readManual(dayDoc || {});
  const entries = readDayEntries(dayDoc || {});
  const fromEntries = sumEntries(entries);

  const hasEntries = entries.length > 0;
  const billedFromEntries = fromEntries.billed;
  const billed = hasEntries ? billedFromEntries : manual.billed;

  const totals = {
    work: manual.work + fromEntries.work,
    drive: manual.drive + fromEntries.drive,
    billed,
    over: manual.over + fromEntries.over,
  };

  const hasAny =
    hasEntries ||
    totals.work !== 0 || totals.drive !== 0 || totals.billed !== 0 || totals.over !== 0;

  return { leaveKind: null, hasAnyData: hasAny, summary: totals };
};
