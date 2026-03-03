import test from 'node:test';
import assert from 'node:assert/strict';

import { buildInvoiceStatsByMonth } from './invoiceStats.js';

const makeEntry = (date, orderId, billed, extra = {}) => ({
  id: date,
  date,
  zleceniaPowiazane: [{ zlecenieId: orderId, fakturowaneDlaZlecenia: billed, ...extra }]
});

test('monthly billed uses entry date month from calendar entries', () => {
  const orderId = 'order-1';
  const entries = [
    makeEntry('2026-02-03', orderId, 40),
    makeEntry('2026-02-18', orderId, 53),
    makeEntry('2026-03-02', orderId, 10)
  ];

  const closed = [{ id: orderId, status: 'ukończone', completionDate: '2026-03-02' }];
  const stats = buildInvoiceStatsByMonth(closed, entries);
  assert.equal(stats.monthStats.get('2026-02')?.invoicedHours, 93);
  assert.equal(stats.monthStats.get('2026-03')?.invoicedHours, 10);
});

test('deduplicates by stable entryId and keeps first duplicate', () => {
  const orderId = 'order-dup';
  const entries = [
    {
      id: '2026-02-01',
      date: '2026-02-01',
      zleceniaPowiazane: [
        { entryId: 'entry-dup-1', zlecenieId: orderId, fakturowaneDlaZlecenia: 10 },
        { entryId: 'entry-dup-1', zlecenieId: orderId, fakturowaneDlaZlecenia: 99 }
      ]
    }
  ];

  const stats = buildInvoiceStatsByMonth([], entries, { debugMonthKey: '2026-02' });
  assert.equal(stats.monthStats.get('2026-02')?.invoicedHours, 10);
  assert.deepEqual(stats.debug.duplicateEntryIds, ['entry-dup-1']);
});

test('groups by dateKey YYYY-MM-DD prefix (monthKey)', () => {
  const orderId = 'order-datekey';
  const entries = [
    {
      id: 'doc-a',
      date: 'not-a-date',
      dateKey: '2026-02-20',
      zleceniaPowiazane: [{ entryId: 'e-1', zlecenieId: orderId, fakturowaneDlaZlecenia: 1.5 }]
    },
    {
      id: 'doc-b',
      dayStr: '2026-03-01',
      zleceniaPowiazane: [{ entryId: 'e-2', zlecenieId: orderId, fakturowaneDlaZlecenia: 3.0 }]
    }
  ];

  const stats = buildInvoiceStatsByMonth([], entries);
  assert.equal(stats.monthStats.get('2026-02')?.invoicedHours, 1.5);
  assert.equal(stats.monthStats.get('2026-03')?.invoicedHours, 3.0);
});

