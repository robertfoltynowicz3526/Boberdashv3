function formatDateKey(calendar, date) {
  const FullCalendar = calendar; // passed instance of constructor
  try {
    return FullCalendar.formatDate(date, { month: '2-digit', day: '2-digit', year: 'numeric' })
      .split('/')
      .reverse()
      .join('-');
  } catch (_) {
    const d = new Date(date);
    if (!Number.isNaN(d.getTime())) {
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${d.getFullYear()}-${m}-${day}`;
    }
  }
  return '';
}

function normalizeLeaveKind(rawValue) {
  const base = (rawValue || '').toString().toUpperCase().replace(/0/g, 'O');
  const plain = base.normalize('NFD').replace(/[^A-Z0-9]/gi, '');
  if (plain === 'L4') return { kind: 'L4', label: 'L4' };
  if (plain === 'URLOP') return { kind: 'URLOP', label: 'Urlop' };
  if (plain === 'SWIETO') return { kind: 'SWIETO', label: 'Święto' };
  return null;
}

function readBilledHours(extendedProps = {}) {
  const chain = [
    extendedProps.fakturowane,
    extendedProps.invoiceHours,
    extendedProps.invoicedHours,
    extendedProps.billedHours,
  ];
  for (const val of chain) {
    const num = Number(val);
    if (Number.isFinite(num)) return num;
  }
  return 0;
}

function prepareCalendarEvents(rawEvents = [], FullCalendar) {
  const sums = new Map();
  const leaveByDay = new Map();
  const workEvents = [];

  (Array.isArray(rawEvents) ? rawEvents : []).forEach((evt) => {
    if (!evt) return;
    const dateKey = formatDateKey(FullCalendar, evt.start || evt.startStr || evt.date || evt.startDate);
    if (!dateKey) return;
    const extendedProps = evt.extendedProps || {};
    const leaveInfo = normalizeLeaveKind(extendedProps.leaveKind || extendedProps.type || evt.leaveKind || evt.type);
    if (leaveInfo) {
      if (!leaveByDay.has(dateKey)) leaveByDay.set(dateKey, leaveInfo);
      return;
    }

    const s = sums.get(dateKey) || { work: 0, drive: 0, bill: 0, hasOrders: false };
    const workVal = Number(extendedProps.workH ?? extendedProps.workHours ?? extendedProps.work ?? 0);
    const driveVal = Number(extendedProps.driveH ?? extendedProps.driveHours ?? extendedProps.drive ?? 0);
    const billVal = readBilledHours(extendedProps);
    if (Number.isFinite(workVal)) s.work += workVal;
    if (Number.isFinite(driveVal)) s.drive += driveVal;
    if (Number.isFinite(billVal)) s.bill += billVal;
    const cleanTitle = (evt.title || '').trim();
    if (cleanTitle) s.hasOrders = true;
    sums.set(dateKey, s);

    if (!cleanTitle) return;
    if (extendedProps.isSummary || extendedProps.isDaySummary) return;
    workEvents.push({ ...evt, title: cleanTitle, _dateKey: dateKey });
  });

  const prepared = [];
  leaveByDay.forEach((info, iso) => {
    prepared.push({
      title: '',
      start: iso,
      allDay: true,
      extendedProps: { leaveKind: info.kind, leaveLabel: info.label, sort: -999 },
    });
  });

  workEvents.forEach((evt) => {
    if (leaveByDay.has(evt._dateKey)) return;
    const cloned = { ...evt };
    delete cloned._dateKey;
    prepared.push(cloned);
  });

  sums.forEach((s, iso) => {
    if (!s.hasOrders || leaveByDay.has(iso)) return;
    prepared.push({
      title: `• Praca: ${s.work.toFixed(1)}h • Jazda: ${s.drive.toFixed(1)}h • Fakturowane: ${s.bill.toFixed(1)}h`,
      start: iso,
      allDay: true,
      extendedProps: { isDaySummary: true, sort: 9999 },
    });
  });

  const filtered = prepared.filter((e) => (e?.title ?? '').trim() !== '' || e?.extendedProps?.leaveKind);
  return { preparedEvents: filtered, leaveByDay, sums };
}

export function renderDaySummaries(calendarInstance) {
  if (!calendarInstance) return;
  calendarInstance.el.querySelectorAll('.day-summary').forEach((node) => node.remove());
}

export function initCalendar(container, events = [], flags = [], extraOptions = {}) {
  const FullCalendar = window.FullCalendar;
  if (!FullCalendar || !container) return null;
  const { preparedEvents, leaveByDay } = prepareCalendarEvents(events, FullCalendar);
  let currentLeaveByDay = leaveByDay;
  const localeOption = (FullCalendar?.locales || []).find((l) => l.code === 'pl') || 'pl';
  const options = {
    locale: localeOption,
    initialView: 'dayGridMonth',
    headerToolbar: { left: 'prev,next today', center: 'title', right: 'month,week' },
    navLinks: true,
    expandRows: true,
    height: 'auto',
    contentHeight: 'auto',
    handleWindowResize: true,
    fixedWeekCount: false,
    dayMaxEvents: 3,
    dayMaxEventRows: 4,
    moreLinkClick: 'popover',
    eventOrder: (a, b) => ((a.extendedProps?.sort ?? 0) - (b.extendedProps?.sort ?? 0)),
    eventOverlap: (stillEvent, movingEvent) => {
      return stillEvent.allDay && movingEvent.allDay ? true : false;
    },
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    validRange: undefined,
    customFlags: flags || [],
    eventContent(arg) {
      const xp = arg.event.extendedProps || {};
      const kind = (xp.leaveKind || '').toUpperCase();
      if (kind === 'L4' || kind === 'URLOP' || kind === 'ŚWIĘTO' || kind === 'SWIETO') {
        const wrap = document.createElement('div');
        wrap.className = 'day-flag-wrap';
        const icon = document.createElement('span');
        icon.className = 'day-flag-icon';
        icon.textContent = (kind === 'L4') ? '🏥' : (kind === 'URLOP' ? '🏖️' : '🌾');
        const label = document.createElement('div');
        label.className = 'day-flag-label';
        label.textContent = xp.leaveLabel || (kind === 'L4' ? 'L4' : (kind === 'URLOP' ? 'Urlop' : 'Święto'));
        wrap.appendChild(icon);
        wrap.appendChild(label);
        return { domNodes: [wrap] };
      }
      if (xp.isDaySummary) return true;
      return true;
    },
    dayCellDidMount(info) {
      const iso = formatDateKey(FullCalendar, info.date);
      const map = info.view?.calendar?.currentLeaveByDay || currentLeaveByDay;
      if (map?.has(iso)) info.el.setAttribute('data-has-leave', 'true');
    },
    datesSet() {},
    events: preparedEvents,
    ...extraOptions,
  };

  const calendar = new FullCalendar.Calendar(container, options);
  const baseDatesSet = options.datesSet;
  const baseEventDidMount = options.eventDidMount;
  calendar.setOption('datesSet', (info) => {
    if (typeof baseDatesSet === 'function') baseDatesSet(info);
    if (typeof extraOptions.onDatesSet === 'function') extraOptions.onDatesSet(info);
    requestAnimationFrame(() => calendar.updateSize());
  });
  calendar.setOption('eventDidMount', (info) => {
    if (typeof baseEventDidMount === 'function') baseEventDidMount(info);
    if (typeof extraOptions.eventDidMount === 'function') extraOptions.eventDidMount(info);
    if (info.el.classList.contains('absence-icon-holder')) {
      const span = document.createElement('span');
      span.className = 'absence-icon';
      if (info.el.classList.contains('absence-l4')) span.textContent = '➕';
      else if (info.el.classList.contains('absence-url')) span.textContent = '🏁';
      else if (info.el.classList.contains('absence-urlop')) span.textContent = '🏁';
      else if (info.el.classList.contains('absence-święto') || info.el.classList.contains('absence-swieto')) span.textContent = '🍃';
      else span.textContent = '🌿';
      info.el.appendChild(span);
    }
  });
  calendar.render();
  calendar.currentLeaveByDay = currentLeaveByDay;
  window.addEventListener('resize', () => {
    try { calendar.updateSize(); } catch (_) {}
  });
  return calendar;
}

export function updateCalendarData(calendar, events = [], flags = []) {
  if (!calendar) return;
  calendar.setOption('customFlags', flags || []);
  calendar.removeAllEvents();
  const { preparedEvents, leaveByDay } = prepareCalendarEvents(events, window.FullCalendar);
  calendar.currentLeaveByDay = leaveByDay;
  if (preparedEvents.length) {
    calendar.addEventSource(preparedEvents);
  }
  calendar.rerenderDates();
}
