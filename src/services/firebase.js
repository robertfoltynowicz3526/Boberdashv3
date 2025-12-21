import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const missingEnv = Object.entries(cfg)
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missingEnv.length) console.warn('[Firebase] Missing env:', missingEnv);

const app = getApps().length ? getApps()[0] : initializeApp(cfg);
export const db = getFirestore(app);
export { app, cfg as firebaseConfig };
