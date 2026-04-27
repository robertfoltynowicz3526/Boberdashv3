const MONTH_NAMES_PL = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'
];

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

const estimateNetFromGrossUop = (gross) => {
  const grossVal = Math.max(0, Number(gross) || 0);
  const pension = grossVal * 0.0976;
  const disability = grossVal * 0.015;
  const sickness = grossVal * 0.0245;
  const employeeSocial = pension + disability + sickness;
  const healthBase = Math.max(0, grossVal - employeeSocial);
  const health = healthBase * 0.09;

  const monthlyCosts = 250;
  const taxBase = Math.max(0, healthBase - monthlyCosts);
  const taxBeforeRelief = taxBase * 0.12;
  const taxRelief = 300;
  const pit = Math.max(0, taxBeforeRelief - taxRelief);

  return round2(grossVal - employeeSocial - health - pit);
};

export const estimateGrossFromNetUop = (targetNet) => {
  const desiredNet = Math.max(0, Number(targetNet) || 0);
  if (desiredNet <= 0) return 0;

  let low = desiredNet;
  let high = desiredNet * 3 + 4000;
  for (let i = 0; i < 40; i += 1) {
    const mid = (low + high) / 2;
    const net = estimateNetFromGrossUop(mid);
    if (net < desiredNet) low = mid;
    else high = mid;
  }
  return round2(high);
};

export const getFinanceMonthsForYear = (year, minYear = 2026, minMonth = 1) => {
  const y = Number(year);
  if (!Number.isFinite(y) || y < minYear) return [];
  const startMonth = y === minYear ? minMonth : 1;
  return Array.from({ length: 12 - startMonth + 1 }, (_, idx) => {
    const monthNumber = startMonth + idx;
    const monthKey = `${y}-${String(monthNumber).padStart(2, '0')}`;
    return {
      monthKey,
      monthNumber,
      label: `${MONTH_NAMES_PL[monthNumber - 1]} ${y}`
    };
  });
};

export const aggregateAgroEffectYear = (months, rowsByMonth = {}) => {
  const rows = months.map(({ monthKey, label, monthNumber }) => {
    const src = rowsByMonth[monthKey] || {};
    const baseNet = round2(src.baseNet);
    const bonusNet = round2(src.bonusNet);
    const baseGross = estimateGrossFromNetUop(baseNet);
    const bonusGross = round2(bonusNet * 1.3);
    const totalNet = round2(baseNet + bonusNet);
    const totalGross = round2(baseGross + bonusGross);
    return { monthKey, label, monthNumber, baseNet, bonusNet, baseGross, bonusGross, totalNet, totalGross };
  });

  const totals = rows.reduce((acc, row) => ({
    baseNet: round2(acc.baseNet + row.baseNet),
    baseGross: round2(acc.baseGross + row.baseGross),
    bonusNet: round2(acc.bonusNet + row.bonusNet),
    bonusGross: round2(acc.bonusGross + row.bonusGross),
    totalNet: round2(acc.totalNet + row.totalNet),
    totalGross: round2(acc.totalGross + row.totalGross)
  }), { baseNet: 0, baseGross: 0, bonusNet: 0, bonusGross: 0, totalNet: 0, totalGross: 0 });

  return { rows, totals };
};

export const aggregateOvertimeYear = (entries = [], year) => {
  const y = Number(year);
  const filtered = entries
    .filter((entry) => {
      const date = String(entry?.date || '');
      return date.slice(0, 4) === String(y);
    })
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const monthly = Array.from({ length: 12 }, (_, idx) => {
    const month = idx + 1;
    const key = `${y}-${String(month).padStart(2, '0')}`;
    const totalNet = round2(filtered
      .filter((entry) => String(entry.date || '').startsWith(key))
      .reduce((sum, entry) => sum + (Number(entry.netAmount) || 0), 0));
    return {
      month,
      label: MONTH_NAMES_PL[idx],
      totalNet
    };
  });

  const totalNet = round2(monthly.reduce((sum, row) => sum + row.totalNet, 0));
  return { entries: filtered, monthly, totalNet };
};

export const getFinanceYearOptions = (minYear = 2026) => {
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let year = currentYear; year >= minYear; year -= 1) years.push(year);
  return years;
};
