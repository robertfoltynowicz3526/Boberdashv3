import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from './firebase-config.js';

const SESSION_KEY = 'appLock.session';
const DEFAULT_TTL_HOURS = 12;

export const getAppLockConfig = () => {
  const ttlHours = Number(import.meta.env.VITE_APP_LOCK_TTL_HOURS ?? DEFAULT_TTL_HOURS);
  return {
    email: (import.meta.env.VITE_BOBEREK_AUTH_EMAIL ?? '').trim(),
    uid: (import.meta.env.VITE_BOBEREK_AUTH_UID ?? '').trim(),
    ttlMs: (Number.isFinite(ttlHours) && ttlHours > 0 ? ttlHours : DEFAULT_TTL_HOURS) * 60 * 60 * 1000
  };
};

export const getAppSessionExpiry = (config) => {
  if (!config.email || !config.uid || auth.currentUser?.uid !== config.uid) return null;
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    if (session?.uid !== config.uid || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) {
      return null;
    }
    return session.expiresAt;
  } catch {
    return null;
  }
};

export const endAppSession = async () => {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } finally {
    await signOut(auth);
  }
};

export const restoreAppSession = async (config) => {
  await auth.authStateReady();
  const user = auth.currentUser;
  if (user && getAppSessionExpiry(config)) {
    try {
      await user.getIdToken(true);
    } catch (error) {
      await endAppSession();
      throw error;
    }
    if (getAppSessionExpiry(config)) return true;
  }
  await endAppSession();
  return false;
};

export const unlockWithPassword = async (password, config) => {
  if (!password || !config.email || !config.uid) return false;
  const { user } = await signInWithEmailAndPassword(auth, config.email, password);
  if (user.uid !== config.uid) {
    await endAppSession();
    return false;
  }

  const unlockedAt = Date.now();
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      uid: user.uid,
      unlockedAt,
      expiresAt: unlockedAt + config.ttlMs
    }));
  } catch (error) {
    await endAppSession();
    throw error;
  }
  return true;
};
