import { getDailyTotals, loadEventsFromDb, getDayFlagsSync, setCalendarEvents, setDayFlags } from '../data/dailyTotals.js';

export function initCalendar(calendarEl, extraOptions = {}) {
  const FullCalendar = window.FullCalendar;
  if (!FullCalendar || !calendarEl) return null;

  const dayGridPlugin = (window.dayGrid && window.dayGrid.default) || FullCalendar?.dayGridPlugin || FullCalendar?.dayGrid;
  const interactionPlugin = (window.interaction && window.interaction.default) || FullCalendar?.interactionPlugin || FullCalendar?.interaction;

  const options = {
    plugins: [dayGridPlugin, interactionPlugin],
    initialView: 'dayGridMonth',
    headerToolbar: false,
    fixedWeekCount: false,
    showNonCurrentDates: true,
    dayMaxEventRows: 3,
    moreLinkClick: 'popover',
    eventOverlap: false,
    slotEventOverlap: false,
    eventDisplay: 'block',
    eventOrder: 'start,-duration,title',
    dayCellDidMount: async (arg) => {
      const existing = arg.el.querySelector('.day-summary');
      if (existing) existing.remove();

      const totals = await getDailyTotals(arg.date);
      if (totals?.l4 || totals?.urlop || totals?.swieto) return;
      const allZero = (!totals?.work && !totals?.drive && !totals?.billed);
      if (allZero) return;

      const footer = document.createElement('div');
      footer.className = 'day-summary';
      footer.innerHTML = `
      <div class="day-summary-row">
        <span>• Praca: <b>${(totals.work ?? 0).toFixed(1)}h</b></span>
        <span>• Jazda: <b>${(totals.drive ?? 0).toFixed(1)}h</b></span>
        <span>• Fakturowane: <b>${(totals.billed ?? 0).toFixed(1)}h</b></span>
      </div>
    `;
      arg.el.querySelector('.fc-daygrid-day-frame')?.appendChild(footer);
    },
    events: async (info, success) => {
      const raw = await loadEventsFromDb(info.start, info.end);
      const mapped = (raw || []).map((e) => {
        if (e.type === 'L4' || e.type === 'URLOP' || e.type === 'SWIETO') {
          return {
            start: e.start,
            end: e.end,
            allDay: true,
            display: 'background',
            classNames: [
              'fc-offday',
              e.type === 'L4' ? 'is-l4' :
              e.type === 'URLOP' ? 'is-urlop' : 'is-swieto'
            ],
          };
        }
        return {
          ...e,
          classNames: Array.isArray(e.classNames) ? e.classNames : ['job-event'],
        };
      });
      success(mapped);
    },
    selectAllow: (selection) => {
      const flags = getDayFlagsSync(selection?.start);
      return !(flags?.l4 || flags?.urlop || flags?.swieto);
    },
    ...extraOptions,
  };

  const calendar = new FullCalendar.Calendar(calendarEl, options);
  calendar.render();
  return calendar;
}

export function updateCalendarData(calendar, events = [], flags = []) {
  if (!calendar) return;
  setCalendarEvents(events);
  setDayFlags(flags);
  calendar.setOption('customFlags', flags || []);
  calendar.refetchEvents();
}
