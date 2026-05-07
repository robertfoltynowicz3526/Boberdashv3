import { collection, doc, getDoc, getDocs, query, setDoc, where, addDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';

const FINANCE_SESSION_UNLOCK_KEY = 'financeUnlocked';
const FINANCE_PASSWORD_FALLBACK = 'polska23';

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

export const getFinancePassword = () => String(import.meta.env.VITE_FINANCE_PASSWORD || FINANCE_PASSWORD_FALLBACK);

export const isFinanceUnlockedInSession = () => {
  try {
    return sessionStorage.getItem(FINANCE_SESSION_UNLOCK_KEY) === '1';
  } catch (_) {
    return false;
  }
};

export const setFinanceUnlockedInSession = (unlocked) => {
  try {
    if (unlocked) sessionStorage.setItem(FINANCE_SESSION_UNLOCK_KEY, '1');
    else sessionStorage.removeItem(FINANCE_SESSION_UNLOCK_KEY);
  } catch (_) { }
};

export const verifyFinancePassword = (candidate) => String(candidate || '') === getFinancePassword();

export const getAgroEffectDocRef = (db, year) => doc(db, 'finance_agro_effect', String(year));

export const loadAgroEffectYear = async (db, year) => {
  const snap = await getDoc(getAgroEffectDocRef(db, year));
  if (!snap.exists()) return {};
  const months = snap.data()?.months || {};
  return Object.entries(months).reduce((acc, [monthKey, row]) => {
    acc[monthKey] = {
      baseNet: toNumber(row?.baseNet),
      bonusNet: toNumber(row?.bonusNet)
    };
    return acc;
  }, {});
};

export const saveAgroEffectMonth = async (db, year, monthKey, payload) => {
  await setDoc(getAgroEffectDocRef(db, year), {
    year: Number(year),
    months: {
      [monthKey]: {
        baseNet: toNumber(payload?.baseNet),
        bonusNet: toNumber(payload?.bonusNet)
      }
    },
    updatedAt: serverTimestamp()
  }, { merge: true });
};

const overtimeCollection = (db) => collection(db, 'finance_overtime_entries');

export const listOvertimeEntriesForYear = async (db, year) => {
  const snap = await getDocs(query(overtimeCollection(db), where('year', '==', Number(year))));
  return snap.docs.map((docSnap) => {
    const data = docSnap.data() || {};
    return {
      id: docSnap.id,
      date: String(data.date || ''),
      year: Number(data.year) || Number(String(data.date || '').slice(0, 4)) || Number(year),
      client: String(data.client || ''),
      netAmount: toNumber(data.netAmount),
      note: String(data.note || '')
    };
  });
};

export const addOvertimeEntry = async (db, payload) => {
  const date = String(payload?.date || '');
  await addDoc(overtimeCollection(db), {
    date,
    year: Number(date.slice(0, 4)) || Number(payload?.year) || new Date().getFullYear(),
    client: String(payload?.client || ''),
    netAmount: toNumber(payload?.netAmount),
    note: String(payload?.note || ''),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
};

export const updateOvertimeEntry = async (db, id, payload) => {
  const date = String(payload?.date || '');
  await updateDoc(doc(db, 'finance_overtime_entries', id), {
    date,
    year: Number(date.slice(0, 4)) || Number(payload?.year) || new Date().getFullYear(),
    client: String(payload?.client || ''),
    netAmount: toNumber(payload?.netAmount),
    note: String(payload?.note || ''),
    updatedAt: serverTimestamp()
  });
};

export const deleteOvertimeEntry = async (db, id) => {
  await deleteDoc(doc(db, 'finance_overtime_entries', id));
};

export const getShrubberyDocRef = (db, year) => doc(db, 'finance_shrubbery', String(year));

export const loadShrubberyYear = async (db, year) => {
  const snap = await getDoc(getShrubberyDocRef(db, year));
  if (!snap.exists()) return { hourlyRate: 0, months: {} };
  const data = snap.data() || {};
  const months = Object.entries(data.months || {}).reduce((acc, [monthKey, row]) => {
    const costs = Array.isArray(row?.costs) ? row.costs.map((cost) => ({
      id: String(cost?.id || `${Date.now()}_${Math.random().toString(16).slice(2)}`),
      name: String(cost?.name || ''),
      amount: toNumber(cost?.amount)
    })) : [];
    acc[monthKey] = {
      hours: toNumber(row?.hours),
      costs
    };
    return acc;
  }, {});
  return { hourlyRate: toNumber(data.hourlyRate), months };
};

export const saveShrubberyYear = async (db, year, payload = {}) => {
  await setDoc(getShrubberyDocRef(db, year), {
    year: Number(year),
    hourlyRate: toNumber(payload?.hourlyRate),
    months: payload?.months || {},
    updatedAt: serverTimestamp()
  }, { merge: true });
};
