import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyA4VZWw2JvRR_IYFM-Ez75ZFtW3WodwTbc",
  authDomain: "bobrzy-dashboard.firebaseapp.com",
  projectId: "bobrzy-dashboard",
  storageBucket: "bobrzy-dashboard.firebasestorage.app",
  messagingSenderId: "648127119573",
  appId: "1:648127119573:web:1c956817855adee82b625c",
  measurementId: "G-9FPJ9DJEKM"
};

let _app;
export function getFirebaseApp() {
  _app ||= (getApps()[0] ?? initializeApp(firebaseConfig));
  return _app;
}

let _db;
export function db() {
  _db ||= getFirestore(getFirebaseApp());
  return _db;
}
