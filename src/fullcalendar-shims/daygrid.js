const plugin = (typeof window !== 'undefined' && window.dayGrid?.default)
  || (typeof window !== 'undefined' && (window.FullCalendar?.dayGridPlugin || window.FullCalendar?.dayGrid))
  || null;

export default plugin;
