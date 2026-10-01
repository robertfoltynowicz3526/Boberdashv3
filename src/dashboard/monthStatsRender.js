export const renderMonthStatsSkeleton = (host) => {
  if (!host) return;
  host.innerHTML = `<div class="metrics-grid">${new Array(5).fill(0).map(() => '<div class="metric metric-skeleton"></div>').join('')}</div>`;
  const chart = document.getElementById('pulpit-month-hours');
  if (chart) chart.innerHTML = '<div class="month-hours-skeleton"></div>';
};

export const renderMonthStats = (host, stats = {}) => {
  if (!host) return;
  const work = Number(stats.praca || 0);
  const billed = Number(stats.fakturowaneRozliczone || stats.fakturowanePlanowane || 0);
  const absorption = work > 0 ? (billed / work) * 100 : 0;
  const hours = [
    { label: 'Praca', value: work, tone: 'work' },
    { label: 'Jazda', value: Number(stats.jazda || 0), tone: 'drive' },
    { label: 'Fakturowane', value: billed, tone: 'billed' },
    { label: 'Nadgodziny', value: Number(stats.nadgodziny || 0), tone: 'overtime' }
  ];
  host.innerHTML = `<div class="metrics-grid">
    <div class="metric"><div class="label">Praca</div><div class="value num">${work.toFixed(1)} h</div></div>
    <div class="metric"><div class="label">Jazda</div><div class="value num">${(stats.jazda || 0).toFixed(1)} h</div></div>
    <div class="metric"><div class="label">Fakturowane</div><div class="value num">${billed.toFixed(1)} h</div></div>
    <div class="metric"><div class="label">Nadgodziny</div><div class="value num">${(stats.nadgodziny || 0).toFixed(1)} h</div></div>
    <div class="metric metric--accent"><div class="label">Absorpcja</div><div class="value num">${absorption.toFixed(0)}%</div></div>
  </div>`;

  const chart = document.getElementById('pulpit-month-hours');
  if (chart) {
    const max = Math.max(...hours.map(item => item.value), 1);
    chart.innerHTML = hours.map(item => `<div class="month-hours-row">
      <span class="month-hours-label"><i class="month-hours-dot month-hours-dot--${item.tone}"></i>${item.label}</span>
      <span class="month-hours-track"><i class="month-hours-fill month-hours-fill--${item.tone}" style="width:${(item.value / max) * 100}%"></i></span>
      <strong class="num">${item.value.toFixed(1)} h</strong>
    </div>`).join('');
  }
};
