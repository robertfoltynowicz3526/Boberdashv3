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

const classListFrom = (val) => {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') return [val];
  return [];
};

const resolveEventKind = (raw = {}) => {
  const ext = raw.extendedProps || {};
  const classList = classListFrom(raw.classNames || raw.className);
  const hasClass = (needle) => classList.some((c) => (c || '').toString().toLowerCase().includes(needle));
  const baseType = (ext.type || ext.typ || raw.type || raw.typ || '').toString().trim().toLowerCase();
  const leaveKind = normalizeLeaveType(ext.leaveKind || ext.leaveType || raw.leaveKind, ext.type || ext.typ || raw.type || raw.typ, classList);

  const summaryAliases = ['summary'];
  const jobAliases = ['job', 'zlecenie'];
  const holidayAliases = ['holiday', 'święto', 'swieto', 'leave_holiday'];
  const dayOffAliases = ['dayoff', 'wolne', 'urlop', 'free', 'leave_free'];
  const leaveAliases = ['leave', 'l4', 'leave_l4', 'sick'];

  if (summaryAliases.includes(baseType) || hasClass('summary')) return { kind: 'summary' };
  if (holidayAliases.includes(baseType)) return { kind: 'holiday', leaveLabel: leaveKind || 'Święto' };
  if (dayOffAliases.includes(baseType)) return { kind: 'dayOff', leaveLabel: leaveKind || 'Urlop' };
  if (leaveAliases.includes(baseType)) return { kind: 'leave', leaveLabel: leaveKind || 'L4' };

  if (leaveKind) {
    if (leaveKind === 'Święto') return { kind: 'holiday', leaveLabel: leaveKind };
    if (leaveKind === 'Urlop') return { kind: 'dayOff', leaveLabel: leaveKind };
    return { kind: 'leave', leaveLabel: leaveKind };
  }

  if (jobAliases.includes(baseType)) return { kind: 'job' };
  return { kind: 'job' };
};

const buildJobTitle = (raw = {}, hours = {}) => {
  const ext = raw.extendedProps || {};
  const baseTitle = (raw.customer || raw.title || ext.client || '').toString().trim();
  const { workHours = 0, driveHours = 0, billedHours = 0 } = hours;
  const hourParts = [];
  if (workHours > 0) hourParts.push(`Praca: ${formatH(workHours)}`);
  if (driveHours > 0) hourParts.push(`Jazda: ${formatH(driveHours)}`);
  if (billedHours > 0) hourParts.push(`Fakturowane: ${formatH(billedHours)}`);
  const fallback = hourParts.join(' • ');
  if (baseTitle) return baseTitle;
  if (fallback) return fallback;
  return 'Zlecenie';
};

function prepareCalendarEvents(rawEvents = []) {
  const list = Array.isArray(rawEvents) ? rawEvents : [];
  const events = [];
  const jobsByDay = new Map();
  const leaveByDay = new Map();
  const emittedIds = new Set();
  const jobs = [];
  const leaves = [];
  const summaries = new Map();

  list.forEach((raw) => {
    const day =
      toDayString(raw.date || raw.start || raw.startStr || raw.dateStr || raw.extendedProps?.date) ||
      null;
    if (!day) return;
    const { kind, leaveLabel } = resolveEventKind(raw);

    if (kind === 'summary') {
      const { workHours, driveHours, billedHours } = extractHours(raw);
      summaries.set(day, { workHours, driveHours, billedHours });
      return;
    }

    if (kind === 'leave' || kind === 'dayOff' || kind === 'holiday') {
      leaveByDay.set(day, { type: kind, label: leaveLabel });
      leaves.push({ day, leaveType: leaveLabel || kind, kind, raw });
      return;
    }
    const jobRecord = { day, raw, kind: 'job' };
    jobs.push(jobRecord);
    if (!jobsByDay.has(day)) jobsByDay.set(day, []);
    jobsByDay.get(day).push(jobRecord);
  });

  jobs.forEach(({ day, raw }) => {
    const { workHours, driveHours, billedHours } = extractHours(raw);
    const title = buildJobTitle(raw, { workHours, driveHours, billedHours });
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
      classNames: classListFrom(raw.classNames || raw.className),
      extendedProps: {
        ...(raw.extendedProps || {}),
        kind: 'job',
        type: 'job',
        workHours,
        driveHours,
        billedHours,
      },
    });
  });

  leaves.forEach(({ day, leaveType, kind, raw }) => {
    const id = `leave-${day}`;
    if (emittedIds.has(id)) return;
    emittedIds.add(id);
    events.push({
      id,
      start: day,
      allDay: true,
      title: '',
      classNames: classListFrom(raw?.classNames || raw?.className),
      extendedProps: {
        kind: kind || 'leave',
        type: kind || 'leave',
        leaveType: leaveType,
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

    if (!dayJobs || dayJobs.length === 0) continue;
    if (leaveByDay.has(day)) continue;
    if (summaries.has(day)) {
      const { workHours = 0, driveHours = 0, billedHours = 0 } = summaries.get(day) || {};
      w = Math.max(w, workHours);
      d = Math.max(d, driveHours);
      b = Math.max(b, billedHours);
    }

    const id = `summary-${day}`;
    if (emittedIds.has(id)) continue;
    emittedIds.add(id);

    events.push({
      id,
      start: day,
      allDay: true,
      title: '',
      classNames: [],
      extendedProps: {
        kind: 'summary',
        type: 'summary',
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
  const kind = arg.event.extendedProps?.type || arg.event.extendedProps?.kind;

  if (kind === 'leave' || kind === 'dayOff' || kind === 'holiday') {
    const t = arg.event.extendedProps.leaveType || arg.event.extendedProps.leaveLabel || '';
    const icon =
      kind === 'holiday' || t === 'Święto'
        ? '🌾'
        : kind === 'dayOff' || t === 'Urlop'
          ? '🏖️'
          : '🏥';
    return {
      html: `
        <div class="icon" title="${t}">
          ${icon}
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

  const meta = [
    arg.event.extendedProps.workHours > 0 ? `Praca ${formatH(arg.event.extendedProps.workHours)}` : '',
    arg.event.extendedProps.driveHours > 0 ? `Jazda ${formatH(arg.event.extendedProps.driveHours)}` : '',
    arg.event.extendedProps.billedHours > 0 ? `Fakturowane ${formatH(arg.event.extendedProps.billedHours)}` : '',
  ]
    .filter(Boolean)
    .join(' • ');

  return {
    html: `
      <div class="job-card">
        <div class="job-title">${arg.event.title ?? ''}</div>
        ${meta ? `<div class="job-meta">${meta}</div>` : ''}
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
    eventDisplay: 'block',
    eventOrderStrict: true,
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
    const rank = { leave: 0, dayOff: 0, holiday: 0, job: 1, summary: 2 };
    const aKind = a.extendedProps?.type || a.extendedProps?.kind;
    const bKind = b.extendedProps?.type || b.extendedProps?.kind;
    return (rank[aKind] ?? 99) - (rank[bKind] ?? 99);
  };
  options.eventClassNames = (arg) => {
    const type = arg.event.extendedProps?.type || arg.event.extendedProps?.kind;
    const classes = classListFrom(arg.event.classNames);
    const ensure = (cls) => {
      if (!classes.includes(cls)) classes.push(cls);
    };
    if (type === 'summary') {
      ensure('fc-event--summary');
    } else if (type === 'leave' || type === 'dayOff' || type === 'holiday') {
      ensure('fc-event--icon-only');
      ensure(`fc-event--${type}`);
    } else {
      ensure('fc-event--job');
    }
    return classes;
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
