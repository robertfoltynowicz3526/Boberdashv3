// firebase-config.js

// Poprawne importy dla Firebase v9+
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  // ---> TUTAJ WKLEJ SWOJE DANE KONFIGURACYJNE Z FIREBASE <---
  apiKey: "AIzaSyA4VZWw2JvRR_IYFM-Ez75ZFtW3WodwTbc",
  authDomain: "bobrzy-dashboard.firebaseapp.com",
  projectId: "bobrzy-dashboard",
  storageBucket: "bobrzy-dashboard.firebasestorage.app",
  messagingSenderId: "648127119573",
  appId: "",
};

// Inicjalizacja aplikacji Firebase
const app = initializeApp(firebaseConfig);

// Eksportowanie usług, których będziemy używać w innych plikach
export const db = getFirestore(app); // Nasza baza danych Firestore
export const auth = getAuth(app); // Nasz system logowania
