export const renderTimeStats = (host, stats) => {
  if (!host) return;
  const metrics = [
    ['Praca', stats.work],
    ['Jazda', stats.drive],
    ['Fakturowane', stats.billed],
    ['Nadgodziny', stats.over],
    ['Absorpcja', stats.absorption],
  ];
  host.innerHTML = `<div class="metrics-grid">
    ${metrics.map(([label, value], i) => `
      <div class="metric${i === 4 ? ' metric--accent' : ''}">
        <div class="label">${label}</div>
        <div class="value num">${value.toFixed(1)}${i === 4 ? '%' : ' h'}</div>
      </div>
    `).join('')}
  </div>`;
};
