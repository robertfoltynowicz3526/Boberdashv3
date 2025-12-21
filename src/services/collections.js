import { getFirestore, collection, getDocs, query, limit } from 'firebase/firestore';
import { getFirebaseApp } from './firebase.js';

const db = () => getFirestore(getFirebaseApp());

// Kandydaci nazw (PL/EN + istniejące warianty używane w projekcie)
const CANDIDATES = {
  clients: ['clients', 'klienci', 'Clients', 'Klienci'],
  machines: ['machines', 'maszyny', 'Machines', 'Maszyny'],
  orders: ['orders', 'zlecenia', 'Orders', 'Zlecenia'],
  calendar: ['calendar', 'kalendarz', 'events', 'Calendar', 'Kalendarz', 'Events', 'godziny_pracy'],
  leaves: ['leaves', 'wolne', 'L4', 'urlopy', 'Leaves', 'Wolne', 'Urlopy', 'events']
};

const LS_KEY = '__COL_MAP__';

async function firstExistingName(names) {
  for (const n of names) {
    try {
      const snap = await getDocs(query(collection(db(), n), limit(1)));
      // jeśli zapytanie się powiedzie (nawet 0 dokumentów) – nazwa OK
      return n;
    } catch (e) {
      // PermissionDenied też oznacza, że kolekcja istnieje (ale brak uprawnień) – uznajemy nazwę
      if (e?.code === 'permission-denied') return n;
      // resztę błędów ignorujemy i próbujemy następną nazwę
    }
  }
  return null;
}

export async function detectCollections() {
  const cached = localStorage.getItem(LS_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch (_) { /* ignore */ }
  }
  const map = {};
  for (const key of Object.keys(CANDIDATES)) {
    map[key] = await firstExistingName(CANDIDATES[key]);
  }
  localStorage.setItem(LS_KEY, JSON.stringify(map));
  return map;
}

export async function getCollections() {
  const map = await detectCollections();
  // jeżeli coś nie zostało wykryte – używamy domyślnych (angielskich) nazw
  return {
    clients: map.clients || 'clients',
    machines: map.machines || 'machines',
    orders: map.orders || 'orders',
    calendar: map.calendar || 'calendar',
    leaves: map.leaves || 'leaves',
  };
}

export async function colRefResolved(key) {
  const cols = await getCollections();
  return collection(db(), cols[key]);
}

export { CANDIDATES, LS_KEY };
