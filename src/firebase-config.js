import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Konfiguracja Firebase (wartości od użytkownika)
const firebaseConfig = {
  apiKey: "AIzaSyA4VZWw2JvRR_IYFM-Ez75ZFtW3WodwTbc",
  authDomain: "bobrzy-dashboard.firebaseapp.com",
  projectId: "bobrzy-dashboard",
  storageBucket: "bobrzy-dashboard.firebasestorage.app",
  messagingSenderId: "648127119573",
  appId: "1:648127119573:web:1c956817855adee82b625c",
  measurementId: "G-9FPJ9DJEKM"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Analytics opcjonalnie (nie psuj buildu jeśli env/SSR/Brak wsparcia)
export let analytics = null;
(async () => {
  try {
    const { isSupported, getAnalytics } = await import("firebase/analytics");
    if (await isSupported()) analytics = getAnalytics(app);
  } catch (e) {
    // analytics nie jest krytyczne – ignoruj
  }
})();
