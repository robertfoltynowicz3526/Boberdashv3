import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInvoiceStatsByMonth, normalizeOrderForBilling, computeOrderAmounts, getOrderInvoicedHours } from './invoiceStats.js';

test('aggregates invoiced, gross and net from closed orders by settlementMonth', () => {
  const orders = [
    normalizeOrderForBilling({ id: '1', status: 'zakończone', settlementMonth: '2026-02', invoicedHours: 56.5, grossAmount: 1000, netAmount: 800 }),
    normalizeOrderForBilling({ id: '2', status: 'zakończone', completionDate: '2026-02-22', invoicedHours: 3.5, grossAmount: 50, netAmount: 40 }),
    normalizeOrderForBilling({ id: '3', status: 'aktywne', settlementMonth: '2026-02', invoicedHours: 999, grossAmount: 999, netAmount: 999 }),
    normalizeOrderForBilling({ id: '4', status: 'zakończone', settlementMonth: '2026-03', invoicedHours: 10, grossAmount: 200, netAmount: 150 })
  ];

  const stats = buildInvoiceStatsByMonth(orders);

  assert.equal(stats.monthStats.get('2026-02')?.invoicedHours, 60);
  assert.equal(stats.monthStats.get('2026-02')?.grossAmount, 1050);
  assert.equal(stats.monthStats.get('2026-02')?.netAmount, 840);
  assert.equal(stats.monthStats.get('2026-03')?.invoicedHours, 10);
});

test('supports legacy gross/net field names when computing order amounts', () => {
  const order = normalizeOrderForBilling({
    id: 'legacy',
    status: 'zakończone',
    settlementMonth: '2026-02',
    valueGross: '1234.56',
    valueNet: '987.65'
  });
  const amounts = computeOrderAmounts(order);
  assert.equal(amounts.grossCents, 123456);
  assert.equal(amounts.netCents, 98765);
  assert.equal(amounts.source, 'stored:gross+net');
});

test('falls back to invoicedHours * order rate when gross/net are missing', () => {
  const order = normalizeOrderForBilling({
    id: 'derived',
    status: 'zakończone',
    settlementMonth: '2026-02',
    invoicedHours: 10,
    typZlecenia: 'S'
  });
  const amounts = computeOrderAmounts(order);
  assert.equal(amounts.grossCents, 45000);
  assert.equal(amounts.netCents, 31500);
  assert.equal(amounts.source, 'derived:hours*rate');
});

test('prefers wyfakturowaneGodziny over invoicedHours when values differ', () => {
  const order = normalizeOrderForBilling({
    id: 'mismatch',
    status: 'zakończone',
    settlementMonth: '2026-02',
    wyfakturowaneGodziny: 2,
    invoicedHours: 1.8,
    typZlecenia: 'S'
  });
  const amounts = computeOrderAmounts(order);
  assert.equal(getOrderInvoicedHours(order), 2);
  assert.equal(order.invoicedHours, 2);
  assert.equal(order.wyfakturowaneGodziny, 2);
  assert.equal(amounts.grossCents, 9000);
});
