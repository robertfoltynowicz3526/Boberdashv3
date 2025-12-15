const plugin = (typeof window !== 'undefined' && window.interaction?.default)
  || (typeof window !== 'undefined' && (window.FullCalendar?.interactionPlugin || window.FullCalendar?.interaction))
  || null;

export default plugin;
