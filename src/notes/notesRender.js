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
    <article class="noteCard ${selectedNoteId === note.id ? 'is-active' : ''}" style="--note-accent:${esc(note.color || 'rgba(54, 124, 43, 0.45)')}" data-note-id="${note.id}" role="button" tabindex="0" aria-label="Otwórz notatkę: ${esc(note.title || '(bez tytułu)')}">
      <header class="noteCard__header">
        <div class="noteCard__titleRow"><strong class="noteCard__title">${esc(note.title || '(bez tytułu)')}</strong>${note.pinned ? '<span class="noteCard__pin">📌</span>' : ''}</div>
        <p class="noteCard__meta"><span class="noteCard__metaLabel">Powiązanie:</span> ${esc(note.relationLabel || (note.linkType === 'order' ? note.orderLabel : 'Wolna'))}</p>
      </header>
      <p class="notePreview">${esc(note.preview || "")}</p>
    </article>
  `).join('');
};

const fmt = (v) => {
  if (!v) return '—';
  const d = v?.toDate ? v.toDate() : new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pl-PL');
};

export const buildNoteTxt = (note, orderLabel = '') => `Tytuł: ${note.title || '(bez tytułu)'}\nUtworzono: ${fmt(note.createdAt)}\nZaktualizowano: ${fmt(note.updatedAt)}\nPowiązanie: ${note.linkType === 'order' ? `${orderLabel || note.orderLabel || note.linkedOrderId || ''}` : 'Wolna'}\n---\n${note.contentText || ''}`;
