const SESSION_KEY = 'appLock.session';
const DEFAULT_TTL_HOURS = 12;

export const getAppLockConfig = () => {
  const enabled = String(import.meta.env.VITE_APP_LOCK_ENABLED || '0') === '1';
  const passwordHash = String(import.meta.env.VITE_APP_LOCK_PASSWORD_HASH || '').toLowerCase();
  const ttlHoursRaw = Number(import.meta.env.VITE_APP_LOCK_TTL_HOURS || DEFAULT_TTL_HOURS);
  const ttlHours = Number.isFinite(ttlHoursRaw) && ttlHoursRaw > 0 ? ttlHoursRaw : DEFAULT_TTL_HOURS;
  return {
    enabled,
    passwordHash,
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

const sha256Hex = async (value) => {
  const data = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

export const unlockWithPassword = async (password, config = getAppLockConfig()) => {
  if (!config.enabled) return true;
  if (!password || !config.passwordHash) return false;
  const computed = (await sha256Hex(password)).toLowerCase();
  const ok = computed === config.passwordHash;
  if (ok) {
    persistSession(config);
  }
  return ok;
};

export const createLockScreen = () => {
  const element = document.createElement('section');
  element.id = 'app-lock-screen';
  element.className = 'app-lock-screen';
  element.innerHTML = `
    <div class="app-lock-card">
      <div class="app-lock-logo">JD</div>
      <div class="app-lock-title">Agro-Bober</div>
      <p class="app-lock-subtitle">Wpisz hasło, aby uruchomić aplikację.</p>
      <form class="app-lock-form">
        <label class="app-lock-label" for="app-lock-input">Hasło</label>
        <input id="app-lock-input" class="app-lock-input" type="password" autocomplete="current-password" placeholder="••••••••" />
        <p class="app-lock-error" role="alert" aria-live="polite"></p>
        <button type="submit" class="btn-add app-lock-submit">Odblokuj</button>
      </form>
    </div>
  `;

  const form = element.querySelector('.app-lock-form');
  const input = element.querySelector('.app-lock-input');
  const error = element.querySelector('.app-lock-error');
  const submit = element.querySelector('.app-lock-submit');

  const dispatchUnlock = () => {
    const password = input?.value || '';
    element.dispatchEvent(new CustomEvent('unlock', { detail: { password } }));
  };

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    dispatchUnlock();
  });

  return {
    element,
    focusInput: () => input?.focus(),
    setError: (message) => {
      if (error) error.textContent = message || '';
    },
    setBusy: (busy) => {
      if (submit) submit.disabled = Boolean(busy);
      if (input) input.disabled = Boolean(busy);
    }
  };
};
