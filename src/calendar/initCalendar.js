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

const normalizeLeaveKind = (value) => {
  const raw = (value ?? '').toString().trim().toLowerCase();
  if (!raw) return null;
  if (raw.startsWith('leave_')) return normalizeLeaveKind(raw.replace('leave_', ''));
  if (raw === 'l4') return 'l4';
  if (raw === 'swieto' || raw === 'święto' || raw === 'holiday') return 'wolne';
  if (raw === 'wolne' || raw === 'free' || raw === 'leave_free') return 'wolne';
  if (raw === 'urlop' || raw === 'url' || raw === 'leave_url' || raw === 'leave') return 'urlop';
  return null;
};

const getLeaveFlagForDate = (calendar, date) => {
  const key = normalizeDateKey(date);
  if (!key || !calendar) return null;
  const flags = calendar.getOption('customFlags') || [];
  const match = (flags || []).find((flag) => normalizeDateKey(flag?.date || flag?.start) === key);
  const type = normalizeLeaveKind(match?.type || match?.kind || match?.leaveKind);
  return type ? { type } : null;
};

export function renderDaySummaries(calendar) {
  if (!calendar?.el) return;
  calendar.el.querySelectorAll('.day-summary').forEach((n) => n.remove());
  const toNum = (value) => (value == null ? 0 : Number(value) || 0);
  const events = calendar.getEvents().filter((e) => !['l4', 'urlop', 'wolne'].includes(normalizeLeaveKind(e.extendedProps?.kind)));
  const by = new Map();
  events.forEach((e) => {
    const key = (e.startStr || '').slice(0, 10);
    if (!key) return;
    const x = e.extendedProps || {};
    const acc = by.get(key) || { w: 0, d: 0, b: 0 };
    acc.w += toNum(x.workH ?? x.workHours);
    acc.d += toNum(x.driveH ?? x.driveHours);
    acc.b += toNum(x.billH ?? x.billedHours);
    by.set(key, acc);
  });
  by.forEach((v, key) => {
    const cell = calendar.el.querySelector(`[data-date="${key}"] .fc-daygrid-day-frame`);
    if (!cell) return;
    const el = document.createElement('div');
    el.className = 'day-summary';
    el.textContent = `• Praca: ${v.w.toFixed(1)}h • Jazda: ${v.d.toFixed(1)}h • Fakturowane: ${v.b.toFixed(1)}h`;
    cell.appendChild(el);
  });
}

function applyFlagToCell(calendar, el, date) {
  if (!el || !calendar) return;
  const existing = el.querySelector('.day-flag');
  if (existing) existing.remove();
  const flag = getLeaveFlagForDate(calendar, date);
  if (!flag) return;
  el.style.position = 'relative';
  const wrap = document.createElement('div');
  wrap.className = `day-flag day-flag--${flag.type}`;
  wrap.innerHTML = `<div class="pill">${flag.type === 'urlop' ? '🏁' : flag.type === 'l4' ? '➕' : '🌿'}</div>`;
  el.appendChild(wrap);
}

