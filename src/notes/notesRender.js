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
    <article class="noteCard ${selectedNoteId === note.id ? 'is-active' : ''}" data-note-id="${note.id}" role="button" tabindex="0" aria-label="Otwórz notatkę: ${esc(note.title || '(bez tytułu)')}">
      <header class="noteCard__header">
        <strong class="noteCard__title">${esc(note.title || '(bez tytułu)')}</strong>
        <p class="noteCard__meta">${esc(note.orderLabel || (note.linkType === 'order' ? 'Zlecenie' : 'Wolna notatka'))}</p>
      </header>
      <p class="notePreview">${esc(note.preview || 'Brak treści')}</p>
      <footer class="noteCard__footer">
        <small class="noteCard__updated">Aktualizacja: ${fmt(note.updatedAt)}</small>
        <span class="noteCard__cta" aria-hidden="true">Zobacz więcej</span>
      </footer>
    </article>
  `).join('');
};

export const buildNoteTxt = (note, orderLabel = '') => `Tytuł: ${note.title || '(bez tytułu)'}\nUtworzono: ${fmt(note.createdAt)}\nZaktualizowano: ${fmt(note.updatedAt)}\nPowiązanie: ${note.linkType === 'order' ? `Zlecenie ${orderLabel || note.linkedOrderId || ''}` : 'Wolna'}\n---\n${note.content || ''}`;
