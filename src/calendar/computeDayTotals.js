const parsePlNumber = (value) => {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = String(value).trim().replace(/\s/g, '').replace(',', '.');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
};

const readManualTotals = (manualDayDoc = {}) => ({
  work: parsePlNumber(manualDayDoc.work ?? 0),
  drive: parsePlNumber(manualDayDoc.drive ?? 0),
  billed: parsePlNumber(manualDayDoc.billed ?? 0),
  over: parsePlNumber(manualDayDoc.over ?? 0),
});

const sumOrderContributions = (ordersForDay = []) =>
  ordersForDay.reduce(
    (acc, order) => {
      acc.work += parsePlNumber(order?.work ?? 0);
      acc.drive += parsePlNumber(order?.drive ?? 0);
      acc.billed += parsePlNumber(order?.billed ?? 0);
      acc.over += parsePlNumber(order?.over ?? 0);
      return acc;
    },
    { work: 0, drive: 0, billed: 0, over: 0 }
  );

export const computeDayTotals = (dayStr, manualDayDoc, ordersForDay = []) => {
  const manual = readManualTotals(manualDayDoc || {});
  const fromOrders = sumOrderContributions(Array.isArray(ordersForDay) ? ordersForDay : []);
  const billedManual = ordersForDay?.length ? 0 : manual.billed;

  return {
    work: manual.work + fromOrders.work,
    drive: manual.drive + fromOrders.drive,
    billed: billedManual + fromOrders.billed,
    over: manual.over + fromOrders.over,
  };
};

export const __testables = { parsePlNumber, readManualTotals, sumOrderContributions };
