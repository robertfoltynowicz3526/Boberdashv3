import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import plLocale from '@fullcalendar/core/locales/pl';
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

const normalizeLeaveKindUpper = (value) => {
  const raw = (value ?? '').toString().trim().toUpperCase();
  if (!raw) return null;
  if (raw.startsWith('LEAVE_')) return normalizeLeaveKindUpper(raw.replace('LEAVE_', ''));
  if (raw === 'L4') return 'L4';
  if (raw === 'WOLNE' || raw === 'FREE' || raw === 'URLOP' || raw === 'URL') return 'WOLNE';
  if (raw === 'SWIETO' || raw === 'ŚWIĘTO' || raw === 'HOLIDAY') return 'ŚWIĘTO';
  return null;
};

const normalizeDate = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  dt.setHours(0, 0, 0, 0);
  return dt.toISOString().slice(0, 10);
};

const getLeaveFlagForDate = (calendar, date) => {
  const key = normalizeDateKey(date);
  if (!key || !calendar) return null;
  const flags = calendar.getOption('customFlags') || [];
  const match = (flags || []).find((flag) => normalizeDateKey(flag?.date || flag?.start) === key);
  const type = normalizeLeaveKind(match?.type || match?.kind || match?.leaveKind);
  return type ? { type } : null;
};

