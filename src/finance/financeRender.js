const money = (value) => `${(Number(value) || 0).toFixed(2)} zł`;

const escapeHtml = (value) => String(value || '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

export const renderAgroEffectRowsHtml = (rows = []) => {
  if (!rows.length) {
    return '<p class="empty-state">Brak miesięcy do wyświetlenia.</p>';
  }
  return `
    <div class="finance-table-wrap">
      <table class="tbl finance-table">
        <thead>
          <tr>
            <th>Miesiąc</th>
            <th>Podstawa netto</th>
            <th>Premia netto</th>
            <th>Podstawa brutto (orient.)</th>
            <th>Premia brutto</th>
            <th>Razem netto</th>
            <th>Razem brutto</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${row.label}</td>
              <td><input type="number" step="0.01" min="0" inputmode="decimal" class="finance-input" data-agro-input="baseNet" data-month="${row.monthKey}" value="${row.baseNet || ''}"></td>
              <td><input type="number" step="0.01" min="0" inputmode="decimal" class="finance-input" data-agro-input="bonusNet" data-month="${row.monthKey}" value="${row.bonusNet || ''}"></td>
              <td>${money(row.baseGross)}</td>
              <td>${money(row.bonusGross)}</td>
              <td>${money(row.totalNet)}</td>
              <td>${money(row.totalGross)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
};

export const renderAgroEffectTotalsHtml = (totals) => {
  return `
    <div class="finance-summary-grid">
      <div class="metric"><div class="label">Suma podstaw netto</div><div class="value num">${money(totals.baseNet)}</div></div>
      <div class="metric"><div class="label">Suma podstaw brutto</div><div class="value num">${money(totals.baseGross)}</div></div>
      <div class="metric"><div class="label">Suma premii netto</div><div class="value num">${money(totals.bonusNet)}</div></div>
      <div class="metric"><div class="label">Suma premii brutto</div><div class="value num">${money(totals.bonusGross)}</div></div>
      <div class="metric"><div class="label">Razem netto</div><div class="value num">${money(totals.totalNet)}</div></div>
      <div class="metric"><div class="label">Razem brutto</div><div class="value num">${money(totals.totalGross)}</div></div>
    </div>
  `;
};

export const renderOvertimeMonthlyHtml = (monthly = []) => `
  <div class="finance-table-wrap">
    <table class="tbl finance-table">
      <thead><tr><th>Miesiąc</th><th>Suma netto</th></tr></thead>
      <tbody>
        ${monthly.map((row) => `<tr><td>${row.label}</td><td>${money(row.totalNet)}</td></tr>`).join('')}
      </tbody>
    </table>
  </div>
`;

export const renderOvertimeListHtml = (entries = []) => {
  if (!entries.length) {
    return '<p class="empty-state">Brak wpisów dla wybranego roku.</p>';
  }

  return `
    <div class="finance-table-wrap">
      <table class="tbl finance-table">
        <thead>
          <tr>
            <th>Data</th>
            <th>Klient</th>
            <th>Kwota netto</th>
            <th>Opis</th>
            <th>Akcje</th>
          </tr>
        </thead>
        <tbody>
          ${entries.map((entry) => `
            <tr data-overtime-row="${entry.id}">
              <td>${escapeHtml(entry.date || '—')}</td>
              <td>${escapeHtml(entry.client || '—')}</td>
              <td>${money(entry.netAmount)}</td>
              <td>${escapeHtml(entry.note || '—')}</td>
              <td>
                <button type="button" class="btn-secondary" data-overtime-action="edit" data-id="${entry.id}">Edytuj</button>
                <button type="button" class="btn-remove" data-overtime-action="delete" data-id="${entry.id}">Usuń</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
};
