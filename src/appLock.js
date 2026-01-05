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
