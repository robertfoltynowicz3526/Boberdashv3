import { Calendar, dayGridPlugin, interactionPlugin } from '../fullcalendar-shims/core.js';
import { loadCalendarEvents, getDailyTotals } from './data';

export function bootCalendar() {
  const host = document.getElementById('calendar');
  if (!host) return;
  if (!Calendar) {
    console.error('[calendar] FullCalendar not available.');
    return;
  }

  const fetchDailyTotals = async (date) => {
    try {
      return await getDailyTotals(date);
    } catch (e) {
      console.error(e);
      return null;
    }
  };

  const buildSummaryModel = (totals) => {
    if (!totals || totals.l4 || totals.urlop || totals.swieto) return null;
    const work = Number(totals.work ?? 0);
    const drive = Number(totals.drive ?? 0);
    const billed = Number(totals.billed ?? 0);
    if (work + drive + billed === 0) return null;
    return {
      work,
      drive,
      billed,
    };
  };

  const renderDaySummary = (cellEl, model) => {
    if (!cellEl || !model) return;
    const frame = cellEl.querySelector('.fc-daygrid-day-frame') || cellEl;
    const footer = document.createElement('div');
    footer.className = 'day-summary';
    const row = document.createElement('div');
    row.className = 'day-summary-row';
    row.innerHTML =
      `Praca: <b>${model.work.toFixed(1)}h</b> • ` +
      `Jazda: <b>${model.drive.toFixed(1)}h</b> • ` +
      `Fakturowane: <b>${model.billed.toFixed(1)}h</b>`;
    footer.appendChild(row);
    frame.appendChild(footer);
  };

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
        const totals = await fetchDailyTotals(arg.date);
        const model = buildSummaryModel(totals);
        renderDaySummary(arg.el, model);
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
