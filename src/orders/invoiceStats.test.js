import test from 'node:test';
import assert from 'node:assert/strict';

import { buildInvoiceStatsByMonth } from './invoiceStats.js';

const makeEntry = (date, orderId, billed) => ({
  id: date,
  date,
  zleceniaPowiazane: [{ zlecenieId: orderId, fakturowaneDlaZlecenia: billed }]
});

test('closed order uses completionDate month, active order uses entry.date month', () => {
  const orderId = 'order-1';
  const entries = [
    makeEntry('2026-02-03', orderId, 40),
    makeEntry('2026-02-18', orderId, 53)
  ];

  const closed = [{ id: orderId, status: 'ukończone', completionDate: '2026-03-02' }];
  const closedStats = buildInvoiceStatsByMonth(closed, entries);
  assert.equal(closedStats.monthStats.get('2026-03')?.invoicedHours, 93);
  assert.equal(closedStats.monthStats.get('2026-02')?.invoicedHours || 0, 0);

  const reopened = [{ id: orderId, status: 'aktywne', completionDate: null }];
  const reopenedStats = buildInvoiceStatsByMonth(reopened, entries);
  assert.equal(reopenedStats.monthStats.get('2026-02')?.invoicedHours, 93);
  assert.equal(reopenedStats.monthStats.get('2026-03')?.invoicedHours || 0, 0);
});

test('closed order moves all billed hours into completion month (no split across entry months)', () => {
  const orderId = 'order-closed-rollup';
  const entries = [
    makeEntry('2026-02-02', orderId, 30.5),
    makeEntry('2026-03-03', orderId, 4.5)
  ];
  const closedInFebruary = [{ id: orderId, status: 'zakończone', completionDate: '2026-02-25' }];

  const stats = buildInvoiceStatsByMonth(closedInFebruary, entries);
  assert.equal(stats.monthStats.get('2026-02')?.invoicedHours, 35);
  assert.equal(stats.monthStats.get('2026-03')?.invoicedHours || 0, 0);
});

test('active order keeps billed hours in entry months (30.5 vs 4.5 scenario)', () => {
  const orderId = 'order-active-split';
  const entries = [
    makeEntry('2026-02-08', orderId, 30.5),
    makeEntry('2026-03-04', orderId, 4.5)
  ];
  const active = [{ id: orderId, status: 'active', completionDate: null }];

  const stats = buildInvoiceStatsByMonth(active, entries);
  assert.equal(stats.monthStats.get('2026-02')?.invoicedHours, 30.5);
  assert.equal(stats.monthStats.get('2026-03')?.invoicedHours, 4.5);
});

test('reopen aggregation does not duplicate hours', () => {
  const orderId = 'order-2';
  const entries = [
    makeEntry('2026-02-01', orderId, 55.5),
    makeEntry('2026-02-10', orderId, 37.5)
  ];
  const reopened = [{ id: orderId, status: 'aktywne' }];

  const stats = buildInvoiceStatsByMonth(reopened, entries);
  assert.equal(stats.monthStats.get('2026-02')?.invoicedHours, 93);
  assert.equal(stats.monthStats.size, 1);
});


test('closed order without completionDate falls back to entry month', () => {
  const orderId = 'order-3';
  const entries = [makeEntry('2026-02-11', orderId, 12)];
  const closedNoCompletionDate = [{ id: orderId, status: 'ukończone' }];

  const stats = buildInvoiceStatsByMonth(closedNoCompletionDate, entries);
  assert.equal(stats.monthStats.get('2026-02')?.invoicedHours, 12);
  assert.equal(stats.monthStats.get('2026-03')?.invoicedHours || 0, 0);
});

test('debug mode reports month ingredients and duplicate entry ids', () => {
  const orderId = 'order-debug-1';
  const duplicateEntry = { id: 'entry-dup-1', zlecenieId: orderId, fakturowaneDlaZlecenia: 10 };
  const entries = [
    { id: '2026-02-01', date: '2026-02-01', zleceniaPowiazane: [duplicateEntry, duplicateEntry] }
  ];
  const orders = [{ id: orderId, status: 'zakończone', completionDate: '2026-02-14' }];

  const stats = buildInvoiceStatsByMonth(orders, entries, { debugMonthKey: '2026-02' });
  assert.equal(stats.monthStats.get('2026-02')?.invoicedHours, 20);
  assert.equal(stats.debug.closed.length, 1);
  assert.equal(stats.debug.closed[0].orderId, orderId);
  assert.equal(stats.debug.closed[0].totalBilled, 20);
  assert.deepEqual(stats.debug.active, []);
  assert.deepEqual(stats.debug.duplicateEntryIds, ['entry-dup-1']);
});
