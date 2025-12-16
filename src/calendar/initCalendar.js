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

function buildEventContent(arg) {
  const title = document.createElement('div');
  title.textContent = arg.event.title || '';
  return { domNodes: [title] };
}

function mountDayFlag(calendar, info) {
  const existingFlag = info.el.querySelector('.day-flag');
  if (existingFlag) existingFlag.remove();
  const flags = info.view.calendar.getOption('customFlags') || [];
  const dateKey = formatDateKey(calendar, info.date);
  const flag = Array.isArray(flags) ? flags.find((f) => f.date === dateKey) : null;
  if (!flag) return;

  const wrap = document.createElement('div');
  wrap.className = `day-flag day-flag--${flag.type}`;
  const icon = flag.type === 'urlop' ? '🏁' : flag.type === 'l4' ? '➕' : '🌿';
  wrap.innerHTML = `<div class="pill">${icon}</div>`;
  info.el.style.position = 'relative';
  info.el.appendChild(wrap);
}

export function renderDaySummaries(calendarInstance) {
  if (!calendarInstance) return;
  calendarInstance.el.querySelectorAll('.day-summary').forEach((node) => node.remove());
  const events = calendarInstance.getEvents();
  const byDate = new Map();
  events.forEach((evt) => {
    if (evt?.extendedProps?.kind === 'off') return;
    const dateKey = evt.startStr?.slice(0, 10);
    if (!dateKey) return;
    if (!byDate.has(dateKey)) byDate.set(dateKey, []);
    byDate.get(dateKey).push(evt);
  });

  byDate.forEach((arr, dateKey) => {
    const hasOff = arr.some((evt) => evt?.extendedProps?.kind === 'off');
    if (hasOff) return;
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
    eventDisplay: 'block',
    eventOrder: 'start,-allDay,title',
    eventOverlap: false,
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    validRange: undefined,
    customFlags: flags || [],
    eventContent: buildEventContent,
    dayCellDidMount(info) {
      mountDayFlag(FullCalendar, info);
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

export function updateCalendarData(calendar, events = [], flags = []) {
  if (!calendar) return;
  calendar.setOption('customFlags', flags || []);
  calendar.removeAllEvents();
  if (Array.isArray(events) && events.length) {
    calendar.addEventSource(events);
  }
  calendar.rerenderDates();
  renderDaySummaries(calendar);
}
