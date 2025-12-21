import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
// import { getAnalytics, isSupported } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: "AIzaSyA4VZWw2JvRR_IYFM-Ez75ZFtW3WodwTbc",
  authDomain: "bobrzy-dashboard.firebaseapp.com",
  projectId: "bobrzy-dashboard",
  storageBucket: "bobrzy-dashboard.firebasestorage.app",
  messagingSenderId: "648127119573",
  appId: "1:648127119573:web:1c956817855adee82b625c",
  measurementId: "G-9FPJ9DJEKM"
};

let cachedApp;

export function getFirebaseApp() {
  // Inicjalizuj tylko raz
  const app = cachedApp ?? getApps()[0] ?? initializeApp(firebaseConfig);
  cachedApp = app;

  // isSupported().then(supported => { if (supported) getAnalytics(app); });

  return app;
}

export const app = getFirebaseApp();
export const db = getFirestore(app);
export { firebaseConfig };
