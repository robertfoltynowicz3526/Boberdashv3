// ZASADA NA PRZYSZŁOŚĆ: DATA → AGREGACJA → RENDER, bez skrótów.
import { clearAppLockSession, createLockScreen, getAppLockConfig, isAppUnlocked, unlockWithPassword } from './appLock.js';
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
  document.body.appendChild(button);
};

const ensureDomReady = () => new Promise((resolve) => {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', resolve, { once: true });
  } else {
    resolve();
  }
});

const startUnlockedApp = async () => {
  await startApp();
};

const setupLockButton = () => {
  const lockButton = document.getElementById('app-lock-button');
  if (!lockButton) return;
  lockButton.addEventListener('click', () => {
    clearAppLockSession();
    window.location.reload();
  });
};

const boot = async () => {
  await ensureDomReady();
  mountMoneyPrivacyToggle();
  const config = getAppLockConfig();

  if (!config.enabled) {
    document.body.classList.remove('app-locked');
    const lockButton = document.getElementById('app-lock-button');
    if (lockButton) lockButton.hidden = true;
    await startUnlockedApp();
    return;
  }

  if (isAppUnlocked(config)) {
    document.body.classList.remove('app-locked');
    await startUnlockedApp();
    setupLockButton();
    return;
  }

  document.body.classList.add('app-locked');
  const { element, focusInput, setError, setBusy } = createLockScreen();
  document.body.appendChild(element);
  focusInput();

  element.addEventListener('unlock', async (event) => {
    const password = event.detail?.password || '';
    setBusy(true);
    setError('');
    const ok = await unlockWithPassword(password, config);
    if (!ok) {
      setBusy(false);
      setError('Nieprawidłowe hasło.');
      return;
    }
    document.body.classList.remove('app-locked');
    element.remove();
    await startUnlockedApp();
    setupLockButton();
  });
};

boot();
