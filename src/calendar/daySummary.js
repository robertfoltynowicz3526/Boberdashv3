// src/calendar/daySummary.js
export const parsePlNumber = (v) => {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

const get = (obj, keys) => {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  }
  return undefined;
};

// UWAGA: status wolnego MUSI być brany z TEGO SAMEGO pola co w modalu (radio Brak/Urlop/L4/Święto)
export const getLeaveKind = (dayDoc) => {
  const raw =
    get(dayDoc, ['statusDnia','status','dayStatus','wolne','leave','kind','typ']) ?? 'Brak';
  const s = String(raw).trim().toUpperCase();

  if (s === 'L4') return 'L4';
  if (s === 'ŚWIĘTO' || s === 'SWIETO') return 'SWIETO';
  if (s === 'URLOP') return 'URL';
  if (s === 'BRAK' || s === '') return null;

  // jeśli masz inne statusy wolnego, dodaj tu mapowanie
  return null;
};

// RĘCZNE POLA DNIA (góra modala)
export const extractManual = (dayDoc) => ({
  work:  parsePlNumber(get(dayDoc, ['godzinyPracy','praca','workHours','work'])),
  billed:parsePlNumber(get(dayDoc, ['godzinyWyfakturowane','wyfakturowane','fakturowane','billedHours','billed','fh'])),
  drive: parsePlNumber(get(dayDoc, ['czasJazdy','jazda','driveHours','drive'])),
  over:  parsePlNumber(get(dayDoc, ['nadgodziny','over'])),
  note:  String(get(dayDoc, ['notatka','note','opis']) ?? '').trim()
});

// POZYCJE/POWIĄZANIA KLIENTÓW (to co w modalu widać jako: "F: 6.00h — Klient")
export const getLinkedEntries = (dayDoc) => {
  const lists = [
    dayDoc?.powiazane,
    dayDoc?.powiazania,
    dayDoc?.powiazaneZlecenia,
    dayDoc?.zlecenia,
    dayDoc?.wpisyZlecen,
    dayDoc?.wpisy,
    dayDoc?.items,
    dayDoc?.entries
  ].filter(Array.isArray);

  return lists.flat();
};

// LICZENIE Z POZYCJI: tu NIE MA ZGADYWANIA — liczymy sumę z wpisów
// Preferujemy format typowany (F/J/P/N + hours). Jeśli go nie ma, liczymy z konkretnych pól fh/jazda/praca/nadgodziny.
export const sumFromEntries = (entries) => {
  let work = 0, drive = 0, billed = 0, over = 0;
  for (const it of entries) {
    const kindRaw = get(it, ['typ','type','kind','kod','flag','rodzaj','kategoria','symbol']);
    const kind = kindRaw ? String(kindRaw).trim().toUpperCase() : '';

    const hours = parsePlNumber(get(it, ['h','hours','godziny','wartosc','value','czas','ile','qty']));

    if (kind) {
      if (kind === 'F' || kind.includes('FAKT')) { billed += hours; continue; }
      if (kind === 'J' || kind.includes('JAZD')) { drive  += hours; continue; }
      if (kind === 'P' || kind.includes('PRAC') || kind === 'W') { work += hours; continue; }
      if (kind === 'N' || kind.includes('NADG')) { over += hours; continue; }
    }

    // fallback: konkretne pola (NIE bierzemy 10 różnych wariantów “billedHours”, tylko te które realnie oznaczają fakturowane wpisu)
    billed += parsePlNumber(get(it, ['fh','fakturowane','godzinyFakturowane','godzinyWyfakturowane']));
    drive  += parsePlNumber(get(it, ['jazda','czasJazdy','driveHours']));
    work   += parsePlNumber(get(it, ['praca','workHours','godzinyPracy','godziny']));
    over   += parsePlNumber(get(it, ['nadgodziny','over']));
  }
  return { work, drive, billed, over, count: entries.length };
};

// DZIEŃ UZNAJEMY ZA “PUSTY”, JEŚLI:
// - brak wpisów klientów (entries=0)
// - ręczne pola wszystkie 0
// - notatka pusta
// - status Brak
export const isEmptyDay = (dayDoc) => {
  if (!dayDoc) return true;
  const leave = getLeaveKind(dayDoc);
  if (leave) return false; // wolne to nie “puste” (bo ma ikonę)

  const m = extractManual(dayDoc);
  const entries = getLinkedEntries(dayDoc);

  const manualAllZero = (m.work===0 && m.drive===0 && m.billed===0 && m.over===0);
  const noteEmpty = !m.note;
  const noEntries = entries.length === 0;

  return manualAllZero && noteEmpty && noEntries;
};

// FINALNE PODSUMOWANIE DNIA = manual + entries (zlecenia/klienci)
export const computeDay = (dayDoc) => {
  const leave = getLeaveKind(dayDoc);
  const entries = getLinkedEntries(dayDoc);
  const m = extractManual(dayDoc);
  const e = sumFromEntries(entries);

  const summary = {
    work:  m.work + e.work,
    drive: m.drive + e.drive,
    billed:m.billed + e.billed,
    over:  m.over + e.over
  };

  const hasData = !isEmptyDay(dayDoc) && !leave && (
    entries.length > 0 || summary.work !== 0 || summary.drive !== 0 || summary.billed !== 0 || summary.over !== 0
  );

  return { leave, entriesCount: entries.length, summary, hasData };
};
