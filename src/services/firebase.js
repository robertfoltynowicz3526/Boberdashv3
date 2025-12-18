/* eslint-disable no-console */
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth';

const cfg = {
  apiKey:             import.meta.env.VITE_FB_API_KEY,
  authDomain:         import.meta.env.VITE_FB_AUTH_DOMAIN,
  projectId:          import.meta.env.VITE_FB_PROJECT_ID,
  storageBucket:      import.meta.env.VITE_FB_STORAGE_BUCKET,
  messagingSenderId:  import.meta.env.VITE_FB_MESSAGING_SENDER_ID,
  appId:              import.meta.env.VITE_FB_APP_ID,
};

function assertConfig() {
  const missing = Object.entries(cfg).filter(([,v]) => !v).map(([k]) => k);
  if (missing.length) {
    const msg = `Brak zmiennych Firebase: ${missing.join(', ')}. Dodaj je w Vercel → Project Settings → Environment Variables (VITE_FB_*)`;
    if (import.meta.env.DEV) console.error(msg);
    throw new Error(msg);
  }
}

let cached;
export function getFirebase() {
  if (!cached) {
    if (!getApps().length) {
      assertConfig();
      const app = initializeApp(cfg);
      cached = { app, db: getFirestore(app), auth: getAuth(app) };
    } else {
      const app = getApps()[0];
      cached = { app, db: getFirestore(app), auth: getAuth(app) };
    }
  }
  return cached;
}

export function onAuthReady() {
  const { auth } = getFirebase();
  return new Promise((resolve, reject) => {
    const off = onAuthStateChanged(auth, (user) => {
      if (user) { off(); resolve(user); }
      else signInAnonymously(auth).catch((e) => {
        if (import.meta.env.DEV) console.error('Anon auth error', e);
        off(); resolve(null);
      });
    }, (err) => { if (import.meta.env.DEV) console.error(err); off(); reject(err); });
  });
}
