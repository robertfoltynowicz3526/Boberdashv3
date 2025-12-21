import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { db } from '../services/firebase.js';

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

let calendarInstance = null;
let calendarHost = null;
let currentRange = null;
let loaderEl = null;
let navigationWired = false;
let lastLoadToken = 0;

const getDbInstance = () => {
  try {
    return db();
  } catch (error) {
    console.error('[Calendar] Firestore init error:', error);
    return null;
  }
};

const ensureLoader = () => {
  if (!calendarHost) return null;
  if (!loaderEl || !loaderEl.parentElement) {
    loaderEl = document.createElement('div');
    loaderEl.className = 'calendar-loading';
    loaderEl.innerHTML = '<span>Ładowanie wydarzeń…</span>';
    calendarHost.appendChild(loaderEl);
  }
  return loaderEl;
};

const setLoading = (isLoading) => {
  const el = ensureLoader();
  if (!el) return;
  el.classList.toggle('is-active', Boolean(isLoading));
};

const destroyCalendarInstance = () => {
  if (calendarInstance) {
    try {
      calendarInstance.destroy();
    } catch (error) {
      console.error('[Calendar] destroy error:', error);
    }
  }
  calendarInstance = null;
  currentRange = null;
  lastLoadToken += 1;
  if (loaderEl?.parentElement) {
    loaderEl.parentElement.removeChild(loaderEl);
  }
  loaderEl = null;
};

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

const wireNavigationButtons = () => {
  if (navigationWired) return;
  navigationWired = true;
  const hook = (id, action) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', action);
  };
  hook('btn-prev', () => calendarInstance?.prev());
  hook('btn-next', () => calendarInstance?.next());
  hook('btn-today', () => calendarInstance?.today());
};

async function fetchOrders(startStr, endStr) {
  const firestore = getDbInstance();
  if (!firestore) {
    console.warn('[Calendar] Brak połączenia z Firestore – pomijam pobieranie zdarzeń.');
    return [];
  }

  const docs = [];
  const dateFields = ['date', 'start', 'startDate'];
  for (const field of dateFields) {
    try {
      const ref = collection(firestore, 'orders');
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
      const legacyRef = collection(firestore, 'zlecenia');
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
  const firestore = getDbInstance();
  if (!firestore) return [];
  const leaves = [];
  const collections = ['leaves', 'calendarFlags'];
  for (const col of collections) {
    try {
      const ref = collection(firestore, col);
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

async function reloadEvents(rangeStart, rangeEnd) {
  if (!calendarInstance) return;
  const activeStart = startOfMonth(rangeStart);
  const startStr = toDayString(activeStart);
  const endStr = toDayString(endOfMonth(rangeEnd || rangeStart));
  if (!startStr || !endStr) return;

  const loadId = ++lastLoadToken;
  setLoading(true);
  try {
    const [orders, leaves] = await Promise.all([fetchOrders(startStr, endStr), fetchLeaves(startStr, endStr)]);
    if (loadId !== lastLoadToken) return;
    const events = mapDocsToEvents(orders, leaves);
    calendarInstance.removeAllEvents();
    calendarInstance.addEventSource(events);
    const sample = events.slice(0, 3);
    console.debug('[Calendar] events:', events.length, { range: `${startStr}..${endStr}`, sample });
    if (events.length === 0) {
      console.warn(`[Calendar] Brak zdarzeń do wyświetlenia dla zakresu ${startStr}..${endStr}.`);
    }
  } catch (error) {
    if (loadId === lastLoadToken) {
      console.error('[Calendar] Events loader error', error);
    }
  } finally {
    if (loadId === lastLoadToken) {
      setLoading(false);
    }
  }
}

export function renderDaySummaries() {}

export function initCalendar(container, _events = [], _flags = [], extraOptions = {}) {
  const FullCalendar = window.FullCalendar;
  if (!FullCalendar || !container) return null;

  destroyCalendarInstance();
  calendarHost = container;
  calendarHost.innerHTML = '';
  currentRange = null;

  const calendarEl = document.createElement('div');
  calendarEl.id = 'calendar';
  calendarHost.appendChild(calendarEl);

  const { onDatesSet, eventDidMount, ...restOptions } = extraOptions || {};
  const localeOption = (FullCalendar?.locales || []).find((l) => l.code === 'pl') || 'pl';
  calendarInstance = new FullCalendar.Calendar(calendarEl, {
    ...restOptions,
    locale: localeOption,
    initialView: restOptions?.initialView || 'dayGridMonth',
    timeZone: restOptions?.timeZone || 'local',
    height: 'auto',
    dayMaxEventRows: 3,
    moreLinkClick: 'popover',
    displayEventTime: false,
    eventDisplay: 'block',
    events: [],
    eventContent: renderEventContent,
  });
  calendarInstance.setOption('eventOrder', (a, b) => {
    const rank = { leave: 0, dayOff: 0, holiday: 0, order: 1, summary: 2 };
    const aType = a.extendedProps?.type;
    const bType = b.extendedProps?.type;
    return (rank[aType] ?? 99) - (rank[bType] ?? 99);
  });
  calendarInstance.setOption('eventClassNames', (arg) => {
    const type = arg.event.extendedProps?.type;
    if (type === 'summary') return ['fc-event--summary'];
    if (type === 'leave' || type === 'dayOff' || type === 'holiday') return ['fc-event--icon-only'];
    return ['fc-event--order'];
  });
  calendarInstance.setOption('datesSet', (info) => {
    currentRange = { start: info.start, end: info.end };
    if (typeof onDatesSet === 'function') onDatesSet(info);
    reloadEvents(info.start, info.end);
    requestAnimationFrame(() => {
      try {
        calendarInstance?.updateSize();
      } catch (_) {}
    });
  });
  if (typeof eventDidMount === 'function') {
    calendarInstance.setOption('eventDidMount', (info) => eventDidMount(info));
  }

  calendarInstance.render();
  wireNavigationButtons();
  window.addEventListener('resize', () => {
    try {
      calendarInstance?.updateSize();
    } catch (_) {}
  });
  return calendarInstance;
}

export function updateCalendarData(_calendar, flags = []) {
  if (flags && flags.length) {
    console.debug('[Calendar] updateCalendarData flags', flags);
  }
  if (calendarInstance && currentRange) {
    reloadEvents(currentRange.start, currentRange.end);
  }
}
