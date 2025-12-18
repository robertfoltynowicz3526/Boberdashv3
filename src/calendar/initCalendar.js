function dayFromEvent(event) {
  const direct = event?.startStr || event?.dateStr || event?.date;
  if (typeof direct === 'string') return direct.slice(0, 10);
  const start = event?.start;
  if (typeof start === 'string') return start.slice(0, 10);
  if (start?.toISOString) return start.toISOString().slice(0, 10);
  return null;
}

function prepareCalendarEvents(rawEvents = []) {
  const events = Array.isArray(rawEvents) ? rawEvents : [];
  const jobsByDay = new Map();
  const leavesByDay = new Map();
  const emittedIds = new Set();
  const prepared = [];
  let fallbackId = 0;

  function pushEvent(event) {
    if (!event?.id || emittedIds.has(event.id)) return;
    emittedIds.add(event.id);
    prepared.push(event);
  }

  for (const e of events) {
    const day = dayFromEvent(e);
    if (!day) continue;

    const props = e.extendedProps || {};
    const leaveKind = (props.leaveKind || props.kind || '').toUpperCase();
    const isLeave = leaveKind === 'L4' || leaveKind === 'WOLNE' || leaveKind === 'ŚWIĘTO' || leaveKind === 'SWIETO';
    if (isLeave) {
      leavesByDay.set(day, leaveKind || 'LEAVE');
      const leaveId = e.id || props.id || `leave-${day}-${fallbackId++}`;
      pushEvent({
        id: `leave-${leaveId}`,
        title: '',
        start: day,
        allDay: true,
        extendedProps: { ...props, kind: 'leave', leaveKind },
      });
      continue;
    }

    if (props.kind === 'summary' || props.isSummary || props.isDaySummary) continue;

    const title = (e?.title ?? '').trim();
    const work = Number(props.workHours ?? props.work ?? 0);
    const drive = Number(props.driveHours ?? props.drive ?? 0);
    const bill = Number(props.billHours ?? props.bill ?? props.invoiceHours ?? 0);
    const hasHours = (Number.isFinite(work) && work !== 0) || (Number.isFinite(drive) && drive !== 0) || (Number.isFinite(bill) && bill !== 0);
    if (title === '' && !hasHours) continue;

    if (!jobsByDay.has(day)) jobsByDay.set(day, []);
    jobsByDay.get(day).push({
      id: e.id || props.id || `job-${day}-${fallbackId++}`,
      start: day,
      allDay: true,
      title: title || props.name || ' ',
      extendedProps: {
        ...props,
        kind: 'job',
        workHours: Number.isFinite(work) ? work : 0,
        driveHours: Number.isFinite(drive) ? drive : 0,
        billedHours: Number.isFinite(bill) ? bill : 0,
      },
    });
  }

  for (const [, jobs] of jobsByDay.entries()) {
    for (const job of jobs) {
      pushEvent({ ...job, id: `job-${job.id}` });
    }
  }

  for (const [day, jobs] of jobsByDay.entries()) {
    const totals = jobs.reduce(
      (acc, job) => {
        acc.work += Number(job.extendedProps?.workHours ?? 0) || 0;
        acc.drive += Number(job.extendedProps?.driveHours ?? 0) || 0;
        acc.bill += Number(job.extendedProps?.billedHours ?? 0) || 0;
        return acc;
      },
      { work: 0, drive: 0, bill: 0 },
    );

    const shouldAddSummary = jobs.length > 0 || totals.work > 0 || totals.drive > 0 || totals.bill > 0;
    if (!shouldAddSummary) continue;
    if (leavesByDay.has(day) && jobs.length === 0) continue;

    pushEvent({
      id: `summary-${day}`,
      start: day,
      allDay: true,
      title: '',
      extendedProps: {
        kind: 'summary',
        workHours: totals.work,
        driveHours: totals.drive,
        billedHours: totals.bill,
      },
    });
  }

  return { preparedEvents: prepared, leaveByDay: leavesByDay, jobsByDay };
}

export function renderDaySummaries() {
  // Podsumowanie dnia jest teraz renderowane jako osobny event.
}

export function initCalendar(container, events = [], flags = [], extraOptions = {}) {
  const FullCalendar = window.FullCalendar;
  if (!FullCalendar || !container) return null;

  const rawEvents = Array.isArray(events) ? events : [];
  const { preparedEvents, leaveByDay } = prepareCalendarEvents(rawEvents);
  const eventsProvider = (info, successCallback) => successCallback(preparedEvents);
  const localeOption = (FullCalendar?.locales || []).find((l) => l.code === 'pl') || 'pl';

  const kindOrder = { job: 0, leave: 1, summary: 2 };

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
    eventOrder: (a, b) => (kindOrder[a.extendedProps?.kind] ?? 0) - (kindOrder[b.extendedProps?.kind] ?? 0),
    leaveByDay,
    eventOverlap: (stillEvent, movingEvent) => {
      return stillEvent.allDay && movingEvent.allDay ? true : false;
    },
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    validRange: undefined,
    customFlags: flags || [],
    eventContent(arg) {
      const kind = (arg.event.extendedProps?.leaveKind || '').toUpperCase();
      if (kind === 'L4' || kind === 'WOLNE' || kind === 'ŚWIĘTO' || kind === 'SWIETO' || kind === 'FLAG') {
        const span = document.createElement('span');
        span.className = 'day-flag strong';
        return { domNodes: [span] };
      }
      return true;
    },
    dayCellDidMount(info) {
      const leaveMap = info.view?.calendar?.getOption('leaveByDay') || new Map();
      const iso = info.date.toISOString().slice(0, 10);
      if (leaveMap.has(iso)) info.el.setAttribute('data-has-leave', 'true');
    },
    datesSet() {},
    events: eventsProvider,
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
  window.addEventListener('resize', () => {
    try {
      calendar.updateSize();
    } catch (_) {}
  });
  return calendar;
}

export function updateCalendarData(calendar, events = [], flags = []) {
  if (!calendar) return;
  calendar.setOption('customFlags', flags || []);
  const rawEvents = Array.isArray(events) ? events : [];
  const { preparedEvents, leaveByDay } = prepareCalendarEvents(rawEvents);
  const eventsProvider = (info, successCallback) => successCallback(preparedEvents);
  calendar.setOption('leaveByDay', leaveByDay);
  calendar.setOption('events', eventsProvider);
  calendar.refetchEvents();
  calendar.rerenderDates();
}
