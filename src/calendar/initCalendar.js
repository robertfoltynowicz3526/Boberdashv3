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
  if (raw === 'url0p') return 'urlop';
  if (raw === 'day_off') return 'wolne';
  if (raw === 'l4') return 'l4';
  if (raw === 'swieto' || raw === 'święto' || raw === 'holiday') return 'wolne';
  if (raw === 'wolne' || raw === 'free' || raw === 'leave_free') return 'wolne';
  if (raw === 'urlop' || raw === 'url' || raw === 'leave_url' || raw === 'leave') return 'urlop';
  return null;
};

const isOffKind = (value) => {
  const upper = (value ?? '').toString().trim().toUpperCase();
  return ['L4', 'URLOP', 'URL0P', 'SWIETO', 'DAY_OFF', 'WOLNE'].includes(upper);
};

const mapDocToEvent = (doc) => {
  const payload = typeof doc?.data === 'function' ? doc.data() : doc || {};
  const extended = { ...(payload.extendedProps || {}) };
  const kindRaw = payload.kind || payload.type || extended.kind || extended.type || extended.leaveKind;
  const typeUpper = (kindRaw ?? '').toString().trim().toUpperCase();
  const leaveFromType = typeUpper.startsWith('LEAVE_') ? typeUpper.replace('LEAVE_', '') : null;
  const start = payload.start || payload.date;
  const end = payload.end ?? start;
  const normalizedLeave = normalizeLeaveKind(kindRaw || leaveFromType);
  if (isOffKind(kindRaw) || isOffKind(leaveFromType) || normalizedLeave) {
    const cls = (normalizedLeave || leaveFromType || kindRaw || 'wolne').toString().toLowerCase();
    return {
      title: payload.title || '',
      start,
      end: end ?? start,
      allDay: true,
      display: 'background',
      classNames: ['off-day', cls],
      extendedProps: { ...extended, kind: 'off', leaveKind: (normalizedLeave || leaveFromType || kindRaw || '').toUpperCase() },
    };
  }
  const classNames = [];
  if (Array.isArray(payload.classNames)) classNames.push(...payload.classNames);
  else if (Array.isArray(payload.className)) classNames.push(...payload.className);
  else if (typeof payload.className === 'string') classNames.push(payload.className);
  else if (typeof payload.classNames === 'string') classNames.push(payload.classNames);
  if (!classNames.includes('work-event')) classNames.push('work-event');
  return {
    title: payload.title || payload.client || extended.client || '',
    start,
    end,
    allDay: payload.allDay ?? true,
    display: payload.display || payload.eventDisplay || 'block',
    classNames,
    extendedProps: {
      ...extended,
      kind: extended.kind || payload.kind || 'work',
      work: extended.work ?? payload.workHours ?? payload.workH,
      drive: extended.drive ?? payload.driveHours ?? payload.driveH,
      billed: extended.billed ?? payload.billedHours ?? payload.billH,
    },
  };
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
  const events = calendar.getEvents().filter((e) => {
    const normalizedKind = normalizeLeaveKind(e.extendedProps?.kind || e.extendedProps?.leaveKind);
    if (normalizedKind) return false;
    if (e.extendedProps?.kind === 'off') return false;
    if (e.display === 'background') return false;
    return true;
  });
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
    headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,dayGridWeek' },
    navLinks: true,
    expandRows: true,
    height: 'auto',
    contentHeight: 'auto',
    handleWindowResize: true,
    fixedWeekCount: false,
    showNonCurrentDates: true,
    dayMaxEventRows: true,
    dayMaxEvents: true,
    moreLinkClick: 'popover',
    eventOverlap: false,
    slotEventOverlap: false,
    eventDisplay: 'block',
    eventOrder: 'start,-allDay,title',
    dayCellDidMount: (info) => {
      const frame = info.el.querySelector('.fc-daygrid-day-frame') || info.el;
      applyFlagToCell(calendar, frame, info.date);
    },
    events: async (info, success) => {
      try {
        const raw = await loadEventsFromDb(info.start, info.end);
        const mapped = (raw || []).map((e) => mapDocToEvent(e));
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

export function updateCalendarData(calendar, events = [], flags = []) {
  if (!calendar) return;
  setCalendarEvents(events);
  setDayFlags(flags);
  calendar.setOption('customFlags', flags || []);
  calendar.refetchEvents();
  renderDaySummaries(calendar);
  refreshDayFlags(calendar);
}

export const initCalendar = bootCalendar;
export { renderDaySummaries };
