import tractorPhotoUrl from './assets/login/john-deere-6r-250.webp';
import './styles/app-lock.css';

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
