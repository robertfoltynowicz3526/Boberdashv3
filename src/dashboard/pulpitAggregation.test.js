import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateTimeStats, buildRecentActiveOrders } from './pulpitAggregation.js';

test('totals include only the selected days with time, and absorption uses their billed and work hours', () => {
  const days = new Map([
    ['2026-11-16', { totals: { work: 8, drive: 2, billed: 6, over: 1 } }],
    ['2026-11-17', { totals: { work: 4, drive: 1, billed: 3, over: 0 } }],
    ['2026-11-18', { totals: { work: 8, drive: 0, billed: 4, over: 0 }, isLeave: true }],
    ['2026-11-01', { totals: { work: 4, drive: 2, billed: 1, over: 0 } }],
  ]);
  const readDay = day => days.get(day);
  assert.deepEqual(aggregateTimeStats(['2026-11-16', '2026-11-17', '2026-11-18'], readDay), {
    work: 12, drive: 3, billed: 9, over: 1, absorption: 75,
  });
  assert.deepEqual(aggregateTimeStats(days.keys(), readDay), {
    work: 16, drive: 5, billed: 10, over: 1, absorption: 62.5,
  });
});

test('shows up to five active orders in creation order with details from loaded clients and machines', () => {
  const orders = [1, 4, 3, 2, 5, 6, 8, 7].map(i => ({
    id: String(i),
    nrZlecenia: 100 + i,
    status: i === 8 ? 'zakończone' : i === 7 ? 'nieprzypisane' : 'aktywne',
    createdAt: { toDate: () => new Date(`2026-11-0${i}T12:00:00Z`) },
    klientId: 'client',
    maszynaId: 'machine',
  }));
  const result = buildRecentActiveOrders(orders, [{ id: 'client', nazwa: 'Testowy klient' }], [
    { id: 'machine', typMaszyny: 'Ciągnik', model: '6150R' },
  ]);
  assert.deepEqual(result.map(order => order.id), ['6', '5', '4', '3', '2']);
  assert.deepEqual(result[0], { id: '6', number: 106, client: 'Testowy klient', machine: 'Ciągnik 6150R' });
});
