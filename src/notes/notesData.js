import { addDoc, collection, doc, documentId, getDocs, orderBy, query, updateDoc, where } from 'firebase/firestore';

export const NOTE_LINK_TYPES = {
  NONE: 'free',
  ORDER: 'order'
};

const NOTES_COLLECTION = 'notes';

const sanitizeLinkType = (value) => (value === NOTE_LINK_TYPES.ORDER ? NOTE_LINK_TYPES.ORDER : NOTE_LINK_TYPES.NONE);

const stripHtmlToText = (value = '') => String(value)
  .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export const mapNoteDoc = (snap) => {
  const data = snap.data() || {};
  const linkedOrderId = data.linkedOrderId || data.orderId || null;
  return {
    id: snap.id,
    title: typeof data.title === 'string' ? data.title : '',
    contentHtml: typeof data.contentHtml === 'string' ? data.contentHtml : (typeof data.content === 'string' ? data.content : ''),
    contentText: typeof data.contentText === 'string' ? data.contentText : stripHtmlToText(data.contentHtml || data.content || ''),
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || data.createdAt || null,
    linkType: sanitizeLinkType(data.linkType || data.linkedType),
    linkedOrderId,
    orderId: linkedOrderId,
    orderLabel: typeof data.orderLabel === 'string' ? data.orderLabel : '',
    pinned: Boolean(data.pinned),
    color: typeof data.color === 'string' ? data.color : '#ffffff',
    archived: Boolean(data.archived)
  };
};

const chunkArray = (arr = [], size = 10) => {
  const result = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
};

export const createNotesDataLayer = (db) => {
  const notesCollection = collection(db, NOTES_COLLECTION);

  const createNote = async (payload = {}) => {
    const now = new Date();
    return addDoc(notesCollection, {
      title: (payload.title || '').trim(),
      contentHtml: payload.contentHtml || payload.content || '',
      contentText: payload.contentText || stripHtmlToText(payload.contentHtml || payload.content || ''),
      createdAt: now,
      updatedAt: now,
      linkType: sanitizeLinkType(payload.linkType),
      linkedOrderId: payload.linkedOrderId || null,
      orderLabel: payload.orderLabel || '',
      pinned: Boolean(payload.pinned),
      color: payload.color || '#ffffff',
      archived: false
    });
  };

  const updateNote = async (noteId, patch = {}) => {
    if (!noteId) return;
    return updateDoc(doc(db, NOTES_COLLECTION, noteId), {
      ...patch,
      contentText: patch.contentText || stripHtmlToText(patch.contentHtml || patch.content || ''),
      linkType: sanitizeLinkType(patch.linkType),
      linkedOrderId: patch.linkType === NOTE_LINK_TYPES.ORDER ? (patch.linkedOrderId || null) : null,
      orderLabel: patch.linkType === NOTE_LINK_TYPES.ORDER ? (patch.orderLabel || '') : '',
      updatedAt: new Date()
    });
  };

  const deleteNote = async (noteId) => {
    if (!noteId) return;
    return updateDoc(doc(db, NOTES_COLLECTION, noteId), { archived: true, updatedAt: new Date() });
  };

  const listNotes = async ({ linkType = 'all', linkedOrderId = '', sort = 'updated' } = {}) => {
    const clauses = [where('archived', '==', false)];
    if (linkType === NOTE_LINK_TYPES.NONE || linkType === NOTE_LINK_TYPES.ORDER) clauses.push(where('linkType', '==', linkType));
    if (linkedOrderId) clauses.push(where('linkedOrderId', '==', linkedOrderId));
    const sortField = sort === 'newest' || sort === 'oldest' ? 'createdAt' : 'updatedAt';
    const sortDir = sort === 'oldest' ? 'asc' : 'desc';
    const snapshot = await getDocs(query(notesCollection, ...clauses, orderBy(sortField, sortDir)));
    return snapshot.docs.map(mapNoteDoc);
  };

  const listOrdersByIds = async (orderIds = []) => {
    const ids = [...new Set((orderIds || []).filter(Boolean).map((id) => String(id)))];
    if (!ids.length) return [];
    const batches = chunkArray(ids, 10);
    const docs = await Promise.all(
      batches.map((idsBatch) => getDocs(query(collection(db, 'zlecenia'), where(documentId(), 'in', idsBatch))))
    );
    return docs.flatMap((snap) => snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
  };

  return { createNote, updateNote, deleteNote, listNotes, listOrdersByIds };
};
