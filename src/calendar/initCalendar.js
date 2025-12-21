import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebase-config.js';

const toDayString = (dateInput) => {
  if (!dateInput) return null;
  if (typeof dateInput === 'string') return dateInput.slice(0, 10);
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const normalizeHours = (doc = {}) => {
  const toNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    work: toNum(doc.workHours ?? doc.work ?? doc.praca),
    drive: toNum(doc.driveHours ?? doc.drive ?? doc.jazda),
    invo: toNum(doc.invoicedHours ?? doc.invoiced ?? doc.billed ?? doc.fakturowane ?? doc.fh),
  };
};

const detectType = (doc = {}) => {
  const rawType = (doc.type || doc.typ || '').toString().toLowerCase();
  const status = (doc.status || '').toString();
  const leaveKind = (doc.leaveKind || doc.leaveType || '').toString().toLowerCase();
  const isLeave = (val) => ['leave', 'leave_l4', 'l4', 'sick'].includes(val);
  const isDayOff = (val) => ['dayoff', 'wolne', 'free', 'leave_free', 'urlop'].includes(val);
  const isHoliday = (val) => ['holiday', 'święto', 'swieto', 'leave_holiday'].includes(val);

  if (isLeave(rawType) || isLeave(leaveKind)) return 'leave';
  if (isDayOff(rawType) || isDayOff(leaveKind)) return 'dayOff';
  if (isHoliday(rawType) || isHoliday(leaveKind)) return 'holiday';

  if (/(L4|chorobowe)/i.test(status)) return 'leave';
  if (/(wolne|day off|urlop)/i.test(status)) return 'dayOff';
  if (/(święto|swieto|holiday)/i.test(status)) return 'holiday';

  if (rawType === 'summary') return 'summary';
  return 'job';
};

const mapDocsToEvents = (raw = []) => {
  const jobs = [];
  const icons = [];
  const sumsByDate = new Map();
  const emitted = new Set();

  for (const doc of raw) {
    const date = toDayString(doc.date || doc.start || doc.startDate || '');
    if (!date) continue;
    const type = detectType(doc);
    const { work, drive, invo } = normalizeHours(doc);

    if (type === 'job') {
      const id = doc.id || `${date}-${Math.random().toString(36).slice(2, 8)}`;
      const key = `job-${id}`;
      if (emitted.has(key)) continue;
      emitted.add(key);
      jobs.push({
        id,
        start: date,
        allDay: true,
        title: doc.title || doc.client || doc.klient || 'Zlecenie',
        extendedProps: { type, work, drive, invo },
      });
      const s = sumsByDate.get(date) || { work: 0, drive: 0, invo: 0 };
      s.work += work;
      s.drive += drive;
      s.invo += invo;
      sumsByDate.set(date, s);
      continue;
    }

    if (type === 'leave' || type === 'dayOff' || type === 'holiday') {
      const key = `icon-${date}`;
      if (emitted.has(key)) continue;
      emitted.add(key);
      icons.push({
        id: doc.id || `${date}-icon-${type}`,
        start: date,
        allDay: true,
        title: type,
        extendedProps: { type },
        display: 'block',
        classNames: ['fc-event--icon-only'],
      });
    }
  }

  const summaries = [];
  for (const [date, s] of sumsByDate.entries()) {
    const hasIcon = icons.some((e) => e.start === date);
    if (hasIcon) continue;
    if (s.work + s.drive + s.invo === 0) continue;
    summaries.push({
      id: `${date}-summary`,
      start: date,
      allDay: true,
      title: `• Praca: ${s.work.toFixed(1)}h • Jazda: ${s.drive.toFixed(1)}h • Fakturowane: ${s.invo.toFixed(1)}h`,
      extendedProps: { type: 'summary' },
    });
  }

  const events = [...icons, ...jobs, ...summaries];
  return events;
};

async function fetchEventsFromFirestore(startStr, endStr) {
  if (!db) {
    console.warn('[Calendar] Brak połączenia z Firestore – pomijam pobieranie zdarzeń.');
    return [];
  }

  const raw = [];
  try {
    const godzinyRef = collection(db, 'godziny_pracy');
    const godzinyQuery = query(godzinyRef, where('date', '>=', startStr), where('date', '<=', endStr), orderBy('date'));
    const godzinySnap = await getDocs(godzinyQuery);
    godzinySnap.forEach((docSnap) => raw.push({ id: docSnap.id, ...docSnap.data() }));
  } catch (error) {
    console.error('[Calendar] Nie udało się pobrać wpisów godzin z Firestore.', error);
  }

  try {
    const eventsRef = collection(db, 'events');
    const eventsQuery = query(eventsRef, where('start', '>=', startStr), where('start', '<=', endStr), orderBy('start'));
    const eventsSnap = await getDocs(eventsQuery);
    eventsSnap.forEach((docSnap) => raw.push({ id: docSnap.id, ...docSnap.data() }));
  } catch (error) {
    console.error('[Calendar] Nie udało się pobrać zdarzeń (events) z Firestore.', error);
  }

  if (!raw.length) {
    console.warn(`[Calendar] Firestore zwrócił 0 dokumentów dla zakresu ${startStr}..${endStr}.`);
  }

  return raw;
}

