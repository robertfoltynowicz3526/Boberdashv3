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

function isLeaveKind(value) {
  const kind = (value || '').toString().toUpperCase();
  return kind === 'L4' || kind === 'WOLNE' || kind === 'ŚWIĘTO' || kind === 'SWIETO' || kind.startsWith('LEAVE_');
}

function buildEventContent(arg) {
  const kind = (arg.event.extendedProps?.leaveKind || '').toUpperCase();
  if (kind === 'L4' || kind === 'WOLNE' || kind === 'ŚWIĘTO' || kind === 'SWIETO') {
    const el = document.createElement('span');
    el.className = `day-flag ${kind === 'L4' ? 'l4' : kind === 'WOLNE' ? 'off' : 'holiday'}`;
    return { domNodes: [el] }; // żadnego .fc-event chipa
  }
  return true; // zwykłe zlecenia renderuj po staremu
}

function mountDayFlag(calendar, info) {
  const existingFlag = info.el.querySelector('.day-flag');
  if (existingFlag) existingFlag.remove();
  info.el.removeAttribute('data-has-leave');
  const flags = info.view.calendar.getOption('customFlags') || [];
  const dateKey = formatDateKey(calendar, info.date);
  const flag = Array.isArray(flags) ? flags.find((f) => f.date === dateKey) : null;
  if (!flag) return;

  const wrap = document.createElement('span');
  const kindClass = flag.type === 'l4' ? 'l4' : flag.type === 'wolne' ? 'off' : 'holiday';
  wrap.className = `day-flag ${kindClass}`;
  info.el.style.position = 'relative';
  info.el.setAttribute('data-has-leave', 'true');
  info.el.appendChild(wrap);
}

export function renderDaySummaries(calendarInstance) {
  if (!calendarInstance) return;
  calendarInstance.el.querySelectorAll('.day-summary').forEach((node) => node.remove());
  const events = calendarInstance.getEvents();
  const byDate = new Map();
  const leaveDays = new Set();
  const flaggedDays = new Set((calendarInstance.getOption('customFlags') || []).map((f) => f?.date).filter(Boolean));
  events.forEach((evt) => {
    const dateKey = evt.startStr?.slice(0, 10);
    if (!dateKey) return;
    const leaveKind = (evt.extendedProps?.leaveKind || evt.extendedProps?.type || '').toUpperCase();
    if (isLeaveKind(leaveKind)) {
      leaveDays.add(dateKey);
    }
    if (!byDate.has(dateKey)) byDate.set(dateKey, []);
    byDate.get(dateKey).push(evt);
  });

  byDate.forEach((arr, dateKey) => {
    if (leaveDays.has(dateKey) || flaggedDays.has(dateKey)) return;
    let work = 0;
    let drive = 0;
    let bill = 0;
    arr.forEach((evt) => {
      const props = evt.extendedProps || {};
      work += +props.workH || 0;
      drive += +props.driveH || 0;
      bill += +props.billH || 0;
    });
    const cell = calendarInstance.el.querySelector(`[data-date="${dateKey}"] .fc-daygrid-day-frame`);
    if (!cell) return;
    const sum = document.createElement('div');
    sum.className = 'day-summary';
    sum.textContent = `• Praca: ${work.toFixed(1)}h • Jazda: ${drive.toFixed(1)}h • Fakturowane: ${bill.toFixed(1)}h`;
    cell.appendChild(sum);
  });
}

export function initCalendar(container, events = [], flags = [], extraOptions = {}) {
  const FullCalendar = window.FullCalendar;
  if (!FullCalendar || !container) return null;
  const rawEvents = Array.isArray(events) ? events : [];
  const preparedEvents = rawEvents
    .filter((e) => (e?.title ?? '').trim() !== '')
    .filter((e) => !e?.extendedProps?.isSummary);
  const leaveByDay = new Set();
  preparedEvents.forEach((evt) => {
    const leaveKind = (evt?.extendedProps?.leaveKind || evt?.extendedProps?.type || '').toUpperCase();
    if (!isLeaveKind(leaveKind)) return;
    const dateKey = formatDateKey(FullCalendar, evt.start || evt.startStr || evt.date || evt.startDate);
    if (dateKey) leaveByDay.add(dateKey);
  });
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
      const kind = (arg.event.extendedProps?.leaveKind || '').toUpperCase();
      if (kind === 'L4' || kind === 'WOLNE' || kind === 'ŚWIĘTO' || kind === 'SWIETO') {
        const span = document.createElement('span');
        span.className = `day-flag ${kind === 'L4' ? 'l4' : kind === 'WOLNE' ? 'off' : 'holiday'}`;
        return { domNodes: [span] }; // brak standardowego chipa
      }
      // zwykłe zlecenia – użyj default renderu
      return true;
    },
    dayCellDidMount(info) {
      mountDayFlag(FullCalendar, info);
      const iso = formatDateKey(FullCalendar, info.date);
      if (leaveByDay.has(iso)) {
        info.el.setAttribute('data-has-leave', 'true');
      }
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
    renderDaySummaries(calendar);
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
  window.addEventListener('resize', () => {
    try { calendar.updateSize(); } catch (_) {}
  });
  renderDaySummaries(calendar);
  return calendar;
}

export function updateCalendarData(calendar, events = [], flags = []) {
  if (!calendar) return;
  calendar.setOption('customFlags', flags || []);
  calendar.removeAllEvents();
  const rawEvents = Array.isArray(events) ? events : [];
  const preparedEvents = rawEvents
    .filter((e) => (e?.title ?? '').trim() !== '')
    .filter((e) => !e?.extendedProps?.isSummary);
  if (preparedEvents.length) {
    calendar.addEventSource(preparedEvents);
  }
  calendar.rerenderDates();
  renderDaySummaries(calendar);
}
