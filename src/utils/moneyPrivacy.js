export const MONEY_PRIVACY_STORAGE_KEY = 'boberdash_incognito_money_hidden';
export const MONEY_MASK = '•••••• zł';

const readMoneyHidden = () => {
  try {
    return localStorage.getItem(MONEY_PRIVACY_STORAGE_KEY) === 'true';
  } catch (_) {
    return false;
  }
};

// Module state is shared by every renderer. localStorage is persistence only;
// raw monetary values continue to live in application/Firebase data.
let isIncognitoMoneyHidden = readMoneyHidden();

export const isMoneyHidden = () => isIncognitoMoneyHidden;

export const setMoneyHidden = (hidden) => {
  isIncognitoMoneyHidden = Boolean(hidden);
  try {
    localStorage.setItem(MONEY_PRIVACY_STORAGE_KEY, String(isIncognitoMoneyHidden));
  } catch (_) { }
};

/** Formats display-only money. Raw numbers remain available to aggregations and exports. */
export const formatMoney = (value, { locale = false } = {}) => {
  const amount = Number(value) || 0;
  const formatted = locale
    ? new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
    : amount.toFixed(2);
  const visibleText = `${formatted} zł`;
  const text = isMoneyHidden() ? MONEY_MASK : visibleText;
  return `<span data-money-value="${amount}" data-money-locale="${locale ? 'true' : 'false'}">${text}</span>`;
};

/** Updates existing money nodes in place, without rebuilding views or modals. */
export const refreshMoneyVisibility = (root = document) => {
  root.querySelectorAll('[data-money-value]').forEach((node) => {
    if (isMoneyHidden()) {
      node.textContent = MONEY_MASK;
      return;
    }
    const amount = Number(node.dataset.moneyValue) || 0;
    const locale = node.dataset.moneyLocale === 'true';
    const formatted = locale
      ? new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
      : amount.toFixed(2);
    node.textContent = `${formatted} zł`;
  });
};
