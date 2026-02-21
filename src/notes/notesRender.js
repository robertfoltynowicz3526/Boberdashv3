const fmt = (v) => {
  if (!v) return '—';
  const d = v?.toDate ? v.toDate() : new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pl-PL');
};

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
    <article class="note-item ${selectedNoteId === note.id ? 'is-active' : ''}" data-note-id="${note.id}" role="button" tabindex="0" aria-label="Otwórz notatkę: ${esc(note.title || '(bez tytułu)')}">
      <header class="note-item__header">
        <strong class="note-item__title">${esc(note.title || '(bez tytułu)')}</strong>
      </header>
      <p class="note-item__meta">${esc(note.relationLabel || (note.linkType === 'order' ? 'Zlecenie' : 'Wolna'))}</p>
      <p class="note-item__preview">${esc(note.preview || '—')}</p>
      <small class="note-item__updated">Aktualizacja: ${fmt(note.updatedAt)}</small>
    </article>
  `).join('');
};

export const buildNoteTxt = (note, orderLabel = '') => `Tytuł: ${note.title || '(bez tytułu)'}\nUtworzono: ${fmt(note.createdAt)}\nZaktualizowano: ${fmt(note.updatedAt)}\nPowiązanie: ${note.linkType === 'order' ? `Zlecenie ${orderLabel || note.linkedOrderId || ''}` : 'Wolna'}\n---\n${note.content || ''}`;
