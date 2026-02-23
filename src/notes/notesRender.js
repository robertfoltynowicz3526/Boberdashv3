const esc = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

export const renderNotesListView = ({ host, model, selectedNoteId }) => {
  if (!host) return;
  if (!model?.results?.length) {
    host.innerHTML = '<p class="loading-state">Brak notatek.</p>';
    return;
  }
  host.innerHTML = model.results.map((note) => `
    <article class="noteCard ${selectedNoteId === note.id ? 'is-active' : ''}" data-note-id="${note.id}" role="button" tabindex="0" aria-label="Otwórz notatkę: ${esc(note.title || '(bez tytułu)')}">
      <header class="noteCard__header">
        <strong class="noteCard__title">${esc(note.title || '(bez tytułu)')}</strong>
        <p class="noteCard__meta"><span class="noteCard__metaLabel">Powiązanie:</span> ${esc(note.relationLabel || (note.linkType === 'order' ? note.orderLabel : 'Wolna notatka'))}</p>
      </header>
    </article>
  `).join('');
};

const fmt = (v) => {
  if (!v) return '—';
  const d = v?.toDate ? v.toDate() : new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pl-PL');
};

export const buildNoteTxt = (note, orderLabel = '') => `Tytuł: ${note.title || '(bez tytułu)'}\nUtworzono: ${fmt(note.createdAt)}\nZaktualizowano: ${fmt(note.updatedAt)}\nPowiązanie: ${note.linkType === 'order' ? `Zlecenie ${orderLabel || note.linkedOrderId || ''}` : 'Wolna'}\n---\n${note.content || ''}`;
