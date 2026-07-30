import test from 'node:test';
import assert from 'node:assert/strict';

import { computeDayTotals, configureDayTotals, resolveManualBilled } from './computeDayTotals.js';

test('removing the last order removes its billed and drive contribution', () => {
  const manual = new Map([['2026-07-30', { work: 0, drive: 0, billed: 0, over: 0 }]]);
  const orders = new Map([['2026-07-30', [{ orderId: 'order-1', billed: 6, drive: 2 }]]]);
  configureDayTotals({
    manualGetter: day => manual.get(day),
    ordersGetter: day => orders.get(day),
    leaveGetter: () => null,
  });

  assert.deepEqual(computeDayTotals('2026-07-30').totals, { work: 0, drive: 2, billed: 6, over: 0 });
  orders.set('2026-07-30', []);
  const afterRemoval = computeDayTotals('2026-07-30');
  assert.deepEqual(afterRemoval.totals, { work: 0, drive: 0, billed: 0, over: 0 });
  assert.equal(afterRemoval.hasData, false);
});

test('manual billed time survives order removal but a legacy linked total does not become manual', () => {
  assert.equal(resolveManualBilled({ billed: 6 }, true), 0);
  assert.equal(resolveManualBilled({ billed: 8, manualBilled: 2 }, true), 2);
  assert.equal(resolveManualBilled({ billed: 2 }, false), 2);
});
