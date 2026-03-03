const BASE_MONTHLY_HOURS = 168;

const sumOrders = (orders = []) =>
  orders.reduce(
    (acc, order) => {
      acc.work += Number(order?.work) || 0;
      acc.drive += Number(order?.drive) || 0;
      acc.billed += Number(order?.billed) || 0;
      acc.over += Number(order?.over) || 0;
      return acc;
    },
    { work: 0, drive: 0, billed: 0, over: 0 }
  );

const computeFinalTotals = (fromOrders, fromManual) => ({
  work: fromOrders.work + (fromOrders.work === 0 ? fromManual.work : 0),
  drive: fromOrders.drive + (fromOrders.drive === 0 ? fromManual.drive : 0),
  billed: fromOrders.billed + (fromOrders.billed === 0 ? fromManual.billed : 0),
  over: fromOrders.over + (fromOrders.over === 0 ? fromManual.over : 0),
});

export const computeDayTotals = (dayRecord) => {
  const isLeave = Boolean(dayRecord?.leaveKind);
  if (isLeave) {
    return {
      totals: { work: 0, drive: 0, billed: 0, over: 0 },
      flags: { isLeave: true, hasData: false },
      leaveKind: dayRecord?.leaveKind || null
    };
  }

  const manual = dayRecord?.manual || { work: 0, drive: 0, billed: 0, over: 0 };
  const orderTotals = sumOrders(dayRecord?.orders || []);
  const totals = computeFinalTotals(orderTotals, manual);
  const hasData =
    (dayRecord?.orders?.length || 0) > 0 ||
    totals.work !== 0 ||
    totals.drive !== 0 ||
    totals.billed !== 0 ||
    totals.over !== 0;

  return { totals, flags: { isLeave: false, hasData }, leaveKind: null };
};

const createMonthTotals = () => ({
  work: 0,
  drive: 0,
  billed: 0,
  over: 0,
  l4Days: 0,
  urlopDays: 0,
});

const sumTotals = (target, source) => {
  target.work += source.work;
  target.drive += source.drive;
  target.billed += source.billed;
  target.over += source.over;
  return target;
};

export const computeYearReport = ({ year, days = [], billingMode = "settlement" }) => {
  const monthMap = new Map();
  const orders = [];
  const clientTotalsMap = new Map();
  const billedByBillingMonth = new Map();
  let unassignedBilled = 0;

  days.forEach((day) => {
    const dayKey = day?.dayStr;
    if (!dayKey || dayKey.length < 7) return;
    const monthKey = dayKey.slice(0, 7);
    const monthTotals = monthMap.get(monthKey) || createMonthTotals();
    const { totals, flags } = computeDayTotals(day);

    sumTotals(monthTotals, totals);

    const billedFromOrders = (Array.isArray(day?.orders) ? day.orders : []).reduce((acc, order) => acc + (Number(order?.billed) || 0), 0);
    const manualBilled = Number(day?.manual?.billed) || 0;
    monthTotals.billed -= billedFromOrders;
    if (billedFromOrders === 0) {
      monthTotals.billed -= manualBilled;
    }

    const isL4 = day?.leaveKind === 'L4' || day?.flags?.l4;
    const isUrlop = day?.leaveKind === 'URL' || day?.flags?.urlop;
    if (isL4) monthTotals.l4Days += 1;
    if (isUrlop) monthTotals.urlopDays += 1;

    monthMap.set(monthKey, monthTotals);

    if (!flags.isLeave && Array.isArray(day?.orders)) {
      day.orders.forEach((order) => {
        const orderId = order?.orderId || '';
        const billedHours = Number(order?.billed) || 0;
        if (billingMode === 'settlement') {
          if (!orderId) return;
          if (billedHours <= 0) return;
        }
        const record = {
          date: dayKey,
          clientName: order?.clientName || orderId || 'Zlecenie',
          orderId,
          workHours: Number(order?.work) || 0,
          driveHours: Number(order?.drive) || 0,
          billedHours,
          overHours: Number(order?.over) || 0,
          note: day?.note || ''
        };
        const explicitBillingMonth = order?.billingMonth || "";
        const billingMonth = billingMode === "calendar" ? monthKey : explicitBillingMonth;
        if (billingMode === "settlement") {
          if (!billingMonth) {
            unassignedBilled += record.billedHours;
          } else if (Number(billingMonth.slice(0, 4)) === Number(year)) {
            billedByBillingMonth.set(billingMonth, (billedByBillingMonth.get(billingMonth) || 0) + record.billedHours);
          }
        } else {
          billedByBillingMonth.set(billingMonth, (billedByBillingMonth.get(billingMonth) || 0) + record.billedHours);
        }
        orders.push(record);

        const existing = clientTotalsMap.get(record.clientName) || { work: 0, drive: 0, billed: 0, over: 0 };
        existing.work += record.workHours;
        existing.drive += record.driveHours;
        existing.billed += record.billedHours;
        existing.over += record.overHours;
        clientTotalsMap.set(record.clientName, existing);
      });
    }
  });

  const months = [...monthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, totals]) => {
      const billed = billedByBillingMonth.get(monthKey) || 0;
      const merged = { ...totals, billed };
      return {
        monthKey,
        totals: merged,
        absorpcja: merged.billed ? (merged.billed / BASE_MONTHLY_HOURS) * 100 : 0
      };
    });

  const yearlyTotals = months.reduce(
    (acc, month) => {
      acc.work += month.totals.work;
      acc.drive += month.totals.drive;
      acc.billed += month.totals.billed;
      acc.over += month.totals.over;
      acc.l4Days += month.totals.l4Days;
      acc.urlopDays += month.totals.urlopDays;
      return acc;
    },
    { work: 0, drive: 0, billed: 0, over: 0, l4Days: 0, urlopDays: 0 }
  );
  yearlyTotals.absorpcja = yearlyTotals.billed ? (yearlyTotals.billed / (BASE_MONTHLY_HOURS * 12)) * 100 : 0;

  const clientTotals = [...clientTotalsMap.entries()]
    .map(([clientName, totals]) => ({ clientName, totals }))
    .sort((a, b) => (b.totals.billed || 0) - (a.totals.billed || 0));

  return {
    year,
    months,
    yearlyTotals,
    orders,
    clientTotals,
    unassignedBilled,
    billingMode
  };
};
