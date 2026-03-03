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
