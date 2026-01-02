// src/utils/dayTotals.js
export const parsePlNumber = (v) => {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).trim().replace(/\s/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

const pick = (obj, keys) => {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  }
  return undefined;
};

// STATUS DNIA (to samo co w radiobuttonach w modalu)
export const getLeaveKind = (dayDoc) => {
  const raw = pick(dayDoc, ["statusDnia", "status", "dayStatus", "wolne", "leave"]);
  if (!raw) return null;
  const s = String(raw).trim().toUpperCase();
  if (s === "L4") return "L4";
  if (s === "SWIETO" || s === "ŚWIĘTO") return "SWIETO";
  if (s === "URLOP") return "URL";
  if (s === "BRAK") return null;
  return null;
};

// RĘCZNE pola (góra modala)
export const readManual = (dayDoc) => {
  return {
    work:  parsePlNumber(pick(dayDoc, ["godzinyPracy", "praca", "workHours"])),
    billed:parsePlNumber(pick(dayDoc, ["godzinyWyfakturowane", "wyfakturowane", "fakturowane", "billedHours", "fh"])),
    drive: parsePlNumber(pick(dayDoc, ["czasJazdy", "jazda", "driveHours"])),
    over:  parsePlNumber(pick(dayDoc, ["nadgodziny", "over"])),
  };
};

// ŹRÓDŁO PRAWDY “zlecenia dodane do dnia” = lista pozycji widocznych w modalu (np. "F: 2.00h — Klient")
export const readDayEntries = (dayDoc) => {
  const lists = [
    dayDoc?.powiazane,
    dayDoc?.powiazania,
    dayDoc?.wpisy,
    dayDoc?.wpisyZlecen,
    dayDoc?.items,
    dayDoc?.entries,
    dayDoc?.zleceniaDnia, // jeśli tak masz nazwane
  ].filter(Array.isArray);
  return lists.flat();
};

// LICZENIE Z POZYCJI DNIA BEZ “ZGADYWANIA”:
// - Preferuj format typowany: { kind/type: 'F'|'J'|'P'|'N', hours/h: number }
// - Inaczej fallback: { fh/fakturowane, jazda/czasJazdy, praca, nadgodziny }
export const sumEntries = (entries) => {
  let work = 0, drive = 0, billed = 0, over = 0;

  for (const it of entries) {
    const kindRaw = pick(it, ["kind", "type", "typ", "kod", "flag"]);
    const kind = kindRaw ? String(kindRaw).trim().toUpperCase() : "";

    // jedna kanoniczna wartość godzin wpisu
    const hours = parsePlNumber(pick(it, ["hours", "h", "godziny", "value", "wartosc"]));

    if (kind) {
      if (kind === "F" || kind.includes("FAKT")) { billed += hours; continue; }
      if (kind === "J" || kind.includes("JAZD")) { drive  += hours; continue; }
      if (kind === "P" || kind.includes("PRAC") || kind === "W") { work += hours; continue; }
      if (kind === "N" || kind.includes("NADG")) { over += hours; continue; }
    }

    // fallback (tylko realne pola wpisu; nie bierz 10 alternatyw które bywają pomocnicze!)
    billed += parsePlNumber(pick(it, ["fh", "fakturowane", "godzinyFakturowane", "godzinyWyfakturowane"]));
    drive  += parsePlNumber(pick(it, ["jazda", "czasJazdy", "driveHours"]));
    work   += parsePlNumber(pick(it, ["praca", "workHours", "godzinyPracy", "godziny"]));
    over   += parsePlNumber(pick(it, ["nadgodziny", "over"]));
  }

  return { work, drive, billed, over };
};

// FINAL: to ma zwrócić DOKŁADNIE to, co ma pokazać kafel w kalendarzu i co ma pokazać modal jako suma
export const computeDayTotals = (dayDoc) => {
  const leave = getLeaveKind(dayDoc);
  if (leave) return { leave, hasData: true, totals: null }; // wolne: tylko ikona

  const manual = readManual(dayDoc || {});
  const entries = readDayEntries(dayDoc || {});
  const fromEntries = sumEntries(entries);

  const totals = {
    work: manual.work + fromEntries.work,
    drive: manual.drive + fromEntries.drive,
    billed: manual.billed + fromEntries.billed,
    over: manual.over + fromEntries.over,
  };

  const hasAny =
    entries.length > 0 ||
    totals.work !== 0 || totals.drive !== 0 || totals.billed !== 0 || totals.over !== 0;

  return { leave: null, hasData: hasAny, totals };
};
