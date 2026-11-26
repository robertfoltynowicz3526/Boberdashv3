// ZASADA NA PRZYSZŁOŚĆ: DATA → AGREGACJA → RENDER, bez skrótów.
import { onAuthStateChanged } from 'firebase/auth';
import { createLockScreen } from './appLock.js';
import { endAppSession, getAppLockConfig, getAppSessionExpiry, restoreAppSession, unlockWithPassword } from './appSession.js';
import { auth } from './firebase-config.js';
import { startApp } from './appStart.js';
import { isMoneyHidden, refreshMoneyVisibility, setMoneyHidden } from './utils/moneyPrivacy.js';

const mountMoneyPrivacyToggle = () => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'money-privacy-toggle';
  const update = () => {
    const hidden = isMoneyHidden();
    button.textContent = hidden ? '👁 Kwoty ukryte' : '👁 Incognito';
    button.setAttribute('aria-pressed', String(hidden));
    button.title = hidden ? 'Pokaż kwoty pieniężne' : 'Ukryj kwoty pieniężne';
  };
  update();
  button.addEventListener('click', () => {
    setMoneyHidden(!isMoneyHidden());
    refreshMoneyVisibility();
    update();
  });
  const slot = document.getElementById('money-privacy-toggle-slot') || document.body;
  slot.appendChild(button);
};

const ensureDomReady = () => new Promise((resolve) => {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', resolve, { once: true });
  } else {
    resolve();
  }
});

const startUnlockedApp = (config, screen) => {
  if (!getAppSessionExpiry(config)) return false;

  let locking = false;
  let expiryTimer;
  const lock = async () => {
    if (locking) return;
    locking = true;
    clearTimeout(expiryTimer);
    document.body.classList.add('app-locked');
    try {
      await endAppSession();
    } catch (error) {
      console.error('[appLock] Nie udało się zakończyć sesji Firebase.', error?.code);
    } finally {
      window.location.reload();
    }
  };

  const checkSession = () => {
    if (locking) return;
    clearTimeout(expiryTimer);
    const expiresAt = getAppSessionExpiry(config);
    if (!expiresAt) {
      void lock();
      return;
    }
    expiryTimer = setTimeout(checkSession, Math.min(2147483647, Math.max(0, expiresAt - Date.now())));
  };

  onAuthStateChanged(auth, checkSession);
  document.addEventListener('visibilitychange', checkSession);
  window.addEventListener('pageshow', checkSession);
  document.getElementById('app-lock-button')?.addEventListener('click', lock);

  checkSession();
  if (locking) return false;
  screen.remove();
  document.body.classList.remove('app-locked');
  startApp();
  return true;
};

const boot = async () => {
  await ensureDomReady();
  mountMoneyPrivacyToggle();
  const config = getAppLockConfig();
  const { element, focusInput, setError, setBusy } = createLockScreen();
  document.body.appendChild(element);
  setBusy(true);

  try {
    if (await restoreAppSession(config)) {
      if (startUnlockedApp(config, element)) return;
      await endAppSession();
    }
  } catch {
    setError('Nie udało się sprawdzić sesji. Zaloguj się ponownie.');
  }

  if (!config.email || !config.uid) {
    setError('Brakuje konfiguracji logowania.');
    return;
  }

  setBusy(false);
  focusInput();
  let signingIn = false;
  element.addEventListener('unlock', async event => {
    if (signingIn) return;
    signingIn = true;
    setBusy(true);
    setError('');

    let message = 'Nieprawidłowe hasło.';
    try {
      if (await unlockWithPassword(event.detail.password, config)) {
        if (startUnlockedApp(config, element)) return;
        await endAppSession();
      }
    } catch (error) {
      if (error?.code === 'auth/too-many-requests') {
        message = 'Zbyt wiele prób. Spróbuj ponownie później.';
      } else if (!['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(error?.code)) {
        message = 'Nie udało się zalogować. Spróbuj ponownie.';
      }
    }
    signingIn = false;
    setBusy(false);
    setError(message);
  });
};

void boot();
