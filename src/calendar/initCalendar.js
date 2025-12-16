function buildEventContent(arg) {
  const title = document.createElement('div');
  title.textContent = arg.event.title || '';
  return { domNodes: [title] };
}

export function renderDaySummaries(calendarInstance) {
  if (!calendarInstance) return;
  calendarInstance.el.querySelectorAll('.day-summary').forEach((node) => node.remove());
  const events = calendarInstance.getEvents();
  const byDate = new Map();
  events.forEach((evt) => {
    const dateKey = evt.startStr?.slice(0, 10);
    if (!dateKey) return;
    if (!byDate.has(dateKey)) byDate.set(dateKey, []);
    byDate.get(dateKey).push(evt);
  });

  byDate.forEach((arr, dateKey) => {
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

export function initCalendar(container, events = [], flagSets = {}, extraOptions = {}) {
  const FullCalendar = window.FullCalendar;
  if (!FullCalendar || !container) return null;
  const localeOption = (FullCalendar?.locales || []).find((l) => l.code === 'pl') || 'pl';
  const options = {
    locale: localeOption,
    initialView: 'dayGridMonth',
    height: 'auto',
    headerToolbar: { left: 'prev,next today', center: 'title', right: 'month,week' },
    navLinks: true,
    expandRows: true,
    contentHeight: 'auto',
    handleWindowResize: true,
    fixedWeekCount: false,
    dayMaxEventRows: 4,
    moreLinkClick: 'popover',
    eventOrder: 'start,-duration,title',
    eventOverlap: false,
    eventDisplay: 'block',
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    validRange: undefined,
    flagSets: flagSets || {},
    eventContent: buildEventContent,
    eventDidMount(info) {
      info.el.classList.add('jd-event');
    },
    dayCellDidMount(arg) {
      const sets = arg?.view?.calendar?.getOption('flagSets') || {};
      const iso = arg.date.toISOString().slice(0, 10);

      let flag = null;
      if (sets?.l4?.has?.(iso)) flag = { cls: 'jd-flag jd-flag--l4', icon: '➕' };
      if (sets?.swieto?.has?.(iso)) flag = { cls: 'jd-flag jd-flag--swieto', icon: '⚑' };
      if (sets?.urlop?.has?.(iso)) flag = { cls: 'jd-flag jd-flag--urlop', icon: '🌿' };

      if (flag) {
        const cal = arg.view?.calendar;
        const alreadyHasBg = cal?.getEvents().some((ev) => {
          return ev.display === 'background'
            && ev.classNames?.includes('jd-bg-flag')
            && ev.startStr?.slice(0, 10) === iso;
        });
        if (!alreadyHasBg && cal?.addEvent) {
          cal.addEvent({
            start: iso,
            end: iso,
            display: 'background',
            classNames: ['jd-bg-flag'],
          });
        }

        const holder = document.createElement('div');
        holder.className = flag.cls;
        holder.textContent = flag.icon;
        arg.el.querySelector('.fc-daygrid-day-frame')?.appendChild(holder);
      }
    },
    datesSet() {},
    events,
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
  });
  calendar.render();
  window.addEventListener('resize', () => {
    try { calendar.updateSize(); } catch (_) {}
  });
  renderDaySummaries(calendar);
  return calendar;
}

export function updateCalendarData(calendar, events = [], flagSets = {}) {
  if (!calendar) return;
  calendar.setOption('flagSets', flagSets || {});
  calendar.removeAllEvents();
  if (Array.isArray(events) && events.length) {
    calendar.addEventSource(events);
  }
  calendar.rerenderDates();
  renderDaySummaries(calendar);
}
