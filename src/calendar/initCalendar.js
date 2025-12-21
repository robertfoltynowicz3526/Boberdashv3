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

const normalizeLeaveType = (leaveKind = '', type = '', classNames = []) => {
  const kindUpper = (leaveKind || '').toString().trim().toUpperCase();
  const typeUpper = (type || '').toString().trim().toUpperCase();
  const classes = Array.isArray(classNames) ? classNames : (typeof classNames === 'string' ? [classNames] : []);
  const hasClass = (needle) => classes.some((c) => (c || '').toString().toLowerCase().includes(needle));

  if (kindUpper === 'L4' || typeUpper.includes('LEAVE_L4') || hasClass('absence-l4')) return 'L4';
  if (kindUpper === 'SWIETO' || kindUpper === 'ŚWIĘTO' || typeUpper.includes('LEAVE_HOLIDAY') || hasClass('absence-święto') || hasClass('absence-swieto')) return 'Święto';
  if (kindUpper === 'URL' || kindUpper === 'WOLNE' || kindUpper === 'URLP' || typeUpper.includes('LEAVE_FREE') || hasClass('absence-url') || hasClass('absence-urlop') || hasClass('absence-wolne')) return 'Urlop';
  return kindUpper === '' && typeUpper === '' ? '' : (kindUpper || typeUpper || '');
};

const extractHours = (source = {}) => {
  const props = source.extendedProps || {};
  const toNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const workHours = toNum(props.workHours ?? props.workH ?? props.work ?? source.workHours ?? source.work ?? source.praca);
  const driveHours = toNum(props.driveHours ?? props.driveH ?? props.drive ?? source.driveHours ?? source.drive ?? source.jazda);
  const billedHours = toNum(
    props.billedHours ??
      props.billHours ??
      props.billH ??
      props.bill ??
      props.invoiceHours ??
      props.fh ??
      source.billedHours ??
      source.bill ??
      source.fh ??
      source.invoiceHours ??
      source.fakturowane ??
      source.billed
  );
  return { workHours, driveHours, billedHours };
};

function prepareCalendarEvents(rawEvents = []) {
  const list = Array.isArray(rawEvents) ? rawEvents : [];
  const events = [];
  const jobsByDay = new Map();
  const leaveByDay = new Map();
  const emittedIds = new Set();
  const jobs = [];
  const leaves = [];

  list.forEach((raw) => {
    const day =
      toDayString(raw.date || raw.start || raw.startStr || raw.dateStr || raw.extendedProps?.date) ||
      null;
    if (!day) return;
    const leaveType = normalizeLeaveType(
      raw.extendedProps?.leaveKind || raw.extendedProps?.leaveType || raw.leaveKind,
      raw.extendedProps?.type || raw.extendedProps?.typ || raw.type || raw.typ,
      raw.classNames || raw.className
    );
    if (leaveType) {
      leaveByDay.set(day, { type: leaveType });
      leaves.push({ day, leaveType, raw });
      return;
    }
    const jobRecord = { day, raw };
    jobs.push(jobRecord);
    if (!jobsByDay.has(day)) jobsByDay.set(day, []);
    jobsByDay.get(day).push(jobRecord);
  });

  jobs.forEach(({ day, raw }) => {
    const title = raw.customer || raw.title || raw.extendedProps?.client || '';
    const { workHours, driveHours, billedHours } = extractHours(raw);
    const empty = !title && workHours === 0 && driveHours === 0 && billedHours === 0;
    if (empty) return;
    const idBase = raw.id || `day-${day}-${events.length}`;
    const id = `job-${idBase}`;
    if (emittedIds.has(id)) return;
    emittedIds.add(id);
    events.push({
      id,
      start: day,
      allDay: true,
      title,
      classNames: raw.classNames || raw.className,
      extendedProps: {
        ...(raw.extendedProps || {}),
        kind: 'job',
        workHours,
        driveHours,
        billedHours,
      },
    });
  });

  leaves.forEach(({ day, leaveType }) => {
    const id = `leave-${day}`;
    if (emittedIds.has(id)) return;
    emittedIds.add(id);
    events.push({
      id,
      start: day,
      allDay: true,
      title: '',
      classNames: ['fc-event-leave'],
      extendedProps: {
        kind: 'leave',
        leaveType,
      },
    });
  });

  for (const [day, dayJobs] of jobsByDay.entries()) {
    let w = 0;
    let d = 0;
    let b = 0;
    dayJobs.forEach(({ raw }) => {
      const { workHours, driveHours, billedHours } = extractHours(raw);
      w += workHours;
      d += driveHours;
      b += billedHours;
    });

    if ((!dayJobs || dayJobs.length === 0) && w === 0 && d === 0 && b === 0) continue;
    if ((dayJobs?.length ?? 0) === 0 && leaveByDay.has(day)) continue;

    const id = `summary-${day}`;
    if (emittedIds.has(id)) continue;
    emittedIds.add(id);

    events.push({
      id,
      start: day,
      allDay: true,
      title: '',
      classNames: ['fc-event-summary'],
      extendedProps: {
        kind: 'summary',
        workHours: w,
        driveHours: d,
        billedHours: b,
      },
    });
  }

  return { preparedEvents: events, leaveByDay };
}

function formatH(x) {
  return `${(Number(x || 0)).toFixed(1)}h`;
}

function renderEventContent(arg) {
  const kind = arg.event.extendedProps?.kind;

  if (kind === 'leave') {
    const t = arg.event.extendedProps.leaveType || '';
    return {
      html: `
        <div class="leave-icon" title="${t}">
          ${t === 'Święto' ? '🌾' : t === 'Urlop' ? '🏖️' : '🏥'}
        </div>
      `,
    };
  }

  if (kind === 'summary') {
    const w = formatH(arg.event.extendedProps.workHours);
    const d = formatH(arg.event.extendedProps.driveHours);
    const b = formatH(arg.event.extendedProps.billedHours);
    return {
      html: `
        <div class="summary-card">
          <div class="line">• Praca: ${w} • Jazda: ${d} • Fakturowane: ${b}</div>
        </div>
      `,
    };
  }

  return {
    html: `
      <div class="job-card">
        <div class="job-title">${arg.event.title ?? ''}</div>
      </div>
    `,
  };
}

export function renderDaySummaries() {
  // Podsumowanie dnia jest teraz renderowane jako osobny event.
}

export function initCalendar(container, events = [], flags = [], extraOptions = {}) {
  const FullCalendar = window.FullCalendar;
  if (!FullCalendar || !container) return null;

  const rawEvents = Array.isArray(events) ? events : [];
  const { preparedEvents, leaveByDay } = prepareCalendarEvents(rawEvents);
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
    leaveByDay,
    eventOverlap: (stillEvent, movingEvent) => {
      return stillEvent.allDay && movingEvent.allDay ? true : false;
    },
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    validRange: undefined,
    customFlags: flags || [],
    datesSet() {},
    events: preparedEvents,
    ...extraOptions,
  };

  options.eventContent = renderEventContent;
  options.eventOrder = (a, b) => {
    const rank = { job: 0, leave: 1, summary: 2 };
    return (rank[a.extendedProps?.kind] ?? 99) - (rank[b.extendedProps?.kind] ?? 99);
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
  calendar.batchRendering(() => {
    calendar.setOption('leaveByDay', leaveByDay);
    calendar.setOption('events', preparedEvents);
  });
  calendar.rerenderEvents();
  calendar.rerenderDates();
}
