const fcGlobal = typeof window !== 'undefined' ? window.FullCalendar : undefined;

export const Calendar = fcGlobal?.Calendar || null;
export const dayGridPlugin = fcGlobal?.dayGridPlugin || fcGlobal?.dayGrid || null;
export const interactionPlugin = fcGlobal?.interactionPlugin || fcGlobal?.interaction || null;

export default Calendar;
