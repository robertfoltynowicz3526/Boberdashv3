import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import { loadEventsFromDb, setCalendarEvents, setDayFlags } from '../data/dailyTotals.js';

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SUMMARY_DISPLAY_STORAGE_KEY = 'summaryDisplayMode';
const SUMMARY_DISPLAY_MODES = new Set(['auto', 'full', 'short']);
const SUMMARY_DISPLAY_BREAKPOINT = 1200;
const SUMMARY_DISPLAY_DEFAULT = 'auto';
let summaryDisplayMode = SUMMARY_DISPLAY_DEFAULT;
let summaryDisplayEffective = null;
let summaryDisplayCalendarEl = null;
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

const getStoredSummaryDisplayMode = () => {
  if (typeof window === 'undefined') return SUMMARY_DISPLAY_DEFAULT;
  try {
    const stored = window.localStorage?.getItem?.(SUMMARY_DISPLAY_STORAGE_KEY);
    return SUMMARY_DISPLAY_MODES.has(stored) ? stored : SUMMARY_DISPLAY_DEFAULT;
  } catch (_) {
    return SUMMARY_DISPLAY_DEFAULT;
  }
};

const resolveSummaryDisplayMode = () => {
  if (summaryDisplayMode === 'auto') {
    if (typeof window === 'undefined') return 'full';
    return window.innerWidth < SUMMARY_DISPLAY_BREAKPOINT ? 'short' : 'full';
  }
  return summaryDisplayMode;
};

const applySummaryDisplayAttributes = (calendarEl) => {
  const effective = resolveSummaryDisplayMode();
  summaryDisplayEffective = effective;
  const target = calendarEl?.closest?.('#calendar-shell') || calendarEl;
  if (target) {
    target.dataset.summaryDisplay = effective;
    target.dataset.summaryDisplayPref = summaryDisplayMode;
  }
  return effective;
};

const getEffectiveSummaryDisplayMode = () => summaryDisplayEffective || resolveSummaryDisplayMode();

const setSummaryDisplayMode = (mode) => {
  summaryDisplayMode = SUMMARY_DISPLAY_MODES.has(mode) ? mode : SUMMARY_DISPLAY_DEFAULT;
  try {
    window.localStorage?.setItem?.(SUMMARY_DISPLAY_STORAGE_KEY, summaryDisplayMode);
  } catch (_) {}
};

const refreshCalendarSummaries = (calendarEl) => {
  try { window.__fcCalendar?.rerenderDates?.(); } catch (_) {}
  try { applyDecorationsFromPlaceholders(calendarEl?.ownerDocument || document); } catch (_) {}
};

const ensureSummaryDisplayControl = (calendarEl) => {
  if (!calendarEl) return;
  const toolbar = calendarEl.querySelector('.fc-header-toolbar') || calendarEl.querySelector('.fc-toolbar');
  if (!toolbar) return;
  const rightChunk = toolbar.querySelector('.fc-toolbar-chunk:last-child') || toolbar;
  let wrapper = toolbar.querySelector('.summary-display-control');
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.className = 'summary-display-control';
    const select = document.createElement('select');
    select.className = 'summary-display-select';
    select.setAttribute('aria-label', 'Tryb podsumowania dnia');
    select.title = 'Tryb podsumowania dnia';
    select.innerHTML = `
      <option value="auto">Auto</option>
      <option value="full">Pełne</option>
      <option value="short">Skróty</option>
    `;
    select.value = summaryDisplayMode;
    select.addEventListener('change', () => {
      setSummaryDisplayMode(select.value);
      applySummaryDisplayAttributes(calendarEl);
      refreshCalendarSummaries(calendarEl);
    });
    wrapper.appendChild(select);
    rightChunk.appendChild(wrapper);
  } else {
    const select = wrapper.querySelector('select');
    if (select && select.value !== summaryDisplayMode) {
      select.value = summaryDisplayMode;
    }
  }
};

const handleSummaryDisplayResize = () => {
  if (!summaryDisplayCalendarEl || summaryDisplayMode !== 'auto') return;
  const next = resolveSummaryDisplayMode();
  if (next === summaryDisplayEffective) return;
  applySummaryDisplayAttributes(summaryDisplayCalendarEl);
  refreshCalendarSummaries(summaryDisplayCalendarEl);
};

summaryDisplayMode = getStoredSummaryDisplayMode();

