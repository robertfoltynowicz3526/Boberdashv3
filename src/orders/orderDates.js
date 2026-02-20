export const normalizeDateOnly = (value) => {
  if (!value) return '';
  const raw = String(value).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const getCompletionMonthKey = (order) => {
  const key = normalizeDateOnly(order?.completionDate || order?.serviceDate || order?.dataUkonczenia || order?.completedAt);
  return key ? key.slice(0, 7) : '';
};
