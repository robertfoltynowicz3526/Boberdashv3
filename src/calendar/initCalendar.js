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
  if (plain === 'L4') return { leaveType: 'sick', label: 'L4' };
  if (plain === 'URLOP') return { leaveType: 'free', label: 'Urlop' };
  if (plain === 'SWIETO') return { leaveType: 'holiday', label: 'Święto' };
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
  const totalsByDay = new Map();
  const leaveByDay = new Map();
  const jobs = [];

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

    if (extendedProps.isSummary || extendedProps.isDaySummary) return;

    const workHours = Number(extendedProps.workH ?? extendedProps.workHours ?? extendedProps.work ?? 0);
    const driveHours = Number(extendedProps.driveH ?? extendedProps.driveHours ?? extendedProps.drive ?? 0);
    const billedHours = readBilledHours(extendedProps);
    const cleanTitle = (evt.title || '').trim();

    if (!cleanTitle) return;

    const totals = totalsByDay.get(dateKey) || { work: 0, drive: 0, billed: 0 };
    totals.work += Number.isFinite(workHours) ? workHours : 0;
    totals.drive += Number.isFinite(driveHours) ? driveHours : 0;
    totals.billed += Number.isFinite(billedHours) ? billedHours : 0;
    totalsByDay.set(dateKey, totals);

    jobs.push({
      title: cleanTitle,
      start: dateKey,
      allDay: true,
      extendedProps: {
        ...extendedProps,
        kind: 'job',
        workHours: Number.isFinite(workHours) ? workHours : 0,
        driveHours: Number.isFinite(driveHours) ? driveHours : 0,
        billedHours: Number.isFinite(billedHours) ? billedHours : 0,
      },
    });
  });

  const prepared = [];

  leaveByDay.forEach((info, iso) => {
    prepared.push({
      start: iso,
      allDay: true,
      extendedProps: { kind: 'leave', leaveType: info.leaveType, leaveLabel: info.label },
    });
  });

  jobs.forEach((evt) => {
    if (leaveByDay.has(formatDateKey(FullCalendar, evt.start))) return;
    prepared.push(evt);
  });

  totalsByDay.forEach((totals, iso) => {
    if (leaveByDay.has(iso)) return;
    const workHours = Number.isFinite(totals.work) ? Number(totals.work.toFixed(1)) : 0;
    const driveHours = Number.isFinite(totals.drive) ? Number(totals.drive.toFixed(1)) : 0;
    const billedHours = Number.isFinite(totals.billed) ? Number(totals.billed.toFixed(1)) : 0;
    prepared.push({
      start: iso,
      allDay: true,
      extendedProps: {
        kind: 'summary',
        workHours,
        driveHours,
        billedHours,
      },
    });
  });

  return { preparedEvents: prepared, leaveByDay, totalsByDay };
}

export function renderDaySummaries(calendarInstance) {
  if (!calendarInstance) return;
  calendarInstance.el.querySelectorAll('.day-summary').forEach((node) => node.remove());
}

export function initCalendar(container, events = [], flags = [], extraOptions = {}) {
  const FullCalendar = window.FullCalendar;
  if (!FullCalendar || !container) return null;
  const { preparedEvents } = prepareCalendarEvents(events, FullCalendar);
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
    dayMaxEvents: true,
    dayMaxEventRows: true,
    moreLinkClick: 'popover',
    eventOrder: (a, b) => {
      const rank = { job: 0, leave: 1, summary: 2 };
      return (rank[a.extendedProps.kind] ?? 99) - (rank[b.extendedProps.kind] ?? 99);
    },
    eventOverlap: (stillEvent, movingEvent) => {
      return stillEvent.allDay && movingEvent.allDay ? true : false;
    },
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    validRange: undefined,
    customFlags: flags || [],
    eventContent(arg) {
      const kind = arg.event.extendedProps.kind;

      if (kind === 'leave') {
        const icon = arg.event.extendedProps.leaveType === 'sick' ? '🩺'
          : arg.event.extendedProps.leaveType === 'holiday' ? '🌾'
          : '🏁';
        const el = document.createElement('div');
        el.className = 'fc-leave-icon';
        el.textContent = icon;
        return { domNodes: [el] };
      }

      if (kind === 'summary') {
        const { workHours = 0, driveHours = 0, billedHours = 0 } = arg.event.extendedProps;
        const el = document.createElement('div');
        el.className = 'fc-summary-pill';
        el.innerHTML = `• Praca: ${workHours}h • Jazda: ${driveHours}h • Fakturowane: ${billedHours}h`;
        return { domNodes: [el] };
      }

      const { workHours = 0, driveHours = 0, billedHours = 0 } = arg.event.extendedProps;
      const wrap = document.createElement('div');
      wrap.className = 'fc-job-pill';
      wrap.innerHTML = `
        <div class="fc-job-title">${arg.event.title}</div>
        <div class="fc-job-meta">• Praca: ${workHours}h • Jazda: ${driveHours}h • Fakturowane: ${billedHours}h</div>
      `;
      return { domNodes: [wrap] };
    },
    datesSet() {},
    events: preparedEvents,
    ...extraOptions,
  };

  const calendar = new FullCalendar.Calendar(container, options);
  const baseDatesSet = options.datesSet;
  calendar.setOption('datesSet', (info) => {
    if (typeof baseDatesSet === 'function') baseDatesSet(info);
    if (typeof extraOptions.onDatesSet === 'function') extraOptions.onDatesSet(info);
    requestAnimationFrame(() => calendar.updateSize());
  });
  calendar.setOption('eventDidMount', (info) => {
    if (info.el.classList) info.el.classList.add('fc-event-mounted');
    if (typeof extraOptions.eventDidMount === 'function') extraOptions.eventDidMount(info);
  });
  calendar.render();
  window.addEventListener('resize', () => {
    try { calendar.updateSize(); } catch (_) {}
  });
  return calendar;
}

export function updateCalendarData(calendar, events = [], flags = []) {
  if (!calendar) return;
  calendar.setOption('customFlags', flags || []);
  calendar.removeAllEvents();
  const { preparedEvents } = prepareCalendarEvents(events, window.FullCalendar);
  if (preparedEvents.length) {
    calendar.addEventSource(preparedEvents);
  }
  calendar.rerenderDates();
}
