const trendPresentation = (deltaPct) => {
  if (deltaPct > 0) return { className: 'up', arrow: '↑', prefix: '+' };
  if (deltaPct < 0) return { className: 'down', arrow: '↓', prefix: '' };
  return { className: 'neutral', arrow: '', prefix: '' };
};

export const buildInvoiceHoursChartHtml = ({ labels, values, deltaPct }) => {
  const safeValues = values.map(value => Math.max(0, Number(value) || 0));
  const maxValue = Math.max(...safeValues, 0);
  const trend = trendPresentation(deltaPct);

  return `
    <div class="fh3m fh3m--horizontal">
      <div class="fh3m-rows" role="img" aria-label="Wyfakturowane godziny w ostatnich trzech miesiącach">
        ${safeValues.map((value, index) => {
          const width = maxValue > 0 ? (value / maxValue) * 100 : 0;
          return `
          <div class="fh3m-row" aria-label="${labels[index]}: ${value.toFixed(1)} h">
            <span class="fh3m-label">${labels[index]}</span>
            <span class="fh3m-track" aria-hidden="true"><span class="fh3m-bar" style="width:${width}%;"></span></span>
            <strong class="fh3m-value">${value.toFixed(1)} h</strong>
          </div>`;
        }).join('')}
      </div>
      <p class="trend-note">Zmiana vs poprzedni miesiąc: <span class="delta ${trend.className}">${trend.arrow ? `${trend.arrow} ` : ''}${trend.prefix}${deltaPct.toFixed(0)}%</span></p>
    </div>`;
};

export const renderInvoiceHoursChart = (host, model) => {
  if (!host) return;
  host.innerHTML = buildInvoiceHoursChartHtml(model);
};
