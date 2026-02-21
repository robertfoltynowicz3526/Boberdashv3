import { NOTE_LINK_TYPES } from './notesData.js';

const toMs = (value) => {
  if (!value) return 0;
  if (value?.toDate) return value.toDate().getTime();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
};

export const buildNotesViewModel = ({ notes = [], filters = {} } = {}) => {
  const orderLabelsById = filters.orderLabelsById instanceof Map ? filters.orderLabelsById : new Map();
  const q = (filters.search || '').trim().toLowerCase();
  const filtered = (notes || [])
    .filter((note) => !note.archived)
    .filter((note) => (filters.linkType && filters.linkType !== 'all' ? note.linkType === filters.linkType : true))
    .filter((note) => (filters.linkedOrderId ? note.linkedOrderId === filters.linkedOrderId : true))
    .filter((note) => (q ? `${note.title || ''} ${note.content || ''}`.toLowerCase().includes(q) : true))
    .sort((a, b) => toMs(b.updatedAt) - toMs(a.updatedAt) || String(a.id).localeCompare(String(b.id)))
    .map((note) => {
      const preview = String(note.content || '').replace(/\s+/g, ' ').trim();
      const orderLabel = note.linkType === NOTE_LINK_TYPES.ORDER
        ? (orderLabelsById.get(note.linkedOrderId) || note.linkedOrderId || 'Brak zlecenia')
        : '';
      return {
        ...note,
        preview,
        orderLabel,
        relationLabel: note.linkType === NOTE_LINK_TYPES.ORDER ? `Zlecenie: ${orderLabel}` : 'Wolna notatka'
      };
    });

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


const normalizeToken = (value) => String(value || '').toLowerCase().trim();

export const buildNoteOrderOptionsModel = ({ orders = [], clients = [], machines = [] } = {}) => {
  const clientsById = new Map((clients || []).map((client) => [client.id, client]));
  const machinesById = new Map((machines || []).map((machine) => [machine.id, machine]));
  return (orders || []).map((order) => {
    const client = clientsById.get(order.klientId);
    const machine = machinesById.get(order.maszynaId);
    const clientLabel = client?.nazwa || order.klientNazwa || '';
    const machineLabel = [machine?.typMaszyny, machine?.model].filter(Boolean).join(' ').trim() || [order.typMaszyny, order.model].filter(Boolean).join(' ').trim() || '';
    const orderNumber = String(order.nrZlecenia || order.id || '').trim();
    const labelParts = [`#${orderNumber || order.id}`, clientLabel, machineLabel].filter(Boolean);
    const label = labelParts.join(' • ');
    const searchTokens = [
      orderNumber,
      clientLabel,
      machine?.typMaszyny || order.typMaszyny || '',
      machine?.model || order.model || '',
      machineLabel
    ]
      .map(normalizeToken)
      .filter(Boolean);
    return { id: order.id, label, searchTokens };
  });
};

export const filterNoteOrderOptions = ({ options = [], query = '' } = {}) => {
  const q = normalizeToken(query);
  if (!q) return options;
  return (options || []).filter((option) => (option.searchTokens || []).some((token) => token.includes(q)));
};
