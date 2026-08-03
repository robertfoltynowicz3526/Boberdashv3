import test from 'node:test';
import assert from 'node:assert/strict';

test('money privacy persists state and refreshes rendered amounts in place', async () => {
  const storage = new Map([['boberdash_incognito_money_hidden', 'false']]);
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value)
  };

  const moneyNode = {
    dataset: { moneyValue: '1234.5', moneyLocale: 'false' },
    textContent: '1234.50 zł'
  };
  const root = { querySelectorAll: () => [moneyNode] };
  const privacy = await import(`./moneyPrivacy.js?test=${Date.now()}`);

  privacy.setMoneyHidden(true);
  privacy.refreshMoneyVisibility(root);
  assert.equal(privacy.isMoneyHidden(), true);
  assert.equal(storage.get(privacy.MONEY_PRIVACY_STORAGE_KEY), 'true');
  assert.equal(moneyNode.textContent, privacy.MONEY_MASK);

  privacy.setMoneyHidden(false);
  privacy.refreshMoneyVisibility(root);
  assert.equal(moneyNode.textContent, '1234.50 zł');
});