function refreshDayFlags(calendar) {
  if (!calendar?.el) return;
  const cells = calendar.el.querySelectorAll('.fc-daygrid-day-frame');
  cells.forEach((cell) => {
    const parent = cell.closest('[data-date]');
    const date = parent?.getAttribute('data-date') || '';
    applyFlagToCell(calendar, cell, date);
  });
}

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
    showNonCurrentDates: true,
    dayMaxEventRows: 3,
    moreLinkClick: 'popover',
    eventOverlap: false,
    slotEventOverlap: false,
    eventDisplay: 'block',
    eventOrder: 'start,-duration,title',
    dayCellDidMount: (info) => {
      const frame = info.el.querySelector('.fc-daygrid-day-frame') || info.el;
      applyFlagToCell(window.__fcCalendar, frame, info.date);
      if (typeof extraDayCellDidMount === 'function') extraDayCellDidMount(info);
    },
    events: async (info, success) => {
      try {
        const raw = await loadEventsFromDb(info.start, info.end);
        const mapped = (raw || []).map((e) => {
          const rawClassNames = [
            ...(Array.isArray(e.classNames) ? e.classNames : []),
            ...(Array.isArray(e.className) ? e.className : (typeof e.className === 'string' ? e.className.split(/\s+/) : [])),
          ].filter(Boolean);
          const kind = normalizeLeaveKind(e?.extendedProps?.kind || e?.kind || e?.type || e?.leaveKind || e?.extendedProps?.leaveKind);
          const isLeaveBg = rawClassNames.includes('leave-bg');
          const isLeaveBadge = rawClassNames.includes('leave-badge');
          if (kind || isLeaveBg || isLeaveBadge) {
            const start = e.start || e.date;
            const end = e.end || start;
            const classNames = rawClassNames.length ? rawClassNames : ['ev-leave', `ev-leave--${kind || 'urlop'}`];
            return {
              ...e,
              start,
              end,
              allDay: e.allDay ?? true,
              display: e.display || (isLeaveBg ? 'background' : e.display),
              classNames,
              extendedProps: { ...(e.extendedProps || {}), kind: kind || e?.extendedProps?.kind || e?.kind || e?.type },
            };
          }
          const extendedProps = { ...(e.extendedProps || {}) };
          if (!extendedProps.kind && e.kind) extendedProps.kind = e.kind;
          const classNames = rawClassNames.length ? rawClassNames : undefined;
          return {
            ...e,
            title: e.title || e.extendedProps?.client || '',
            classNames,
            extendedProps,
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
        const flag = getLeaveFlagForDate(window.__fcCalendar, selection?.start);
        const extraAllowed = typeof extraSelectAllow === 'function' ? extraSelectAllow(selection) : true;
        return !flag && extraAllowed;
      } catch (e) {
        console.error('selectAllow error:', e);
        return true;
      }
    },
    eventContent: (info) => {
      const classNames = info.event.classNames || [];
      if (!classNames.includes('strip-summary')) return typeof extraEventContent === 'function' ? extraEventContent(info) : undefined;
      const p = info.event.extendedProps || {};
      const work = Number(p.workHours ?? p.praca ?? 0) || 0;
      const drive = Number(p.driveHours ?? p.jazda ?? 0) || 0;
      const billed = Number(p.billedHours ?? p.fakturowane ?? 0) || 0;
      const over = Number(p.nadgodziny ?? 0) || 0;
      const parts = [];
      if (work > 0) parts.push(`Praca: ${work.toFixed(1)}h`);
      if (drive > 0) parts.push(`Jazda: ${drive.toFixed(1)}h`);
      if (over > 0) parts.push(`Nadg.: ${over.toFixed(1)}h`);
      if (billed > 0) parts.push(`Fakt.: ${billed.toFixed(1)}h`);
      const html = parts.join(' • ');
      if (typeof extraEventContent === 'function') {
        const extra = extraEventContent(info);
        if (extra != null) return extra;
      }
      if (!html) return { html: '' };
      return { html };
    },
    eventDidMount: (info) => {
      if ((info.event.classNames || []).includes('strip-summary')) {
        const p = info.event.extendedProps || {};
        const work = Number(p.workHours ?? p.praca ?? 0) || 0;
        const drive = Number(p.driveHours ?? p.jazda ?? 0) || 0;
        const billed = Number(p.billedHours ?? p.fakturowane ?? 0) || 0;
        const over = Number(p.nadgodziny ?? 0) || 0;
        if (work === 0 && drive === 0 && billed === 0 && over === 0) {
          info.el.style.display = 'none';
        }
      }
      if (typeof extraEventDidMount === 'function') extraEventDidMount(info);
    },
    datesSet: (...args) => {
      renderDaySummaries(window.__fcCalendar);
      refreshDayFlags(window.__fcCalendar);
      if (typeof extraDatesSet === 'function') extraDatesSet(...args);
    },
    eventsSet: (...args) => {
      renderDaySummaries(window.__fcCalendar);
      refreshDayFlags(window.__fcCalendar);
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

  renderDaySummaries(calendar);
  refreshDayFlags(calendar);

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
    calendar.setOption('customFlags', flags || []);
    calendar.refetchEvents();
    renderDaySummaries(calendar);
    refreshDayFlags(calendar);
  }
  return calendar;
}

export function updateCalendarData(calendar, events = [], flags = []) {
  if (!calendar) return;
  setCalendarEvents(events);
  setDayFlags(flags);
  calendar.setOption('customFlags', flags || []);
  calendar.refetchEvents();
  renderDaySummaries(calendar);
  refreshDayFlags(calendar);
}
