import { Calendar, dayGridPlugin, interactionPlugin } from '../fullcalendar-shims/core.js';
import { loadEventsFromDb, setCalendarEvents, setDayFlags } from '../data/dailyTotals.js';

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SUMMARY_DISPLAY_STORAGE_KEY = 'summaryDisplayMode';
const SUMMARY_DISPLAY_MODES = new Set(['short', 'full']);
const SUMMARY_DISPLAY_DESKTOP_BREAKPOINT = 1440;
const SUMMARY_DISPLAY_LAPTOP_BREAKPOINT = 1024;
const SUMMARY_DISPLAY_TABLET_BREAKPOINT = 768;
const SUMMARY_DISPLAY_DEFAULT = 'short';
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

const getViewportWidth = () => {
  if (typeof window === 'undefined') return SUMMARY_DISPLAY_DESKTOP_BREAKPOINT;
  return window.innerWidth || SUMMARY_DISPLAY_DESKTOP_BREAKPOINT;
};

const getCalendarViewKey = (calendarEl) => {
  const shell = calendarEl?.closest?.('#calendar-shell');
  if (shell?.classList?.contains('view-day')) return 'day';
  if (shell?.classList?.contains('view-week')) return 'week';
  if (shell?.classList?.contains('view-month')) return 'month';
  return null;
};

const shouldForceShortSummary = (calendarEl) => {
  const width = getViewportWidth();
  if (width < SUMMARY_DISPLAY_TABLET_BREAKPOINT) return true;
  if (width >= SUMMARY_DISPLAY_TABLET_BREAKPOINT && width < SUMMARY_DISPLAY_LAPTOP_BREAKPOINT) {
    const viewKey = getCalendarViewKey(calendarEl);
    return viewKey !== 'day';
  }
  return false;
};

const resolveSummaryDisplayMode = (calendarEl) => {
  let resolved = summaryDisplayMode;
  if (shouldForceShortSummary(calendarEl)) {
    resolved = 'short';
  }
  return resolved;
};

const applySummaryDisplayAttributes = (calendarEl) => {
  const effective = resolveSummaryDisplayMode(calendarEl);
  summaryDisplayEffective = effective;
  const target = calendarEl?.closest?.('#calendar-shell') || calendarEl;
  if (target) {
    target.dataset.summaryDisplay = effective;
    target.dataset.summaryDisplayPref = summaryDisplayMode;
  }
  return effective;
};

const getEffectiveSummaryDisplayMode = (calendarEl) => summaryDisplayEffective || resolveSummaryDisplayMode(calendarEl);

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

const updateSummaryDisplayControlState = (calendarEl, selectEl) => {
  if (!selectEl) return;
  const width = getViewportWidth();
  const viewKey = getCalendarViewKey(calendarEl);
  const forceShort = width >= SUMMARY_DISPLAY_TABLET_BREAKPOINT
    && width < SUMMARY_DISPLAY_LAPTOP_BREAKPOINT
    && viewKey !== 'day';
  const fullOption = selectEl.querySelector('option[value="full"]');
  if (fullOption) {
    fullOption.disabled = forceShort;
    fullOption.hidden = forceShort;
  }
  if (forceShort && selectEl.value === 'full') {
    selectEl.value = 'short';
  }
  selectEl.disabled = width < SUMMARY_DISPLAY_TABLET_BREAKPOINT;
};

const notifySummaryDisplayChange = (calendarEl) => {
  if (typeof window === 'undefined') return;
  const detail = {
    mode: summaryDisplayMode,
    effective: summaryDisplayEffective,
    viewKey: getCalendarViewKey(calendarEl),
  };
  window.dispatchEvent(new CustomEvent('calendar:summary-display-change', { detail }));
};

