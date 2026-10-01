export const renderMonthStatsSkeleton = (host) => {
  if (!host) return;
  host.innerHTML = `<div class="metrics-grid">${new Array(5).fill(0).map(() => '<div class="metric metric-skeleton"></div>').join('')}</div>`;
};

export const renderMonthStats = (host, stats = {}) => {
  if (!host) return;
  const work = Number(stats.praca || 0);
  const billed = Number(stats.fakturowaneRozliczone || stats.fakturowanePlanowane || 0);
  const absorption = work > 0 ? (billed / work) * 100 : 0;
  host.innerHTML = `<div class="metrics-grid">
    <div class="metric"><div class="label">Praca</div><div class="value num">${work.toFixed(1)} h</div></div>
    <div class="metric"><div class="label">Jazda</div><div class="value num">${(stats.jazda || 0).toFixed(1)} h</div></div>
    <div class="metric"><div class="label">Fakturowane</div><div class="value num">${billed.toFixed(1)} h</div></div>
    <div class="metric"><div class="label">Nadgodziny</div><div class="value num">${(stats.nadgodziny || 0).toFixed(1)} h</div></div>
    <div class="metric metric--accent"><div class="label">Absorpcja</div><div class="value num">${absorption.toFixed(0)}%</div></div>
  </div>`;
};
