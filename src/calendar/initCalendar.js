import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import { getDailyTotals, loadEventsFromDb, getDayFlagsSync, setCalendarEvents, setDayFlags } from '../data/dailyTotals.js';

export function bootCalendar(extraOptions = {}) {
  const el = document.getElementById('calendar') || document.getElementById('kalendarz');
  if (!el) return null;

  const plugins = [dayGridPlugin, interactionPlugin].filter(Boolean);
  if (!Calendar || plugins.length === 0) {
    console.error('FullCalendar resources not available');
    return null;
  }

  const calendar = new Calendar(el, {
    plugins,
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
    dayCellDidMount: (arg) => {
      (async () => {
        try {
          const existing = arg.el.querySelector('.day-summary');
          if (existing) existing.remove();

          if (typeof getDailyTotals !== 'function') return;
          const totals = await getDailyTotals(arg.date);
          if (totals?.l4 || totals?.urlop || totals?.swieto) return;
          const allZero = !totals?.work && !totals?.drive && !totals?.billed;
          if (allZero) return;

          const frame = arg.el.querySelector('.fc-daygrid-day-frame');
          if (!frame) return;
          const footer = document.createElement('div');
          footer.className = 'day-summary';
          footer.innerHTML = `
            <div class="day-summary-row">
              <span>• Praca: <b>${(totals.work ?? 0).toFixed(1)}h</b></span>
              <span>• Jazda: <b>${(totals.drive ?? 0).toFixed(1)}h</b></span>
              <span>• Fakturowane: <b>${(totals.billed ?? 0).toFixed(1)}h</b></span>
            </div>`;
          frame.appendChild(footer);
        } catch (e) {
          console.error('dayCellDidMount error:', e);
        }
      })();
    },
    events: async (info, success) => {
      try {
        if (typeof loadEventsFromDb !== 'function') {
          success([]);
          return;
        }
        const raw = await loadEventsFromDb(info.start, info.end);
        const mapped = (raw || []).map((e) => {
          if (['L4', 'URLOP', 'SWIETO'].includes(e.type)) {
            return {
              start: e.start,
              end: e.end,
              allDay: true,
              display: 'background',
              classNames: [
                'fc-offday',
                e.type === 'L4' ? 'is-l4' : (e.type === 'URLOP' ? 'is-urlop' : 'is-swieto'),
              ],
            };
          }
          return {
            id: e.id,
            title: e.title,
            start: e.start,
            end: e.end,
            allDay: false,
            classNames: Array.isArray(e.classNames) ? e.classNames : ['job-event'],
          };
        });
        success(mapped);
      } catch (e) {
        console.error('events loader error:', e);
        success([]);
      }
    },
    selectAllow: (selection) => {
      try {
        const flags = getDayFlagsSync(selection?.start);
        return !(flags?.l4 || flags?.urlop || flags?.swieto);
      } catch (e) {
        console.error('selectAllow error:', e);
        return true;
      }
    },
    ...extraOptions,
  });

  calendar.render();

  try {
    if ('ResizeObserver' in window) {
      const ro = new window.ResizeObserver(() => calendar.updateSize());
      ro.observe(el);
    } else {
      window.addEventListener('resize', () => calendar.updateSize());
    }
  } catch (e) {
    console.warn('ResizeObserver fallback:', e);
  }

  document.getElementById('btnPrev')?.addEventListener('click', () => calendar.prev());
  document.getElementById('btnNext')?.addEventListener('click', () => calendar.next());
  document.getElementById('btnToday')?.addEventListener('click', () => calendar.today());

  return calendar;
}

export function updateCalendarData(calendar, events = [], flags = []) {
  if (!calendar) return;
  setCalendarEvents(events);
  setDayFlags(flags);
  calendar.setOption('customFlags', flags || []);
  calendar.refetchEvents();
}
