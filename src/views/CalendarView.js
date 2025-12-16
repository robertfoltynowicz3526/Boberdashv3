import { initCalendar, renderDaySummaries, updateCalendarData } from '../calendar/initCalendar.js';

export const markerToClass = { L4: 'marker-sick', Urlop: 'marker-vacation', 'Święto': 'marker-holiday' };

export function buildDayMarkers(markers = []) {
  return markers.map((m) => ({
    start: m.date,
    end: m.date,
    allDay: true,
    display: 'background',
    classNames: ['day-marker', markerToClass[m.type]]
  }));
}

export { initCalendar, renderDaySummaries, updateCalendarData };