function renderDaySummaries(calendar) {
  if (!calendar?.el) return;
  calendar.el.querySelectorAll('.day-summary').forEach((n) => n.remove());
  const toNum = (value) => (value == null ? 0 : Number(value) || 0);
  const events = calendar.getEvents().filter((e) => !['l4', 'urlop', 'wolne'].includes(normalizeLeaveKind(e.extendedProps?.kind)));
  const by = new Map();
  events.forEach((e) => {
    const key = (e.startStr || '').slice(0, 10);
    if (!key) return;
    if (getLeaveFlagForDate(calendar, key)) return;
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
  el.setAttribute('data-has-leave', 'true');
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

function mapEventsToCalendar(rawEvents = []) {
  const leaveByDay = new Map();

  const addLeaveDay = (value, kind) => {
    const key = normalizeDate(value);
    if (!key) return;
    if (!leaveByDay.has(key)) {
      leaveByDay.set(key, { kind });
    }
  };

  rawEvents.forEach((e) => {
    const kind = normalizeLeaveKindUpper(e?.extendedProps?.leaveKind || e?.leaveKind || e?.kind || e?.type);
    if (!kind) return;
    const start = e.start || e.date;
    const end = e.end || start;
    const startDate = start ? new Date(start) : null;
    const endDate = end ? new Date(end) : null;
    if (!startDate || Number.isNaN(startDate.getTime())) return;
    const last = endDate && !Number.isNaN(endDate.getTime()) ? new Date(endDate) : new Date(startDate);
    startDate.setHours(0, 0, 0, 0);
    last.setHours(0, 0, 0, 0);
    const cursor = new Date(startDate);
    while (cursor <= last) {
      addLeaveDay(cursor, kind);
      cursor.setDate(cursor.getDate() + 1);
    }
  });

  const workEvents = [];

  rawEvents.forEach((e) => {
    const leaveKind = normalizeLeaveKindUpper(e?.extendedProps?.leaveKind || e?.leaveKind || e?.kind || e?.type);
    const start = e.start || e.date;
    const end = e.end || start;
    const dayKey = normalizeDate(start);

    if (leaveKind) return;
    if (leaveByDay.has(dayKey)) return;

    const rawClassNames = e.classNames || e.className || [];
    const classNames = Array.isArray(rawClassNames) ? rawClassNames : [rawClassNames];
    const isSummary = classNames.includes('strip-summary') || e?.extendedProps?.type === 'summary' || e?.extendedProps?.typ === 'summary';
    const title = e.title || e.extendedProps?.client || e.extendedProps?.title || '';

    const startDate = start ? new Date(start) : null;
    const endDate = end ? new Date(end) : null;
    const hasValidDates = startDate && endDate && !Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime());
    const durationMs = hasValidDates ? (endDate.getTime() - startDate.getTime()) : null;

    if (isSummary && (!title || durationMs === 0)) return;
    if (!title) return;

    workEvents.push({
      ...e,
      title,
      start,
      end,
      allDay: e.allDay ?? true,
      extendedProps: {
        ...(e.extendedProps || {}),
        type: e.extendedProps?.type || e.type,
        kind: e.extendedProps?.kind || e.kind,
      },
    });
  });

  const leaveEvents = [];
  leaveByDay.forEach((val, key) => {
    leaveEvents.push({
      id: `leave-${key}`,
      title: '',
      start: key,
      allDay: true,
      extendedProps: { type: 'leave', leaveKind: val.kind },
    });
  });

  return [...workEvents, ...leaveEvents];
}

export function initCalendar(elOrId, initialEvents = [], initialFlags = [], extraOptions = {}) {
  const el = typeof elOrId === 'string'
    ? document.getElementById(elOrId)
    : (elOrId || document.getElementById('calendar') || document.getElementById('kalendarz'));
  if (!el) return null;

  const plugins = (extraOptions.plugins && extraOptions.plugins.length ? extraOptions.plugins : [dayGridPlugin, interactionPlugin]).filter(Boolean);

  setCalendarEvents(initialEvents);
  setDayFlags(initialFlags);

  const calendar = new Calendar(el, {
    plugins,
    locale: plLocale,
    initialView: 'dayGridMonth',
    headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,dayGridWeek' },
    navLinks: true,
    expandRows: true,
    height: 'auto',
    contentHeight: 'auto',
    handleWindowResize: true,
    fixedWeekCount: false,
    showNonCurrentDates: true,
    dayMaxEventRows: true,
    moreLinkClick: 'popover',
    eventOverlap: false,
    slotEventOverlap: false,
    eventDisplay: 'block',
    eventOrder: 'start,-duration, title',
    customFlags: initialFlags,
    dayCellDidMount: (info) => {
      const frame = info.el.querySelector('.fc-daygrid-day-frame') || info.el;
      applyFlagToCell(calendar, frame, info.date);
      const key = normalizeDateKey(info.date);
      if (getLeaveFlagForDate(calendar, key)) {
        info.el.setAttribute('data-has-leave', 'true');
      }
    },
    events: async (info, success) => {
      try {
        const raw = await loadEventsFromDb(info.start, info.end);
        const mapped = mapEventsToCalendar(raw || []);
        success(mapped);
      } catch (e) {
        console.error('events loader error:', e);
        success([]);
      }
    },
    selectAllow: (selection) => {
      try {
        const flag = getLeaveFlagForDate(calendar, selection?.start);
        return !flag;
      } catch (e) {
        console.error('selectAllow error:', e);
        return true;
      }
    },
    eventContent(arg) {
      const { extendedProps } = arg.event;
      if (extendedProps?.type === 'leave') {
        const wrap = document.createElement('div');
        wrap.className = 'leave-icon';

        const badge = document.createElement('div');
        badge.className = 'leave-badge';

        const icon = document.createElement('span');
        icon.className = 'leave-glyph';

        if (extendedProps.leaveKind === 'L4') icon.classList.add('icon-l4');
        if (extendedProps.leaveKind === 'WOLNE') icon.classList.add('icon-wolne');
        if (extendedProps.leaveKind === 'ŚWIĘTO' || extendedProps.leaveKind === 'SWIETO') icon.classList.add('icon-swieto');

        badge.appendChild(icon);
        wrap.appendChild(badge);
        return { domNodes: [wrap] };
      }

      return true;
    },
    ...extraOptions,
  });

  calendar.render();
  renderDaySummaries(calendar);
  refreshDayFlags(calendar);
  calendar.on('datesSet', () => {
    renderDaySummaries(calendar);
    refreshDayFlags(calendar);
  });
  calendar.on('eventsSet', () => {
    renderDaySummaries(calendar);
    refreshDayFlags(calendar);
  });

  let ro = null;
  try {
    if ('ResizeObserver' in window) {
      ro = new window.ResizeObserver(() => calendar.updateSize());
      ro.observe(el);
    }
  } catch (e) {
    console.warn('ResizeObserver fallback:', e);
  }
  if (!ro) {
    window.addEventListener('resize', () => calendar.updateSize());
  }

  document.getElementById('btnPrev')?.addEventListener('click', () => calendar.prev());
  document.getElementById('btnNext')?.addEventListener('click', () => calendar.next());
  document.getElementById('btnToday')?.addEventListener('click', () => calendar.today());

  return calendar;
}

export function bootCalendar(elOrId, initialEvents = [], initialFlags = [], extraOptions = {}) {
  return initCalendar(elOrId, initialEvents, initialFlags, extraOptions);
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

export { renderDaySummaries };