const ensureSummaryDisplayControl = (calendarEl) => {
  if (!calendarEl) return;
  const toolbar = calendarEl.querySelector('.fc-header-toolbar') || calendarEl.querySelector('.fc-toolbar');
  const fallbackToolbar = calendarEl?.ownerDocument?.getElementById?.('calendar-toolbar');
  const wrapperRoot = toolbar || fallbackToolbar;
  if (!wrapperRoot) return;
  let wrapper = wrapperRoot.querySelector('.summary-display-control');
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.className = 'summary-display-control';
    const label = document.createElement('label');
    label.className = 'summary-display-label';
    label.textContent = 'Podsumowanie';
    const select = document.createElement('select');
    select.className = 'summary-display-select';
    select.setAttribute('aria-label', 'Widok podsumowań');
    select.innerHTML = `
      <option value="short">Skrót</option>
      <option value="full">Pełne</option>
    `;
    label.setAttribute('for', 'calendar-summary-display');
    select.id = 'calendar-summary-display';
    wrapper.appendChild(label);
    wrapper.appendChild(select);
    wrapperRoot.appendChild(wrapper);
  }
  const selectEl = wrapper.querySelector('.summary-display-select');
  if (!selectEl) return;
  selectEl.value = SUMMARY_DISPLAY_MODES.has(summaryDisplayMode) ? summaryDisplayMode : SUMMARY_DISPLAY_DEFAULT;
  updateSummaryDisplayControlState(calendarEl, selectEl);
  if (!selectEl.dataset.bound) {
    selectEl.dataset.bound = 'true';
    selectEl.addEventListener('change', (event) => {
      const next = event.target?.value;
      setSummaryDisplayMode(next);
      applySummaryDisplayAttributes(calendarEl);
      refreshCalendarSummaries(calendarEl);
      ensureSummaryDisplayControl(calendarEl);
      notifySummaryDisplayChange(calendarEl);
    });
  }
};

const handleSummaryDisplayResize = () => {
  if (!summaryDisplayCalendarEl) return;
  const next = resolveSummaryDisplayMode(summaryDisplayCalendarEl);
  if (next === summaryDisplayEffective) return;
  applySummaryDisplayAttributes(summaryDisplayCalendarEl);
  refreshCalendarSummaries(summaryDisplayCalendarEl);
  ensureSummaryDisplayControl(summaryDisplayCalendarEl);
  notifySummaryDisplayChange(summaryDisplayCalendarEl);
};

summaryDisplayMode = getStoredSummaryDisplayMode();

const isLeaveDay = (date) => {
  const key = normalizeDateKey(date);
  if (!key) return false;
  return Boolean(window.__calendarDecorations?.leaveByDay?.[key]);
};

const formatSummaryValue = (value, { compact = false } = {}) => {
  const num = Number(value || 0) || 0;
  const rounded = Math.round(num * 10) / 10;
  if (!compact) return rounded.toFixed(1);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

const DAY_STATUS_LABELS = {
  L4: 'L4',
  SWIETO: 'Święto',
  URL: 'Urlop',
  SZKOLENIE: 'Szkolenie',
  WOLNE: 'Wolne',
};

const createEl = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (typeof text === 'string') el.textContent = text;
  return el;
};

const ensureClientListModal = () => {
  const existing = document.getElementById('calendar-client-list-modal');
  if (existing) return existing;
  const modal = createEl('div', 'calendar-client-list-modal');
  modal.id = 'calendar-client-list-modal';
  modal.innerHTML = `
    <div class="calendar-client-list-modal__dialog" role="dialog" aria-modal="true" aria-label="Lista zleceń dnia">
      <div class="calendar-client-list-modal__header">
        <h4>Zlecenia dnia</h4>
        <button type="button" class="btn-ghost btn-small" data-close-client-list>Zamknij</button>
      </div>
      <div class="calendar-client-list-modal__body"></div>
    </div>
  `;
  modal.addEventListener('click', (event) => {
    if (event.target === modal || event.target?.closest?.('[data-close-client-list]')) {
      modal.classList.remove('is-open');
    }
  });
  document.body.appendChild(modal);
  return modal;
};

