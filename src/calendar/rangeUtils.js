const MS_PER_DAY = 24 * 60 * 60 * 1000;

const cloneDate = (value) => {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const startOfDay = (value) => {
  const date = cloneDate(value);
  if (!date) return null;
  date.setHours(0, 0, 0, 0);
  return date;
};

export const startOfWeek = (value, weekStartsOn = 1) => {
  const date = startOfDay(value);
  if (!date) return null;
  const day = date.getDay();
  const diff = (day - weekStartsOn + 7) % 7;
  date.setDate(date.getDate() - diff);
  return date;
};

export const endOfWeek = (value, weekStartsOn = 1) => {
  const start = startOfWeek(value, weekStartsOn);
  if (!start) return null;
  return new Date(start.getTime() + (6 * MS_PER_DAY));
};

export const computeRange = (focusedDate, rangeMode = 'month', weekStartsOn = 1) => {
  const safeDate = startOfDay(focusedDate) || startOfDay(new Date());
  const weekStart = startOfWeek(safeDate, weekStartsOn);

  if (rangeMode === 'week') {
    return {
      rangeStart: weekStart,
      rangeEnd: new Date(weekStart.getTime() + (6 * MS_PER_DAY)),
    };
  }

  if (rangeMode === 'twoWeeks') {
    return {
      rangeStart: weekStart,
      rangeEnd: new Date(weekStart.getTime() + (13 * MS_PER_DAY)),
    };
  }

  const monthStart = new Date(safeDate.getFullYear(), safeDate.getMonth(), 1);
  const monthEnd = new Date(safeDate.getFullYear(), safeDate.getMonth() + 1, 0);
  return {
    rangeStart: startOfWeek(monthStart, weekStartsOn),
    rangeEnd: endOfWeek(monthEnd, weekStartsOn),
  };
};

export const generateGrid = (rangeStart, rangeEnd, weekStartsOn = 1) => {
  const start = startOfWeek(rangeStart, weekStartsOn);
  const end = endOfWeek(rangeEnd, weekStartsOn);
  if (!start || !end || end < start) return [];

  const weeks = [];
  let cursor = new Date(start.getTime());
  while (cursor <= end) {
    const week = [];
    for (let i = 0; i < 7; i += 1) {
      week.push(new Date(cursor.getTime()));
      cursor = new Date(cursor.getTime() + MS_PER_DAY);
    }
    weeks.push(week);
  }
  return weeks;
};
