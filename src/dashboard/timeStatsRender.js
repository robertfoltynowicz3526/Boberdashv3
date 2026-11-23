export const renderTimeStats = (host, stats) => {
  if (!host) return;
  const metrics = [
    ['Praca', stats.work, ''],
    ['Jazda', stats.drive, ''],
    ['Fakturowane', stats.billed, ' metric--billed'],
    ['Nadgodziny', stats.over, ''],
    ['Absorpcja', stats.absorption, ' metric--accent'],
  ];
  host.innerHTML = `<div class="metrics-grid">
    ${metrics.map(([label, value, metricClass], i) => `
      <div class="metric${metricClass}">
        <div class="label">${label}</div>
        <div class="value num">${value.toFixed(1)}${i === 4 ? '%' : ' h'}</div>
      </div>
    `).join('')}
  </div>`;
};
