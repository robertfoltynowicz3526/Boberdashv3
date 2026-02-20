const fmt = (v) => {
  if (!v) return '—';
  const d = v?.toDate ? v.toDate() : new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pl-PL');
};

export const renderNotesListView = ({ host, model, selectedNoteId }) => {
  if (!host) return;
  if (!model?.results?.length) {
    host.innerHTML = '<p class="loading-state">Brak notatek.</p>';
    return;
  }
  host.innerHTML = model.results.map((note) => `
    <article class="note-item ${selectedNoteId === note.id ? 'is-active' : ''}" data-note-id="${note.id}">
      <header class="note-item__header">
        <strong>${note.title || '(bez tytułu)'}</strong>
        <span class="note-badge">${note.linkType === 'order' ? 'do zlecenia' : 'wolna'}</span>
      </header>
      <p>${(note.content || '').slice(0, 180) || '—'}</p>
      <small>Aktualizacja: ${fmt(note.updatedAt)}</small>
    </article>
  `).join('');
};

export const buildNoteTxt = (note, orderLabel = '') => `Tytuł: ${note.title || '(bez tytułu)'}\nUtworzono: ${fmt(note.createdAt)}\nZaktualizowano: ${fmt(note.updatedAt)}\nPowiązanie: ${note.linkType === 'order' ? `Zlecenie ${orderLabel || note.linkedOrderId || ''}` : 'Wolna'}\n---\n${note.content || ''}`;