const isLeaveDay = (date) => {
  const key = normalizeDateKey(date);
  if (!key) return false;
  return Boolean(window.__calendarDecorations?.leaveByDay?.[key]);
};

const formatSummaryValue = (value) => {
  const num = Number(value || 0) || 0;
  return num.toFixed(1);
};

const renderDayCellDecorations = (cellEl, dayKey, decorations, extraDayCellDidMount, arg) => {
  if (!cellEl) return;
  cellEl.querySelectorAll('.day-summary, .cell-leave-icon, .cell-planned-leave').forEach((node) => node.remove());
  if (!decorations || !dayKey) {
    if (typeof extraDayCellDidMount === 'function' && arg) extraDayCellDidMount(arg);
    return;
  }

  const leave = decorations.leaveByDay?.[dayKey];
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

  const summary = decorations.summaryByDay?.[dayKey];
  if (summary) {
    const frame = cellEl.querySelector('.fc-daygrid-day-frame') || cellEl;
    const footer = document.createElement('div');
    const displayMode = getEffectiveSummaryDisplayMode();
    footer.className = `day-summary day-summary--${displayMode}`;
    const row1 = document.createElement('div');
    row1.className = 'day-summary-row';
    const row2 = document.createElement('div');
    row2.className = 'day-summary-row';
    if (displayMode === 'short') {
      row1.textContent = `P: ${formatSummaryValue(summary.praca)} • J: ${formatSummaryValue(summary.jazda)}`;
      row2.textContent = `F: ${formatSummaryValue(summary.fakturowane)} • N: ${formatSummaryValue(summary.nadgodziny)}`;
    } else {
      row1.textContent = `Praca: ${formatSummaryValue(summary.praca)} • Jazda: ${formatSummaryValue(summary.jazda)}`;
      row2.textContent = `Fakturowane: ${formatSummaryValue(summary.fakturowane)} • Nadgodziny: ${formatSummaryValue(summary.nadgodziny)}`;
    }
    footer.appendChild(row1);
    footer.appendChild(row2);
    frame.appendChild(footer);
  }

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
    dayMaxEventRows: 3,
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
          if (!extendedProps.type) {
            if (classNames.includes('bober-chip--summary') || classNames.includes('summary-event') || classNames.includes('fc-summary-chip')) {
              extendedProps.type = 'summary';
            } else if (classNames.includes('bober-chip--client') || classNames.includes('fc-client-chip') || classNames.includes('order-event')) {
              extendedProps.type = 'client';
            }
          }
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
      const eventType = info?.event?.extendedProps?.type;
      const isClientChip =
        eventType === 'client' ||
        info?.event?.classNames?.includes?.('client-chip') ||
        info?.event?.classNames?.includes?.('fc-client-chip');
      const title = info.event.title || '';
      if (isClientChip) {
        return { html: `<div class="fc-title-only client-chip-title">${title}</div>` };
      }
      return { html: `<div class="fc-title-only">${title}</div>` };
    },
    eventDidMount: (info) => {
      const eventType = info?.event?.extendedProps?.type;
      const isClientChip =
        eventType === 'client' ||
        info?.el?.classList?.contains?.('bober-chip--client') ||
        info?.el?.classList?.contains?.('fc-client-chip') ||
        info?.el?.classList?.contains?.('client-chip');
      if (isClientChip && info?.event?.title) {
        info.el.title = info.event.title;
      }
      if (typeof extraEventDidMount === 'function') extraEventDidMount(info);
    },
    datesSet: (...args) => {
      if (typeof extraDatesSet === 'function') extraDatesSet(...args);
      try { window.__fcCalendar?.rerenderDates?.(); } catch (_) {}
      try { applyDecorationsFromPlaceholders(); } catch (_) {}
      try { ensureSummaryDisplayControl(window.__fcCalendar?.el); } catch (_) {}
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
    summaryDisplayCalendarEl = calendar.el;
    applySummaryDisplayAttributes(calendar.el);
    ensureSummaryDisplayControl(calendar.el);
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
        summaryDisplayCalendarEl = calendar.el;
        applySummaryDisplayAttributes(calendar.el);
        ensureSummaryDisplayControl(calendar.el);
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
  if (typeof window !== 'undefined' && !window.__summaryDisplayResizeBound) {
    window.__summaryDisplayResizeBound = true;
    window.addEventListener('resize', handleSummaryDisplayResize);
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
