import { Calendar, dayGridPlugin, interactionPlugin } from '../fullcalendar-shims/core.js';
import { loadCalendarEvents, getDailyTotals } from './data.js';

export function bootCalendar() {
  const host = document.getElementById('calendar');
  if (!host) return;

  const cal = new Calendar(host, {
    plugins: [dayGridPlugin, interactionPlugin],
    initialView: 'dayGridMonth',
    headerToolbar: false,
    fixedWeekCount: false,
    showNonCurrentDates: true,
    eventOverlap: false,
    dayMaxEventRows: 3,
    moreLinkClick: 'popover',

    datesSet: ({ view }) => {
      const t = document.getElementById('calTitle');
      if (t) t.textContent = view.title;
    },

    events: async (info, success) => {
      try {
        success(await loadCalendarEvents(info.start, info.end));
      } catch (e) { console.error(e); success([]); }
    },

    dayCellDidMount: (arg) => {
      (async () => {
        try {
          const t = await getDailyTotals(arg.date);
          if (!t || t.l4 || t.urlop || t.swieto) return; // NIE pokazuj sum w dniach wolnych
          if ((t.work ?? 0) + (t.drive ?? 0) + (t.billed ?? 0) === 0) return;
          const frame = arg.el.querySelector('.fc-daygrid-day-frame');
          if (!frame) return;
          const footer = document.createElement('div');
          footer.style.cssText = 'margin-top:4px;font-size:12px;opacity:.95;';
          footer.innerHTML =
            `• Praca: <b>${(t.work ?? 0).toFixed(1)}h</b>&nbsp;` +
            `• Jazda: <b>${(t.drive ?? 0).toFixed(1)}h</b>&nbsp;` +
            `• Fakturowane: <b>${(t.billed ?? 0).toFixed(1)}h</b>`;
          frame.appendChild(footer);
        } catch {}
      })();
    },
  });

  cal.render();

  document.getElementById('btnPrev')?.addEventListener('click', () => cal.prev());
  document.getElementById('btnNext')?.addEventListener('click', () => cal.next());
  document.getElementById('btnToday')?.addEventListener('click', () => cal.today());

  try {
    if ('ResizeObserver' in window) {
      const ro = new window.ResizeObserver(() => cal.updateSize());
      ro.observe(host);
    } else {
      window.addEventListener('resize', () => cal.updateSize());
    }
  } catch (e) { console.warn(e); }
}
