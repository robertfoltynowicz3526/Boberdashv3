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

if (!hasConfigValues) {
  console.error('[Firebase] Brak konfiguracji Firebase – sprawdź zmienne środowiskowe. UI będzie działać w trybie offline.');
} else {
  try {
    app = initializeApp(firebaseConfig);
    firestore = getFirestore(app);
  } catch (error) {
    console.error('[Firebase] Nie udało się zainicjować aplikacji Firebase.', error);
  }
}

export const db = firestore;
export { app, firebaseConfig };