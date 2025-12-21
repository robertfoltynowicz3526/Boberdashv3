import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebase-config.js';

const startOfMonth = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
};

const endOfMonth = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
};

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

const mapDocsToEvents = (orders = [], leaves = []) => {
  const events = [];
  const sumsByDate = new Map();
  const emitted = new Set();

  orders.forEach((doc) => {
    const dateKey = toDayString(doc.date || doc.start || doc.startDate || doc.data) || null;
    if (!dateKey) return;
    const key = `${doc.id || doc.clientName || ''}::${dateKey}`;
    if (emitted.has(key)) return;
    emitted.add(key);
    const { work, drive, invo } = normalizeHours(doc);
    const title =
      doc.clientName ||
      doc.client ||
      doc.customer ||
      doc.kontrahent ||
      doc.nabywca ||
      'Zlecenie';
    events.push({
      id: doc.id || key,
      start: dateKey,
      allDay: true,
      title,
      extendedProps: { type: 'order', work, drive, invo },
    });
    const sum = sumsByDate.get(dateKey) || { work: 0, drive: 0, invo: 0 };
    sum.work += work;
    sum.drive += drive;
    sum.invo += invo;
    sumsByDate.set(dateKey, sum);
  });

  leaves.forEach((doc) => {
    const dateKey = toDayString(doc.date || doc.start || doc.startDate);
    if (!dateKey) return;
    const type = detectType(doc);
    if (type !== 'leave' && type !== 'dayOff' && type !== 'holiday') return;
    const key = `${type}::${dateKey}`;
    if (emitted.has(key)) return;
    emitted.add(key);
    events.push({
      id: doc.id || key,
      start: dateKey,
      allDay: true,
      title: type,
      extendedProps: { type },
      display: 'block',
      classNames: ['fc-event--icon-only'],
    });
  });

  sumsByDate.forEach((val, dateKey) => {
    const hasIcon = events.some(
      (e) => e.extendedProps?.type && ['leave', 'dayOff', 'holiday'].includes(e.extendedProps.type) && e.start === dateKey,
    );
    if (hasIcon) return;
    if (val.work + val.drive + val.invo === 0) return;
    const key = `summary::${dateKey}`;
    if (emitted.has(key)) return;
    emitted.add(key);
    events.push({
      id: key,
      start: dateKey,
      allDay: true,
      title: `• Praca ${val.work.toFixed(1)}h • Jazda ${val.drive.toFixed(1)}h • Fakturowane ${val.invo.toFixed(1)}h`,
      extendedProps: { type: 'summary' },
    });
  });

  return events;
};

async function fetchOrders(startStr, endStr) {
  if (!db) {
    console.warn('[Calendar] Brak połączenia z Firestore – pomijam pobieranie zdarzeń.');
    return [];
  }

  const docs = [];
  const dateFields = ['date', 'start', 'startDate'];
  for (const field of dateFields) {
    try {
      const ref = collection(db, 'orders');
      const qRef = query(ref, where(field, '>=', startStr), where(field, '<=', endStr), orderBy(field));
      const snap = await getDocs(qRef);
      snap.forEach((docSnap) => docs.push({ id: docSnap.id, ...docSnap.data() }));
      if (snap.size > 0) break;
    } catch (error) {
      console.warn(`[Calendar] Nie udało się pobrać orders po polu ${field}.`, error);
    }
  }
  if (!docs.length) {
    try {
      const legacyRef = collection(db, 'zlecenia');
      const qLegacy = query(legacyRef, where('date', '>=', startStr), where('date', '<=', endStr), orderBy('date'));
      const snap = await getDocs(qLegacy);
      snap.forEach((docSnap) => docs.push({ id: docSnap.id, ...docSnap.data() }));
    } catch (error) {
      console.warn('[Calendar] Nie udało się pobrać zlecenia (legacy).', error);
    }
  }
  return docs;
}

async function fetchLeaves(startStr, endStr) {
  if (!db) return [];
  const leaves = [];
  const collections = ['leaves', 'calendarFlags'];
  for (const col of collections) {
    try {
      const ref = collection(db, col);
      const qRef = query(ref, where('date', '>=', startStr), where('date', '<=', endStr), orderBy('date'));
      const snap = await getDocs(qRef);
      snap.forEach((docSnap) => leaves.push({ id: docSnap.id, ...docSnap.data() }));
      if (snap.size > 0) break;
    } catch (error) {
      console.warn(`[Calendar] Nie udało się pobrać wpisów urlopowych z ${col}.`, error);
    }
  }
  return leaves;
}

function renderEventContent(arg) {
  const type = arg.event.extendedProps?.type;
  if (type === 'leave' || type === 'dayOff' || type === 'holiday') {
    const el = document.createElement('div');
    el.className = 'fc-leave-icon';
    el.textContent = type === 'leave' ? '🤒' : type === 'dayOff' ? '🌴' : '🎌';
    return { domNodes: [el] };
  }

  if (type === 'summary') {
    return {
      html: `<div class="fc-summary-chip">${arg.event.title}</div>`,
    };
  }

  return {
    html: `<div class="fc-order-chip" title="${arg.event.title}">${arg.event.title}</div>`,
  };
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
    const rank = { leave: 0, dayOff: 0, holiday: 0, order: 1, summary: 2 };
    const aType = a.extendedProps?.type;
    const bType = b.extendedProps?.type;
    return (rank[aType] ?? 99) - (rank[bType] ?? 99);
  });
  calendar.setOption('eventClassNames', (arg) => {
    const type = arg.event.extendedProps?.type;
    if (type === 'summary') return ['fc-event--summary'];
    if (type === 'leave' || type === 'dayOff' || type === 'holiday') return ['fc-event--icon-only'];
    return ['fc-event--order'];
  });
  calendar.setOption('events', async (info, success, failure) => {
    try {
      const activeStart = startOfMonth(info.start);
      const activeEnd = endOfMonth(info.start);
      const startStr = toDayString(activeStart);
      const endStr = toDayString(activeEnd);
      const [orders, leaves] = await Promise.all([fetchOrders(startStr, endStr), fetchLeaves(startStr, endStr)]);
      const events = mapDocsToEvents(orders, leaves);
      const sample = events.slice(0, 3);
      console.debug('[Calendar] events:', events.length, { range: `${startStr}..${endStr}`, sample });
      if (events.length === 0) {
        console.warn(`[Calendar] Brak zdarzeń do wyświetlenia dla zakresu ${startStr}..${endStr}.`);
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
