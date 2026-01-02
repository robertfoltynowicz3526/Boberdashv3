import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import { loadEventsFromDb, setCalendarEvents, setDayFlags } from '../data/dailyTotals.js';

const normalizeDateKey = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return '';
};

const isLeaveDay = (date) => {
  const key = normalizeDateKey(date);
  if (!key) return false;
  return Boolean(window.__calendarDecorations?.leaveByDay?.[key]);
};

export function inicjalizujKalendarz(extraOptions = {}, hostEl = null) {
  const el =
    hostEl ||
    document.getElementById('kalendarz') ||
    document.getElementById('calendar') ||
    document.getElementById('kalendarz-container');

  if (!el) throw new Error('Nie znaleziono kontenera kalendarza (#kalendarz / #calendar).');

  if (window.__fcCalendar) {
    try {
      window.__fcCalendar.destroy();
    } catch (_) {}
    window.__fcCalendar = null;
  }

  const {
    dayCellDidMount: extraDayCellDidMount,
    dayCellClassNames: extraDayCellClassNames,
    datesSet: extraDatesSet,
    eventsSet: extraEventsSet,
    selectAllow: extraSelectAllow,
    dateClick: extraDateClick,
    select: extraSelect,
    eventDataTransform: extraEventDataTransform,
    eventContent: extraEventContent,
    eventDidMount: extraEventDidMount,
    eventClick: extraEventClick,
    ...restExtraOptions
  } = extraOptions || {};

  const plugins = (extraOptions?.plugins?.length ? extraOptions.plugins : [dayGridPlugin, interactionPlugin]).filter(Boolean);

  const baseOptions = {
    plugins,
    initialView: 'dayGridMonth',
    headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,dayGridWeek' },
    navLinks: true,
    expandRows: true,
    height: 'auto',
    contentHeight: 'auto',
    handleWindowResize: true,
    fixedWeekCount: false,
    dayMaxEvents: true,
    showNonCurrentDates: true,
    moreLinkClick: 'popover',
    eventOverlap: false,
    slotEventOverlap: false,
    eventDisplay: 'block',
    eventOrder: 'sortOrder,title',
    dayCellClassNames: (arg) => {
      if (typeof extraDayCellClassNames === 'function') {
        const extra = extraDayCellClassNames(arg);
        return Array.isArray(extra) ? extra : [];
      }
      return [];
    },
    dayCellDidMount: (arg) => {
      const day = arg.date.toISOString().slice(0,10);
      const deco = window.__calendarDecorations || {};
      const leave = deco.leaveByDay?.[day];     // 'L4'|'SWIETO'|'URL'|undefined
      const sum = deco.summaryByDay?.[day];     // {work,drive,billed,over} albo undefined

      // wyczyść poprzednie
      arg.el.querySelectorAll('.cell-sum, .cell-leave-icon').forEach(n => n.remove());

      // 1) Dzień wolny -> TYLKO ikona, NIC więcej
      if (leave) {
        const icon =
          leave === 'L4' ? '🤒' :
          (leave === 'SWIETO' ? '🎉' :
          (leave === 'URL' ? '🏖️' : '⛔'));
        const big = document.createElement('div');
        big.className = `cell-leave-icon cell-leave-icon--${leave}`;
        big.textContent = icon;
        arg.el.appendChild(big);
        if (typeof extraDayCellDidMount === 'function') extraDayCellDidMount(arg);
        return; // <--- krytyczne: nie renderuj sumy
      }

      // 2) Normalny dzień: kafel sumy tylko jeśli summaryByDay ma wpis
      if (!sum) {
        if (typeof extraDayCellDidMount === 'function') extraDayCellDidMount(arg);
        return;
      }

      const work = Number(sum.work||0) || 0;
      const drive = Number(sum.drive||0) || 0;
      const billed = Number(sum.billed||0) || 0;
      const over = Number(sum.over||0) || 0;
      const parts = [
        `Praca: ${work.toFixed(1)}h`,
        `Jazda: ${drive.toFixed(1)}h`,
        `Fakt: ${billed.toFixed(1)}h`,
        `Nadg: ${over.toFixed(1)}h`,
      ];

      const box = document.createElement('div');
      box.className = 'cell-sum';
      box.textContent = parts.join(' • ');
      arg.el.appendChild(box);
      if (typeof extraDayCellDidMount === 'function') extraDayCellDidMount(arg);
    },
    events: async (info, success) => {
      try {
        const raw = await loadEventsFromDb(info.start, info.end);
        const mapped = (raw || []).map((e) => {
          const rawClassNames = [
            ...(Array.isArray(e.classNames) ? e.classNames : []),
            ...(Array.isArray(e.className) ? e.className : (typeof e.className === 'string' ? e.className.split(/\s+/) : [])),
          ].filter(Boolean);
          const extendedProps = { ...(e.extendedProps || {}) };
          const classNames = rawClassNames.length ? rawClassNames : ['order-event'];
          return {
            ...e,
            title: e.title || extendedProps.clientName || extendedProps.client || '',
            classNames,
            extendedProps,
            allDay: e.allDay ?? true,
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
        const isLeave = isLeaveDay(selection?.start);
        const extraAllowed = typeof extraSelectAllow === 'function' ? extraSelectAllow(selection) : true;
        return !isLeave && extraAllowed;
      } catch (e) {
        console.error('selectAllow error:', e);
        return true;
      }
    },
    eventContent: (info) => {
      if (typeof extraEventContent === 'function') return extraEventContent(info);
      return { html: `<div class="fc-title-only">${info.event.title || ''}</div>` };
    },
    eventDidMount: (info) => {
      if (typeof extraEventDidMount === 'function') extraEventDidMount(info);
    },
    datesSet: (...args) => {
      try { window.__fcCalendar?.rerenderDates?.(); } catch (_) {}
      if (typeof extraDatesSet === 'function') extraDatesSet(...args);
    },
    eventsSet: (...args) => {
      if (typeof extraEventsSet === 'function') extraEventsSet(...args);
    },
    dateClick: (info) => {
      if (typeof extraDateClick === 'function') extraDateClick(info);
    },
    select: (info) => {
      if (typeof extraSelect === 'function') extraSelect(info);
    },
    eventDataTransform: (info) => (typeof extraEventDataTransform === 'function' ? extraEventDataTransform(info) : info),
    eventClick: (info) => {
      if (typeof extraEventClick === 'function') extraEventClick(info);
    },
    ...restExtraOptions,
  };

  const resourceOptions = {
    ...baseOptions,
  };

  const fallbackOptions = {
    ...baseOptions,
    initialView: baseOptions.initialView || 'dayGridMonth',
  };

  let calendar = null;

  try {
    calendar = new Calendar(el, resourceOptions);
    window.__fcCalendar = calendar;
    calendar.render();
  } catch (e) {
    const msg = String(e?.message || e);
    console.warn('[calendar] resources unavailable -> fallback', e);

    if (msg.toLowerCase().includes('resource') || msg.toLowerCase().includes('resources')) {
      try {
        calendar = new Calendar(el, fallbackOptions);
        window.__fcCalendar = calendar;
        calendar.render();
        const noteId = 'calendar-fallback-note';
        if (!document.getElementById(noteId)) {
          const note = document.createElement('div');
          note.id = noteId;
          note.textContent = 'Kalendarz uruchomiony w trybie bez zasobów (resources).';
          note.style.cssText = 'margin:8px 0;padding:6px 10px;border-radius:10px;background:rgba(0,0,0,0.25);font-size:12px;';
          el.parentElement?.insertBefore(note, el);
        }
      } catch (e2) {
        throw e2;
      }
    } else {
      throw e;
    }
  }

  let ro = null;
  try {
    if ('ResizeObserver' in window) {
      ro = new window.ResizeObserver(() => window.__fcCalendar?.updateSize?.());
      ro.observe(el);
    }
  } catch (e) {
    console.warn('ResizeObserver fallback:', e);
  }
  if (!ro) {
    window.addEventListener('resize', () => window.__fcCalendar?.updateSize?.());
  }

  document.getElementById('btnPrev')?.addEventListener('click', () => calendar.prev());
  document.getElementById('btnNext')?.addEventListener('click', () => calendar.next());
  document.getElementById('btnToday')?.addEventListener('click', () => calendar.today());

  setTimeout(() => {
    try {
      window.__fcCalendar?.updateSize?.();
    } catch (_) {}
  }, 50);

  return calendar;
}

export function bootCalendar(extraOptions = {}, hostEl = null) {
  return inicjalizujKalendarz(extraOptions, hostEl);
}

export function initCalendar(hostEl, events = [], flags = [], extraOptions = {}) {
  setCalendarEvents(events);
  setDayFlags(flags);
  const calendar = bootCalendar(extraOptions, hostEl);
  if (calendar) {
    calendar.refetchEvents();
  }
  return calendar;
}

export function updateCalendarData(calendar, events = [], flags = []) {
  if (!calendar) return;
  setCalendarEvents(events);
  setDayFlags(flags);
  calendar.refetchEvents();
}