function renderEventContent(arg) {
  const type = arg.event.extendedProps?.type;
  if (type === 'leave' || type === 'dayOff' || type === 'holiday') {
    const el = document.createElement('div');
    el.className = 'fc-event--icon-only';
    const iconHolder = document.createElement('div');
    iconHolder.className = 'icon';
    iconHolder.textContent = type === 'leave' ? '🤒' : type === 'dayOff' ? '🏖️' : '🌾';
    el.appendChild(iconHolder);
    return { domNodes: [el] };
  }

  if (type === 'summary') {
    return { html: `<div class="ev ev--sum">${arg.event.title}</div>` };
  }

  return { html: `<div class="ev ev--job"><div class="ev__title">${arg.event.title}</div></div>` };
}

const wireNavigationButtons = (calendarApi) => {
  if (!calendarApi) return;
  const hook = (id, action) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', action);
  };
  hook('btn-prev', () => calendarApi.prev());
  hook('btn-next', () => calendarApi.next());
  hook('btn-today', () => calendarApi.today());
};

export function renderDaySummaries() {}

export function initCalendar(container, _events = [], _flags = [], extraOptions = {}) {
  const FullCalendar = window.FullCalendar;
  if (!FullCalendar || !container) return null;

  const localeOption = (FullCalendar?.locales || []).find((l) => l.code === 'pl') || 'pl';
  const options = {
    ...extraOptions,
    locale: localeOption,
    initialView: 'dayGridMonth',
    timeZone: 'local',
    height: 'auto',
    dayMaxEventRows: 3,
    moreLinkClick: 'popover',
    displayEventTime: false,
    eventDisplay: 'block',
    eventContent: renderEventContent,
  };

  const calendar = new FullCalendar.Calendar(container, options);
  calendar.setOption('eventOrder', (a, b) => {
    const rank = { leave: 0, dayOff: 0, holiday: 0, job: 1, summary: 2 };
    const aType = a.extendedProps?.type;
    const bType = b.extendedProps?.type;
    return (rank[aType] ?? 99) - (rank[bType] ?? 99);
  });
  calendar.setOption('eventClassNames', (arg) => {
    const type = arg.event.extendedProps?.type;
    if (type === 'summary') return ['fc-event--summary'];
    if (type === 'leave' || type === 'dayOff' || type === 'holiday') return ['fc-event--icon-only'];
    return ['fc-event--job'];
  });
  calendar.setOption('events', async (info, success, failure) => {
    try {
      const raw = await fetchEventsFromFirestore(info.startStr, info.endStr);
      const events = mapDocsToEvents(raw);
      const sample = events.slice(0, 3);
      console.debug('[Calendar] events:', events.length, { range: `${info.startStr}..${info.endStr}`, sample });
      if (events.length === 0) {
        console.warn(`[Calendar] Brak zdarzeń do wyświetlenia dla zakresu ${info.startStr}..${info.endStr}. Raw: ${raw.length}`);
      }
      success(events);
    } catch (err) {
      console.error('events loader error', err);
      failure(err);
    }
  });

  const baseDatesSet = options.datesSet;
  calendar.setOption('datesSet', (info) => {
    if (typeof baseDatesSet === 'function') baseDatesSet(info);
    if (typeof extraOptions.onDatesSet === 'function') extraOptions.onDatesSet(info);
    requestAnimationFrame(() => calendar.updateSize());
  });
  if (typeof extraOptions.eventDidMount === 'function') {
    calendar.setOption('eventDidMount', (info) => extraOptions.eventDidMount(info));
  }

  calendar.render();
  wireNavigationButtons(calendar.getApi());
  window.addEventListener('resize', () => {
    try {
      calendar.updateSize();
    } catch (_) {}
  });
  return calendar;
}

export function updateCalendarData(calendar, flags = []) {
  if (!calendar) return;
  calendar.setOption('customFlags', flags || []);
  calendar.refetchEvents();
}
