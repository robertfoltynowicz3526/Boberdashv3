export const renderMonthStatsSkeleton = (host) => {
  if (!host) return;
  host.innerHTML = `<div class="metrics-grid">${new Array(6).fill(0).map(() => '<div class="metric metric-skeleton"></div>').join('')}</div>`;
};

export const renderMonthStats = (host, stats = {}) => {
  if (!host) return;
  host.innerHTML = `<div class="metrics-grid">
    <div class="metric"><div class="label">Praca</div><div class="value num">${(stats.praca || 0).toFixed(1)} h</div></div>
    <div class="metric"><div class="label">Fakturowane (Planowane)</div><div class="value num">${(stats.fakturowanePlanowane || 0).toFixed(1)} h</div></div>
    <div class="metric"><div class="label">Fakturowane (Rozliczone)</div><div class="value num">${(stats.fakturowaneRozliczone || 0).toFixed(1)} h</div></div>
    <div class="metric"><div class="label">Nadgodziny</div><div class="value num">${(stats.nadgodziny || 0).toFixed(1)} h</div></div>
    <div class="metric"><div class="label">Jazda</div><div class="value num">${(stats.jazda || 0).toFixed(1)} h</div></div>
    <div class="metric"><div class="label">Absorpcja</div><div class="value num">${(stats.absorpcja || 0).toFixed(1)}%</div></div>
  </div>`;
};
