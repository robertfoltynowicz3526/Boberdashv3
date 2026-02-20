import { NOTE_LINK_TYPES } from './notesData.js';

const toMs = (value) => {
  if (!value) return 0;
  if (value?.toDate) return value.toDate().getTime();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
};

export const buildNotesViewModel = ({ notes = [], filters = {} } = {}) => {
  const q = (filters.search || '').trim().toLowerCase();
  const filtered = (notes || [])
    .filter((note) => !note.archived)
    .filter((note) => (filters.linkType && filters.linkType !== 'all' ? note.linkType === filters.linkType : true))
    .filter((note) => (filters.linkedOrderId ? note.linkedOrderId === filters.linkedOrderId : true))
    .filter((note) => (q ? `${note.title || ''} ${note.content || ''}`.toLowerCase().includes(q) : true))
    .sort((a, b) => toMs(b.updatedAt) - toMs(a.updatedAt) || String(a.id).localeCompare(String(b.id)));

  return {
    results: filtered,
    notesFree: filtered.filter((note) => note.linkType === NOTE_LINK_TYPES.NONE),
    notesLinked: filtered.filter((note) => note.linkType === NOTE_LINK_TYPES.ORDER),
    notesForSelectedOrder: filters.linkedOrderId ? filtered.filter((note) => note.linkedOrderId === filters.linkedOrderId) : [],
    counters: {
      total: filtered.length,
      free: filtered.filter((note) => note.linkType === NOTE_LINK_TYPES.NONE).length,
      linked: filtered.filter((note) => note.linkType === NOTE_LINK_TYPES.ORDER).length
    }
  };
};
