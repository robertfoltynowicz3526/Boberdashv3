import test from 'node:test';
import assert from 'node:assert/strict';

import { buildInvoiceStatsByMonth } from './invoiceStats.js';

test('monthly billed uses settlementMonth from closed orders', () => {
  const orders = [
    { id: 'order-1', status: 'ukończone', settlementMonth: '2026-02', invoicedHours: 56.5 },
    { id: 'order-2', status: 'zakończone', settlementMonth: '2026-02', wyfakturowaneGodziny: 12 },
    { id: 'order-3', status: 'closed', settlementMonth: '2026-03', invoicedHours: 10 },
    { id: 'order-4', status: 'aktywne', settlementMonth: '2026-02', invoicedHours: 999 }
  ];

  const stats = buildInvoiceStatsByMonth(orders, []);
  assert.equal(stats.monthStats.get('2026-02')?.invoicedHours, 68.5);
  assert.equal(stats.monthStats.get('2026-02')?.ordersCount, 2);
  assert.equal(stats.monthStats.get('2026-03')?.invoicedHours, 10);
});

test('falls back to completionDate month when settlementMonth is missing', () => {
  const orders = [
    { id: 'order-fallback', status: 'ukończone', completionDate: '2026-02-20', invoicedHours: 20 }
  ];

  const stats = buildInvoiceStatsByMonth(orders, []);
  assert.equal(stats.monthStats.get('2026-02')?.invoicedHours, 20);
});

test('ignores closed orders with missing or zero invoiced hours', () => {
  const orders = [
    { id: 'order-empty-a', status: 'ukończone', settlementMonth: '2026-02', invoicedHours: null },
    { id: 'order-empty-b', status: 'ukończone', settlementMonth: '2026-02', invoicedHours: 0 }
  ];

  const stats = buildInvoiceStatsByMonth(orders, []);
  assert.equal(stats.monthStats.has('2026-02'), false);
});