const openClientListModal = (dayKey, clients = []) => {
  const modal = ensureClientListModal();
  const body = modal.querySelector('.calendar-client-list-modal__body');
  const title = modal.querySelector('h4');
  if (title) {
    title.textContent = dayKey ? `Zlecenia dnia ${dayKey}` : 'Zlecenia dnia';
  }
  if (body) {
    body.innerHTML = (clients || []).length
      ? `<ul>${clients.map((client) => `<li title="${client}">${client}</li>`).join('')}</ul>`
      : '<p>Brak zleceń dla tego dnia.</p>';
  }
  modal.classList.add('is-open');
};

const renderDayCellDecorations = (cellEl, dayKey, decorations, extraDayCellDidMount, arg) => {
  if (!cellEl) return;
  cellEl.querySelectorAll('.day-summary, .cell-leave-icon, .cell-planned-leave, .month-day-content').forEach((node) => node.remove());
  if (!decorations || !dayKey) {
    if (typeof extraDayCellDidMount === 'function' && arg) extraDayCellDidMount(arg);
    return;
  }

  const leave = decorations.leaveByDay?.[dayKey];
  const planned = decorations.plannedLeaveByDay?.[dayKey];
  const shell = cellEl.closest?.('#calendar-shell');
  const isMonthView = shell?.classList?.contains('view-month');

  const frame = cellEl.querySelector('.fc-daygrid-day-frame') || cellEl;

  if (isMonthView) {
    const monthWrap = createEl('div', 'month-day-content');
    const body = createEl('div', 'month-day-content__body');
    const statusChip = createEl('span', `leave-chip month-day-content__status${leave ? '' : ' is-empty'}`,
      leave ? (DAY_STATUS_LABELS[leave] || leave) : '');
    body.appendChild(statusChip);

    const clients = Array.isArray(decorations.clientsByDay?.[dayKey]) ? decorations.clientsByDay[dayKey] : [];
    const clientsRow = createEl('div', 'month-day-content__clients');
    const visibleClients = clients.slice(0, 2);
    visibleClients.forEach((clientName) => {
      const chip = createEl('span', 'month-client-chip', clientName);
      chip.title = clientName;
      clientsRow.appendChild(chip);
    });
    if (clients.length > 2) {
      const moreBtn = createEl('button', 'month-client-chip month-client-chip--more', `+${clients.length - 2}`);
      moreBtn.type = 'button';
      moreBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openClientListModal(dayKey, clients);
      });
      clientsRow.appendChild(moreBtn);
    }
    body.appendChild(clientsRow);

    if (planned && !leave) {
      const marker = document.createElement('div');
      marker.className = 'cell-planned-leave';
      marker.title = 'Zaplanowany urlop';
      body.appendChild(marker);
    }

    monthWrap.appendChild(body);
    frame.appendChild(monthWrap);
  } else if (leave) {
    const big = document.createElement('div');
    big.className = `cell-leave-icon cell-leave-icon--${leave}`;
    const chip = document.createElement('span');
    chip.className = 'leave-chip';
    chip.textContent = DAY_STATUS_LABELS[leave] || leave;
    big.appendChild(chip);
    cellEl.appendChild(big);
    if (typeof extraDayCellDidMount === 'function' && arg) extraDayCellDidMount(arg);
    return;
  }

  if (planned && !isMonthView) {
    const marker = document.createElement('div');
    marker.className = 'cell-planned-leave';
    marker.title = 'Zaplanowany urlop';
    cellEl.appendChild(marker);
  }

  const summary = decorations.summaryByDay?.[dayKey];
  if (summary) {
    const footer = document.createElement('div');
    const displayMode = getEffectiveSummaryDisplayMode(cellEl);
    footer.className = `day-summary day-summary--${displayMode}${isMonthView ? ' day-summary--month' : ''}`;
    const row1 = document.createElement('div');
    row1.className = 'day-summary-row';
    const row2 = document.createElement('div');
    row2.className = 'day-summary-row';
    if (displayMode === 'short') {
      row1.textContent = `P: ${formatSummaryValue(summary.praca)} • J: ${formatSummaryValue(summary.jazda)}`;
      row2.textContent = `F: ${formatSummaryValue(summary.fakturowane)} • N: ${formatSummaryValue(summary.nadgodziny)}`;
      footer.appendChild(row1);
      footer.appendChild(row2);
    } else {
      row1.textContent = `Praca: ${formatSummaryValue(summary.praca)} • Jazda: ${formatSummaryValue(summary.jazda)}`;
      row2.textContent = `Fakturowane: ${formatSummaryValue(summary.fakturowane)} • Nadgodziny: ${formatSummaryValue(summary.nadgodziny)}`;
      footer.appendChild(row1);
      footer.appendChild(row2);
    }
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

const isElement = (value) => Boolean(value && typeof value === 'object' && value.nodeType === 1);

export const waitForElement = (selector, timeout = 2000, root = document) => new Promise((resolve) => {
  if (!selector || !root?.querySelector) {
    resolve(null);
    return;
  }
  const existing = root.querySelector(selector);
  if (existing) {
    resolve(existing);
    return;
  }
  let timeoutId = null;
  const observer = new MutationObserver(() => {
    const found = root.querySelector(selector);
    if (found) {
      if (timeoutId) window.clearTimeout(timeoutId);
      observer.disconnect();
      resolve(found);
    }
  });
  try {
    observer.observe(root.body || root.documentElement || root, { childList: true, subtree: true });
  } catch (_) {
    observer.disconnect();
    resolve(null);
    return;
  }
  timeoutId = window.setTimeout(() => {
    observer.disconnect();
    resolve(null);
  }, timeout);
});

export function inicjalizujKalendarz(extraOptions = {}, hostEl = null) {
  const el = hostEl;

  if (!el) throw new Error('Nie znaleziono kontenera kalendarza (#kalendarz / #calendar).');

  if (!Calendar) {
    console.error('[calendar] FullCalendar not available.');
    return null;
  }

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

  const plugins = (extraOptions?.plugins?.length
    ? extraOptions.plugins
    : [dayGridPlugin, interactionPlugin]
  ).filter(Boolean);
  const defaultView = 'dayGridMonth';

  const baseOptions = {
    plugins,
    initialView: defaultView,
    headerToolbar: false,
    locale: 'pl',
    buttonText: {
      today: 'Dziś',
      month: 'Miesiąc',
      week: 'Tydzień',
      day: 'Dzień'
    },
    titleFormat: { year: 'numeric', month: 'long' },
    navLinks: true,
    expandRows: true,
    height: 'auto',
    contentHeight: 'auto',
    handleWindowResize: true,
    fixedWeekCount: true,
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
      if (info?.event?.title) {
        info.el.title = info.event.title;
      }
      if (typeof extraEventDidMount === 'function') extraEventDidMount(info);
    },
    datesSet: (...args) => {
      if (typeof extraDatesSet === 'function') extraDatesSet(...args);
      try { window.__fcCalendar?.rerenderDates?.(); } catch (_) {}
      try { applyDecorationsFromPlaceholders(); } catch (_) {}
      try { applySummaryDisplayAttributes(window.__fcCalendar?.el); } catch (_) {}
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

export async function initCalendar(hostEl, events = [], flags = [], extraOptions = {}) {
  setCalendarEvents(events);
  setDayFlags(flags);
  const timeout = Number(extraOptions?.waitForElementTimeoutMs ?? 2500) || 2500;
  const resolvedEl = isElement(hostEl)
    ? hostEl
    : (typeof hostEl === 'string' ? await waitForElement(hostEl, timeout) : null);
  if (!resolvedEl) {
    return {
      ok: false,
      message: 'Nie znaleziono kontenera kalendarza.',
      calendar: null,
    };
  }
  let calendar = null;
  try {
    calendar = bootCalendar(extraOptions, resolvedEl);
  } catch (error) {
    return {
      ok: false,
      message: 'Nie udało się zainicjalizować kalendarza.',
      error,
      calendar: null,
    };
  }
  if (calendar) {
    calendar.refetchEvents();
    try { calendar.rerenderDates?.(); } catch (_) {}
    window.__calendarApi = calendar;
    return { ok: true, calendar };
  }
  return {
    ok: false,
    message: 'Nie udało się zainicjalizować kalendarza.',
    calendar: null,
  };
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
