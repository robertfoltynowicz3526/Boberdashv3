import { collection, getDocs } from 'firebase/firestore';
import { getFirebase, onAuthReady } from '../services/firebase.js';

const dayKey = (dLike) => {
  const d = new Date(dLike);
  if (Number.isNaN(d.getTime())) return '';
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
};

export async function loadCalendarEvents() {
  const { db } = getFirebase();
  await onAuthReady();

  const ordersSnap = await getDocs(collection(db, 'orders'));
  const leavesSnap = await getDocs(collection(db, 'leaves'));

  const orders = ordersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const leaves = leavesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const leaveByDay = new Map();
  leaves.forEach((l) => {
    const kindRaw = (l.type || l.kind || '').toString().toUpperCase();
    if (!kindRaw) return;
    leaveByDay.set(dayKey(l.date || l.day || l.start), { kind: kindRaw });
  });

  const workEvents = [];
  orders.forEach((o) => {
    const st = o.start || o.date;
    if (!st) return;
    const k = dayKey(st);
    if (leaveByDay.has(k)) return;
    const ttl = o.title || o.clientName || 'Zlecenie';
    workEvents.push({
      id: o.id,
      title: ttl,
      start: st,
      end: o.end || st,
      allDay: true,
      classNames: ['ev-summary'],
      extendedProps: { type: 'work' }
    });
  });

  const leaveEvents = [];
  leaveByDay.forEach((v, k) => {
    leaveEvents.push({
      id: `leave-${k}`,
      title: '',
      start: k,
      allDay: true,
      extendedProps: { type: 'leave', leaveKind: v.kind }
    });
  });

  return { events: [...workEvents, ...leaveEvents], leaveByDay };
}

export async function getDailyTotals(date) {
  const key = dayKey(date);
  if (!key) return { work: 0, drive: 0, billed: 0, l4: false, urlop: false, swieto: false };
  const { leaveByDay, events } = await loadCalendarEvents();
  const hasLeave = leaveByDay.has(key);
  const totals = events.filter((ev) => dayKey(ev.start) === key);
  return {
    work: totals.length,
    drive: 0,
    billed: 0,
    l4: hasLeave && (leaveByDay.get(key)?.kind || '').toUpperCase() === 'L4',
    urlop: hasLeave && (leaveByDay.get(key)?.kind || '').toUpperCase() === 'WOLNE',
    swieto: hasLeave && ['ŚWIĘTO', 'SWIETO'].includes((leaveByDay.get(key)?.kind || '').toUpperCase())
  };
}
