import assert from 'node:assert/strict';
import { buildInvoiceStatsByMonth, resolveOrderBillingMonth } from '../src/orders/invoiceStats.js';

const orders = [
  { id: 'o1', createdOn: '2025-12-20', completedOn: '2026-01-05', billingMonth: '2026-01' },
  { id: 'o2', createdOn: '2026-02-10', completedOn: '2026-02-28', billingMonth: '2026-03' },
  { id: 'o3', createdOn: '2026-04-11', completedOn: '2026-04-15' }
];

const entries = [
  { id: '2025-12-29', zleceniaPowiazane: [{ zlecenieId: 'o1', fakturowane: 2 }] },
  { id: '2026-01-03', zleceniaPowiazane: [{ zlecenieId: 'o1', fakturowane: 3 }] },
  { id: '2026-02-20', zleceniaPowiazane: [{ zlecenieId: 'o2', fakturowane: 4 }] },
  { id: '2026-04-16', zleceniaPowiazane: [{ zlecenieId: 'o3', fakturowane: 5 }] }
];

const map = buildInvoiceStatsByMonth(orders, entries);
assert.equal(map.get('2026-01')?.invoicedHours, 5, 'o1 should land in January');
assert.equal(map.get('2026-03')?.invoicedHours, 4, 'o2 should land in March');
assert.equal(map.get('2026-04')?.invoicedHours, 5, 'fallback to completedOn for legacy order');
assert.equal(resolveOrderBillingMonth({ createdOn: '2026-05-10' }), '2026-05', 'fallback to createdOn');

console.log('invoice stats scenarios: OK');
