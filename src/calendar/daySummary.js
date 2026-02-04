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

// UWAGA: status wolnego MUSI być brany z TEGO SAMEGO pola co w modalu (radio Brak/Urlop/L4/Święto/Szkolenie)
export const getLeaveKind = (dayDoc) => {
  const raw =
    get(dayDoc, ['statusDnia','status','dayStatus','wolne','leave','kind','typ']) ?? 'Brak';
  const s = String(raw).trim().toUpperCase();

  if (s === 'L4') return 'L4';
  if (s === 'ŚWIĘTO' || s === 'SWIETO') return 'SWIETO';
  if (s === 'URLOP') return 'URL';
  if (s === 'WOLNE') return 'WOLNE';
  if (s === 'SZKOLENIE') return 'SZKOLENIE';
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

const buildEntryKey = (entry) => {
  if (!entry) return '';
  const entryId = get(entry, ['entryId','id']);
  if (entryId != null) return String(entryId);
  const orderId = get(entry, ['zlecenieId','orderId']);
  const kindRaw = get(entry, ['typ','type','kind','kod','flag','rodzaj','kategoria','symbol']);
  const kind = kindRaw ? String(kindRaw).trim().toUpperCase() : '';
  const hours = parsePlNumber(get(entry, ['h','hours','godziny','wartosc','value','czas','ile','qty']));
  const billed = parsePlNumber(get(entry, ['fh','fakturowane','godzinyFakturowane','godzinyWyfakturowane']));
  const drive = parsePlNumber(get(entry, ['jazda','czasJazdy','driveHours']));
  const work = parsePlNumber(get(entry, ['praca','workHours','godzinyPracy','godziny']));
  const over = parsePlNumber(get(entry, ['nadgodziny','over']));
  const dayKey = get(entry, ['dayStr','date','day']);
  return [orderId || '', kind, hours, billed, work, drive, over, dayKey || ''].join('|');
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
  const entries = dedupeEntries(getLinkedEntries(dayDoc));

  const manualAllZero = (m.work===0 && m.drive===0 && m.billed===0 && m.over===0);
  const noteEmpty = !m.note;
  const noEntries = entries.length === 0;

  return manualAllZero && noteEmpty && noEntries;
};

// FINALNE PODSUMOWANIE DNIA = manual + entries (zlecenia/klienci)
export const computeDay = (dayDoc) => {
  const leave = getLeaveKind(dayDoc);
  const entries = dedupeEntries(getLinkedEntries(dayDoc));
  const m = extractManual(dayDoc);
  const e = sumFromEntries(entries);

  const summary = {
    work:  e.work + (e.work === 0 ? m.work : 0),
    drive: e.drive + (e.drive === 0 ? m.drive : 0),
    billed:e.billed + (e.billed === 0 ? m.billed : 0),
    over:  e.over + (e.over === 0 ? m.over : 0)
  };

  const hasData = !isEmptyDay(dayDoc) && !leave && (
    entries.length > 0 || summary.work !== 0 || summary.drive !== 0 || summary.billed !== 0 || summary.over !== 0
  );

  return { leave, entriesCount: entries.length, summary, hasData };
};
