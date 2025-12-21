import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import { loadEventsFromDb, setCalendarEvents, setDayFlags } from '../data/dailyTotals.js';

const MILLISECONDS_IN_DAY = 24 * 60 * 60 * 1000;
const LEAVE_ICON = { URL: '🌿', WOLNE: '🌿', L4: '🩺', SWIETO: '🏁' };
const LEAVE_LABEL = { URL: 'Urlop', WOLNE: 'Wolne', L4: 'L4', SWIETO: 'Święto' };

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

const normalizeLeaveCode = (value) => {
  const raw = (value ?? '').toString().trim().toUpperCase();
  if (!raw) return null;
  if (raw.startsWith('LEAVE_')) {
    if (raw.includes('L4')) return 'L4';
    if (raw.includes('HOLIDAY') || raw.includes('SWIETO') || raw.includes('ŚWIĘTO')) return 'SWIETO';
    if (raw.includes('FREE') || raw.includes('URL')) return 'URL';
  }
  if (raw === 'L4') return 'L4';
  if (raw === 'SWIETO' || raw === 'ŚWIĘTO' || raw === 'HOLIDAY') return 'SWIETO';
  if (raw === 'WOLNE' || raw === 'FREE') return 'WOLNE';
  if (raw === 'URL' || raw === 'URLOP') return 'URL';
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

const getLeaveCode = (event) => {
  if (!event) return null;
  const props = event.extendedProps || {};
  return normalizeLeaveCode(
    props.leaveCode ||
      props.leaveKind ||
      props.kind ||
      props.type ||
      props.typ ||
      event.type ||
      event.typ ||
      event.kind,
  );
};

const isLeaveEvent = (event) => {
  if (!event) return false;
  const type = getLeaveCode(event);
  if (type) return true;
  const props = event.extendedProps || {};
  const rawType = props.type || props.typ;
  return typeof rawType === 'string' && rawType.toUpperCase().startsWith('LEAVE');
};

const addRangeToLeaveSet = (targetSet, startDate, endDate) => {
  if (!startDate) return;
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : start;
  if (Number.isNaN(start.getTime())) return;
  const inclusiveEnd = Number.isNaN(end.getTime()) ? start.getTime() : end.getTime() - MILLISECONDS_IN_DAY;
  const endTs = inclusiveEnd < start.getTime() ? start.getTime() : inclusiveEnd;
  for (let ts = start.getTime(); ts <= endTs; ts += MILLISECONDS_IN_DAY) {
    targetSet.add(normalizeDateKey(new Date(ts)));
  }
};

const collectLeaveDays = (events = []) => {
  const leaveDays = new Set();
  (events || []).forEach((event) => {
    if (!isLeaveEvent(event)) return;
    addRangeToLeaveSet(leaveDays, event.start || event.startStr, event.end || event.endStr || event.end);
  });
  return leaveDays;
};

const isLeaveDay = (calendar, date, leaveDaysSet) => {
  const key = normalizeDateKey(date);
  if (!key) return false;
  if (leaveDaysSet?.has(key)) return true;
  return Boolean(getLeaveFlagForDate(calendar, key));
};

const createLeaveDisplayEvent = (event, fallbackId) => {
  const leaveCode = getLeaveCode(event);
  const start = event?.start || event?.date || event?.startStr;
  if (!leaveCode || !start) return null;
  const label = LEAVE_LABEL[leaveCode] || 'Dzień wolny';
  const icon = LEAVE_ICON[leaveCode] || '';
  return {
    ...event,
    id: event?.id || fallbackId || `leave-${normalizeDateKey(start)}`,
    title: [icon, label].filter(Boolean).join(' ').trim(),
    start,
    end: event?.end || event?.endStr || start,
    allDay: event?.allDay ?? true,
    display: 'block',
    classNames: ['leave-event'],
    extendedProps: {
      ...(event?.extendedProps || {}),
      leaveCode,
      leaveKind: leaveCode,
    },
  };
};

function renderDaySummaries(calendar) {
  if (!calendar?.el) return;
  calendar.el.querySelectorAll('.day-summary').forEach((n) => n.remove());
  const toNum = (value) => (value == null ? 0 : Number(value) || 0);
  const events = calendar.getEvents();
  const leaveDays = collectLeaveDays(events);
  const by = new Map();
  events
    .filter((e) => !isLeaveEvent(e))
    .forEach((e) => {
      const key = normalizeDateKey(e.start || e.startStr);
      if (!key || isLeaveDay(calendar, key, leaveDays)) return;
      const x = e.extendedProps || {};
      const acc = by.get(key) || { w: 0, d: 0, b: 0 };
      acc.w += toNum(x.workH ?? x.workHours ?? x.work ?? x.praca);
      acc.d += toNum(x.driveH ?? x.driveHours ?? x.drive ?? x.jazda);
      acc.b += toNum(x.billH ?? x.billedHours ?? x.billed ?? x.fakturowane);
      by.set(key, acc);
    });
  by.forEach((v, key) => {
    if ((v.w <= 0) && (v.d <= 0) && (v.b <= 0)) return;
    const cell = calendar.el.querySelector(`[data-date="${key}"] .fc-daygrid-day-frame`);
    if (!cell) return;
    const el = document.createElement('div');
    el.className = 'day-summary';
    const row = document.createElement('div');
    row.className = 'day-summary-row';

    const addChip = (label, value, cls) => {
      if (value <= 0) return;
      const chip = document.createElement('span');
      chip.className = `day-summary__chip ${cls || ''}`.trim();
      chip.textContent = `${label}: ${value.toFixed(1)}h`;
      row.appendChild(chip);
    };

    addChip('Praca', v.w, 'chip-work');
    addChip('Jazda', v.d, 'chip-drive');
    addChip('Fakturowane', v.b, 'chip-billed');

    if (!row.children.length) return;
    el.appendChild(row);
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

export function bootCalendar(extraOptions = {}, hostEl = null) {
  const el = hostEl || document.getElementById('calendar') || document.getElementById('kalendarz');
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
    dayMaxEventRows: 3,
    moreLinkClick: 'popover',
    eventOverlap: false,
    slotEventOverlap: false,
    eventDisplay: 'block',
    eventOrder: 'start,-duration,title',
    dayCellDidMount: (info) => {
      const frame = info.el.querySelector('.fc-daygrid-day-frame') || info.el;
      applyFlagToCell(calendar, frame, info.date);
    },
    events: async (info, success) => {
      try {
        const raw = await loadEventsFromDb(info.start, info.end);
        const leaveAddedForDay = new Set();
        const mapped = (raw || []).reduce((acc, e) => {
          const leave = createLeaveDisplayEvent(e);
          if (leave) {
            const dateKey = normalizeDateKey(leave.start);
            if (!leaveAddedForDay.has(dateKey)) {
              leaveAddedForDay.add(dateKey);
              acc.push(leave);
            }
            return acc;
          }
          const extendedProps = { ...(e.extendedProps || {}) };
          if (!extendedProps.kind && e.kind) extendedProps.kind = e.kind;
          acc.push({
            ...e,
            title: e.title || e.extendedProps?.client || '',
            extendedProps,
          });
          return acc;
        }, []);
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
    eventContent: (arg) => {
      try {
        const leaveCode = getLeaveCode(arg?.event);
        if (!leaveCode) return undefined;
        const wrapper = document.createElement('span');
        wrapper.className = 'leave-chip';
        const icon = document.createElement('span');
        icon.className = 'leave-icon';
        icon.textContent = LEAVE_ICON[leaveCode] || '';
        const label = document.createElement('span');
        label.className = 'leave-label';
        label.textContent = LEAVE_LABEL[leaveCode] || arg?.event?.title || 'Dzień wolny';
        if (icon.textContent) wrapper.appendChild(icon);
        wrapper.appendChild(label);
        return { domNodes: [wrapper] };
      } catch (e) {
        console.error('eventContent error:', e);
        return undefined;
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

export function initCalendar(hostEl, events = [], flags = [], extraOptions = {}) {
  const calendar = bootCalendar(extraOptions, hostEl);
  if (calendar) {
    updateCalendarData(calendar, events, flags);
  }
  return calendar;
}

export { renderDaySummaries };

export function updateCalendarData(calendar, events = [], flags = []) {
  if (!calendar) return;
  setCalendarEvents(events);
  setDayFlags(flags);
  calendar.setOption('customFlags', flags || []);
  calendar.refetchEvents();
  renderDaySummaries(calendar);
  refreshDayFlags(calendar);
}
