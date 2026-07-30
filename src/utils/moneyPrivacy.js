export const MONEY_PRIVACY_STORAGE_KEY = 'boberdash_incognito_money_hidden';
export const MONEY_MASK = '•••••• zł';

export const isMoneyHidden = () => {
  try {
    return localStorage.getItem(MONEY_PRIVACY_STORAGE_KEY) === 'true';
  } catch (_) {
    return false;
  }
};

export const setMoneyHidden = (hidden) => {
  try {
    localStorage.setItem(MONEY_PRIVACY_STORAGE_KEY, String(Boolean(hidden)));
  } catch (_) { }
};

/** Formats display-only money. Raw numbers remain available to aggregations and exports. */
export const formatMoney = (value, { locale = false } = {}) => {
  if (isMoneyHidden()) return MONEY_MASK;
  const amount = Number(value) || 0;
  const formatted = locale
    ? new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
    : amount.toFixed(2);
  return `${formatted} zł`;
};
