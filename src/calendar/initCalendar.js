function isoFromEvent(event) {
  const iso =
    (event?.startStr || event?.start || event?.dateStr || event?.date)?.toISOString?.()?.slice(0, 10) ??
    event?.start?.slice?.(0, 10);
  return iso || null;
}

function prepareCalendarEvents(rawEvents = []) {
  const events = Array.isArray(rawEvents) ? rawEvents : [];
  const prepared = [];

  const sums = new Map();
  for (const e of events) {
    const iso = isoFromEvent(e);
    if (!iso) continue;
    const k = e.extendedProps || {};
    const work = Number(k.workHours ?? k.work ?? 0);
    const drive = Number(k.driveHours ?? k.drive ?? 0);
    const bill = Number(k.billHours ?? k.bill ?? k.invoiceHours ?? 0);
    if (!sums.has(iso)) sums.set(iso, { work: 0, drive: 0, bill: 0, hasOrders: false });
    const s = sums.get(iso);
    if ((e.title ?? '').trim() !== '' && !k.leaveKind) s.hasOrders = true;
    s.work += Number.isFinite(work) ? work : 0;
    s.drive += Number.isFinite(drive) ? drive : 0;
    s.bill += Number.isFinite(bill) ? bill : 0;
  }

  const leaveByDay = new Set();
  for (const e of events) {
    const kind = (e.extendedProps?.leaveKind || '').toUpperCase();
    if (kind === 'L4' || kind === 'WOLNE' || kind === 'ŚWIĘTO' || kind === 'SWIETO') {
      const iso = (e.startStr || e.start)?.toISOString?.()?.slice(0, 10) ?? e.start?.slice?.(0, 10);
      if (iso) leaveByDay.add(iso);
    }
  }

  for (const e of events) {
    const title = (e?.title ?? '').trim();
    if (title === '') continue;
    if (e?.extendedProps?.isSummary) continue;
    const iso = isoFromEvent(e);
    if (iso && leaveByDay.has(iso)) continue;
    prepared.push(e);
  }

  for (const [iso, s] of sums.entries()) {
    if (leaveByDay.has(iso)) continue;
    if (!s.hasOrders) continue;
    prepared.push({
      title: `• Praca: ${s.work.toFixed(1)}h • Jazda: ${s.drive.toFixed(1)}h • Fakturowane: ${s.bill.toFixed(1)}h`,
      start: iso,
      allDay: true,
      extendedProps: { isDaySummary: true, sort: 9999 },
    });
  }

  for (const iso of leaveByDay) {
    prepared.push({ title: '', start: iso, allDay: true, extendedProps: { leaveKind: 'FLAG' } });
  }

  return { preparedEvents: prepared, leaveByDay };
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
    eventOrder: (a, b) => (a.extendedProps?.sort ?? 0) - (b.extendedProps?.sort ?? 0),
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
      if (arg.event.extendedProps?.isDaySummary) {
        return true;
      }
      return true;
    },
    dayCellDidMount(info) {
      const leaveSet = info.view?.calendar?.getOption('leaveByDay') || new Set();
      const iso = info.date.toISOString().slice(0, 10);
      if (leaveSet.has(iso)) info.el.setAttribute('data-has-leave', 'true');
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
  calendar.setOption('leaveByDay', leaveByDay);
  calendar.removeAllEvents();
  if (preparedEvents.length) {
    calendar.addEventSource(preparedEvents);
  }
  calendar.rerenderDates();
}
