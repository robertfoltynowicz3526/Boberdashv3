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
  if (upper === 'NONE' || upper === 'BRAK') return null;
  if (upper === 'WOLNE') return 'WOLNE';
  if (upper === 'URL' || upper === 'L4' || upper === 'SWIETO' || upper === 'SZKOLENIE') return upper;
  return null;
};

const getLeaveKind = (dayDoc) => {
  const direct = normalizeDayLeaveValue(dayDoc?.leaveKind ?? dayDoc?.dayLeave ?? null);
  if (direct) return direct;
  if (dayDoc?.flags?.urlop) return 'URL';
  if (dayDoc?.flags?.wolne) return 'WOLNE';
  if (dayDoc?.flags?.l4) return 'L4';
  if (dayDoc?.flags?.swieto) return 'SWIETO';
  if (dayDoc?.flags?.szkolenie) return 'SZKOLENIE';
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
        jazda: parsePlNumber(dayDoc.jazda ?? dayDoc.drive ?? 0),
      },
    ];
  }
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
  (entries || []).forEach((entry) => {
    const key = buildEntryKey(entry);
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(entry);
  });
  return deduped;
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
    drive += parsePlNumber(entry?.jazda ?? entry?.drive ?? 0);
  });

  return { work, drive, billed, over };
};

const computeFinalTotals = (fromClients, fromManual) => ({
  work: fromClients.work + (fromClients.work === 0 ? fromManual.work : 0),
  drive: fromClients.drive + (fromClients.drive === 0 ? fromManual.drive : 0),
  billed: fromClients.billed + (fromClients.billed === 0 ? fromManual.billed : 0),
  over: fromClients.over + (fromClients.over === 0 ? fromManual.over : 0),
});

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

export const computeDaySummary = (dayDoc) => {
  const leaveKind = getLeaveKind(dayDoc);
  if (leaveKind) {
    return { leaveKind, hasAnyData: true, summary: null };
  }

  const totalsFromManual = readManualTotals(dayDoc || {});
  const entries = readDayEntries(dayDoc || {});
  const uniqueEntries = dedupeEntries(entries);
  const totalsFromClients = sumEntries(uniqueEntries);

  const summary = computeFinalTotals(totalsFromClients, totalsFromManual);

  const hasAnyData =
    uniqueEntries.length > 0 ||
    summary.work !== 0 ||
    summary.drive !== 0 ||
    summary.billed !== 0 ||
    summary.over !== 0;

  const debugKey = getDebugDayKey();
  const dayKey = resolveDayKey(dayDoc || {});
  if (debugKey && dayKey === debugKey) {
    console.log('[dbgDay] calendar summary', {
      day: dayKey,
      totalsFromClients,
      totalsFromManual,
      finalTotals: summary,
    });
  }

  return { leaveKind: null, hasAnyData, summary: hasAnyData ? summary : null };
};
