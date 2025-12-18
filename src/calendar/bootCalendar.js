import { Calendar, dayGridPlugin, interactionPlugin } from '../fullcalendar-shims/core.js';
import { loadCalendarEvents } from './data.js';

export async function bootCalendar() {
  const host = document.getElementById('calendar-root') || document.getElementById('kalendarz') || document.getElementById('calendar');
  if (!host) return;

  (function removeDebug() {
    const el = document.getElementById('node-overdrive') || document.querySelector('.node-overdrive, .debug-banner');
    if (el) el.remove();
  })();

  try {
    const { events, leaveByDay } = await loadCalendarEvents();

    const cal = new Calendar(host, {
      plugins: [dayGridPlugin, interactionPlugin],
      initialView: 'dayGridMonth',
      headerToolbar: false,
      fixedWeekCount: false,
      showNonCurrentDates: true,
      eventOverlap: false,
      dayMaxEventRows: 3,
      moreLinkClick: 'popover',
      events,
      eventContent(arg) {
        const xp = arg.event.extendedProps;
        if (xp?.type === 'leave') {
          const wrap = document.createElement('div');
          wrap.className = 'leave-icon';
          const badge = document.createElement('div');
          badge.className = 'leave-badge';
          const icon = document.createElement('span');
          icon.className = 'leave-glyph';
          const k = (xp.leaveKind || '').toUpperCase();
          if (k === 'L4') icon.classList.add('icon-l4');
          if (k === 'WOLNE') icon.classList.add('icon-wolne');
          if (k === 'ŚWIĘTO' || k === 'SWIETO') icon.classList.add('icon-swieto');
          badge.appendChild(icon); wrap.appendChild(badge);
          return { domNodes: [wrap] };
        }
        return true;
      },
      dayCellDidMount(info) {
        const k = info.date.toISOString().slice(0, 10);
        if (leaveByDay.has(k)) info.el.setAttribute('data-has-leave', 'true');
      },
      datesSet: ({ view }) => {
        const t = document.getElementById('calTitle');
        if (t) t.textContent = view.title;
      }
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
  } catch (e) {
    console.error(e);
    const box = document.getElementById('app-messages');
    if (box) {
      box.style.display = 'block';
      box.textContent = 'Nie udało się połączyć z Firebase. Sprawdź zmienne VITE_FB_* w Vercel oraz reguły Firestore.';
    }
  }
}
