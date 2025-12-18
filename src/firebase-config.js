import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Ten kod odczytuje klucze ze zmiennych środowiskowych Vercel
const firebaseConfig = {
  apiKey: import.meta.env.VITE_API_KEY,
  authDomain: import.meta.env.VITE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_APP_ID
};

let app = null;
let firestore = null;

const hasConfigValues = Object.values(firebaseConfig).every((value) => Boolean(value));

function showFirebaseNotice(message) {
  if (typeof document === 'undefined') return;
  try {
    let banner = document.querySelector('[data-firebase-warning]');
    if (!banner) {
      banner = document.createElement('div');
      banner.dataset.firebaseWarning = 'true';
      banner.className = 'app-inline-warning';
      document.body.appendChild(banner);
    }
    banner.textContent = message;
  } catch (_) { /* UI message is best-effort */ }
}

if (!hasConfigValues) {
  console.error('[Firebase] Brak konfiguracji Firebase – sprawdź zmienne środowiskowe. UI będzie działać w trybie offline.');
  showFirebaseNotice('Tryb offline: brak konfiguracji Firebase. Część danych może nie synchronizować.');
} else {
  try {
    app = initializeApp(firebaseConfig);
    firestore = getFirestore(app);
  } catch (error) {
    console.error('[Firebase] Nie udało się zainicjować aplikacji Firebase.', error);
    showFirebaseNotice('Połączenie z Firebase niedostępne – aplikacja działa w trybie offline.');
  }
}

export const db = firestore;
export { app, firebaseConfig };