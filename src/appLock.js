import tractorPhotoUrl from './assets/login/john-deere-6r-250.webp';
import './styles/app-lock.css';

const SESSION_KEY = 'appLock.session';
const DEFAULT_TTL_HOURS = 12;

const normalizePasswordValue = (value) => {
  if (value == null) return '';
  let normalized = String(value).trim();
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized;
};

export const getAppLockConfig = () => {
  const enabledRaw = String(import.meta.env.VITE_APP_LOCK_ENABLED || '0').trim().toLowerCase();
  const enabled = enabledRaw === '1' || enabledRaw === 'true';
  const password = normalizePasswordValue(import.meta.env.VITE_APP_LOCK_PASSWORD);
  const ttlHoursRaw = Number(import.meta.env.VITE_APP_LOCK_TTL_HOURS || DEFAULT_TTL_HOURS);
  const ttlHours = Number.isFinite(ttlHoursRaw) && ttlHoursRaw > 0 ? ttlHoursRaw : DEFAULT_TTL_HOURS;
  const passwordConfigured = password.length > 0;
  let effectiveEnabled = enabled;

  if (enabled && !passwordConfigured) {
    console.warn('[appLock] enabled but no password configured; disabling lock.');
    effectiveEnabled = false;
  }

  console.info('[appLock] config', { enabled: effectiveEnabled, passwordConfigured });

  return {
    enabled: effectiveEnabled,
    password,
    ttlMs: ttlHours * 60 * 60 * 1000
  };
};

const readSession = () => {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (_) {
    return null;
  }
};

export const isAppUnlocked = (config = getAppLockConfig()) => {
  if (!config.enabled) return true;
  const session = readSession();
  if (!session?.expiresAt) return false;
  if (Number(session.expiresAt) <= Date.now()) {
    clearAppLockSession();
    return false;
  }
  return true;
};

const persistSession = (config) => {
  const now = Date.now();
  const payload = {
    unlockedAt: now,
    expiresAt: now + config.ttlMs
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
};

export const clearAppLockSession = () => {
  sessionStorage.removeItem(SESSION_KEY);
};

export const unlockWithPassword = async (password, config = getAppLockConfig()) => {
  if (!config.enabled) return true;
  const normalizedInput = normalizePasswordValue(password);
  const normalizedEnv = normalizePasswordValue(config.password);
  if (!normalizedInput || !normalizedEnv) return false;
  const ok = normalizedInput === normalizedEnv;
  if (ok) {
    persistSession(config);
  }
  return ok;
};

export const createLockScreen = () => {
  const element = document.createElement('section');
  element.id = 'app-lock-screen';
  element.className = 'app-lock-screen';
  element.setAttribute('aria-labelledby', 'app-lock-title');
  element.innerHTML = `
    <div class="app-lock-hero">
      <img class="app-lock-photo" src="${tractorPhotoUrl}" alt="John Deere 6R 250 podczas pracy w polu" fetchpriority="high" />
      <div class="app-lock-brand">
        <span class="app-lock-logo" aria-hidden="true">B·</span>
        <span>Boberek</span>
      </div>
      <details class="app-lock-credit">
        <summary aria-label="Informacje o zdjęciu"><span aria-hidden="true">i</span></summary>
        <div class="app-lock-credit__text">
          <strong>JDDeutschland</strong>
          <a href="https://commons.wikimedia.org/wiki/File:6R_250.jpg">Zdjęcie w Wikimedia Commons</a>
          <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.pl">Licencja CC BY-SA 4.0</a>
          <small>Konwersja do WebP, kadrowanie i przyciemnienie na ekranie.</small>
        </div>
      </details>
    </div>
    <div class="app-lock-panel">
      <form class="app-lock-form">
        <h1 id="app-lock-title">Zaloguj się</h1>
        <label for="app-lock-input">Hasło</label>
        <div class="app-lock-password">
          <input id="app-lock-input" class="app-lock-input" type="password" autocomplete="current-password" placeholder="••••••••" aria-describedby="app-lock-error" />
          <button class="app-lock-password-toggle" type="button" aria-label="Pokaż hasło" aria-controls="app-lock-input">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
              <circle cx="12" cy="12" r="2.5" />
              <path class="app-lock-password-slash" d="m3 3 18 18" />
            </svg>
          </button>
        </div>
        <p id="app-lock-error" class="app-lock-error" role="alert"></p>
        <button type="submit" class="app-lock-submit">Odblokuj</button>
      </form>
    </div>
  `;

  const form = element.querySelector('.app-lock-form');
  const input = element.querySelector('.app-lock-input');
  const error = element.querySelector('.app-lock-error');
  const submit = element.querySelector('.app-lock-submit');
  const passwordToggle = element.querySelector('.app-lock-password-toggle');
  const focusInput = () => input.focus({ preventScroll: true });

  passwordToggle.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    passwordToggle.setAttribute('aria-label', show ? 'Ukryj hasło' : 'Pokaż hasło');
  });

  const dispatchUnlock = () => {
    const password = input.value;
    element.dispatchEvent(new CustomEvent('unlock', { detail: { password } }));
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    dispatchUnlock();
  });

  return {
    element,
    focusInput,
    setError: (message) => {
      error.textContent = message || '';
      if (message) {
        input.setAttribute('aria-invalid', 'true');
        focusInput();
      } else {
        input.removeAttribute('aria-invalid');
      }
    },
    setBusy: (busy) => {
      submit.disabled = Boolean(busy);
      input.disabled = Boolean(busy);
      passwordToggle.disabled = Boolean(busy);
    }
  };
};
