const fcGlobal = typeof window !== 'undefined' ? window.FullCalendar : undefined;

export const Calendar = fcGlobal?.Calendar || null;
export const dayGridPlugin = fcGlobal?.dayGridPlugin || fcGlobal?.dayGrid || null;
export const interactionPlugin = fcGlobal?.interactionPlugin || fcGlobal?.interaction || null;
const locales = Array.isArray(fcGlobal?.globalLocales) ? fcGlobal.globalLocales : (Array.isArray(fcGlobal?.locales) ? fcGlobal.locales : []);
export const plLocale = locales.find((loc) => loc?.code === 'pl') || 'pl';

export default Calendar;
