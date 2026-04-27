const PL_CURRENCY = new Intl.NumberFormat('pl-PL', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const money = (value) => `${PL_CURRENCY.format(Number(value) || 0)} zł`;

const escapeHtml = (value) => String(value || '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

export const renderAgroEffectRowsHtml = (rows = [], editingMonth = null, editingDraft = null) => {
  if (!rows.length) {
    return '<p class="empty-state">Brak miesięcy do wyświetlenia.</p>';
  }

  return `
    <div class="finance-table-wrap">
      <table class="finance-table finance-table--agro">
        <thead>
          <tr>
            <th>Miesiąc</th>
            <th>Podstawa netto</th>
            <th>Premia netto</th>
            <th>Razem netto</th>
            <th>Razem brutto</th>
            <th>Akcje</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => {
            const isEditing = editingMonth === row.monthKey;
            const baseValue = isEditing ? (editingDraft?.baseNet ?? row.baseNet ?? '') : row.baseNet;
            const bonusValue = isEditing ? (editingDraft?.bonusNet ?? row.bonusNet ?? '') : row.bonusNet;
            return `
              <tr class="${isEditing ? 'is-editing' : ''}">
                <td data-label="Miesiąc">${row.label}</td>
                <td data-label="Podstawa netto">
                  ${isEditing
                    ? `<input type="number" step="0.01" min="0" inputmode="decimal" class="finance-input" data-agro-draft-input="baseNet" value="${Number(baseValue) || baseValue === 0 ? baseValue : ''}" placeholder="0">`
                    : `<strong>${money(row.baseNet)}</strong>`}
                </td>
                <td data-label="Premia netto">
                  ${isEditing
                    ? `<input type="number" step="0.01" min="0" inputmode="decimal" class="finance-input" data-agro-draft-input="bonusNet" value="${Number(bonusValue) || bonusValue === 0 ? bonusValue : ''}" placeholder="0">`
                    : `<strong>${money(row.bonusNet)}</strong>`}
                </td>
                <td data-label="Razem netto"><strong>${money(row.totalNet)}</strong></td>
                <td data-label="Razem brutto"><strong>${money(row.totalGross)}</strong></td>
                <td data-label="Akcje">
                  <div class="finance-actions-inline">
                    ${isEditing
                      ? `<button type="button" data-agro-save="${row.monthKey}">Zapisz</button>
                         <button type="button" class="btn-secondary" data-agro-cancel>Anuluj</button>
                         <small class="finance-inline-note">Brutto: podstawa ${money(row.baseGross)} • premia ${money(row.bonusGross)}</small>`
                      : `<button type="button" class="btn-ghost" data-agro-edit="${row.monthKey}">Edytuj</button>`}
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
};

export const renderAgroEffectTotalsHtml = (totals) => {
  return `
    <div class="finance-summary-grid">
      <div class="metric"><div class="label">Razem netto</div><div class="value num">${money(totals.totalNet)}</div></div>
      <div class="metric"><div class="label">Razem brutto</div><div class="value num">${money(totals.totalGross)}</div></div>
      <div class="metric"><div class="label">Podstawy netto / brutto</div><div class="value num">${money(totals.baseNet)} / ${money(totals.baseGross)}</div></div>
      <div class="metric"><div class="label">Premie netto / brutto</div><div class="value num">${money(totals.bonusNet)} / ${money(totals.bonusGross)}</div></div>
    </div>
  `;
};

const renderOvertimeEntryItem = (entry) => `
  <li class="finance-entry-item" data-overtime-row="${entry.id}">
    <div class="finance-entry-item__main">
      <p class="finance-entry-item__client">${escapeHtml(entry.client || '—')}</p>
      <p class="finance-entry-item__meta">${escapeHtml(entry.note || 'Brak opisu')}</p>
    </div>
    <div class="finance-entry-item__side">
      <strong>${money(entry.netAmount)}</strong>
      <div class="finance-entry-item__actions">
        <button type="button" class="btn-secondary" data-overtime-action="edit" data-id="${entry.id}">Edytuj</button>
        <button type="button" class="btn-remove" data-overtime-action="delete" data-id="${entry.id}">Usuń</button>
      </div>
    </div>
  </li>
`;

export const renderOvertimeMonthlyCardsHtml = ({ monthly = [], expandedMonths = new Set(), activeFormMonth = null, editingEntry = null }) => {
  return `
    <div class="finance-table-wrap">
      <table class="finance-table finance-table--overtime">
        <thead>
          <tr>
            <th>Miesiąc</th>
            <th>Suma netto</th>
            <th>Liczba wpisów</th>
            <th>Akcje</th>
          </tr>
        </thead>
        <tbody>
          ${monthly.map((row) => {
            const showHistory = expandedMonths.has(row.monthKey);
            const showForm = activeFormMonth === row.monthKey;
            const isEditingInside = showForm && editingEntry && String(editingEntry.date || '').startsWith(row.monthKey);
            return `
              <tr>
                <td data-label="Miesiąc">${row.label}</td>
                <td data-label="Suma netto"><strong>${money(row.totalNet)}</strong></td>
                <td data-label="Liczba wpisów">${row.count}</td>
                <td data-label="Akcje">
                  <div class="finance-actions-inline">
                    <button type="button" data-overtime-open-form="${row.monthKey}">${isEditingInside ? 'Edytujesz wpis' : 'Dodaj wpis'}</button>
                    <button type="button" class="btn-ghost" data-overtime-toggle="${row.monthKey}">${showHistory ? 'Ukryj' : 'Historia'}</button>
                  </div>
                </td>
              </tr>
              ${(showForm || showHistory)
                ? `<tr class="finance-details-row"><td colspan="4">
                    <div class="finance-month-details">
                      ${showForm ? `
                        <form class="finance-overtime-form" data-overtime-form-month="${row.monthKey}">
                          <input type="text" data-overtime-field="client" placeholder="Klient" value="${escapeHtml(isEditingInside ? editingEntry.client : '')}" required>
                          <input type="number" data-overtime-field="net" step="0.01" min="0" inputmode="decimal" placeholder="Kwota netto" value="${isEditingInside ? (editingEntry.netAmount || '') : ''}" required>
                          <input type="text" data-overtime-field="note" placeholder="Opis" value="${escapeHtml(isEditingInside ? editingEntry.note : '')}">
                          <div class="finance-form-actions">
                            <button type="submit">${isEditingInside ? 'Zapisz' : 'Dodaj'}</button>
                            <button type="button" class="btn-secondary" data-overtime-cancel-form="${row.monthKey}">Anuluj</button>
                          </div>
                        </form>
                      ` : ''}
                      ${showHistory ? `
                        <div class="finance-history-box">
                          ${row.entries.length
                            ? `<ul class="finance-entry-list">${row.entries.map((entry) => renderOvertimeEntryItem(entry)).join('')}</ul>`
                            : '<p class="empty-state">Brak wpisów w tym miesiącu.</p>'}
                        </div>
                      ` : ''}
                    </div>
                  </td></tr>`
                : ''}
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
};

export const renderOvertimeYearSummaryHtml = ({ totalNet = 0, totalEntries = 0, bestMonth = null, bestClient = null }) => `
  <div class="finance-summary-grid">
    <div class="metric"><div class="label">Suma roczna netto</div><div class="value num">${money(totalNet)}</div></div>
    <div class="metric"><div class="label">Liczba wpisów</div><div class="value num">${totalEntries}</div></div>
    <div class="metric"><div class="label">Najlepszy miesiąc</div><div class="value num">${bestMonth ? `${bestMonth.label} (${money(bestMonth.totalNet)})` : '—'}</div></div>
    <div class="metric"><div class="label">Najlepszy klient</div><div class="value num">${bestClient ? `${escapeHtml(bestClient.client)} (${money(bestClient.totalNet)})` : '—'}</div></div>
  </div>
`;

export const renderOvertimeClientTotalsHtml = (clientsRanking = []) => {
  if (!clientsRanking.length) return '';
  return `
    <section class="summary-container-subtle">
      <h4>Suma po klientach</h4>
      <ul class="finance-client-totals">
        ${clientsRanking.slice(0, 8).map((row) => `<li><span>${escapeHtml(row.client)}</span><strong>${money(row.totalNet)}</strong></li>`).join('')}
      </ul>
    </section>
  `;
};
