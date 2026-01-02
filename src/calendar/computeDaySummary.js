const parsePlNumber = (value) => {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = String(value).trim().replace(/\s/g, '').replace(',', '.');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
};

const normalizeDayLeaveValue = (value) => {
  const upper = (value ?? '').toString().trim().toUpperCase();
  if (!upper) return null;
  if (upper === 'WOLNE') return 'URL';
  if (upper === 'NONE' || upper === 'BRAK') return null;
  if (upper === 'URL' || upper === 'L4' || upper === 'SWIETO') return upper;
  return null;
};

const getLeaveKind = (dayDoc) => {
  const direct = normalizeDayLeaveValue(dayDoc?.leaveKind ?? dayDoc?.dayLeave ?? null);
  if (direct) return direct;
  if (dayDoc?.flags?.urlop) return 'URL';
  if (dayDoc?.flags?.l4) return 'L4';
  if (dayDoc?.flags?.swieto) return 'SWIETO';
  return null;
};

const readManualTotals = (dayDoc) => ({
  work: parsePlNumber(dayDoc?.work ?? dayDoc?.praca ?? 0),
  drive: parsePlNumber(dayDoc?.drive ?? dayDoc?.jazda ?? 0),
  billed: parsePlNumber(dayDoc?.billed ?? dayDoc?.fakturowane ?? 0),
  over: parsePlNumber(dayDoc?.nadgodziny ?? 0),
});

const readDayEntries = (dayDoc) => {
  if (Array.isArray(dayDoc?.zleceniaPowiazane)) {
    return dayDoc.zleceniaPowiazane.filter((entry) => entry && entry.zlecenieId);
  }
  if (dayDoc?.zlecenieId) {
    return [
      {
        zlecenieId: dayDoc.zlecenieId,
        klientNazwa: dayDoc.klientNazwa || null,
        fakturowane: parsePlNumber(dayDoc.fakturowane ?? 0),
      },
    ];
  }
  return [];
};

const sumEntries = (entries) => {
  let work = 0;
  let drive = 0;
  let billed = 0;
  let over = 0;

  entries.forEach((entry) => {
    const rawKind = entry?.typ ?? entry?.type ?? null;
    const kind = rawKind ? String(rawKind).trim().toUpperCase() : '';

    if (kind) {
      const hours = parsePlNumber(entry?.godziny ?? entry?.hours ?? entry?.h ?? 0);
      if (kind === 'F') billed += hours;
      if (kind === 'J') drive += hours;
      if (kind === 'P') work += hours;
      if (kind === 'N') over += hours;
      return;
    }

    billed += parsePlNumber(entry?.fakturowane ?? 0);
  });

  return { work, drive, billed, over };
};

export const computeDaySummary = (dayDoc) => {
  const leaveKind = getLeaveKind(dayDoc);
  if (leaveKind) {
    return { leaveKind, hasAnyData: true, summary: null };
  }

  const manual = readManualTotals(dayDoc || {});
  const entries = readDayEntries(dayDoc || {});
  const entriesTotals = sumEntries(entries);

  const summary = {
    work: manual.work + entriesTotals.work,
    drive: manual.drive + entriesTotals.drive,
    billed: manual.billed + entriesTotals.billed,
    over: manual.over + entriesTotals.over,
  };

  const hasAnyData =
    entries.length > 0 ||
    summary.work !== 0 ||
    summary.drive !== 0 ||
    summary.billed !== 0 ||
    summary.over !== 0;

  return { leaveKind: null, hasAnyData, summary: hasAnyData ? summary : null };
};
