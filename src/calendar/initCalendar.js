import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import { loadEventsFromDb, setCalendarEvents, setDayFlags } from '../data/dailyTotals.js';

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const normalizeDateKey = (value, context = '') => {
  if (!value) return '';
  let key = '';
  if (typeof value === 'string') key = value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    key = `${yyyy}-${mm}-${dd}`;
  }
  if (!key || !DATE_KEY_RE.test(key)) {
    console.error('[calendar] invalid day key', { context, value, key });
    return '';
  }
  return key;
};

const isLeaveDay = (date) => {
  const key = normalizeDateKey(date);
  if (!key) return false;
  return Boolean(window.__calendarDecorations?.leaveByDay?.[key]);
};

const renderDayCellDecorations = (cellEl, dayKey, decorations, extraDayCellDidMount, arg) => {
  if (!cellEl) return;
  cellEl.querySelectorAll('.cell-sum, .cell-leave-icon, .cell-planned-leave').forEach((node) => node.remove());
  if (!decorations || !dayKey) {
    if (typeof extraDayCellDidMount === 'function' && arg) extraDayCellDidMount(arg);
    return;
  }

  const leave = decorations.leaveByDay?.[dayKey];
  const sum = decorations.summaryByDay?.[dayKey];
  const planned = decorations.plannedLeaveByDay?.[dayKey];

  if (leave) {
    const label =
      leave === 'L4' ? 'L4' :
      (leave === 'SWIETO' ? 'Święto' :
      (leave === 'URL' ? 'Urlop' : 'Wolne'));
    const big = document.createElement('div');
    big.className = `cell-leave-icon cell-leave-icon--${leave}`;
    const chip = document.createElement('span');
    chip.className = 'leave-chip';
    chip.textContent = label;
    big.appendChild(chip);
    cellEl.appendChild(big);
    if (typeof extraDayCellDidMount === 'function' && arg) extraDayCellDidMount(arg);
    return;
  }

  if (planned) {
    const marker = document.createElement('div');
    marker.className = 'cell-planned-leave';
    marker.title = 'Zaplanowany urlop';
    cellEl.appendChild(marker);
  }

  if (!sum) {
    if (typeof extraDayCellDidMount === 'function' && arg) extraDayCellDidMount(arg);
    return;
  }

  const work = Number(sum.work || 0) || 0;
  const drive = Number(sum.drive || 0) || 0;
  const billed = Number(sum.billed || 0) || 0;
  const over = Number(sum.over || 0) || 0;
  const parts = [
    `Praca: ${work.toFixed(1)}h`,
    `Jazda: ${drive.toFixed(1)}h`,
    `Fakturowane: ${billed.toFixed(1)}h`,
    `Nadgodziny: ${over.toFixed(1)}h`,
  ];

  const box = document.createElement('div');
  box.className = 'cell-sum bober-chip bober-chip--summary';
  box.textContent = parts.join(' • ');
  box.title = box.textContent;
  const target = cellEl.querySelector('.fc-daygrid-day-frame') || cellEl;
  target.appendChild(box);
  if (typeof extraDayCellDidMount === 'function' && arg) extraDayCellDidMount(arg);
};

const applyDecorationsFromPlaceholders = (root = document) => {
  const decorations = window.__calendarDecorations || null;
  if (!decorations) return;
  const placeholders = root.querySelectorAll('.cell-sum-placeholder[data-day]');
  placeholders.forEach((placeholder) => {
    const dayKey = normalizeDateKey(placeholder.dataset.day, 'cell-sum-placeholder');
    if (!dayKey) return;
    const cellEl =
      placeholder.closest('.fc-daygrid-day') ||
      placeholder.closest('[data-date]') ||
      placeholder.parentElement;
    if (!cellEl) return;
    renderDayCellDecorations(cellEl, dayKey, decorations);
  });
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
    locale: 'pl',
    buttonText: {
      today: 'Dziś',
      month: 'Miesiąc',
      week: 'Tydzień',
    },
    titleFormat: { year: 'numeric', month: 'long' },
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
      arg.el.dataset.daycellMounted = '1';
      const day = normalizeDateKey(arg.date, 'dayCellDidMount');
      const decorations = window.__calendarDecorations || null;
      renderDayCellDecorations(arg.el, day, decorations, extraDayCellDidMount, arg);
    },
    dayCellContent: (arg) => {
      const day = normalizeDateKey(arg.date, 'dayCellContent');
      const dayNumber = arg.dayNumberText || '';
      const placeholder = day ? `<div class="cell-sum-placeholder" data-day="${day}"></div>` : '';
      return { html: `<div class="fc-daygrid-day-number">${dayNumber}</div>${placeholder}` };
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
      const eventType = info?.event?.extendedProps?.type;
      const isClientChip =
        eventType === 'client' ||
        info?.el?.classList?.contains?.('bober-chip--client') ||
        info?.el?.classList?.contains?.('fc-client-chip');
      if (isClientChip && info?.event?.title) {
        info.el.title = info.event.title;
      }
      if (typeof extraEventDidMount === 'function') extraEventDidMount(info);
    },
    datesSet: (...args) => {
      if (typeof extraDatesSet === 'function') extraDatesSet(...args);
      try { window.__fcCalendar?.rerenderDates?.(); } catch (_) {}
      try { applyDecorationsFromPlaceholders(); } catch (_) {}
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
    window.__applyCalendarDecorations = applyDecorationsFromPlaceholders;
    try { applyDecorationsFromPlaceholders(); } catch (_) {}
  } catch (e) {
    const msg = String(e?.message || e);
    console.warn('[calendar] resources unavailable -> fallback', e);

    if (msg.toLowerCase().includes('resource') || msg.toLowerCase().includes('resources')) {
      try {
        calendar = new Calendar(el, fallbackOptions);
        window.__fcCalendar = calendar;
        calendar.render();
        window.__applyCalendarDecorations = applyDecorationsFromPlaceholders;
        try { applyDecorationsFromPlaceholders(); } catch (_) {}
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
    try { calendar.rerenderDates?.(); } catch (_) {}
  }
  return calendar;
}

export function updateCalendarData(calendar, events = [], flags = []) {
  if (!calendar) return;
  setCalendarEvents(events);
  setDayFlags(flags);
  try { calendar.removeAllEvents?.(); } catch (_) {}
  try { calendar.removeAllEventSources?.(); } catch (_) {}
  try {
    if (typeof calendar.addEventSource === 'function') {
      calendar.addEventSource(Array.isArray(events) ? events : []);
    } else if (typeof calendar.setOption === 'function') {
      calendar.setOption('events', Array.isArray(events) ? events : []);
    }
  } catch (e) {
    console.warn('[calendar] failed to add event source', e);
  }
  calendar.refetchEvents();
  try { calendar.rerenderDates?.(); } catch (_) {}
}
