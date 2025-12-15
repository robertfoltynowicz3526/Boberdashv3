import { Calendar } from '@fullcalendar/core'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import { getDailyTotals, loadEventsFromDb, setCalendarEvents, setDayFlags } from './data/dailyTotals.js'

export function bootCalendar(options = {}) {
  const el = document.getElementById('calendar')
  if (!el) return

  const calendar = new Calendar(el, {
    plugins: [dayGridPlugin, interactionPlugin],
    initialView: 'dayGridMonth',
    headerToolbar: false,
    fixedWeekCount: false,
    showNonCurrentDates: true,
    dayMaxEventRows: 3,
    moreLinkClick: 'popover',
    eventOverlap: false,
    slotEventOverlap: false,
    eventDisplay: 'block',
    ...options,

    datesSet: (arg) => {
      const title = document.getElementById('calTitle')
      if (title) title.textContent = arg.view.title
      if (typeof options.datesSet === 'function') options.datesSet(arg)
    },

    dayCellDidMount: (arg) => {
      ;(async () => {
        try {
          if (typeof getDailyTotals !== 'function') return
          const t = await getDailyTotals(arg.date) // {work,drive,billed,l4,urlop,swieto}
          if (t?.l4 || t?.urlop || t?.swieto) return
          const zero = (!t?.work && !t?.drive && !t?.billed)
          if (zero) return

          const frame = arg.el.querySelector('.fc-daygrid-day-frame')
          if (!frame) return
          const footer = document.createElement('div')
          footer.className = 'day-summary'
          footer.innerHTML = `
            <div class="day-summary-row" style="font-size:12px;opacity:.95;margin-top:4px">
              <span>• Praca: <b>${(t.work ?? 0).toFixed(1)}h</b></span>
              <span style="margin-left:8px">• Jazda: <b>${(t.drive ?? 0).toFixed(1)}h</b></span>
              <span style="margin-left:8px">• Fakturowane: <b>${(t.billed ?? 0).toFixed(1)}h</b></span>
            </div>`
          frame.appendChild(footer)
        } catch (e) { console.error(e) }
      })()
      if (typeof options.dayCellDidMount === 'function') options.dayCellDidMount(arg)
    },

    events: async (info, success) => {
      try {
        if (typeof loadEventsFromDb !== 'function') { success([]); return }
        const raw = await loadEventsFromDb(info.start, info.end)
        const mapped = raw.map(e => {
          // e.type: 'L4' | 'URLOP' | 'SWIETO' | 'JOB'
          if (['L4','URLOP','SWIETO'].includes(e.type)) {
            return {
              start: e.start, end: e.end, allDay: true,
              display: 'background',
              classNames: [
                'fc-offday',
                e.type === 'L4' ? 'is-l4' : (e.type === 'URLOP' ? 'is-urlop' : 'is-swieto')
              ]
            }
          }
          return {
            id: e.id, title: e.title,
            start: e.start, end: e.end, allDay: !!e.allDay,
            classNames: Array.isArray(e.classNames) ? e.classNames : ['job-event']
          }
        })
        success(mapped)
      } catch (e) {
        console.error('events loader error:', e)
        success([]) // nie blokuj renderu
      }
    },
  })

  calendar.render()
  window.calendar = calendar

  // Przyciski
  document.getElementById('btnPrev')?.addEventListener('click', () => calendar.prev())
  document.getElementById('btnNext')?.addEventListener('click', () => calendar.next())
  document.getElementById('btnToday')?.addEventListener('click', () => calendar.today())

  // Aktualizacja rozmiaru (bez ?. w konstruktorze)
  try {
    if ('ResizeObserver' in window) {
      const ro = new window.ResizeObserver(() => calendar.updateSize())
      ro.observe(el)
    } else {
      window.addEventListener('resize', () => calendar.updateSize())
    }
  } catch (e) { console.warn(e) }

  return calendar
}

export function updateCalendarData(calendar, events = [], flags = []) {
  setCalendarEvents(events)
  setDayFlags(flags)
  if (calendar?.refetchEvents) {
    calendar.refetchEvents()
  }
}
