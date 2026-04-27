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

export const renderAgroEffectRowsHtml = (rows = [], expandedMonths = new Set()) => {
  if (!rows.length) {
    return '<p class="empty-state">Brak miesięcy do wyświetlenia.</p>';
  }

  return `
    <div class="finance-cards-list">
      ${rows.map((row) => {
        const isExpanded = expandedMonths.has(row.monthKey);
        return `
          <article class="finance-month-card ${isExpanded ? 'is-expanded' : ''}">
            <header class="finance-month-card__header finance-month-card__header--agro">
              <h4>${row.label}</h4>
              <label class="finance-field finance-field--inline">
                <span>Podstawa netto</span>
                <input type="number" step="0.01" min="0" inputmode="decimal" class="finance-input" data-agro-input="baseNet" data-month="${row.monthKey}" value="${row.baseNet || ''}" placeholder="0">
              </label>
              <label class="finance-field finance-field--inline">
                <span>Premia netto</span>
                <input type="number" step="0.01" min="0" inputmode="decimal" class="finance-input" data-agro-input="bonusNet" data-month="${row.monthKey}" value="${row.bonusNet || ''}" placeholder="0">
              </label>
              <div class="finance-result finance-result--inline"><span>Razem netto</span><strong>${money(row.totalNet)}</strong></div>
              <div class="finance-result finance-result--inline"><span>Razem brutto</span><strong>${money(row.totalGross)}</strong></div>
              <button type="button" class="btn-ghost finance-chevron" data-agro-toggle="${row.monthKey}" aria-expanded="${isExpanded}" aria-label="Pokaż szczegóły miesiąca ${row.label}">
                ${isExpanded ? '▼' : '▶'}
              </button>
            </header>
            ${isExpanded ? `
              <div class="finance-month-card__body">
                <div class="finance-month-card__details">
                  <div class="finance-result"><span>Podstawa brutto (orient.)</span><strong>${money(row.baseGross)}</strong></div>
                  <div class="finance-result"><span>Premia brutto</span><strong>${money(row.bonusGross)}</strong></div>
                  <div class="finance-result"><span>Razem netto</span><strong>${money(row.totalNet)}</strong></div>
                  <div class="finance-result"><span>Razem brutto</span><strong>${money(row.totalGross)}</strong></div>
                </div>
                <p class="field-hint">Podstawa brutto orientacyjnie dla UoP bez PPK.</p>
              </div>
            ` : ''}
          </article>
        `;
      }).join('')}
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
      <p class="finance-entry-item__meta">${escapeHtml(entry.note || 'Brak notatki')}</p>
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
    <div class="finance-cards-list">
      ${monthly.map((row) => {
        const isExpanded = expandedMonths.has(row.monthKey);
        const showForm = activeFormMonth === row.monthKey;
        const isEditingInside = showForm && editingEntry && String(editingEntry.date || '').startsWith(row.monthKey);
        return `
          <article class="finance-month-card ${row.count > 0 ? 'has-data' : ''} ${isExpanded ? 'is-expanded' : ''}">
            <header class="finance-month-card__header finance-month-card__header--overtime">
              <h4>${row.label}</h4>
              <p class="finance-month-card__meta">Suma: <strong>${money(row.totalNet)}</strong></p>
              <p class="finance-month-card__meta">Wpisy: <strong>${row.count}</strong></p>
              <div class="finance-month-card__actions">
                <button type="button" data-overtime-open-form="${row.monthKey}">Dodaj wpis</button>
                <button type="button" class="btn-ghost finance-chevron" data-overtime-toggle="${row.monthKey}" aria-expanded="${isExpanded}" aria-label="Pokaż wpisy miesiąca ${row.label}">
                  ${isExpanded ? '▼' : '▶'}
                </button>
              </div>
            </header>
            ${(showForm || isExpanded) ? `
              <div class="finance-month-card__body">
                ${showForm ? `
                  <form class="finance-overtime-form" data-overtime-form-month="${row.monthKey}">
                    <input type="text" data-overtime-field="client" placeholder="Klient" value="${escapeHtml(isEditingInside ? editingEntry.client : '')}" required>
                    <input type="number" data-overtime-field="net" step="0.01" min="0" inputmode="decimal" placeholder="Kwota netto" value="${isEditingInside ? (editingEntry.netAmount || '') : ''}" required>
                    <input type="text" data-overtime-field="note" placeholder="Opis / notatka (opcjonalnie)" value="${escapeHtml(isEditingInside ? editingEntry.note : '')}">
                    <div class="finance-form-actions">
                      <button type="submit">${isEditingInside ? 'Zapisz' : 'Dodaj'}</button>
                      <button type="button" class="btn-secondary" data-overtime-cancel-form="${row.monthKey}">Anuluj</button>
                    </div>
                  </form>
                ` : ''}
                ${isExpanded ? `
                  <div class="finance-month-card__details">
                    ${row.entries.length
                      ? `<ul class="finance-entry-list">${row.entries.map((entry) => renderOvertimeEntryItem(entry)).join('')}</ul>`
                      : '<p class="empty-state">Brak wpisów w tym miesiącu.</p>'}
                  </div>
                ` : ''}
              </div>
            ` : ''}
          </article>
        `;
      }).join('')}
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
